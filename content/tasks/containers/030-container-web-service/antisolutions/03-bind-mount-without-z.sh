#!/usr/bin/env bash
# The SELinux mistake: everything about systemd is right - a user unit, enabled
# into default.target, lingering on - and the bind mount carries no :Z, so
# /srv/webcontent is still var_t and the confined container is denied read on the
# files it is supposed to publish. Apache answers with a 403 instead of the page.
#
# page-served and selinux-label fail in both verdicts. Nothing else does, and the
# fixture is written so that stays true whatever the container does with itself:
#
#   - no --rm and no ExecStartPre removal, so the container object is created
#     once and never disappears. rootless-owner and content-mounted read
#     configuration, so they answer the same before and after the reboot whether
#     httpd is running, exited, or was never able to start.
#   - Restart=no, so there is no window in which systemd has removed the
#     container and not yet recreated it.
#   - after the reboot the unit runs `podman run --name websvc` again and fails
#     on the name still being in use. That is expected and changes nothing this
#     fixture declares: the container is still there, the page is still not
#     served, and the unit is still wanted by default.target.
# expect-fail: page-served, selinux-label
set -euo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/websvc.service" <<'EOF'
[Unit]
Description=Static site served from /srv/webcontent

[Service]
Restart=no
ExecStart=/usr/bin/podman run --name websvc -p 8080:8080 -v /srv/webcontent:/var/www/html registry.access.redhat.com/ubi9/httpd-24

[Install]
WantedBy=default.target
EOF

sudo loginctl enable-linger "$(id -un)"

systemctl --user daemon-reload
# enable must succeed: unit-boot-wanted is declared to PASS here, so a silent
# failure to enable would turn this into a two-fault fixture that no longer
# isolates the SELinux mistake.
systemctl --user enable websvc.service
# start may not. Type=simple reports success as soon as podman is forked, so this
# ordinarily returns 0 even though the container cannot serve - but the whole
# point of this fixture is a container that misbehaves, and harness.ts aborts on
# a fixture that exits non-zero. Saying so explicitly is the documented way to
# model a command that is allowed to fail.
systemctl --user start websvc.service || true
