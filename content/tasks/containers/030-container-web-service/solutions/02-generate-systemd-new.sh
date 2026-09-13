#!/usr/bin/env bash
# Route 2: `podman generate systemd --new`, the pre-quadlet mechanism. Still
# shipped in podman 5 (it prints a deprecation notice on stderr, which is
# harmless), still taught by the RHCSA 9 material, and deliberately different
# from solution 01 in four ways a careless grader would trip over:
#
#   - the unit is a real file under ~/.config/systemd/user, not generator output
#   - it IS enabled, with a symlink in default.target.wants
#   - the unit name is container-websvc.service, matching nothing about the
#     content directory or the image
#   - lingering is turned on by the user's own `loginctl enable-linger`, with no
#     user argument and no sudo, rather than by the admin form
set -euo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# `create`, not `run`: --new makes the unit recreate the container from this
# configuration at every start, so this container object exists only to be read
# by the generator below. The :Z relabel therefore happens when the *unit* first
# runs podman, not here.
podman create --name websvc \
  -p 8080:8080 \
  -v /srv/webcontent:/var/www/html:Z \
  registry.access.redhat.com/ubi9/httpd-24 >/dev/null

mkdir -p "$HOME/.config/systemd/user"
podman generate systemd --new --name websvc \
  > "$HOME/.config/systemd/user/container-websvc.service"

# The template is written; the container it was read from would only collide
# with the one the unit creates.
podman rm -f websvc >/dev/null

# The self form, which is what a student types. It needs polkit's allow_active
# for org.freedesktop.login1.set-self-linger; logind reports an ssh session as
# active, so it works with no TTY. The admin form is the fallback rather than the
# default here on purpose: the two are the same end state, and linger-enabled
# accepts either, which is the point of testing this route at all.
loginctl enable-linger || sudo loginctl enable-linger "$(id -un)"

systemctl --user daemon-reload
systemctl --user enable --now container-websvc.service
