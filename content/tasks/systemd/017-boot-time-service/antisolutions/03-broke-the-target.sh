#!/usr/bin/env bash
# Did the service correctly and then changed the default target it was never
# asked to change. default-target is an invariant, so this is the fixture that
# proves invariants are actually evaluated.
#
# Safe on a Server install: graphical.target pulls in multi-user.target and,
# with no display manager present, the machine still ends at a text login and
# stays reachable over ssh. That is why it was chosen over anything involving
# rescue.target - it is the mildest available way to break an invariant.
# expect-fail: default-target
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
sudo systemctl set-default graphical.target
