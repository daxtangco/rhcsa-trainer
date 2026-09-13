#!/usr/bin/env bash
# The classic: isolated the target and stopped, because `systemctl is-active
# graphical.target` said active and that looked like the job done. Nothing was
# written down anywhere, so the next boot is the boot this machine always had.
#
# graphical-target-active is green in verdict A and red in verdict B, and no other
# checkpoint changes. This is the "now versus next boot" split that the whole task
# is built around, and it is the reason boot-arg-pinned exists as a separate
# checkpoint instead of being folded into the one that reads the running system.
# expect-fail: boot-arg-pinned, graphical-target-active@post
set -euo pipefail
sudo shutdown -c
sudo systemctl disable rhcsa-maintenance-window.service
sudo systemctl isolate graphical.target
