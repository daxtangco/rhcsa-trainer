#!/usr/bin/env bash
# Fixed all three symptoms for right now. After the reboot sshd is gone again,
# which is what @post is expressing: the service is not enabled, so nothing is
# listening.
# expect-fail: sshd-enabled, sshd-listening@post
set -euo pipefail
sudo systemctl start sshd
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
sudo nmcli connection modify "$(cat /etc/rhcsa-conn)" connection.autoconnect yes
