#!/usr/bin/env bash
# Prepare the system for tools/037-report-script.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell.
#
# IDEMPOTENT. The harness reverts to the `clean` snapshot before every fixture,
# but this file is also safe to re-run by hand on a guest that has already been
# poked at: it deletes the report script, deletes and recreates the three lab
# accounts at fixed UIDs, and rewrites the sample list and the stamp. Nothing
# here depends on the previous state, which is what makes it re-runnable - unlike
# storage/014, whose XFS filesystem cannot be shrunk back.
#
# `set -uo pipefail` without -e, following users/006 and sys/035 rather than
# 014's `set -euo pipefail`: the cleanup block below is full of removals that
# legitimately fail on a first run (there is no account to delete, no script to
# remove). The commands that MUST work go through `need` instead, because a
# silent failure here stages the wrong machine and every checkpoint result
# afterwards is a lie.
set -uo pipefail

need() { "$@" || { printf 'setup.sh: FAILED: %s\n' "$*" >&2; exit 1; }; }
fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

TARGET_USER=student
SCRIPT=/usr/local/bin/rhcsa-account-report
LIST=/home/student/accounts.list
STAMP_DIR=/var/lib/rhcsa-lab
STAMP=$STAMP_DIR/037-accounts

# The two regular accounts, at UIDs no book and no default allocation would
# produce. That is the point of choosing them by hand: a student who memorises
# "the first real user is 1000, the next is 1001" gets nothing from it, and the
# grader reads both UIDs back out of getent at grade time rather than trusting
# these numbers. Spelled identically in grade.sh's stamp comparison.
REG1=payroll
REG1_UID=4101
REG2=webdev
REG2_UID=4102
# The system account. Its UID is NOT chosen here: `useradd --system` allocates
# from the SYS_UID_MIN..SYS_UID_MAX range in /etc/login.defs (201-999 on RHEL 9),
# and which number is free depends on what the guest already installed. Picking
# 999 by hand would be the shape that fails on a guest where systemd-coredump or
# polkitd already holds it, and the whole point of the system/user split in this
# task is the 1000 boundary, not one particular number below it. So: let useradd
# choose, read it back, and assert it landed below 1000.
SYSACCT=svcbackup
# A name that must NOT resolve. The report has to say `missing` for it, and the
# sample list the student is handed contains it, so a script that assumes every
# line names an account fails on the very first thing they test.
ABSENT=ghostuser

# --- preconditions this script itself needs -------------------------------
id "$TARGET_USER" &>/dev/null \
  || fail "user $TARGET_USER does not exist, but grade.sh runs the student's script as that account and $LIST lives in its home directory"

# $LIST is written as student, not through sudo, so the home directory has to be
# the one the path above names. A guest whose study account lives elsewhere would
# leave the sample list somewhere the prompt does not mention.
home=$(getent passwd "$TARGET_USER" | awk -F: 'NR == 1 { print $6 }')
[[ $home == /home/student ]] \
  || fail "$TARGET_USER's home directory is '${home:-unset}', not /home/student, so the prompt's path for the sample list would be wrong"
[[ -d $home && -w $home ]] || fail "$home is not a writable directory for $TARGET_USER"

# uid-boundary is graded against whatever account holds UID 1000, because UID
# 1000 itself is the boundary the task turns on: `-gt 1000` instead of
# `-ge 1000` is the off-by-one this lab exists to catch, and it is only visible
# on an account whose UID is exactly 1000. The name is not assumed to be
# `student` - grade.sh reads it out of getent the same way - but SOME account
# must hold it or that checkpoint is unsatisfiable for every fixture, including
# both solutions.
boundary=$(getent passwd 1000 | awk -F: 'NR == 1 { print $1 }')
[[ -n $boundary ]] \
  || fail "no account holds UID 1000 on this guest, so the uid-boundary checkpoint could not be satisfied by any answer; the installer-created first user normally has it (docs/vm-build-checklist.md section 2.6)"

# --- undo what a previous attempt can safely leave behind -----------------
# The student's own artefact first: this is the single removal that makes every
# goal checkpoint fail again.
sudo rm -f "$SCRIPT"

