# Chain Insights README DX Dogfood Report

## Context

- Workspace: `/home/aphex5/work/chain-insights-dx-dogfood`
- CLI version: `0.2.13`
- Date: 2026-05-24
- Test address: `5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5`

## Commands Run

```bash
rm -rf /home/aphex5/work/chain-insights-dx-dogfood
mkdir -p /home/aphex5/work/chain-insights-dx-dogfood
cd /home/aphex5/work/chain-insights-dx-dogfood
cia --version
cia --help
cia mcp --help
cia init .
find . -maxdepth 3 -type f | sort
cia mcp networks | tee networks.txt
cia mcp tools --refresh | tee tools.txt
cia case open "README DX dogfood victim address" --tags dogfood,bittensor,readme --description "Fresh developer experience check for Chain Insights README and AML tool workflow"
cia case list
VICTIM_ADDRESS=5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5
cia mcp track-funds --network bittensor --trusted-addresses "${VICTIM_ADDRESS}" --case 1 --max-hops 4 | tee track-funds.txt
find cases reports reports/graphs reports/tables -maxdepth 3 -type f | sort | tee generated-files.txt
cia case resume 1 | tee case-resume.txt
```

## What Worked

- The global `cia` binary was available outside the repo at `/home/aphex5/.local/bin/cia`.
- `cia --version` returned `0.2.13`.
- `cia --help` and `cia mcp --help` rendered usable command help for workspace setup, case management, MCP network/tool discovery, `address-risk`, `track-funds`, and `scam-topology`.
- `cia init .` initialized the fresh external workspace and reported `Files written: 11`.
- Workspace initialization created local guidance and metadata files including `.chain-insights/workspace.json`, `.chain-insights/runtime-skill/SKILL.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`, and template READMEs.
- `cia case open ...` created case `20260524_001_readme-dx-dogfood-victim-address`.
- `cia case list` displayed the new case as numbered selector `1`.
- `cia mcp track-funds ... --max-hops 4` accepted the `--max-hops` flag shape; it failed later on endpoint fetch rather than argument parsing.

## Friction

- `cia mcp networks` could not reach the configured local metadata endpoint in this dogfood environment and printed: `network capabilities unavailable at http://localhost:8012/metadata/networks: fetch failed`.
- `cia mcp tools --refresh` printed: `fetch failed`.
- `cia mcp track-funds --network bittensor --trusted-addresses "${VICTIM_ADDRESS}" --case 1 --max-hops 4` printed: `fetch failed`.
- The failing MCP commands wrote errors to stderr, so the requested `tee` output files were empty even though the terminal showed the errors.
- `cia case resume 1` is not available in CLI `0.2.13`; it printed: `error: unknown command 'resume'`.
- No reports, graph files, tables, or compact evidence outputs were generated because MCP calls could not fetch from the endpoint.

## Files Created

```text
.chain-insights/runtime-skill/SKILL.md
.chain-insights/runtime/.keep
.chain-insights/schema/README.md
.chain-insights/workspace.json
AGENTS.md
CLAUDE.md
README.md
imports/README.md
templates/README.md
templates/case-brief.md
cases/20260524_001_readme-dx-dogfood-victim-address/case.md
cases/20260524_001_readme-dx-dogfood-victim-address/manifest.json
generated-files.txt
networks.txt
tools.txt
track-funds.txt
case-resume.txt
```

`generated-files.txt` contained only:

```text
cases/20260524_001_readme-dx-dogfood-victim-address/case.md
cases/20260524_001_readme-dx-dogfood-victim-address/manifest.json
```

## README Improvements Derived From This Run

- Document how to inspect the configured MCP endpoint before the first `cia mcp networks` command, especially when a developer environment is pointed at local GraphRAG MCP on `http://localhost:8012`.
- Add a quick preflight such as `cia status`, `cia debug status`, or an endpoint health check so a new developer can distinguish missing local Graph MCP from CLI misuse.
- Explain that MCP discovery and investigation commands may emit endpoint/auth failures on stderr, so `cmd | tee file.txt` may produce an empty file unless stderr is redirected.
- Replace or qualify any README flow that instructs `cia case resume`; CLI `0.2.13` does not expose that command.
- Keep `--max-hops` in the `track-funds` example for this CLI version; the command accepted the flag and failed only when attempting the remote fetch.

## CLI Or Docs Follow-Ups

- Decide whether `cia case resume` should be implemented, aliased to an existing case-inspection command, or removed from docs and plans.
- Improve MCP fetch failures with actionable remediation, for example endpoint URL, debug/access-key mode hints, and the command to configure the endpoint.
- Consider documenting stderr capture in dogfood instructions when `tee` artifacts are expected for failed commands.
