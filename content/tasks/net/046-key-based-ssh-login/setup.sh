#!/usr/bin/env bash
# Prepare the system for net/046-key-based-ssh-login.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell.
#
# ---------------------------------------------------------------------------
# THE SAFETY RULE THIS WHOLE TASK IS BUILT AROUND, stated where it can be
# audited: the harness grades this guest over ssh as `student`, using the key in
# /home/student/.ssh/authorized_keys. If that stops working there is no verdict
# to collect - not a failing checkpoint, an unusable task.
#
# So, observed here and in every fixture of this task:
#   - NOTHING in this task writes to, chmods, chowns, moves or deletes
#     /home/student/.ssh or /home/student/.ssh/authorized_keys. This script only
#     ever READS them, and when it finds them wrong it says so and stops rather
#     than "fixing" them.
#   - NOTHING in this task edits /etc/ssh/sshd_config or
#     /etc/ssh/sshd_config.d/*, and nothing restarts, reloads or stops sshd. The
#     design needs no server-side change at all: the student's work happens
#     inside a second account's home directory, which is where key
#     authentication is configured anyway.
#   - NOTHING here touches firewalld or the NIC. The login being graded is to
#     `localhost`, which never leaves the machine, and loopback is in firewalld's
#     trusted zone regardless.
#   - Every `ssh` in this task carries `-o UserKnownHostsFile=/dev/null`, which
#     is not paranoia about host keys: without it the first connection would
#     write /home/student/.ssh/known_hosts, and "nothing writes inside
#     /home/student/.ssh" would already be false in this file.
# ---------------------------------------------------------------------------
#
# IDEMPOTENT with respect to a previous run of this script and of every shipped
# fixture: the whole of the student's side of the answer is one directory,
# /home/deploy/.ssh, and it is removed and rebuilt below. The one thing it
# deliberately CANNOT reset is a keypair somebody generated in student's own
# ~/.ssh, because deleting files there is the one thing this task must never do -
# so that case fails loudly and names the snapshot revert instead.
#
# `set -uo pipefail` without -e, following files/036 and sys/040: this file is
# full of probes that are meant to be asked rather than to abort, and of removals
# that legitimately fail on a first run. The commands that MUST work go through
# `need`, because a silent failure here stages the wrong machine and every
# checkpoint result afterwards is a lie.
set -uo pipefail

fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }
need() { "$@" || fail "FAILED: $*"; }

# Spelled identically in grade.sh. If these ever disagree the task becomes
# unsatisfiable for every answer.
TARGET_USER=deploy
TARGET_HOME=/home/deploy
TARGET_SSH_DIR=/home/deploy/.ssh
TARGET_AK=/home/deploy/.ssh/authorized_keys
# The password the prompt hands the student. It exists so that the by-the-book
# route (copy the public key over an ordinary password login) is available to a
# human at a terminal; nothing in this task grades it, and no fixture uses it,
# because a password login cannot be driven from a script with no TTY.
TARGET_PW='Deploy-Lab-2026!'

STUDENT_USER=student
STUDENT_SSH_DIR=/home/student/.ssh
STUDENT_AK=/home/student/.ssh/authorized_keys

# The probe grade.sh runs, character for character. It is asserted to FAIL here
# for a specific reason - "Permission denied" and not "Connection refused" -
# because that is the difference between a baseline this task can grade and a
# guest where the checkpoint would be red for reasons the student cannot see.
#
#   -n and `< /dev/null`: this script arrives on ssh's stdin, and an ssh client
#     that inherits it would eat the rest of the file. Same hazard as the
#     `< /dev/null` on dnf in sys/040's setup, and both belts are worn on
#     purpose - -n is the client's own flag, the redirect covers the wrapper.
#   BatchMode=yes: no prompts, ever. Without it a failed key authentication asks
#     for deploy's password and the probe hangs until the harness times out.
#   PreferredAuthentications=publickey and NumberOfPasswordPrompts=0: the probe
#     measures key authentication and nothing else. It also means the probe
#     cannot contribute a PAM authentication failure, so repeated runs cannot
#     trip pam_faillock on the deploy account - a failed public key is not a PAM
#     auth failure and never reaches faillock's counter.
#   UserKnownHostsFile=/dev/null: see the safety rule above.
#   timeout: a grader or a setup script that hangs is worse than one that fails.
SSH_OPTS=(-n
  -o BatchMode=yes
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=10
  -o PreferredAuthentications=publickey
  -o NumberOfPasswordPrompts=0
  -o LogLevel=ERROR)

