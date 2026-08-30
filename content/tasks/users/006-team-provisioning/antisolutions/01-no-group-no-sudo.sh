#!/usr/bin/env bash
# Created the group and the accounts with the right aging, then stopped: nobody
# was added to devops and no sudoers rule was written. So sudo-devops fails for
# two independent reasons at once - alice is not in devops, and there is no
# %devops rule for her to match even if she were. Both halves of the sudo answer
# are missing, which is the common shape of a half-finished attempt.
# expect-fail: alice-in-devops, bob-in-devops, carol-in-devops, sudo-devops
set -euo pipefail
sudo groupadd -g 5000 devops
sudo useradd alice
sudo useradd bob
sudo useradd carol
sudo chage -E 2027-06-30 carol
sudo chage -M 30 alice
