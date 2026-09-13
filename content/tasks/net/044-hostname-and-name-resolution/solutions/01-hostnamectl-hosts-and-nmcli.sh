#!/usr/bin/env bash
# Route 1: the three tools the manual pages hand you, in the order the ticket
# reads - hostnamectl for the name, /etc/hosts for the names this host has to
# know, nmcli for what the connection profile remembers. Straight-line commands
# only: rung 4 builds the student's command sketch out of this file, so nothing
# here is wrapped in a loop or a case.
set -euo pipefail

# The interface and the address it currently holds. Read from the address rather
# than from `ip route get`, because in drill and exam modes this guest has no
# default route (docs/offline-mode.md) and the route-based idiom prints nothing.
# `!seen` instead of awk's `exit`, so awk reads its input to the end: an awk that
# exits early can hand the command feeding it a SIGPIPE, and under
# `set -o pipefail` that aborts the script (content/lib/assert.sh explains the
# trap).
dev=$(ip -4 -o addr show scope global | awk '$2 != "lo" && !seen { print $2; seen = 1 }')
cidr=$(ip -4 -o addr show scope global | awk '$2 != "lo" && !seen { print $4; seen = 1 }')
addr=${cidr%/*}

# --- the name -------------------------------------------------------------
# One command for both halves of "now, and after a reboot": hostnamectl asks
# systemd-hostnamed to set the running name AND write /etc/hostname. The fully
# qualified form goes in as-is - RHEL keeps one name, and the short form is
# whatever comes before the first dot.
sudo hostnamectl set-hostname app1.lab.example.com

# --- the names this host has to know --------------------------------------
# The template's own entry goes first, so the file does not end up mapping this
# address to a machine that no longer exists. This is tidiness rather than a
# requirement - nothing grades it - but a stale entry for your own address is the
# kind of thing that makes a later name lookup answer something you did not
# expect.
sudo sed -i '/[[:space:]]template\(\.localdomain\)\?\([[:space:]]\|$\)/d' /etc/hosts

# This host, then the file server. One line each: address first, then the
# canonical name, then any aliases. Anything after a # is a comment, and the
# order of the columns is the whole grammar of the file - address, then names.
printf '%s app1.lab.example.com app1\n' "$addr" | sudo tee -a /etc/hosts >/dev/null
printf '192.0.2.40 filer1.lab.example.com filer1\n' | sudo tee -a /etc/hosts >/dev/null

# SELinux is Enforcing, and this line is not padding: /etc/hosts is net_conf_t,
# but `sed -i` does not edit in place - it writes a temporary file and renames it
# over the original, and a file newly created under /etc inherits etc_t from the
# directory. So the sed above can leave the file with the wrong label while
# looking perfectly correct in `cat`. restorecon puts the label the policy expects
# back. (`tee` on an existing file truncates and rewrites it, keeping the label it
# found, so the two appends above are not the problem here - the sed is.)
sudo restorecon /etc/hosts

# --- what the connection profile remembers -------------------------------
# The profile that owns this interface, found by matching the device. Keyed by
# UUID rather than by name: `nmcli connection modify` takes either, and a UUID
# cannot contain the colon that would confuse the field splitting below.
uuid=$(nmcli -g UUID,DEVICE connection show --active | awk -F: -v d="$dev" '$2 == d && !seen { print $1; seen = 1 }')

# Both settings in one modify. This writes the profile to disk immediately and
# applies nothing: /etc/resolv.conf still says what it said before, and these
# values reach it the next time the connection activates - which the reboot at the
# end of a lab does for you.
#
# What deliberately does NOT follow is `nmcli connection up`. It would apply the
# change now, and it would also tear the interface's configuration down and build
# it again - on a machine you are logged into over that interface, that is how a
# session ends mid-command. The ticket asks for the setting to be recorded, not
# applied, for exactly this reason. On a console, with nothing depending on the
# link, reactivating is the normal finish.
sudo nmcli connection modify uuid "$uuid" ipv4.dns 192.168.70.2 ipv4.dns-search lab.example.com

# --- read the end state back ---------------------------------------------
# Each fact from the tool that owns it, which is also how the grader asks.
# `getent hosts` is the resolver's own answer, so it is the honest test of "does
# this name resolve here" - but be careful reading it for this host's OWN name:
# nss-myhostname answers for the local hostname even with nothing in /etc/hosts,
# so that one line succeeds whether or not the entry you just added is there. The
# file is the evidence for your own name; getent is the evidence for the peer's.
hostnamectl status
getent hosts app1.lab.example.com
getent hosts filer1.lab.example.com
getent hosts filer1
nmcli -g ipv4.dns,ipv4.dns-search connection show uuid "$uuid"
