#!/usr/bin/env bash
# expect-fail: port-labeled
#
# The right type on the right port number and the wrong protocol.
#
# `semanage port` requires `-p`, and tcp is what fingers type first. The command
# succeeds, `semanage port -l -C` shows a new local record naming syslogd_port_t
# and 5514, and reading that output quickly is enough to believe the job is done.
# Port records are per protocol, though, so a tcp record does nothing whatsoever
# for a UDP listener: udp/5514 is left exactly as unlabelled as it started.
#
# Unlike 04, this one does not even appear to work - the receiver is a UDP
# listener, so under enforcing it is refused the bind. That makes it the cheaper
# mistake to catch on a real host and, on this task, the one that most rewards
# reading `semanage port -l` properly rather than skimming it.
#
# It also exercises the other branch of the grader's port probe: 04 leaves a
# record of the wrong type covering the port, while this leaves no local record
# covering udp/5514 at all, so the two fixtures together check that both the
# "wrong type" and the "nothing here" outcomes are reported as failures rather
# than as an unreadable port list.
#
# Everything else is done correctly, and the failure is phase-independent.
set -euo pipefail

sudo timeout 60 semanage port -a -t syslogd_port_t -p tcp 5514

sudo timeout 30 sed -ri 's/^[[:space:]]*SELINUX[[:space:]]*=.*/SELINUX=enforcing/' /etc/selinux/config
sudo timeout 30 setenforce 1

# The restart is left in so the fixture matches the others, and it is expected to
# succeed: rsyslog starts even when a listener cannot bind. The denial goes to the
# audit log and the daemon carries on, which is the reason this mistake gets
# missed.
sudo timeout 60 systemctl restart rsyslog || true
