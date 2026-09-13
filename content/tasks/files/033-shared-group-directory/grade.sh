#!/usr/bin/env bash
# Grader for files/033-shared-group-directory.
#
# READ-ONLY. Changes nothing. Exit code is ignored; only the JSONL emitted by
# ck_pass / ck_fail / ck_skip is read. assert.sh is prepended by loadTaskScripts,
# so its helpers are already in scope.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and MUST pass from the start - here that is
# content-preserved, which exists to catch an answer that "fixes" the directory
# by deleting it and starting again.
# baseline-fail: dir-group, dir-setgid, dir-sticky, dir-group-rwx, dir-no-other, umask-dana, umask-erik, content-shared
set -uo pipefail

GROUP=payroll
DIR=/srv/payroll
FILE=$DIR/handover.txt

# --- what this grader can and cannot prove ---------------------------------
#
# The prompt is written in terms of behaviour: dana can write here, erik cannot
# delete dana's file, a new file lands group-writable. A grader that changed
# nothing cannot create a file as dana and look at the result, so every
# behavioural claim below is graded through the durable configuration that
# produces it. Stated honestly, one by one:
#
#   "either of them can create, read and edit files here"
#       stands in for  ->  dir-group-rwx (the group owning the directory has
#       write and execute). It cannot prove dana in particular can write: an
#       SELinux denial, a read-only mount, or an ACL mask that strips group
#       write would all leave these bits looking correct. It also cannot prove
#       either user is in the group - the premise guard below refuses to grade
#       at all if they are not, which is the only honest answer available to a
#       read-only check.
#
#   "anything they create in here belongs to the payroll group"
#       stands in for  ->  dir-group + dir-setgid. Those two together are the
#       kernel's rule for group inheritance, so this one is close to airtight:
#       the only thing it cannot see is a filesystem mounted with options that
#       ignore the bit, which does not happen on a stock XFS root.
#
#   "neither can delete or rename the other's files"
#       stands in for  ->  dir-sticky. The restricted-deletion bit IS the
#       mechanism, so nothing else can satisfy the claim; what the check cannot
#       prove is the negative - that no other route to deleting the file exists
#       (a member with sudo, for instance, is not stopped by the sticky bit).
#
#   "nobody outside the group may read, write or enter it"
#       stands in for  ->  dir-no-other. Blind to ACLs by design: an extra
#       `setfacl -m u:mallory:rwx` would grant an outsider access with these
#       mode bits unchanged. It is also blind to root, which ignores all of it.
#
#   "new files they create are group-writable and give outsiders nothing"
#       stands in for  ->  umask-dana + umask-erik, read from a *fresh login
#       shell* for each user. That is the closest thing to a behavioural probe
#       available without writing to the guest: it re-reads whatever startup
#       files the student edited - /etc/profile, /etc/profile.d/*.sh,
#       ~/.bash_profile, ~/.bashrc, /etc/bashrc - in the real order, with the
#       real precedence.
#       What it cannot prove is the mode of an actual new file, which also
#       depends on the creating program (`install -m` and `mkdir -m` ignore the
#       umask entirely) and on any default ACL on the parent directory. It also
#       says nothing about non-login shells or a graphical session.
#       One boundary is worth naming precisely, because it is easy to assume the
#       other way: this is a login *bash* shell, not a PAM login session.
#       `sudo -u` runs /etc/pam.d/sudo, which does not include `postlogin`, so
#       `pam_umask` never runs and the `UMASK` line in /etc/login.defs is not
#       part of what is measured. Only a startup file some shell sources is. That
#       is the right boundary for this task - the prompt asks for a default that
#       follows dana and erik into every shell, and login.defs is a machine-wide
#       login-time floor rather than a per-user setting - but it does mean a
#       login.defs-only answer reads here as unchanged.
#
#   "handover.txt is still there and the group can read and edit it"
#       stands in for  ->  content-preserved + content-shared. The set-GID bit
#       is not retroactive, so the file that was already in the directory has to
#       be fixed by hand; that is the single most common miss in this task.
#
# Nothing here is graded by mechanism. `chmod 3770` and
# `chmod g+rwxs,o-rwx,+t` produce identical bits and both pass; a umask set in
# /etc/profile.d, in ~/.bash_profile or in ~/.bashrc is read identically,
# because what is read is the umask itself and not the file that set it.
#
# --- why every read below goes through `sudo -n` ---------------------------
#
# This grader is deliberately locked out of the thing it has to measure, and
# that is not an accident of the guest - it is what a correct answer MEANS.
# dir-no-other demands the other digit be 0, and setup.sh guarantees student is
# NOT in the payroll group, so on every correct answer student has no execute
# bit on /srv/payroll and cannot traverse it. An unprivileged `[[ -f $FILE ]]`
# or `stat "$FILE"` is then EACCES, which is indistinguishable from "the file is
# gone" - content-preserved and content-shared would fail for all three
# solutions and pass for nothing, and the task would be unsolvable. The same
# trap is one step up: "no user outside the group may enter it" invites a
# student to tighten /srv as well, and then even the directory's own mode is
# unreadable. So the mode and group of both paths are read as root.
#
# Reading as root does not weaken any checkpoint. `stat` and `test` write
# nothing, so the grader stays READ-ONLY, and root sees the same mode bits and
# the same group name the kernel would show anybody - the values graded here are
# properties of the inode, not of who looked at it. What it does cost is stated
# in dir-no-other's note above: this grader was already blind to ACLs and to
# root's own exemption from the mode bits, and reading as root does not change
# that either way.
#
# Every `sudo` here is `sudo -n` so it can never block on a password prompt, and
# every one gets `< /dev/null`: grade.sh itself is delivered to the guest on ssh
# stdin (`bash -s`, see src/engine/vm/ssh.ts), so a forked process that reads
# stdin swallows the rest of this script and the trailing checkpoints vanish
# from the JSONL instead of failing. See the same pattern in
# content/tasks/sys/035-persistent-journal-and-schedule/grade.sh.

