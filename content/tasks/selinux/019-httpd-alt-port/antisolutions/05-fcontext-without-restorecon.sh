#!/usr/bin/env bash
# Told the policy what the label should be and never applied it. The exact
# inverse of 01-chcon-only.sh: there the label was right and the policy wrong,
# here the policy is right and the label wrong. Both fail, for opposite reasons,
# and neither recovers on its own - `semanage fcontext -a` does not relabel
# anything that already exists.
#
# Every line below is solutions/01-semanage-fcontext-type.sh verbatim except
# that `restorecon -Rv /srv/web` is missing. httpd starts and binds 82 fine;
# it returns 403 on every request because it cannot read a var_t file.
# expect-fail: context-now, page-served
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

sudo firewall-cmd --permanent --add-port=82/tcp
sudo firewall-cmd --reload

sudo systemctl enable --now httpd
