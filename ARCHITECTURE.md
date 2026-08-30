# chain-insights Architecture

[Website](https://chain-insights.ai) | [npm](https://www.npmjs.com/package/chain-insights)

> Depth lives in authored docs under `context/`, `containers/`, and
> `components/`. This index is human-authored; C4 diagrams render via CI.
> Data contracts live in [data-contracts.md](data-contracts.md); repo
> invariants and operating rules live in [operating-rules.md](operating-rules.md).

## Context

- [overview](docs/architecture/context/overview.md) — purpose, bounded context, external systems

- [data flow](docs/architecture/context/data-flow.md) — end-to-end pipeline

- [dependencies](docs/architecture/context/dependencies.md) — contracts with indexers / ml-pipeline / chain-insights

## Containers

- [cia CLI](docs/architecture/containers/cia-cli.md) — Command-line interface for workspace setup, case workflows, exports, and graph tool calls.

- [MCP Proxy](docs/architecture/containers/mcp-proxy.md) — Stdio or local proxy surface that lets agent clients call Chain Insights tools.

- [Local Workspace Store](docs/architecture/containers/local-workspace-store.md) — Filesystem workspace containing cases, evidence manifests, dossiers, exports, and config.

- [NPM Package](docs/architecture/containers/npm-package.md) — Published package containing CLI, proxy, docs, and installer assets.

## Components

One doc per source module under `components/`. Human-authored.

| Worker          | Component doc                                                  |
| --------------- | -------------------------------------------------------------- |
| `config`        | [config](docs/architecture/components/config.md)               |
| `federation`    | [federation](docs/architecture/components/federation.md)       |
| `investigation` | [investigation](docs/architecture/components/investigation.md) |
| `mcp`           | [mcp](docs/architecture/components/mcp.md)                     |
| `monitor`       | [monitor](docs/architecture/components/monitor.md)             |
| `server`        | [server](docs/architecture/components/server.md)               |
| `viz`           | [viz](docs/architecture/components/viz.md)                     |
| `wallet`        | [wallet](docs/architecture/components/wallet.md)               |

## C4 Diagrams

### structurizr-chain-insights-components

![structurizr-chain-insights-components](docs/architecture/diagrams/rendered/global/structurizr-chain-insights-components.png)

[vector SVG](docs/architecture/diagrams/rendered/global/structurizr-chain-insights-components.svg) · [PNG](docs/architecture/diagrams/rendered/global/structurizr-chain-insights-components.png)

See [context/overview.md](docs/architecture/context/overview.md) for context.

### structurizr-chain-insights-containers

![structurizr-chain-insights-containers](docs/architecture/diagrams/rendered/global/structurizr-chain-insights-containers.png)

[vector SVG](docs/architecture/diagrams/rendered/global/structurizr-chain-insights-containers.svg) · [PNG](docs/architecture/diagrams/rendered/global/structurizr-chain-insights-containers.png)

See [context/overview.md](docs/architecture/context/overview.md) for context.

### structurizr-chain-insights-context

![structurizr-chain-insights-context](docs/architecture/diagrams/rendered/global/structurizr-chain-insights-context.png)

[vector SVG](docs/architecture/diagrams/rendered/global/structurizr-chain-insights-context.svg) · [PNG](docs/architecture/diagrams/rendered/global/structurizr-chain-insights-context.png)

See [context/overview.md](docs/architecture/context/overview.md) for context.

## Verification

- `npm test`

- `npm run build`

> GitHub **Architecture** tab index. Canonical depth lives under `docs/architecture/`.