probe_login() {
  timeout 25 ssh "${SSH_OPTS[@]}" "$TARGET_USER@localhost" true 2>&1 < /dev/null
}

# --- packages and tools ---------------------------------------------------
# A Minimal Install has all of these, and docs/vm-build-checklist.md:71 asks for
# Server rather than Minimal, so this is insurance rather than a fix - but a
# missing openssh-clients would fail every checkpoint in this task and point the
# blame at the student instead of at the image. `< /dev/null` because dnf reads
# stdin and this script's stdin is the rest of the script (sys/040's setup
# documents the same trap).
for pkg in openssh openssh-clients openssh-server policycoreutils; do
  if ! rpm -q "$pkg" &>/dev/null; then
    sudo dnf -y install "$pkg" &>/dev/null < /dev/null
    rpm -q "$pkg" &>/dev/null \
      || fail "$pkg is not installed and 'dnf -y install $pkg' did not fix that; check that /etc/yum.repos.d/rhcsa-dvd.repo points at a mounted DVD (docs/vm-build-checklist.md section 3.3)"
  fi
done

command -v ssh >/dev/null \
  || fail "the ssh client is missing, so neither the student nor the grader could test a key login"
command -v ssh-keygen >/dev/null \
  || fail "ssh-keygen is missing, so no keypair could be generated and grade.sh could not read one"
command -v restorecon >/dev/null \
  || fail "restorecon is missing (policycoreutils), so deploy-key-context could not be graded"
command -v getenforce >/dev/null \
  || fail "getenforce is missing (libselinux-utils), so the selinux-enforcing invariant could not be graded"

# --- preconditions the checkpoints depend on ------------------------------
# Convention for every task in this bank: verify every precondition a goal
# checkpoint or an invariant rests on, not only the ones this script needs to
# run. A precondition that only guards the script leaves the checkpoints free to
# pass or fail for reasons that have nothing to do with the student.

# The server has to be up and accepting keys, and this script must not be the
# thing that changes that. Read, never write.
sshd_active=$(systemctl is-active sshd 2>&1)
grep -qx active <<<"$sshd_active" \
  || fail "sshd is not running (is-active=$sshd_active); every checkpoint in this task is graded through it and nothing in this task is allowed to start or restart it, so this guest needs repair or a revert to the \`clean\` snapshot"

# StrictModes is the whole lesson of this task and antisolutions/01 depends on it
# being ON: with `StrictModes no` a group-writable ~deploy/.ssh authenticates
# perfectly, that fixture's login would succeed, and the fixture would report a
# mismatch instead of teaching anything. PubkeyAuthentication is what the task
# itself rests on. Both are read out of the running server's effective
# configuration.
#
# The absolute path because /usr/sbin is not on student's PATH; sudo's
# secure_path has it, but naming the binary removes the question. This is the
# only place sshd is invoked at all, and `-T` only prints the configuration - it
# does not bind a port, fork, or signal the running daemon.
if [[ -x /usr/sbin/sshd ]]; then
  sshd_eff=$(sudo timeout 20 /usr/sbin/sshd -T 2>&1)
  # Whether the two settings are IN the output, not whether the output is empty:
  # `sshd -T` prints its complaint on the same stream when it declines to run at
  # all, and reading an error message as "StrictModes is off" would abort this task
  # with a diagnosis of the wrong problem.
  sshd_said=$(grep -iE '^(pubkeyauthentication|strictmodes|passwordauthentication)[[:space:]]' <<<"$sshd_eff")
  if [[ -n $sshd_said ]]; then
    # Here-strings rather than `printf | grep -q`: `sshd -T` prints a few
    # kilobytes, and a producer killed by SIGPIPE under `set -o pipefail` reports
    # a successful search as a failed pipeline (content/lib/assert.sh's opening
    # note). A here-string has no producer to kill.
    grep -qix 'strictmodes yes' <<<"$sshd_said" \
      || fail "the running sshd has StrictModes disabled, so a key installed in a group-writable directory would be accepted; antisolutions/01 would then pass its own login and the mistake this task exists to teach would be invisible. Restore StrictModes (revert to the \`clean\` snapshot); nothing in this task is allowed to edit sshd_config"
    grep -qix 'pubkeyauthentication yes' <<<"$sshd_said" \
      || fail "the running sshd has PubkeyAuthentication disabled, so no answer to this task could work. Restore it (revert to the \`clean\` snapshot); nothing in this task is allowed to edit sshd_config"
    # The third setting is not about the student's answer at all - it is about the
    # PROMPT, which hands out deploy's password and describes an ordinary login as
    # available. With PasswordAuthentication off that sentence is false,
    # `ssh-copy-id deploy@localhost` - the by-the-book route and the one every
    # exam objective names - cannot work, and the baseline password login asserted
    # further down could not be attempted either. Better to say so here than to
    # let a student spend the time budget on a route the machine forbids.
    grep -qix 'passwordauthentication yes' <<<"$sshd_said" \
      || fail "the running sshd has PasswordAuthentication disabled, so the password this task's prompt hands the student is unusable over ssh and ssh-copy-id - the by-the-book route to this whole objective - cannot work. Restore it (revert to the \`clean\` snapshot); nothing in this task is allowed to edit sshd_config"
  else
    fail "the effective server configuration could not be read, so none of StrictModes, PubkeyAuthentication or PasswordAuthentication could be confirmed; 'sshd -T' said: $(printf '%s' "${sshd_eff:-nothing}" | tr '\n' ' ' | cut -c1-200)"
  fi
