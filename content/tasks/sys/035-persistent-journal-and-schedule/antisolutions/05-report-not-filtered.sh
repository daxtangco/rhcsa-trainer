#!/usr/bin/env bash
# The report is the whole journal. Everything else is right: the journal is
# persistent, crond is enabled, the entry is in student's crontab at 23:30, and
# the file exists and is far from empty - it is just not an error report.
#
# This is the fixture that proves extract-filtered grades the FILTER rather than
# the existence of a file. setup.sh logged one message at err priority and one at
# info, and proved before the student started that a priority filter sees the
# first and not the second; an unfiltered capture holds both, so the info marker
# turning up in the report is the detection.
#
# A capture filtered on the rhcsa-audit tag instead of on priority fails the same
# way, for the same reason - both messages carry that tag.
# expect-fail: extract-filtered
set -euo pipefail

OUT=/var/log/rhcsa-audit/journal-errors.log

sudo mkdir -p /var/log/journal
sudo systemd-tmpfiles --create --prefix /var/log/journal || true
sudo journalctl --flush
sudo systemctl enable --now crond

# No -p. Both the crontab entry and the run-by-hand report have the same defect,
# so the schedule checkpoints still pass and only the content fails.
printf '30 23 * * * sudo journalctl -b --no-pager > %s\n' "$OUT" | crontab -
sudo journalctl -b --no-pager > "$OUT"
