# Troubleshooting

## Provider Is Unavailable

- Run the provider's own version and authentication commands outside Odin.
- Ensure the executable is on `PATH` before starting Odin.
- Set `ODIN_CLAUDE_BIN` or `ODIN_CODEX_BIN` to an absolute executable path.
- Restart Odin after changing provider installation or authentication.

An empty Codex model list does not prevent provider-default execution; the local model cache may not
have been populated yet.

## Sessions, Usage, MCP, or Projects Are Empty

These screens read Claude Code local state and do not currently ingest Codex telemetry.

- Run at least one Claude Code session.
- Check whether Claude state lives under `~/.claude`.
- Set `HELM_CLAUDE_DIR` if the Claude state directory is elsewhere.
- Remember that top-level Claude configuration still comes from `$HOME/.claude.json`.

“Live” means transcript activity occurred recently; it does not prove the underlying process is still
running.

## Brain Does Not Recall Notes

- Confirm notes exist under the configured Odin Brain `notes/` directory.
- Remove `ODIN_BRAIN_RECALL=0` from the server environment.
- Use relevant project names or keywords so non-pinned notes rank into the context budget.
- Pin canonical notes that should receive highest priority.

## Automatic Memories Do Not Appear

- Remove `ODIN_BRAIN_REMEMBER=0` from the server environment.
- Verify `ODIN_LIBRARIAN_ENABLED` is not `0`.
- Confirm the turn completed successfully and the selected provider remains authenticated.
- Wait briefly: the librarian is asynchronous and best-effort.
- Check file permissions on the Brain directory.
- A pinned or manually authored note with the same slug will intentionally block automatic overwrite.

`ODIN_BRAIN_REMEMBER=0` blocks memory writes but does not block skill extraction when skills are
enabled. Use `ODIN_LIBRARIAN_ENABLED=0` to disable every automatic post-turn provider call.

## Personal Notes Are Unavailable

- Confirm the Moldavite MCP executable exists.
- Set `ODIN_MOLDAVITE_BIN` if auto-detection fails.
- Verify `ODIN_NOTES_ENABLED` is not `0`.
- Verify `ODIN_NOTES_FORGE` names an existing Forge.

## A Forged Skill Is Not Used

New skills are staged by design. Open Skills, inspect the complete instructions, and activate the
skill. Verify `ODIN_SKILLS_ENABLED` is not `0`.

## Dashboard Stops Updating

The browser refetches data after WebSocket change events. Inspect the browser network panel for the
`/ws` connection and API failures. The client automatically retries a dropped connection.

## Port Conflict

Set a free port consistently for server and frontend:

```bash
HELM_PORT=17420 npm run dev
```

For a macOS app installation, reinstall with the new port:

```bash
HELM_PORT=17420 bash scripts/install.sh
```

## macOS App Does Not Start

Inspect `~/Library/Logs/Odin/odin.log`. Common causes are:

- The checkout was moved or removed after installation.
- Node or a captured provider executable no longer exists at its installed path.
- Another process owns the configured port.
- A manual production server from this checkout is running with incompatible identity metadata.
- The production build is stale or missing.

Run `bash scripts/install.sh` again after correcting the cause. The installer is transactional and
restores the previous app if replacement fails.

## Custom Environment Is Missing from the Dock App

Finder does not inherit the interactive shell environment, and the installer intentionally captures
only required launcher values. For advanced custom environment settings, start production manually
with `npm start` or adjust the installation workflow for the deployment.

## Corrupt Local State

- Conversation registry corruption is preserved rather than overwritten; back up the file before
  repairing it.
- Fleet registry corruption is moved to a timestamped backup and a clean registry is used.
- A truncated final conversation JSONL record is ignored.

Default Odin state is under `~/.odin/`. Do not post the files publicly: they may contain prompts,
responses, paths, and provider-native identifiers.

## Uninstall Did Not Remove Data

This is intentional. `scripts/uninstall.sh` removes the application wrapper, launcher state, logs,
and the server process it owns. It does not erase Odin conversations, Fleet metadata, Brain notes,
skills, or provider-native history. Remove those stores separately only after backing up anything you
want to keep.
