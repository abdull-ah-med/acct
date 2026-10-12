#!/usr/bin/env bash
# Run the CI workflow (.github/workflows/ci.yml) locally before pushing.
#
#   npm run ci:local            # macOS (native) + Linux Node 20/22 (Docker)
#   npm run ci:local -- linux   # only the Linux cells
#   npm run ci:local -- host    # only the host (native) cell
#
# Each cell starts from a fresh copy of the files git would commit (tracked +
# untracked, minus ignored), so local node_modules/dist/caches can't hide a
# failure. Linux runs as the image's non-root `node` user, like GitHub's
# runners, and without zsh/fish, like ubuntu-latest. Debian 13 (trixie) images
# are used for a git close to the runners' (bookworm's git 2.39 is too old for
# `git hook run --to-stdin`, which the tests use).
#
# Windows cannot run here: push the branch and wait for the Windows jobs
# before merging to main (docs/testing.md).
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
only="${1:-all}"
work="$(mktemp -d "${TMPDIR:-/tmp}/acct-ci-local.XXXXXX")"
trap 'rm -rf "$work"' EXIT

snapshot() {
  local dest="$1"
  mkdir -p "$dest"
  (cd "$repo" && git ls-files -z --cached --others --exclude-standard) |
    (cd "$repo" && xargs -0 -I{} rsync -R --quiet {} "$dest/")
}

# Steps shared by every cell; mirrors the lint/test/package/security/e2e jobs.
read -r -d '' STEPS <<'EOS' || true
set -euo pipefail
step() { printf '\n=== %s ===\n' "$*"; "$@"; }
step npm ci --no-audit --no-fund
step npm run lint
step npm run format:check
step npm run build
step npm test
if [ "${FULL:-0}" = 1 ]; then
  step npm run pack:check
  tgz="$(npm pack --silent)"
  tar -tzf "$tgz" > /tmp/acct-pack.list
  for f in bin/acct.js bin/git-credential-acct.js dist/cli/index.js LICENSE \
           README.md CHANGELOG.md og.jpeg logo.svg; do
    grep -qx "package/$f" /tmp/acct-pack.list || { echo "missing $f in tarball" >&2; exit 1; }
  done
  if grep -E '^package/(src|tests)/' /tmp/acct-pack.list; then
    echo "Published package must not include src/ or tests/" >&2; exit 1
  fi
  rm -f "$tgz"
  step npm run pack:smoke
  ACCT_SECRET_BACKEND=file step npm run test:security
  ACCT_SECRET_BACKEND=file step npm run test:e2e
fi
echo "CELL OK"
EOS

results=()
run_cell() {
  local name="$1"; shift
  printf '\n##### %s #####\n' "$name"
  if "$@"; then results+=("PASS  $name"); else results+=("FAIL  $name"); fi
}

host_cell() {
  local dir="$work/host"
  snapshot "$dir"
  (cd "$dir" && FULL=1 bash -c "$STEPS")
}

linux_cell() {
  local node="$1" full="$2" dir="$work/linux-$1"
  snapshot "$dir"
  chmod -R a+rX "$dir"
  docker run --rm --user node -e FULL="$full" -e STEPS="$STEPS" \
    -v "$dir:/src:ro" "node:${node}-trixie" \
    bash -c 'cp -R /src "$HOME/w" && cd "$HOME/w" && bash -c "$STEPS"'
}

case "$only" in
  all|host) run_cell "$(uname -s) host (Node $(node -p process.versions.node), full)" host_cell ;;
esac
case "$only" in
  all|linux)
    run_cell "Linux Node 20 (test)" linux_cell 20 0
    run_cell "Linux Node 22 (full)" linux_cell 22 1
    ;;
esac

printf '\n===== ci:local summary =====\n'
printf '%s\n' "${results[@]}"
printf 'Not covered locally: Windows (push the branch; wait for windows-latest jobs).\n'
for r in "${results[@]}"; do [[ "$r" == PASS* ]] || exit 1; done
