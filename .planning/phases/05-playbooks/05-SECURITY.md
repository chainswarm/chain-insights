---
phase: 05
slug: playbooks
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-11
---

# Phase 05 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| CLI arg -> playbook name | User-supplied playbook name selects user or built-in playbook content | local filesystem path segment / built-in map key |
| Playbook file -> step.tool | Markdown-declared tool name is passed to MCP `callTool` | MCP tool identifier |
| Playbook file / CLI params -> step.params | Markdown and CLI parameters are injected into MCP arguments | JSON-compatible MCP arguments |
| MCP result -> case evidence | External MCP response is persisted as case evidence | investigation evidence content |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-05-01 | Tampering | `resolver.ts` — name -> file path | mitigate | `resolvePlaybook()` and `resolvePlaybookContent()` sanitize names with `name.replace(/[^a-z0-9_-]/gi, '')` before path construction. | closed |
| T-05-02 | Tampering | `runner.ts` — `step.tool` -> `callTool` | mitigate | `StepSchema.tool` enforces `z.string().min(1)` and `PlaybookRunner` calls `validateStepTools()` against live MCP `listTools()` before execution. | closed |
| T-05-03 | Tampering | `parser.ts` — `{{param}}` substitution | accept | Params are passed as MCP JSON arguments, not interpolated into shell commands. Accepted risk documented below. | closed |
| T-05-04 | Denial of Service | `runner.ts` — timeout retry loop | mitigate | `callWithRetry()` caps timeout retries at 3 attempts with 1s sleep; payment failures require explicit retry/skip/abort in TTY mode or abort in non-TTY mode. | closed |
| T-05-05 | Information Disclosure | `runner.ts` / evidence files | accept | `EvidenceStore.append()` writes evidence and manifest files with `mode: 0o600`; accepted residual local-filesystem risk documented below. | closed |
| T-05-06 | Tampering | `cli.ts` — `--param` parsing | mitigate | CLI parses each `key=value` using `indexOf('=')`, rejects missing `=` and empty keys, and never passes values to shell. | closed |
| T-05-07 | Tampering | `builtins.ts` — tool names | accept | Built-in tool names are TypeScript constants and `PlaybookRunner` validates them against live MCP tools before execution. Accepted misconfiguration risk documented below. | closed |
| T-05-08 | Denial of Service | `cli.ts` — unbounded `--param` count | accept | Commander accumulates params; downstream MCP argument validation is the gate. Low-risk local CLI behavior accepted below. | closed |
| T-05-09 | Information Disclosure | `cli.ts` — error output | mitigate | Playbook CLI actions use `console.error()` and `process.exit(1)` for errors. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-05-01 | T-05-03 | Playbook params are passed as MCP JSON arguments and are not shell-interpolated. Residual risk is delegated to MCP tool argument validation. | project owner | 2026-05-11 |
| AR-05-02 | T-05-05 | Evidence is local investigator data under `~/.chain-insights/cases/`; files are written with `0o600`. Residual endpoint/filesystem access risk is accepted for local CLI scope. | project owner | 2026-05-11 |
| AR-05-03 | T-05-07 | Built-in playbook tool names are constants and validated against live MCP `listTools()` before execution. Residual risk is failed execution if MCP schema changes. | project owner | 2026-05-11 |
| AR-05-04 | T-05-08 | Unbounded local CLI param count is low risk; MCP schema/tool validation remains the downstream enforcement point. | project owner | 2026-05-11 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-11 | 9 | 9 | 0 | Codex |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-11
