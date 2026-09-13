#!/usr/bin/env bash
# expect-fail: mode-enforcing-config, mode-enforcing-now@post
#
# The most common wrong answer to the mode half, and the reason this task sets
# `reboot_check: true`.
#
# Everything else is right: the port record goes in correctly, the daemon is left
# confined, the shipped 514/udp record is untouched, the kernel command line is
# clean. The only thing missing is the persistent half of the mode change -
# `setenforce` writes nothing to disk.
#
# The signature is the whole point:
#
#   verdict A   mode-enforcing-now   PASS    getenforce says Enforcing
#               mode-enforcing-config FAIL   the file still says permissive
#   verdict B   mode-enforcing-now   FAIL    the reboot read the file
#               mode-enforcing-config FAIL
#
# An A pass followed by a B failure on the same id is reported as a regression,
# which is exactly the right description of "it works until you reboot it". A
# grader that read only `getenforce` would call this correct.
set -euo pipefail

sudo timeout 60 semanage port -a -t syslogd_port_t -p udp 5514

# ...and stop here. /etc/selinux/config is left as setup.sh staged it.
sudo timeout 30 setenforce 1

sudo timeout 60 systemctl restart rsyslog
