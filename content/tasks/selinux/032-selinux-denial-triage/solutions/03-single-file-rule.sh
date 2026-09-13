#!/usr/bin/env bash
# The narrowest correct answer, and the one that proves the grader measures the
# end state rather than a recipe: one rule for one file, no regex, and
# restorecon aimed at that file alone.
#
# /srv/reports itself keeps its default var_t label here, and the endpoint still
# works, because httpd only needs to *search* the directory to reach the
# program - the same permission the stock /var/www/cgi-bin layout needs to
# traverse /var. Only the program itself has to be executable by httpd, so only
# the program itself has to carry httpd_sys_script_exec_t.
#
# It is also the narrowest answer in the security sense, which is why a reviewer
# should not "improve" this fixture into a recursive rule: labelling one file
# grants exactly one file's worth of privilege. The trade-off is real and worth
# a student's attention - a file recreated by a deployment that removes and
# rewrites the file keeps the rule (the rule is on the path, not the inode), but
# a *new* sibling script dropped into this directory tomorrow will not be
# covered, where solution 01's recursive rule would cover it.
set -euo pipefail

sudo semanage fcontext -a -t httpd_sys_script_exec_t /srv/reports/status.sh
sudo restorecon -v /srv/reports/status.sh

sudo setsebool -P httpd_enable_cgi on
