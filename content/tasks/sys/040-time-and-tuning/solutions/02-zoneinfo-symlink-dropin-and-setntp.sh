#!/usr/bin/env bash
# Route 2, equally correct, and different from solutions/01 in every choice it
# makes:
#   - the time zone by replacing the /etc/localtime symlink, not through
#     timedatectl
#   - the source in a drop-in under /etc/chrony.d, not in chrony.conf, and the
#     stock pool line deleted rather than commented out
#   - the service through `timedatectl set-ntp true`, which enables and starts
#     chronyd for you, instead of systemctl - and with the configuration written
#     FIRST, so there is nothing to restart
#   - the tuning profile written into the two files tuned-adm writes, instead of
#     through tuned-adm
#
# Four routes, one end state. A grader that grepped chrony.conf for the server
# line, or read /etc/tuned/active_profile instead of asking tuned, or looked for
# `systemctl enable chronyd` in the shell history, would wrongly reject this -
# which is the over-fitting the second solution exists to catch.
set -euo pipefail

# --- the time zone --------------------------------------------------------
# What timedatectl does under the covers, and the only route you have if
# systemd-timedated is not answering. The zone file's path under
# /usr/share/zoneinfo IS the zone name, which is why `ls /usr/share/zoneinfo`
# answers the same question as `timedatectl list-timezones`.
sudo ln -sf /usr/share/zoneinfo/Asia/Tokyo /etc/localtime

# --- the source, before the service is ever started -----------------------
# The stock source line goes. Deleted this time rather than commented out; both
# are correct and nothing grades the difference, but deleting it makes the point
# that "and from nothing else" is a real requirement rather than a preference.
sudo sed -i -E '/^[[:space:]]*(server|pool|peer)[[:space:]]/d' /etc/chrony.conf

# The site server in its own file. This is the packaging-friendly habit: the
# distribution owns chrony.conf, you own your drop-in, and an update to the
# package cannot silently take your change with it.
#
# mkdir is not defensive padding: the chrony RPM does not ship /etc/chrony.d on
# RHEL 9 (verified against chrony-4.8-1.el9), so on a stock guest the directory
# does not exist until you make it.
sudo mkdir -p /etc/chrony.d
printf '# Tokyo site time server (sys/040)\nserver 192.0.2.10 iburst\n' \
  | sudo tee /etc/chrony.d/rhcsa-site-time.conf >/dev/null
sudo chmod 0644 /etc/chrony.d/rhcsa-site-time.conf
# SELinux is Enforcing: a file created under /etc inherits etc_t from its parent,
# so this only guarantees what is already true. Same habit as systemd/017's setup.
sudo restorecon /etc/chrony.d/rhcsa-site-time.conf

# A drop-in directory is only read if chrony.conf says so, and RHEL 9's stock
# chrony.conf does NOT say so: chrony-4.8-1.el9's file has no confdir line and no
# include line, and `strings` on the daemon shows no built-in default for that
# path either. So on this guest the line below is the half of the answer that
# makes the drop-in do anything at all - without it the file is written, looks
# right, and `chronyc sources` stays empty for ever. Written as a conditional
# rather than an unconditional append so that re-running this script, or running
# it on an image whose chrony.conf already carries the line, does not duplicate
# it. grep on a FILE, not on a pipe, so there is no producer for -q to kill
# (content/lib/assert.sh's SIGPIPE note).
# The test names the directory rather than just the directive, so an image whose
# chrony.conf includes some *other* directory still gets the line it needs.
sudo grep -qsE '^[[:space:]]*(confdir|include)[[:space:]]+/etc/chrony\.d' /etc/chrony.conf \
  || printf 'confdir /etc/chrony.d\n' | sudo tee -a /etc/chrony.conf >/dev/null

# --- the service ----------------------------------------------------------
# One command for both halves: timedatectl enables chronyd and starts it, because
# "NTP on" in systemd's vocabulary means exactly the unit listed in
# /usr/lib/systemd/ntp-units.d being enabled and running. And because the
# configuration above is already on disk, the daemon reads it as it starts - no
# restart, no reload, nothing to forget.
sudo timedatectl set-ntp true

# --- the tuning profile ---------------------------------------------------
# The two files `tuned-adm profile` writes, written directly. active_profile is
# what tuned reads at startup, which is the whole mechanism by which a profile
# survives a reboot; profile_mode=manual is what says "I chose this", so tuned
# does not run its own `recommend` at the next boot and quietly pick
# virtual-guest for a VM instead.
printf 'throughput-performance\n' | sudo tee /etc/tuned/active_profile >/dev/null
printf 'manual\n' | sudo tee /etc/tuned/profile_mode >/dev/null
sudo chmod 0644 /etc/tuned/active_profile /etc/tuned/profile_mode

# Only now start it, so tuned applies the profile as it comes up - the same
# ordering trick as the chrony half above.
sudo systemctl enable --now tuned

# Read the end state back out of the tools that own it, which is also how the
# grader asks.
sudo chronyc -n sources || true
sudo tuned-adm active
timedatectl
