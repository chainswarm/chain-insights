#!/usr/bin/env bash
# T1 (unit): the vitest suite with coverage, after the typecheck and the build.
#
# The one file the T1 job of .github/workflows/verify.yml runs and the one
# file the local gate (AP1000 scripts/ci-local.sh) runs. The budget measures
# `vitest run --coverage` and nothing else: the install, the typecheck and the
# build sit outside it. The build is a test dependency, not a tier step here:
# tests/viz-cli.test.ts and the CLI tests spawn bin/cli.js, which loads
# dist/cli.mjs (AGENTS.md: `npm test` does not rebuild dist/).
#
# One coverage run covers the two workflow steps `npm test` and
# `npm run test:coverage`: the same tests run once, and vitest.config.ts
# enforces the coverage ratchet on that run.
#
# dist/ is shared with ci/build.sh, so the whole run holds .ci/dist.lock;
# the two tiers take turns when the driver starts them together.
#
# Artifacts: .ci/t1/typecheck.log, vitest.log, coverage-summary.json,
# lcov.info, summary.md.
# Prints exactly one budget line: "T1 test phase: <n>s (budget 180s)".
set -euo pipefail

cd "$(dirname "$0")/.."
budget=180
out=.ci/t1
mkdir -p "$out"
summary="${GITHUB_STEP_SUMMARY:-$out/step-summary.md}"

# shellcheck source=ci/install.sh
. ci/install.sh
ci_install

exec 9>.ci/dist.lock
flock 9

# Typecheck and build (outside the budget).
npm run typecheck 2>&1 | tee "$out/typecheck.log"
npm run build >"$out/build.log" 2>&1

set +e
start=$(date +%s)
npm run test:coverage 2>&1 | tee "$out/vitest.log"
test_status=${PIPESTATUS[0]}
seconds=$(( $(date +%s) - start ))
set -e

if [ -f coverage/coverage-summary.json ]; then
  cp coverage/coverage-summary.json "$out/coverage-summary.json"
  [ ! -f coverage/lcov.info ] || cp coverage/lcov.info "$out/lcov.info"
  node -e "
    const s = require('./coverage/coverage-summary.json').total
    const rows = ['lines','statements','functions','branches']
      .map(k => '| ' + k + ' | ' + s[k].pct + '% |')
    require('fs').writeFileSync('$out/summary.md',
      '### Coverage\n\n| metric | pct |\n| --- | --- |\n' + rows.join('\n') + '\n')
  "
  cat "$out/summary.md" >>"$summary"
else
  echo "coverage unavailable: coverage/coverage-summary.json was not written" | tee "$out/summary.md"
fi

echo "T1 test phase: ${seconds}s (budget ${budget}s)"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "T1 test phase: ${seconds}s (budget ${budget}s)" >>"$GITHUB_STEP_SUMMARY"
fi

if [ "$test_status" -ne 0 ]; then exit "$test_status"; fi
if [ "$seconds" -gt "$budget" ]; then
  echo "T1 took ${seconds}s, over the ${budget}s budget: a slow test is doing I/O or waiting on a timer" >&2
  exit 1
fi
