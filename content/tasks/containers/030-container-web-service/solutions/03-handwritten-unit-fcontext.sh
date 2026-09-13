#!/usr/bin/env bash
# Route 3: an ordinary hand-written user unit, plus the SELinux label written
# into policy with semanage instead of applied by podman's :Z.
#
# This is the fixture that proves the grader measures end states rather than
# commands. Everything here is different from both other solutions:
#
#   - no quadlet, no `podman generate systemd`: a unit somebody typed
#   - `podman run` in the foreground under Type=simple (the default), so systemd
#     supervises podman itself rather than a detached container
#   - no :Z anywhere. `semanage fcontext` + `restorecon` reaches the same label
#     by the route selinux/019 teaches, and it survives a full relabel, which :Z
#     does not - so selinux-label must accept it or the card in
#     content/concepts/selinux is teaching something the bank rejects.
set -euo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# The policy rule first, then the relabel it describes. Without the restorecon
# the rule changes what a future relabel would do and nothing about the inodes,
# which is the single most common SELinux mistake.
sudo semanage fcontext -a -t container_file_t '/srv/webcontent(/.*)?'
sudo restorecon -R /srv/webcontent

mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/websvc.service" <<'EOF'
[Unit]
Description=Static site served from /srv/webcontent

[Service]
Restart=on-failure
# -/usr/bin/... : a leading dash tells systemd to ignore a non-zero exit, which
# is what makes this unit restartable when no container named websvc exists yet.
ExecStartPre=-/usr/bin/podman rm -f websvc
ExecStart=/usr/bin/podman run --name websvc --rm -p 8080:8080 -v /srv/webcontent:/var/www/html registry.access.redhat.com/ubi9/httpd-24
ExecStop=/usr/bin/podman stop -t 10 websvc

[Install]
WantedBy=default.target
EOF

sudo loginctl enable-linger "$(id -un)"

systemctl --user daemon-reload
systemctl --user enable --now websvc.service
