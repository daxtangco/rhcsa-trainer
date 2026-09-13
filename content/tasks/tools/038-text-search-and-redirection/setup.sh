#!/usr/bin/env bash
# Prepare the system for tools/038-text-search-and-redirection.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell.
#
# IDEMPOTENT, and unlike storage/014's setup it can honestly claim that: every
# artefact this task grades is a file this script writes from scratch, so a
# second run restages the same bytes and puts every goal checkpoint back into
# failure. Nothing here depends on a state the student's answer destroys. The
# harness still reverts the snapshot before each fixture; this is for the human
# who re-runs setup on a guest they have been poking at.
#
# `set -uo pipefail` without -e, following sys/035's setup rather than 014's
# `set -euo pipefail`: this file contains idempotent removals that legitimately
# fail on a first run, and it also runs grep on purpose against a directory it
# has made unreadable, which exits 2 by design. The commands that MUST work go
# through `need` instead, because a silent failure here stages the wrong machine
# and every checkpoint result afterwards is a lie.
set -uo pipefail

need() { "$@" || { printf 'setup.sh: FAILED: %s\n' "$*" >&2; exit 1; }; }
fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

TARGET_USER=student
REVIEW=/srv/rhcsa-review
LOG_A=$REVIEW/monday.log
LOG_B=$REVIEW/tuesday.log
QDIR=$REVIEW/quarantine
QLOG=$QDIR/rotated.log
WORK=/home/student/login-review
REPORT=$WORK/failed-deploy.log
ERRLOG=$WORK/search-errors.log
WATCH=$WORK/watchlist.txt
STAMP_DIR=/var/lib/rhcsa-lab
STAMP=$STAMP_DIR/038-log-digests

# The pattern the prompt describes, spelled the way the grader's own probes
# spell it. It is not the only correct answer and the grader never looks for it -
# it exists so this script can prove, before the student starts, that the
# discrimination the report checkpoints rest on is real.
PRECISE='FAILED login for user=deploy '
# The same pattern with the trailing boundary dropped: the near-miss this task
# exists to catch.
GREEDY='FAILED login for user=deploy'

# The records that belong in the report, and the ones that must not. Spelled
# identically in grade.sh. If these two lists ever disagree with the log text
# below, the report checkpoints become unsatisfiable for every answer - which is
# why the block at the bottom of this file measures them rather than trusting
# them.
WANT_TAGS=(m01 m04 t01 t04)
REJECT_TAGS=(m02 m03 m05 m06 t02 t03 t05 q01 q02)

WATCH_COMMENT='# nightly login review watchlist - one account name per line'

# --- preconditions this task cannot work without --------------------------
# Convention for every task cloned from storage/014: verify every precondition
# the goal checkpoints depend on, not only the ones this script needs to run. A
# precondition that only guards the script leaves the checkpoints free to pass
# or fail for reasons that have nothing to do with the student.
id "$TARGET_USER" &>/dev/null \
  || fail "user $TARGET_USER does not exist, and every graded path lives under that account's home"

home=$(getent passwd "$TARGET_USER" | awk -F: '{ print $6 }')
[[ $home == /home/student ]] \
  || fail "$TARGET_USER's home is '${home:-empty}', not /home/student; the prompt and the grader both name /home/student/login-review literally, so a different home makes the task unsolvable"

command -v grep &>/dev/null \
  || fail "grep is not installed; without it nothing in this task can be attempted"

# --- undo what a previous attempt can leave behind ------------------------
sudo rm -f "$REPORT" "$ERRLOG"

# --- the working directory the student owns -------------------------------
need sudo mkdir -p "$WORK"
# Owned by the account that has to write three files into it. Not chown'd to
# student:student - the per-user group is conventional but not guaranteed, and
# only the owner matters here.
need sudo chown "$TARGET_USER" "$WORK"
need sudo chmod 0755 "$WORK"
# SELinux is Enforcing on this guest. A directory created under /home/student
# inherits user_home_t from its parent, so this is belt and braces rather than a
# fix - cheap insurance against a guest whose home was relabelled by hand, which
# would leave the student unable to write the report and no visible reason why.
need sudo restorecon -R "$WORK"

