import { normalizePath, Notice, Plugin } from "obsidian";
import { GitLabApi } from "./gitlab-api";
import { fetchInboxData } from "./inbox-processor";
import { InboxView, VIEW_TYPE_INBOX } from "./inbox-view";
import {
  findNewlyCheckedItems,
  generateNote,
  logToDailyNote,
  parseExistingNote,
  readExistingNote,
  writeInboxNote,
} from "./note-writer";
import { GitLabInboxSettingTab } from "./settings";
import { Category, CheckedState, DEFAULT_SETTINGS, GitLabInboxSettings, InboxData, InboxItem } from "./types";

export default class GitLabInboxPlugin extends Plugin {
  settings: GitLabInboxSettings = DEFAULT_SETTINGS;
  private intervalId: number | null = null;
  private refreshing = false;
  private lastData: InboxData | null = null;
  private previousStates: Map<string, CheckedState> = new Map();
  private isFirstRun = true;
  private suppressModifyHandler = false;
  private statusBarEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register sidebar view
    this.registerView(VIEW_TYPE_INBOX, (leaf) => new InboxView(leaf, this));

    // Ribbon icon
    this.addRibbonIcon("inbox", "GitLab Inbox", () => {
      void this.activateView();
    });

    // Status bar
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.setText("");
    this.statusBarEl.addClass("gi-status-bar");
    this.registerDomEvent(this.statusBarEl, "click", () => {
      void this.activateView();
    });

    // Commands
    this.addCommand({
      id: "open-inbox",
      name: "Open inbox",
      callback: () => { void this.activateView(); },
    });

    this.addCommand({
      id: "refresh-inbox",
      name: "Refresh inbox",
      callback: () => { void this.refresh(); },
    });

    // Settings tab
    this.addSettingTab(new GitLabInboxSettingTab(this.app, this));

    // Start auto-refresh if configured
    if (this.settings.gitlabHostname && this.settings.personalAccessToken) {
      this.startInterval();
      // Initial fetch after a short delay to let Obsidian finish loading
      const t = window.setTimeout(() => { void this.refresh(); }, 5000);
      this.register(() => window.clearTimeout(t));
    }

