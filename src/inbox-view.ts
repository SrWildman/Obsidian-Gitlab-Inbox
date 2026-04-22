import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type GitLabInboxPlugin from "./main";
import {
  Category,
  DiffSize,
  InboxData,
  InboxItem,
  MergeReadiness,
  PriorityLabel,
  SectionConfig,
  TeamMemberLoad,
} from "./types";

export const VIEW_TYPE_INBOX = "gitlab-inbox-view";

export class InboxView extends ItemView {
  plugin: GitLabInboxPlugin;
  private data: InboxData | null = null;
  private refreshing = false;
  private selectedKeys: Set<string> = new Set();
  private selectMode = false;

  constructor(leaf: WorkspaceLeaf, plugin: GitLabInboxPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_INBOX;
  }

  getDisplayText(): string {
    return "GitLab Inbox";
  }

  getIcon(): string {
    return "inbox";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  setData(data: InboxData): void {
    this.data = data;
    this.render();
  }

  setRefreshing(refreshing: boolean): void {
    this.refreshing = refreshing;
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("gi-container");

    // Header
    const header = container.createDiv({ cls: "gi-header" });
    const titleRow = header.createDiv({ cls: "gi-title-row" });
    titleRow.createEl("h4", { text: "GitLab Inbox" });

    const headerButtons = titleRow.createDiv({ cls: "gi-header-buttons" });

    const selectBtn = headerButtons.createEl("button", {
      cls: `gi-header-btn clickable-icon ${this.selectMode ? "gi-active" : ""}`,
      attr: { "aria-label": this.selectMode ? "Cancel select" : "Select items" },
      text: this.selectMode ? "Cancel" : "Select",
    });
    selectBtn.addEventListener("click", () => {
      this.selectMode = !this.selectMode;
      if (!this.selectMode) this.selectedKeys.clear();
      this.render();
    });

    const refreshBtn = headerButtons.createEl("button", {
      cls: `gi-header-btn clickable-icon ${this.refreshing ? "gi-spin-container" : ""}`,
      attr: { "aria-label": "Refresh" },
      text: this.refreshing ? "Refreshing..." : "Refresh",
    });
    refreshBtn.addEventListener("click", () => {
      this.plugin.refresh();
    });

    if (!this.data) {
      container.createDiv({ cls: "gi-empty", text: this.refreshing ? "Fetching..." : "No data yet. Click Refresh to fetch." });
      return;
    }

    // Summary
    const uncheckedCount = this.data.items.length;
    const lastUpdate = this.data.fetchedAt;
    const timeAgo = this.formatTimeAgo(lastUpdate);
    header.createDiv({
      cls: "gi-summary",
      text: `${uncheckedCount} items - updated ${timeAgo}`,
    });

    // Batch action bar (always visible in select mode to prevent layout shift)
    if (this.selectMode) {
      const batchBar = container.createDiv({ cls: "gi-batch-bar" });
      batchBar.createSpan({ text: this.selectedKeys.size > 0 ? `${this.selectedKeys.size} selected` : "Select items" });

      const batchDone = batchBar.createEl("button", { cls: "gi-batch-btn", text: "\u2713 Done" });
      if (this.selectedKeys.size === 0) batchDone.setAttribute("disabled", "");
      batchDone.addEventListener("click", async () => {
        if (this.selectedKeys.size === 0) return;
        await this.batchAction("done");
      });

      const batchSnooze = batchBar.createEl("button", { cls: "gi-batch-btn gi-batch-snooze", text: "\u23F3 Snooze" });
      if (this.selectedKeys.size === 0) batchSnooze.setAttribute("disabled", "");
      batchSnooze.addEventListener("click", async () => {
        if (this.selectedKeys.size === 0) return;
        await this.batchAction("snooze");
      });
    }

    // Group items
    const sectionOrder = this.plugin.settings.sectionOrder.filter((s) => s.enabled);
    const grouped = new Map<Category, InboxItem[]>();
    for (const sec of sectionOrder) {
      grouped.set(sec.category, []);
    }
    for (const item of this.data.items) {
      grouped.get(item.category)?.push(item);
    }

    // Render sections
    for (const sec of sectionOrder) {
      const items = grouped.get(sec.category);
      if (!items || items.length === 0) continue;

      const section = container.createDiv({ cls: "gi-section" });
      const sectionHeader = section.createDiv({ cls: "gi-section-header" });
      sectionHeader.createSpan({ cls: "gi-section-title", text: `${sec.label} (${items.length})` });

      const list = section.createDiv({ cls: "gi-list" });
      for (const item of items) {
        this.renderItem(list, item);
      }
    }

    // Team load
    if (this.data.teamLoad.length > 0) {
      this.renderTeamLoad(container, this.data.teamLoad);
    }
  }

  private renderItem(parent: HTMLElement, item: InboxItem): void {
    const priorityLabel = this.getPriorityLabel(item.priorityId);
    const isSelected = this.selectedKeys.has(item.key);
    const row = parent.createDiv({ cls: `gi-item ${isSelected ? "gi-item-selected" : ""}` });
    if (priorityLabel) {
      row.style.borderLeftColor = priorityLabel.color;
      row.addClass("gi-has-priority");
    }

    // Main row
    const main = row.createDiv({ cls: "gi-item-main" });

    // Selection checkbox (only in select mode)
    if (this.selectMode) {
      const checkbox = main.createEl("input", { cls: "gi-item-checkbox", attr: { type: "checkbox" } }) as HTMLInputElement;
      checkbox.checked = isSelected;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selectedKeys.add(item.key);
        } else {
          this.selectedKeys.delete(item.key);
        }
        this.render();
      });
    }

    // Left: reference + title
    const info = main.createDiv({ cls: "gi-item-info" });
    const link = info.createEl("a", {
      cls: "gi-item-ref",
      text: item.shortRef,
      href: item.url,
    });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const hostname = this.plugin.settings.gitlabHostname;
      if (hostname && item.url.includes(hostname)) {
        window.open(item.url, "_blank");
      }
    });

    info.createSpan({ cls: "gi-item-title", text: ` ${item.title}` });

    // Right: badges
    const badges = main.createDiv({ cls: "gi-item-badges" });

    if (item.category === Category.YourMRs) {
      if (item.readiness === MergeReadiness.Ready) {
        badges.createSpan({ cls: "gi-badge gi-ready", text: "MERGE" });
      } else if (item.readiness === MergeReadiness.FixPipeline) {
        badges.createSpan({ cls: "gi-badge gi-warning", text: "FIX PIPELINE" });
      } else if (item.readiness === MergeReadiness.ResolveConflicts) {
        badges.createSpan({ cls: "gi-badge gi-warning", text: "CONFLICTS" });
      } else if (item.approvedCount !== null && item.requiredApprovals !== null) {
        badges.createSpan({
          cls: "gi-badge",
          text: `${item.approvedCount}/${item.requiredApprovals}`,
        });
      }
    }

    if (item.size) {
      const sizeClass = item.size === DiffSize.XL || item.size === DiffSize.L
        ? "gi-badge gi-size-large"
        : "gi-badge";
      badges.createSpan({ cls: sizeClass, text: item.size });
    }

    if (item.threadsWaiting > 0) {
      badges.createSpan({ cls: "gi-badge gi-threads", text: `${item.threadsWaiting} waiting` });
    }

    if (item.stale) {
      badges.createSpan({ cls: "gi-badge gi-stale", text: item.stale });
    }

    if (priorityLabel) {
      const badge = badges.createSpan({ cls: "gi-badge gi-priority-badge", text: priorityLabel.label.toUpperCase() });
      badge.style.backgroundColor = priorityLabel.color;
    }

    badges.createSpan({ cls: "gi-badge gi-age", text: this.ageStr(item.ageDays) });

    // Meta row
    const meta = row.createDiv({ cls: "gi-item-meta" });
    if (item.category === Category.Todos) {
      if (item.todoFrom) meta.createSpan({ text: `from ${item.todoFrom}` });
      if (item.todoType) meta.createSpan({ cls: "gi-meta-sep", text: item.todoType });
    } else {
      if (item.author && item.category !== Category.YourMRs) {
        meta.createSpan({ text: item.author });
      }
      if (item.category === Category.YourMRs && item.reviewers.length > 0) {
        meta.createSpan({ text: `reviewers: ${item.reviewers.join(", ")}` });
      }
      for (const flag of item.flags) {
        meta.createSpan({ cls: "gi-meta-flag", text: flag });
      }
    }

    // Description preview
    if (item.description || (item.category === Category.Todos && item.todoBody)) {
      const desc = item.category === Category.Todos ? item.todoBody : item.description;
      if (desc) {
        row.createDiv({ cls: "gi-item-desc", text: desc });
      }
    }

    // Action buttons
    const actions = row.createDiv({ cls: "gi-item-actions" });

    const doneBtn = actions.createEl("button", {
      cls: "gi-action-btn clickable-icon",
      text: "\u2713",
      attr: { "aria-label": "Mark as done" },
    });
    doneBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (item.todoId) {
        await this.plugin.markTodoDone(item);
      } else {
        await this.plugin.checkOffItem(item);
      }
      row.addClass("gi-item-done");
      setTimeout(() => {
        if (this.data) {
          this.data.items = this.data.items.filter((i) => i.key !== item.key);
          this.render();
        }
      }, 300);
    });

    const snoozeBtn = actions.createEl("button", {
      cls: "gi-action-btn clickable-icon",
      text: "\u23F3",
      attr: { "aria-label": "Snooze until tomorrow" },
    });
    snoozeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const tomorrow = window.moment().add(1, "day").format("YYYY-MM-DD");
      await this.plugin.snoozeItem(item, tomorrow);
      row.addClass("gi-item-done");
      setTimeout(() => {
        if (this.data) {
          this.data.items = this.data.items.filter((i) => i.key !== item.key);
          this.render();
        }
      }, 300);
    });

  }

  private renderTeamLoad(parent: HTMLElement, teamLoad: TeamMemberLoad[]): void {
    const section = parent.createDiv({ cls: "gi-section gi-team-section" });
    section.createDiv({ cls: "gi-section-header" })
      .createSpan({ cls: "gi-section-title", text: "Team Review Load" });

    const table = section.createEl("table", { cls: "gi-team-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: "Reviewer" });
    headerRow.createEl("th", { text: "Open" });
    headerRow.createEl("th", { text: "Oldest" });

    const tbody = table.createEl("tbody");
    for (const member of teamLoad) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: member.displayName });
      tr.createEl("td", { text: String(member.openReviews) });
      tr.createEl("td", { text: this.ageStr(member.oldestDays) });
    }
  }

  private async batchAction(action: "done" | "snooze"): Promise<void> {
    if (!this.data) return;
    const selected = this.data.items.filter((i) => this.selectedKeys.has(i.key));
    if (selected.length === 0) return;

    const tomorrow = window.moment().add(1, "day").format("YYYY-MM-DD");

    for (const item of selected) {
      if (action === "done") {
        if (item.todoId) {
          await this.plugin.markTodoDone(item);
        } else {
          await this.plugin.checkOffItem(item);
        }
      } else {
        await this.plugin.snoozeItem(item, tomorrow);
      }
    }

    this.data.items = this.data.items.filter((i) => !this.selectedKeys.has(i.key));
    this.selectedKeys.clear();
    this.selectMode = false;
    this.render();
  }

  private getPriorityLabel(priorityId: string | null): PriorityLabel | null {
    if (!priorityId) return null;
    return this.plugin.settings.labels.find((l) => l.id === priorityId) ?? null;
  }

  private ageStr(days: number): string {
    if (days === 0) return "today";
    if (days < 7) return `${days}d`;
    if (days < 30) return `${Math.floor(days / 7)}w`;
    return `${Math.floor(days / 30)}mo`;
  }

  private formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }
}
