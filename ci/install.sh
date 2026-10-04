#!/usr/bin/env bash
# install: node_modules from package-lock.json, once per lockfile, under a lock.
#
# Sourced by every tier script (ci/t1.sh, ci/lint.sh, ci/build.sh). The local
# gate (AP1000 scripts/ci-local.sh) starts the tiers in parallel inside one
# worktree, so a bare `npm ci` in each would wipe node_modules under the tier
# next to it. The install runs under .ci/install.lock and leaves a stamp
# (the lockfile's sha256) in node_modules; a tier that finds the stamp
# current skips the install. On a GitHub runner each job has its own
# checkout, the stamp is absent, and the install runs as before:
# `npm ci --ignore-scripts --audit=false --fund=false`.
#
# Lifecycle scripts stay off: `prepare` would run the build, and the build
# is a tier step of its own.
set -euo pipefail

ci_install() {
  local stamp=node_modules/.ci-install-stamp want have=""
  mkdir -p .ci
  want="$(sha256sum package-lock.json | cut -c1-64)"
  exec 8>.ci/install.lock
  flock 8
  [ ! -f "$stamp" ] || have="$(cat "$stamp")"
  if [ "$have" != "$want" ]; then
    echo "install: npm ci (lockfile ${want:0:12})"
    npm ci --ignore-scripts --audit=false --fund=false
    echo "$want" >"$stamp"
  else
    echo "install: node_modules current (lockfile ${want:0:12})"
  fi
  flock -u 8
  exec 8>&-
}
