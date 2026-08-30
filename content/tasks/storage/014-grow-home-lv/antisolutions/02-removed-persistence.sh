#!/usr/bin/env bash
# Correct right now, gone after a reboot. This is the persistence signature the
# whole reboot check exists to detect.
#
# persist-config is wrong immediately. home-from-lv and fs-home-size only break
# after the reboot, because until then /home is still mounted - which is exactly
# why one phase per file would not be enough to express this.
# expect-fail: persist-config, home-from-lv@post, fs-home-size@post
set -euo pipefail
sudo lvextend -L 12G /dev/rhel/home
sudo xfs_growfs /home
sudo sed -i '\|[[:space:]]/home[[:space:]]|s|^|#|' /etc/fstab
sudo systemctl daemon-reload
