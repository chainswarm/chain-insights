---
phase: 05-playbooks
reviewed: 2026-05-11T00:00:00Z
depth: standard
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
  critical: 2
  warning: 5
  info: 4
  total: 11
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-05-11T00:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Reviewed the playbook engine implementation: schema, parser, resolver, runner, builtins, CLI wiring, and all test coverage. The parser and resolver are solid — correct path sanitization, proper YAML array parsing, and clean template substitution. The schema is minimal and correct.

The runner has two blockers: it passes the MCP endpoint URL as a private key argument (wrong value, wrong type), and it never checks whether a wallet is configured before attempting x402 MCP calls. Both will cause runtime failures on any non-dry-run execution. Tests mask these bugs because `createMcpFetchClient` is mocked to return `fetch` directly.

Additional warnings exist around unvalidated `--from` input, a misleading error resume message, a false-positive payment detection pattern, and a dead variable.

---

## Critical Issues

### CR-01: `config.mcpEndpoint` passed as private key to `createMcpFetchClient`

**File:** `src/playbooks/runner.ts:113`
**Issue:** `createMcpFetchClient` expects an `0x`-prefixed EVM private key (it calls `privateKeyToAccount(privateKey)` internally). The runner passes `config.mcpEndpoint` — an HTTP URL string like `"http://localhost:3000/mcp"` — cast with `as \`0x${string}\``. At runtime `privateKeyToAccount` will throw an invalid key error on every non-dry-run playbook execution. Compare with `src/cli.ts` lines 127/171 where `decryptKey()` is called before `createMcpFetchClient`.

**Fix:**
```typescript
// Replace lines 112-117 in runner.ts with:
const { isWalletConfigured, decryptKey } = await import('../wallet/index.js')
if (!(await isWalletConfigured())) {
  throw new Error(
    'Wallet not configured. Run `chain-insights config set walletPrivateKey <key>` to enable paid MCP calls.'
  )
}
const privateKey = await decryptKey()
const paymentFetch = createMcpFetchClient(privateKey as `0x${string}`)
const client = new Client({ name: 'chain-insights-playbook', version: '0.1.0' })
await client.connect(
  new StreamableHTTPClientTransport(new URL(config.mcpEndpoint), { fetch: paymentFetch })
)
```

### CR-02: Runner never checks whether wallet is configured before making paid MCP calls

**File:** `src/playbooks/runner.ts:111-117`
**Issue:** No call to `isWalletConfigured()` before creating the MCP connection. Every other command that calls into the MCP (`mcp tools`, `mcp call`) guards with `isWalletConfigured()` before proceeding. Without the guard, the runner proceeds to connect and call tools with an invalid payment client, producing a confusing internal error rather than a clear "wallet not configured" message. This is both a UX failure and a logic error — the payment error handler at line 130 will never receive a proper `402` payment required signal because the client itself is broken.

**Fix:** Apply the guard shown in CR-01 above. The `isWalletConfigured` + `decryptKey` call should be added before MCP connection setup.

---

## Warnings

### WR-01: `--from 0` silently runs only the last step (off-by-one via negative slice)

**File:** `src/playbooks/runner.ts:74-75` / `src/cli.ts:495`
**Issue:** `opts.from` is parsed with `parseInt(opts.from, 10)`. When `--from 0` is passed, `startIndex = (0 ?? 1) - 1 = -1`. Then `playbook.steps.slice(-1)` returns only the last step. The user likely expected an error or full execution. Similarly, `--from abc` produces `NaN`, and `slice(NaN)` is equivalent to `slice(0)` — silently running all steps while the user thinks they resumed from a specific step.

**Fix:**
```typescript
// In cli.ts action handler for playbook run, after parseInt:
const fromN = parseInt(opts.from, 10)
if (isNaN(fromN) || fromN < 1) {
  console.error(`Invalid --from value: "${opts.from}". Must be a positive integer.`)
  process.exit(1)
}
// Pass fromN to PlaybookRunner.run
```

### WR-02: Error resume message prints inverted range when first resumed step fails

**File:** `src/playbooks/runner.ts:157-161`
**Issue:** The `completedCount` variable is assigned but never used in the error message. Worse, the message `"Completed: steps ${startIndex + 1}..${step.index - 1}"` produces an inverted range when the first resumed step fails. Example: `--from 2` sets `startIndex=1`; if step 2 fails immediately, the message prints `"Completed: steps 2..1"` — semantically nonsensical.

**Fix:**
```typescript
// Replace lines 157-162:
const completedSteps = step.index - 1 - startIndex
const completedMsg = completedSteps > 0
  ? `Completed: steps ${startIndex + 1}..${step.index - 1}.`
  : 'No steps completed before failure.'
console.error(
  `Step ${step.index} failed: ${(err as Error).message}. ` +
  `${completedMsg} Run with --from ${step.index} to resume.`
)
```
Also remove the unused `completedCount` variable.

### WR-03: `isPaymentError` matches on substrings that cause false positives

