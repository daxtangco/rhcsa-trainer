#!/usr/bin/env bash
# Independent in three ways: membership is set when the account is created,
# aging is set with passwd instead of chage, and the sudo rule is appended to
# /etc/sudoers instead of dropped into /etc/sudoers.d. All three are correct,
# and each one breaks a grader that greps for a command or a file.
set -euo pipefail
sudo groupadd --gid 5000 devops
sudo useradd -G devops alice
sudo useradd -G devops bob
sudo useradd -G devops -e 2027-06-30 carol
sudo passwd -x 30 alice

# Edit a copy and let visudo validate it before it goes live: a broken
# /etc/sudoers locks everyone out of sudo.
sudo cp /etc/sudoers /tmp/sudoers.new
printf '%%devops ALL=(ALL) ALL\n' | sudo tee -a /tmp/sudoers.new >/dev/null
sudo visudo -c -f /tmp/sudoers.new
sudo install -m 0440 -o root -g root /tmp/sudoers.new /etc/sudoers
