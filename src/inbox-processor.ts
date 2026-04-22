import { GitLabApi } from "./gitlab-api";
import {
  Category,
  ConditionType,
  DiffSize,
  GitLabDiscussion,
  GitLabMR,
  GitLabTodo,
  GitLabInboxSettings,
  InboxData,
  InboxItem,
  MergeReadiness,
  PriorityRule,
  TeamMemberLoad,
} from "./types";

export function daysAgo(dateStr: string): number {
  const dt = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - dt.getTime()) / (1000 * 60 * 60 * 24));
}

export function diffSize(changesCount: string | null): DiffSize | null {
  if (!changesCount) return null;
  const count = parseInt(changesCount, 10);
  if (isNaN(count)) return null;
  if (count <= 50) return DiffSize.S;
  if (count <= 200) return DiffSize.M;
  if (count <= 500) return DiffSize.L;
  return DiffSize.XL;
}

function shortProject(webUrl: string): string {
  const segments = webUrl.split("/-/")[0].split("/");
  return segments[segments.length - 1] ?? "?";
}

const TEMPLATE_HEADERS = /^(description|summary|overview|what|why|changes|context|details|background)\b:?\s*/i;

function previewDescription(description: string | null): string {
  if (!description) return "";
  const stripped = description
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]*)\]\(.*?\)/g, "$1")
    .replace(/[#*_~`>]/g, "")
    .replace(/\n+/g, " ")
    .replace(TEMPLATE_HEADERS, "")
    .trim();
  if (!stripped) return "";

  const firstSentence = stripped.match(/^[^.!?]*[.!?]/);
  const text = firstSentence ? firstSentence[0] : stripped;
  return text.length > 120 ? text.substring(0, 117) + "..." : text;
}

function analyzeThreads(
  discussions: GitLabDiscussion[],
  username: string
): { waiting: number; pending: number } {
  let waiting = 0;
  let pending = 0;

  for (const discussion of discussions) {
    const resolvableNotes = discussion.notes.filter(
      (n) => n.resolvable && !n.resolved && !n.system
    );
    if (resolvableNotes.length === 0) continue;

    const sorted = resolvableNotes.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const lastNote = sorted[sorted.length - 1];
    if (lastNote.author.username === username) {
      pending++;
    } else {
      waiting++;
    }
  }

  return { waiting, pending };
}

interface ItemContext {
  category: Category;
  ageDays: number;
  threadsWaiting: number;
  isDraft: boolean;
  pipelineStatus: string | null;
  daysSinceReviewerActivity: number | null;
  isTodo: boolean;
}

function evaluateRule(rule: PriorityRule, ctx: ItemContext): boolean {
  switch (rule.condition) {
    case ConditionType.ReviewOlderThan:
      return (ctx.category === Category.NeedsReview || ctx.category === Category.ReReview)
        && rule.value !== null && ctx.ageDays >= rule.value;
    case ConditionType.MentionedOrTodo:
      return ctx.isTodo;
    case ConditionType.PipelineFailing:
      return ctx.category === Category.YourMRs && ctx.pipelineStatus === "failed";
    case ConditionType.ThreadsWaiting:
      return rule.value !== null && ctx.threadsWaiting >= rule.value;
    case ConditionType.MRNoReviewerActivity:
      return ctx.category === Category.YourMRs
        && ctx.daysSinceReviewerActivity !== null
        && rule.value !== null
        && ctx.daysSinceReviewerActivity >= rule.value;
    case ConditionType.DraftMR:
      return ctx.isDraft;
  }
}

function computePriority(rules: PriorityRule[], ctx: ItemContext): string | null {
  for (const rule of rules) {
    if (evaluateRule(rule, ctx)) {
      return rule.labelId;
    }
  }
  return null;
}

function computeReadiness(
  approvedCount: number,
  requiredApprovals: number,
  pipelineStatus: string | null,
  hasConflicts: boolean
): MergeReadiness {
  if (approvedCount < requiredApprovals) return MergeReadiness.NeedsApproval;
  if (hasConflicts) return MergeReadiness.ResolveConflicts;
  if (pipelineStatus && pipelineStatus !== "success" && pipelineStatus !== "none") return MergeReadiness.FixPipeline;
  return MergeReadiness.Ready;
}

export async function fetchInboxData(api: GitLabApi, settings: GitLabInboxSettings): Promise<InboxData> {
  const rules = settings.rules;
  const username = await api.getUsername();

  const [reviewerMRs, authoredMRs, todos] = await Promise.all([
    api.getReviewerMRs(username),
    api.getAuthoredMRs(username),
    api.getTodos(),
  ]);

  const items: InboxItem[] = [];
  const teamUsernames = new Set<string>();

  // Build lookup map: review_requested todos keyed by "project_id:iid"
  const reviewTodoMap = new Map<string, number>();
  for (const todo of todos) {
    if (todo.action_name === "review_requested") {
      reviewTodoMap.set(`${todo.target.project_id}:${todo.target.iid}`, todo.id);
    }
  }

  // Process reviewer MRs
  await processReviewerMRs(api, reviewerMRs, username, items, teamUsernames, rules, reviewTodoMap);

  // Process authored MRs
  await processAuthoredMRs(api, authoredMRs, username, items, teamUsernames, rules);

  // Process todos (exclude review_requested - already covered by reviewer MRs)
  processTodos(todos, items, rules);

  // Auto-cleanup stale todos (target merged/closed) in the background
  cleanupStaleTodos(api, todos);

  // Fetch team review load
  const teamLoad = await fetchTeamLoad(api, teamUsernames);

  return { items, teamLoad, fetchedAt: new Date() };
}

async function processReviewerMRs(
  api: GitLabApi,
  mrs: GitLabMR[],
  username: string,
  items: InboxItem[],
  teamUsernames: Set<string>,
  rules: PriorityRule[],
  reviewTodoMap: Map<string, number>
): Promise<void> {
  for (const mr of mrs) {
    const [approvals, notes, discussions] = await Promise.all([
      api.getApprovals(mr.project_id, mr.iid),
      api.getNotes(mr.project_id, mr.iid),
      api.getDiscussions(mr.project_id, mr.iid),
    ]);

    // Collect other reviewers for team load
    for (const reviewer of mr.reviewers) {
      if (reviewer.username !== username) {
        teamUsernames.add(reviewer.username);
      }
    }

    const myNotes = notes.filter(
      (n) => n.author.username === username && !n.system
    );
    const approvedByMe = approvals.approved_by.some(
      (a) => a.user.username === username
    );

    // Categorize
    let category: Category;
    if (approvedByMe) {
      category = Category.Approved;
    } else if (myNotes.length > 0) {
      const myLast = myNotes
        .map((n) => new Date(n.created_at).getTime())
        .reduce((a, b) => Math.max(a, b), 0);
      const newerFromOthers = notes.some(
        (n) =>
          !n.system &&
          n.author.username !== username &&
          new Date(n.created_at).getTime() > myLast
      );

      if (newerFromOthers) {
        category = Category.ReReview;
      } else {
        // Waiting on author - skip from inbox
        continue;
      }
    } else {
      category = Category.NeedsReview;
    }

    const ageDays = daysAgo(mr.created_at);
    const threads = analyzeThreads(discussions, username);

    const flags: string[] = [];
    if (mr.draft) flags.push("DRAFT");
    if (mr.has_conflicts) flags.push("CONFLICTS");
    const pipeline = mr.head_pipeline?.status ?? "none";
    if (pipeline !== "none" && pipeline !== "success") {
      flags.push(`pipeline:${pipeline}`);
    }

    const ctx: ItemContext = {
      category,
      ageDays,
      threadsWaiting: threads.waiting,
      isDraft: mr.draft,
      pipelineStatus: pipeline,
      daysSinceReviewerActivity: null,
      isTodo: false,
    };

    // Stale display only when age exceeds the highest ReviewOlderThan threshold
    const maxReviewThreshold = rules
      .filter((r) => r.condition === ConditionType.ReviewOlderThan && r.value !== null)
      .reduce((max, r) => Math.max(max, r.value!), 0);
    const isStale = maxReviewThreshold > 0
      && ageDays >= maxReviewThreshold
      && (category === Category.NeedsReview || category === Category.ReReview);
    const stale = isStale ? `${ageDays}d no response` : null;

    items.push({
      key: `glab:mr:${mr.project_id}:${mr.iid}`,
      category,
      title: mr.title,
      url: mr.web_url,
      shortRef: `${shortProject(mr.web_url)}!${mr.iid}`,
      author: formatName(mr.author.username),
      ageDays,
      priorityId: computePriority(rules, ctx),
      size: diffSize(mr.changes_count),
      description: previewDescription(mr.description),
      threadsWaiting: threads.waiting,
      threadsPending: threads.pending,
      stale,
      flags,
      approvedCount: null,
      requiredApprovals: null,
      pipelineStatus: null,
      readiness: null,
      reviewers: [],
      todoId: reviewTodoMap.get(`${mr.project_id}:${mr.iid}`) ?? null,
      todoType: null,
      todoFrom: null,
      todoBody: null,
    });
  }
}

async function processAuthoredMRs(
  api: GitLabApi,
  mrs: GitLabMR[],
  username: string,
  items: InboxItem[],
  teamUsernames: Set<string>,
  rules: PriorityRule[]
): Promise<void> {
  for (const mr of mrs) {
    const [approvals, notes, discussions] = await Promise.all([
      api.getApprovals(mr.project_id, mr.iid),
      api.getNotes(mr.project_id, mr.iid),
      api.getDiscussions(mr.project_id, mr.iid),
    ]);

    // Collect reviewers for team load
    for (const reviewer of mr.reviewers) {
      teamUsernames.add(reviewer.username);
    }

    const approvedCount = approvals.approved_by.length;
    const requiredApprovals = approvals.approvals_required ?? 0;
    const pipeline = mr.head_pipeline?.status ?? "none";
    const ageDays = daysAgo(mr.created_at);
    const threads = analyzeThreads(discussions, username);

    // Check for stale reviewer activity
    const reviewerNotes = notes.filter(
      (n) => n.author.username !== username && !n.system
    );
    const latestReviewerNote = reviewerNotes
      .map((n) => new Date(n.created_at).getTime())
      .reduce((a, b) => Math.max(a, b), 0);
    const daysSinceReviewerActivity = latestReviewerNote
      ? Math.floor((Date.now() - latestReviewerNote) / (1000 * 60 * 60 * 24))
      : ageDays;

    // Build stale display string
    const staleparts: string[] = [];
    if (mr.reviewers.length > 0) {
      // Check if any MRNoReviewerActivity rule would match
      const noActivityMatch = rules.some(
        (r) => r.condition === ConditionType.MRNoReviewerActivity
          && r.value !== null && daysSinceReviewerActivity >= r.value
      );
      if (noActivityMatch) staleparts.push("nudge reviewers");
    }
    if (pipeline === "failed") staleparts.push("pipeline failing");
    const stale = staleparts.length > 0 ? staleparts.join(", ") : null;

    const readiness = computeReadiness(
      approvedCount,
      requiredApprovals,
      pipeline,
      mr.has_conflicts
    );

    const flags: string[] = [];
    if (mr.draft) flags.push("DRAFT");
    if (mr.has_conflicts) flags.push("CONFLICTS");

    const ctx: ItemContext = {
      category: Category.YourMRs,
      ageDays,
      threadsWaiting: threads.waiting,
      isDraft: mr.draft,
      pipelineStatus: pipeline,
      daysSinceReviewerActivity,
      isTodo: false,
    };

    items.push({
      key: `glab:mr:author:${mr.project_id}:${mr.iid}`,
      category: Category.YourMRs,
      title: mr.title,
      url: mr.web_url,
      shortRef: `${shortProject(mr.web_url)}!${mr.iid}`,
      author: formatName(mr.author.username),
      ageDays,
      priorityId: computePriority(rules, ctx),
      size: diffSize(mr.changes_count),
      description: previewDescription(mr.description),
      threadsWaiting: threads.waiting,
      threadsPending: threads.pending,
      stale,
      flags,
      approvedCount,
      requiredApprovals,
      pipelineStatus: pipeline,
      readiness,
      reviewers: mr.reviewers.map((r) => formatName(r.username)),
      todoId: null,
      todoType: null,
      todoFrom: null,
      todoBody: null,
    });
  }
}

function processTodos(todos: GitLabTodo[], items: InboxItem[], rules: PriorityRule[]): void {
  // Build set of MR keys already in items to avoid duplicates
  const existingMRKeys = new Set(
    items.filter((i) => i.key.startsWith("glab:mr:")).map((i) => {
      const parts = i.key.split(":");
      return `${parts[parts.length - 2]}:${parts[parts.length - 1]}`;
    })
  );

  for (const todo of todos) {
    // Skip review_requested - already covered by reviewer MRs
    if (todo.action_name === "review_requested") continue;
    // Skip todos for resolved targets
    if (todo.target.state !== "opened") continue;
    // Skip todos for MRs already shown in reviewer/authored sections
    if (todo.target_type === "MergeRequest" && existingMRKeys.has(`${todo.target.project_id}:${todo.target.iid}`)) continue;

    const isIssue = todo.target_type === "Issue";
    const shortRef = isIssue
      ? `Issue #${todo.target.iid}`
      : `${shortProject(todo.target.web_url)}!${todo.target.iid}`;

    const bodyPreview = todo.body
      ? todo.body.substring(0, 100) + (todo.body.length > 100 ? "..." : "")
      : null;

    items.push({
      key: `glab:todo:${todo.id}`,
      category: Category.Todos,
      title: todo.target.title,
      url: todo.target_url,
      shortRef,
      author: "",
      ageDays: daysAgo(todo.created_at),
      priorityId: computePriority(rules, {
        category: Category.Todos,
        ageDays: daysAgo(todo.created_at),
        threadsWaiting: 0,
        isDraft: false,
        pipelineStatus: null,
        daysSinceReviewerActivity: null,
        isTodo: true,
      }),
      size: null,
      description: "",
      threadsWaiting: 0,
      threadsPending: 0,
      stale: null,
      flags: [],
      approvedCount: null,
      requiredApprovals: null,
      pipelineStatus: null,
      readiness: null,
      reviewers: [],
      todoId: todo.id,
      todoType: formatTodoAction(todo.action_name),
      todoFrom: formatName(todo.author.username),
      todoBody: bodyPreview,
    });
  }
}

async function fetchTeamLoad(
  api: GitLabApi,
  teamUsernames: Set<string>
): Promise<TeamMemberLoad[]> {
  const loads: TeamMemberLoad[] = [];

  const promises = Array.from(teamUsernames).map(async (username) => {
    try {
      const result = await api.getReviewerMRCount(username);
      if (result.total > 0) {
        loads.push({
          username,
          displayName: formatName(username),
          openReviews: result.total,
          oldestDays: result.oldestCreatedAt ? daysAgo(result.oldestCreatedAt) : 0,
        });
      }
    } catch {
      // Skip team members whose data we can't fetch
    }
  });

  await Promise.all(promises);
  return loads.sort((a, b) => b.openReviews - a.openReviews);
}

function cleanupStaleTodos(api: GitLabApi, todos: GitLabTodo[]): void {
  const stale = todos.filter((t) => t.target.state !== "opened");
  if (stale.length === 0) return;

  void Promise.all(
    stale.map((t) => api.markTodoAsDone(t.id).catch(() => {}))
  );
}

const TODO_ACTION_LABELS: Record<string, string> = {
  directly_addressed: "mentioned you",
  mentioned: "mentioned you",
  assigned: "assigned to you",
  approval_required: "approval needed",
  build_failed: "pipeline failed",
  marked: "marked",
  unmergeable: "unmergeable",
};

function formatTodoAction(action: string): string {
  return TODO_ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

function formatName(username: string): string {
  if (username.includes(".")) {
    return username.split(".").pop() ?? username;
  }
  return username;
}
