#!/usr/bin/env bash
# The one-liner that destroys the file it was meant to edit:
#
#   grep -v '^deployer$' watchlist.txt > watchlist.txt
#
# The shell performs the redirection BEFORE grep starts, and `>` truncates. So
# watchlist.txt is already empty when grep opens it to read. This is not a
# hypothetical - it is the single most expensive redirection mistake there is,
# because the original is gone.
#
# Measured on RHEL 9.8 with GNU grep 3.6: grep notices, prints
# "grep: watchlist.txt: input file is also the output", and exits 2 - and the
# file is 0 bytes all the same, because the shell truncated it before grep was
# started and grep has nothing left to put back. The warning is the courtesy of
# a tool that happens to check; `sort watchlist.txt > watchlist.txt` empties the
# file the same way, exits 0, and says nothing whatsoever.
#
# The search half is done correctly, so watchlist-exact is the only red line and
# the fixture is a detector for exactly this. The empty file is also the reason
# the checkpoint's detail says so explicitly: the student's next question is
# always "where did my file go".
# expect-fail: watchlist-exact
set -euo pipefail

REVIEW=/srv/rhcsa-review
WORK=/home/student/login-review

grep 'FAILED login for user=deploy ' "$REVIEW"/* \
  > "$WORK/failed-deploy.log" \
  2> "$WORK/search-errors.log" || [[ $? -eq 2 ]]

# The misspelling is corrected properly first, so the file this destroys is one
# edit away from correct - which is what makes it a plausible last step rather
# than an obviously silly one.
sed -i 's/^depoly$/deploy/' "$WORK/watchlist.txt"
printf 'deploy_svc\n' >> "$WORK/watchlist.txt"

# `|| true` because grep exits 2 on the input-is-also-the-output diagnostic, and
# the fixture must reach its own exit rather than dying here: the
# harness reads this script's exit code, and an abort would be reported as a
# broken fixture instead of as the wrong answer it is meant to be.
grep -v '^deployer$' "$WORK/watchlist.txt" > "$WORK/watchlist.txt" || true