else
  fail "/usr/sbin/sshd is missing even though openssh-server is installed; this guest's ssh install is broken"
fi

# SELinux Enforcing is a documented property of this guest, an invariant this
# grader emits, and the premise of antisolutions/04 - which flips it to
# Permissive to make a mislabelled key work, and is only instructive on a guest
# where it was Enforcing to begin with.
enforce=$(getenforce 2>&1)
[[ $enforce == Enforcing ]] \
  || fail "SELinux reports '$enforce', not Enforcing; the selinux-enforcing invariant would be red for every fixture and antisolutions/04 would demonstrate nothing. docs/vm-build-checklist.md builds this guest Enforcing"

# The grader's own channel. READ ONLY - if any of this is wrong the right move is
# to stop and say so, because a script that "repairs" /home/student/.ssh is a
# script that can destroy the only way in.
[[ -d $STUDENT_SSH_DIR ]] \
  || fail "$STUDENT_SSH_DIR does not exist, so the harness could not have connected as $STUDENT_USER; this guest was not built to docs/vm-build-checklist.md"
[[ -s $STUDENT_AK ]] \
  || fail "$STUDENT_AK is missing or empty, so the key the harness authenticates with is not installed; nothing in this task may write that file, so this needs a revert to the \`clean\` snapshot"
#
# The comparison is the one grade.sh's student-channel-intact makes, not a
# stricter one: owner student, and no write bit for group or other. That is what
# sshd's StrictModes actually requires of the directory holding an
# authorized_keys file, and a guest whose ~/.ssh is 0755 is a guest the harness
# connects to perfectly well - refusing to run on it would be this script
# inventing a requirement the grader does not have.
read -r sdir_owner sdir_mode < <(stat -c '%U %a' "$STUDENT_SSH_DIR" 2>/dev/null)
[[ ${sdir_owner:-} == "$STUDENT_USER" ]] \
  || fail "$STUDENT_SSH_DIR is owned by '${sdir_owner:-nobody}', not $STUDENT_USER; sshd will refuse the key in it and the student-channel-intact invariant grades exactly that"
