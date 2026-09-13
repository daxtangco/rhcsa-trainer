#!/usr/bin/env bash
# The schedule is wrong: this runs at half past every hour, not at 23:30. It is
# what "30 23" turns into when only the first field is filled in, and it is the
# shape a grader that merely checked "an entry exists for student" would accept.
#
# The entry is in the right crontab and runs the right command, so cron-user
# passes here. That is the point of a second cron fixture: without it, a grader
# that failed cron-user unconditionally would look correct against
# antisolutions/03 alone.
# expect-fail: cron-schedule
set -euo pipefail

OUT=/var/log/rhcsa-audit/journal-errors.log

# Journal and scheduler, both done properly.
sudo mkdir -p /var/log/journal
sudo systemd-tmpfiles --create --prefix /var/log/journal || true
sudo journalctl --flush
sudo systemctl enable --now crond

# minute 30 of every hour. crontab accepts it happily - it is valid cron, just
# not the job that was asked for.
printf '30 * * * * sudo journalctl -b -p err --no-pager > %s\n' "$OUT" | crontab -

sudo journalctl -b -p err --no-pager > "$OUT"
