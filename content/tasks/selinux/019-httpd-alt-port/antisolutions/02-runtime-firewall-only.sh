#!/usr/bin/env bash
# firewall-cmd without --permanent. Open now, closed after a reboot - and the
# page still loads from inside the machine either way, which is exactly how
# people convince themselves it worked.
# expect-fail: firewall-permanent, firewall-runtime@post
set -euo pipefail
sudo dnf -y install httpd
sudo sed -i 's|^Listen 80$|Listen 82|' /etc/httpd/conf/httpd.conf
sudo sed -i 's|^DocumentRoot "/var/www/html"|DocumentRoot "/srv/web"|' /etc/httpd/conf/httpd.conf
sudo tee -a /etc/httpd/conf/httpd.conf >/dev/null <<'EOF'
<Directory "/srv/web">
    Require all granted
</Directory>
EOF
sudo semanage port -a -t http_port_t -p tcp 82
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/web(/.*)?'
sudo restorecon -R /srv/web
sudo firewall-cmd --add-port=82/tcp
sudo systemctl enable --now httpd
