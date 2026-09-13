#!/usr/bin/env bash
# Prepare the system for tools/047-archive-and-transfer.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell.
#
# ---------------------------------------------------------------------------
# THE SAFETY RULE, stated where it can be audited. The harness grades this guest
# over ssh as `student`, using the key in /home/student/.ssh/authorized_keys. If
# that stops working there is no verdict to collect - not a failing checkpoint, an
# unusable task. So, observed here and in every fixture of this task:
#
#   - NOTHING writes to, chmods, chowns, moves or deletes /home/student/.ssh or
#     anything inside it. This script only READS student's SSH directory, and when
#     it finds it wrong it says so and stops rather than "fixing" it. The keypair
#     this task needs is created OUTSIDE that directory, at /home/student/backup-key,
#     for exactly this reason.
#   - NOTHING edits /etc/ssh/sshd_config or /etc/ssh/sshd_config.d/*, and nothing
#     restarts, reloads or stops sshd. `sshd -T` below only prints the effective
#     configuration.
#   - NOTHING touches firewalld or the NIC. Every connection in this task is to
#     `localhost` and never leaves the machine.
#   - Every ssh, scp and sftp invocation in this task carries
#     `-o UserKnownHostsFile=/dev/null`. That is not host-key hygiene: without it
#     the first connection writes /home/student/.ssh/known_hosts, and "nothing
#     writes inside /home/student/.ssh" would already be false in this file.
#   - Nothing here powers the guest off, halts it, or isolates a target.
# ---------------------------------------------------------------------------
#
# WHY setup.sh INSTALLS THE KEY INSTEAD OF MAKING THE STUDENT DO IT.
#
# The transfer half of this task needs a non-interactive login to backupop. There
# were three ways to get one and only one of them is right here.
#
#   Make the student set up key authentication. That is net/046-key-based-ssh-login,
#   in full, and this task would then be graded partly on 046's lesson and would
#   fail for 046's reasons. Rejected.
#   Give backupop a password. scp, sftp and rsync all then need a way to type it
#   with no terminal, which on RHEL 9 means an SSH_ASKPASS helper holding a
#   cleartext password (046's setup does exactly that, once, to prove a
#   precondition) - machinery that teaches nothing about archives. Rejected.
#   Install a key for the student, and say so in the prompt. Chosen: the objective
#   being graded is `tools.ssh.transfer`, so the transfer is what should be the
#   student's work, and key setup is a prerequisite this task is entitled to
#   assume.
#
# The key CANNOT live in /home/student/.ssh - see the safety rule - so it is
# created at /home/student/backup-key and the prompt names it. That has a second
# and better effect: `ssh` offers only its default identity filenames, so the
# student has to name the key (`-i`, or an IdentityFile line in their own
# ~/.ssh/config, which is theirs to write and not this script's). Being made to
# notice that is squarely inside `tools.ssh.client`.
#
# IDEMPOTENT where that is cheap, and it is cheap almost everywhere here: the
# student's side of the answer is two paths under /home/backupop, both removed and
# rebuilt below, and /srv/reports is rebuilt from scratch. The one thing it will
# not do is delete anything under /home/student/.ssh; that case fails loudly and
# names the snapshot revert instead. The harness reverts the `clean` snapshot
# between fixtures anyway, so this must fail loudly rather than half-apply - which
# is what every `need` and every `fail` below is for.
#
# `set -uo pipefail` without -e, following net/046 and sys/040: this file is full
# of probes that are meant to be asked rather than to abort. The commands that MUST
# work go through `need`, because a silent failure here stages the wrong machine
# and every checkpoint result afterwards is a lie.
set -uo pipefail

fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }
need() { "$@" || fail "FAILED: $*"; }

# --- constants, spelled identically in grade.sh ----------------------------
# If these two files ever disagree the task becomes unsatisfiable for every
# answer, so they are grouped, named the same, and worth diffing when something
# looks impossible.
BACKUP_USER=backupop
BACKUP_HOME=/home/backupop
ARCHIVE=/home/backupop/reports.tar.gz
UNPACKED=/home/backupop/reports

SRC_TREE=/srv/reports

