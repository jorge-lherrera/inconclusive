#!/usr/bin/env bash
#
# The differential. A spec that passes proves the dom exists; it does not prove the fix
# did anything. This runs the same spec against two live instances -- the fix and the
# commit before it -- and refuses to say VERIFIED unless it fails without the fix.
#
#   exit 0  VERIFIED               fails without the fix, passes with it
#   exit 2  usage
#   exit 3  INCONCLUSIVE           passes on both: the spec does not touch the bug
#   exit 4  FIX DOES NOT CLOSE IT  still fails with the fix applied
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

SPEC=""
BASE_REF="HEAD"
FIX_REF=""
CONTROL_RUNS="${CONTROL_RUNS:-3}"
PROJECT="${PROJECT:-admin}"
FIX_PORT="${FIX_PORT:-3100}"
CONTROL_PORT="${CONTROL_PORT:-3101}"

usage() {
  cat >&2 <<'USAGE'
usage: bun run ab <spec> [base-ref] [options]

  <spec>            path to the spec, e.g. specs/delete-guard.spec.ts
  [base-ref]        the control arm, default HEAD (the fix is uncommitted)

  --fix-ref <ref>   build the fix arm from a ref too, instead of the working tree
  --control-runs N  how many times the control must fail, default 3
  --project NAME    playwright project, default admin
USAGE
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --fix-ref) FIX_REF="${2:-}"; shift 2 ;;
    --control-runs) CONTROL_RUNS="${2:-}"; shift 2 ;;
    --project) PROJECT="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *)
      if [ -z "$SPEC" ]; then SPEC="$1"; else BASE_REF="$1"; fi
      shift
      ;;
  esac
done

[ -n "$SPEC" ] || usage
[ -f "$SPEC" ] || { echo "no such spec: $SPEC" >&2; exit 2; }

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mABORT: %s\033[0m\n' "$*" >&2; exit 2; }

WORKTREES=()
SERVERS=()

stop_all() {
  for pid in ${SERVERS+"${SERVERS[@]}"}; do
    taskkill //PID "$pid" //T //F >/dev/null 2>&1 || kill -TERM "$pid" 2>/dev/null
  done
  for dir in ${WORKTREES+"${WORKTREES[@]}"}; do
    git worktree remove --force "$dir" >/dev/null 2>&1
    rm -rf "$dir"
  done
}
trap stop_all EXIT

wait_up() {
  local url="$1" tries="${2:-60}"
  for _ in $(seq 1 "$tries"); do
    curl -s -o /dev/null -m 2 "$url" && return 0
    sleep 0.5
  done
  return 1
}

# Worktrees are created OUTSIDE the repository. A control checkout inside the tree gets
# picked up by test discovery, walked by tooling, and -- the day it holds a real config
# -- published.
NEW_WORKTREE=""
new_worktree() {
  local ref="$1" dir
  dir="$(mktemp -d "${TMPDIR:-/tmp}/inconclusive-XXXXXX")"
  rm -rf "$dir"
  git worktree add --detach "$dir" "$ref" >/dev/null 2>&1 || die "cannot create a worktree at $ref"
  WORKTREES+=("$dir")
  NEW_WORKTREE="$dir"
}

serve() {
  local dir="$1" port="$2" log="$3"
  ( cd "$dir" && exec env PORT="$port" bun app/server.ts >"$log" 2>&1 ) &
  SERVERS+=("$!")
}

run_spec() {
  local url="$1"
  E2E_MANAGED_SERVER=0 E2E_BASE_URL="$url" \
    bunx playwright test "$SPEC" --project="$PROJECT" --reporter=list
}

git rev-parse --verify "$BASE_REF" >/dev/null 2>&1 || die "not a ref: $BASE_REF"
BASE_SHA="$(git rev-parse --short "$BASE_REF")"

if [ -n "$FIX_REF" ]; then
  git rev-parse --verify "$FIX_REF" >/dev/null 2>&1 || die "not a ref: $FIX_REF"
  FIX_LABEL="$(git rev-parse --short "$FIX_REF")"
  new_worktree "$FIX_REF"
  FIX_DIR="$NEW_WORKTREE"
else
  FIX_LABEL="$(git describe --always --dirty)"
  FIX_DIR="$ROOT"
fi

say "1/4  the fix arm: $FIX_LABEL on :$FIX_PORT"
serve "$FIX_DIR" "$FIX_PORT" "$ROOT/.fix-server.log"
wait_up "http://localhost:$FIX_PORT" || { tail -20 "$ROOT/.fix-server.log"; die "the fix server did not start"; }

say "2/4  the control arm: $BASE_SHA on :$CONTROL_PORT"
new_worktree "$BASE_REF"
CONTROL_DIR="$NEW_WORKTREE"
serve "$CONTROL_DIR" "$CONTROL_PORT" "$ROOT/.control-server.log"
wait_up "http://localhost:$CONTROL_PORT" || { tail -20 "$ROOT/.control-server.log"; die "the control server did not start"; }

say "3/4  the spec must PASS with the fix"
run_spec "http://localhost:$FIX_PORT"
FIX_RESULT=$?

# The control is run more than once on purpose. One flaky pass on the control arm signs
# a VERIFIED that never happened, so the differential is worth exactly as much as the
# determinism of the spec -- and this is the only place that measures it.
say "4/4  the spec must FAIL without the fix, $CONTROL_RUNS times out of $CONTROL_RUNS"
CONTROL_FAILURES=0
for attempt in $(seq 1 "$CONTROL_RUNS"); do
  printf '\n   control run %s/%s\n' "$attempt" "$CONTROL_RUNS"
  run_spec "http://localhost:$CONTROL_PORT"
  attempt_result=$?
  if [ $attempt_result -ne 0 ]; then CONTROL_FAILURES=$((CONTROL_FAILURES + 1)); fi
done

printf '\n\033[1m---------------- VERDICT ----------------\033[0m\n'
printf '  spec                : %s\n' "$SPEC"
printf '  with the fix   (%s) : %s\n' "$FIX_LABEL" "$([ $FIX_RESULT -eq 0 ] && echo PASS || echo FAIL)"
printf '  without it     (%s) : %s of %s runs failed\n' "$BASE_SHA" "$CONTROL_FAILURES" "$CONTROL_RUNS"
echo

if [ $FIX_RESULT -ne 0 ]; then
  printf '\033[1;31m  FIX DOES NOT CLOSE IT: the spec still fails with the fix applied.\033[0m\n'
  exit 4
fi
if [ "$CONTROL_FAILURES" -eq "$CONTROL_RUNS" ]; then
  printf '\033[1;32m  VERIFIED: the spec reproduces the defect at %s and the fix closes it.\033[0m\n' "$BASE_SHA"
  exit 0
fi
if [ "$CONTROL_FAILURES" -eq 0 ]; then
  printf '\033[1;33m  INCONCLUSIVE: passes on both arms. The spec does not touch the defect,\033[0m\n'
  printf '\033[1;33m  or the defect was never in %s.\033[0m\n' "$BASE_SHA"
  exit 3
fi
printf '\033[1;33m  INCONCLUSIVE: the control failed %s of %s runs. A spec that only sometimes\033[0m\n' "$CONTROL_FAILURES" "$CONTROL_RUNS"
printf '\033[1;33m  reproduces the defect cannot certify the fix. Make it deterministic first.\033[0m\n'
exit 3