[[ -n ${sdir_mode:-} && $(( 8#$sdir_mode & 022 )) -eq 0 ]] \
  || fail "$STUDENT_SSH_DIR is mode ${sdir_mode:-unknown}, which is writable by group or other; sshd's StrictModes refuses an authorized_keys file in such a directory, so the harness's own access is one reboot away from ending. Nothing in this task may chmod that directory - this needs a revert to the \`clean\` snapshot"

# student must NOT already own a usable keypair, or student-keypair passes with
# no work done. Not deleted - reported. Deleting anything in /home/student/.ssh
# is the one action this task forbids itself, and a stray private key there is
# either a solved lab or a build defect, both of which want a human.
#
# The `find` below is character for character the one grade.sh's student-keypair
# runs, and that is the whole point of it: a guard narrower than the checkpoint it
# protects is not a guard. An earlier version of this line matched only `id_*`,
# which would have missed a passphrase-less private key under any other name -
# `lab_key`, `deploy`, anything - and student-keypair would then have been GREEN at
# baseline with the student having done nothing. `authorized_keys` is excluded on
# both sides for the reason grade.sh states at length: it holds the harness's own
# public key, it is not a private key, and offering it to `ssh-keygen -y` would
# only ever fail.
while read -r cand; do
  [[ -n $cand ]] || continue
  if timeout 10 ssh-keygen -y -P '' -f "$cand" &>/dev/null < /dev/null; then
    fail "$cand is already a usable passphrase-less private key, so student-keypair would pass at baseline. Nothing in this task is allowed to delete anything under $STUDENT_SSH_DIR, so this needs a revert to the \`clean\` snapshot"
  fi
done < <(find "$STUDENT_SSH_DIR" -maxdepth 1 -type f \
             ! -name '*.pub' ! -name 'authorized_keys' 2>/dev/null | sort)

# --- build the pre-task state --------------------------------------------
# The deployment account the ticket describes: a real, ordinary, unprivileged
# login with a password and nothing else. No keys, no .ssh directory - that
# absence is the task.
if ! id -u "$TARGET_USER" &>/dev/null; then
  need sudo useradd -m -s /bin/bash -c 'deployment automation account' "$TARGET_USER"
fi

# Read the home directory back out of the account database rather than trusting
# the constant: a $TARGET_HOME that is not where deploy actually lives would make
# every checkpoint in this task grade a directory sshd never opens.
got_home=$(getent passwd "$TARGET_USER" | awk -F: '{print $6}')
[[ $got_home == "$TARGET_HOME" ]] \
  || fail "$TARGET_USER's home directory is '${got_home:-none}', not $TARGET_HOME, and grade.sh grades $TARGET_AK; remove the account or revert to the \`clean\` snapshot"
got_shell=$(getent passwd "$TARGET_USER" | awk -F: '{print $7}')
case $got_shell in
  */nologin | */false | '')
    fail "$TARGET_USER's login shell is '${got_shell:-none}', so 'ssh $TARGET_USER@localhost true' could never succeed and deploy-key-login would be unsatisfiable" ;;
esac

# A password, so the by-the-book route is open to a human. chpasswd reads the
# pair from its own stdin, which is the pipe and not this script.
printf '%s:%s\n' "$TARGET_USER" "$TARGET_PW" | sudo chpasswd \
  || fail "could not set a password on $TARGET_USER"
# `usermod -U` is a no-op on an account that was never locked and is what makes a
# re-run after any fixture start from an account that can be logged into.
sudo usermod -U "$TARGET_USER" &>/dev/null

# The reset. One fixed path, created by this script and by nothing else, with no
# glob and no variable that could be empty - `rm -rf` on an unset variable is how
# a setup script eats a guest.
[[ -n $TARGET_SSH_DIR && $TARGET_SSH_DIR == /home/deploy/.ssh ]] \
  || fail "refusing to remove '$TARGET_SSH_DIR': not the path this script owns"
need sudo rm -rf "$TARGET_SSH_DIR"

# The home directory itself, at the mode RHEL's own useradd gives it
# (/etc/login.defs HOME_MODE 0700 on RHEL 9). Set explicitly so the baseline does
# not depend on that default, and because half of deploy-key-perms is a statement
# about this directory.
need sudo mkdir -p "$TARGET_HOME"
need sudo chown "$TARGET_USER:$TARGET_USER" "$TARGET_HOME"
need sudo chmod 0700 "$TARGET_HOME"

# SELinux is Enforcing. useradd labels a new home correctly on its own, so this
# guarantees what is already true - the same belt-and-braces habit files/036 and
# sys/040 use, and here it also means deploy-key-context starts from a home
# directory whose own label is right, so a red context checkpoint can only be
# about what the student created.
sudo restorecon -R "$TARGET_HOME" &>/dev/null

# Read the home directory back with grade.sh's own comparison rather than
# trusting the three `need`s above. Half of deploy-key-perms is a statement about
# this directory, and the checkpoint reads owner plus "no write bit for group or
# other" - so that is what is asserted, on the same path, with the same mask. A
# `chmod` that succeeded on a symlink, or a home that some earlier fixture left
# group-writable and this script's `mkdir -p` therefore did not recreate, would
# otherwise turn up as a red deploy-key-perms nobody could attribute.
read -r home_owner home_mode < <(sudo stat -c '%U %a' "$TARGET_HOME" 2>/dev/null)
[[ ${home_owner:-} == "$TARGET_USER" ]] \
  || fail "$TARGET_HOME is owned by '${home_owner:-nobody}', not $TARGET_USER, even after the chown above; deploy-key-perms grades exactly that and would be red at baseline for a reason no student created"
[[ -n ${home_mode:-} && $(( 8#$home_mode & 022 )) -eq 0 ]] \
  || fail "$TARGET_HOME is mode ${home_mode:-unknown}, which is writable by group or other, even after the chmod above; sshd's StrictModes would refuse a key underneath it and deploy-key-perms would be red at baseline"

# --- prove the account can actually be logged into ------------------------
# The precondition that is easiest to leave unstated and most expensive to leave
# unstated: that `deploy` is a WORKING login before the student touches anything.
#
# Every other check in this file is about files. This one is about the account,
# and without it a red deploy-key-login is ambiguous in the worst possible way -
# "the key is not installed correctly" and "this account cannot be logged into by
# any means" produce the same red line and the same `Permission denied
# (publickey)`, and a student would spend the whole time budget on the key. So the
# password login the prompt promises is exercised for real, here, once, before the
# key half of the task exists at all.
#
# Two witnesses, cheapest first.
#
#   1. The shadow entry. `passwd -S` prints the account name and then a status
#      field. On RHEL 9 that field is PS for a usable password, NP for none at all
#      and LK for locked - anything but PS and no password login is possible
#      regardless of what sshd thinks.
#
#      PS, not P. This check demanded `P` for one batch and therefore failed all
#      seven of this task's fixtures on a guest where the account was perfectly
#      healthy, which is worth recording because the wrong answer is the more
#      memorable one. There are two `passwd` implementations. shadow-utils' prints
#      P/NP/L; RHEL 9 does not ship it - /usr/bin/passwd comes from the
#      libuser-based `passwd` package (passwd-0.80-12.el9), whose
#      pwdb_display_status assigns exactly "PS", "NP" and "LK" and no bare "P" at
#      all (libuser.c:281-311). The giveaway that the original was a blend of the
#      two rather than a reading of either was that it paired shadow-utils' `P`
#      with libuser's `NP` and `LK` in the same sentence.
#
#      `P` is accepted alongside PS so this reads correctly on either
#      implementation: both spellings mean the same thing, a password that can be
#      used, which is the only property this precondition needs.
pw_status=$(sudo passwd -S "$TARGET_USER" 2>&1)
pw_field=$(awk '{ print $2 }' <<<"$pw_status")
case ${pw_field:-} in
  PS | P) ;;
  *)
    fail "'passwd -S $TARGET_USER' reports status '${pw_field:-none}' rather than PS (a usable password), so the password this task's prompt hands the student does not work and a red deploy-key-login could not be told apart from a broken account. Full output: $(printf '%s' "${pw_status:-nothing}" | tr '\n' ' ' | cut -c1-160)"
    ;;
esac

#   2. The login itself, over ssh, as the prompt describes it. A password prompt
#      is exactly what this script has no terminal for, so the client is handed an
#      askpass helper and told to use it: SSH_ASKPASS_REQUIRE=force makes ssh call
#      that program "for all passphrase input regardless of whether DISPLAY is
#      set" (ssh(1)), which is the documented way to answer a password prompt in a
#      session with no tty. Measured on RHEL 9.8 / OpenSSH 9.9p1: the helper is
#      invoked with the prompt string as its argument and the client never blocks.
#
#      NumberOfPasswordPrompts=1 bounds it to a single attempt, PubkeyAuthentication=no
#      keeps student's own key out of the answer (a key login here would prove
#      nothing about the password), and `timeout` is the same belt every other ssh
#      in this task wears. One attempt also means this cannot walk pam_faillock's
#      counter up, and a SUCCESSFUL authentication resets it.
#
#      The helper holds $TARGET_PW in cleartext for the length of one connection.
#      That is the same string the prompt prints to the student, mktemp creates the
#      file 0600, and it is removed on the next line and again by the trap - but it
#      is the reason this is a temp file and not, say, a fixed path under /tmp.
#      The helper quotes $TARGET_PW with single quotes, so a password containing
#      one would produce a helper that prints the wrong string - and the symptom
#      would be this check failing on a perfectly good account. Asserted rather
#      than assumed, because the next author to change the constant will not read
#      this far.
[[ $TARGET_PW != *"'"* ]] \
  || fail "TARGET_PW contains a single quote, which the askpass helper below cannot quote correctly; choose a password without one"
askpass=$(mktemp) \
  || fail "could not create a temporary file for the askpass helper, so the baseline password login could not be proven"
trap 'rm -f "$askpass"' EXIT
printf '#!/bin/sh\nprintf %%s %s\n' "'$TARGET_PW'" > "$askpass"
chmod 0700 "$askpass"
pw_out=$(SSH_ASKPASS="$askpass" SSH_ASKPASS_REQUIRE=force \
  timeout 25 ssh -n \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=10 \
    -o LogLevel=ERROR \
    -o PubkeyAuthentication=no \
    -o PreferredAuthentications=password \
    -o NumberOfPasswordPrompts=1 \
    "$TARGET_USER@localhost" true 2>&1 < /dev/null)
pw_rc=$?
rm -f "$askpass"
(( pw_rc == 0 )) \
  || fail "a password login as $TARGET_USER failed at baseline (ssh exited $pw_rc: $(printf '%s' "${pw_out:-no output}" | tr '\n' ' ' | cut -c1-200)). The prompt hands the student this password and the by-the-book answer (ssh-copy-id) needs it, and until it works a red deploy-key-login says nothing about the student's key. Check that $TARGET_USER is not locked, that its shell exists, that PAM is not refusing it (/var/log/secure) and that sshd still allows password authentication for it - nothing in this task may edit sshd_config, so a Match/DenyUsers rule needs a revert to the \`clean\` snapshot"

# --- verify every goal checkpoint fails, and every invariant passes -------
# One block per checkpoint, in grade.sh's order. A goal checkpoint that already
# passes here is a student-facing false pass, not a solved task.

# student-keypair: asserted above, where the finding is also the thing this
# script refuses to repair.

# deploy-authorized-key, deploy-key-perms, deploy-key-context
[[ ! -e $TARGET_SSH_DIR && ! -L $TARGET_SSH_DIR ]] \
  || fail "$TARGET_SSH_DIR still exists after the removal above, so deploy-key-perms and deploy-key-context could pass at baseline"
[[ ! -e $TARGET_AK ]] \
  || fail "$TARGET_AK still exists, so deploy-authorized-key would pass at baseline"

# deploy-key-login. The exact probe grade.sh runs, and the reason it fails
# matters as much as that it fails: "Permission denied" proves the client reached
# sshd and was turned away for want of a key, which is what makes this a baseline
# for a key-authentication task. "Connection refused" would fail the same
# checkpoint for a reason no student could fix.
probe_out=$(probe_login)
probe_rc=$?
if (( probe_rc == 0 )); then
  fail "'ssh $TARGET_USER@localhost true' already succeeds without a key installed, so deploy-key-login would pass at baseline; this guest has an authorized key for $TARGET_USER somewhere sshd reads (an AuthorizedKeysFile outside \$HOME, for instance) and this task cannot be graded on it"
fi
if ! grep -qF 'Permission denied' <<<"$probe_out"; then
  fail "the baseline login probe failed with something other than a rejected key, so deploy-key-login would be red for reasons the student cannot fix. ssh exited $probe_rc and said: $(printf '%s' "${probe_out:-no output}" | tr '\n' ' ' | cut -c1-200). Check that sshd is listening on 127.0.0.1:22 (ss -tlnp) and that 'localhost' resolves in /etc/hosts. A 'Connection reset by peer' or 'kex_exchange_identification' here is a third thing and not a broken guest: OpenSSH 9.8 and later refuse further connections from a source address that has just accumulated failed authentications (PerSourcePenalties, on by default), so a run started seconds after an earlier failed login probe can be turned away before authentication - wait half a minute and run this again, or revert to the \`clean\` snapshot, which clears the penalty with the reboot"
fi

# deploy-no-private-key is an invariant, and at baseline it holds because
# $TARGET_SSH_DIR does not exist - which is the honest reading of "deploy holds no
# private key", not a vacuous pass papering over an unreadable directory. The
# assertion above that the directory is absent is the same fact.

# selinux-enforcing, sshd-key-auth-intact, student-channel-intact: all three
# asserted in the precondition block above, with the same comparisons grade.sh
# makes, so a failure afterwards can only mean a fixture or the student broke
# them.

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
