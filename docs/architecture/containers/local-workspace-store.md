# Local Workspace Store

Filesystem workspace containing cases, evidence manifests, dossiers, and config.
**Technology:** Files

## Purpose

Provides durable, append-only local storage for investigation artifacts. Workspaces are plain directories (no database), enabling direct inspection with any editor or agent tooling. Stores reports (Markdown, graph HTML, table HTML), evidence (compact JSON, graph JSON), and schemas (runtime topology captures).

## Components

- **Workspace Layout:** .chain-insights/workspace.json marker, reports/ (Markdown, HTML), reports/graphs/ (graph JSON), reports/tables/ (CSV, compact evidence JSON), artifacts/, entities/, sessions/, published/
- **Case Manifests:** Evidence pointers, session metadata, tool invocations, continuation hints
- **Config Storage:** ~/.chain-insights/config.json (user-scoped, not workspace-scoped)
- **Wallet Storage:** ~/.chain-insights/wallet.json (encrypted, user-scoped)

## Data Flow

<- ciaCli: Writes local cases, evidence, and config
<- mcpProxy: Uses local workspace configuration (dataDir, serverPort, active workspace root)
<- server: Serves graph HTML and static assets from workspace paths

## Invariants

- Active workspace detection: Current directory with `.chain-insights/workspace.json` marker, or nearest parent directory with marker
- Workspace root is written once by `cia init` and never moved (no automatic workspace switching)
- Config and wallet are user-scoped (~/.chain-insights/), not workspace-scoped
- Artifacts are append-only; tools create new files with timestamp slugs, never overwrite existing files
- File permissions: 0o600 for sensitive files (wallet.json, compact evidence JSON containing audit trails), 0o755 for directories
- No automatic cleanup; users manage workspace growth manually (archive or delete old investigations)
