#!/usr/bin/env bash
# expect-fail: mode-enforcing-now@pre
#
# The mirror image of 01, and the reason mode-enforcing-now and
# mode-enforcing-config are two checkpoints rather than one.
#
# This fixture edits /etc/selinux/config correctly and never touches the running
# mode, which is the answer of someone who knows the file is the persistent one
# and has not noticed that it is read only at boot. It is also the shape of a
# real half-finished change: correct on disk, not yet applied.
#
#   verdict A   mode-enforcing-now   FAIL   still Permissive - nothing applied it
#               mode-enforcing-config PASS
#   verdict B   mode-enforcing-now   PASS   the reboot applied the file
#               mode-enforcing-config PASS
#
# So the id carries @pre: it fails before the reboot and passes after it. That
# transition is what proves mode-enforcing-now is measuring the running mode and
# not quietly re-reading the file - a grader that parsed the config for both
# checkpoints would pass this fixture in verdict A and never be caught.
set -euo pipefail

sudo timeout 60 semanage port -a -t syslogd_port_t -p udp 5514

# The persistent half only. No setenforce.
sudo timeout 30 sed -ri 's/^[[:space:]]*SELINUX[[:space:]]*=.*/SELINUX=enforcing/' /etc/selinux/config

sudo timeout 60 systemctl restart rsyslog
