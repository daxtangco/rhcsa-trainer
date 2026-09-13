#!/usr/bin/env bash
# Grader for tools/038-text-search-and-redirection.
#
# READ-ONLY. Changes nothing on the guest. The exit code is ignored; only the
# JSONL is read. content/lib/assert.sh is prepended by loadTaskScripts, so its
# helpers are already in scope - do not source it.
#
# Six checkpoints, because a wrong answer here is wrong in four independent ways
# - a pattern that finds too little, a pattern that finds too much, two streams
# that went to one place, and a file edited into the wrong end state - and each
# needs its own verdict line. One "did it work" checkpoint would tell a student
# they are wrong without saying which half.
#
# What is NOT graded anywhere below: the commands. Nothing here looks at history,
# at a script, or for the string "grep". This task's objectives are "use grep and
# regular expressions to analyse text", "use input-output redirection" and
# "create and edit text files", and all three are graded the only way an end
# state can be graded - by reading the files that came out (spec 6.5 rule 1). So
# awk, sed, python and a student who read the log and typed the four records into
# vim by hand all pass, and that is the accepted residual: this grader cannot
# distinguish a hand-typed report from a searched one, and a report is what the
# ticket asked for. What it can and does distinguish is every wrong end state,
# which is where the marks actually are.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: report-complete, report-precise, report-clean, errors-captured, watchlist-exact
set -uo pipefail

REVIEW=/srv/rhcsa-review
LOG_A=$REVIEW/monday.log
LOG_B=$REVIEW/tuesday.log
QDIR=$REVIEW/quarantine
WORK=/home/student/login-review
REPORT=$WORK/failed-deploy.log
ERRLOG=$WORK/search-errors.log
WATCH=$WORK/watchlist.txt
STAMP=/var/lib/rhcsa-lab/038-log-digests

# The records that belong in the report, and the ones that must not. Spelled
# identically in setup.sh, which proves before the student starts that a pattern
# exists that finds all of the first list and none of the second.
WANT_TAGS=(m01 m04 t01 t04)
REJECT_TAGS=(m02 m03 m05 m06 t02 t03 t05 q01 q02)

WATCH_COMMENT='# nightly login review watchlist - one account name per line'

# Every read of a student-produced file goes through sudo, following sys/035:
# the student may have produced the report as root with a umask that leaves it
# unreadable to their own account, and "the grader cannot read it" must never be
# graded as "it is not there". That is a false FAIL, and it sends the student
# looking for a problem that does not exist.
#
# `grep -qsF FILE` and not `cat FILE | grep -qF`: grep reads the file directly,
# so there is no producer for its early exit to kill and the SIGPIPE-under-
# pipefail trap documented in content/lib/assert.sh cannot fire here.
has_tag() { sudo grep -qsF -- "tag=$1" "$REPORT"; }

# The digests setup.sh recorded, and today's. Both are read before anything is
# graded so the fail-closed block below can see them.
recorded=$(sudo cat "$STAMP" 2>/dev/null)
recorded_lines=$(printf '%s\n' "$recorded" | grep -c '^[0-9a-f]\{64\}  /')
current=$(sudo sha256sum "$LOG_A" "$LOG_B" 2>/dev/null)

# FAIL CLOSED, the same way storage/014 does with its size targets and sys/035
# with its boot id. An empty $recorded compares equal to nothing and unequal to
# everything, so a grader that could not read the stamp would report
# logs-unmodified as FAILING - which blames the student for a missing stamp - and
# there is no honest verdict to give on the rest either, because the file the
# report is derived from can no longer be shown to be the file setup staged.
if [[ $recorded_lines -ne 2 ]]; then
  detail="grader could not read two 'digest  path' lines from $STAMP (got: ${recorded:-nothing}); setup.sh writes that stamp, so either setup did not run or /var was rolled back under it"
  ck_fail report-complete "the report holds every failed login for the account deploy" "$detail"
  ck_fail report-precise "the report holds nothing but those records" "$detail"
  ck_fail report-clean "the search's error messages are not in the report" "$detail"
  ck_fail errors-captured "$ERRLOG holds what the search said about $QDIR" "$detail"
  ck_fail watchlist-exact "$WATCH holds exactly the four required lines" "$detail"
  ck_fail logs-unmodified "the two exported logs are byte-for-byte unchanged" "$detail"
  exit 0
fi

# --- the report exists at all --------------------------------------------
# Shared by the three report checkpoints. Kept as a variable rather than
# repeated so all three agree about what "there is no report" means: an absent
# or empty file fails all three, which is also what makes them fail at baseline.
report_present=no
sudo test -s "$REPORT" && report_present=yes

# --- 1. the pattern found everything it should ---------------------------
missing=''
for t in "${WANT_TAGS[@]}"; do
  has_tag "$t" || missing+="$t "
done

if [[ $report_present == yes && -z $missing ]]; then
  ck_pass report-complete "the report holds every failed login for the account deploy"
elif [[ $report_present == no ]]; then
  ck_fail report-complete "the report holds every failed login for the account deploy" \
    "$REPORT is missing or empty"
else
  ck_fail report-complete "the report holds every failed login for the account deploy" \
    "records absent from the report (identified by their tag= field): $missing- a pattern anchored too tightly, or a search that read only one of the two exported logs, finds fewer than all four"
fi

# --- 2. and nothing it should not -----------------------------------------
# Two independent ways to hold too much, because they are two different
# mistakes. A rejected record present means the pattern matched a near miss: an
# account whose name merely begins with deploy, a successful login, a line
# mentioning deploy in some other field, or a record from the quarantined export
# that only a privileged recursive search can reach. Too many lines with no
# rejected record among them means something else got in - a diagnostic, a
# duplicate from a second appended run, a header the student wrote themselves.
extra=''
for t in "${REJECT_TAGS[@]}"; do
  has_tag "$t" && extra+="$t "