# The three lab accounts, deleted so they can be recreated at known UIDs. Same
# shape as users/006's cleanup: `userdel -r` first, then a bare `userdel` for the
# account whose home directory is not there to remove.
for u in "$REG1" "$REG2" "$SYSACCT"; do
  if id "$u" &>/dev/null; then
    sudo userdel -r "$u" 2>/dev/null || sudo userdel "$u"
  fi
  # useradd creates a group named after the user, and userdel only removes it
  # when it is that user's private group with no other members. A leftover group
  # of the same name makes the useradd below fail.
  getent group "$u" &>/dev/null && sudo groupdel "$u"
done

# Owned by root after a previous fixture ran as root, in which case student
# cannot truncate it - so remove it under sudo rather than redirecting over it.
sudo rm -f "$LIST"

# --- create the situation the prompt describes ----------------------------
# Both UIDs have to be free, or `useradd -u` fails and the failure would look like
# a grader bug rather than a guest that was not built to
# docs/vm-build-checklist.md. The UIDs only: with USERGROUPS_ENAB yes, useradd
# picks the private group's GID itself, from the first free number rather than from
# the UID, so a pre-existing group at GID 4101 costs the account a matching GID and
# nothing else. No checkpoint here reads a GID.
for want in "$REG1_UID" "$REG2_UID"; do
  if holder=$(getent passwd "$want") && [[ -n $holder ]]; then
    fail "UID $want is already taken by '${holder%%:*}'; this task allocates 4101 and 4102 and cannot stage itself"
  fi
done

# No colon in any -c value, and the dashes below are not a style choice. useradd
# defines VALID(s) as `strcspn (s, ":\n") == strlen (s)` (shadow-utils 4.9,
# src/useradd.c:114) and rejects the whole invocation with "invalid comment" if
# the GECOS string contains either character - because a colon is what separates
# the fields of the /etc/passwd line the comment is about to become. Quoting does
# not help: this is a well-formed single argument being refused on its merits.
# usermod has the identical macro, so the same rule applies to any later -c here.
# These three strings are cosmetic - no checkpoint and no ANSWER reads the GECOS
# field - so the constraint costs nothing but has to be respected, and getting it
# wrong fails setup.sh and takes all ten of this task's fixtures with it.
need sudo useradd -u "$REG1_UID" -c 'RHCSA lab - payroll clerk' "$REG1"
need sudo useradd -u "$REG2_UID" -c 'RHCSA lab - web developer' "$REG2"
# --system, and a nologin shell, because this is the account the report must
# classify as `system`. -r is the same flag spelled the short way.
need sudo useradd --system --shell /sbin/nologin -c 'RHCSA lab - backup service' "$SYSACCT"

# Read every UID back out of the account database, which is the only source
# grade.sh trusts either.
reg1_uid=$(id -u "$REG1" 2>/dev/null)
reg2_uid=$(id -u "$REG2" 2>/dev/null)
sys_uid=$(id -u "$SYSACCT" 2>/dev/null)
[[ $reg1_uid == "$REG1_UID" ]] || fail "$REG1 landed at UID '${reg1_uid:-none}', not $REG1_UID"
[[ $reg2_uid == "$REG2_UID" ]] || fail "$REG2 landed at UID '${reg2_uid:-none}', not $REG2_UID"
[[ $sys_uid =~ ^[0-9]+$ ]] || fail "could not read $SYSACCT's UID back from the account database"
# The half that matters. If the system account landed at 1000 or above, the
# report's `system` branch would never be exercised by any probe and
# antisolutions/03 - the fixture that omits that branch entirely - would pass.
(( sys_uid < 1000 )) \
  || fail "$SYSACCT landed at UID $sys_uid, which is not below 1000; check SYS_UID_MAX in /etc/login.defs - the system/user split this task grades needs a system account under 1000"

# ABSENT must not resolve, or `ghostuser missing` is not the right answer for the
# sample list or for two of the probes.
! id "$ABSENT" &>/dev/null \
  || fail "an account named $ABSENT exists on this guest; the sample list and two checkpoints are built on that name resolving to nothing"

