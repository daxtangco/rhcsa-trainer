#!/usr/bin/env bash
# The near-miss that looks perfect until the machine comes back: the name is set
# in the running kernel and written down nowhere.
#
# `hostname app1.lab.example.com` is a real command and it does exactly what it
# says - it sets the kernel's hostname, immediately, for every program that asks
# gethostname() from that moment on. What it does not do is touch /etc/hostname,
# and /etc/hostname is where the name comes from at boot. So every check a student
# thinks to run is green: the shell prompt changes on the next login, `hostname`
# and `uname -n` agree, `getent hosts app1.lab.example.com` answers. Then the host
# reboots and it is `template.localdomain` again.
#
# The two verdicts see different things, which is why the phases differ:
#   hostname-static is wrong now and wrong later - nothing was ever written down -
#   so it carries no phase.
#   hostname-live is right NOW and wrong after the reboot: @post. That regression
#   is the whole point of the fixture, and it is why this task declares
#   reboot_check.
# Everything else here is done properly, so the two red lines are unambiguous.
# expect-fail: hostname-static, hostname-live@post
set -euo pipefail

dev=$(ip -4 -o addr show scope global | awk '$2 != "lo" && !seen { print $2; seen = 1 }')
cidr=$(ip -4 -o addr show scope global | awk '$2 != "lo" && !seen { print $4; seen = 1 }')
addr=${cidr%/*}

# THE MISTAKE. Not `hostnamectl set-hostname`, which would have written the file
# as well. `hostname` lives in its own package rather than in coreutils, so the
# kernel value is written directly if the command is not there - the mistake being
# demonstrated is the same either way, and the fixture must not fail for a reason
# unrelated to it.
if command -v hostname >/dev/null; then
  sudo hostname app1.lab.example.com
else
  sudo sh -c "printf '%s\n' 'app1.lab.example.com' > /proc/sys/kernel/hostname"
fi

# The rest of the hand-over, done correctly. The hosts entry uses the new name, so
# the host stays resolvable under the name it currently answers to - which keeps
# this fixture safe to grade and keeps the failure narrowed to persistence.
#
# The template's own entry is deliberately LEFT IN PLACE, and this fixture is the
# one where that matters. Tidying it away is what solutions/01 and /02 do, and it is
# harmless there because they also made app1 the persistent name. Here the
# persistent name is still template.localdomain, so after verdict B's reboot the
# machine answers to template.localdomain again - and if this script had deleted
# that line, the rebooted guest would hold a hostname present in neither
# /etc/hosts nor DNS, which is one resolver round trip per sudo call for the entire
# post-reboot grade run. Leaving the line costs no checkpoint: self-hosts-entry
# asks whether the address maps app1.lab.example.com AND app1, and is indifferent
# to what else the address maps.
printf '%s app1.lab.example.com app1\n' "$addr" | sudo tee -a /etc/hosts >/dev/null
printf '192.0.2.40 filer1.lab.example.com filer1\n' | sudo tee -a /etc/hosts >/dev/null
sudo restorecon /etc/hosts 2>/dev/null || true

uuid=$(nmcli -g UUID,DEVICE connection show --active | awk -F: -v d="$dev" '$2 == d && !seen { print $1; seen = 1 }')
sudo nmcli connection modify uuid "$uuid" ipv4.dns 192.168.70.2 ipv4.dns-search lab.example.com

# The tell, and nobody looks at it unless they already suspect: the file still
# holds the old name while the running system reports the new one.
uname -n
sudo cat /etc/hostname
