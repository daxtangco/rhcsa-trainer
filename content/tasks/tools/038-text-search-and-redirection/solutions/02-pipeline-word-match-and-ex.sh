#!/usr/bin/env bash
# Route 2, equally correct, and different from solutions/01 in every choice it
# makes:
#   - two greps in a pipeline instead of one pattern: FAILED first, then the
#     account, so the boundary is expressed with -w rather than with a literal
#     space.
#   - -r instead of a shell glob, so the traversal is grep's rather than bash's.
#   - the redirections sit on different stages of the pipeline: stderr is
#     captured from the FIRST grep, stdout from the LAST. A grader that assumed
#     both redirections were attached to one command would wrongly reject this.
#   - the watchlist is corrected with ex, which is vi in line mode - the same
#     binary from the same vim-minimal package, reading its commands from stdin
#     instead of from a keyboard.
set -euo pipefail

REVIEW=/srv/rhcsa-review
WORK=/home/student/login-review

# -w anchors the match on word boundaries, and "word" here means alphanumerics
# and underscore - so `user=deploy` does not match inside `user=deployer`,
# `user=deploy2` or `user=deploy_svc`. Note that -w alone is NOT enough: it
# happily matches the successful login for deploy as well, which is why the
# FAILED filter is a separate stage rather than a nicety.
#
# ${PIPESTATUS[1]} is what makes `set -o pipefail` survivable here: the first
# grep exits 2 because the quarantine directory cannot be read, which fails the
# whole pipeline under pipefail. The status that matters is the last stage's -
# did the second grep select anything - and this asserts exactly that rather than
# blanket-ignoring the pipeline's status with `|| true`.
grep -r 'FAILED' "$REVIEW" 2> "$WORK/search-errors.log" \
  | grep -w 'user=deploy' > "$WORK/failed-deploy.log" \
  || [[ ${PIPESTATUS[1]} -eq 0 ]]

# The watchlist, edited by the editor rather than by a stream filter.
#
#   %s/…/…/      substitute on every line
#   g/…/d        delete every matching line
#   /^deploy$/a  open input mode after the matching line; a lone . ends it
#   wq           write and quit
#
# The heredoc is quoted (<<'EX') so bash expands nothing inside it: $ is an ex
# anchor here, not a shell sigil.
ex -s "$WORK/watchlist.txt" <<'EX'
%s/^depoly$/deploy/
g/^deployer$/d
/^deploy$/a
deploy_svc
.
wq
EX
