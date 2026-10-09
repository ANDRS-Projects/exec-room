# Exec Room — Security Policy

This file documents the security model of Exec Room.

---

## Overview

The web room runs Coen (the room lead) and the advisors and makers the owner builds in the room as Claude Code agents, in a local web room (`room-server.js`, Express) that drives headless `claude -p` runs. The room can carry out a small set of actions, but only after the owner approves each one.

---

## Stack & Attack Surface

| Component | Runtime | Exposure |
|-----------|---------|----------|
| Web room (`room-server.js`) | Node.js + Express | `127.0.0.1:4179` only |
| Room page (`public/`) | Static HTML/CSS/JS, vendored `marked` + `DOMPurify` | Served by the room |
| Agents | Headless Claude Code on the owner's plan | Local processes |
| Approved actions | `gh` CLI, Notion API | GitHub (the repos each room lists in Room settings; private unless the room marks one as public), Notion (the databases listed in `room.config.json`, and the pages each room allows) |

npm dependencies: `express`, `marked`, `dompurify` (the last two vendored into `public/vendor/`, so nothing loads from a CDN).

---

## Policy

### 1. No credentials in source files

No keys or tokens are committed. The room never uses an Anthropic API key: it strips `ANTHROPIC_API_KEY` from the environment so agents bill the owner's Claude plan. The Notion token is read once at start-up (from `ROOM_NOTION_TOKEN`, or from a 1Password reference via `op read`) and kept in memory only. `gh` uses the CLI's own login.

CI enforces this: `.github/workflows/gitleaks.yml` scans the full git history for secrets on every push and PR.

### 2. The room is local-only

The server binds to `127.0.0.1`, rejects requests whose `Host` or `Origin` isn't the room itself (DNS rebinding, cross-site requests), accepts only JSON for `POST`, and sends a strict Content-Security-Policy (`default-src 'self'`, no inline scripts). Agent output is rendered as Markdown through DOMPurify.

### 3. Agents are allowlisted, not trusted

Headless runs use `--setting-sources project`, so the owner's personal pre-approved permissions don't apply. Project settings do load, from the folder the room was cloned into: a `.claude/settings.json` there with allow rules, or an organisation's managed settings, widens what agents can call; the repo ships none, and agents can't write one (writes under any `.claude` folder are blocked on every run, see the next paragraph). Agents get read-only tools, Notion read-only, `WebFetch` only to the sites each room allows (none by default), and `Write`/`Edit` under `drafts/` only. Anything not allowed is refused, since a headless run can't ask. The `hiddenConnectors` setting only keeps claude.ai connectors out of the agents' view; it doesn't cover MCP servers the owner has set up locally.

Writes are also blocked by name on every run: nothing under a `.claude` folder and no `CLAUDE.md`, anywhere on disk. The allow rules alone weren't enough: Claude Code lets a run edit `.claude/launch.json` in the folder it starts in without any rule, and that file tells the Claude desktop app which command to start for a preview. Checked live on 2026-10-01 with the room's own flags: without the block that edit went through (and a `drafts/CLAUDE.md` could be written, which Claude Code may load as instructions for later runs); with the block both are refused, while a normal draft is still written.

The room reads the owner's `~/.claude/agents` folder only when the owner imports an agent: the server lists the agent files there (`<name>.md` or `<name>/AGENT.md`, up to 200 KB, with frontmatter) and copies the chosen one's name, description, model and instructions into the build form. The name in the request must be a plain file name (no path parts). The copy is saved like any room-built agent, with the role and tools chosen in the room; a `tools:` line in the file is never read, and later edits to the file don't change the copy. The room never writes to that folder and never runs an agent straight from it.

