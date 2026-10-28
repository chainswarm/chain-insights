#!/usr/bin/env bash
# T2 (integration): the vitest t2 project against real binaries on this host.
#
# Today one suite: tests/subscription-buy.t2.test.ts runs `cia subscription
# buy` against anvil (Foundry) started with chain ID 4663, with the pinned
# McpPermitSink runtime at the real sink address. No live node is reached.
#
# anvil comes from ANVIL_BIN, PATH, ~/.foundry/bin, or else the pinned Foundry
# release, fetched once into .ci/foundry and checked against its sha256.
#
# Artifacts: .ci/t2/vitest.log.
# Prints exactly one budget line: "T2 test phase: <n>s (budget 600s)".
set -euo pipefail

cd "$(dirname "$0")/.."
budget=600
out=.ci/t2
mkdir -p "$out"

# shellcheck source=ci/install.sh
. ci/install.sh
ci_install

foundry_version=v1.8.1
foundry_sha256=37b45855232e57624d90113b049ca54f0c92055bb5c1997fcbdc3076c7b89c10

if [ -z "${ANVIL_BIN:-}" ]; then
  if command -v anvil >/dev/null 2>&1; then
    ANVIL_BIN="$(command -v anvil)"
  elif [ -x "$HOME/.foundry/bin/anvil" ]; then
    ANVIL_BIN="$HOME/.foundry/bin/anvil"
  else
    dir=".ci/foundry/$foundry_version"
    if [ ! -x "$dir/anvil" ]; then
      mkdir -p "$dir"
      tarball="$dir/foundry.tar.gz"
      echo "t2: fetching Foundry $foundry_version (anvil)"
      curl -fsSL -o "$tarball" \
        "https://github.com/foundry-rs/foundry/releases/download/$foundry_version/foundry_${foundry_version}_linux_amd64.tar.gz"
      echo "$foundry_sha256  $tarball" | sha256sum -c -
      tar -xzf "$tarball" -C "$dir" anvil
      rm "$tarball"
    fi
    ANVIL_BIN="$PWD/$dir/anvil"
  fi
fi
export ANVIL_BIN
echo "t2: $("$ANVIL_BIN" --version | head -n1)"

set +e
start=$(date +%s)
npx vitest run --project t2 2>&1 | tee "$out/vitest.log"
test_status=${PIPESTATUS[0]}
seconds=$(( $(date +%s) - start ))
set -e

echo "T2 test phase: ${seconds}s (budget ${budget}s)"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "T2 test phase: ${seconds}s (budget ${budget}s)" >>"$GITHUB_STEP_SUMMARY"
fi
if [ "$test_status" -ne 0 ]; then exit "$test_status"; fi
if [ "$seconds" -gt "$budget" ]; then
  echo "T2 took ${seconds}s, over the ${budget}s budget" >&2
  exit 1
fi
