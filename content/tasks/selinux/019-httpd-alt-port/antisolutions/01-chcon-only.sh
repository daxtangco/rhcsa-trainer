#!/usr/bin/env bash
# The reason context-permanent exists. chcon writes the label onto the inode,
# so everything works and keeps working across reboots - until something runs
# restorecon or the filesystem is relabelled, and then the site breaks with no
# change to any config file.
#
# Note that this anti-solution passes the reboot check. A reboot is not the
# only kind of durability, and this is the case that proves it.
# expect-fail: context-permanent
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
sudo chcon -R -t httpd_sys_content_t /srv/web
sudo firewall-cmd --permanent --add-port=82/tcp
sudo firewall-cmd --reload
sudo systemctl enable --now httpd
