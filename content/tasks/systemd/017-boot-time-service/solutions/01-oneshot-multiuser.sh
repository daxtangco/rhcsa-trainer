#!/usr/bin/env bash
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
sudo systemctl enable --now rhcsa-stamp.service
