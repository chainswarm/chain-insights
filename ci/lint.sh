#!/usr/bin/env bash
# lint: the static checks. No test runs and no build here.
#
# The one file the lint job of .github/workflows/verify.yml and the secret
# scan job of .github/workflows/security.yml run, and the one file the local
# gate (AP1000 scripts/ci-local.sh) runs.
#
#   1. oxlint over src and tests (`npm run lint`)
#   2. the high-confidence secret pattern scan over tracked files, with the
#      exact public values of .github/secret-scan-allowlist.txt dropped
#   3. the secret egress scan over the code files this branch changes
#      against the base (origin/main, or RELEASE_GATE_BASE_REF); on the base
#      itself nothing changed and the scan passes
#
# The budget covers the three checks; the install sits outside it.
#
# Artifacts: .ci/lint/oxlint.log, secret-scan.log, egress-scan.log.
# Prints exactly one budget line: "LINT test phase: <n>s (budget 120s)".
set -euo pipefail

cd "$(dirname "$0")/.."
budget=120
out=.ci/lint
mkdir -p "$out"

# shellcheck source=ci/install.sh
. ci/install.sh
ci_install

base="${RELEASE_GATE_BASE_REF:-origin/main}"
case "$base" in origin/*) ;; *) base="origin/$base" ;; esac
if ! git rev-parse -q --verify "$base" >/dev/null; then
  git fetch --no-tags --depth=1 origin "${base#origin/}:refs/remotes/$base"
fi

start=$(date +%s)

echo "lint: oxlint"
npm run lint 2>&1 | tee "$out/oxlint.log"

echo "lint: secret pattern scan"
pattern='(0x[0-9a-fA-F]{64}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b(ghp|github_pat|xox[baprs]|AKIA|ASIA|sk|pk|rk)[_-][A-Za-z0-9_-]{16,}\b)'
# Keep the scan broad enough to cover tests, but exempt the small set of
# fixtures that intentionally contain fake secret-shaped values. Exact public
# values (on-chain transaction hashes used as examples) live in
# .github/secret-scan-allowlist.txt; a line is dropped only when every match
# on it is one of those exact values.
allow=$(grep -vE '^\s*(#|$)' .github/secret-scan-allowlist.txt || true)
hits=$(git grep -n -I -E "$pattern" -- \
  . \
  ':(exclude)package-lock.json' \
  ':(exclude)tests/cli-mcp.test.ts' \
  ':(exclude)tests/mcp-client.test.ts' \
  ':(exclude)tests/mcp-proxy.test.ts' \
  ':(exclude)tests/wallet.test.ts' \
  ':(exclude)tests/wallet-tools.test.ts' \
  ':(exclude)tests/wallet-proof.test.ts' || true)
left=""
while IFS= read -r line; do
  [ -n "$line" ] || continue
  rest=$(printf '%s\n' "$line" | cut -d: -f3-)
  if [ -n "$allow" ]; then
    while IFS= read -r value; do rest=${rest//"$value"/}; done <<<"$allow"
  fi
  if printf '%s\n' "$rest" | grep -qE "$pattern"; then left="$left$line"$'\n'; fi
done <<<"$hits"
printf '%s' "$left" >"$out/secret-scan.log"
if [ -n "$left" ]; then
  printf '%s' "$left"
  echo "High-confidence secret-looking value found in tracked files." >&2
  exit 1
fi

echo "lint: secret egress scan of the code files changed against $base"
mapfile -d '' changed_files < <(
  git diff --name-only -z "$base...HEAD" -- \
    '*.js' '*.jsx' '*.ts' '*.tsx' '*.mjs' '*.cjs' '*.sh' '*.yml' '*.yaml'
)
egress_pattern='console\.(log|error|warn|info|debug|trace)\s*\(.*(process\.env|secret|token|key|password|private_key)'
egress_pattern+="|(^|[[:space:]])(echo|cat|printf)\s+.*\\\$\{?(GITHUB_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN|AWS_SECRET_ACCESS_KEY|API_KEY|PRIVATE_KEY|AUTH_TOKEN|SECRETS?)\}?"
: >"$out/egress-scan.log"
if [ "${#changed_files[@]}" -eq 0 ]; then
  echo "no code file changed against $base"
fi
# Only the lines this branch adds are scanned: a file's untouched lines were
# scanned when they were added, and re-flagging them blocks any later edit.
for f in "${changed_files[@]+"${changed_files[@]}"}"; do
  [ -f "$f" ] || continue
  hits_in_file="$(git diff -U0 "$base...HEAD" -- "$f" | grep -E '^\+' | grep -vE '^\+\+\+ ' | sed 's/^+//' | grep -nE "$egress_pattern" || true)"
  if [ -n "$hits_in_file" ]; then
    printf '%s\n' "$hits_in_file" | tee -a "$out/egress-scan.log"
    echo "Potential secret-evasion output pattern in $f" >&2
    exit 1
  fi
done

seconds=$(( $(date +%s) - start ))
echo "LINT test phase: ${seconds}s (budget ${budget}s)"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "LINT test phase: ${seconds}s (budget ${budget}s)" >>"$GITHUB_STEP_SUMMARY"
fi
if [ "$seconds" -gt "$budget" ]; then
  echo "lint took ${seconds}s, over the ${budget}s budget" >&2
  exit 1
fi
echo "lint: clean"
