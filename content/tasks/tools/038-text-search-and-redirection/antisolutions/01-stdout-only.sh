#!/usr/bin/env bash
# The mistake this task exists to catch, in its commonest form: one redirection,
# because `>` looks like "send the output to a file" and the student has never had
# a reason to notice that it only moves descriptor 1.
#
# Everything else is right. The pattern is the correct one, the report is exactly
# the four wanted records, the watchlist is corrected properly - so the only red
# line in the verdict is the one about the error log, which is what makes this a
# detector for `>` where `2>` was needed rather than a fixture that fails
# wholesale.
#
# The complaint about the quarantine directory is not lost, either: it is written
# to the terminal, which under the harness is this fixture's own stderr. That is
# exactly why the student sees it on screen while it is missing from the file, and
# why the mistake survives a look at the screen.
# expect-fail: errors-captured
set -euo pipefail

REVIEW=/srv/rhcsa-review
WORK=/home/student/login-review

grep 'FAILED login for user=deploy ' "$REVIEW"/* > "$WORK/failed-deploy.log" \
  || [[ $? -eq 2 ]]

sed -i -e 's/^depoly$/deploy/' -e '/^deploy$/a deploy_svc' -e '/^deployer$/d' \
  "$WORK/watchlist.txt"
