#!/usr/bin/env bash
set -euo pipefail
sudo systemctl enable --now sshd
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
sudo nmcli connection modify "$(cat /etc/rhcsa-conn)" connection.autoconnect yes
