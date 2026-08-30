#!/usr/bin/env bash
set -euo pipefail
sudo groupadd -g 5000 devops
sudo useradd alice
sudo useradd bob
sudo useradd carol
sudo usermod -aG devops alice
sudo usermod -aG devops bob
sudo usermod -aG devops carol
sudo chage -E 2027-06-30 carol
sudo chage -M 30 alice
printf '%%devops ALL=(ALL) ALL\n' | sudo tee /etc/sudoers.d/devops >/dev/null
sudo chmod 0440 /etc/sudoers.d/devops
sudo visudo -c
