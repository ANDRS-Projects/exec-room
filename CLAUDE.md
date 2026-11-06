# Exec Room

Local web room (Node.js + Express 5, port 4179, localhost only) where the owner chats with Claude Code agents. Coen, the room lead, is the only agent that ships (`agents/coo/AGENT.md`); owners build advisors and makers in the room. Agents propose actions; the server carries them out only after the owner approves.

## Commands

```bash
./setup.sh                             # first-time setup
npm run room                           # start the room at http://127.0.0.1:4179
npm run room:key                       # the same, paid with an Anthropic API key (ROOM_ANTHROPIC_API_KEY) instead of the Claude plan
npm test                               # 827 checks against fakes (expects "ok: all 827 checks match")
python3 tests/room_suite.py --update   # rewrite tests/expected.txt (only for intended output changes)
```

## Architecture

```
room-server.js            the server: rooms, jobs (headless `claude -p` runs), permissions, proposals, GitHub/Notion actions
agents/coo/AGENT.md       Coen's definition, passed to every run with --agents
public/                   the page: room.html, room.js (follows a running job by streaming GET /api/stream), room.css, vendored marked + DOMPurify
public/avatars/presets/   avatar presets for room-built agents
tests/room_suite.py       snapshot suite; tests/fakes/<scenario>/ holds fake claude/gh; tests/expected.txt the snapshot
room.config.json          install-wide settings: Notion databases and token, connectors to hide (gitignored; template: room.config.example.json)
data/                     rooms, chats, room-built agents (agents.json), job log (gitignored)
drafts/                   the only folder agents can write to (gitignored)
```

Per-room settings (folders agents may read, web search, sites, Notion, Microsoft 365, GitHub repos, Notion pages, email recipients) are stored in `data/workspaces.json` and turned into each run's `--tools` / `--allowedTools` / `--disallowedTools` by `permissionsFor`.

## Constraints

- Approve-first: agents only propose (recommendation blocks); `/api/recs/:id/approve` performs the action with validated fields.
- Agents never get Bash or the `gh` token; writes only in `drafts/`; secret files, `.git`, the room's `data/` and sensitive home folders are always denied.
- Runs use `--setting-sources project` and `--permission-mode default`, and strip `ANTHROPIC_API_KEY` and everything else that would take a run off the Claude plan (`AUTH_ENV`). Key mode (`ROOM_AUTH=api-key`) is the one exception: the key is read at start-up, goes to the runs only, and those runs get their own `CLAUDE_CONFIG_DIR`, no claude.ai connectors (so no Microsoft 365) and only the Exec Room's own MCP servers (`--strict-mcp-config`, `runAccess`). Notion is read through its Connect sign-in when that is set up; otherwise the Notion pages and databases linked in the owner's message are read by the server with the integration token and handed over as untrusted data (`readLinkedNotion`).
- The page has a strict CSP: no inline scripts or styles, nothing from a CDN.
- `~/.claude/agents` is the owner's own folder. The room never writes to it (export only prints a copy command) and never runs agents from it. It reads it only for **Import**: a one-time copy into `data/agents.json`, where the role and tools are chosen in the room and a `tools:` line in the file is ignored.
- Never loosen a security check to make something work; keep `npm test` green and paste its output in the PR.

## Environment variables

`PORT`, `ROOM_CONFIG_FILE`, `ROOM_DATA_DIR`, `ROOM_ISSUE_FETCH_TIMEOUT_MS`, `ROOM_NOTION_API`, `ROOM_NOTION_TOKEN`, `ROOM_NOTION_TOKEN_REF`, `ROOM_AUTH`, `ROOM_ANTHROPIC_API_KEY`, `ROOM_ANTHROPIC_API_KEY_REF`, `ROOM_RUN_CAP_USD`, `ROOM_DAY_CAP_USD`, `ROOM_PASS_ENV`, `ROOM_CONTEXT_CHECK`, `ROOM_MCP_CATALOG` — see `.env.example`.

See `README.md`, `SECURITY.md` and `CONTRIBUTING.md`.
