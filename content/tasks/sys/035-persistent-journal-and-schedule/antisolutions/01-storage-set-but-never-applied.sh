#!/usr/bin/env bash
# The most common real journald mistake: Storage=persistent is written down and
# nothing is done about it. journald is still running with the old settings, so
# it is still writing to /run/log/journal, and `journalctl` looks completely
# healthy because it merges the runtime journal with the (empty, absent)
# persistent one. Nothing warns you. The next reboot is the first sign.
#
# The two verdicts see different things, which is why the phases differ:
#   journal-persistent is wrong right now - there is not a byte under
#   /var/log/journal - but it repairs ITSELF at the reboot, because journald
#   starts with Storage=persistent and creates the directory. So it fails in
#   verdict A and passes in verdict B: @pre.
#   journal-history is wrong in both. In verdict A nothing is on disk; in
#   verdict B the disk holds this boot only, and the boot that mattered - the
#   one the report was taken from - went away with /run. That is the failure the
#   whole task is about, and it is invisible until the machine comes back.
#
# Everything else here is deliberately correct, so a green cron half proves the
# grader is looking at the journal rather than failing the fixture wholesale.
# expect-fail: journal-persistent@pre, journal-history
set -euo pipefail

OUT=/var/log/rhcsa-audit/journal-errors.log

sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=persistent\n' \
  | sudo tee /etc/systemd/journald.conf.d/99-rhcsa-persistent.conf >/dev/null
# NO restart of systemd-journald, NO journalctl --flush, NO mkdir
# /var/log/journal. That omission is the whole point of this fixture.

sudo systemctl enable --now crond
printf '30 23 * * * sudo journalctl -b -p err --no-pager > %s\n' "$OUT" | crontab -
sudo journalctl -b -p err --no-pager > "$OUT"
