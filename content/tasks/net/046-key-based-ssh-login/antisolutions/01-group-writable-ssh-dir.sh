#!/usr/bin/env bash
# The near-miss this whole task is built around: everything is in the right place,
# the right key is in the right file, and the login is refused.
#
# The reasoning that gets a candidate here is sound engineering everywhere else.
# "deploy's key list will be maintained by the ops team, so let the group write to
# it" is how a shared configuration directory is normally set up, and on any other
# file on the system it would be right. sshd is the exception: with StrictModes on -
# which is the default and which nobody should be turning off - it walks
# authorized_keys and every directory above it, and if a user other than the owner
# could replace any of them it ignores the key entirely. Silently. The client is
# told "Permission denied (publickey)", the same three words it prints when no key
# was installed at all.
#
# So this fixture is a machine where `sudo ls -l` shows a perfectly plausible
# answer, `sudo cat` shows the right key, and nothing works. The only witness is
# /var/log/secure, where sshd says "bad ownership or modes for directory
# /home/deploy/.ssh".
#
#   deploy-key-perms is wrong from the moment this runs and stays wrong: no phase.
#   deploy-key-login likewise - a mode is not something a reboot repairs.
#   Everything else is correct here on purpose, which is what makes the two red
#   lines readable as one mistake instead of a mess.
# expect-fail: deploy-key-perms, deploy-key-login
#
# Two neighbours of this fixture were considered and deliberately NOT written, and
# the reasons belong next to the mistake they are about:
#
#   `StrictModes no`. It is the most instructive wrong answer in this subject - it
#   makes this exact fixture work - and writing it would mean editing
#   /etc/ssh/sshd_config and restarting sshd inside a fixture, on the guest the
#   harness is grading through, over the connection that carries the verdict. A
#   typo in that edit is not a red checkpoint; it is a machine nobody can reach
#   again. The setting is graded instead, by sshd-key-auth-intact, which costs
#   nothing and is never worth a demonstration.
#
#   "student breaks their own key". Tempting, because a candidate who runs
#   `chmod -R 777 ~` or `chown -R` over their own home is a real and common
#   accident, and it is exactly what StrictModes punishes. It is also the one
#   accident that would take out /home/student/.ssh/authorized_keys - the harness's
#   own way in - so the result would not be a failing checkpoint but a guest that
#   answers nothing at all, in a run where "correctly broken" and "unreachable"
#   cannot be told apart. Not written.
set -euo pipefail

# The correct half, done properly, so the failure is unambiguously about the mode.
ssh-keygen -t ed25519 -N '' -C 'student@lab deploy automation' -f "$HOME/.ssh/id_ed25519" < /dev/null
sudo install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
sudo install -m 0600 -o deploy -g deploy "$HOME/.ssh/id_ed25519.pub" /home/deploy/.ssh/authorized_keys
sudo restorecon -R /home/deploy/.ssh

# And the one decision that ruins it. Group write on the directory, group write on
# the file, "so the team can add their own keys later".
sudo chmod 0770 /home/deploy/.ssh
sudo chmod 0660 /home/deploy/.ssh/authorized_keys

# Everything a candidate would look at, and all of it looks fine.
sudo ls -lZ /home/deploy /home/deploy/.ssh

# The login, which fails. `|| true` because this fixture is expected to leave a
# machine where it fails, and the mismatch is the grader's to report, not this
# script's to crash on.
timeout 25 ssh -n -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null deploy@localhost true < /dev/null || true

# Where the answer actually is, and it is worth reading during a validation run:
# sshd names the directory and the reason in as many words.
sudo grep -i 'bad ownership or modes' /var/log/secure || true
