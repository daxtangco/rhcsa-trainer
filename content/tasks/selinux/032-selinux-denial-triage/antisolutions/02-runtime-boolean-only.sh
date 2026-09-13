#!/usr/bin/env bash
# setsebool without -P. The label half is done properly, the boolean half is
# done only in the running policy, and the endpoint works perfectly - right up
# to the next boot, when the kernel reloads the stored policy and the boolean
# comes back off.
#
# This is the persistence signature the whole reboot check exists to detect, and
# the phases say so precisely. boolean-persistent is wrong immediately, because
# the stored value is readable right now without rebooting anything. boolean-now
# and report-served are correct in verdict A and wrong in verdict B, because
# until the reboot the running policy really does allow the exec - which is
# exactly why one phase per file would not be enough to express this mistake.
# expect-fail: boolean-persistent, boolean-now@post, report-served@post
set -euo pipefail

sudo semanage fcontext -a -t httpd_sys_script_exec_t '/srv/reports(/.*)?'
sudo restorecon -Rv /srv/reports

sudo setsebool httpd_enable_cgi on
