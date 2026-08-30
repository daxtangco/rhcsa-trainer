#!/usr/bin/env bash
# Everything right except the port label, so httpd cannot bind and
# systemctl start fails. The error message says "Permission denied" on a
# perfectly free port, which is the single most confusing SELinux failure
# there is.
#
# httpd-enabled still passes: enable succeeds even though start does not.
# expect-fail: port-labeled, page-served
set -euo pipefail
sudo dnf -y install httpd
sudo sed -i 's|^Listen 80$|Listen 82|' /etc/httpd/conf/httpd.conf
sudo sed -i 's|^DocumentRoot "/var/www/html"|DocumentRoot "/srv/web"|' /etc/httpd/conf/httpd.conf
sudo tee -a /etc/httpd/conf/httpd.conf >/dev/null <<'EOF'
<Directory "/srv/web">
    Require all granted
</Directory>
EOF
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/web(/.*)?'
sudo restorecon -R /srv/web
sudo firewall-cmd --permanent --add-port=82/tcp
sudo firewall-cmd --reload
sudo systemctl enable httpd
sudo systemctl start httpd || true