STUDENT_USER=student
STUDENT_SSH_DIR=/home/student/.ssh
STUDENT_AK=/home/student/.ssh/authorized_keys
KEY=/home/student/backup-key
KEY_PUB=/home/student/backup-key.pub

# The marker grade.sh reads to bound its journal search. Root-owned and
# world-readable: the grader must be able to read it, and nothing but this script
# should write it.
MARK=/var/lib/rhcsa-047-baseline-epoch

# The four files the archive must contain, as paths relative to the tree root, and
# the attributes grade.sh compares against. LITERALS, in both files, and that is
# the point of them: a grader that compared the unpacked copy against the LIVE
# source would accept an answer that "fixed" a bad extraction by chmod-ing
# /srv/reports to match it. Comparing both sides against the same constants is what
# makes source-tree-intact a real invariant rather than a tautology.
#
# The two modes are chosen from measurements on this exact tar, not from habit:
#
#   ledger.csv 0660 - the classic loss. `tar -xzf` without -p applies the process
#     umask to every extracted file, and an ssh session on RHEL 9 has umask 022
#     (/etc/login.defs sets UMASK 022; /etc/pam.d/postlogin runs
#     `session optional pam_umask.so silent`; the shipped /etc/profile has no umask
#     block at all and /etc/bashrc only sets 022 when the inherited value is 0). So
#     0660 arrives as 0640. Measured on tar-1.34-11.el9.
#   rotate-reports.sh 2750 - the umask-INDEPENDENT loss, and the reason this task
#     does not rest on the file above alone. Measured on tar-1.34-11.el9 with umask
#     000, 002 and 022 in turn: without -p, an unprivileged extraction drops the
#     setgid and setuid bits every time, so 2750 arrives as 0750 whatever the umask
#     is. With -p it arrives as 2750, because the extracting user owns the file and
#     is in its group. A guest with a different default umask therefore cannot make
#     antisolutions/01 pass by accident.
LEDGER_REL=ledger.csv
LEDGER_MODE=660
LEDGER_MTIME=1739006100          # 2025-02-08 09:15:00 UTC
README_REL=README.txt
README_MODE=644
README_MTIME=1744976550          # 2025-04-18 11:42:30 UTC
SCRIPT_REL=rotate-reports.sh
SCRIPT_MODE=2750
SCRIPT_MTIME=1750996800          # 2025-06-27 04:00:00 UTC
LOG_A_REL=daily/2026-08-31.log
LOG_B_REL=daily/2026-09-01.log
DAILY_REL=daily
DAILY_MODE=750
TREE_MODE=755
# Content the grader reads back, so "the files exist" cannot be satisfied by four
# empty files created with touch.
README_MARK='rhcsa-047 reporting tree'

# --- the ssh client options every connection in this task uses -------------
#   -n and `< /dev/null`: this script arrives on ssh's stdin, and a client that
#     inherited it would eat the rest of the file. Both belts are worn on purpose -
#     -n is the client's own flag, the redirect covers the wrapper.
#   BatchMode=yes: no prompts, ever. Without it a rejected key asks for backupop's
#     password and the probe hangs until the harness kills it.
#   PreferredAuthentications=publickey, NumberOfPasswordPrompts=0: this measures
#     key authentication and nothing else. backupop has no password to offer.
#   UserKnownHostsFile=/dev/null: see the safety rule above.
#   ConnectTimeout, and a `timeout` wrapper on every call: a setup script that
#     hangs is worse than one that fails.
SSH_OPTS=(-n
  -i "$KEY"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=10
  -o PreferredAuthentications=publickey
  -o NumberOfPasswordPrompts=0
  -o LogLevel=ERROR)

# --- packages and tools ---------------------------------------------------
# docs/vm-build-checklist.md:71 asks for a Server install, so all of these are
# present already and this loop is insurance rather than a fix - but a missing
# package would fail every checkpoint in this task and point the blame at the
# student instead of at the image. `< /dev/null` because dnf reads stdin and this
# script's stdin is the rest of the script (sys/040's setup documents the same
# trap). The guest has no internet; the repo is the DVD.
#
# bzip2 is in the list even though the prompt requires gzip: the objective names
# both, antisolutions/02 is a candidate who reached for the wrong one, and a
# fixture that cannot run is not a fixture.
for pkg in tar gzip bzip2 openssh openssh-clients openssh-server; do
  if ! rpm -q "$pkg" &>/dev/null; then
    sudo dnf -y install "$pkg" &>/dev/null < /dev/null
    rpm -q "$pkg" &>/dev/null \
      || fail "$pkg is not installed and 'dnf -y install $pkg' did not fix that; check that /etc/yum.repos.d/rhcsa-dvd.repo points at a mounted DVD (docs/vm-build-checklist.md section 3.3)"
  fi