# --- fail closed: refuse to grade a machine whose premise is gone ----------
#
# bash treats an empty operand as 0 and an unset variable in a `case` as "no
# branch matched", so a grader that could not read what it needs is at constant
# risk of reporting the wrong answer confidently. The specific danger here is a
# *partial* verdict: if the group or the accounts are missing, the umask
# checkpoints can still be satisfied by a global drop-in while every directory
# checkpoint fails, and the student would be shown a half-solved task rather
# than "the premise this task rests on is not there any more". setup.sh
# guarantees the group, the two accounts and the working `sudo -u` probe, and
# docs/vm-build-checklist.md guarantees student's passwordless sudo, so if any of
# these is absent the guest is broken and not the answer.
premise=
getent group "$GROUP" >/dev/null 2>&1 || premise="group $GROUP does not exist"
for u in dana erik; do
  id "$u" >/dev/null 2>&1 || premise="${premise:+$premise; }user $u does not exist"
done
command -v stat >/dev/null 2>&1 || premise="${premise:+$premise; }the stat command is not available"
# Passwordless sudo is a premise rather than a convenience: all nine checkpoints
# below are read through it (see the note above), and without this guard a guest
# that had lost it would report every one of them as a failure of the student's
# answer. `-n` never prompts, `< /dev/null` because this script is arriving on
# stdin.
sudo -n true < /dev/null 2>/dev/null \
  || premise="${premise:+$premise; }student cannot run sudo without a password, so the grader cannot read inside $DIR or open a login shell as dana or erik"

if [[ -n $premise ]]; then
  detail="cannot grade: $premise. setup.sh creates the $GROUP group and the dana and erik accounts, and docs/vm-build-checklist.md gives student passwordless sudo, so this is a broken guest rather than a wrong answer."
  ck_fail dir-group "$DIR is group-owned by $GROUP" "$detail"
  ck_fail dir-setgid "$DIR has the set-GID bit set" "$detail"
  ck_fail dir-sticky "$DIR has the sticky bit set" "$detail"
  ck_fail dir-group-rwx "the $GROUP group may read, write and enter $DIR" "$detail"
  ck_fail dir-no-other "$DIR grants nothing to users outside the group" "$detail"
  ck_fail umask-dana "a new login shell for dana starts with a group-writable, other-nothing umask" "$detail"
  ck_fail umask-erik "a new login shell for erik starts with a group-writable, other-nothing umask" "$detail"
  ck_fail content-preserved "handover.txt is still in $DIR" "$detail"
  ck_fail content-shared "handover.txt is group-owned by $GROUP and group-writable" "$detail"
  exit 0
