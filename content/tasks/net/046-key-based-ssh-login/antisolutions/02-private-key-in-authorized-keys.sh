#!/usr/bin/env bash
# The wrong half of the pair, installed with complete confidence.
#
# ssh-keygen writes two files whose names differ by four characters, and only one of
# them ever leaves the machine it was made on. A candidate working from a
# half-remembered procedure copies id_ed25519 where id_ed25519.pub belongs, and
# every visible detail of the result is right: the file is in the right place, owned
# by deploy, mode 0600, correctly labelled, and it plainly contains a key.
#
# It fails for two separate reasons, and both matter:
#   sshd cannot use it. authorized_keys is a list of public keys, one per line;
#   an OpenSSH private key is a PEM block over many lines and none of those lines
#   parses as an entry. The key is not "wrong", it is not a key list at all.
#   The private key is now in another account. That is the real incident here,
#   not a style point: the automation's private key is sitting in a home directory
#   whose password is written in the ticket, and it has to be regenerated rather
#   than moved back, because there is no way to know who read it in the meantime.
#
#   deploy-authorized-key is wrong from the start and no reboot changes it.
#   deploy-no-private-key likewise - this is the fixture that id exists for.
#   deploy-key-login likewise: there is nothing in that file sshd can accept.
#   The perms and the context are RIGHT here, deliberately: a candidate reading
#   three red lines should not also be sent to check the modes.
# expect-fail: deploy-authorized-key, deploy-no-private-key, deploy-key-login
set -euo pipefail

ssh-keygen -t ed25519 -N '' -C 'student@lab deploy automation' -f "$HOME/.ssh/id_ed25519" < /dev/null
sudo install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh

# The one wrong word: the source path has no .pub on it.
sudo install -m 0600 -o deploy -g deploy "$HOME/.ssh/id_ed25519" /home/deploy/.ssh/authorized_keys
sudo restorecon -R /home/deploy/.ssh

# All of this looks correct, which is why the mistake survives a careful review.
sudo ls -lZ /home/deploy/.ssh

# And a detail worth noticing during a validation run: the first line of the file
# says OPENSSH PRIVATE KEY. That is the whole diagnosis, available at any time, for
# free.
sudo head -n 1 /home/deploy/.ssh/authorized_keys

timeout 25 ssh -n -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null deploy@localhost true < /dev/null || true

# sshd logs this one plainly too, and the message is not about permissions:
# "authentication refused" with a parse complaint about the key file.
sudo journalctl -u sshd -n 15 --no-pager || true
