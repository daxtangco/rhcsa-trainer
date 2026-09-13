#!/usr/bin/env bash
# Prepare the system for files/033-shared-group-directory.
#
# Builds the situation the prompt describes: a group with two members, a
# directory somebody created with `mkdir` and nothing else, and one file already
# sitting in it that belongs to root and is readable by the world. Every one of
# those details is load-bearing for a checkpoint, and each is verified below
# rather than assumed.
#
# Runs as student with passwordless sudo, over ssh stdin, with no TTY.
set -uo pipefail

# No `set -e`: the cleanup block legitimately fails on a first run (there is no
# user to delete, no group to remove, no mount to undo). So the commands that
# MUST work are wrapped instead - a silent failure here stages the wrong machine
# and every checkpoint result afterwards is a lie. This is the same deliberate
# divergence from content/tasks/storage/014-grow-home-lv/setup.sh that
# content/tasks/users/006-team-provisioning/setup.sh documents; do not
# "harmonise" them.
fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }
need() { "$@" || fail "FAILED: $*"; }

GROUP=payroll
DIR=/srv/payroll
FILE=$DIR/handover.txt

# The names are deliberately disjoint from content/tasks/users/006-team-
# provisioning, which owns the group `devops` and the users alice, bob and
# carol. Both tasks can be attempted on the same guest without either one's
# setup deleting the other's accounts, and neither task's checkpoints can be
# satisfied by the other task's work.

# --- undo any prior attempt ------------------------------------------------
# The harness reverts a snapshot before each fixture, so this block is
# belt-and-braces for a human re-running setup by hand after solving the task
# once. It has to undo *solutions*, not merely its own previous run: every
# artefact any shipped fixture creates is removed here.

# antisolutions/02 mounts a tmpfs over $DIR. Unmount first, or everything below
# writes into the overlay while the real directory keeps whatever the last run
# left in it - and the reset would look like it worked.
#
# `sudo -n mountpoint`, not a bare one: on entry $DIR is whatever the previous
# run left, and every correct answer to this task leaves it mode 3770 with
# student outside the payroll group. `mountpoint` compares the device of $DIR
# with the device of "$DIR/..", which needs execute permission ON $DIR - so
# unprivileged it reports "not a mountpoint" for a directory that is one, the
# loop never runs, and everything below silently writes into the tmpfs.
while sudo -n mountpoint -q "$DIR" 2>/dev/null; do
  sudo umount "$DIR" || fail "$DIR is mounted and could not be unmounted"
done

# userdel -r takes the home directory with it, which is the point: solutions/02
# writes a umask into ~dana/.bash_profile, and a leftover copy of that line
# would satisfy umask-dana before the student has done anything.
for u in dana erik; do
  if id "$u" &>/dev/null; then
    sudo userdel -r "$u" 2>/dev/null || sudo userdel "$u"
  fi
done
getent group "$GROUP" &>/dev/null && sudo groupdel "$GROUP"

# The two drop-in names solutions/01 and solutions/03 use. A student's own file
# under a name nobody can predict is not cleaned up here and does not need to
# be: the umask preconditions below measure the *effect*, so any leftover that
# would matter is caught by measurement rather than by guessing file names.
sudo rm -f /etc/profile.d/payroll-umask.sh /etc/profile.d/collab-umask.sh

sudo rm -rf "$DIR"

# --- build the situation the prompt describes ------------------------------
need sudo groupadd "$GROUP"

# No `-g` for the primary group, so each user gets the private group RHEL creates
# by default (`dana:dana`). That is load-bearing for the *lesson*, not for the
# umask: a user whose primary group already IS payroll gets payroll on every file
# they create without any set-GID bit anywhere, so `useradd -g payroll dana` would
# hand dana the thing dir-setgid exists to teach and leave the bit doing nothing
# observable for her.
#
# Deliberately NOT claimed here: anything about where the starting umask comes
# from. The comment this replaces said `/etc/profile` runs `umask 002` when UID >
# 199 and the primary group name matches the user name, and that the `-g` choice
# is therefore what sets the baseline umask. That was true on RHEL 7 and 8 and is
# false on RHEL 9.8: /etc/profile has no umask block at all any more, /etc/bashrc
# sets 022 only if the umask is already 0 and only for non-login shells, and
# `pam_umask` in /etc/pam.d/postlogin is what sets it - from `UMASK 022` in
# /etc/login.defs, with its `usergroups` option OFF because /etc/pam.d/postlogin
# does not pass it. So every account on this guest starts on 022 regardless of its
# primary group. The baseline is pinned by the measurement at the bottom of this
# script rather than by any of that reasoning, which is what makes a future RHEL
# moving it again fail loudly here instead of quietly in a verdict.
for u in dana erik; do
  need sudo useradd -m -c "payroll clerk" "$u"
  need sudo usermod -aG "$GROUP" "$u"
