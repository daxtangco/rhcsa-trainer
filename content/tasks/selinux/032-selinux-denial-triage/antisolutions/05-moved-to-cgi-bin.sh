#!/usr/bin/env bash
# "SELinux already allows CGI in /var/www/cgi-bin, so I'll just put it there."
# The endpoint works, the boolean is set properly, it survives a reboot and it
# survives a relabel - and the ticket is still not done, because configuration
# management will redeploy /srv/reports/status.sh tonight and nothing will serve
# it. The prompt says to leave the script where it is deployed for that reason.
#
# This is the fixture that proves the two context checkpoints are anchored on the
# deployed path rather than on "some file somewhere is labelled correctly".
# matchpathcon answers for a path whether or not a file is there, so
# context-policy fails on the untouched /srv/reports/status.sh exactly as
# context-now does.
#
# The drop-in is rewritten whole rather than sed-patched, and it carries its own
# <Directory> grant, so this fixture does not depend on whether the shipped
# httpd.conf still grants /var/www/cgi-bin. setup.sh reinstalls /etc/httpd from
# the package on every run, so nothing here leaks into the next fixture.
# expect-fail: context-now, context-policy
set -euo pipefail

sudo install -m 0755 /srv/reports/status.sh /var/www/cgi-bin/status.sh
sudo restorecon -v /var/www/cgi-bin/status.sh

sudo tee /etc/httpd/conf.d/rhcsa-reports.conf >/dev/null <<'EOF'
ScriptAlias "/reports/" "/var/www/cgi-bin/"
<Directory "/var/www/cgi-bin">
    AllowOverride None
    Options +ExecCGI
    Require all granted
</Directory>
EOF

sudo setsebool -P httpd_enable_cgi on
sudo systemctl restart httpd