fi

# --- read the directory once ----------------------------------------------
# One read, five checkpoints. `stat -c %04a` reports the special bits in the
# leading digit (1777 for /tmp), which is the whole reason this task can be
# graded from the mode string at all.
#
# The symlink case is checked separately and explicitly. Plain `stat` does not
# follow a symlink, so a `/srv/payroll -> /opt/payroll` would be measured as
# lrwxrwxrwx: dir-group-rwx would PASS on the link's meaningless 777 while the
# rest failed. Rejecting the link outright is both correct - the prompt names a
# path, and a directory is what belongs at it - and clearer to read than a
# mixture of passes derived from a link's mode.
#
# `sudo -n test` rather than bash's `[[ -L ]]` and `[[ -d ]]`, and one `sudo -n
# stat` for both values rather than two: see the sudo note above. Mode first in
# the format string, and the group taken as "everything after the first space",
# so the parse cannot be confused by a group name containing one.
dir_ok=no
dir_mode=
dir_grp=
dir_why=
if sudo -n test -L "$DIR" < /dev/null 2>/dev/null; then
  dir_why="$DIR is a symbolic link, not a directory; the bits that matter are the ones on the directory itself"
elif ! sudo -n test -d "$DIR" < /dev/null 2>/dev/null; then
  dir_why="$DIR does not exist, or is not a directory"
else
  dir_stat=$(sudo -n stat -c '%04a %G' "$DIR" < /dev/null 2>/dev/null || true)
  dir_mode=${dir_stat%% *}
  [[ $dir_stat == *' '* ]] && dir_grp=${dir_stat#* }
  if [[ $dir_mode =~ ^[0-7]{4}$ ]]; then
    dir_ok=yes
  else
    dir_why="could not read the mode of $DIR (stat produced '${dir_stat:-nothing}')"
    dir_mode=
  fi
fi

# Digit-by-digit rather than arithmetic on purpose. `$(( 8#$dir_mode ))` on an
# empty string is an arithmetic error whose result is 0, and 0 masked against
# anything is 0 - so an unreadable directory would come out as "no bits set",
# which is a fail here but is exactly the shape that fails open elsewhere. An
# empty string matches none of these case branches, so the answer stays "no".
sp=; gd=; od=
if [[ $dir_ok == yes ]]; then
  sp=${dir_mode:0:1}
  gd=${dir_mode:2:1}
  od=${dir_mode:3:1}
fi
has_setgid=no
case $sp in 2 | 3 | 6 | 7) has_setgid=yes ;; esac
has_sticky=no
case $sp in 1 | 3 | 5 | 7) has_sticky=yes ;; esac

# Printed in every failure detail: a student who sees `mode=0755 group=root` can
# see the whole problem at once, and a student who sees `mode=2775` knows the
# bits they set are there and something else is wrong.
dir_state="mode=${dir_mode:-unreadable} group=${dir_grp:-unreadable}"
[[ -n $dir_why ]] && dir_state="$dir_why"

# --- 1. the directory belongs to the group --------------------------------
# Necessary for set-GID to mean anything: the bit makes new files inherit the
# *directory's* group, so a set-GID directory owned by root propagates root.
if [[ $dir_ok == yes && $dir_grp == "$GROUP" ]]; then
  ck_pass dir-group "$DIR is group-owned by $GROUP"
else
  ck_fail dir-group "$DIR is group-owned by $GROUP" \
    "$dir_state; new files inherit the directory's group, so this has to be $GROUP"
fi

# --- 2. set-GID ------------------------------------------------------------
if [[ $has_setgid == yes ]]; then
  ck_pass dir-setgid "$DIR has the set-GID bit set"