# --- the exported logs ----------------------------------------------------
# Written with printf rather than a heredoc so the bytes are exactly these bytes:
# no editor, no tabs-versus-spaces question, no trailing whitespace, one \n per
# line and nothing after the last one. logs-unmodified compares a digest of
# these files, so "deterministic" is not a style preference here.
#
# Six records in monday.log, five in tuesday.log, and every one of them is a
# discriminator:
#   m01, m04, t01, t04   FAILED, account exactly deploy          -> wanted
#   m02                  FAILED, account deployer                -> not deploy
#   m05                  FAILED, account deploy2                 -> not deploy
#   t02                  FAILED, account deploy_svc              -> not deploy
#   m03                  ACCEPTED, account deploy                -> not a failure
#   t03                  ACCEPTED, account deployer              -> neither
#   m06                  FAILED, account root                    -> not deploy
#   t05                  FAILED, account root, "deploy" in note= -> deploy, wrong field
# The three near-miss account names end in a letter, a digit and an underscore on
# purpose: all three are word constituents, so `grep -w user=deploy` and
# `grep 'user=deploy\>'` reject them. A hyphenated near-miss (deploy-bot) would
# not be rejected by either - `-` is not a word constituent, so the word boundary
# sits before it - and staging one would fail the two answers the concept card
# teaches.
need sudo mkdir -p "$REVIEW"
printf '%s\n' \
  '2026-09-08T01:02:03 rh9lab sshd[812]: FAILED login for user=deploy from=10.20.0.11 tag=m01' \
  '2026-09-08T01:02:11 rh9lab sshd[813]: FAILED login for user=deployer from=10.20.0.12 tag=m02' \
  '2026-09-08T01:02:19 rh9lab sshd[814]: ACCEPTED login for user=deploy from=10.20.0.11 tag=m03' \
  '2026-09-08T01:02:27 rh9lab sshd[815]: FAILED login for user=deploy from=10.20.0.44 tag=m04' \
  '2026-09-08T01:02:35 rh9lab sshd[816]: FAILED login for user=deploy2 from=10.20.0.13 tag=m05' \
  '2026-09-08T01:02:43 rh9lab sshd[817]: FAILED login for user=root from=10.20.0.14 tag=m06' \
  | sudo tee "$LOG_A" >/dev/null \
  || fail "could not write $LOG_A"

printf '%s\n' \
  '2026-09-09T03:10:00 rh9lab sshd[901]: FAILED login for user=deploy from=10.20.0.11 tag=t01' \
  '2026-09-09T03:10:08 rh9lab sshd[902]: FAILED login for user=deploy_svc from=10.20.0.15 tag=t02' \
  '2026-09-09T03:10:16 rh9lab sshd[903]: ACCEPTED login for user=deployer from=10.20.0.12 tag=t03' \
  '2026-09-09T03:10:24 rh9lab sshd[904]: FAILED login for user=deploy from=10.20.0.99 tag=t04' \
  '2026-09-09T03:10:32 rh9lab sshd[905]: FAILED login for user=root from=10.20.0.11 note=deploy tag=t05' \
  | sudo tee "$LOG_B" >/dev/null \
  || fail "could not write $LOG_B"

need sudo chown root:root "$LOG_A" "$LOG_B"
need sudo chmod 0644 "$LOG_A" "$LOG_B"

# --- the directory the search cannot read --------------------------------
# This is what gives the search something to complain about, and it is the whole
# reason stderr has to be redirected separately rather than ignored.
#
# Mode 0000 and root-owned, which produces a diagnostic naming this path for
# every route into it: as student, `grep pat /srv/rhcsa-review/*` and
# `grep -r pat /srv/rhcsa-review` both get EACCES on the open ("Permission
# denied"); as root, the open succeeds and the read returns EISDIR ("Is a
# directory"). Measured on RHEL 9.8 with GNU grep 3.6 for the unprivileged
# cases. The grader keys on the PATH in the message rather than on either
# wording, so it accepts both and does not care about the locale.
#
# The records inside carry rejected tags on purpose. The one route that gets no
# diagnostic at all is `sudo grep -r`, which reads this directory successfully -
# and that answer is then caught by report-precise instead, because it drags q01
# and q02 into the report.
need sudo mkdir -p "$QDIR"
need sudo chmod 0755 "$QDIR"
printf '%s\n' \
  '2026-09-01T00:00:01 rh9lab sshd[100]: FAILED login for user=deploy from=10.20.0.11 tag=q01' \
  '2026-09-01T00:00:09 rh9lab sshd[101]: FAILED login for user=deploy from=10.20.0.12 tag=q02' \
  | sudo tee "$QLOG" >/dev/null \
  || fail "could not write $QLOG"
need sudo chown root:root "$QDIR" "$QLOG"
need sudo chmod 0644 "$QLOG"
need sudo restorecon -R "$REVIEW"
# Last, because everything above had to be able to write in here.
need sudo chmod 0000 "$QDIR"

# --- the file that has to be edited --------------------------------------
# Three separate defects, so this cannot be finished with one substitution: a
# misspelling to correct, a line to delete, and a line to insert in the middle
# rather than at the end.
printf '%s\n' "$WATCH_COMMENT" depoly deployer root \
  | sudo tee "$WATCH" >/dev/null \
  || fail "could not write $WATCH"
need sudo chown "$TARGET_USER" "$WATCH"
need sudo chmod 0644 "$WATCH"

# --- the digests logs-unmodified is graded against ------------------------
need sudo mkdir -p "$STAMP_DIR"
sudo sha256sum "$LOG_A" "$LOG_B" | sudo tee "$STAMP" >/dev/null \
  || fail "could not record the log digests in $STAMP"
need sudo chmod 0644 "$STAMP"
# Read it back the way grade.sh reads it. The grader fails every checkpoint
# closed on a stamp it cannot parse, so a stamp that did not land is a task
# nobody can pass - better to say so here than to hand the student a grader that
# fails for a reason they cannot see.
stamp_back=$(sudo cat "$STAMP" 2>/dev/null)
[[ $(printf '%s\n' "$stamp_back" | grep -c '^[0-9a-f]\{64\}  /') -eq 2 ]] \
  || fail "$STAMP does not read back as two 'digest  path' lines; grade.sh fails closed on that and no answer could pass"

