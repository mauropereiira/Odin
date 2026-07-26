# Contributing to Odin

Contributions are welcome. Odin controls local agent runtimes and reads potentially sensitive local
state, so correctness, privacy, and explicit security boundaries take priority over convenience.

## Development Setup

Requirements:

- Node.js 20 or newer
- npm

```bash
npm install
npm run dev
```

The npm workspace contains:

- `server/`: Fastify, provider adapters, persistence, memory, skills, and telemetry readers.
- `web/`: React, Vite, Tailwind, TanStack Query, and WebSocket-driven UI updates.
- `scripts/`: macOS application installation and uninstallation.

## Checks

Run the complete local check before opening a pull request:

```bash
npx playwright install chromium # first run only
npm run check:all
```

`npm run check` runs server tests and both production builds without browser tests. Server tests can
be run independently with `npm run test`; browser tests use `npm run test:e2e`, and server watch mode
is available through `npm run test:watch --workspace server`.

## Engineering Guidelines

- Prefer the smallest correct change and preserve existing behavior unless the change is explicit.
- Keep provider-specific behavior behind the normalized provider contract in
  `server/src/providers/`.
- Keep source modules read-only unless they are explicitly responsible for Odin-owned state.
- Preserve ESM imports with `.js` extensions in TypeScript source.
- Keep server DTOs in `server/src/types.ts` and frontend mirrors in `web/src/lib/types.ts` aligned.
- Validate all values crossing the local HTTP boundary.
- Never weaken loopback, path-containment, permission-mode, memory provenance, or skill activation
  checks without documenting the threat-model impact.
- Add focused tests for persistence, path handling, normalization, and destructive operations.

## Privacy Rules

Pull requests must not contain:

- Real names, email addresses, usernames, account identifiers, or machine hostnames.
- Absolute home-directory paths or private project names.
- Real prompts, transcripts, Brain notes, provider sessions, usage data, or MCP configuration.
- API keys, tokens, cookies, auth files, browser profiles, or local environment files.
- Browser snapshots or screenshots captured from a real Odin profile.

Use fictional names, `example.invalid` domains, `/demo/...` paths, and synthetic identifiers in tests
and documentation. Generate screenshots from an isolated temporary home with synthetic data.

## Pull Requests

- Explain the user-visible behavior and the reason for the change.
- Call out security, privacy, persistence, or migration implications.
- Include the commands used to verify the change.
- Keep unrelated formatting or refactors out of the same pull request.

By contributing, you agree that your contribution is licensed under the MIT License.
