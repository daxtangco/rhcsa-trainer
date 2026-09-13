#!/usr/bin/env bash
# expect-fail: port-labeled, syslogd-confined
#
# "It works and SELinux is enforcing" - and the log daemon is exempt from the
# policy for good.
#
# This is the near-miss that a behaviour-based grader cannot see at all, and the
# reason syslogd-confined exists. Both mode checkpoints pass honestly: the host
# really is enforcing, now and at the next boot. The receiver really does listen
# on udp/5514. `getenforce` says Enforcing. Everything looks finished.
#
# What actually happened is that syslogd_t was made a permissive domain, so the
# port was never made acceptable - the daemon simply stopped being subject to the
# rule. `semanage permissive -a` installs a policy module (permissive_syslogd_t),
# so this survives a reboot as convincingly as the right answer does, and it
# applies to everything else the daemon ever does, not just this port. The prompt
# rules it out in words: "Do not exempt the log service from the policy."
#
# Both failures are phase-independent: the port is unlabelled and the module is
# installed in verdict A and verdict B alike, so neither id carries a suffix.
set -euo pipefail

# The wrong fix. Note what is NOT here: no `semanage port` command at all.
sudo timeout 120 semanage permissive -a syslogd_t

sudo timeout 30 sed -ri 's/^[[:space:]]*SELINUX[[:space:]]*=.*/SELINUX=enforcing/' /etc/selinux/config
sudo timeout 30 setenforce 1

sudo timeout 60 systemctl restart rsyslog
