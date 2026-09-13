#!/usr/bin/env bash
# Route 1, and the one the book teaches: one grep with both output streams
# pointed at their own file, then sed to correct the watchlist.
#
# Straight-line commands on purpose - rung 4 builds the student-facing command
# sketch from the sorted-first solution file, so no loop and no case statement
# appears at the top level here (README, "Adding content"). The clever variant
# lives in 02.
#
# Three things here are deliberately different from solutions/02: the pattern
# (a literal with a trailing space rather than -w), the traversal (a glob rather
# than -r) and the editor (sed's non-interactive rewrite rather than ex, which is
# vi itself with the screen switched off).
set -euo pipefail

REVIEW=/srv/rhcsa-review
WORK=/home/student/login-review

# The pattern. The trailing space is the entire discrimination: the account
# names in the exports that are NOT deploy - deployer, deploy2, deploy_svc - all
# continue past the point where the wanted records have a space, so requiring one
# rejects all three. Naming the FAILED and the account field together in one
# literal is what rejects the successful logins and the line that mentions
# deploy in note= instead of user=.
#
# The glob is /srv/rhcsa-review/* and not /srv/rhcsa-review/*.log on purpose:
# the quarantine directory has to be handed to grep for grep to complain about
# it, and that complaint is half of what the ticket asks for.
#
# `|| [[ $? -eq 2 ]]` because grep exits 2 when it could not read something, and
# it could not read the quarantine directory - by design. That is the error being
# captured, not a failure of this script, so the status is accepted here while a
# status of 1 (nothing matched at all) is still allowed to abort under set -e.
grep 'FAILED login for user=deploy ' "$REVIEW"/* \
  > "$WORK/failed-deploy.log" \
  2> "$WORK/search-errors.log" || [[ $? -eq 2 ]]

# The watchlist, in place, three defects in one pass:
#   correct the misspelling, insert the missing account after the line the
#   substitution just produced, delete the account that does not belong.
# sed applies its expressions in order to each line, which is why the insert can
# match ^deploy$ - the line was depoly when sed read it and is deploy by the time
# the second expression sees it.
sed -i -e 's/^depoly$/deploy/' -e '/^deploy$/a deploy_svc' -e '/^deployer$/d' \
  "$WORK/watchlist.txt"
