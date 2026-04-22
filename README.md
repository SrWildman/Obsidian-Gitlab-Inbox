# GitLab Inbox

Auto-refreshing Obsidian plugin that shows everything you need to address in GitLab - MRs to review, your open MRs, mentions, and todos. Runs in the background, writes a persistent checklist to your vault, and shows a sidebar panel with interactive UI.

## What it does

- Fetches your GitLab review queue, authored MRs, and pending todos on a configurable interval
- Writes a `GitLab Inbox.md` note to your vault with Tasks-plugin-compatible checkboxes
- Shows a sidebar panel with categorized items, clickable links, status badges, and action buttons
- Displays a status bar count (`GL: 8`) that you can click to open the sidebar
- Check items off as you handle them - they stay checked across refreshes
- Merged/closed MRs and resolved todos are automatically removed
- Stale todos (for merged MRs) are automatically cleaned up on each refresh
- Items show up in your Obsidian TODO.md alongside all your other tasks
- Desktop notifications when new review requests or mentions arrive
- Logs completed items to your daily note

## Categories

All categories are configurable - rename, reorder, or disable any section in settings.

| Default Label | What's in it |
|---------|-------------|
| Needs Your Review | MRs where you're a reviewer and haven't interacted yet |
| Re-Review | MRs you've commented on with new activity since |
| Approved | MRs you've already approved (for awareness) |
| Your MRs | Your open MRs with approval count, pipeline status, merge readiness |
| Mentions & Todos | Direct @mentions, issue mentions, approval requests |

## Features

### Sidebar Panel

The sidebar is the primary way to interact with your inbox. Each item shows:

- **Clickable MR reference** - opens in browser
- **Status badges** - size (S/M/L/XL), priority, merge readiness, threads, stale flags
- **Description preview** - first line of the MR description
- **Action buttons** (appear on hover):
  - **Done** - mark as done (updates the vault note with completion date, marks GitLab todo if applicable)
  - **Snooze** - defer until tomorrow (uses Tasks plugin scheduled date syntax)
- **Multi-select** - click Select to enter select mode, pick multiple items, then batch Done or Snooze

### Priority labels and rules

Items are auto-prioritized based on a configurable rules system. You define labels (e.g. Now, Next, Later) and rules that assign them. First matching rule wins.

Default rules:

| Condition | Label |
|-----------|-------|
| Review request older than 5 days | Now |
| Someone @mentions me | Now |
| My pipeline is failing | Now |
| Threads waiting for me >= 2 | Now |
| Review request older than 2 days | Next |
| My MR has no reviewer activity for 3 days | Next |
| MR is a draft | Later |

Labels, rules, conditions, and thresholds are all configurable in settings. Items matching no rule get no badge.

### Thread Tracking

For each MR, the plugin tracks:
- `threads_waiting` - unresolved threads where the last comment is NOT from you (you need to reply)
- `threads_pending` - unresolved threads where the last comment IS from you (waiting on them)

### Merge Readiness

Your MRs show a readiness signal:
- `[ready::merge]` - all approvals met, pipeline green, no conflicts
- `[ready::fix pipeline]` - approved but pipeline failing
- `[ready::resolve conflicts]` - approved but has merge conflicts
- `[approved::1/2]` - still needs more approvals

### Stale MR nudges

- Review requests older than the highest ReviewOlderThan rule threshold get a stale badge
- Your MRs with no reviewer activity past the MRNoReviewerActivity threshold get a "nudge reviewers" badge
- Your MRs with a failing pipeline get a "pipeline failing" badge

### Diff Size

MRs show a size tag based on changes count:
- **S** (1-50 changes) - quick review
- **M** (51-200) - moderate
- **L** (201-500) - block time
- **XL** (500+) - significant effort

### Team Review Load

A summary table at the bottom shows how review requests are distributed across your team. Helps spot who's overloaded and needs help.

### Snooze

Defer items using the Tasks plugin scheduled date syntax:
```
- [ ] [mcp-rdx!11 - Fix issues](https://...) [author::Nelson] ⏳ 2026-04-17 <!-- glab:mr:9647:11 -->
```
The item is suppressed from the count until the scheduled date, then reappears as unchecked. You can snooze from the sidebar (defers until tomorrow) or manually edit the date in the note for a specific day.

### Daily Note Logging

When you check off an item, it's automatically logged in today's daily note under a `### GitLab` section:
```markdown
### GitLab
- Reviewed [[GitLab Inbox|mcp-rdx!11]] - Fix Deployment issues
- Addressed mention in [[GitLab Inbox|create-api!185]] - Add search filters
```

### Auto Stale Todo Cleanup

Every refresh, the plugin automatically marks stale GitLab todos as done (todos for MRs that have been merged or closed). This prevents your GitLab todo list from growing unbounded.

## Prerequisites

- Obsidian desktop (macOS, Windows, or Linux)
- A self-hosted GitLab instance (or gitlab.com)
- A GitLab Personal Access Token with `api` scope
- Obsidian Tasks plugin (recommended, for checkbox integration with TODO.md)

