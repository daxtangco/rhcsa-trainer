#!/usr/bin/env bash
# expect-fail: port-labeled
#
# The right command, the right port, the right protocol - and a type that sounds
# right and is not.
#
# syslog_tls_port_t is a real type in the shipped policy - syslogd_selinux(8)
# lists it as one of the two port types defined for syslogd, defaulting to tcp
# and udp 6514 and 10514 - so `semanage port -a` accepts it without a
# murmur and the record appears in the port list looking entirely plausible. It
# is a very easy type to pick from `semanage port -l | grep syslog`, which lists
# it right next to the one the task wants.
#
# It does not work, and not for a subtle reason: the policy lets syslogd_t bind
# syslogd_port_t and syslog_tls_port_t both, so the daemon WILL bind udp/5514
# with this label and the receiver will look fine. What the prompt actually asked
# for was the type the host's log service already uses for its standard 514/udp
# port, and that is the requirement port-labeled measures.
#
# This is the fixture that keeps port-labeled honest about the type. A grader that
# only asked "does some record cover udp/5514" - or that measured the listener
# instead of the label - would pass this.
#
# Everything else is done correctly, so only port-labeled fails, in both phases:
# a port record is persistent the moment it is written, so the wrong one survives
# the reboot just as well as the right one would.
set -euo pipefail

sudo timeout 60 semanage port -a -t syslog_tls_port_t -p udp 5514

sudo timeout 30 sed -ri 's/^[[:space:]]*SELINUX[[:space:]]*=.*/SELINUX=enforcing/' /etc/selinux/config
sudo timeout 30 setenforce 1

sudo timeout 60 systemctl restart rsyslog
