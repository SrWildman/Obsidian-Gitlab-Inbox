// Enums

export enum Category {
  NeedsReview = "Needs Your Review",
  ReReview = "Re-Review",
  Approved = "Approved",
  YourMRs = "Your MRs",
  Todos = "Mentions & Todos",
}

export enum ConditionType {
  ReviewOlderThan = "review_older_than",
  MentionedOrTodo = "mentioned_or_todo",
  PipelineFailing = "pipeline_failing",
  ThreadsWaiting = "threads_waiting",
  MRNoReviewerActivity = "mr_no_reviewer_activity",
  DraftMR = "draft_mr",
}

export const CONDITION_LABELS: Record<ConditionType, string> = {
  [ConditionType.ReviewOlderThan]: "Review request is older than",
  [ConditionType.MentionedOrTodo]: "Someone @mentions me",
  [ConditionType.PipelineFailing]: "My pipeline is failing",
  [ConditionType.ThreadsWaiting]: "Threads waiting for me >=",
  [ConditionType.MRNoReviewerActivity]: "My MR has no reviewer activity for",
  [ConditionType.DraftMR]: "MR is a draft",
};

export const CONDITION_UNITS: Partial<Record<ConditionType, string>> = {
  [ConditionType.ReviewOlderThan]: "days",
  [ConditionType.ThreadsWaiting]: "threads",
  [ConditionType.MRNoReviewerActivity]: "days",
};

export enum DiffSize {
  S = "S",
  M = "M",
  L = "L",
  XL = "XL",
}

export enum MergeReadiness {
  Ready = "merge",
  FixPipeline = "fix pipeline",
  ResolveConflicts = "resolve conflicts",
  NeedsApproval = "needs approval",
}

// Settings

export interface SectionConfig {
  category: Category;
  label: string;
  enabled: boolean;
}

export interface PriorityLabel {
  id: string;
  label: string;
  color: string;
}

export interface PriorityRule {
  condition: ConditionType;
  value: number | null;
  labelId: string;
}

export interface GitLabInboxSettings {
  gitlabHostname: string;
  personalAccessToken: string;
  refreshIntervalMinutes: number;
  inboxFilename: string;
  enableNotifications: boolean;
  enableDailyNoteLogging: boolean;
  dailyNotesFolder: string;
  dailyNoteDateFormat: string;
  sectionOrder: SectionConfig[];
  labels: PriorityLabel[];
  rules: PriorityRule[];
}

export const DEFAULT_SECTION_ORDER: SectionConfig[] = [
  { category: Category.NeedsReview, label: "Needs Your Review", enabled: true },
  { category: Category.ReReview, label: "Re-Review", enabled: true },
  { category: Category.Approved, label: "Approved", enabled: true },
  { category: Category.YourMRs, label: "Your MRs", enabled: true },
  { category: Category.Todos, label: "Mentions & Todos", enabled: true },
];

export const DEFAULT_LABELS: PriorityLabel[] = [
  { id: "now", label: "Now", color: "var(--color-red)" },
  { id: "next", label: "Next", color: "var(--color-orange)" },
  { id: "later", label: "Later", color: "var(--text-faint)" },
];

export const DEFAULT_RULES: PriorityRule[] = [
  { condition: ConditionType.ReviewOlderThan, value: 5, labelId: "now" },
  { condition: ConditionType.MentionedOrTodo, value: null, labelId: "now" },
  { condition: ConditionType.PipelineFailing, value: null, labelId: "now" },
  { condition: ConditionType.ThreadsWaiting, value: 2, labelId: "now" },
  { condition: ConditionType.ReviewOlderThan, value: 2, labelId: "next" },
  { condition: ConditionType.MRNoReviewerActivity, value: 3, labelId: "next" },
  { condition: ConditionType.DraftMR, value: null, labelId: "later" },
];

export const DEFAULT_SETTINGS: GitLabInboxSettings = {
  gitlabHostname: "",
  personalAccessToken: "",
  refreshIntervalMinutes: 15,
  inboxFilename: "GitLab Inbox.md",
  enableNotifications: true,
  enableDailyNoteLogging: true,
  dailyNotesFolder: "Daily",
  dailyNoteDateFormat: "YYYY-MM-DD",
  sectionOrder: DEFAULT_SECTION_ORDER,
  labels: DEFAULT_LABELS,
  rules: DEFAULT_RULES,
};

// Domain models

export interface InboxItem {
  key: string;
  category: Category;
  title: string;
  url: string;
  shortRef: string;
  author: string;
  ageDays: number;
  priorityId: string | null;
  size: DiffSize | null;
  description: string;
  threadsWaiting: number;
  threadsPending: number;
  stale: string | null;
  flags: string[];
  approvedCount: number | null;
  requiredApprovals: number | null;
  pipelineStatus: string | null;
  readiness: MergeReadiness | null;
  reviewers: string[];
  todoId: number | null;
  todoType: string | null;
  todoFrom: string | null;
  todoBody: string | null;
}

export interface CheckedState {
  key: string;
  checked: boolean;
  fullLine: string;
  snoozedUntil: string | null;
}

export interface TeamMemberLoad {
  username: string;
  displayName: string;
  openReviews: number;
  oldestDays: number;
}

export interface InboxData {
  items: InboxItem[];
  teamLoad: TeamMemberLoad[];
  fetchedAt: Date;
}

// GitLab API response types

export interface GitLabMR {
  id: number;
  iid: number;
  title: string;
  description: string;
  state: string;
  draft: boolean;
  web_url: string;
  created_at: string;
  updated_at: string;
  has_conflicts: boolean;
  changes_count: string;
  project_id: number;
  author: GitLabUser;
  reviewers: GitLabUser[];
  head_pipeline: { status: string } | null;
  user_notes_count: number;
  merge_status: string;
  detailed_merge_status: string;
}

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
}

export interface GitLabNote {
  id: number;
  body: string;
  author: GitLabUser;
  created_at: string;
  system: boolean;
  resolvable: boolean;
  resolved: boolean;
}

export interface GitLabApproval {
  approved: boolean;
  approvals_required: number;
  approvals_left: number;
  approved_by: { user: GitLabUser }[];
}

export interface GitLabTodo {
  id: number;
  action_name: string;
  target_type: string;
  target_url: string;
  target: {
    iid: number;
    title: string;
    state: string;
    project_id: number;
    web_url: string;
  };
  body: string;
  state: string;
  created_at: string;
  author: GitLabUser;
  project: {
    id: number;
    path_with_namespace: string;
  };
}

export interface GitLabDiscussion {
  id: string;
  notes: GitLabNote[];
}
