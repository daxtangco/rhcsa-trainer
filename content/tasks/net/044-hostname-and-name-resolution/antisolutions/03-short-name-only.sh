#!/usr/bin/env bash
# The near-miss that answers the question a shell prompt asks instead of the
# question the ticket asks: this host's hosts entry lists only the short name.
#
# `192.168.70.130 app1` is a perfectly valid line, and after it the short name
# resolves, `ping app1` works, and the prompt says app1 because that is what the
# system does with the part before the first dot. What is missing is the fully
# qualified name, and the fully qualified name is the one that matters: it is what
# a certificate is issued for, what a Kerberos principal is built from, what a peer
# gets back from a reverse lookup, and what the ticket named.
#
# It is easy to believe the entry is unnecessary, because the host answers to its
# own fully qualified name anyway: nss-myhostname is the last entry in
# /etc/nsswitch.conf's hosts line and it answers for whatever the current hostname
# is, so `getent hosts app1.lab.example.com` succeeds here with no help from the
# file. That is precisely why self-hosts-entry reads /etc/hosts rather than asking
# the resolver, and why this fixture would fool a grader that did not.
#
# One red line, in both verdicts - the file is a file, and the reboot changes
# nothing about it - so no phase. Everything else here is correct.
# expect-fail: self-hosts-entry
set -euo pipefail

cidr=$(ip -4 -o addr show scope global | awk '$2 != "lo" && !seen { print $4; seen = 1 }')
addr=${cidr%/*}
dev=$(ip -4 -o addr show scope global | awk '$2 != "lo" && !seen { print $2; seen = 1 }')

sudo hostnamectl set-hostname app1.lab.example.com
sudo sed -i '/[[:space:]]template\(\.localdomain\)\?\([[:space:]]\|$\)/d' /etc/hosts

# THE MISTAKE. The short name and nothing else.
printf '%s app1\n' "$addr" | sudo tee -a /etc/hosts >/dev/null

# The peer, done properly - both of its names are there, which is what makes the
# omission above a deliberate demonstration rather than sloppiness.
printf '192.0.2.40 filer1.lab.example.com filer1\n' | sudo tee -a /etc/hosts >/dev/null
sudo restorecon /etc/hosts 2>/dev/null || true

uuid=$(nmcli -g UUID,DEVICE connection show --active | awk -F: -v d="$dev" '$2 == d && !seen { print $1; seen = 1 }')
sudo nmcli connection modify uuid "$uuid" ipv4.dns 192.168.70.2 ipv4.dns-search lab.example.com

# The tell, and it is a subtle one: the first lookup succeeds, and it succeeds
# without the file's help.
getent hosts app1.lab.example.com
getent ahostsv4 app1
sudo grep -n app1 /etc/hosts
