#!/usr/bin/env bash
#
# What the badge means. Not "the tests pass" -- that a spec was verified DIFFERENTIALLY,
# and that the harness still reports the other two outcomes correctly.
#
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

FAILED=0

expect_exit() {
  local wanted="$1" label="$2"; shift 2
  printf '\n\033[1;35m######  %s (expecting exit %s)\033[0m\n' "$label" "$wanted"
  "$@"
  local got=$?
  if [ "$got" -eq "$wanted" ]; then
    printf '\033[1;32m######  ok: exit %s\033[0m\n' "$got"
  else
    printf '\033[1;31m######  WRONG: exit %s, expected %s\033[0m\n' "$got" "$wanted"
    FAILED=1
  fi
}

expect_exit 0 "a real fix, verified against the defect" \
  bash tools/ab-verify.sh specs/delete-guard.spec.ts demo-base

expect_exit 3 "a spec that never touches the defect" \
  bash tools/ab-verify.sh specs/parts-grid.spec.ts demo-base

expect_exit 4 "the defect present on both arms" \
  bash tools/ab-verify.sh specs/delete-guard.spec.ts demo-base --fix-ref demo-base --control-runs 1

printf '\n\033[1m========================================\033[0m\n'
if [ $FAILED -eq 0 ]; then
  printf '\033[1;32m  all three verdicts reported correctly\033[0m\n'
else
  printf '\033[1;31m  the harness did not report the verdicts it promises\033[0m\n'
fi
exit $FAILED
