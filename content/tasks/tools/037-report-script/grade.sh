#!/usr/bin/env bash
# Grader for tools/037-report-script.
#
# content/lib/assert.sh is prepended by loadTaskScripts, so its helpers are
# already in scope - do not source it. The exit code is ignored; only the JSONL
# emitted by the check helpers is read.
#
# THIS IS THE ONE GRADER IN THE BANK WHOSE SUBJECT IS A FILE THE STUDENT WROTE,
# and three consequences follow. Read them before changing anything here.
#
# 1. It EXECUTES student code, so it is not read-only in the sense the other
#    graders are. It writes probe lists into a fresh `mktemp -d` under /tmp and
#    removes them on exit, and it touches nothing else and nothing any checkpoint
#    measures. The alternative - having setup.sh stage the probe lists - was
#    rejected on purpose: the student can read anything setup.sh leaves behind, so
#    the inputs would be visible in advance and a table of memorised answers would
#    score full marks. The whole point of unseen-input is that the input does not
#    exist until grading time.
#
# 2. Every invocation goes through `timeout` with stdin on /dev/null. A student's
#    script is arbitrary code: `while :` hangs the run, and a `read` with no
#    redirect would sit waiting for a terminal that is not there. Neither may be
#    able to stall a validation run, and neither may be graded as anything other
#    than "your script did not produce the report".
#
# 3. Nothing here reads the student's source. Not one grep for `if`, `for` or
#    `$1`. The four objectives this task claims are about conditionals, loops,
#    script inputs and command output, and the honest way to grade "uses a
#    conditional" is to feed the script inputs that need different answers and see
#    whether it gives them. Grading the text would grade one author's spelling of
#    a loop, which is over-fitting risk R4 with extra steps. What that costs is
#    stated plainly: a correct report written in awk or python, or a bash script
#    that reaches the same answers by some route nobody here imagined, passes. It
#    should. The end state is graded, not the mechanism (spec 6.5 rule 1).
#
# HOW THIS DEFENDS AGAINST A SCRIPT THAT HARDCODES THE EXPECTED OUTPUT. That is
# the failure mode a behaviour-graded artefact invites, so it is defended in five
# independent ways rather than one:
#
#   a. Every expected UID is read out of getent at grade time. Nothing in this
#      file asserts that payroll is 4101; setup.sh chose that number and this
#      grader would happily grade it as 4999 if something had moved it - which is
#      what the accounts-intact stamp is for, below.
#   b. unseen-input names svcbackup, an account that appears in nothing the task
#      hands the student: not in the prompt, not in /home/student/accounts.list,
#      not in any other probe. A table of memorised answers built from the sample
#      list has no row for it. `getent passwd` of course lists it - the account is
#      not hidden, it is only unadvertised - which is what (c) is for.
#   c. unseen-input also names an account that cannot exist, spelled with $RANDOM
#      at grade time, so no table can hold a row for it either.
#   d. The probe lists differ in length (4, 1, 3, 2, 0, 5) and in order. A script
#      that handles "the first three lines" or that sorts its output rather than
#      following the list fails somewhere in that set.
#   e. The list files live under a fresh mktemp directory whose name the student
#      cannot predict, so a script keying off the input path has nothing to key
#      off.
#
# None of that stops someone determined to cheat a lab they are running for their
# own benefit, and it is not meant to. It stops the cheat that happens by
# accident: hardcoding the answer to the example, and then believing the script
# works.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: script-executable, mixed-list, uid-boundary, blank-lines, unterminated-line, empty-list, unseen-input, no-arg-usage
set -uo pipefail

SCRIPT=/usr/local/bin/rhcsa-account-report
STAMP=/var/lib/rhcsa-lab/037-accounts
# Spelled identically in setup.sh. REG1/REG2 are the two regular accounts, SYS is
# the service account, ABSENT is the name that must not resolve.
REG1=payroll
REG2=webdev
SYS=svcbackup
ABSENT=ghostuser
# Ten seconds is generous for a report over six names and short enough that a
# hung fixture does not stall a whole validation run.
LIMIT=10s

