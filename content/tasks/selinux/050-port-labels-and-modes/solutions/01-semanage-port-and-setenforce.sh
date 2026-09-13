#!/usr/bin/env bash
# The direct answer: add the port record, fix the config file, fix the running
# mode. Three commands, one per checkpoint.
#
# Straight-line on purpose - no loops, no conditionals, no functions. Rung 4 of
# the UI builds a command sketch from the leading words of the first solution
# file, so this is the file the student reads as the worked answer.
set -euo pipefail

# The port half. `-a` adds a new record for udp/5514; the type is the one udp/514
# already carries, which is what the prompt points at. Nothing else is needed:
# the port record lives in the policy database, so it is persistent the moment it
# is written and there is no `restorecon` step for ports.
sudo timeout 60 semanage port -a -t syslogd_port_t -p udp 5514

# The mode at the next boot. This file is read at boot and nowhere else, so this
# edit alone changes nothing about how the host is running right now.
sudo timeout 30 sed -ri 's/^[[:space:]]*SELINUX[[:space:]]*=.*/SELINUX=enforcing/' /etc/selinux/config

# The mode right now. This writes nothing to disk, so this command alone would be
# undone by the next reboot. Both of the last two commands are needed, which is
# the point of the task.
sudo timeout 30 setenforce 1

# Not required by any checkpoint, and worth doing anyway: the receiver bound its
# port while the host was permissive, and this proves it still binds now that the
# policy is being enforced.
sudo timeout 60 systemctl restart rsyslog

# Show the result the way the exam expects it to be read: one line for the port
# record, and both modes side by side.
sudo timeout 30 semanage port -l -C
timeout 30 sestatus
