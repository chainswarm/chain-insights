# Stability and Deprecation Policy

**Summary.** Chain Insights is pre-1.0. The surfaces listed here are the ones
you can build on. Everything else may change without notice. When a guaranteed
surface must change, we deprecate first, announce in the CHANGELOG, and keep
the old behavior for at least one minor release when technically possible.

## Guaranteed surfaces

### CLI exit codes

- `0` — success.
- `1` — usage or runtime error (bad arguments, unreachable endpoint, failed command).
- `2` — reserved for partial failure in batch-style commands. No current
  command exits `2`.

Exit codes are contract. Scripts and agent harnesses may rely on them.

### MCP tool names

The public MCP surface is these seven tools:

- `aml_address_risk`
- `graph_query`
- `graph_query_batch`
- `meta_help`
- `meta_network_capabilities`
- `meta_usage_status`
- `wallet_balance`

Tool names are contract. Removing or renaming one is a deprecation event.
Tool *arguments* may grow additively at any time; existing argument names and
meanings are stable.

### Workspace layout

A workspace is marked by `.chain-insights/workspace.json`. These paths are
contract:

- `.chain-insights/workspace.json` — workspace config.
- `published/` — rendered dossiers, viz artifacts, and reports.
- `reports/` — report output.

New files and directories may appear inside a workspace at any time. Existing
contract paths keep their meaning.

### Config keys

Documented config keys (see `docs/architecture.md`, "Supported config keys")
are contract. Unknown keys in config files are ignored, never errors.

## Not covered

- Command *output text* not consumed as JSON (headings, wording, colors).
- Anything under `src/` — internal APIs are not public.
- Experimental or hidden flags, even if visible in `--help` output marked
  experimental.

## How deprecation works

1. The CHANGELOG announces the deprecation in the release that introduces it.
2. Where possible, the old behavior keeps working for at least one minor
   release and prints a warning.
3. The removal release notes the removal at the top of its CHANGELOG entry.

## Versioning

Pre-1.0 semver: minor versions (`0.x.0`) may add or — after deprecation —
remove surface; patch versions (`0.0.x`) are fixes and docs only. At 1.0 this
policy tightens to standard semver.
