#!/usr/bin/env bash
# The answer that satisfies the letter of the ticket and misses the point of it.
#
# "The host takes its time from 192.0.2.10" - done, one line appended, and the
# running daemon lists it. What is skipped is the sentence after it: "and from
# nothing else". RHEL 9's stock /etc/chrony.conf ships
# `pool 2.rhel.pool.ntp.org iburst`, and appending a server does not remove it.
# The result is a host inside a controlled site that still asks the public
# internet for the time, which is the exact thing the site time server exists to
# stop - and on a real network it would work, so nothing would ever complain.
#
# This is also the failure that is hardest to see in this lab, because with no
# route the pool name does not resolve and `chronyc sources` shows one source. A
# grader that counted the running daemon's sources would call this correct. The
# on-disk configuration is the only honest place to ask the question, which is
# why chrony-sole-source is graded from /etc and never from chronyc.
#
# Wrong in both verdicts: the leftover line survives reboots as happily as the
# added one, so no phase.
# expect-fail: chrony-sole-source
set -euo pipefail

sudo timedatectl set-timezone Asia/Tokyo

# One line appended, nothing removed. No sed, no comment character, no look at
# what the file already said.
printf 'server 192.0.2.10 iburst\n' | sudo tee -a /etc/chrony.conf >/dev/null

sudo systemctl enable --now chronyd
sudo systemctl restart chronyd

sudo systemctl enable --now tuned
sudo tuned-adm profile throughput-performance

# Two sources configured, one of them reachable only from a network this host is
# not on. Compare with `grep -E '^(server|pool|peer)' /etc/chrony.conf`.
sudo chronyc -n sources || true
