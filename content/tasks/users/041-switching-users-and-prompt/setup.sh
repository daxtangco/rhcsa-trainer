#!/usr/bin/env bash
# Prepare the system for users/041-switching-users-and-prompt.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell.
#
# IDEMPOTENT, and unlike storage/014 it can honestly claim to be. Everything this
# task changes is reversible: field 7 of one /etc/passwd line, field 2 of one
# /etc/shadow line, two dotfiles in one home directory, and a tagged line every
# fixture in this task leaves in a file whose name is listed below. So this script
# puts all of it back and then re-runs the grader's own probes to prove the
# baseline it just staged is the one the checkpoints expect. The one thing it
# cannot put back is a prompt a *student* wrote somewhere this file does not know
# about; that is verified rather than repaired, and the message says so.
#
# `set -uo pipefail` without -e, following sys/035 rather than storage/014: this
# file is full of idempotent removals that legitimately fail on a first run (there
# is no account to modify, no dotfile to replace). The commands that MUST work go
# through `need`, because a silent failure here stages the wrong machine and every
# checkpoint afterwards is a lie.
set -uo pipefail

need() { "$@" || { printf 'setup.sh: FAILED: %s\n' "$*" >&2; exit 1; }; }
fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

TARGET_USER=oncall
CONTROL_USER=student
PROBE_DIR=/usr/share/doc
# Every solution and anti-solution in this task tags the line it appends with this
# marker, so a setup re-run by hand after a fixture leaves nothing behind that the
# grader would count. Spelled identically in every solutions/*.sh and
# antisolutions/*.sh; the snapshot revert makes it unnecessary for the harness and
# necessary for the human.
TAG='# rhcsa041'
SELFTEST_TAG='# rhcsa041-selftest'
# Files a fixture in this task may have appended a tagged line to, and the only
# files outside the target account this script edits. A student's own answer is
# not swept from here - it carries no tag - which is why the verification at the
# bottom exists.
GLOBAL_FILES=(/etc/bashrc /etc/skel/.bashrc /etc/skel/.bash_profile)

# The grader's probe, duplicated here rather than shared, the same way sys/035's
# setup.sh carries its own copy of the journal probe: the two scripts are shipped
# to the guest independently and nothing but content/lib/assert.sh is prepended to
# either. If one copy changes the other must change with it - the checks at the
# bottom of this file are what make a divergence loud instead of silent.
# The sentinel and the stripping below are half of the shared mechanism: `su` opens
# a PAM session and /etc/pam.d/postlogin's non-silent pam_lastlog puts
# `Last login: <date>` on stdout ahead of the prompt from the second probe of an
# account onwards - which means this script's own five probes guarantee the grader
# will see it. grade.sh carries the same three lines and the reason is written out
# there.
PROBE_MARK=__RHCSA041_PS1__
PROBE=$(printf 'cd %s || exit 3; printf "%%s%%s" %s "${PS1@P}"' "$PROBE_DIR" "$PROBE_MARK")

render_prompt() {
  local user=$1 kind=$2 out
  local -a su_opts=(-s /bin/bash) bash_opts=(-ic)
  if [[ $kind == login ]]; then
    su_opts+=(-l)
    bash_opts=(-lic)
  fi
  out=$(
    (
      cd "$PROBE_DIR" 2>/dev/null || cd /
      timeout 30 sudo su "${su_opts[@]}" -c "HISTFILE=/dev/null bash ${bash_opts[*]} '$PROBE'" "$user"
    ) </dev/null 2>/dev/null
  )
  [[ $out == *"$PROBE_MARK"* ]] || return 0
  printf '%s' "${out#*"$PROBE_MARK"}"
}

# --- preconditions --------------------------------------------------------
# Verify every precondition the goal checkpoints depend on, not only the ones this
# script needs to run: a precondition that only guards the script leaves the
# checkpoints free to pass or fail for reasons that have nothing to do with the
# student.
id "$CONTROL_USER" &>/dev/null \
  || fail "the control account $CONTROL_USER does not exist, and two checkpoints are graded against that exact account"

[[ -d $PROBE_DIR ]] \
  || fail "$PROBE_DIR is not a directory; every prompt probe renders PS1 while standing in it, so no answer could pass"

# ${var@P} is bash 4.4 and newer. RHEL 9 ships 5.1, so this is a guard against a
# guest that is not what it claims to be rather than a real possibility - and if
# it ever fired, every prompt probe would render the empty string and the grader
# would tell a correct student their prompt was missing all three facts.
at_p=$(bash -c 'v=ok; printf "%s" "${v@P}"' 2>/dev/null)
[[ $at_p == ok ]] \
  || fail "this guest's bash does not support the \${var@P} prompt expansion (got '${at_p:-empty}'); the grader renders PS1 with it and every prompt checkpoint would fail for every answer"

