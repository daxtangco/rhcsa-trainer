#!/usr/bin/env bash
# The near-miss that has every character right and the order wrong: the file
# server's line reads `filer1.lab.example.com 192.0.2.40`.
#
# This is the single commonest mistake in /etc/hosts, and it is commonest because
# every other mapping file a student meets is written the other way round - a
# name, then what it points at. /etc/hosts is not: a line is an ADDRESS, then
# every name that address should answer to. Reversed, the line is not an error -
# nothing complains, nothing logs anything, `cat /etc/hosts` looks like the answer.
# The resolver simply cannot parse `filer1.lab.example.com` as an address, skips
# the line entirely, and the name resolves exactly as well as it did before, which
# is not at all.
#
# One red line, in both verdicts, so no phase. Everything else here is correct -
# including this host's own entry, written the right way round, which is what makes
# the contrast visible in a single file.
# expect-fail: peer-resolves
set -euo pipefail

cidr=$(ip -4 -o addr show scope global | awk '$2 != "lo" && !seen { print $4; seen = 1 }')
addr=${cidr%/*}
dev=$(ip -4 -o addr show scope global | awk '$2 != "lo" && !seen { print $2; seen = 1 }')

sudo hostnamectl set-hostname app1.lab.example.com
sudo sed -i '/[[:space:]]template\(\.localdomain\)\?\([[:space:]]\|$\)/d' /etc/hosts
printf '%s app1.lab.example.com app1\n' "$addr" | sudo tee -a /etc/hosts >/dev/null

# THE MISTAKE. Name first, address second.
printf 'filer1.lab.example.com 192.0.2.40\n' | sudo tee -a /etc/hosts >/dev/null
printf 'filer1 192.0.2.40\n' | sudo tee -a /etc/hosts >/dev/null
sudo restorecon /etc/hosts 2>/dev/null || true

uuid=$(nmcli -g UUID,DEVICE connection show --active | awk -F: -v d="$dev" '$2 == d && !seen { print $1; seen = 1 }')
sudo nmcli connection modify uuid "$uuid" ipv4.dns 192.168.70.2 ipv4.dns-search lab.example.com

# The tell: the file contains the name, and the resolver does not know it. `getent`
# is the only check that can tell those two apart, which is why it is worth
# reaching for before believing an entry works.
sudo grep -n filer1 /etc/hosts
getent hosts filer1.lab.example.com || printf 'filer1.lab.example.com does not resolve\n'
