# Security and Data

Odin runs local coding agents with filesystem and tool access. Its security model assumes one trusted
OS user on one trusted workstation.

## Threat Model

Odin protects against accidental network exposure and common browser-to-loopback attacks, not against
a malicious process already running as the same OS user.

Implemented boundaries:

- Fastify listens only on `127.0.0.1`.
- Requests and WebSocket upgrades require a loopback `Host`.
- A supplied `Origin` must also be loopback.
- Provider processes are spawned directly without a shell.
- API inputs and provider options are schema-validated.
- Memory and skill slugs reject traversal syntax.
- Skill mutations enforce resolved-path containment and reject symlink escapes.
- Dangerous provider access is disabled by default.
- Odin-owned state uses owner-only directory and file modes where supported.

Not provided:

- Login, API-token authentication, or multi-user authorization.
- TLS or secure remote access.
- Encryption of stored conversations, notes, or skills.
- Isolation from other processes running under the same OS account.
- A guarantee that heuristic redaction finds every secret.
- A runtime confirmation dialog for personal-note writes.

Do not expose Odin through a tunnel, reverse proxy, port forward, container-published port, or
LAN-facing listener.

## Demo Isolation

Starting Odin through `npm run demo` sets `ODIN_DEMO=1` and creates a separate server boundary for
public evaluation and browser testing:

- Responses come only from fixed synthetic fixtures held in memory.
- Provider adapters, provider health checks, filesystem watchers, conversations, Fleet, Brain,
  skills, personal notes, and live WebSocket snapshots are not initialized.
- API requests using methods other than `GET` or `HEAD` receive `403 ODIN_DEMO_READ_ONLY`.
- Unknown API routes receive `404 ODIN_DEMO_NOT_FOUND` rather than falling through to a live handler.
- Demo responses use `Cache-Control: no-store` and `X-Odin-Mode: demo`.
- The normal loopback `Host` and `Origin` checks still run before demo routing.

The interface also disables known write controls, but that is a usability measure rather than the
security boundary. The server rejects direct mutation requests independently. Automated integration
tests reject imports of live subsystem modules and verify configured canary storage remains untouched.

## Provider Data Flow

Converse and Fleet send the user prompt and assembled system instructions to the selected provider.
Depending on settings and the request, assembled context can include:

- Relevant Brain excerpts.
- Active skill instructions.
- Project and working-directory context.
- Results from enabled MCP tools.

After a successful turn, the librarian can make an additional request through the same provider to
extract durable memories and reusable procedures. `ODIN_BRAIN_REMEMBER=0` disables memory extraction
but can still allow the call to forge skills. `ODIN_LIBRARIAN_ENABLED=0` disables the entire automatic
post-turn provider call.

Claude Code receives its prompt and appended instructions as process arguments; same-machine process
inspection may be able to observe them. Codex runs through its SDK and configured local runtime.

## API Data Exposure

The local API can return sensitive local data, including:

- Full or partial session transcripts and tool inputs.
- Absolute project and skill paths.
- Account email and subscription metadata.
- MCP commands, URLs, scopes, and authentication state.
- Brain notes and links.
- Odin conversation history and Fleet metadata.
- Installed plugin and skill contents.

The health endpoint also reports the checkout root so the macOS launcher can verify process
ownership. These responses are why loopback is a hard deployment boundary.

## Access Modes

Claude Code and Codex expose different native permission models. Odin presents provider-specific
guarded modes and validates the selected mode before launch.

Full access (`bypassPermissions` for Claude Code and `danger-full-access` for Codex) is unavailable
unless the server starts with `ODIN_ALLOW_BYPASS=1`. Full access can read, modify, execute, or transmit
data outside the selected project. Enable it only for a trusted task in a trusted environment.

Fleet tools cannot dispatch or prompt a worker with broader access than the orchestrating Converse
run. New tool-dispatched workers are confined to projects discovered by Odin. Agents created directly
from the Fleet UI use the explicitly selected project and provider access mode.

## Memory Safety

Brain recall wraps note excerpts as untrusted reference data. Notes can still influence a model, so
do not store hostile or untrusted content in the Brain.

The librarian:

- Receives the completed turn, run context, and up to 60 existing Brain titles for deduplication,
  but not existing note bodies.
- Runs in a temporary directory with tools, skills, hooks, project settings, MCP servers, and session
  persistence disabled.
- Applies heuristic redaction before and after provider processing.
- Writes only bounded structured candidates.
- Cannot overwrite pinned or manually authored notes.
- Never pins its own notes.
- Writes only inside the configured Odin Brain directory.

These controls reduce risk but do not make model-authored memory authoritative. Review important
notes and pin trusted canonical versions.

Model-authored Markdown is rendered without remote images to prevent automatic third-party requests.
External links remain clickable and open only after an explicit user action.

## Skill Safety

Forged skills are procedural instructions and can affect future runs. Odin therefore stages every
new or updated forged skill. Activation is an explicit user action after reviewing the complete
instructions. Active skills still operate under the run's provider permission mode.

## Personal Notes

When enabled, the optional Moldavite MCP integration can give provider-backed agents tools to search,
read, list, create, append, and update notes in the selected Forge. Odin's instructions say to write
only when the user asks, but no independent confirmation layer enforces this. Use
`ODIN_NOTES_ENABLED=0` when that boundary is insufficient.

The automatic librarian never targets the personal-note Forge; it writes only to Odin's Brain.

## Storage and Deletion

| Data | Default | Deletion behavior |
| --- | --- | --- |
| Conversation registry | `~/.odin/converse-sessions.json` | Deleting a conversation removes Odin metadata and its normalized transcript. |
| Conversation transcripts | `~/.odin/conversations/*.jsonl` | Provider-native history is not removed. |
| Fleet state | `~/.odin/fleet.json` | Removing an idle agent removes Odin's agent metadata. |
| Brain | `~/Documents/Moldavite/Odin/` | Forgetting a note moves it to `.odin-trash/`. |
| Forged skills | `~/.claude/odin-skills/` | Deleting a skill moves it to the plugin trash. |
| Claude telemetry | `~/.claude/`, `~/.claude.json` | Read-only; Odin does not delete it. |
| Codex state | `$CODEX_HOME` or `~/.codex/` | Provider-owned; Odin does not delete it. |

Uninstalling `/Applications/Odin.app` intentionally leaves durable user data in place.

## Operational Guidance

- Keep the OS account and full-disk encryption protected.
- Do not put secrets in prompts, notes, fixture files, screenshots, or issue reports.
- Review provider access modes and active skills before sensitive work.
- Back up the Brain and Odin state using tools appropriate for private local data.
- Use isolated temporary profiles for demos and screenshots.
- Report vulnerabilities through the private process in [SECURITY.md](../SECURITY.md).