Every run also passes `--permission-mode default` and blocks, whatever folders its room may read: the room's own `data/` folder (every room's transcripts, `workspaces.json`, the job log, room-built agents); `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config`, `~/.docker`, `~/.kube` and `~/Library`, plus the real targets of symlinks inside them; and everything in `~/.claude` except the agents' instruction folders (`agents`, `skills`, `knowledge`), again including the real targets of its symlinks (e.g. `~/.claude/projects`, every Claude Code session transcript, linked into a synced folder under `~/Dev`). Those folders can't be added as room folders either, by the path as typed or by its real path. The instruction folders are always readable, so agents can use their skills and knowledge in any room. Checked live on 2026-09-29: before the fix an agent in a room with no folders could read, grep and list `data/`; after it, all three are refused.

Every run also blocks secret-looking files anywhere on disk, whatever folders its room reads: `.env` and `.env.*`, direnv's `.envrc`, `.dev.vars` and `.dev.vars.*`, `*.pem`, `*.key`, `*.p12`/`*.pfx`, `id_rsa*`/`id_ed25519*`/`id_ecdsa*`, `.npmrc`, `.netrc`, `.pypirc`, `.git-credentials`, `credentials.json`, Terraform's `*.tfvars`, `*.tfvars.json` and `*.tfstate*`, and every `.git` folder (agents have no git; `.git` holds remote URLs that can carry tokens, and every old commit). Checked live on 2026-09-29 with fake files: all refused, also under upper-case names (`.ENV`, `SERVER.PEM`, `.GIT/config`), and a Grep over the folder skips them (the patterns added on 2026-09-30 were checked live the same way on 2026-09-30). Every install starts with an empty default room, and a room stored without settings gets none: no install keeps wider access from older code. A rooms file (`data/workspaces.json`) that can't be used is moved aside as `workspaces.json.broken-<time>` and logged with a fixed reason, and the room starts with an empty default room; a start that finds such a file and no rooms file (e.g. after a crash between the two steps) does the same. If the file can't be moved aside, the room doesn't start. At start-up the server re-checks every room's stored folders the same way and logs any sensitive one (terminal and job log); it changes nothing, since the blocks already keep such a folder unreadable. Folder entries that aren't text (only possible by editing the rooms file by hand) are dropped when rooms load, logged and saved.

Agents never get Bash or the `gh` token. When the owner's message links GitHub issues (at most 3) in the room's own repos, the server reads them with `gh issue view` (fixed arguments, 15s timeout, capped at 20 comments and ~30 KB per issue) and adds them to Coen's prompt as untrusted data between random markers. Links to other repos aren't read; failures are reported to Coen and the owner instead of guessed at.

