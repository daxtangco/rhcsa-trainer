#!/usr/bin/env bash
# Route 2, and independent of route 1 rather than a restyling of it: deploy's files
# are created BY DEPLOY, so no chown is needed and no root-owned file can be left
# behind by accident, and the key line is APPENDED rather than written over the
# file - which is the only form that is safe on an account that already trusts
# somebody else's key.
#
# Different in every step that route 1 makes a decision about:
#   rsa 4096 instead of ed25519, to show that the algorithm is not what is being
#     graded.
#   `ssh-keygen -y` reading the private key instead of copying the .pub file, which
#     is the answer when the .pub file has been lost or was never kept.
#   `sudo -u deploy` with a restrictive umask instead of `install -o`, so every
#     file appears already owned by deploy and already unreadable to anyone else -
#     there is no window in which a fresh authorized_keys sits there world-readable.
#   Verified by comparing fingerprints as well as by logging in, because a login
#     that works proves SOME key was accepted, not that the intended one was.
#
# The same three things are still absent, for the same reasons as route 1: no
# sshd_config edit, no sshd restart, and nothing at all done to student's own
# ~/.ssh/authorized_keys.
set -euo pipefail

# 0077 means every file this shell creates is rw for its owner and nothing for
# anybody else. Set once, at the top, rather than chmod-ing afterwards: the mode
# is right from the instant the file exists.
umask 0077

# One of the filenames the client looks for on its own. That choice is not
# cosmetic and it is the trap in this half of the task: ssh offers the default
# identities and nothing else, so a key called deploy_automation_rsa is not tried
# by a plain `ssh deploy@localhost` at all - it works only when the client is
# pointed at it, every single time, by -i or by an IdentityFile line in
# ~/.ssh/config. The ticket asks for a login that just works, so either the key
# carries a default name (this file) or the account's client configuration names
# it (the closing comment below).
KEY="$HOME/.ssh/id_rsa"

# `< /dev/null` for the same reason as in route 1: this script is on ssh's stdin,
# and an ssh-keygen that decided to ask a question would read the rest of the file
# as the answer.
ssh-keygen -t rsa -b 4096 -N '' -C 'student@lab -> deploy' -f "$KEY" < /dev/null

# deploy's own directory, made by deploy. Absolute paths rather than `~`, because
# whether sudo hands the target user's HOME to the command it runs depends on
# sudoers settings that differ between machines - and a key written to the wrong
# home is a key sshd never reads.
sudo -u deploy install -d -m 0700 /home/deploy/.ssh

# The public half derived from the private key. `-y` prints exactly the one line
# authorized_keys wants; it needs the private key to do it, which is why this is
# run as student and only its OUTPUT crosses over. `tee -a` appends, so a key
# already trusted by deploy keeps working - `>` here would have quietly revoked
# whoever was already in the file.
#
# Created by deploy under the umask above, so it is 0600 deploy:deploy from birth.
ssh-keygen -y -f "$KEY" < /dev/null | sudo -u deploy tee -a /home/deploy/.ssh/authorized_keys > /dev/null

# Both files were created in place by ordinary tools, so their SELinux labels come
# from the policy's rule for a `.ssh` directory under a home and this prints
# nothing. Run anyway, and read the output: silence here is a real result, and the
# one case where these three lines are the whole answer is a key that was moved in
# from outside the home tree - which keeps that directory's label, and for /root or
# an unlabelled path that is a label sshd is not allowed to read. (Not /tmp: on
# RHEL 9 sshd may read user_tmp_t, measured 2026-09-14 - see the header of
# antisolutions/04-moved-from-root-home-then-setenforce.sh.)
sudo restorecon -R -v /home/deploy/.ssh

# Fingerprints, not just a successful login: this is what says the key deploy now
# trusts is the key student holds, rather than some other key that also happens to
# work. The two commands must print the same SHA256:... field.
ssh-keygen -lf "$KEY"
sudo -u deploy ssh-keygen -lf /home/deploy/.ssh/authorized_keys

# First the narrow check - this key, and only this key, is accepted.
# IdentitiesOnly=yes stops ssh from quietly succeeding with some other identity it
# found, which is what would happen on a machine that already had a working key
# and is how a broken answer gets mistaken for a good one.
timeout 25 ssh -n -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null deploy@localhost 'id -un' < /dev/null

# Then the check the ticket actually asks for: the plain login, nothing on the
# command line, in a session with no terminal and no agent. This is the one that
# fails when the key has a name the client does not look for by itself.
timeout 25 ssh -n -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null deploy@localhost 'id -un' < /dev/null

# If a name of your own is what you want - and for a job-specific key it usually
# is - the missing piece is a stanza in student's own ~/.ssh/config:
#     Host deploy-local
#         HostName localhost
#         User deploy
#         IdentityFile ~/.ssh/deploy_automation_rsa
# then the job says `ssh deploy-local` and nothing has to remember -i. That is a
# client-side file in student's own home; it is not a change to the SSH server, and
# it is not a change to student's authorized_keys.
