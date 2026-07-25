# Security Policy

## Supported Versions

Odin is pre-1.0 software. Security fixes are applied to the latest revision of the default branch;
older revisions are not supported.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's private security
advisory feature and include:

- The affected revision and platform.
- Reproduction steps or a proof of concept.
- The expected impact and data at risk.
- Any suggested mitigation.

Avoid including real prompts, transcripts, credentials, note contents, account details, or absolute
local paths. Replace them with synthetic values.

## Deployment Boundary

Odin is designed for one trusted user on one trusted local machine. It has no application login,
API token, TLS termination, tenant isolation, or remote-access authorization. The server must remain
bound to loopback and must not be placed behind a reverse proxy, tunnel, port forward, or LAN-facing
listener.

Any local process may be able to access local HTTP services. Treat the machine's OS account and
process boundary as part of Odin's security model.

## Sensitive Data

Depending on enabled integrations, Odin can read and display local session transcripts, project
paths, MCP configuration, account metadata, Brain notes, conversation history, and skill contents.
Prompts and selected context are sent to the configured provider. Secret redaction is heuristic and
cannot guarantee that sensitive data will not leave the machine.

See [Security and Data](docs/security-and-data.md) for the full threat model.

## Upstream Advisories

The current dependency tree can report advisories in upstream code paths Odin does not use:

- React Router's React Server Components action handling. Odin is a client-rendered SPA and defines
  no React Router server actions or RSC routes.
- Hono's Windows static-file adapter through the MCP SDK. Odin uses the MCP SDK over stdio and does
  not import or run Hono's static-file adapter.

These are still monitored and should be upgraded when upstream releases provide fixes without
introducing vulnerabilities in code paths Odin does use. Do not treat this reachability assessment as
a reason to ignore new or changed advisories.
