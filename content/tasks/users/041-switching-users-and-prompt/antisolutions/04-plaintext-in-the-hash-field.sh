#!/usr/bin/env bash
# The password half, wrong in the way that leaves no trace. `usermod -p` does not
# take a password, it takes an already-encrypted one, and it writes whatever it is
# given into field 2 of /etc/shadow verbatim. So this account now has a shadow
# field reading Rh9-Oncall-9d41 in clear, and the one thing nobody can do with it
# is log in: crypt(3) will never produce that string from any input, so every
# password comparison fails, including a comparison against the plaintext itself.
#
# usermod prints nothing and exits 0. `getent shadow oncall` shows a field that is
# not empty and does not start with `!`, so every quick check a student is likely to
# run - is it locked? is it set? - answers reassuringly. The account looks more
# ready than it did before.
#
# The prompt half is done correctly here, in ~oncall/.bashrc, so a green
# prompt-login and prompt-nonlogin prove login-password is graded on the shadow
# field's content rather than on "did anything about this account change".
# expect-fail: login-password
set -euo pipefail
sudo usermod -s /bin/bash oncall
sudo usermod -p 'Rh9-Oncall-9d41' oncall
sudo -u oncall tee -a /home/oncall/.bashrc >/dev/null <<'PROMPT'
PS1='[\u@\h \w]\$ '  # rhcsa041
PROMPT
