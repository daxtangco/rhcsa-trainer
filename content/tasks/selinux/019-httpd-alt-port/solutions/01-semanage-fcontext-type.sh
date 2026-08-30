#!/usr/bin/env bash
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
sudo restorecon -Rv /srv/web

sudo firewall-cmd --permanent --add-port=82/tcp
sudo firewall-cmd --reload

sudo systemctl enable --now httpd