done

# `grep -c` rather than `wc -l`, so a final line with no newline is still
# counted. A file the student assembled by hand is exactly where that happens.
#
# The pattern is `[^[:space:]]` rather than `''`, so a blank or whitespace-only
# line is not counted as a record. A blank line is not something that "got in":
# it is not a record, it is not a diagnostic, and it is exactly what a student
# who assembled the report in an editor is most likely to leave behind - the
# same reason the watchlist comparison below forgives trailing newlines. Every
# intruder this clause exists to catch - a captured diagnostic, a duplicate
# from a second appended run, a hand-written header - has non-space characters
# on it and is still counted.
report_lines=$(sudo grep -c '[^[:space:]]' "$REPORT" 2>/dev/null) || report_lines=0
[[ $report_lines =~ ^[0-9]+$ ]] || report_lines=0

if [[ $report_present == yes && -z $extra && $report_lines -le ${#WANT_TAGS[@]} ]]; then
  ck_pass report-precise "the report holds nothing but those records"
elif [[ $report_present == no ]]; then
  ck_fail report-precise "the report holds nothing but those records" \
    "$REPORT is missing or empty"
else
  ck_fail report-precise "the report holds nothing but those records" \
    "unwanted records in the report (by tag=): ${extra:-none}; the report has $report_lines non-blank lines and there are ${#WANT_TAGS[@]} matching records, so dropping the boundary after the account name, or matching deploy anywhere on the line, is what usually does this"
fi

# --- 3. the two streams did not end up in the same file ------------------
# The point of the whole redirection half, and the checkpoint a student who
# reached for `>` where `2>` was needed, or who merged the streams with `2>&1`
# or `&>`, fails here.
#
# Keyed on the PATH the diagnostic names rather than on its wording: GNU grep
# says "Permission denied" to an unprivileged search and "Is a directory" to a
# privileged one, and both are translated when LANG is not C. The path is in
# every wording of both.
report_dirty=no
sudo grep -qsF -- "$QDIR" "$REPORT" && report_dirty=yes

if [[ $report_present == yes && $report_dirty == no ]]; then
  ck_pass report-clean "the search's error messages are not in the report"
elif [[ $report_present == no ]]; then
  ck_fail report-clean "the search's error messages are not in the report" \
    "$REPORT is missing or empty"
else
  ck_fail report-clean "the search's error messages are not in the report" \
    "$REPORT contains a line naming $QDIR, so stdout and stderr were pointed at the same file; '> report 2>&1' and '&> report' both do that"
fi

# --- 4. ...and the error stream was kept ---------------------------------
# The other half of the same skill, and it fails for the opposite mistake: the
# student who redirected stdout and let stderr go to the terminal, where the
# harness discards it.
errors_ok=no
if sudo test -s "$ERRLOG"; then
  sudo grep -qsF -- "$QDIR" "$ERRLOG" && errors_ok=yes
fi

if [[ $errors_ok == yes ]]; then
  ck_pass errors-captured "$ERRLOG holds what the search said about $QDIR"
else
  ck_fail errors-captured "$ERRLOG holds what the search said about $QDIR" \
    "no line naming $QDIR in $ERRLOG (present and non-empty: $(sudo test -s "$ERRLOG" && echo yes || echo no)); a search that cannot read that directory writes its complaint on descriptor 2, which '>' does not touch"
fi

# --- 5. the file that had to be edited ----------------------------------
# Compared as text against the exact end state the prompt states, in order. A
# checkpoint that accepted "the three names are in there somewhere" would pass a
# file that still carries the misspelling and the account that was supposed to
# go, which is the whole difference between editing a file and adding to it.
#
# Both sides go through command substitution, which strips trailing newlines - so
# a file that ends without a final newline and one that ends with several are
# both accepted. That is deliberate: no editor lets a student control that
# reliably (vi always writes one), and it is not what is being taught. Leading
# and trailing space on a line is NOT forgiven, because that is a visible
# difference in the file's content.
want_watch=$(printf '%s\n' "$WATCH_COMMENT" deploy deploy_svc root)
got_watch=$(sudo cat "$WATCH" 2>/dev/null)

if [[ $got_watch == "$want_watch" ]]; then
  ck_pass watchlist-exact "$WATCH holds exactly the four required lines"
else
  # The file is small and the difference is the whole point, so the detail shows
  # what is actually there. An empty file is the signature of
  # `cmd watchlist.txt > watchlist.txt`, which truncates before the command runs.
  ck_fail watchlist-exact "$WATCH holds exactly the four required lines" \
    "wanted (one per line): ${want_watch//$'\n'/ | } -- found: ${got_watch:-an empty or missing file (a redirect into the same file truncates it before the command reads it)}"
fi

# --- 6. the invariant: the evidence was not edited ----------------------
# An answer that produces the right report by first deleting the inconvenient
# records from the exported logs has satisfied the letter of the ticket and
# destroyed the evidence it was written about. It is also the one mistake here
# that cannot be undone, which is why the prompt says "byte for byte" and why
# this is graded rather than trusted.
#
# Probed, and not an unprobed invariant: antisolutions/05 breaks it deliberately
# and safely, because nothing on the guest depends on these two files.
if [[ $current == "$recorded" ]]; then
  ck_pass logs-unmodified "the two exported logs are byte-for-byte unchanged"
else
  ck_fail logs-unmodified "the two exported logs are byte-for-byte unchanged" \
    "sha256 now: ${current:-unreadable}; recorded by setup: $recorded"
fi

exit 0
