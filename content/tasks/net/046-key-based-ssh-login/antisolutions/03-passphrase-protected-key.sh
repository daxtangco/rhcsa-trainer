#!/usr/bin/env bash
# The habit that is right everywhere else, applied where it cannot work.
#
# "Always put a passphrase on a private key" is correct advice, it is what every
# hardening guide says, and ssh-keygen asks for one because the common case is a
# human's own key. This account is not that case: the ticket describes a job that
# runs unattended, and a passphrase is a prompt - so the login the job needs is the
# one thing this key cannot do.
#
# Everything else here is right. The public half is installed properly, the modes
# and the owner and the SELinux context are all correct, and a human sitting at a
# terminal would type the passphrase once and see it work perfectly - which is
# exactly how this answer gets signed off. It is only in a session with nothing to
# type into that it fails, and that is the session the automation lives in.
#
#   student-keypair is red because the requirement was a key usable with no
#   passphrase, and this one is not. No phase: a reboot does not decrypt a key.
#   deploy-key-login is red for the same single cause, in both verdicts.
#   deploy-authorized-key is GREEN, and that is the point of separating the two:
#   the right public key really is installed in the right file. One mistake, one
#   cause, and the two red lines together say which one.
# expect-fail: student-keypair, deploy-key-login
#
# The agent is the other half of this story and is deliberately not driven here.
# `ssh-agent` plus `ssh-add` is the correct answer for a human: the passphrase is
# typed once per session and the agent holds the decrypted key. It is not an answer
# for this ticket, for two reasons a candidate has to internalise:
#   an agent belongs to one login session, so a key loaded in the candidate's shell
#   is not available to the grader's session, to a systemd timer, or to cron; and
#   an agent does not survive a reboot, so "it worked when I tested it" is a claim
#   about the last five minutes.
# Loading one here would also mean feeding a passphrase to ssh-add through
# SSH_ASKPASS inside a fixture and leaving a stray agent process behind, which is
# machinery this task does not need to make the point.
set -euo pipefail

# -N with an actual passphrase. That single argument is the whole fixture.
ssh-keygen -t rsa -b 4096 -N 'correct horse battery staple' -C 'student@lab deploy automation' -f "$HOME/.ssh/id_rsa" < /dev/null

# The rest, done exactly as the model answer does it.
sudo install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
sudo install -m 0600 -o deploy -g deploy "$HOME/.ssh/id_rsa.pub" /home/deploy/.ssh/authorized_keys
sudo restorecon -R /home/deploy/.ssh
sudo ls -lZ /home/deploy/.ssh

# What the key file itself admits to, and where to look first when a login that
# should work asks for something: an encrypted OpenSSH key still starts with the
# same PEM header, so the honest test is whether the public half can be derived
# without a passphrase.
ssh-keygen -y -P '' -f "$HOME/.ssh/id_rsa" < /dev/null || echo 'the private key cannot be read without its passphrase - which is what an unattended job would hit'

# And the login the ticket describes, in the conditions the ticket describes.
# BatchMode is what turns the passphrase prompt into an immediate failure instead of
# a script that hangs until something kills it.
timeout 25 ssh -n -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null deploy@localhost true < /dev/null || true
