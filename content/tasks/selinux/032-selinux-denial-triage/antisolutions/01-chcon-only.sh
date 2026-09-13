#!/usr/bin/env bash
# The reason context-policy exists. chcon writes the type straight onto the
# inode, so the endpoint comes up, the report renders, and it keeps rendering
# across every reboot - until something runs restorecon, or a policy update
# triggers a relabel, or configuration management replaces the file. Then the
# label reverts to what the policy says it should be, which is still var_t,
# and the endpoint breaks with no change to any file anyone can point at.
#
# Note that this fixture PASSES the reboot check, and that is the lesson:
# surviving a reboot and surviving a relabel are two different kinds of
# durability, and this task grades both because a chcon answer has exactly one
# of them.
#
# Every line below is solutions/01-fcontext-type-rule.sh with the two label
# lines replaced by one chcon. Keep it that way: the only difference between an
# anti-solution and a correct answer must be the single mistake being modelled.
# expect-fail: context-policy
set -euo pipefail

sudo chcon -R -t httpd_sys_script_exec_t /srv/reports

sudo setsebool -P httpd_enable_cgi on
