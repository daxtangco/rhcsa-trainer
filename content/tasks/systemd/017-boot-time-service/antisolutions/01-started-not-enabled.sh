#!/usr/bin/env bash
# The unit is perfect and it was started by hand. Everything looks right in
# systemctl status. Nothing survives the reboot.
# expect-fail: stamp-enabled, stamp-effect@post
set -euo pipefail
sudo tee /etc/systemd/system/rhcsa-stamp.service >/dev/null <<'EOF'
[Unit]
Description=Write a boot stamp to /run

[Service]
Type=oneshot
ExecStart=/usr/local/bin/rhcsa-stamp
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl start rhcsa-stamp.service