else
  ck_fail dir-setgid "$DIR has the set-GID bit set" \
    "$dir_state; without the set-GID bit a new file gets the creator's primary group, not $GROUP"
fi

# --- 3. sticky -------------------------------------------------------------
# The only mechanism there is for "you may write in this directory but you may
# only delete your own files", so this checkpoint and the prompt's third bullet
# are the same statement.
if [[ $has_sticky == yes ]]; then
  ck_pass dir-sticky "$DIR has the sticky bit set"
else
  ck_fail dir-sticky "$DIR has the sticky bit set" \
    "$dir_state; in a group-writable directory without the sticky bit, any member can delete any other member's files"
fi

# --- 4. the group can actually work in there ------------------------------
# Exactly rwx. Write without execute cannot create a file (the directory has to
# be searchable), and read without write is the state this task starts in.
if [[ $gd == 7 ]]; then
  ck_pass dir-group-rwx "the $GROUP group may read, write and enter $DIR"
else
  ck_fail dir-group-rwx "the $GROUP group may read, write and enter $DIR" \
    "$dir_state; the group needs all three of r, w and x on a directory people create files in"
fi

# --- 5. nothing for anyone else -------------------------------------------
# The half of `chmod 2775` that people forget. It is also what makes the sticky
# bit matter rather than merely tidy: a world-writable shared directory lets any
# account on the system add files there.
if [[ $od == 0 ]]; then
  ck_pass dir-no-other "$DIR grants nothing to users outside the group"
else
  ck_fail dir-no-other "$DIR grants nothing to users outside the group" \
    "$dir_state; the last digit must be 0 - r-x for others still lets any account list the directory and read the files"
fi

# --- 6. the file that was already there -----------------------------------
# Two checkpoints from one read. content-preserved is the invariant: it passes
# before the student starts, and it fails only for an answer that solved the
# permissions by deleting the data. content-shared is the retroactivity lesson -
# set-GID applies to files created *after* it is set, so this file needs fixing
# by hand no matter how correct the directory now is.
#
# Every read of $FILE is `sudo -n`, and this is the checkpoint pair the sudo note
# above exists for: $FILE lives *inside* the directory the answer is supposed to
# close to outsiders, so an unprivileged read of it fails on exactly the answers
# that are right. A symlink is rejected for the same reason it is on the
# directory: the prompt says the file must still be *there*, and a link pointing
# somewhere else is not the data staying put. `test -f` alone follows the link and
# would call that preserved, so both tests are needed and the link is checked
# first.
file_present=no
file_why=
if sudo -n test -L "$FILE" < /dev/null 2>/dev/null; then
  file_why="$FILE is a symbolic link rather than the file itself"
elif sudo -n test -f "$FILE" < /dev/null 2>/dev/null; then
  file_present=yes
else
  file_why="$FILE is missing, or is not a regular file"
fi

file_ok=no
file_mode=
file_grp=
if [[ $file_present == yes ]]; then
  file_stat=$(sudo -n stat -c '%04a %G' "$FILE" < /dev/null 2>/dev/null || true)
  file_mode=${file_stat%% *}
  [[ $file_stat == *' '* ]] && file_grp=${file_stat#* }
  [[ $file_mode =~ ^[0-7]{4}$ ]] && file_ok=yes
fi

if [[ $file_present == yes ]]; then
  ck_pass content-preserved "handover.txt is still in $DIR"
else
  ck_fail content-preserved "handover.txt is still in $DIR" \
    "$file_why; the team's notes were not something to delete on the way to fixing the permissions"
fi

# Group read AND write, so 6 or 7 in the group digit. 4 (the state this starts
# in) is not enough: the prompt asks for a file the group can edit.
file_gd=
[[ $file_ok == yes ]] && file_gd=${file_mode:2:1}
group_can_edit=no
case $file_gd in 6 | 7) group_can_edit=yes ;; esac

# A checkpoint whose subject no longer exists must report failure with a detail
# that says so, not "mode=unreadable": those are two different diagnoses and only
# one of them is the student's fault.
file_state="mode=${file_mode:-unreadable} group=${file_grp:-unreadable}"
[[ -n $file_why ]] && file_state="$file_why"

