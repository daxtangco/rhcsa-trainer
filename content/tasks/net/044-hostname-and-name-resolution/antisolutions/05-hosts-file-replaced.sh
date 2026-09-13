#!/usr/bin/env bash
# The near-miss that gets both requirements right and takes the stock file with
# them: /etc/hosts is REPLACED with the two new entries instead of being added to.
#
# It happens with one keystroke - `tee` instead of `tee -a`, `>` instead of `>>` -
# and it is invisible afterwards, because everything the ticket asked about works.
# Both names resolve, the host answers to its own fully qualified name, the
# resolver settings are in the profile. What is gone is the pair of lines every
# RHEL install ships:
#
#   127.0.0.1   localhost localhost.localdomain localhost4 localhost4.localdomain4
#   ::1         localhost localhost.localdomain localhost6 localhost6.localdomain6
#
# The host survives it, which is exactly why nobody notices: nss-myhostname is on
# /etc/nsswitch.conf's hosts line and answers `localhost` on its own, so
# `ping localhost` still works and `ssh localhost` still connects. The courtesy
# does not extend to anything that reads the file directly, or to a name lookup
# attempted before nsswitch can be consulted, or to a machine whose nsswitch line
# somebody has since tightened - and by then the change is weeks old and nobody
# connects it to the day the hostname was set. It is also why the ticket says to
# leave those entries alone.
#
# One red line, in both verdicts - the file is a file - so no phase. hosts-localhost
# is the invariant this fixture exists to break, which is what anchors that id:
# it is probed, not declared unprobed.
# expect-fail: hosts-localhost
set -euo pipefail

cidr=$(ip -4 -o addr show scope global | awk '$2 != "lo" && !seen { print $4; seen = 1 }')
addr=${cidr%/*}
dev=$(ip -4 -o addr show scope global | awk '$2 != "lo" && !seen { print $2; seen = 1 }')

sudo hostnamectl set-hostname app1.lab.example.com

# THE MISTAKE. `tee` without -a: the two required entries are written, and
# everything that was in the file is written over.
sudo tee /etc/hosts >/dev/null <<EOF
$addr app1.lab.example.com app1
192.0.2.40 filer1.lab.example.com filer1
EOF
sudo restorecon /etc/hosts 2>/dev/null || true

uuid=$(nmcli -g UUID,DEVICE connection show --active | awk -F: -v d="$dev" '$2 == d && !seen { print $1; seen = 1 }')
sudo nmcli connection modify uuid "$uuid" ipv4.dns 192.168.70.2 ipv4.dns-search lab.example.com

# The tell: everything asked for is right, `localhost` still resolves, and the two
# lines that used to answer for it are not in the file any more.
getent hosts app1.lab.example.com
getent hosts localhost
sudo cat /etc/hosts