**File:** `src/playbooks/runner.ts:31-34`
**Issue:** The function matches any error message containing `"insufficient"`, `"402"`, or `"payment"`. Legitimate MCP tool errors can trigger this: an error like `"insufficient data in response"` or `"HTTP status 4029"` (note: `"4029"` contains `"402"`) would be treated as a payment failure and incorrectly prompt the user to retry or pay. This could mask real tool errors as payment issues.

**Fix:**
```typescript
function isPaymentError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  // Match HTTP 402 status more precisely, or x402-specific error signals
  return msg.includes('http 402') ||
         msg.includes('status 402') ||
         msg.includes('payment required') ||
         msg.includes('x402')
}
```

### WR-04: `required` field YAML coercion is case-sensitive — `required: FALSE` treated as `true`

**File:** `src/playbooks/parser.ts:191-194`
**Issue:** The coercion `raw['required'] !== 'false'` is a strict string comparison. Any capitalization variant of `false` in YAML (`FALSE`, `False`, `no`, `No`) is treated as `required: true`. Playbook authors writing `required: FALSE` or `required: False` (both valid YAML booleans) will get unexpected behavior where the parameter appears required.

**Fix:**
```typescript
required: raw['required'] !== undefined
  ? raw['required'].toLowerCase() !== 'false'
  : true,
```

### WR-05: `resolvePlaybookContent` is untested — only the deprecated `resolvePlaybook` is covered

**File:** `tests/playbook-resolver.test.ts` (all tests) / `src/playbooks/resolver.ts:48-68`
**Issue:** The resolver test file mocks `node:fs/promises` with `access` and `readdir`, but `resolvePlaybookContent` (the primary function used by the CLI) calls `readFile`, which is not mocked. All resolver tests call `resolvePlaybook` (marked `@deprecated`), leaving `resolvePlaybookContent`'s `readFile` user-file path and fallback logic completely without test coverage. Bugs in that path (e.g., error types other than ENOENT silently falling through) would go undetected.

**Fix:** Add tests for `resolvePlaybookContent` that mock `readFile` for the user-file-exists path and the ENOENT fallback path.

---

## Info

### IN-01: Dead code — `throw lastErr` at end of `callWithRetry` is unreachable

**File:** `src/playbooks/runner.ts:63`
**Issue:** The `throw lastErr` statement after the retry loop is unreachable. Every exit path from the loop either returns early (success), re-throws `err` immediately when the timeout check fails (`attempt === MAX_ATTEMPTS`), or continues to the next iteration. The loop never exits by falling through; it always throws or returns. The `lastErr` variable is set but only ever replaced on the final retried error — which is then re-thrown directly as `err`.

**Fix:** Remove `let lastErr: unknown` and `throw lastErr`. Simplify the loop:
```typescript
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    const result = await client.callTool({ name: toolName, arguments: params })
    const content = result.content as Array<{ type: string; text?: string }>
    return content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n')
  } catch (err) {
    if (isTimeoutError(err) && attempt < MAX_ATTEMPTS) {
      await sleep(1000)
      continue
    }
    throw err
  }
}
```

### IN-02: `opts.expectError` parameter in `runCLI` test helper is declared but never used

**File:** `tests/playbook-cli.test.ts:5`
**Issue:** The `runCLI` helper accepts `opts: { expectError?: boolean }` but never reads `opts.expectError` inside the function body. The parameter is dead — it is never passed by any test call site either. This is misleading dead API surface.

**Fix:** Remove the `opts` parameter entirely:
```typescript
function runCLI(args: string) {
  const result = spawnSync('node', ['bin/cli.js', ...args.split(' ')], {
    encoding: 'utf8',
    env: { ...process.env },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.status ?? 0,
    output: (result.stdout ?? '') + (result.stderr ?? ''),
  }
}
```

### IN-03: `extractFencedBlock` uses `'m'` (multiline) regex flag that has no effect on the pattern

**File:** `src/playbooks/parser.ts:17`
**Issue:** The regex `new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'm')` uses the `m` flag, which only changes the meaning of `^` and `$` anchors. Neither anchor is present in this pattern. The `[\s\S]*?` already matches across newlines without any flag. The `m` flag is a no-op here and may mislead future maintainers into thinking it enables something.

**Fix:** Remove the `'m'` flag:
```typescript
const re = new RegExp('```' + lang + '\\n([\\s\\S]*?)```')
```

### IN-04: `execSync` used in success-path CLI tests — will throw and fail the test suite if CLI exits non-zero

**File:** `tests/playbook-cli.test.ts:20-65`
**Issue:** Six tests use `execSync` (which throws on non-zero exit) for the success-path tests. This is fragile: if any of these commands print to stderr and exit non-zero (e.g., a missing `bin/cli.js` file), the test throws an unhandled exception rather than producing a meaningful assertion failure. The error-path tests correctly use `spawnSync` via `runCLI`. Consider using `spawnSync` for all invocations for consistency and better error messages.

**Fix:** Replace `execSync(cmd, { encoding: 'utf8' })` with `runCLI(args).output` (or an equivalent `spawnSync` wrapper that returns stdout for assertion) across the success-path tests.

---

_Reviewed: 2026-05-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