## Setup

1. Copy `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/gitlab-inbox/`
2. Enable the plugin in Obsidian Settings > Community Plugins
3. Go to Settings > GitLab Inbox and configure:
   - **GitLab hostname** - your instance (e.g. `gitlab.company.com`)
   - **Personal access token** - create one at GitLab > Settings > Access Tokens with `api` scope
4. Click "Test connection" to verify
5. The plugin will auto-refresh on the configured interval

## Creating a Personal Access Token

1. Go to your GitLab instance > User Settings > Access Tokens
2. Name: `obsidian-inbox` (or whatever you like)
3. Expiration: set a reasonable date (you'll need to rotate it when it expires)
4. Scopes: check **api** (required for reading MRs, todos, notes, approvals)
5. Click "Create personal access token"
6. Copy the token immediately (you won't see it again) and paste it into the plugin settings

The token is stored locally in `.obsidian/plugins/gitlab-inbox/data.json`. It never leaves your machine except to authenticate with your GitLab instance. If you sync your vault via git, add `data.json` to `.gitignore` in your `.obsidian/plugins/gitlab-inbox/` directory.

## Network usage

This plugin connects to your configured GitLab instance (self-hosted or gitlab.com) via authenticated HTTPS requests to the GitLab REST API. It fetches merge requests, todos, approvals, and discussions. Your personal access token is sent as a `PRIVATE-TOKEN` header and is stored locally in your vault's plugin data. No telemetry or analytics data is collected.

## Configuration

### Connection

| Setting | Description | Default |
|---------|-------------|---------|
| GitLab hostname | Your GitLab instance hostname | (empty) |
| Personal access token | Token with `api` scope | (empty) |

### Refresh

| Setting | Description | Default |
|---------|-------------|---------|
| Refresh interval | How often to fetch new data (minutes) | 15 |

### Vault Integration

| Setting | Description | Default |
|---------|-------------|---------|
| Inbox filename | Name of the vault note | GitLab Inbox.md |
| Desktop notifications | Notify on new high-priority items | On |
| Daily note logging | Log checked-off items to daily note | On |
| Daily notes folder | Where your daily notes live | Daily |
| Daily note date format | Moment.js format for filenames | YYYY-MM-DD |

### Sections

Each section (Needs Your Review, Re-Review, Approved, Your MRs, Mentions & Todos) can be:
- **Renamed** - change the display label
- **Reordered** - move up/down to change display order
- **Disabled** - hide from both the sidebar and the vault note

### Labels

Define priority labels with a name and CSS color. Default labels: Now (red), Next (orange), Later (faint).

### Rules

Rules assign labels to items based on conditions. First match wins - order matters. Available conditions:

| Condition | Needs value | Description |
|-----------|-------------|-------------|
| Review request is older than | days | Matches review MRs by age |
| Someone @mentions me | - | Matches all todo items |
| My pipeline is failing | - | Matches your MRs with failed pipeline |
| Threads waiting for me >= | count | Matches items by unresolved thread count |
| My MR has no reviewer activity for | days | Matches your MRs with stale reviewers |
| MR is a draft | - | Matches draft MRs |

## Vault note format

The plugin writes `GitLab Inbox.md` with:
- Tasks-plugin-compatible checkboxes (`- [ ]` / `- [x]`)
- Dataview inline fields (`[author::Nelson]`, `[size::M]`, `[priority:: now]`, `[threads_waiting::2]`)
- Clickable markdown links to each MR/issue
- HTML comment reconciliation keys (invisible in reading view)
- A `^summary` block reference embeddable in Home.md

### Home.md Embed

Add this to your Home.md to see the summary count:
```markdown
## GitLab Inbox
![[GitLab Inbox#^summary]]
```

### TODO.md Integration

Inbox items automatically appear in any Tasks plugin query that picks up unchecked tasks. No configuration needed - the checkboxes use standard Tasks syntax including priority levels.

## How Check-off Works

1. Check an item in `GitLab Inbox.md`, via TODO.md, or click the check button in the sidebar
2. The Tasks plugin adds a completion date automatically
3. On the next refresh:
   - Checked items for still-active MRs stay checked (you've acknowledged them)
   - Checked items for merged/closed MRs are removed entirely (resolved)
4. Checked-off items are logged to today's daily note under `### GitLab`

## Commands

| Command | Description |
|---------|-------------|
| Open GitLab Inbox | Opens the sidebar panel |
| Refresh GitLab Inbox | Manually triggers a refresh |

Both are available from the command palette (`Cmd+P`).

## Development

```bash
git clone <repo-url>
cd obsidian-gitlab-inbox
npm install
npm run dev    # watch mode with sourcemaps
npm run build  # production build (tsc check + minified)
```

After building, copy to your vault:
```bash
cp main.js manifest.json styles.css ~/path/to/vault/.obsidian/plugins/gitlab-inbox/
```

Then reload the plugin in Obsidian (disable/re-enable or restart).

## License

MIT
