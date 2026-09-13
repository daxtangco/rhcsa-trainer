#!/usr/bin/env bash
# The five-field/six-field mistake, in the direction that fails silently: a line
# written for a personal crontab, dropped into /etc/cron.d.
#
# /etc/cron.d entries carry a user column between the schedule and the command.
# With it missing, crond reads `journalctl` as the username, finds no such user
# and never runs the job - and it says so only in its own log, which nobody
# reads until the report is missing. Nothing about this file looks wrong.
#
# Both cron checkpoints fail, and that is honest rather than sloppy: the grader
# tests the schedule OF THE ENTRY THAT RUNS AS STUDENT, so an entry with no
# valid user has no schedule to accept. Grading the two independently would pass
# a machine where student has an entry at the wrong time and root has one at
# 23:30 - two wrong answers adding up to green.
# expect-fail: cron-user, cron-schedule
set -euo pipefail

OUT=/var/log/rhcsa-audit/journal-errors.log

# Journal and scheduler, both done properly.
sudo mkdir -p /var/log/journal
sudo systemd-tmpfiles --create --prefix /var/log/journal || true
sudo journalctl --flush
sudo systemctl enable --now crond

# Five fields in a six-field file. No student crontab is installed anywhere, so
# this is the only entry the grader can find.
printf '30 23 * * * journalctl -b -p err --no-pager > %s\n' "$OUT" \
  | sudo tee /etc/cron.d/rhcsa-journal-audit >/dev/null
sudo chmod 0644 /etc/cron.d/rhcsa-journal-audit

# The report itself is produced by hand and is perfectly correct, which is what
# makes this fixture nasty: everything visible today is right.
sudo journalctl -b -p err --no-pager > "$OUT"