# uid_of NAME -> numeric uid on stdout, exit 1 if no such account.
#
# awk rather than `cut -d: -f3`, and no `grep -q` anywhere in this file: a
# consumer that stops early kills its producer with SIGPIPE and `set -o pipefail`
# reports the whole pipeline as 141 - a failure for a lookup that succeeded. awk
# without `exit` reads to EOF, so it cannot do that (see content/lib/assert.sh).
uid_of() {
  local out
  out=$(getent passwd "$1" 2>/dev/null | awk -F: 'NR == 1 { print $3 }')
  [[ $out =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$out"
}

uid_reg1=$(uid_of "$REG1" || true)
uid_reg2=$(uid_of "$REG2" || true)
uid_sys=$(uid_of "$SYS" || true)
uid_root=$(uid_of root || true)
# The account holding UID 1000, by number rather than by name. UID 1000 is the
# boundary between a service account and a person on RHEL 9, and `-gt 1000` in
# place of `-ge 1000` is only visible on an account whose UID is exactly that.
# Reading the name back out of getent rather than assuming `student` keeps this
# checkpoint honest on a guest whose study account was named something else.
name_1000=$(getent passwd 1000 2>/dev/null | awk -F: 'NR == 1 { print $1 }')

# A name that resolves to nothing, invented here so that no answer can hold a
# memorised row for it. Two draws, because $RANDOM could in principle land on a
# name that exists - it cannot with this prefix, but a grader that would grade a
# real account as `missing` is not one to leave to chance.
absent_probe="nosuch$RANDOM$RANDOM"
if uid_of "$absent_probe" >/dev/null 2>&1; then
  absent_probe="nosuch$RANDOM$RANDOM$RANDOM"
fi

WORK=$(mktemp -d /tmp/rhcsa-037-grade.XXXXXX 2>/dev/null || true)
[[ -n $WORK && -d $WORK ]] && trap 'rm -rf "$WORK"' EXIT

# The name:uid pairs setup.sh recorded, on one line so the invariant below can
# walk them without a loop that reads stdin. `sudo cat` because the stamp lives
# under /var/lib; tr rather than a `while read` for the reason in the helper above
# - and because a loop whose stdin is the stamp would fight the getent calls
# inside it.
stamp_pairs=$(sudo cat "$STAMP" 2>/dev/null | tr '\n' ' ')
# Three pairs, or this grader does not know what the lab created. Counted with
# grep -c, which reads to EOF; a `grep -q` here would be the SIGPIPE trap again.
stamp_count=$(printf '%s\n' $stamp_pairs | grep -c ':' || true)

# FAIL CLOSED, the same way storage/014 does with its size targets and sys/035
# with its boot-id stamp. An empty $uid_reg1 would make every `want` string below
# read `payroll user ` - which a script that printed nothing at all would not
# match, so this particular grader would fail rather than pass on a missing
# lookup. It is written closed anyway, for the two cases that genuinely could
# award marks nobody earned: an empty $name_1000 makes uid-boundary's expected
# output the single line `user 1000`, and a missing $WORK makes every probe list
# unwritable so `timeout` reads an absent file and prints nothing - which is
# exactly what empty-list accepts.
if [[ -z $uid_reg1 || -z $uid_reg2 || -z $uid_sys || -z $uid_root || -z $name_1000 || -z $WORK || ${stamp_count:-0} -ne 3 ]]; then
  detail="grader could not read what it grades against (uid $REG1=${uid_reg1:-none} $REG2=${uid_reg2:-none} $SYS=${uid_sys:-none} root=${uid_root:-none}, UID 1000 belongs to '${name_1000:-nobody}', scratch dir '${WORK:-none}', ${stamp_count:-0} of 3 stamped pairs in $STAMP); setup.sh creates those three accounts and that stamp, so either setup did not run or something removed them"
  ck_fail script-executable "$SCRIPT exists and is executable" "$detail"
  ck_fail mixed-list "the report classifies a regular account, a system account and a name that does not exist" "$detail"
  ck_fail uid-boundary "UID 1000 is reported as a regular user, not as a system account" "$detail"
  ck_fail blank-lines "blank lines in the list produce no output of their own" "$detail"
  ck_fail unterminated-line "a list that does not end in a newline still reports its last name" "$detail"
  ck_fail empty-list "an empty list prints nothing and exits 0" "$detail"
  ck_fail unseen-input "the report is computed from the account database, not from a memorised answer" "$detail"
  ck_fail no-arg-usage "run with no argument the script complains on stderr and exits 2" "$detail"
  ck_fail accounts-intact "the accounts this report is graded against are the ones the lab created" "$detail"
  exit 0
fi

OUT=$WORK/stdout
ERR=$WORK/stderr
STATUS=0

# run_report [ARG...] -> the student's script's stdout in $OUT, stderr in $ERR,
# exit status in $STATUS. Never returns non-zero itself: a failing script is data
# here, not an error.
run_report() {
  : > "$OUT"
  : > "$ERR"
  timeout "$LIMIT" "$SCRIPT" "$@" > "$OUT" 2> "$ERR" < /dev/null
  STATUS=$?
  return 0
}

# report_matches WANT -> 0 if the last run's stdout is WANT, and sets $DETAIL.
#
# Compared field by field rather than byte for byte. `awk '{ $1 = $1; print }'`
# rebuilds each record with single spaces, so one space, three spaces and a tab
# between the name and the word are all the same answer - the prompt says
# whitespace-separated and grading one particular spelling of whitespace would be
# over-fitting. What it does NOT forgive is a missing field, an extra line, a
# blank line of its own, or the wrong order, all of which are wrong answers.
#
# awk also reads a final line that has no newline, which matters: a student whose
# report ends without a trailing newline has still produced the report, and the
# byte-for-byte comparison this replaced would have failed them for it.
report_matches() {
  local want=$1 got
  got=$(awk '{ $1 = $1; print }' "$OUT" 2>/dev/null)
  if [[ $got == "$want" ]]; then
    DETAIL=''
    return 0
  fi
  local note=''
  # 124 is timeout's own verdict, and it is worth naming: the student sees "your
  # report was wrong" otherwise, when what happened is that it never finished.
  [[ $STATUS -eq 124 ]] && note=" (the script did not finish within $LIMIT)"
  [[ $STATUS -eq 126 || $STATUS -eq 127 ]] && note=" (the script could not be run at all)"
  DETAIL="exit=${STATUS}${note}; wanted: $(printf '%s' "${want:-<nothing>}" | tr '\n' '|'); got: $(printf '%s' "${got:-<nothing>}" | tr '\n' '|')"
  DETAIL=${DETAIL:0:400}
  return 1
}

# --- 1. the artefact exists ----------------------------------------------
# Executable BY STUDENT, which is what -x answers when the grader runs as
# student, and it is the property the prompt asks for: a script installed 0644 is
# a file, not a command. Everything below would fail too, but they would all fail
# with "the script could not be run at all", and a student reading eight identical
# details deserves the one line that says which of them is the actual problem.
if [[ -f $SCRIPT && -x $SCRIPT ]]; then
  ck_pass script-executable "$SCRIPT exists and is executable"
else
  ck_fail script-executable "$SCRIPT exists and is executable" \
    "not a regular executable file: $(ls -ld -- "$SCRIPT" 2>&1 | tr -d '\n')"
fi

# --- 2. the three-way classification -------------------------------------
# One regular account, one system account and one name that resolves to nothing.
# All three branches of the conditional in one probe, because a report that gets
# two of them right and the third wrong is the normal shape of a wrong answer
# here.
#
# root, webdev, payroll, ghostuser: neither sorted (that would be ghostuser,
# payroll, root, webdev) nor the order of /home/student/accounts.list (payroll,
# root, ghostuser, webdev) - a third order for the same four names, so a script
# that answers by line number rather than by name is wrong here as well as in
# unseen-input.
printf '%s\n' root "$REG2" "$REG1" "$ABSENT" > "$WORK/mixed.list"
run_report "$WORK/mixed.list"
want=$(printf '%s\n' \
  "root system $uid_root" \
  "$REG2 user $uid_reg2" \
  "$REG1 user $uid_reg1" \
  "$ABSENT missing")
if report_matches "$want"; then
  ck_pass mixed-list "the report classifies a regular account, a system account and a name that does not exist"
else
  ck_fail mixed-list "the report classifies a regular account, a system account and a name that does not exist" "$DETAIL"
fi

# --- 3. the boundary -----------------------------------------------------
# One line, on purpose. UID 1000 is exactly where "system" stops and "user"
# starts, so `-gt 1000`, `> 1000` and `-le 1000` all produce a report that is
# right about every other account on the machine and wrong about this one. A probe
# that mixed this name in with four others would report the same failure, but the
# student would have to work out which of the five lines was the point.
printf '%s\n' "$name_1000" > "$WORK/boundary.list"
run_report "$WORK/boundary.list"
if report_matches "$name_1000 user 1000"; then
  ck_pass uid-boundary "UID 1000 is reported as a regular user, not as a system account"
else
  ck_fail uid-boundary "UID 1000 is reported as a regular user, not as a system account" "$DETAIL"
fi

# --- 4. blank lines ------------------------------------------------------
# Leading, interior, doubled and trailing. Deliberately free of system accounts,
# so that a fixture failing this checkpoint has failed at blank lines and nothing
# else - the classification is already graded twice above.
#
# A loop that does not skip an empty line reports it: `id -u ''` fails, so the
# usual shape is a spurious ` missing` line, which after whitespace normalisation
# is the line `missing`. That is the fixture in antisolutions/06.
printf '\n%s\n\n\n%s\n%s\n\n' "$REG1" "$ABSENT" "$REG2" > "$WORK/blank.list"
run_report "$WORK/blank.list"
want=$(printf '%s\n' "$REG1 user $uid_reg1" "$ABSENT missing" "$REG2 user $uid_reg2")
if report_matches "$want"; then
  ck_pass blank-lines "blank lines in the list produce no output of their own"
else
  ck_fail blank-lines "blank lines in the list produce no output of their own" "$DETAIL"
fi

# --- 5. the last line with no newline on it ------------------------------
# The input the student is least likely to have thought about, and the reason
# setup.sh ships the sample list unterminated: `while read -r name; do ...; done <
# file` silently drops it, and that is the single most common real bug in a script
# of this shape. printf's format string ends without \n on purpose. Do not
# "tidy" it.
printf '%s\n%s' "$REG1" "$ABSENT" > "$WORK/unterminated.list"
run_report "$WORK/unterminated.list"
want=$(printf '%s\n' "$REG1 user $uid_reg1" "$ABSENT missing")
if report_matches "$want"; then
  ck_pass unterminated-line "a list that does not end in a newline still reports its last name"
else
  ck_fail unterminated-line "a list that does not end in a newline still reports its last name" "$DETAIL"
fi

# --- 6. nothing to report is not an error --------------------------------
# The exit-status half of this checkpoint is load-bearing and must not be
# dropped. Empty stdout is what an ABSENT script produces too - `timeout` exits
# 127 and prints its complaint on stderr - so on the output alone this checkpoint
# would PASS at baseline, on a guest where the student has done nothing at all.
# That is a student-facing false pass, and requiring status 0 is what closes it.
#
# It is also the only successful run whose exit status is graded, and the
# asymmetry is deliberate rather than an oversight. A perfectly correct report
# whose loop happens to end on a failed lookup exits non-zero through no fault of
# its author, and the prompt does not ask for a status there; an empty list is the
# one case where the prompt does ask ("an empty list is not an error"), and it is
# the one case where no lookup has run to leave a status behind.
: > "$WORK/empty.list"
run_report "$WORK/empty.list"
if report_matches '' && [[ $STATUS -eq 0 ]]; then
  ck_pass empty-list "an empty list prints nothing and exits 0"
else
  ck_fail empty-list "an empty list prints nothing and exits 0" \
    "${DETAIL:-exit=$STATUS, wanted exit 0 and no output}"
fi

# --- 7. input nobody could have memorised --------------------------------
# The anti-hardcode probe, built here and nowhere else. Five names: the two
# regular accounts in the reverse of every order used above, the system account
# that appears nowhere the student can see it, root, and a name invented from
# $RANDOM a few milliseconds ago.
#
# svcbackup is the load-bearing one. setup.sh creates it, the prompt never
# mentions it, the sample list does not contain it and no other probe uses it, so
# a script that answers from a table built by reading /home/student/accounts.list
# has no row for it and reports it as missing. Its UID is read from getent because
# `useradd --system` allocates it dynamically - which is also why a memorised
# number for it would be wrong on the next guest.
printf '%s\n' "$REG2" "$SYS" "$absent_probe" "$REG1" root > "$WORK/unseen.list"
run_report "$WORK/unseen.list"
want=$(printf '%s\n' \
  "$REG2 user $uid_reg2" \
  "$SYS system $uid_sys" \
  "$absent_probe missing" \
  "$REG1 user $uid_reg1" \
  "root system $uid_root")
if report_matches "$want"; then
  ck_pass unseen-input "the report is computed from the account database, not from a memorised answer"
else
  ck_fail unseen-input "the report is computed from the account database, not from a memorised answer" "$DETAIL"
fi

# --- 8. called wrongly ---------------------------------------------------
# Status 2 exactly, and not merely "non-zero", because non-zero is what a script
# with NO argument handling at all produces by accident: `< "$1"` with $1 unset
# fails the redirect, or trips `set -u`, and either way bash exits 1 with
# something on stderr. A checkpoint that accepted that would be green for the one
# answer it exists to reject - and it would also be green at baseline, where
# `timeout` exits 127. The prompt asks for 2 in as many words, so this grades what
# it asked for.
#
# stderr is required to be non-empty and stdout is not required to be empty: the
# prompt says the complaint goes to stderr, and a student who additionally echoed
# it to stdout has not got the report wrong.
run_report
if [[ $STATUS -eq 2 && -s $ERR ]]; then
  ck_pass no-arg-usage "run with no argument the script complains on stderr and exits 2"
else
  ck_fail no-arg-usage "run with no argument the script complains on stderr and exits 2" \
    "exit=$STATUS (wanted 2), stderr: $(tr '\n' ' ' < "$ERR" | cut -c1-160)"
fi

# --- 9. the invariant ----------------------------------------------------
# Every expected UID above is read out of getent at grade time, which is the only
# way a dynamically allocated system UID can be graded at all - and it means an
# answer that made the report "right" by moving an account would satisfy all seven
# behaviour probes. This is the checkpoint that notices. setup.sh recorded the
# three name:uid pairs it created; if the account database no longer agrees with
# that stamp, the thing being measured changed underneath the measurement.
#
# Narrow on purpose: only the three accounts this lab created, and only their
# UIDs. A student who created an account of their own to test the `user` branch
# with has done something sensible, and this must not fail them for it.
#
# Knowingly unprobed: no anti-solution here breaks it. The near-misses this task
# is about are all bugs in a script, and none of them touches the account
# database; a fixture that ran `usermod -u` would be a deliberate cheat rather
# than a mistake a student makes, and it would prove less than this comment does.
# So this checkpoint passes for every fixture in this task, which means an
# unconditional pass line here would validate green across all of them. That is
# the risk being accepted, not overlooked.
# unprobed-invariant: accounts-intact
drift=''
for pair in $stamp_pairs; do
  sname=${pair%%:*}
  suid=${pair##*:}
  [[ -n $sname && -n $suid ]] || continue
  now=$(uid_of "$sname" || true)
  [[ $now == "$suid" ]] || drift+="$sname: stamped $suid, now ${now:-absent}; "
done

if [[ -z $drift ]] && ! id "$ABSENT" &>/dev/null; then
  ck_pass accounts-intact "the accounts this report is graded against are the ones the lab created"
elif [[ -n $drift ]]; then
  ck_fail accounts-intact "the accounts this report is graded against are the ones the lab created" \
    "${drift:0:300}"
else
  ck_fail accounts-intact "the accounts this report is graded against are the ones the lab created" \
    "an account named $ABSENT now exists, and two probes are graded on that name resolving to nothing"
fi

exit 0