# The task teaches, and the grader accepts, an answer written into ~/.bashrc. That
# only reaches a login shell because RHEL's skeleton .bash_profile sources
# .bashrc, so both files have to be there for the intended answer to work. A home
# directory with no .bash_profile is worse than it looks: bash falls back to
# ~/.profile for login shells, and the student's correct .bashrc answer would fail
# prompt-login for a reason nothing in the prompt hints at.
[[ -f /etc/skel/.bashrc && -f /etc/skel/.bash_profile ]] \
  || fail "/etc/skel is missing .bashrc or .bash_profile, so a fresh home directory here does not behave the way this task's answers assume"

# --- undo what a previous attempt can leave behind ------------------------
# The harness reverts to a snapshot before every fixture, so this block is for the
# human who re-runs setup by hand on a machine they have been poking at.
for f in "${GLOBAL_FILES[@]}"; do
  [[ -f $f ]] || continue
  # Command substitution rather than `grep -q`: under pipefail a `grep -q` that
  # matches early kills its producer with SIGPIPE and reports 141 - the trap
  # documented at the top of content/lib/assert.sh. There is no pipe here, but the
  # next author to add one inherits the shape.
  [[ -n $(sudo grep -sF -- "$TAG" "$f") ]] || continue
  need sudo sed -i "/$TAG/d" "$f"
  # sed -i replaces the file by rename, so it lands with the default SELinux type
  # for its directory rather than the type it had. etc_t either way on a stock
  # guest; cheap insurance on one that was relabelled by hand.
  sudo restorecon "$f" &>/dev/null
done

# --- create the situation the prompt describes ----------------------------
# "It exists on this host, and that is all that can be said for it": an account
# with a service account's shell and a password that was never set. Both halves
# are what make login-shell and login-password fail at baseline - a stock
# `useradd oncall` would already have a real shell from /etc/default/useradd and
# login-shell would be green before the student typed anything.
if id "$TARGET_USER" &>/dev/null; then
  need sudo usermod -s /sbin/nologin "$TARGET_USER"
else
  need sudo useradd -m -c 'on-call contractor' -s /sbin/nologin "$TARGET_USER"
fi

# '!!' is exactly what useradd writes into the shadow password field for an
# account created without one, so this is a re-run landing on the same state a
# first run lands on rather than a second kind of locked. Not `passwd -d`, which
# empties the field: an empty field is a passwordless login, which is a hole
# rather than a baseline.
need sudo usermod -p '!!' "$TARGET_USER"

home=$(getent passwd "$TARGET_USER" | awk -F: '{print $6}')
[[ -n $home ]] || fail "could not read $TARGET_USER's home directory from getent passwd"
grp=$(id -gn "$TARGET_USER" 2>/dev/null)
[[ -n $grp ]] || fail "could not read $TARGET_USER's primary group"
need sudo mkdir -p "$home"
need sudo chown "$TARGET_USER:$grp" "$home"
need sudo chmod 0700 "$home"

# Replaced from the skeleton rather than edited, so a re-run cannot leave a PS1
# line behind whatever shape it was written in.
need sudo install -o "$TARGET_USER" -g "$grp" -m 0644 /etc/skel/.bashrc "$home/.bashrc"
need sudo install -o "$TARGET_USER" -g "$grp" -m 0644 /etc/skel/.bash_profile "$home/.bash_profile"
# ~/.bash_login and ~/.profile are the two files bash reads INSTEAD of
# ~/.bash_profile when it exists, in that order, so a leftover from a previous
# attempt could quietly satisfy or quietly break prompt-login.
sudo rm -f "$home/.bash_login" "$home/.profile" "$home/.bash_history"
sudo restorecon -R "$home" &>/dev/null

# --- prove the probe machinery works on this guest ------------------------
# The grader observes the prompt instead of reading a file, so everything it
# reports rests on one thing: that a PS1 written into a startup file is visible to
# the shell it starts. That is proved here, before the student sees the task,
# by writing a marker PS1 into ~/.bashrc and looking for it in both shells - and
# it also proves the fact the whole task turns on, that a login shell on this
# guest reaches ~/.bashrc through the skeleton .bash_profile. Without this a guest
# whose skeleton files did not chain would fail prompt-login for every answer
# including both solutions, and the failure would point at the student.
#
# Both probes run before the line is removed, and the verdicts are read after, so
# a failing probe cannot leave the marker behind for the student to find.
MARK=RHCSA041PROBE
printf 'PS1="%s" %s\n' "$MARK" "$SELFTEST_TAG" | sudo tee -a "$home/.bashrc" >/dev/null \
  || fail "could not append the self-test line to $home/.bashrc"
