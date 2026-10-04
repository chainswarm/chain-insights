#!/usr/bin/env bash
# build: the package build and the checks that read the built package.
#
# The one file the build job of .github/workflows/verify.yml runs and the one
# file the local gate (AP1000 scripts/ci-local.sh) runs. No budget: nothing
# here is a test.
#
#   1. `npm run build` (tsdown, then the proxy assets into dist/)
#   2. `npm run lint:package` (publint over package.json and dist/)
#   3. `npm run check:types-resolution` (attw over a packed tarball)
#   4. the release gate (`npm run release:check`) when this branch changes a
#      release-bearing file against the base: anything outside .github/**.
#      The base is origin/main, or RELEASE_GATE_BASE_REF. On the base itself
#      nothing changed and the gate is skipped, as the workflow skipped it
#      outside a pull request.
#   5. the package contents: `npm pack`, list the tarball, remove it
#
# dist/ is shared with ci/t1.sh, so the whole run holds .ci/dist.lock; the two
# tiers take turns when the driver starts them together.
#
# Artifacts: .ci/build/build.log, publint.log, attw.log, release-gate.log,
# pack-contents.txt.
set -euo pipefail

cd "$(dirname "$0")/.."
out=.ci/build
mkdir -p "$out"

# shellcheck source=ci/install.sh
. ci/install.sh
ci_install

base="${RELEASE_GATE_BASE_REF:-origin/main}"
case "$base" in origin/*) ;; *) base="origin/$base" ;; esac
if ! git rev-parse -q --verify "$base" >/dev/null; then
  git fetch --no-tags --depth=1 origin "${base#origin/}:refs/remotes/$base"
fi

exec 9>.ci/dist.lock
flock 9

echo "build: npm run build"
npm run build 2>&1 | tee "$out/build.log"

echo "build: publint"
npm run lint:package 2>&1 | tee "$out/publint.log"

echo "build: types resolution (attw)"
npm run check:types-resolution 2>&1 | tee "$out/attw.log"

if git diff --quiet "$base...HEAD" -- . ':(exclude).github/**'; then
  echo "build: release gate skipped, no release-bearing change against $base" | tee "$out/release-gate.log"
else
  echo "build: release gate against $base"
  RELEASE_GATE_BASE_REF="$base" npm run release:check 2>&1 | tee "$out/release-gate.log"
fi

echo "build: package contents"
# `npm pack` runs the `prepare` lifecycle script (tsdown build); that child
# process's stdout is not silenced by --silent and is interleaved with npm's
# own printed tarball filename. The tarball filename is always npm's own
# final line of output, so take the last line rather than the whole capture.
package_file="$(npm pack --silent | tail -n1)"
tar -tf "$package_file" | tee "$out/pack-contents.txt"
rm "$package_file"

echo "build: clean"
