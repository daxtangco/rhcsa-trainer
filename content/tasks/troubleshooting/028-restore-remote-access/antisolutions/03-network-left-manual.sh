#!/usr/bin/env bash
# The two obvious problems fixed and the third missed, because the network is
# working right now and gives no reason to look. After the reboot the machine
# has no address and is unreachable no matter how healthy sshd is.
# expect-fail: net-autoconnect
set -euo pipefail
sudo systemctl enable --now sshd
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
sudo nmcli connection up "$(cat /etc/rhcsa-conn)"
