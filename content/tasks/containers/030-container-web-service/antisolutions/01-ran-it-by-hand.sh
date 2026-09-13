#!/usr/bin/env bash
# The answer that demos perfectly: the site is up, the label is right, lingering
# is even on - and there is no unit, so nothing brings it back.
#
# unit-boot-wanted is wrong immediately. page-served is right until the reboot,
# because the container really is serving; after the reboot the container is
# sitting there stopped and nothing starts it. That split is why this task's
# fixtures need per-checkpoint phases and not one verdict per file.
#
# rootless-owner and content-mounted deliberately stay green in BOTH verdicts.
# There is no --rm here, so the container object survives the reboot in the
# `exited` state, and both checkpoints read configuration rather than state -
# this fixture is a detector for "no unit", not for "no container".
#
# Lingering is turned on on purpose, even though this answer is wrong. A fixture
# that got two things wrong at once could not tell which one the grader noticed.
# expect-fail: unit-boot-wanted, page-served@post
set -euo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

sudo loginctl enable-linger "$(id -un)"

podman run -d --name websvc \
  -p 8080:8080 \
  -v /srv/webcontent:/var/www/html:Z \
  registry.access.redhat.com/ubi9/httpd-24 >/dev/null
