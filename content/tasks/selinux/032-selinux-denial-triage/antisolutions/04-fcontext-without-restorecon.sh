#!/usr/bin/env bash
# Told the policy what the label should be and never applied it. The exact
# inverse of 01-chcon-only.sh: there the inode was right and the policy wrong,
# here the policy is right and the inode wrong. Neither recovers on its own -
# `semanage fcontext -a` relabels nothing that already exists, and a reboot does
# not relabel anything either, which is why both failures are for both verdicts.
#
# The symptom is the confusing one. Apache starts, the boolean is on, the rule is
# visibly there in `semanage fcontext -l -C`, and the endpoint still fails,
# because the only thing the kernel ever consults is the label on the inode.
#
# Every line below is solutions/01-fcontext-type-rule.sh verbatim except that
# `restorecon -Rv /srv/reports` is missing.
# expect-fail: context-now, report-served
set -euo pipefail

sudo semanage fcontext -a -t httpd_sys_script_exec_t '/srv/reports(/.*)?'

sudo setsebool -P httpd_enable_cgi on
