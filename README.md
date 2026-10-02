# Exec Room

Exec Room is an open-source agent room for running a business: a local web room where you, the exec, work with a team of Claude Code agents. They research, draft and propose actions (GitHub issues, Notion pages, email drafts, jobs for other agents). They never get a shell, and nothing happens until you approve it.

The room starts with one agent: **Coen**, the room lead. Every message goes to him first. You build the rest of the team yourself, in the room:

- **Advisors** — Coen consults them before he answers (for example a technical or a marketing advisor).
- **Makers** — they do a job after you approve it and save the result as a draft (for example a writer or an image-prompt maker).

Each agent gets a name, a job description, instructions, the tools it may use and an avatar from the preset set.

## Features

- **Approve before act** — agents propose; you approve each action on a card, then the server carries it out
- **Rooms** — separate chats, each with its own members, its own limits on what agents may read and propose, and a one-line description of what the room is for
- **GitHub** — issues and comments in the repos you allow per room (private repos only, unless you mark one as public)
- **Notion** — posts saved as drafts in databases you configure, and long-form pages under pages you allow
- **Email drafts** — to recipients you allow; the room never sends mail, you do
- **Local and locked down** — binds to 127.0.0.1, read-only tools, writes only in `drafts/`, secret files blocked

## What it costs

The room runs on your own Claude plan. Every message, every advisor Coen consults and every maker run is a Claude Code run that spends your plan's usage. Two jobs can run at the same time (in different rooms), which uses it up faster. The room keeps the cost Claude Code reports per message and per chat, but it sets no budget and no limit of its own.

## Requirements

- **macOS or Linux.** Windows isn't supported.
- **Node.js 20+**
- **Claude Code** (`claude`), signed in to your Claude plan (tested with version 2.1.285) — see the [Claude Code docs](https://code.claude.com/docs). The room runs agents on your plan; it never uses an Anthropic API key. It starts every run with `--agents`, `--tools`, `--setting-sources` and `--disable-slash-commands`, so it needs a recent version that has all four.
- **Python 3** — only to run the tests
- Optional: **GitHub CLI** (`gh`), signed in, for GitHub actions
- Optional: a **Notion integration token**, for Notion actions
- Optional: the **Notion** and **Microsoft 365** connectors on your claude.ai account, if agents should read Notion or search your Outlook mail. Agents read through those connectors; the integration token is used by the server (saving drafts and pages, checking where a page sits), never by agents. So a room's Notion and Microsoft 365 switches do nothing until the connector is connected.

## Quick start

```bash
git clone https://github.com/ANDRS-Projects/exec-room.git
cd exec-room
./setup.sh        # checks the requirements, installs dependencies, creates room.config.json
npm run room      # then open http://127.0.0.1:4179
```

Click **Add agent** to build your first advisor or maker, and **Room settings** to choose what the room may read, which sites it may open, and what it may propose.

## Configuration

Most settings live in the room itself (Room settings), per room: folders agents may read, web search, sites they may open, Notion and Microsoft 365 access, GitHub repos, Notion pages and email recipients. A new room starts with nothing beyond `drafts/`.

`room.config.json` (created from `room.config.example.json`, gitignored) only holds what the whole install needs:

| Key | What it's for |
|-----|---------------|
| `notionTokenRef` | A 1Password reference (`op://vault/item/field`) read once at start-up with `op read`. Or set `ROOM_NOTION_TOKEN` instead. Without a token, Notion actions are off. |
| `notionDatabases` | The Notion databases posts can be saved to, e.g. `{"social": {"name": "Social posts", "id": "<database id>", "accounts": ["Personal", "Company"]}}`. Each needs the properties Name (title), Status (status, with a `draft` option), Channel and Post Content (text), and optionally Account (select), Image Prompt and Source Insight (text). |
| `notionChannels` | The channel names a post may have (default: X, LinkedIn, Substack Note, Substack Post, Instagram, Blog). |
| `hiddenConnectors` | Other claude.ai connectors on your account to keep out of the agents' view, by the name in their tool names (`mcp__claude_ai_<name>__…`), e.g. `["My_Connector"]`. Agents can only call the tools a room allows; connectors that aren't hidden are still visible to them, so this keeps the rest out of their context. Claude Docs, Gmail, Slack, Google Drive and Google Calendar are always hidden. `Notion` and `Microsoft_365` can't be listed, as those are switched per room: such an entry is skipped with a warning at start-up, like an entry that isn't a connector name. |

Share the databases and pages with your Notion integration. Posts are always saved with Status `draft`; publishing stays with you.

Environment variables are listed in `.env.example`. The server reads them from your shell; it does not load a `.env` file.

## Your own agents

**Import.** Already have agents for Claude Code in `~/.claude/agents` (as `<name>.md` or `<name>/AGENT.md`)? Click **Add agent** → **Import from ~/.claude/agents** and pick one. The room copies its name, description, model and instructions into the build form; you choose its role, tools and avatar there. It's a one-time copy: later changes to the file don't reach the room, and a `tools:` line in the file is ignored, so a file can never give an agent more access than you chose.

**Export.** Agents you build in the room are stored in `data/agents.json`. To use one outside the room too, open it and choose **Export as AGENT.md**: the room saves it in `drafts/` and shows the command to copy it into your own `~/.claude/agents` folder. The room never writes there itself.

**Readable in every room.** Runs start in the folder you cloned the room into, so every agent in every room can read that folder, whatever folders the room has: the room's own code and docs, `room.config.json` (your Notion database ids and the 1Password reference to the token, not the token itself), and `drafts/`, including drafts written in other rooms. Only `data/`, secret-looking files (`.env`, keys and the like) and `.git` are excluded. Every agent can also read `~/.claude/agents`, `~/.claude/skills` and `~/.claude/knowledge` (and what those folders link to). Keep nothing in any of these places that an agent in another room shouldn't see.

## Tests

```bash
npm test
```

368 checks run the server against fake `claude`, `gh` and Notion stand-ins in `tests/fakes/`, so they need no network, accounts or credits. Expected output: `ok: all 368 checks match tests/expected.txt`.

## Security

See [SECURITY.md](SECURITY.md) for the full model. In short: the room binds to localhost and rejects other hosts and origins; agents get read-only tools (never Bash), write only in `drafts/`, and can't read secret files (`.env`, keys, `.git`) or the room's own data; every action is a proposal you approve.

**These are permission rules, not a sandbox.** The blocks work by name: tool names, folder paths and file-name patterns, passed to Claude Code as allow and deny rules. Nothing isolates the agents from your machine at the operating-system level, so a secret in a file with a name that isn't on the list, inside a folder you gave a room, is readable. Everything agents read can also carry prompt injection: files, web pages, Notion pages, GitHub issues and pull requests, and mail previews can contain text that tries to steer an agent. Give each room only what its job needs, and read a proposal before you approve it.

To report a vulnerability, use **Report a vulnerability** on the repository's Security tab rather than a public issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Working on the room with Claude Code? [CLAUDE.md](CLAUDE.md) has the commands and architecture.

## License

MIT — see [LICENSE](LICENSE).
