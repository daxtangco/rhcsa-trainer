#!/usr/bin/env bash
# The four commands, in the order a candidate should think about them: pin the next
# boot, clear what is pending, stop the thing that puts it back, then move the
# running system.
#
# --update-kernel=ALL is what "every kernel entry may carry it; the one that boots
# by default must" is asking for, and it is also the only spelling that survives a
# kernel update: grubby writes the argument into every BLS entry, into grubenv's
# kernelopts and into /etc/kernel/cmdline.
#
# The isolate is last on purpose. It is the only command here that changes what is
# running rather than what is written down, so the two files on disk are already
# correct before the running system is touched.
set -euo pipefail
sudo grubby --update-kernel=ALL --args=systemd.unit=graphical.target
sudo shutdown -c
sudo systemctl disable rhcsa-maintenance-window.service
sudo systemctl isolate graphical.target
