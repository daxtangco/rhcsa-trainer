#!/usr/bin/env bash
# Correct tonight, gone on Monday: crond was started and never enabled. This is
# the persistence signature the reboot check exists to detect, in the scheduler
# rather than in the journal.
#
# crond-enabled is wrong immediately - there is no symlink in /etc for it. Being
# `active` right now is not evidence of anything, so crond-active only breaks
# after the reboot, which is why one phase per file would not be enough to
# express this fixture (the same shape as storage/014's
# antisolutions/02-removed-persistence.sh).
# expect-fail: crond-enabled, crond-active@post
set -euo pipefail

OUT=/var/log/rhcsa-audit/journal-errors.log

# The journal half, done properly (solutions/01's route), so the failure is
# unambiguous.
sudo mkdir -p /var/log/journal
sudo systemd-tmpfiles --create --prefix /var/log/journal || true
sudo journalctl --flush

# The mistake. `start` and nothing else: no [Install] symlink is created, so
# nothing pulls crond in at the next boot.
sudo systemctl start crond

printf '30 23 * * * sudo journalctl -b -p err --no-pager > %s\n' "$OUT" | crontab -
sudo journalctl -b -p err --no-pager > "$OUT"
