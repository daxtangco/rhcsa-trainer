#!/usr/bin/env bash
# The other half of the same misunderstanding: the student knows stderr exists,
# and puts it in the same file as the report. `> file 2>&1` is the correct
# spelling of "both streams into one file" - the mistake is not the syntax, it is
# choosing one file when the ticket named two.
#
# Three checkpoints fail, and all three are honest rather than sloppy:
#   report-clean   - the diagnostic is in the report.
#   report-precise - it is also a fifth line in a report of four records, so the
#                    "nothing but those records" checkpoint sees it too. Two
#                    checkpoints failing for one mistake is the correct reading:
#                    the report is both dirty and over-full.
#   errors-captured- there is no error log at all.
# report-complete still passes, which is the point: the pattern was right and the
# plumbing was not, and the verdict says so.
#
# Worth naming because it is the near miss of this near miss: `2>&1 > report`
# looks like the same command and is not. Each redirection is applied in order
# against the state at that moment, so that spelling points 2 at the terminal
# (where 1 still is) and only then moves 1 into the file - the report comes out
# clean and the diagnostic goes to the screen, which is antisolutions/01's
# failure, not this one's.
# expect-fail: report-precise, report-clean, errors-captured
set -euo pipefail

REVIEW=/srv/rhcsa-review
WORK=/home/student/login-review

grep 'FAILED login for user=deploy ' "$REVIEW"/* > "$WORK/failed-deploy.log" 2>&1 \
  || [[ $? -eq 2 ]]

sed -i -e 's/^depoly$/deploy/' -e '/^deploy$/a deploy_svc' -e '/^deployer$/d' \
  "$WORK/watchlist.txt"
