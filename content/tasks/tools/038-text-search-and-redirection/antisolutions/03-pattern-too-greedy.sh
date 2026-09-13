#!/usr/bin/env bash
# One character short of correct: the same pattern as solutions/01 with the
# trailing space dropped. It reads as "failed login for user=deploy" and matches
# every account name that STARTS with deploy - deployer, deploy2, deploy_svc -
# because a regular expression with nothing after it does not claim the match ends
# there.
#
# This is the fixture that proves report-precise grades the pattern rather than
# the existence of a file. Seven records land in the report instead of four, and
# the four wanted ones are all among them, so report-complete PASSES and only
# report-precise fails. A grader that merely counted lines, or that checked "are
# the wanted records present", would call this correct.
#
# `grep -w user=deploy` on its own is the same failure by a different route: the
# word boundary rejects the three near-miss accounts but not the SUCCESSFUL login
# for deploy, so it over-matches in the other direction. Both are the reason the
# report is graded on the records it must not contain as well as on the ones it
# must.
# expect-fail: report-precise
set -euo pipefail

REVIEW=/srv/rhcsa-review
WORK=/home/student/login-review

grep 'FAILED login for user=deploy' "$REVIEW"/* \
  > "$WORK/failed-deploy.log" \
  2> "$WORK/search-errors.log" || [[ $? -eq 2 ]]

sed -i -e 's/^depoly$/deploy/' -e '/^deploy$/a deploy_svc' -e '/^deployer$/d' \
  "$WORK/watchlist.txt"
