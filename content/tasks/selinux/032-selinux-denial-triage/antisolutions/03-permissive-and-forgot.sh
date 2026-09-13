#!/usr/bin/env bash
# The escape hatch: switch to permissive to confirm SELinux really is the cause,
# fix the real fault while the kernel is not enforcing anything - and never switch
# back.
#
# Every functional checkpoint passes here. The endpoint serves the report, the
# label is right on the inode and in the policy, the boolean is on and stored.
# Only mode-enforcing-now fails, which is what makes this a precise detector: a
# student who reaches for `setenforce 0` and forgets is caught by the checkpoint
# that exists for exactly that, and not by luck.
#
# Runtime only, and deliberately so - no `sed` on /etc/selinux/config. Per the
# SELinux state policy carried at the top of setup.sh, an anti-solution may break
# the runtime mode, which the next boot undoes by itself, and may never write a
# persistent global it is not graded on repairing. An earlier version of this
# fixture also set SELINUX=permissive in the config. That made
# mode-enforcing-config fail too, and the cost was out of all proportion: this one
# file left a machine-wide global damaged for anything that ran afterwards without
# a snapshot revert, so containers/030 and containers/031 - which emit the same
# enforcing invariant - failed for a fault no student caused, one boot away from
# any evidence pointing here. The checkpoint that edit used to probe is now a
# declared unprobed invariant in grade.sh, which says so in those words.
#
# `@pre` rather than the default `both`, and that is the lesson of the fixture
# rather than a technicality. `setenforce 0` does not survive a reboot, so
# verdict B finds the guest enforcing again with a correct, persistent fix
# underneath it, and every checkpoint passes. That is the right answer: this
# mistake is expensive today and invisible tomorrow, which is precisely why the
# grader has to catch it in verdict A and why mode-enforcing-now is not redundant
# with mode-enforcing-config.
# expect-fail: mode-enforcing-now@pre
set -euo pipefail

sudo setenforce 0

sudo semanage fcontext -a -t httpd_sys_script_exec_t '/srv/reports(/.*)?'
sudo restorecon -Rv /srv/reports
sudo setsebool -P httpd_enable_cgi on