# --- prove every goal checkpoint fails right now -------------------------
# One block per checkpoint, in grade.sh's order. A goal checkpoint that is
# already green is a student-facing false pass, not a solved task.

# report-complete, report-precise, report-clean: the report must not exist.
[[ ! -e $REPORT ]] || fail "$REPORT survived the rm, so the three report checkpoints could pass at baseline"

# errors-captured: neither may the error log.
[[ ! -e $ERRLOG ]] || fail "$ERRLOG survived the rm, so errors-captured could pass at baseline"

# watchlist-exact: the staged file must differ from the required end state.
# Compared the same way the grader compares it, so "different" here means
# exactly what "wrong" means there.
want_watch=$(printf '%s\n' "$WATCH_COMMENT" deploy deploy_svc root)
got_watch=$(sudo cat "$WATCH" 2>/dev/null)
[[ $got_watch != "$want_watch" ]] \
  || fail "$WATCH already holds the required end state, so watchlist-exact would pass at baseline"

# ...and the account that has to edit it must be able to. sed -i and vim both
# rewrite the file rather than modifying it in place, so a writable file in an
# unwritable directory is not enough: probe the directory too.
need touch "$WORK/.rhcsa-write-probe"
need rm -f "$WORK/.rhcsa-write-probe"
[[ -w $WATCH ]] || fail "$WATCH is not writable by $(id -un), so no editor could correct it"

# logs-unmodified is an invariant: prove it holds before the student starts, so a
# failure afterwards can only mean the student rewrote a source log.
now=$(sudo sha256sum "$LOG_A" "$LOG_B" 2>/dev/null)
[[ $now == "$stamp_back" ]] \
  || fail "the digests changed between recording and reading them back; logs-unmodified would fail for every fixture"

# --- prove the discrimination the report checkpoints rest on is real -----
# Without this block a mistake in the log text above would fail the report
# checkpoints for every fixture including both solutions, and the failure would
# point at the student's pattern rather than at this file.

# The precise pattern finds exactly the wanted records and nothing else. `grep
# -c ''` counts lines the way the grader counts them; `grep -h` because two
# files means a filename prefix that has nothing to do with the count.
precise_out=$(grep -h -- "$PRECISE" "$LOG_A" "$LOG_B")
precise_n=$(printf '%s\n' "$precise_out" | grep -c '')
[[ $precise_n -eq ${#WANT_TAGS[@]} ]] \
  || fail "the staged logs yield $precise_n records for the precise pattern, expected ${#WANT_TAGS[@]}; the report checkpoints could not be satisfied"

for t in "${WANT_TAGS[@]}"; do
  printf '%s\n' "$precise_out" | grep -F -- "tag=$t" >/dev/null \
    || fail "record tag=$t is not found by the precise pattern, so report-complete could not be satisfied"
done

for t in "${REJECT_TAGS[@]}"; do
  if printf '%s\n' "$precise_out" | grep -F -- "tag=$t" >/dev/null; then
    fail "record tag=$t IS found by the precise pattern, so report-precise would reject a correct answer"
  fi
done

# The greedy pattern must find strictly more. If it did not, report-precise
# would be graded on a distinction the staged data does not contain, and the
# anti-solution built on it would be certified as a detector while detecting
# nothing.
greedy_n=$(grep -h -- "$GREEDY" "$LOG_A" "$LOG_B" | grep -c '')
[[ $greedy_n -gt $precise_n ]] \
  || fail "the greedy pattern finds $greedy_n records and the precise one $precise_n; report-precise needs the greedy answer to over-match"

# And the quarantined records must really be there, or `sudo grep -r` - the one
# route that produces no diagnostic - would produce a correct report and nothing
# would object to it.
[[ $(sudo grep -c 'tag=q' "$QLOG" 2>/dev/null) -eq 2 ]] \
  || fail "$QLOG does not hold its two rejected records; a privileged recursive search would not over-match and report-precise would miss it"

# The search really is stopped by the quarantine directory, and the diagnostic
# really does name it. This is the precondition errors-captured rests on, and
# the only one this script cannot arrange by writing a file.
#
# `2>&1 >/dev/null` captures stderr and discards stdout - and yes, that order
# looks backwards. It is the correct one: descriptor 2 is pointed at where 1
# currently points (this command substitution's pipe) and only then is 1 sent to
# /dev/null. Written the other way round, `>/dev/null 2>&1`, both streams end up
# in /dev/null and this guard would pass on any machine at all.
probe_err=$(grep -- "$PRECISE" "$REVIEW"/* 2>&1 >/dev/null)
printf '%s\n' "$probe_err" | grep -F -- "$QDIR" >/dev/null \
  || fail "searching $REVIEW/* printed nothing about $QDIR on stderr (got: ${probe_err:-nothing}); errors-captured could not be satisfied by any answer"

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
