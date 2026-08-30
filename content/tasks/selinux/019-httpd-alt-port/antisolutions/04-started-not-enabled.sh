#!/usr/bin/env bash
# Did everything, then used `systemctl start` where the task said the service
# must come back on its own. Passes completely until the reboot, which is the
# entire point of the verdict-B check - and of the enabled-vs-started card.
#
# Every line below is solutions/01-semanage-fcontext-type.sh verbatim except
# the last, which is `start` where the solution has `enable --now`. Keep it
# that way: the only difference between this fixture and a correct answer must
# be the single mistake being modelled.
# expect-fail: httpd-enabled, page-served@post
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

sudo systemctl start httpd
