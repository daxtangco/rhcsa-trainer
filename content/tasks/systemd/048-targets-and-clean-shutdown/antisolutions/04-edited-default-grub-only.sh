#!/usr/bin/env bash
# Put the argument in /etc/default/grub, which is where a decade of documentation
# says kernel arguments live, and which on a BLS system is not where the boot
# loader reads them from.
#
# GRUB_CMDLINE_LINUX only ever reaches an entry that is *generated* from it. The
# entries in /boot/loader/entries already exist and carry their own `options` line,
# and grub.cfg reads them through the blscfg module - so this file changes what a
# future entry would inherit and nothing about the next boot. Note that running
# `grub2-mkconfig -o /boot/grub2/grub.cfg` afterwards would not have rescued it
# either: grub2-mkconfig exports GRUB_UPDATE_BLS_CMDLINE="yes" and then sets it
# back to "no" whenever GRUB_ENABLE_BLSCFG=true and bls_cmdline_update is not
# true, which is stock RHEL 9 (/usr/sbin/grub2-mkconfig, and the guard at
# /etc/grub.d/10_linux:271 that decides whether update_bls_cmdline runs at all).
# This fixture deliberately stops before that command rather than regenerating the
# boot loader configuration of the guest the whole bank is graded on - the
# concept card carries the grub2-mkconfig half in prose instead.
#
# The failure signature is identical to antisolutions/03, which is the honest
# result: as far as the machine is concerned, nothing was configured.
# expect-fail: boot-arg-pinned, graphical-target-active@post
set -euo pipefail
sudo sed -i -e 's/^GRUB_CMDLINE_LINUX="\(.*\)"$/GRUB_CMDLINE_LINUX="\1 systemd.unit=graphical.target"/' /etc/default/grub
sudo shutdown -c
sudo systemctl disable rhcsa-maintenance-window.service
sudo systemctl isolate graphical.target
