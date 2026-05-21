---
phase: 05-playbooks
fixed_at: 2026-05-11T13:00:00Z
review_path: .planning/phases/05-playbooks/05-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-05-11T13:00:00Z
**Source review:** .planning/phases/05-playbooks/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (CR-01, CR-02, WR-01, WR-02, WR-03, WR-04, WR-05)
- Fixed: 7
- Skipped: 0

## Fixed Issues

### CR-01: `config.mcpEndpoint` passed as private key to `createMcpFetchClient`

**Files modified:** `src/playbooks/runner.ts`, `tests/playbook-runner.test.ts`
**Commit:** 21899ab (source fix), fe9ff34 (test mock)
**Applied fix:** Replaced `config.mcpEndpoint as 0x${string}` with `await decryptKey()` from the wallet module. The MCP fetch client now receives the actual EVM private key, matching the pattern used in `src/cli.ts` lines 127/171.

### CR-02: Runner never checks whether wallet is configured before making paid MCP calls

**Files modified:** `src/playbooks/runner.ts`
**Commit:** 21899ab
**Applied fix:** Added `isWalletConfigured()` guard before creating the MCP connection. If wallet is not configured, throws a clear human-readable error: "Wallet not configured. Run `chain-insights config set walletPrivateKey <key>` to enable paid MCP calls."

### WR-01: `--from 0` silently runs only the last step (off-by-one via negative slice)

**Files modified:** `src/cli.ts`
**Commit:** 96a998d
**Applied fix:** Added explicit `isNaN(fromN) || fromN < 1` validation after `parseInt(opts.from, 10)`. Invalid values (0, negative, non-numeric) now print a clear error message and exit(1) instead of silently slicing wrong steps.

### WR-02: Error resume message prints inverted range when first resumed step fails

**Files modified:** `src/playbooks/runner.ts`
**Commit:** 81ffd74
**Applied fix:** Replaced the unused `completedCount` variable with `completedSteps` (step.index - 1 - startIndex) and `completedMsg` that guards against the inverted-range case: when `completedSteps <= 0`, prints "No steps completed before failure." instead of "Completed: steps 2..1".

### WR-03: `isPaymentError` matches on substrings that cause false positives

**Files modified:** `src/playbooks/runner.ts`, `tests/playbook-runner.test.ts`
**Commit:** aebae77 (source fix), fe9ff34 (test update)
**Applied fix:** Replaced broad `'insufficient' || '402' || 'payment'` matches with specific `'http 402' || 'status 402' || 'payment required' || 'x402'` patterns. Also updated the payment-error test to use "HTTP 402 Payment Required" as the error message (which now correctly triggers the payment code path).

### WR-04: `required` field YAML coercion is case-sensitive — `required: FALSE` treated as `true`

**Files modified:** `src/playbooks/parser.ts`
**Commit:** 51344b7
**Applied fix:** Added `.toLowerCase()` before the `!== 'false'` comparison so that YAML boolean variants (FALSE, False, NO, No) all correctly resolve to `required: false`.

### WR-05: `resolvePlaybookContent` is untested — only the deprecated `resolvePlaybook` is covered

**Files modified:** `tests/playbook-resolver.test.ts`
**Commit:** 31c2842
**Applied fix:** Added `readFile: vi.fn()` to the existing `node:fs/promises` mock, then added a new `resolvePlaybookContent` describe block with four tests: user-file-exists path (readFile resolves with content), ENOENT fallback to built-in (trace-funds), unknown name throws "Playbook not found", and invalid name throws "Invalid playbook name".

---

**Test suite after all fixes:** 195/195 tests passing (25 test files).

_Fixed: 2026-05-11T13:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
