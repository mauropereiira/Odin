# Changelog

All notable changes to Odin are documented here.

## 0.1.0 - 2026-07-26

### Added

- Provider-neutral durable conversations and parallel Fleet agents for Claude Code and Codex.
- Linked Markdown Brain recall, reviewed procedural skills, and optional personal-note tools.
- Local Claude Code sessions, usage, plan, project, and MCP telemetry.
- Expanded memory graph with type filters, zoom, pan, pointer, touch, and keyboard controls.
- Isolated synthetic read-only demo mode with server-enforced live-state separation.
- Desktop and mobile browser tests, API security tests, CodeQL, dependency automation, and macOS launcher checks.

### Security

- Loopback-only HTTP and WebSocket access with strict `Host` and `Origin` validation.
- Owner-only Odin state, path-containment checks, staged model-authored skills, and guarded full-access modes.
- Demo integration tests that reject imports of live providers, storage, watchers, credentials, and agent state.
