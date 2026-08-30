#!/usr/bin/env bash
# Independent: Type=simple instead of oneshot, wanted by sysinit.target instead
# of multi-user.target, and enabled with `systemctl enable` plus a separate
# start rather than `enable --now`. All correct - the unit still runs once at
# every boot - and it fails any grader that diffs the unit file against an
# expected text.
set -euo pipefail
sudo tee /etc/systemd/system/rhcsa-stamp.service >/dev/null <<'EOF'
[Unit]
Description=Boot stamp
DefaultDependencies=no
After=local-fs.target
Requires=local-fs.target

[Service]
Type=simple
ExecStart=/usr/local/bin/rhcsa-stamp

[Install]
WantedBy=sysinit.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable rhcsa-stamp.service
sudo systemctl start rhcsa-stamp.service
