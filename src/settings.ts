import { App, PluginSettingTab, Setting } from "obsidian";
import type GitLabInboxPlugin from "./main";
import { CONDITION_LABELS, CONDITION_UNITS, ConditionType, PriorityRule } from "./types";

export class GitLabInboxSettingTab extends PluginSettingTab {
  plugin: GitLabInboxPlugin;

  constructor(app: App, plugin: GitLabInboxPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Connection").setHeading();

    new Setting(containerEl)
      .setName("GitLab hostname")
      .setDesc("Your self-hosted GitLab instance (e.g. gitlab.company.com).")
      .addText((text) => {
        text
          .setPlaceholder("gitlab.example.com")
          .setValue(this.plugin.settings.gitlabHostname)
          .onChange(async (value) => {
            this.plugin.settings.gitlabHostname = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Personal access token")
      .setDesc("Token with api scope. Create at GitLab > Settings > Access Tokens.")
      .addText((text) => {
        text
          .setPlaceholder("glpat-...")
          .setValue(this.plugin.settings.personalAccessToken)
          .onChange(async (value) => {
            this.plugin.settings.personalAccessToken = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
        text.inputEl.addClass("gi-input-token");
      });

    new Setting(containerEl).setName("Refresh").setHeading();

    new Setting(containerEl)
      .setName("Refresh interval (minutes)")
      .setDesc("How often to fetch new data from GitLab.")
      .addSlider((slider) => {
        slider
          .setLimits(5, 60, 5)
          .setValue(this.plugin.settings.refreshIntervalMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.refreshIntervalMinutes = value;
            await this.plugin.saveSettings();
            this.plugin.restartInterval();
          });
      });

    new Setting(containerEl).setName("Vault integration").setHeading();

    new Setting(containerEl)
      .setName("Inbox filename")
      .setDesc("Name of the markdown note written to your vault root.")
      .addText((text) => {
        text
          .setPlaceholder("GitLab Inbox.md")
          .setValue(this.plugin.settings.inboxFilename)
          .onChange(async (value) => {
            this.plugin.settings.inboxFilename = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Desktop notifications")
      .setDesc("Show a notification when new items appear.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.enableNotifications)
          .onChange(async (value) => {
            this.plugin.settings.enableNotifications = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Daily note logging")
      .setDesc("Log checked-off items to today's daily note under ### GitLab.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.enableDailyNoteLogging)
          .onChange(async (value) => {
            this.plugin.settings.enableDailyNoteLogging = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Daily notes folder")
      .setDesc("Folder where your daily notes live.")
      .addText((text) => {
        text
          .setPlaceholder("Daily")
          .setValue(this.plugin.settings.dailyNotesFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesFolder = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Daily note date format")
      .setDesc("Moment.js format for daily note filenames.")
      .addText((text) => {
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(this.plugin.settings.dailyNoteDateFormat)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteDateFormat = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName("Sections").setDesc("Rename, reorder, or disable inbox sections.").setHeading();

    const sectionList = containerEl.createDiv();
    this.renderSections(sectionList);

    new Setting(containerEl).setName("Labels").setDesc("Define the labels that rules can apply to items. Items matching no rule get no badge.").setHeading();

    const labelList = containerEl.createDiv();
    this.renderLabels(labelList);

    new Setting(containerEl).setName("Rules").setDesc("When a condition matches, the item gets the chosen label. First match wins - order matters.").setHeading();

    const ruleList = containerEl.createDiv({ cls: "gi-rules-list" });
    this.renderRules(ruleList);

    new Setting(containerEl).setName("Actions").setHeading();

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Verify your GitLab hostname and token work.")
      .addButton((button) => {
        button.setButtonText("Test").onClick(async () => {
          button.setButtonText("Testing...");
          try {
            const api = this.plugin.createApi();
            const username = await api.getUsername();
            button.setButtonText(`Connected as ${username}`);
            setTimeout(() => button.setButtonText("Test"), 3000);
          } catch {
            button.setButtonText("Failed - check settings");
            setTimeout(() => button.setButtonText("Test"), 3000);
          }
        });
      });

    new Setting(containerEl)
      .setName("Refresh now")
      .setDesc("Manually trigger an inbox refresh.")
      .addButton((button) => {
        button.setButtonText("Refresh").onClick(async () => {
          button.setButtonText("Refreshing...");
          await this.plugin.refresh();
          button.setButtonText("Done");
          setTimeout(() => button.setButtonText("Refresh"), 2000);
        });
      });
  }

  private renderSections(container: HTMLElement): void {
    container.empty();
    const sections = this.plugin.settings.sectionOrder;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const setting = new Setting(container)
        .setName(section.label)
        .addToggle((toggle) => {
          toggle.setValue(section.enabled).onChange(async (value) => {
            section.enabled = value;
            await this.plugin.saveSettings();
          });
        })
        .addText((text) => {
          text
            .setPlaceholder(section.category)
            .setValue(section.label)
            .onChange(async (value) => {
              section.label = value;
              await this.plugin.saveSettings();
            });
          text.inputEl.addClass("gi-input-section-label");
        });

      if (i > 0) {
        setting.addButton((btn) => {
          btn.setIcon("arrow-up").setTooltip("Move up").onClick(async () => {
            sections.splice(i, 1);
            sections.splice(i - 1, 0, section);
            await this.plugin.saveSettings();
            this.renderSections(container);
          });
        });
      }

      if (i < sections.length - 1) {
        setting.addButton((btn) => {
          btn.setIcon("arrow-down").setTooltip("Move down").onClick(async () => {
            sections.splice(i, 1);
            sections.splice(i + 1, 0, section);
            await this.plugin.saveSettings();
            this.renderSections(container);
          });
        });
      }
    }
  }

  private renderLabels(container: HTMLElement): void {
    container.empty();
    const labels = this.plugin.settings.labels;

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      new Setting(container)
        .addText((text) => {
          text
            .setPlaceholder("Label name")
            .setValue(label.label)
            .onChange(async (value) => {
              label.label = value;
              await this.plugin.saveSettings();
            });
          text.inputEl.addClass("gi-input-label-name");
          text.inputEl.addEventListener("blur", () => this.display());
        })
        .addText((text) => {
          text
            .setPlaceholder("CSS color")
            .setValue(label.color)
            .onChange(async (value) => {
              label.color = value;
              await this.plugin.saveSettings();
            });
          text.inputEl.addClass("gi-input-label-color");
          text.inputEl.style.borderLeft = `4px solid ${label.color}`;
        })
        .addButton((btn) => {
          btn.setIcon("trash").setWarning().onClick(async () => {
            const removedId = label.id;
            labels.splice(i, 1);
            // Remove rules referencing this label
            this.plugin.settings.rules = this.plugin.settings.rules.filter(
              (r) => r.labelId !== removedId
            );
            await this.plugin.saveSettings();
            this.display();
          });
        });
    }

    new Setting(container)
      .addButton((btn) => {
        btn.setButtonText("+ Add Label").onClick(async () => {
          const id = `label_${Date.now()}`;
          labels.push({ id, label: "New Label", color: "var(--text-muted)" });
          await this.plugin.saveSettings();
          this.renderLabels(container);
        });
      });
  }

  private renderRules(container: HTMLElement): void {
    container.empty();
    const rules = this.plugin.settings.rules;
    const labels = this.plugin.settings.labels;

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const unit = CONDITION_UNITS[rule.condition];
      const needsValue = unit !== undefined;

      const setting = new Setting(container);

      // Build description: "When [condition] [value] [unit], apply [label]"
      const labelName = labels.find((l) => l.id === rule.labelId)?.label ?? "?";
      let desc = CONDITION_LABELS[rule.condition];
      if (needsValue && rule.value !== null) {
        desc += ` ${rule.value} ${unit}`;
      }
      setting.setName(desc);

      // Condition dropdown
      setting.addDropdown((dropdown) => {
        for (const ct of Object.values(ConditionType)) {
          dropdown.addOption(ct, CONDITION_LABELS[ct]);
        }
        dropdown.setValue(rule.condition);
        dropdown.onChange(async (value) => {
          rule.condition = value as ConditionType;
          const newUnit = CONDITION_UNITS[rule.condition];
          rule.value = newUnit ? (rule.value ?? 3) : null;
          await this.plugin.saveSettings();
          this.renderRules(container);
        });
      });

      // Value input (only for conditions that need it)
      if (needsValue) {
        setting.addText((text) => {
          text
            .setPlaceholder(unit)
            .setValue(String(rule.value ?? ""))
            .onChange(async (value) => {
              const num = parseInt(value, 10);
              rule.value = isNaN(num) ? null : num;
              await this.plugin.saveSettings();
            });
          text.inputEl.addClass("gi-input-rule-value");
          text.inputEl.type = "number";
        });
      }

      // Label dropdown
      setting.addDropdown((dropdown) => {
        for (const label of labels) {
          dropdown.addOption(label.id, label.label);
        }
        dropdown.setValue(rule.labelId);
        dropdown.onChange(async (value) => {
          rule.labelId = value;
          await this.plugin.saveSettings();
          this.renderRules(container);
        });
      });

      // Reorder buttons
      if (i > 0) {
        setting.addButton((btn) => {
          btn.setIcon("arrow-up").setTooltip("Move up").onClick(async () => {
            rules.splice(i, 1);
            rules.splice(i - 1, 0, rule);
            await this.plugin.saveSettings();
            this.renderRules(container);
          });
        });
      }

      if (i < rules.length - 1) {
        setting.addButton((btn) => {
          btn.setIcon("arrow-down").setTooltip("Move down").onClick(async () => {
            rules.splice(i, 1);
            rules.splice(i + 1, 0, rule);
            await this.plugin.saveSettings();
            this.renderRules(container);
          });
        });
      }

      // Delete
      setting.addButton((btn) => {
        btn.setIcon("trash").setWarning().onClick(async () => {
          rules.splice(i, 1);
          await this.plugin.saveSettings();
          this.renderRules(container);
        });
      });
    }

    // Add rule button
    new Setting(container)
      .addButton((btn) => {
        btn.setButtonText("+ Add Rule").onClick(async () => {
          const firstLabel = labels[0]?.id ?? "";
          if (!firstLabel) return;
          rules.push({
            condition: ConditionType.ReviewOlderThan,
            value: 3,
            labelId: firstLabel,
          });
          await this.plugin.saveSettings();
          this.renderRules(container);
        });
      });
  }
}
