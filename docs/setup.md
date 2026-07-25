# Setup

## Requirements

- Node.js 20 or newer
- npm
- A modern browser
- Claude Code, Codex, or both for agent execution

The telemetry screens require Claude Code state. Codex can power Converse and Fleet but does not
currently provide telemetry for Sessions, Usage, MCP Servers, Projects, or plan information.

## Install Dependencies

```bash
npm install
```

## Provider Setup

### Claude Code

Install Claude Code and complete its normal authentication flow before starting Odin. Odin checks
readiness with `claude auth status --json` and uses the `claude` executable on `PATH` by default.

Use `ODIN_CLAUDE_BIN` to select another executable:

```bash
ODIN_CLAUDE_BIN=/absolute/path/to/claude npm run dev
```

### Codex

Odin uses `@openai/codex-sdk` and its bundled runtime by default. Authenticate Codex normally, or
provide `CODEX_API_KEY` in the process environment. Set `CODEX_HOME` to use a non-default Codex
state directory and `ODIN_CODEX_BIN` to select another executable.

Never commit keys or provider auth files. Odin does not load a root `.env` file automatically.

## Development

```bash
npm run dev
```

- Dashboard: `http://localhost:5173` or the next free Vite port
- API and WebSocket: `http://127.0.0.1:7420`

Vite proxies `/api` and `/ws` to the API port. Set `HELM_PORT` on the whole command to change it:

```bash
HELM_PORT=17420 npm run dev
```

## Production

```bash
npm run build
npm start
```

The production server serves `web/dist` at `http://127.0.0.1:7420`. `npm start` does not build
first, so rerun `npm run build` after source changes.

## Optional Moldavite Notes

Odin's Brain is plain Markdown and works without the Moldavite application running. If the Moldavite
MCP executable is installed, Odin can also expose a selected personal Forge to provider runs for
explicit note-reading and note-writing requests.

Controls:

```bash
ODIN_NOTES_ENABLED=0 npm run dev          # disable personal-note tools
ODIN_NOTES_FORGE=Research npm run dev     # select a Forge
ODIN_MOLDAVITE_BIN=/path/to/moldavite npm run dev
```

Personal-note writes are governed by Odin's agent instructions, not a separate confirmation dialog.
Disable the integration if prompt-level authorization is not sufficient for your use case. The
automatic post-turn librarian only writes to Odin's dedicated Brain.

## macOS Application

Install the local app wrapper:

```bash
bash scripts/install.sh
```

The installer validates required tools, installs npm dependencies, builds both workspaces, and
creates a signed `/Applications/Odin.app`. Open the app from Applications after installation. The
launcher records the checkout identity and owns only the production server it starts.

Important behavior:

- No login item is installed.
- The checkout path and selected port are captured at install time.
- Finder launches do not inherit arbitrary shell environment variables.
- Moving the checkout or changing `HELM_PORT` requires reinstalling.
- A compatible manually started server is reused and not killed by the app.
- A conflicting or unverified listener causes startup to fail safely.

Install on a different port:

```bash
HELM_PORT=17420 bash scripts/install.sh
```

Uninstall:

```bash
bash scripts/uninstall.sh
```

The uninstaller removes the app, launcher state, launcher logs, and only its recorded server. It does
not erase conversations, Fleet state, Brain notes, forged skills, Claude history, or Codex history.

## Isolated Profiles

For tests, demos, or screenshots, set a disposable `HOME` and override every data root before the
server starts:

```bash
HOME=/tmp/odin-demo/home \
HELM_CLAUDE_DIR=/tmp/odin-demo/claude \
ODIN_DATA_DIR=/tmp/odin-demo/data \
ODIN_BRAIN_DIR=/tmp/odin-demo/brain \
ODIN_SKILLS_DIR=/tmp/odin-demo/skills \
CODEX_HOME=/tmp/odin-demo/codex \
ODIN_NOTES_ENABLED=0 \
HELM_PORT=17420 \
npm start
```

Changing only `HELM_CLAUDE_DIR` is not sufficient because Claude's top-level configuration is read
from `$HOME/.claude.json`.
