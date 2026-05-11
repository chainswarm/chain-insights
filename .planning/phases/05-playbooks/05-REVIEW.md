---
phase: 05-playbooks
reviewed: 2026-05-11T00:00:00Z
depth: quick
files_reviewed: 11
files_reviewed_list:
  - src/cli.ts
  - src/playbooks/builtins.ts
  - src/playbooks/parser.ts
  - src/playbooks/resolver.ts
  - src/playbooks/runner.ts
  - src/playbooks/schema.ts
  - tests/playbook-builtins.test.ts
  - tests/playbook-cli.test.ts
  - tests/playbook-parser.test.ts
  - tests/playbook-resolver.test.ts
  - tests/playbook-runner.test.ts
findings:
  critical: 0
  warning: 0
  info: 2
  total: 2
status: issues_found
---

# Phase 05: Code Review Report (Re-Review after fixes)

**Reviewed:** 2026-05-11T00:00:00Z
**Depth:** quick
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Re-review after fixes were applied for CR-01, CR-02, WR-01 through WR-05. All six previously reported blockers and warnings have been correctly resolved:

- **CR-01** (runner passing URL as private key): Fixed. Runner now calls `decryptKey()` and passes the result to `createMcpFetchClient`.
- **CR-02** (missing wallet guard): Fixed. `isWalletConfigured()` is checked before `decryptKey()` in the runner; throws a clear error if not configured.
- **WR-01** (`--from 0` off-by-one): Fixed. CLI now validates `fromN < 1` and rejects zero and negative values.
- **WR-02** (inverted resume error message): Fixed. `completedSteps` arithmetic is correct; message accurately reflects whether prior steps completed.
- **WR-03** (false-positive payment error matching): Fixed. `isPaymentError` now matches `'http 402'`, `'status 402'`, `'payment required'`, and `'x402'` against the lowercased message string.
- **WR-04** (case-sensitive YAML boolean): Fixed. `raw['required'].toLowerCase() !== 'false'` handles `True`/`TRUE`/`False`/`FALSE`.
- **WR-05** (missing `resolvePlaybookContent` tests): Fixed. Full test suite covering user-file path, ENOENT fallback, not-found error, and invalid-name guard is now present.

No new critical or warning issues were introduced. Two minor info items remain from the previous review that were not flagged as requiring fixes.

## Info

### IN-01: Stale `walletPrivateKey` in runner test mock config

**File:** `tests/playbook-runner.test.ts:38`
**Issue:** The `loadConfig` mock includes `walletPrivateKey: '0x...'` in its return value. The runner no longer reads `walletPrivateKey` from config (it calls `decryptKey()` from the wallet module instead — the CR-01 fix). This field is an orphan left over from the pre-fix code and could mislead a future reader into thinking `loadConfig` still supplies the private key.
**Fix:** Remove `walletPrivateKey` from the `loadConfig` mock so the mock reflects the actual return type:
```ts
vi.mock('../src/config/index.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    mcpEndpoint: 'http://localhost:3000/mcp',
    // walletPrivateKey removed — runner uses decryptKey(), not config
  }),
}))
```

### IN-02: `@deprecated` `resolvePlaybook` exported with no removal path or internal guard

**File:** `src/playbooks/resolver.ts:17`
**Issue:** `resolvePlaybook` is marked `@deprecated` (prefer `resolvePlaybookContent`) but remains exported with no removal timeline. The function returns a `builtin:<name>` sentinel string — not a real filesystem path — for built-in playbooks. Any future consumer that treats the return value as a path will fail silently. No production caller in `src/` currently invokes this function; it is only exercised in tests.
**Fix:** Either remove the function (no production callers exist) or add `@internal` to the JSDoc to prevent external consumers from relying on it:
```ts
/**
 * @deprecated Prefer resolvePlaybookContent() which returns markdown directly.
 * @internal Will be removed in a future version.
 */
export async function resolvePlaybook(name: string): Promise<string> {
```

---

_Reviewed: 2026-05-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
