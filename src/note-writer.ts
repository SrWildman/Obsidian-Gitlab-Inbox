import { App, normalizePath, TFile } from "obsidian";
import {
  Category,
  CheckedState,
  GitLabInboxSettings,
  InboxData,
  InboxItem,
  MergeReadiness,
  SectionConfig,
} from "./types";

const KEY_PATTERN = /<!--\s*(glab:\S+)\s*-->/;
const CHECKED_PATTERN = /^\s*- \[x\]/;
const SNOOZE_PATTERN = /\u23F3\s*(\d{4}-\d{2}-\d{2})/;

export function parseExistingNote(content: string): Map<string, CheckedState> {
  const states = new Map<string, CheckedState>();
  for (const line of content.split("\n")) {
    const keyMatch = line.match(KEY_PATTERN);
    if (!keyMatch) continue;

    const key = keyMatch[1];
    const checked = CHECKED_PATTERN.test(line);
    const snoozeMatch = line.match(SNOOZE_PATTERN);
    const snoozedUntil = snoozeMatch ? snoozeMatch[1] : null;

    states.set(key, { key, checked, fullLine: line, snoozedUntil });
  }
  return states;
}

function ageStr(days: number): string {
  if (days === 0) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

function formatItemLine(item: InboxItem): string {
  const parts: string[] = [];

  // Checkbox + linked reference
  parts.push(`- [ ] [${item.shortRef} - ${item.title}](${item.url})`);

  // Category-specific fields
  if (item.category === Category.YourMRs) {
    if (item.readiness === MergeReadiness.Ready) {
      parts.push(`[ready::merge]`);
    } else if (item.readiness === MergeReadiness.FixPipeline) {
      parts.push(`[ready::fix pipeline]`);
    } else if (item.readiness === MergeReadiness.ResolveConflicts) {
      parts.push(`[ready::resolve conflicts]`);
    } else if (item.approvedCount !== null && item.requiredApprovals !== null) {
      parts.push(`[approved::${item.approvedCount}/${item.requiredApprovals}]`);
    }
    if (item.pipelineStatus && item.pipelineStatus !== "none" && item.pipelineStatus !== "success") {
      parts.push(`[pipeline::${item.pipelineStatus}]`);
    }
  } else if (item.category === Category.Todos) {
    if (item.todoType) parts.push(`[type::${item.todoType}]`);
    if (item.todoFrom) parts.push(`[from::${item.todoFrom}]`);
  } else {
    parts.push(`[author::${item.author}]`);
  }

  // Common fields
  parts.push(`[age::${ageStr(item.ageDays)}]`);

  if (item.size) parts.push(`[size::${item.size}]`);

  if (item.threadsWaiting > 0) parts.push(`[threads_waiting::${item.threadsWaiting}]`);
  if (item.threadsPending > 0) parts.push(`[threads_pending::${item.threadsPending}]`);

  if (item.stale) parts.push(`[stale::${item.stale}]`);

  if (item.flags.length > 0) parts.push(`[flags::${item.flags.join(", ")}]`);

  if (item.priorityId) {
    parts.push(`[priority:: ${item.priorityId}]`);
  }

  // Reconciliation key
  parts.push(`<!-- ${item.key} -->`);

  return parts.join(" ");
}

function formatDescriptionLine(item: InboxItem): string | null {
  if (!item.description) return null;
  if (item.category === Category.Todos && item.todoBody) {
    return `  > ${item.todoBody}`;
  }
  return `  > ${item.description}`;
}

export function generateNote(
  data: InboxData,
  existingStates: Map<string, CheckedState>,
  sectionOrder: SectionConfig[]
): string {
  const today = new Date().toISOString().split("T")[0];
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const lines: string[] = [];

  // Frontmatter
  lines.push("---");
  lines.push("tags:");
  lines.push("  - index");
  lines.push(`updated: "${timeStr}"`);
  lines.push("---");
  lines.push("");

  // Group items by category
  const enabledSections = sectionOrder.filter((s) => s.enabled);
  const grouped = new Map<Category, InboxItem[]>();
  for (const section of enabledSections) {
    grouped.set(section.category, []);
  }
  for (const item of data.items) {
    grouped.get(item.category)?.push(item);
  }

  // Sort items within each category by age (oldest first)
  for (const items of grouped.values()) {
    items.sort((a, b) => b.ageDays - a.ageDays);
  }

  // Count unchecked items (respecting existing checked state and snooze)
  let uncheckedCount = 0;
  for (const item of data.items) {
    if (!enabledSections.some((s) => s.category === item.category)) continue;
    const existing = existingStates.get(item.key);
    if (existing?.checked) continue;
    if (existing?.snoozedUntil && existing.snoozedUntil > today) continue;
    uncheckedCount++;
  }

  // Summary
  lines.push(`**${uncheckedCount} items need attention** ^summary`);
  lines.push("");

  // Sections
  for (const section of enabledSections) {
    const items = grouped.get(section.category);
    if (!items || items.length === 0) continue;

    lines.push(`## ${section.label}`);
    lines.push("");

    for (const item of items) {
      const existing = existingStates.get(item.key);

      if (existing?.checked) {
        // Preserve the full checked line (including completion date from Tasks plugin)
        lines.push(existing.fullLine);
      } else if (existing?.snoozedUntil) {
        if (existing.snoozedUntil <= today) {
          // Snooze expired - show as unchecked without snooze date
          lines.push(formatItemLine(item));
        } else {
          // Still snoozed - preserve the snoozed line
          lines.push(existing.fullLine);
        }
      } else {
        lines.push(formatItemLine(item));
      }

      // Description preview (only for unchecked, non-snoozed items)
      if (!existing?.checked && !(existing?.snoozedUntil && existing.snoozedUntil > today)) {
        const desc = formatDescriptionLine(item);
        if (desc) lines.push(desc);
      }
    }

    lines.push("");
  }

  // Team review load
  if (data.teamLoad.length > 0) {
    lines.push("## Team Review Load");
    lines.push("");
    lines.push("| Reviewer | Open Reviews | Oldest |");
    lines.push("|----------|-------------|--------|");
    for (const member of data.teamLoad) {
      lines.push(
        `| ${member.displayName} | ${member.openReviews} | ${ageStr(member.oldestDays)} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function writeInboxNote(
  app: App,
  settings: GitLabInboxSettings,
  content: string
): Promise<void> {
  const filePath = normalizePath(settings.inboxFilename);
  const existingFile = app.vault.getFileByPath(filePath);

  if (existingFile) {
    await app.vault.process(existingFile, () => content);
  } else {
    await app.vault.create(filePath, content);
  }
}

export async function readExistingNote(
  app: App,
  settings: GitLabInboxSettings
): Promise<string | null> {
  const file = app.vault.getFileByPath(normalizePath(settings.inboxFilename));
  if (!file || !(file instanceof TFile)) return null;
  return app.vault.read(file);
}

export function findNewlyCheckedItems(
  previousStates: Map<string, CheckedState>,
  currentContent: string
): CheckedState[] {
  const currentStates = parseExistingNote(currentContent);
  const newlyChecked: CheckedState[] = [];

  for (const [key, current] of currentStates) {
    if (!current.checked) continue;
    const previous = previousStates.get(key);
    if (previous && !previous.checked) {
      newlyChecked.push(current);
    }
  }

  return newlyChecked;
}

export async function logToDailyNote(
  app: App,
  settings: GitLabInboxSettings,
  checkedItems: CheckedState[],
  items: InboxItem[]
): Promise<void> {
  if (!settings.enableDailyNoteLogging || checkedItems.length === 0) return;

  const today = window.moment().format(settings.dailyNoteDateFormat);
  const dailyPath = normalizePath(`${settings.dailyNotesFolder}/${today}.md`);
  const dailyFile = app.vault.getFileByPath(dailyPath);
  if (!dailyFile || !(dailyFile instanceof TFile)) return;

  // Build log lines
  const logLines: string[] = [];
  for (const checked of checkedItems) {
    const keyMatch = checked.fullLine.match(KEY_PATTERN);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    const item = items.find((i) => i.key === key);
    if (!item) continue;

    const action =
      item.category === Category.Todos
        ? "Addressed mention in"
        : item.category === Category.YourMRs
          ? "Merged"
          : "Reviewed";
    logLines.push(`- ${action} [[GitLab Inbox|${item.shortRef}]] - ${item.title}`);
  }

  if (logLines.length === 0) return;

  await app.vault.process(dailyFile, (content) => {
    // Find or create ### GitLab section under ## Notes
    const notesHeader = content.indexOf("## Notes");
    if (notesHeader === -1) return content;

    const gitlabHeader = "### GitLab";
    const gitlabIndex = content.indexOf(gitlabHeader, notesHeader);

    if (gitlabIndex !== -1) {
      // Find the end of the GitLab section (next ### or ## header)
      const afterGitlab = content.substring(gitlabIndex + gitlabHeader.length);
      const nextHeader = afterGitlab.search(/\n#{2,}/);
      const insertAt = nextHeader !== -1
        ? gitlabIndex + gitlabHeader.length + nextHeader
        : content.length;

      // Check for duplicates
      const existingSection = content.substring(gitlabIndex, insertAt);
      const newLines = logLines.filter((line) => !existingSection.includes(line));
      if (newLines.length === 0) return content;

      return content.substring(0, insertAt) +
        "\n" + newLines.join("\n") +
        content.substring(insertAt);
    } else {
      // Create new ### GitLab section after ## Notes
      const afterNotes = content.substring(notesHeader + "## Notes".length);
      const nextHeader = afterNotes.search(/\n## [^\n]/);
      const insertAt = nextHeader !== -1
        ? notesHeader + "## Notes".length + nextHeader
        : content.length;

      return content.substring(0, insertAt) +
        "\n\n" + gitlabHeader + "\n" + logLines.join("\n") +
        content.substring(insertAt);
    }
  });
}
