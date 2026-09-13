#!/usr/bin/env bash
# Route 1: a quadlet .container file, which is what Red Hat documents for RHEL 9
# and what podman 5 generates units from at every daemon-reload and every boot.
#
# Note what is NOT here: no `systemctl --user enable`. Quadlet units are produced
# by a generator, so there is nothing to enable - `[Install] WantedBy=` inside
# the .container file is what puts the generated service in default.target's
# wants, and `systemctl --user is-enabled` reports it as `generated`, never
# `enabled`. A grader that looked for an "enabled" symlink would reject this
# perfectly correct answer, which is exactly why unit-boot-wanted does not.
set -euo pipefail

# `ssh host bash -s` is a non-login shell, and every systemctl --user call needs
# the user bus this points at.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

mkdir -p "$HOME/.config/containers/systemd"
cat > "$HOME/.config/containers/systemd/webcontent.container" <<'EOF'
[Unit]
Description=Static site served from /srv/webcontent

[Container]
Image=registry.access.redhat.com/ubi9/httpd-24
PublishPort=8080:8080
# :Z is the whole SELinux answer. podman relabels the source path to
# container_file_t with a private MCS category, and it does it again on every
# start - including the one systemd performs at boot.
Volume=/srv/webcontent:/var/www/html:Z

[Install]
WantedBy=default.target
EOF

# Without this the user manager exists only while a session does, so everything
# above would be undone at logout and nothing would come back after a reboot.
sudo loginctl enable-linger "$(id -un)"

# daemon-reload is what runs quadlet over the directory above and turns
# webcontent.container into webcontent.service.
systemctl --user daemon-reload
systemctl --user start webcontent.service