done

# `file` is optional on purpose: grade.sh decides the archive's format from its
# magic bytes and from gzip's own verdict, and uses `file` only to make the failure
# message readable. So this is attempted and not asserted - a missing `file` must
# not cost a student the task.
if ! rpm -q file &>/dev/null; then
  sudo dnf -y install file &>/dev/null < /dev/null
fi

for tool in tar gzip ssh scp sftp ssh-keygen stat od find awk journalctl; do
  command -v "$tool" >/dev/null \
    || fail "$tool is missing, and grade.sh measures this task with it; check the guest's package set (docs/vm-build-checklist.md section 3.3)"
done
command -v bzip2 >/dev/null \
  || fail "bzip2 is missing even though the package is installed; antisolutions/02 could not run and the wrong-compression case would go untested"

# --- preconditions the checkpoints depend on ------------------------------
# Convention for every task in this bank: verify every precondition a goal
# checkpoint or an invariant rests on, not only the ones this script needs to run.
# A precondition that only guards the script leaves the checkpoints free to pass or
# fail for reasons that have nothing to do with the student.

sshd_active=$(systemctl is-active sshd 2>&1)
grep -qx active <<<"$sshd_active" \
  || fail "sshd is not running (is-active=$sshd_active); the transfer half of this task is graded through it and nothing in this task is allowed to start or restart it, so this guest needs repair or a revert to the \`clean\` snapshot"

# PubkeyAuthentication is what the installed key rests on. Read out of the running
# server's effective configuration, never written. The absolute path because
# /usr/sbin is not on student's PATH, and `-T` only prints the configuration - it
# does not bind a port, fork, or signal the running daemon.
if [[ -x /usr/sbin/sshd ]]; then
  sshd_eff=$(sudo timeout 20 /usr/sbin/sshd -T 2>&1)
  # Whether the setting is IN the output, not whether the output is empty:
  # `sshd -T` prints its complaint on the same stream when it declines to run at
  # all, and reading an error message as "PubkeyAuthentication is off" would abort
  # this task with a diagnosis of the wrong problem. Here-string, not a pipe: a
  # producer killed by SIGPIPE under pipefail reports a successful search as a
  # failed pipeline (content/lib/assert.sh's opening note).
  sshd_said=$(grep -iE '^pubkeyauthentication[[:space:]]' <<<"$sshd_eff")
  if [[ -n $sshd_said ]]; then
    grep -qix 'pubkeyauthentication yes' <<<"$sshd_said" \
      || fail "the running sshd has PubkeyAuthentication disabled, so the key this script installs for $BACKUP_USER could never be used and no answer to this task could work. Restore it (revert to the \`clean\` snapshot); nothing in this task is allowed to edit sshd_config"
  else
    fail "the effective server configuration could not be read, so PubkeyAuthentication could not be confirmed; 'sshd -T' said: $(printf '%s' "${sshd_eff:-nothing}" | tr '\n' ' ' | cut -c1-200)"
  fi
else
  fail "/usr/sbin/sshd is missing even though openssh-server is installed; this guest's ssh install is broken"
fi

# The grader's own channel. READ ONLY - if any of this is wrong the right move is
# to stop and say so, because a script that "repairs" /home/student/.ssh is a
# script that can destroy the only way in. The comparison is the one
# student-channel-intact makes, not a stricter one.
[[ -d $STUDENT_SSH_DIR ]] \
  || fail "$STUDENT_SSH_DIR does not exist, so the harness could not have connected as $STUDENT_USER; this guest was not built to docs/vm-build-checklist.md"
[[ -s $STUDENT_AK ]] \
  || fail "$STUDENT_AK is missing or empty, so the key the harness authenticates with is not installed; nothing in this task may write that file, so this needs a revert to the \`clean\` snapshot"
