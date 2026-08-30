#!/usr/bin/env bash
# The half of this task that leaves no visible trace: accounts and sudo are
# right, password aging was never touched. Also uses the wrong GID, because a
# grader that only counts "does the group exist" is a common mistake.
# expect-fail: group-gid, carol-expiry, alice-maxdays
set -euo pipefail
sudo groupadd devops
sudo useradd -G devops alice
sudo useradd -G devops bob
sudo useradd -G devops carol
printf '%%devops ALL=(ALL) ALL\n' | sudo tee /etc/sudoers.d/devops >/dev/null
sudo chmod 0440 /etc/sudoers.d/devops