# The sample list. Deliberately shaped like the input the student will be graded
# on rather than like a tidy example:
#   - a blank line in the middle, so "ignore blank lines" is visible
#   - a system account (root) next to two regular ones
#   - a name that does not resolve
#   - NO trailing newline on the last entry
# The last of those is the whole reason this file is written with a printf whose
# format string does not end in \n. It is the trap the prompt warns about, and
# handing it to the student in the sample is what makes the lab fair: a
# `while read` loop with no guard drops `webdev` on the first thing they try, so
# the bug is discoverable here rather than only in the grader.
printf '%s\n\n%s\n%s\n%s' "$REG1" root "$ABSENT" "$REG2" > "$LIST" \
  || fail "could not write $LIST as $TARGET_USER"
need chmod 0644 "$LIST"

# Prove the sample really is unterminated, because a well-meaning edit to the
# printf above would silently turn this lab's most interesting input into an
# ordinary one and the student would meet the trap for the first time in the
# grader. Command substitution strips trailing newlines, so this reads as: the
# last byte of the file is something other than a newline. `tail -c1 | wc -c`
# would NOT work here - it is 1 either way.
[[ -n $(tail -c1 "$LIST") ]] \
  || fail "$LIST ends with a newline; the sample list is supposed to be unterminated"

# The stamp accounts-intact is graded against: the name:uid pairs this file
# created, as the account database reports them right now. grade.sh recomputes
# its expected UIDs from getent at grade time - it has to, or a task that
# allocates a system UID dynamically could not be graded - and this stamp is
# what stops that from becoming a hole: an answer that "fixed" the report by
# moving an account's UID would still satisfy every behaviour probe, and only
# this comparison notices.
need sudo mkdir -p "$STAMP_DIR"
printf '%s:%s\n%s:%s\n%s:%s\n' \
  "$REG1" "$reg1_uid" "$REG2" "$reg2_uid" "$SYSACCT" "$sys_uid" \
  | sudo tee "$STAMP" >/dev/null
need sudo chmod 0644 "$STAMP"
# Read it back the way grade.sh reads it. The grader fails every checkpoint
# closed on an unreadable or short stamp, so a stamp that did not land is a task
# nobody can pass - better to say so here than to hand the student a grader that
# fails for a reason they cannot see.
[[ $(grep -c ':' "$STAMP" 2>/dev/null) -eq 3 ]] \
  || fail "$STAMP does not read back as three name:uid lines; grade.sh fails closed on that and no answer could pass"

# --- verify every precondition the checkpoints depend on ------------------
# Not merely the ones this script needs. A precondition that only guards the
# script leaves the checkpoints free to pass or fail for reasons that have
# nothing to do with the student, which is a student-facing false pass and not a
# solved task. One block per checkpoint, in grade.sh's order.

# script-executable, and with it every behaviour probe: the artefact must not
# exist. This is the only thing the student is asked to create, so this single
# absence is what makes all eight goal checkpoints fail at baseline - `timeout`
# exits 127 with empty stdout for a command that is not there, which is not the
# empty output empty-list wants (it wants status 0 too) and not the status 2
# no-arg-usage wants.
[[ ! -e $SCRIPT ]] \
  || fail "$SCRIPT still exists after the rm, so script-executable would pass at baseline"

# The grader runs the script as $TARGET_USER through `timeout`. Both have to be
# there, or every behaviour probe fails for a reason that is not the student's.
command -v timeout >/dev/null \
  || fail "timeout(1) is not installed; grade.sh runs the student's script under it so a runaway loop cannot hang the run"

# mixed-list, blank-lines, unterminated-line, unseen-input: the grader writes its
# own list files into a fresh mktemp directory. If it cannot, it fails every
# checkpoint closed.
probe_dir=$(mktemp -d /tmp/rhcsa-037-setup-probe.XXXXXX 2>/dev/null) \
  || fail "mktemp -d under /tmp failed as $TARGET_USER; grade.sh writes its probe lists there and would fail every checkpoint closed"
rm -rf "$probe_dir"

# accounts-intact: prove the invariant holds before the student starts, so a
# failure afterwards can only mean the student's answer moved an account.
for pair in "$REG1:$reg1_uid" "$REG2:$reg2_uid" "$SYSACCT:$sys_uid"; do
  grep -qxF -- "$pair" "$STAMP" \
    || fail "the stamp does not contain '$pair'; the accounts-intact invariant would fail for every fixture"
done

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
