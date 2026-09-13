#!/usr/bin/env bash
# A genuinely different route to the same state, not a second spelling of the
# first one. Three independent differences, each of which would break a grader
# that over-fitted to solution 01:
#
#   1. The port record is created by `semanage import` reading a command line from
#      stdin, not by `semanage port -a` on the command line. This is how a real
#      host gets its local customisations restored after a rebuild
#      (`semanage export` writes exactly this format).
#   2. It labels the RANGE 5510-5520 rather than the single port 5514. That is a
#      legitimate answer to the question asked - the port ends up carrying
#      syslogd_port_t - and it is stored as one record with a low and a high, so a
#      grader that string-matched "5514" in the port list would fail a correct
#      answer. This is the fixture that proves it does not.
#   3. /etc/selinux/config is rewritten whole rather than edited in place, and
#      the running mode is set with the word `Enforcing` rather than with `1`.
#
# Not straight-line, and it does not need to be: the sketch in the UI comes from
# the first solution file.
set -euo pipefail

CONFIG=/etc/selinux/config

# `semanage import` reads whole command lines from standard input, one per line,
# without the leading `semanage`. Piped rather than redirected from a heredoc for
# a reason that has bitten this bank before: fixture scripts arrive on ssh's
# stdin, so a command that reads stdin without being given one of its own will
# consume the rest of THIS FILE and the lines below would never run.
printf 'port -a -t syslogd_port_t -p udp 5510-5520\n' | sudo timeout 120 semanage import

# Rewrite the config file rather than editing it, keeping the policy name the host
# is actually running. SELINUXTYPE is read back rather than assumed, because a
# file that names a policy this host does not have installed will not boot the way
# it says.
policy=$(awk -F= '/^[[:space:]]*SELINUXTYPE[[:space:]]*=/ { v = $2 } END { print v }' "$CONFIG" | tr -d '[:space:]')
if [[ -z $policy ]]; then
  policy=targeted
fi

# The comment block is the shipped RHEL 9 one, kept because it is the shipped one:
# selinux-policy-38.1.75-2.el9_8's %post writes exactly these lines, listing only
# `targeted` and `mls` for SELINUXTYPE - RHEL 9 does not ship a `minimum` policy,
# so a rewrite that offers it names a value this host cannot boot.
#
# Two things about this file that are not obvious from looking at it, both of which
# decide whether this rewrite works. libselinux reads the FIRST line that begins
# with the literal `SELINUX=` and stops there, so the assignment goes above
# anything else and appending would have been the wrong move. And the line has to
# start at the first column with no space before the `=`, so `SELINUX = enforcing`
# is not a valid spelling of anything - it reads as no setting at all, and no
# setting at all boots permissive.
sudo tee "$CONFIG" >/dev/null <<EOF
# This file controls the state of SELinux on the system.
# SELINUX= can take one of these three values:
#     enforcing - SELinux security policy is enforced.
#     permissive - SELinux prints warnings instead of enforcing.
#     disabled - No SELinux policy is loaded.
# NOTE: On RHEL 9, unlike RHEL 8 and earlier, SELINUX=disabled does not disable
# SELinux during boot - it boots with SELinux enabled and no policy loaded. Fully
# disabling it needs selinux=0 on the kernel command line.
SELINUX=enforcing
# SELINUXTYPE= can take one of these values:
#     targeted - Targeted processes are protected,
#     mls - Multi Level Security protection.
SELINUXTYPE=$policy
EOF

# `setenforce` takes the word as readily as the number. Same effect, and it reads
# the way the man page writes it.
sudo timeout 30 setenforce Enforcing

sudo timeout 60 systemctl restart rsyslog

# `semanage export` prints the local customisations as the commands that would
# recreate them - the inverse of the import above, and the quickest way to see
# that the record went in as a range.
sudo timeout 30 semanage export
timeout 30 getenforce