done

# root:root 0755 is exactly what `sudo mkdir /srv/payroll` leaves behind, which
# is the believable half-done state: the directory exists, the team has been
# told to use it, and nobody set it up for sharing.
need sudo install -d -o root -g root -m 0755 "$DIR"

printf '%s\n' \
  'Q3 payroll handover notes.' \
  'dana: rates table checked.' \
  'erik: still to reconcile the November adjustments.' \
  | sudo tee "$FILE" >/dev/null || fail "could not create $FILE"
# Explicit, not inherited: whatever umask this setup shell happens to run with,
# the file must start owned by root and group-readable-only, because
# content-shared grades exactly those two properties.
need sudo chown root:root "$FILE"
need sudo chmod 0644 "$FILE"

# --- preconditions ---------------------------------------------------------
# Every checkpoint in grade.sh measures a property of this starting state, and
# each one gets a check here. A precondition that only guarded this script would
# leave the checkpoints free to pass or fail at baseline for reasons that have
# nothing to do with the student, which is a student-facing false pass and not a
# solved task.

# dir-group, dir-setgid, dir-sticky, dir-group-rwx, dir-no-other all read the
# mode and group of $DIR, so the starting mode and group are what has to be
# pinned. 0755/root:root fails all five; anything with the group bits or a
# special bit already set would hand the student a checkpoint for free.
#
# `sudo -n` on every read from here down, without exception, and the exception is
# what makes it worth stating: $DIR and $FILE happen to be readable to student at
# this exact point in the script, because `install -d -m 0755` two lines up just
# made them so. Relying on that is how this file acquired its first defect - a
# bare `[ -f /home/$u/.bash_profile ]` further down, on a path mode 0700 keeps
# student out of, which aborted every fixture. A setup script that reads some
# paths privileged and others not invites the next edit to guess wrong, so it
# reads everything privileged and there is nothing to guess.
sudo -n test -d "$DIR" && sudo -n test ! -L "$DIR" || fail "$DIR is not a plain directory after install -d"
sudo -n mountpoint -q "$DIR" 2>/dev/null && fail "$DIR is a mount point; the graded permissions would belong to whatever is mounted there"
dirmode=$(sudo -n stat -c '%04a' "$DIR" 2>/dev/null)
dirgrp=$(sudo -n stat -c '%G' "$DIR" 2>/dev/null)
[ "$dirmode" = "0755" ] || fail "$DIR is mode ${dirmode:-unreadable}, expected 0755; the dir-* checkpoints would not all start red"
[ "$dirgrp" = "root" ] || fail "$DIR is group-owned by ${dirgrp:-unreadable}, expected root; dir-group would pass at baseline"

# content-preserved is an invariant: it must be TRUE now, so that a failure can
# only mean the student destroyed the file. content-shared must be FALSE now,
# which needs both halves pinned - group root and no group write bit.
sudo -n test -f "$FILE" || fail "$FILE was not created"
filemode=$(sudo -n stat -c '%04a' "$FILE" 2>/dev/null)
filegrp=$(sudo -n stat -c '%G' "$FILE" 2>/dev/null)
[ "$filemode" = "0644" ] || fail "$FILE is mode ${filemode:-unreadable}, expected 0644; content-shared would pass at baseline"
[ "$filegrp" = "root" ] || fail "$FILE is group-owned by ${filegrp:-unreadable}, expected root; content-shared would pass at baseline"

