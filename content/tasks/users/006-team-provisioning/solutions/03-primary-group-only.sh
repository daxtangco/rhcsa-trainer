#!/usr/bin/env bash
# Made devops each user's *primary* group instead of adding it as a secondary
# one. Everything passes, which is the point: this is a correct answer that a
# naive grader might reject, so it is here to prove the grader accepts it.
#
# A third genuinely independent path: id -nG lists primary groups too. If
# validate reports a failure here, the membership checkpoints are testing the
# mechanism rather than the end state - fix the grader, not this file.
set -euo pipefail
sudo groupadd -g 5000 devops
sudo useradd -g devops alice
sudo useradd -g devops bob
sudo useradd -g devops -e 2027-06-30 carol
sudo chage -M 30 alice
printf '%%devops ALL=(ALL) ALL\n' | sudo tee /etc/sudoers.d/devops >/dev/null
sudo chmod 0440 /etc/sudoers.d/devops
