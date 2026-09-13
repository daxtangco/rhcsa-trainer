#!/usr/bin/env bash
# The mistake this task exists for. Byte-for-byte solution 01 with one line
# inverted: the quadlet unit is correct, the container is serving, the label is
# right - and student has no lingering, so user@1000 lives only as long as a
# login session does. Log out and the site is gone; boot the machine with nobody
# logged in and it never comes up.
#
# Only linger-enabled fails, and it fails in both verdicts. Everything else stays
# green, which is precisely the trap:
#
#   - verdict A is green apart from linger because the fixture's own session
#     started the unit.
#   - verdict B is green apart from linger because the GRADER'S OWN SSH LOGIN
#     starts user@1000, which reaches default.target, which starts the enabled
#     unit. The site really is serving when the post-reboot probes run.
#
# So page-served@post cannot detect this and must not be declared here. A grader
# that inferred lingering from "did it come back after the reboot" would pass
# this fixture, and the student would find out on exam day. That is the entire
# argument for measuring the linger flag directly.
# expect-fail: linger-enabled
set -euo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

mkdir -p "$HOME/.config/containers/systemd"
cat > "$HOME/.config/containers/systemd/webcontent.container" <<'EOF'
[Unit]
Description=Static site served from /srv/webcontent

[Container]
Image=registry.access.redhat.com/ubi9/httpd-24
PublishPort=8080:8080
Volume=/srv/webcontent:/var/www/html:Z

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user start webcontent.service

# setup.sh already leaves lingering off, and this is here anyway: a fixture that
# depends on setup's teardown order to express its own mistake is a fixture that
# stops detecting anything the day that order changes. Both mechanisms, because
# logind reports the file as Linger=yes just as readily as its own state.
sudo loginctl disable-linger "$(id -un)"
sudo rm -f "/var/lib/systemd/linger/$(id -un)"