selftest_login=$(render_prompt "$TARGET_USER" login)
selftest_nonlogin=$(render_prompt "$TARGET_USER" nonlogin)
need sudo sed -i "/$SELFTEST_TAG/d" "$home/.bashrc"
sudo restorecon "$home/.bashrc" &>/dev/null

[[ $selftest_login == *"$MARK"* ]] \
  || fail "a PS1 set in $home/.bashrc did not reach an interactive LOGIN shell as $TARGET_USER (probe returned '${selftest_login:-nothing}'). Either the skeleton .bash_profile on this guest does not source .bashrc, or the probe itself cannot start a shell - and prompt-login would then fail for every answer"
[[ $selftest_nonlogin == *"$MARK"* ]] \
  || fail "a PS1 set in $home/.bashrc did not reach an interactive NON-LOGIN shell as $TARGET_USER (probe returned '${selftest_nonlogin:-nothing}'); prompt-nonlogin would fail for every answer"

# --- verify the baseline the checkpoints expect ---------------------------
# One block per checkpoint, in grade.sh's order.

# login-shell: field 7 must be the shell that refuses a login.
shell7=$(getent passwd "$TARGET_USER" | awk -F: '{print $7}')
[[ $shell7 == /sbin/nologin ]] \
  || fail "$TARGET_USER's login shell is '$shell7', not /sbin/nologin, after the usermod above; login-shell would pass at baseline"

# login-password: field 2 must be the never-set form.
hash=$(sudo getent shadow "$TARGET_USER" | awk -F: '{print $2}')
[[ $hash == '!!' ]] \
  || fail "$TARGET_USER's shadow password field reads '${hash:-empty}', not '!!', after the usermod above; login-password may pass at baseline"

# prompt-login and prompt-nonlogin: neither shell may already render the working
# directory in full. This is the check that catches a global PS1 a student or a
# previous fixture left in a file this script does not sweep, and it is verified
# rather than repaired because this script cannot know where it was written.
for kind in login nonlogin; do
  out=$(render_prompt "$TARGET_USER" "$kind")
  [[ -n $out ]] \
    || fail "the $kind prompt probe produced nothing for $TARGET_USER even though the self-test above passed; that is a probe that is not reproducible and no verdict from it would mean anything"
  case $out in
    *"$PROBE_DIR"*)
      fail "$TARGET_USER's $kind prompt already renders $PROBE_DIR in full ('$out'), so the matching prompt checkpoint would pass at baseline. Something sets PS1 where every account reads it - look at /etc/bashrc and /etc/profile.d - and this script deliberately does not delete a line it did not write. Reset the lab (snapshot revert)"
      ;;
  esac
done

# other-prompts-unchanged: the invariant must hold before the student starts, so a
# failure afterwards can only mean the student broke it.
control_prompt=$(render_prompt "$CONTROL_USER" login)
[[ -n $control_prompt ]] \
  || fail "no prompt came back from an interactive login shell as $CONTROL_USER, so other-prompts-unchanged could not be judged for any fixture"
case $control_prompt in
  *"$PROBE_DIR"*)
    fail "$CONTROL_USER's own prompt already renders $PROBE_DIR in full ('$control_prompt'), so other-prompts-unchanged would fail for every fixture including both solutions. Reset the lab (snapshot revert)"
    ;;
esac

# student-login-intact: same reasoning, and this one guards the control channel.
cshell=$(getent passwd "$CONTROL_USER" | awk -F: '{print $7}')
[[ -n $cshell && ${cshell##*/} == bash && -x $cshell ]] \
  || fail "$CONTROL_USER's login shell is '${cshell:-empty}', which is not an executable bash; student-login-intact would fail for every fixture"
chash=$(sudo getent shadow "$CONTROL_USER" | awk -F: '{print $2}')
# The same rule grade.sh's usable_password applies, spelled positively: a usable
# password on RHEL 9 is a crypt(3) string, and every string that is not one -
# empty, '!'-prefixed, '*'-prefixed, a plaintext - fails this test.
[[ $chash == '$'* ]] \
  || fail "$CONTROL_USER's shadow password field is not a crypt(3) hash, so student-login-intact would fail for every fixture. docs/vm-build-checklist.md sets a password for this account at install time and the vmrun transport needs it"

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
