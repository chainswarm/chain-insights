---
phase: 05-playbooks
type: validation
created: 2026-05-11
---

# Phase 05: Playbooks — Validation Strategy

## Test Map

| Wave | File | Covers | Sampling |
|------|------|--------|----------|
| 0 | tests/playbook-parser.test.ts | PLAY-01: parser + schema | 100% |
| 0 | tests/playbook-runner.test.ts | PLAY-01: runner execution | 100% |
| 0 | tests/playbook-resolver.test.ts | PLAY-01: name resolution | 100% |
| 0 | tests/playbook-builtins.test.ts | PLAY-02: built-in definitions | 100% |
| 0 | tests/playbook-cli.test.ts | PLAY-01: CLI integration | 100% |

## Coverage Requirements

- All PLAY-01 behaviors: parser, resolver, runner, CLI wiring
- All PLAY-02 behaviors: 3 built-in playbooks parse and resolve correctly
- Integration: CLI → resolver → parser → runner chain

## Human Verification

- Run `chain-insights playbook run trace-funds --dry-run -p address=0xdeadbeef` and verify step output
- Run `chain-insights playbook list` and verify 3 built-in playbooks listed
