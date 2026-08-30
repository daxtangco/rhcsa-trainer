#!/usr/bin/env bash
# The firewall is open in the running config and nowhere else. Note that
# sshd-listening still passes after the reboot: sshd binds regardless of what
# firewalld does, so a student testing with `ss -ltn` from the console sees a
# healthy machine that no other host can reach. That is the failure this
# checkpoint exists for.
# expect-fail: firewall-ssh
set -euo pipefail
sudo systemctl enable --now sshd
sudo firewall-cmd --add-service=ssh
sudo nmcli connection modify "$(cat /etc/rhcsa-conn)" connection.autoconnect yes
