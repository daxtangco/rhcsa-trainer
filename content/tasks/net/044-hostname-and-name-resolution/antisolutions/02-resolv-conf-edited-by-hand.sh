#!/usr/bin/env bash
# The near-miss that is right about the goal and wrong about the file: the
# nameserver and the search domain are written straight into /etc/resolv.conf.
#
# It is an understandable answer. /etc/resolv.conf is where a resolver
# configuration has lived on every Unix since the 1980s, `man resolv.conf` is a
# real manual page, and after this script runs the host really does use
# 192.168.70.2 and really does append lab.example.com to short names. Today it
# works.
#
# It is still wrong, for one reason: on this system that file is an OUTPUT.
# NetworkManager writes it - it even says so in a banner comment at the top - and
# it rewrites it from the connection profile every time the connection activates.
# The next activation, or the next boot, silently discards everything typed here.
# The setting has to live in the profile, which is the only thing NetworkManager
# consults when it generates the file.
#
# Both checkpoints are wrong now and wrong after the reboot, so neither carries a
# phase - the reboot is in fact what destroys the work, but the checkpoints read
# the profile, and the profile was empty from the start. Everything else here is
# correct, so the two red lines say exactly one thing.
# expect-fail: dns-nameserver, dns-search
set -euo pipefail

cidr=$(ip -4 -o addr show scope global | awk '$2 != "lo" && !seen { print $4; seen = 1 }')
addr=${cidr%/*}

# The name and the hosts entries, done properly.
sudo hostnamectl set-hostname app1.lab.example.com
sudo sed -i '/[[:space:]]template\(\.localdomain\)\?\([[:space:]]\|$\)/d' /etc/hosts
printf '%s app1.lab.example.com app1\n' "$addr" | sudo tee -a /etc/hosts >/dev/null
printf '192.0.2.40 filer1.lab.example.com filer1\n' | sudo tee -a /etc/hosts >/dev/null
sudo restorecon /etc/hosts 2>/dev/null || true

# THE MISTAKE. The connection profile is never touched; the generated file is
# edited instead.
#
# The nameserver written here is the one this network actually runs, deliberately:
# a fixture that pointed the host at a dead resolver would leave every later
# lookup - including the grader's own - waiting for a timeout, and the checkpoint
# that failed would be the wrong one. The mistake being demonstrated is WHERE the
# setting was put, not what it was.
sudo tee /etc/resolv.conf >/dev/null <<'EOF'
# hand-written, which is the mistake
search lab.example.com
nameserver 192.168.70.2
EOF
sudo restorecon /etc/resolv.conf 2>/dev/null || true

# The tell: the profile that NetworkManager will regenerate that file from still
# has nothing in it.
dev=$(ip -4 -o addr show scope global | awk '$2 != "lo" && !seen { print $2; seen = 1 }')
uuid=$(nmcli -g UUID,DEVICE connection show --active | awk -F: -v d="$dev" '$2 == d && !seen { print $1; seen = 1 }')
nmcli -g ipv4.dns,ipv4.dns-search connection show uuid "$uuid"
cat /etc/resolv.conf