The owner can attach files to one message (at most 3, 5 MB each; `.txt`, `.md`, `.csv`, `.pdf` and images only, each checked against its first bytes, stored under a name of letters, digits, `-` and `_`; the type is read from the whole name, and only the name shown in messages is shortened). A text file that isn't UTF-8 is refused with its own sentence and never converted: the older encodings can't be told apart, and a wrong character in a file of figures is worse than a refusal. The server saves the files in a folder of their own per job inside the temp folder (`exec-room-attachments-<port>`), outside the repo and every room's folders, and only that run gets a Read rule for it, on top of the room's access; whoever that run consults can read them too. A run in another chat at the same time, and later turns in the same chat (a revision, a maker, the room's follow-up), get no rule for it. The room only starts when that attachments folder is a real folder, owned by the user running the room, that nobody else can open: its name can be guessed, so where the temp folder is shared between users (`/tmp` on Linux) a folder or link someone else put there is refused, not used. The job's folder is deleted when the turn ends, whether it finished, failed or was stopped. When the room itself is stopped (Ctrl-C, or SIGTERM), it stops the running agents first and removes their folders once they are gone; a restart removes what a crash left behind. If saving fails, no agent is started and the page gets a plain sentence without the path (the reason is in the job log); if deleting fails, the page says so and names the folder to remove. An attachments folder (this port's or another's), anything inside one and any folder that holds the temp folder are refused as a room folder; a room saved earlier that lists one is reported at start-up (terminal and job log) and that folder is left out of its runs. Checked live on 2026-10-07 with the room's own flags: a file there is refused without the rule and read with it. The agent is told the content is untrusted data. Deleting the file doesn't undo the reading: what an agent read stays in Claude's own session logs (`~/.claude/projects`) and in Coen's memory of that chat, and whatever an agent quotes lands in the chat transcript or a draft. The chat transcript and the job log themselves keep only the files' names and sizes. A maker dispatched later can't open the file; what it needs has to be in the brief.

### 4. Side effects only after approval, carried out by the server

Coen can only *propose* an action. The owner approves it once on a card; the server then performs it with validated fields — the model never gets the tool:

- **Dispatch to a maker** — the maker runs with its own definition only, no Agent tool, `drafts/` only.
- **GitHub issue** — `gh issue create`, only in the room's allowlist of *private* repos (an issue on a public repo is publishing).
- **GitHub comment** — `gh issue comment` on an existing issue, with the same room repo list and visibility check as a new issue (private unless the room lists the repo as public).
- **Email draft** — nothing is sent and no API is called: approving only records the decision, then the card offers Outlook web, mailto and Copy and the owner sends it themselves. Every `to`/`cc` address must be on the room's recipient list (exact addresses, or bare domains matched exactly), checked when proposed and again on approval; an address with a comma, `?`, `&` or a line break is refused, not cleaned up. After a decision, `recommendations.json` and `jobs.ndjson` keep only the summary, recipient domains and subject, and the chat transcript is rewritten the same way (the card, and the proposal block and any of its addresses in the proposing message; at start-up for drafts decided earlier). Claude's own session logs (`~/.claude/projects`) and Coen's memory of that chat still have the draft.
- **Notion draft** — only in the Notion databases listed in `room.config.json` and allowed for the room; the server always sets `Status=draft`. What the integration can write is decided by what the owner shares with it in Notion, so give it no more than it needs.

Posting, scheduling, sending messages and deploying can't be proposed at all.

### 5. Private data stays local

Chats, proposals and the job log live in `data/`, which is gitignored.

`GET /api/workspaces/:id/decisions` (Room settings → Decisions) reads the job log back to the page, read-only: one row per decided proposal in that room across its chats, with who decided, the action and summary, when, the outcome, and the links or draft names it produced. Two things on a row come from outside the log: which agent proposed it (from the stored proposal) and the title of the chat it came up in (the start of that chat's first message, with any email address in it cut down to its domain). It sits behind the same `Host` and `Origin` checks as every other route and adds no login: the name it shows is the room's one owner (`ownerName` in `room.config.json`, or "the owner"), which says whose room this is, not who was at the keyboard. Revision notes are left out, an email draft shows only its subject and the recipients' domains (all the log ever kept), and decisions from a chat whose room was deleted are in no room's list. The page turns a result into a link only when it passes the same address checks as the proposal card (a Notion page, or a GitHub issue or comment). Agents can't call it: they have no Bash, and a room's sites can't be `localhost` or an IP address.

---

## CI Configuration

GitHub Actions run on every push and PR to `main`:

- **Gitleaks** (`gitleaks.yml`) — secret scan of the full history
- **Trivy** (`trivy.yml`) — fails on unfixed CRITICAL CVEs; also weekly on Mondays
- **Pin actions** (`pin-actions.yml`) — third-party actions must be pinned to a commit SHA
- **Gitleaks version check** (`gitleaks-version-check.yml`) — monthly PR when a newer Gitleaks is out
- **CLA** (`cla.yml`) — on pull requests, checks that the person who opened it and every commit author has signed the [contributor agreement](CLA.md) in `CLA-SIGNATURES.md`. It runs from `main` also for pull requests from forks (`pull_request_target`), so a pull request can't change the check; it has a read-only token, no secrets, no checkout and no shell step, and reads the pull request only as data

Dependabot (`.github/dependabot.yml`) keeps GitHub Actions and the npm packages up to date weekly (after a `marked` or `dompurify` update, re-copy its browser build into `public/vendor/`). Changes to `main` go through pull requests.

---

## Reporting a Vulnerability

If you discover a security issue, please report it privately through GitHub's **Report a vulnerability** button on this repository's Security tab, rather than opening a public issue.