if [[ $file_ok == yes && $file_grp == "$GROUP" && $group_can_edit == yes ]]; then
  ck_pass content-shared "handover.txt is group-owned by $GROUP and group-writable"
else
  ck_fail content-shared "handover.txt is group-owned by $GROUP and group-writable" \
    "$file_state; set-GID is not retroactive, so a file that was already in the directory keeps its old group and mode"
fi

# --- 7. the default permissions those two users get -----------------------
#
# Read from a fresh login shell for the user, which is the mechanism-agnostic
# question: whatever the student edited - /etc/profile.d/*.sh, ~/.bash_profile,
# ~/.bashrc, /etc/bashrc - a login shell reads it in the real order and ends up
# with one number. Grepping the startup files instead would have to guess file
# names, would match a commented-out line, and could not see which of two
# settings wins. (pam_umask and /etc/login.defs are deliberately outside this
# probe; see the boundary note in the header.)
#
# Still read-only: this forks a shell as the user and reads a value out of it. It
# writes no file and changes no configuration. `sudo -n` so it can never block
# on a password prompt, `cd /` because the grader's own working directory is
# /home/student, which mode 0700 makes unreadable to dana and erik and which
# makes bash noisy for no reason.
#
# `< /dev/null` is not optional here, and this is the one place in the bank where
# leaving it off is actively dangerous. grade.sh is delivered on ssh stdin
# (`bash -s`), and this line forks a LOGIN shell that sources whatever startup
# files the student wrote. One `read` in one of those files - and a student
# debugging their own ~/.bash_profile is exactly the person who leaves a stray
# `read` in it - consumes the remainder of grade.sh off stdin. The trailing
# checkpoints then never run: they vanish from the JSONL instead of failing,
# parseVerdict never sees them, and allPassed ignores what it cannot see. The
# redirect makes that impossible. Same pattern, same reason, as
# content/tasks/sys/035-persistent-journal-and-schedule/grade.sh.
#
# This is also the checkpoint the reboot exists for, and it needs no extra work
# to be one: a umask typed into a shell is invisible here in the FIRST verdict
# already, because this is a different shell. That is stricter than the reboot
# check, not weaker than it - see antisolutions/01.
login_umask() {
  local user=$1
  (cd / && sudo -n -u "$user" bash -lc 'umask' < /dev/null 2>/dev/null) | tail -n1 | tr -d '[:space:]'
}

# The goal, in umask terms: mask nothing away from the group (digit 0, so a new
# file is 0660 and a new directory 2770) and mask everything away from other
# (digit 7). `0*` in front absorbs the leading zero bash prints, so 007, 0007
# and a symbolic `umask u=rwx,g=rwx,o=` all read the same. An unreadable or
# malformed value matches nothing and the checkpoint fails - which is the safe
# direction, and is why the probe is validated in setup.sh where a broken probe
# can still be reported as a broken guest.
dana_umask=$(login_umask dana || true)
if [[ $dana_umask =~ ^0*([0-7])([0-7])([0-7])$ ]] && [[ ${BASH_REMATCH[2]} == 0 && ${BASH_REMATCH[3]} == 7 ]]; then
  ck_pass umask-dana "a new login shell for dana starts with a group-writable, other-nothing umask"
else
  ck_fail umask-dana "a new login shell for dana starts with a group-writable, other-nothing umask" \
    "dana's login shell starts with umask ${dana_umask:-unreadable}; the group digit must be 0 and the other digit 7, and it has to come from a file a login shell reads"
fi

erik_umask=$(login_umask erik || true)
if [[ $erik_umask =~ ^0*([0-7])([0-7])([0-7])$ ]] && [[ ${BASH_REMATCH[2]} == 0 && ${BASH_REMATCH[3]} == 7 ]]; then
  ck_pass umask-erik "a new login shell for erik starts with a group-writable, other-nothing umask"
else
  ck_fail umask-erik "a new login shell for erik starts with a group-writable, other-nothing umask" \
    "erik's login shell starts with umask ${erik_umask:-unreadable}; the group digit must be 0 and the other digit 7, and it has to come from a file a login shell reads"
fi

exit 0
