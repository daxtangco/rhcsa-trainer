#!/usr/bin/env bash
# Equally correct, and deliberately different on BOTH axes of the fix, so a
# grader over-fitted to solution 01's command sequence rejects it:
#
#   - the label comes from an *equivalence* rule, so the string
#     httpd_sys_script_exec_t never appears in the fcontext database at all.
#     "Label /srv/reports the way you label the stock CGI directory" is the more
#     accurate statement of intent, and it keeps working if the distribution
#     ever changes which type CGI programs get.
#   - the boolean is set with `semanage boolean -m --on`, which writes the
#     stored policy and reloads it in one step. `setsebool -P` never runs, so a
#     grader that grepped shell history, or that looked only at the file
#     setsebool happens to touch, would call this non-persistent.
set -euo pipefail

sudo semanage fcontext -a -e /var/www/cgi-bin /srv/reports
sudo restorecon -R /srv/reports

sudo semanage boolean -m --on httpd_enable_cgi
