#!/usr/bin/env bash
# Created the accounts and stopped. sudo-devops fails as a consequence of the
# missing membership, not on its own - which is worth seeing, because it shows
# the checkpoints are not independent of each other.
# expect-fail: alice-in-devops, bob-in-devops, carol-in-devops, sudo-devops
set -euo pipefail
sudo groupadd -g 5000 devops
sudo useradd alice
sudo useradd bob
sudo useradd carol
sudo chage -E 2027-06-30 carol
sudo chage -M 30 alice
