#!/usr/bin/env bash
# Did the target half perfectly and read the second half as one instruction instead
# of two: cancelled the pending reboot and never asked what put it there.
#
# This is the fixture that makes the reboot worth its cost. In verdict A the
# machine is indistinguishable from a correct answer - nothing is scheduled, and
# `shutdown --show` agrees. rearm-unit-disabled is the only checkpoint that catches
# it before the reboot; after the reboot the unit has re-armed and
# no-reboot-pending flips from green to red, which is the same defect stated twice
# and is the point.
# expect-fail: rearm-unit-disabled, no-reboot-pending@post
set -euo pipefail
sudo grubby --update-kernel=ALL --args=systemd.unit=graphical.target
sudo shutdown -c
sudo systemctl isolate graphical.target
