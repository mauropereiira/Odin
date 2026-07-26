# Configuration and API Reference

## Environment Variables

Odin reads configuration from the process environment. It does not automatically load a root `.env`
file.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HELM_PORT` | `7420` | Fastify port and Vite proxy target. |
| `ODIN_DATA_DIR` | `~/.odin` | Conversation and Fleet storage root. |
| `ODIN_CLAUDE_BIN` | `claude` | Claude Code executable override. |
| `ODIN_CODEX_BIN` | SDK runtime | Codex executable override. |
| `CODEX_HOME` | `~/.codex` | Codex auth, models, and thread state. |
| `CODEX_API_KEY` | unset | Optional Codex API-key authentication. |
| `HELM_CLAUDE_DIR` | `~/.claude` | Claude projects, stats, auth cache, settings, and plugins. |
| `ODIN_ALLOW_BYPASS` | `0` | Set to `1` to expose provider full-access modes. |
| `ODIN_BRAIN_DIR` | Moldavite `Odin` Forge | Brain directory override. |
| `ODIN_BRAIN_RECALL` | `1` | Set to `0` to disable pre-run recall. |
| `ODIN_BRAIN_REMEMBER` | `1` | Set to `0` to disable automatic memory writes; skill extraction may still run. |
| `ODIN_LIBRARIAN_ENABLED` | `1` | Set to `0` to disable all automatic post-turn provider calls. |
| `ODIN_NOTES_ENABLED` | `1` | Set to `0` to disable personal-note MCP tools. |
| `ODIN_NOTES_FORGE` | `Default` | Personal-note Forge exposed through MCP. |
| `ODIN_MOLDAVITE_BIN` | auto-detected | Moldavite MCP executable override. |
| `ODIN_SKILLS_ENABLED` | `1` | Set to `0` to disable forging and loading Odin skills. |
| `ODIN_SKILLS_DIR` | `~/.claude/odin-skills` | Forged-skill plugin root. |
| `ODIN_CODEX_LIBRARIAN_MODEL` | provider default | Optional model for Codex librarian calls. |

Some `HELM_*` executable names remain as compatibility aliases. New configuration should use
`ODIN_*` names.

## UI Routes

| Route | Scope |
| --- | --- |
| `/` | Provider readiness and Claude activity overview. |
| `/converse` | Durable Claude Code or Codex conversations. |
| `/fleet` | Persistent multi-provider project agents. |
| `/brain` | Search, graph, capture, inspect, and forget memories. |
| `/skills` | Installed plugins and staged/active Odin skills. |
| `/usage` | Claude token activity and estimated equivalent API cost. |
| `/sessions` | Claude session history and recent-activity cards. |
| `/sessions/:id` | Claude transcript and per-turn telemetry. |
| `/mcp` | Claude global, project, and plugin MCP configuration. |
| `/projects` | Projects discovered from Claude local state. |

## REST API

The API is local, unversioned, and not a stable external integration contract.

### System

- `GET /api/health`
- `GET /api/providers`
- `GET /api/capabilities`
- `GET /api/overview`
- `GET /api/ratelimit`
- `GET /api/plan`

### Claude Telemetry

- `GET /api/sessions`
- `GET /api/sessions/live`
- `GET /api/sessions/:id`
- `GET /api/usage`
- `GET /api/mcp`
- `GET /api/projects`

### Brain

- `GET /api/brain`
- `GET /api/brain/memories`
- `GET /api/brain/memories/:slug`
- `GET /api/brain/graph`
- `GET /api/brain/search?q=...`
- `POST /api/brain/memories`
- `DELETE /api/brain/memories/:slug`

Memory creation accepts a title, body, type, pinned state, and tags. Slugs are generated with the
same Unicode letter/number/hyphen rules used by Moldavite.

### Skills

- `GET /api/skills`
- `POST /api/skills/forged/:slug/activate`
- `POST /api/skills/forged/:slug/deactivate`
- `DELETE /api/skills/forged/:slug`

### Converse

- `POST /api/converse`
- `GET /api/converse/sessions`
- `GET /api/converse/sessions/:id`
- `DELETE /api/converse/sessions/:id`
- `POST /api/converse/:runId/stop`

Only one run can be active for a conversation. Provider choice cannot change after creation.

### Fleet

- `GET /api/agents`
- `POST /api/agents`
- `POST /api/agents/:id/prompt`
- `POST /api/agents/:id/stop`
- `DELETE /api/agents/:id`

Only one run can be active for an agent; separate agents can run concurrently.

## Request Limits

Accepted HTTP requests and WebSocket handshakes share an in-memory per-process loopback limit. Exceeding the
configured threshold returns `429` with code `ODIN_RATE_LIMITED` and a `Retry-After` header.

## WebSocket

Connect to `/ws`. Server frames are JSON objects with one of these shapes:

- `{"kind":"hello"}` when connected.
- `{"kind":"change","source":"sessions","at":"..."}` to invalidate a cached source.
- `{"kind":"agent",...}` for normalized Converse and Fleet provider events.

Clients should refetch affected REST resources after a `change` frame rather than treating the frame
as the full data payload.

## Provider Access Modes

Claude Code exposes `plan`, `default`, and `acceptEdits`; optional full access uses
`bypassPermissions`. Codex exposes `read-only` and `workspace-write`; optional full access uses
`danger-full-access`. Exact labels and currently available models are returned by
`GET /api/providers`.

## Cost Estimates

Usage figures are estimated equivalent API cost derived from locally recorded token counts and a
built-in model pricing table. They are not invoices and may be zero for unrecognized models.
Subscription users may incur no per-token charge even when an equivalent cost is shown.
