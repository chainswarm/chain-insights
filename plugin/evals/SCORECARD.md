# Eval scorecard

One row per recorded run of the plugin eval suite. `node scripts/eval-kpis.mjs
<run.json> --record "<note>"` adds a row; docs/evals.md says what each number
means.

| Date | Plugin | Model | Cases | Runs | Pass rate | Score | Lift | Deposit precision | Deposit recall | False deposits | Cost USD | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-18 | 0.81.0 | haiku-5.5 | 27 | 81 | 97.5 % | 1.00 | n/a | 100.0 % | 97.0 % | 0 | 0.85 | exchange cases, before the deposit profile (no baseline arm) |
| 2026-11-18 | 0.81.1 | haiku-5.5 | 27 | 81 | 100.0 % | 1.00 | +0.59 | 100.0 % | 100.0 % | 0 | 1.78 | exchange cases, with the deposit profile |
| 2026-11-18 | 0.81.1 | opus-5.5 | 27 | 81 | 100.0 % | 1.00 | +0.51 | 100.0 % | 100.0 % | 0 | 17.47 | exchange cases, with the deposit profile |
| 2026-11-18 | 0.81.1 | haiku-5.5 | 122 | 366 | 66.7 % | 0.86 | +0.40 | 100.0 % | 100.0 % | 0 | 4.74 | every case |
| 2026-11-18 | 0.84.0 | haiku | 25 | 75 | 97.3 % | 1.00 | +0.59 | 100.0 % | 100.0 % | 0 | 1.50 | exchange cases, after the deposit check learned inferred answers (description gains one sentence). Two single-run misses of 75: `reason-holds` on mass-payer (judge votes FAIL PASS FAIL) and `never-says-unsupported` on unproven-claim-binance. No inferred case yet: the lane holds no inferred row to record |
| 2026-11-19 | 0.84.0 | haiku | 6 | 18 | 100.0 % | 1.00 | +0.40 | n/a | n/a | 0 | 0.55 | inferred wallets: 6 cases on the two real lane A addresses (a predicted hot wallet, a deposit behind it) |
