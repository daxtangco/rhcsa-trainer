#!/usr/bin/env bash
# The half-done search: the student found the first export, got a plausible
# report out of it, and never noticed the second one. Two of the four records are
# missing and every line that IS in the report belongs there, so nothing about
# the file looks wrong - it is a short report, not a malformed one.
#
# This is the fixture that gives report-complete its own detector. Without it, a
# grader that failed report-complete unconditionally, or that folded "found
# everything" into "found nothing extra", would look correct against every other
# fixture in this task.
#
# The quarantine directory is still named on the command line, so the error log is
# produced correctly and errors-captured passes: the mistake here is the file set,
# not the plumbing.
#
# report-precise passes too, and deliberately so: it grades "nothing in the report
# that does not belong", and a report holding two of the four wanted records
# holds nothing that does not belong. Two checkpoints, two different questions.
# expect-fail: report-complete
set -euo pipefail

REVIEW=/srv/rhcsa-review
WORK=/home/student/login-review

grep 'FAILED login for user=deploy ' "$REVIEW/monday.log" "$REVIEW/quarantine" \
  > "$WORK/failed-deploy.log" \
  2> "$WORK/search-errors.log" || [[ $? -eq 2 ]]

sed -i -e 's/^depoly$/deploy/' -e '/^deploy$/a deploy_svc' -e '/^deployer$/d' \
  "$WORK/watchlist.txt"