read -r sdir_owner sdir_mode < <(stat -c '%U %a' "$STUDENT_SSH_DIR" 2>/dev/null)
[[ ${sdir_owner:-} == "$STUDENT_USER" ]] \
  || fail "$STUDENT_SSH_DIR is owned by '${sdir_owner:-nobody}', not $STUDENT_USER; sshd will refuse the key in it and student-channel-intact grades exactly that"
[[ -n ${sdir_mode:-} && $(( 8#$sdir_mode & 022 )) -eq 0 ]] \
  || fail "$STUDENT_SSH_DIR is mode ${sdir_mode:-unknown}, which is writable by group or other; sshd's StrictModes refuses an authorized_keys file in such a directory, so the harness's own access is one reboot away from ending. Nothing in this task may chmod that directory - this needs a revert to the \`clean\` snapshot"

# --- the backup operator account -----------------------------------------
# An ordinary unprivileged login with a real shell, a 0700 home, and NO password:
# key authentication is the only way in, which is what the prompt describes and
# what every fixture uses. `useradd -m` gives the home 0700 on RHEL 9 anyway
# (/etc/login.defs HOME_MODE 0700, read out of shadow-utils' own shipped file), and
# it is set explicitly below so the baseline does not depend on that default.
if ! id -u "$BACKUP_USER" &>/dev/null; then
  need sudo useradd -m -s /bin/bash -c 'backup operator' "$BACKUP_USER"
fi

# Read the home directory back out of the account database rather than trusting the
# constant: a $BACKUP_HOME that is not where backupop actually lives would make
# every checkpoint in this task grade a directory the student never writes to.
got_home=$(getent passwd "$BACKUP_USER" | awk -F: '{print $6}')
[[ $got_home == "$BACKUP_HOME" ]] \
  || fail "$BACKUP_USER's home directory is '${got_home:-none}', not $BACKUP_HOME, and grade.sh grades $ARCHIVE and $UNPACKED; remove the account or revert to the \`clean\` snapshot"
got_shell=$(getent passwd "$BACKUP_USER" | awk -F: '{print $7}')
case $got_shell in
  */nologin | */false | '')
    fail "$BACKUP_USER's login shell is '${got_shell:-none}', so 'ssh $BACKUP_USER@localhost' could never run a command and the whole task would be unsatisfiable" ;;
esac

need sudo mkdir -p "$BACKUP_HOME"
need sudo chown "$BACKUP_USER:$BACKUP_USER" "$BACKUP_HOME"
need sudo chmod 0700 "$BACKUP_HOME"

# --- the reset ------------------------------------------------------------
# Fixed paths, created by this script and by nothing else, with no glob and no
# variable that could be empty - `rm -rf` on an unset variable is how a setup
# script eats a guest. Each path is re-compared against its literal immediately
# before the removal, which is the only guard that survives an editing accident
# further up this file.
[[ -n $UNPACKED && $UNPACKED == /home/backupop/reports ]] \
  || fail "refusing to remove '$UNPACKED': not the path this script owns"
need sudo rm -rf "$UNPACKED"
[[ -n $ARCHIVE && $ARCHIVE == /home/backupop/reports.tar.gz ]] \
  || fail "refusing to remove '$ARCHIVE': not the path this script owns"
need sudo rm -f "$ARCHIVE"
# Anything else a previous fixture may have dropped in backupop's home. Named
# individually rather than globbed, for the reason above.
sudo rm -f "$BACKUP_HOME/reports.tar.bz2" "$BACKUP_HOME/reports.tar" &>/dev/null

# --- the source tree ------------------------------------------------------
# Rebuilt from scratch every run, so the modes and mtimes below are facts about
# this fixture and not about whatever the last one left behind.
[[ -n $SRC_TREE && $SRC_TREE == /srv/reports ]] \
  || fail "refusing to remove '$SRC_TREE': not the path this script owns"
need sudo rm -rf "$SRC_TREE"
need sudo mkdir -p "$SRC_TREE/$DAILY_REL"

# Written through `tee` under sudo rather than with a redirect: the redirection
# would be performed by student's shell, which cannot create a file in /srv.
printf '%s\n%s\n' "$README_MARK" 'Nightly report exports. Handed to the backup operator daily.' \
  | sudo tee "$SRC_TREE/$README_REL" >/dev/null \
  || fail "could not write $SRC_TREE/$README_REL"
printf 'date,region,total\n2026-08-31,north,4192\n2026-09-01,north,4310\n' \
  | sudo tee "$SRC_TREE/$LEDGER_REL" >/dev/null \
  || fail "could not write $SRC_TREE/$LEDGER_REL"
printf '#!/usr/bin/env bash\n# Rotates yesterday'\''s exports. Runs as the reporting group.\nexit 0\n' \
  | sudo tee "$SRC_TREE/$SCRIPT_REL" >/dev/null \
  || fail "could not write $SRC_TREE/$SCRIPT_REL"
printf '2026-08-31 export complete\n' | sudo tee "$SRC_TREE/$LOG_A_REL" >/dev/null \
  || fail "could not write $SRC_TREE/$LOG_A_REL"
printf '2026-09-01 export complete\n' | sudo tee "$SRC_TREE/$LOG_B_REL" >/dev/null \
  || fail "could not write $SRC_TREE/$LOG_B_REL"

# Owned by student, and that is a design decision rather than convenience: it makes
# the whole task doable without sudo, which is how the objective is actually
# examined. It also keeps `sudo tar` out of the happy path - an archive created
# under sudo lands owned by root and the student then cannot read it to send it,
# which is a failure mode with no lesson in it.
need sudo chown -R "$STUDENT_USER:$STUDENT_USER" "$SRC_TREE"

need sudo chmod "$TREE_MODE" "$SRC_TREE"
need sudo chmod "$DAILY_MODE" "$SRC_TREE/$DAILY_REL"
need sudo chmod "$README_MODE" "$SRC_TREE/$README_REL"
need sudo chmod "$LEDGER_MODE" "$SRC_TREE/$LEDGER_REL"
need sudo chmod "$SCRIPT_MODE" "$SRC_TREE/$SCRIPT_REL"
need sudo chmod 644 "$SRC_TREE/$LOG_A_REL"
need sudo chmod 644 "$SRC_TREE/$LOG_B_REL"

# `touch -d @SECONDS` sets the mtime from a UNIX epoch, which is what makes these
# constants timezone-independent: a wall-clock string would be interpreted in the
# guest's local zone and the grader compares `stat -c %Y`. Measured on RHEL 9's
# coreutils 8.32: `touch -d '@1737000000'` yields %Y 1737000000 exactly, with a zero
# nanosecond field - so there is no sub-second component for any archive format to
# round away.
need sudo touch -d "@$README_MTIME" "$SRC_TREE/$README_REL"
need sudo touch -d "@$LEDGER_MTIME" "$SRC_TREE/$LEDGER_REL"
need sudo touch -d "@$SCRIPT_MTIME" "$SRC_TREE/$SCRIPT_REL"

# SELinux is Enforcing on this guest. /srv is not a home directory and nothing in
# this task asks sshd to read the tree, so no label here can deny anything - but
# relabelling a freshly created tree costs nothing and keeps `ls -Z` from
# distracting a student who looks.
sudo restorecon -R "$SRC_TREE" &>/dev/null

# Read the tree back with grade.sh's own comparisons rather than trusting the
# chmods above. A chmod that succeeded on the wrong path, or a setgid bit some
# filesystem option refused, would otherwise turn up as a red
# unpacked-mode-preserved that no student created.
read -r m_ledger < <(stat -c '%a' "$SRC_TREE/$LEDGER_REL" 2>/dev/null)
[[ ${m_ledger:-} == "$LEDGER_MODE" ]] \
  || fail "$SRC_TREE/$LEDGER_REL is mode ${m_ledger:-unreadable}, not $LEDGER_MODE, even after the chmod above; unpacked-mode-preserved compares the student's copy against $LEDGER_MODE and would be unsatisfiable"
read -r m_script < <(stat -c '%a' "$SRC_TREE/$SCRIPT_REL" 2>/dev/null)
[[ ${m_script:-} == "$SCRIPT_MODE" ]] \
  || fail "$SRC_TREE/$SCRIPT_REL is mode ${m_script:-unreadable}, not $SCRIPT_MODE, even after the chmod above; the setgid bit is the umask-independent half of unpacked-mode-preserved and without it antisolutions/01 could pass on a guest with an unusual umask"
read -r m_readme < <(stat -c '%a' "$SRC_TREE/$README_REL" 2>/dev/null)
[[ ${m_readme:-} == "$README_MODE" ]] \
  || fail "$SRC_TREE/$README_REL is mode ${m_readme:-unreadable}, not $README_MODE; that file is what stops a blanket 'chmod -R 660' from satisfying unpacked-mode-preserved"
read -r t_ledger < <(stat -c '%Y' "$SRC_TREE/$LEDGER_REL" 2>/dev/null)
[[ ${t_ledger:-} == "$LEDGER_MTIME" ]] \
  || fail "$SRC_TREE/$LEDGER_REL has mtime ${t_ledger:-unreadable}, not $LEDGER_MTIME, even after the touch above; unpacked-mtime-preserved compares against that constant"
read -r t_readme < <(stat -c '%Y' "$SRC_TREE/$README_REL" 2>/dev/null)
[[ ${t_readme:-} == "$README_MTIME" ]] \
  || fail "$SRC_TREE/$README_REL has mtime ${t_readme:-unreadable}, not $README_MTIME, even after the touch above"

# And prove student can actually archive it without sudo, which is the first thing
# every answer does. `-f /dev/null` writes the archive nowhere: this reads every
# file in the tree and throws the bytes away, so a permission problem anywhere
# under /srv/reports surfaces here rather than as a mysteriously empty archive.
timeout 60 tar -czf /dev/null -C /srv reports < /dev/null \
  || fail "student cannot read all of $SRC_TREE (a 'tar -czf /dev/null -C /srv reports' failed), so no answer to this task could create the archive; check the ownership and modes of $SRC_TREE and every path above it"

# --- the key that authenticates student to backupop ----------------------
# Generated as student (no sudo) so the private key belongs to student and is
# readable by student. Created OUTSIDE /home/student/.ssh - see the safety rule at
# the top of this file - and reused if it is already there and usable, so a
# re-run by hand does not invalidate a key already installed for backupop.
#
# The path is asserted not to be a symlink first: `ssh-keygen -f` follows one, and
# a link pointing into /home/student/.ssh would make this script write there
# through the back door.
[[ ! -L $KEY && ! -L $KEY_PUB ]] \
  || fail "$KEY or $KEY_PUB is a symbolic link; ssh-keygen would follow it and this task is not permitted to write wherever it points"

key_ok=no
if [[ -f $KEY && -f $KEY_PUB ]]; then
  # `-P ''` is what makes this safe to ask: on an encrypted key `ssh-keygen -y`
  # PROMPTS for the passphrase, and a script with no terminal would hang. With an
  # empty passphrase supplied it fails immediately instead.
  timeout 10 ssh-keygen -y -P '' -f "$KEY" &>/dev/null < /dev/null && key_ok=yes
fi
if [[ $key_ok == no ]]; then
  rm -f "$KEY" "$KEY_PUB"
  # `< /dev/null` because this script arrives on ssh's stdin: if ssh-keygen found a
  # file already at that name it would ask whether to overwrite and would read the
  # answer out of the rest of this file.
  need timeout 30 ssh-keygen -q -t ed25519 -N '' -C 'student to backupop (rhcsa-047)' -f "$KEY" < /dev/null
fi
[[ -f $KEY && -f $KEY_PUB ]] \
  || fail "ssh-keygen did not produce both $KEY and $KEY_PUB"
# The ssh CLIENT refuses a private key any other user can read or write - it prints
# UNPROTECTED PRIVATE KEY FILE and offers nothing, and the server's answer is then
# the same Permission denied as if no key existed. 0600 is not decoration.
need chmod 0600 "$KEY"
need chmod 0644 "$KEY_PUB"
read -r k_owner k_mode < <(stat -c '%U %a' "$KEY" 2>/dev/null)
[[ ${k_owner:-} == "$STUDENT_USER" && ${k_mode:-} == 600 ]] \
  || fail "$KEY is ${k_owner:-nobody}:${k_mode:-unknown}, not $STUDENT_USER:600; the ssh client will not use a key like that and every fixture in this task would fail to connect"

# Install the PUBLIC half for backupop. `install -d` / `install -m` rather than
# mkdir plus chown plus chmod because each is one command that cannot be half-done,
# and because a directory created fresh in place gets the SELinux label the policy
# has a named rule for (`.ssh` under a home directory is ssh_home_t); a file carried
# in from elsewhere keeps whatever label it had, and sshd is not permitted to read
# that. The login probe below is what proves the label came out right.
[[ $BACKUP_HOME == /home/backupop ]] \
  || fail "refusing to remove '$BACKUP_HOME/.ssh': not the path this script owns"
need sudo rm -rf "$BACKUP_HOME/.ssh"
need sudo install -d -m 0700 -o "$BACKUP_USER" -g "$BACKUP_USER" "$BACKUP_HOME/.ssh"
need sudo install -m 0600 -o "$BACKUP_USER" -g "$BACKUP_USER" "$KEY_PUB" "$BACKUP_HOME/.ssh/authorized_keys"
sudo restorecon -R "$BACKUP_HOME/.ssh" &>/dev/null

# --- prove the login this task assumes actually works --------------------
# The precondition that is easiest to leave unstated and most expensive to leave
# unstated. Every goal checkpoint here depends on the student being able to reach
# backupop, and if that is broken then eight red lines say nothing about the
# student's answer. So it is exercised for real, here, before the task exists.
#
# The probe writes a file into backupop's home and removes it again, because
# "can log in" and "can create the archive where the prompt says to" are two
# claims and the second is the one every answer needs.
login_probe() {
  timeout 30 ssh "${SSH_OPTS[@]}" "$BACKUP_USER@localhost" \
    'set -e; : > "$HOME/.rhcsa-047-probe"; rm -f "$HOME/.rhcsa-047-probe"; printf "ok\n"' \
    2>&1 < /dev/null
}
probe_t0=$(date +%s)
probe_out=$(login_probe)
probe_rc=$?
# Retried once when the first attempt never reached authentication, and that retry
# is a measured property of this server rather than defensive padding. OpenSSH 9.8
# introduced PerSourcePenalties, on by default in RHEL 9's build, which makes sshd
# REFUSE NEW CONNECTIONS from a source address that has recently accumulated failed
# authentications. The symptom is `kex_exchange_identification: read: Connection
# reset by peer` and a wait of roughly 20 seconds, which is neither "the key is
# wrong" nor "the guest is broken". A `Permission denied` is a real answer about the
# key and is never retried. Worst case 30 + 22 + 30 seconds, inside the 120 the
# transport allows one exec.
if (( probe_rc != 0 )) && ! grep -qF 'Permission denied' <<<"$probe_out"; then
  sleep 22
  probe_out=$(login_probe)
  probe_rc=$?
fi
(( probe_rc == 0 )) \
  || fail "student cannot log in to $BACKUP_USER@localhost with the key this script just installed (ssh exited $probe_rc: $(printf '%s' "${probe_out:-no output}" | tr '\n' ' ' | cut -c1-200)). Every checkpoint in this task depends on that login, so it is a broken fixture and not a student mistake. Look at: 'sudo ls -lZ $BACKUP_HOME $BACKUP_HOME/.ssh' for modes, owners and SELinux contexts; 'sudo journalctl -u sshd -n 30' for sshd's own account of the refusal; and 'ss -tlnp' plus /etc/hosts for whether localhost:22 answers at all. A 'Connection reset by peer' twice in a row is a third thing and not a broken guest: sshd's PerSourcePenalties refuses a source address that has accumulated failed logins, so waiting half a minute or reverting to the \`clean\` snapshot clears it"
grep -qF 'ok' <<<"$probe_out" \
  || fail "the login to $BACKUP_USER@localhost succeeded but the probe could not create a file in $BACKUP_HOME (it said: $(printf '%s' "${probe_out:-no output}" | tr '\n' ' ' | cut -c1-200)). The prompt requires the archive to land there, so no answer could satisfy it; check that $BACKUP_HOME is owned by $BACKUP_USER and writable by it"

# --- prove the instrument transfer-over-ssh is measured with -------------
# grade.sh answers "was this transferred over ssh" by asking the journal whether
# sshd accepted an authentication for backupop. That is evidence rather than proof -
# a candidate who logs in and then copies the file into place under sudo would
# satisfy it - but it is the only observable that distinguishes a transfer from a
# local copy at all, and it is exactly the distinction the objective is about.
#
# The message format is not a guess. Read out of the shipped
# openssh-server 9.9p1-9.el9_8 binary /usr/libexec/openssh/sshd-session, whose
# authentication log format string is
# `%s %s%s%s for %s%.100s from %.200s port %d ssh2%s%s` - the leading %s being
# Accepted / Failed / Postponed / Partial. And the identifier is not a guess either:
# measured on this build, per-session messages arrive with
# SYSLOG_IDENTIFIER=sshd-session and _SYSTEMD_UNIT=sshd.service, while the
# listener's own messages use `sshd`. Both identifiers are asked for, so this works
# whether the guest runs sshd.service or the socket-activated sshd@.service.
#
# awk, not `grep -q`: awk reads to EOF, so there is no producer for SIGPIPE to kill
# under pipefail (content/lib/assert.sh's opening note).
journal_accepts_since() {
  timeout 25 sudo journalctl -t sshd -t sshd-session --since "@$1" --no-pager -o cat 2>/dev/null \
    | awk -v u="$BACKUP_USER" '$0 ~ /Accepted/ && $0 ~ (" for " u " from ") { n++ } END { print n + 0 }'
}
seen=$(journal_accepts_since "$probe_t0")
[[ ${seen:-0} =~ ^[0-9]+$ ]] && (( seen > 0 )) \
  || fail "the login above succeeded, but no 'Accepted ... for $BACKUP_USER from ...' line for it could be found in the journal since @$probe_t0 (found: ${seen:-nothing}). transfer-over-ssh is answered from exactly that search, so it would be red for every answer on this guest. Check that journald is running and that 'sudo journalctl -t sshd-session -n 20' shows anything at all; a guest whose sshd logs somewhere journald cannot see cannot grade this task"

# The baseline marker. Written AFTER the probe and after a wait, because
# `--since @N` is inclusive of second N: with the marker set to the same second the
# probe logged in, grade.sh would count this script's own login and
# transfer-over-ssh would be green before the student did anything. The sleep is the
# whole reason this is not one line.
sleep 2
mark_epoch=$(date +%s)
[[ $mark_epoch =~ ^[0-9]+$ ]] || fail "could not read the current time as a UNIX epoch"
printf '%s\n' "$mark_epoch" | sudo tee "$MARK" >/dev/null \
  || fail "could not write the baseline marker $MARK, which grade.sh needs in order to bound its journal search"
need sudo chmod 0644 "$MARK"

# --- verify every goal checkpoint fails, and every invariant passes -------
# One block per checkpoint, in grade.sh's order. A goal checkpoint that already
# passes here is a student-facing false pass, not a solved task.

# archive-present, archive-is-gzip, archive-holds-tree
sudo test ! -e "$ARCHIVE" \
  || fail "$ARCHIVE still exists after the removal above, so archive-present, archive-is-gzip and archive-holds-tree could pass at baseline"

# unpacked-tree-present, unpacked-mode-preserved, unpacked-mtime-preserved,
# unpacked-owned-by-backupop
sudo test ! -e "$UNPACKED" \
  || fail "$UNPACKED still exists after the removal above, so the four unpacked-* checkpoints could pass at baseline"

# transfer-over-ssh. The same search grade.sh runs, against the same marker.
seen_after=$(journal_accepts_since "$mark_epoch")
[[ ${seen_after:-x} == 0 ]] \
  || fail "the journal already shows ${seen_after:-an unreadable number of} accepted logins for $BACKUP_USER since the baseline marker @$mark_epoch, so transfer-over-ssh would pass before the student did anything. Something is logging in as $BACKUP_USER on its own, or the clock moved backwards; a revert to the \`clean\` snapshot is the fix"

# source-tree-intact and student-channel-intact are invariants: both were asserted
# above with the same comparisons grade.sh makes, so a failure afterwards can only
# mean a fixture or the student broke them.

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