# The premise grade.sh refuses to grade without (see its fail-closed guard):
# the group exists and both users are in it. If this were wrong, every
# checkpoint would fail for a reason the student cannot see or fix.
getent group "$GROUP" >/dev/null 2>&1 || fail "group $GROUP does not exist after groupadd"
#
# The membership test is a `case` on the whole group list rather than the
# `id -nG | tr | grep -qx` pipeline used elsewhere in the bank, and that is
# deliberate under `set -o pipefail`: `grep -q` exits as soon as it matches, so
# the writer at the head of the pipeline can be killed by SIGPIPE and make a
# *successful* match report a non-zero pipeline. The consequence here would be a
# setup that aborts with "not a member" on a machine that is correct. The spaces
# around both the subject and the pattern are what keep it a whole-word test, so
# a group named `payrollers` cannot match.
for u in dana erik; do
  id "$u" &>/dev/null || fail "user $u does not exist after useradd"
  case " $(id -nG "$u" 2>/dev/null) " in
    *" $GROUP "*) ;;
    *) fail "$u is not a member of $GROUP; the whole premise of the task is missing" ;;
  esac
  # `sudo -n test`, not a bare `[ -f ]`. useradd -m creates /home/$u at mode
  # 0700 owned by $u, and this script runs as student - so student cannot
  # traverse it and the bare test is FALSE on a perfectly good guest. Unfixed it
  # aborted every fixture including the baseline with "setup.sh exited 1", which
  # is the whole task failing to start.
  #
  # What it is actually confirming: that useradd -m copied /etc/skel, so
  # ~/.bash_profile exists with its `. ~/.bashrc` line in it. That is the file
  # solutions/02 appends to, and the reason it can claim its umask runs last.
  sudo -n test -f "/home/$u/.bash_profile" \
    || fail "/home/$u/.bash_profile is missing, so useradd -m did not populate /etc/skel and solutions/02 would be appending its umask to a file that does not exist yet"
done

# student must NOT be in payroll. The prompt promises that no user outside the
# group may enter the directory, and the harness logs in as student: if student
# were a member, a student verifying by hand would get answers that contradict
# the prompt, and a group-conditional umask drop-in would silently change the
# umask of the account the grader itself runs under.
case " $(id -nG student 2>/dev/null) " in
  *" $GROUP "*) fail "student is a member of $GROUP; this guest was not built to docs/vm-build-checklist.md" ;;
esac

# umask-dana and umask-erik: read the umask a fresh login shell gives each user,
# exactly the way grade.sh reads it, and require that it does NOT already meet
# the goal. Two failures are being guarded against at once:
#   1. a guest whose /etc/profile, /etc/profile.d or startup files already hand
#      these users a group-write, other-nothing umask - the umask half of the
#      task would grade as done when nobody did anything;
#   2. a guest where the probe itself does not work (no passwordless `sudo -u`,
#      a login shell that dies) - then both umask checkpoints would fail for
#      every fixture, including correct ones, and the failure would look like a
#      grader bug rather than a broken guest.
# /etc/login.defs is not in that list on purpose: `sudo -u` runs
# /etc/pam.d/sudo, which does not include `postlogin`, so `pam_umask` never runs
# in this probe. This measures what grade.sh measures, which is the point - a
# guard that probed more than the grader would reject guests the grader is happy
# with.
#
# `< /dev/null` for the same reason grade.sh has it: setup.sh is delivered on ssh
# stdin (`bash -s`), and this line forks a login shell that sources startup
# files. A stray `read` in one of them would consume the rest of this script, and
# the preconditions after this loop would silently never run.
for u in dana erik; do
  m=$(cd / && sudo -n -u "$u" bash -lc 'umask' < /dev/null 2>/dev/null | tail -n1 | tr -d '[:space:]')
  if [[ ! $m =~ ^0*([0-7])([0-7])([0-7])$ ]]; then
    fail "could not read $u's login umask (got '${m:-nothing}'); grade.sh reads it the same way and would fail umask-$u for every fixture"
  fi
  if [ "${BASH_REMATCH[2]}" = "0" ] && [ "${BASH_REMATCH[3]}" = "7" ]; then
    fail "$u's login shell already starts with umask $m, so umask-$u would pass at baseline"
  fi
done

# The grader never reads history, but a student who reverts and then sees their
# own previous commands has been given a hint nobody offered them.
: > "$HOME/.bash_history" 2>/dev/null || true
history -c 2>/dev/null || true

exit 0