    // Watch for changes to the inbox file (user checking items off)
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file.path === normalizePath(this.settings.inboxFilename)) {
          void this.handleNoteModified();
        }
      })
    );
  }

  onunload(): void {
    this.stopInterval();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  createApi(): GitLabApi {
    return new GitLabApi(this.settings.gitlabHostname, this.settings.personalAccessToken);
  }

  startInterval(): void {
    this.stopInterval();
    const ms = this.settings.refreshIntervalMinutes * 60 * 1000;
    this.intervalId = this.registerInterval(
      window.setInterval(() => { void this.refresh(); }, ms)
    );
  }

  stopInterval(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  restartInterval(): void {
    if (this.settings.gitlabHostname && this.settings.personalAccessToken) {
      this.startInterval();
    }
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return;
    if (!this.settings.gitlabHostname || !this.settings.personalAccessToken) {
      new Notice("Configure hostname and token in settings.");
      return;
    }
    this.refreshing = true;

    // Update sidebar view to show refreshing state
    const view = this.getView();
    view?.setRefreshing(true);

    try {
      const api = this.createApi();

      // Read existing note state before fetch
      const existingContent = await readExistingNote(this.app, this.settings);
      const existingStates = existingContent
        ? parseExistingNote(existingContent)
        : new Map<string, CheckedState>();

      // Store previous states for daily note logging
      this.previousStates = existingStates;

      // Fetch fresh data
      const data = await fetchInboxData(api, this.settings);
      this.lastData = data;

      // Re-read note state right before write to catch any check-offs that happened during fetch
      const freshContent = await readExistingNote(this.app, this.settings);
      const freshStates = freshContent
        ? parseExistingNote(freshContent)
        : existingStates;

      // Generate and write note
      const noteContent = generateNote(data, freshStates, this.settings.sectionOrder);
      this.suppressModifyHandler = true;
      await writeInboxNote(this.app, this.settings, noteContent);
      this.previousStates = parseExistingNote(noteContent);
      this.suppressModifyHandler = false;

      // Send notifications for new items (skip first run)
      if (!this.isFirstRun && this.settings.enableNotifications) {
        this.notifyNewItems(data, freshStates);
      }
      this.isFirstRun = false;

      // Filter out checked/snoozed items for sidebar and status bar
      const today = new Date().toISOString().split("T")[0];
      const activeItems = data.items.filter((item) => {
        const state = freshStates.get(item.key);
        if (state?.checked) return false;
        if (state?.snoozedUntil && state.snoozedUntil > today) return false;
        return true;
      });
      const activeData: InboxData = { ...data, items: activeItems };

      // Update sidebar view
      view?.setData(activeData);
      view?.setRefreshing(false);

      // Update status bar
      this.updateStatusBar(activeData);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      new Notice(`GitLab Inbox: ${message}`);
      view?.setRefreshing(false);
    } finally {
      this.refreshing = false;
    }
  }

  private async handleNoteModified(): Promise<void> {
    if (!this.lastData || this.suppressModifyHandler) return;

    const currentContent = await readExistingNote(this.app, this.settings);
    if (!currentContent) return;

    const newlyChecked = findNewlyCheckedItems(this.previousStates, currentContent);

    if (newlyChecked.length > 0) {
      // Mark GitLab todos as done for any checked todo items
      await this.markCheckedTodosAsDone(newlyChecked);

      // Log to daily note
      if (this.settings.enableDailyNoteLogging) {
        await logToDailyNote(this.app, this.settings, newlyChecked, this.lastData.items);
      }
    }

    // Always update previous states and sidebar (handles both check and uncheck)
    this.previousStates = parseExistingNote(currentContent);
    this.updateViewFromNote(currentContent);
  }

  private updateViewFromNote(noteContent: string): void {
    if (!this.lastData) return;
    const states = parseExistingNote(noteContent);
    const today = new Date().toISOString().split("T")[0];
    const activeItems = this.lastData.items.filter((item) => {
      const state = states.get(item.key);
      if (state?.checked) return false;
      if (state?.snoozedUntil && state.snoozedUntil > today) return false;
      return true;
    });
    const activeData: InboxData = { ...this.lastData, items: activeItems };
    const view = this.getView();
    view?.setData(activeData);
    this.updateStatusBar(activeData);
  }

  private async markCheckedTodosAsDone(checkedItems: CheckedState[]): Promise<void> {
    if (!this.lastData) return;
    const api = this.createApi();
    const KEY_PATTERN = /<!--\s*(glab:\S+)\s*-->/;

    for (const checked of checkedItems) {
      const keyMatch = checked.fullLine.match(KEY_PATTERN);
      if (!keyMatch) continue;
      const key = keyMatch[1];

      const item = this.lastData.items.find((i) => i.key === key);
      if (!item?.todoId) continue;

      try {
        await api.markTodoAsDone(item.todoId);
      } catch {
        // Don't block on API failures
      }
    }
  }

  private notifyNewItems(
    data: InboxData,
    existingStates: Map<string, CheckedState>
  ): void {
    const newItems = data.items.filter((item) => {
      const existing = existingStates.get(item.key);
      return !existing;
    });

    const highPriority = newItems.filter(
      (item) =>
        item.priorityId !== null ||
        item.category === Category.NeedsReview ||
        item.category === Category.Todos
    );

    for (const item of highPriority.slice(0, 3)) {
      new Notice(`GitLab: ${item.shortRef} - ${item.title}`, 8000);
    }

    if (highPriority.length > 3) {
      new Notice(`GitLab: +${highPriority.length - 3} more items need attention`, 5000);
    }
  }

  private updateStatusBar(data: InboxData): void {
    if (!this.statusBarEl) return;
    const unchecked = data.items.length;
    this.statusBarEl.textContent = unchecked > 0 ? `GL: ${unchecked}` : "GL: 0";
  }

  private getView(): InboxView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_INBOX);
    if (leaves.length > 0) {
      return leaves[0].view as InboxView;
    }
    return null;
  }

  async checkOffItem(item: InboxItem): Promise<void> {
    const content = await readExistingNote(this.app, this.settings);
    if (!content) return;

    const keyPattern = `<!-- ${item.key} -->`;
    const updated = content.replace(
      new RegExp(`^(\\s*- )\\[ \\](.+${keyPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*)$`, "m"),
      `$1[x]$2 done on ${window.moment().format("YYYY-MM-DD")}`
    );

    if (updated !== content) {
      this.suppressModifyHandler = true;
      await writeInboxNote(this.app, this.settings, updated);
      this.previousStates = parseExistingNote(updated);
      this.suppressModifyHandler = false;
    }
  }

  async snoozeItem(item: InboxItem, until: string): Promise<void> {
    const content = await readExistingNote(this.app, this.settings);
    if (!content) return;

    const keyPattern = `<!-- ${item.key} -->`;
    const updated = content.replace(
      new RegExp(`^(\\s*- \\[ \\].+${keyPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(.*)$`, "m"),
      `$1 \u23F3 ${until}$2`
    );

    if (updated !== content) {
      this.suppressModifyHandler = true;
      await writeInboxNote(this.app, this.settings, updated);
      this.previousStates = parseExistingNote(updated);
      this.suppressModifyHandler = false;
    }
  }

  async markTodoDone(item: InboxItem): Promise<void> {
    if (!item.todoId) return;
    try {
      const api = this.createApi();
      await api.markTodoAsDone(item.todoId);
      await this.checkOffItem(item);
      new Notice(`GitLab todo marked as done: ${item.shortRef}`);
    } catch {
      new Notice("Failed to mark GitLab todo as done");
    }
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_INBOX)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: VIEW_TYPE_INBOX,
          active: true,
        });
        leaf = rightLeaf;
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
      // If we have data, show it filtered by current note state
      const view = leaf.view as InboxView;
      if (this.lastData) {
        const content = await readExistingNote(this.app, this.settings);
        if (content) {
          const states = parseExistingNote(content);
          const today = new Date().toISOString().split("T")[0];
          const activeItems = this.lastData.items.filter((item) => {
            const state = states.get(item.key);
            if (state?.checked) return false;
            if (state?.snoozedUntil && state.snoozedUntil > today) return false;
            return true;
          });
          view.setData({ ...this.lastData, items: activeItems });
        } else {
          view.setData(this.lastData);
        }
      }
    }
  }
}
