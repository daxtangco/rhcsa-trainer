#!/usr/bin/env bash
# Route 1, and the one the book teaches: never touch journald.conf at all.
#
# Storage=auto - the RHEL 9 default - means "use /var/log/journal if it exists,
# otherwise /run". So creating the directory and asking journald to flush is a
# complete answer, and the grader must accept it without a single line of
# configuration having changed. Three things here are deliberately different from
# solutions/02: the journal route (directory vs Storage=), the cron route (this
# user's own crontab vs /etc/cron.d) and the command shape (an inline redirect vs
# a wrapper script).
#
# A fourth difference used to be claimed here and is gone on purpose: this file
# flushed while solutions/02 only restarted journald. That was not a second
# correct route, it was a bug - measured on RHEL 9.8, a restart alone leaves
# journald writing to /run, because the switch is the /run/systemd/journal/flushed
# flag and only a flush creates it. Both solutions now flush. The flush is not an
# axis on which two correct answers can differ, and listing it as one is how the
# next author talks themselves into removing it again.
set -euo pipefail

OUT=/var/log/rhcsa-audit/journal-errors.log

# The journal. `-p` so a second run is not an error.
sudo mkdir -p /var/log/journal
# Cosmetic, and it is what the documented recipe does: it applies the
# tmpfiles.d line that owns this path (root:systemd-journal, mode 2755) so the
# directory looks like one journald created. journald sets what it needs when it
# opens the directory either way, so an unrelated tmpfiles line failing must not
# abort this fixture.
sudo systemd-tmpfiles --create --prefix /var/log/journal || true
# The step people forget. Until journald is told, it keeps writing to
# /run/log/journal and everything logged so far stays there - so this is what
# moves the current boot onto the disk. It blocks until the flush is done, which
# is why nothing here has to sleep.
sudo journalctl --flush

# The scheduler: running now AND after the next reboot.
sudo systemctl enable --now crond

# The schedule, in student's own crontab: five fields, because a per-user
# crontab has no user column.
printf '30 23 * * * sudo journalctl -b -p err --no-pager > %s\n' "$OUT" | crontab -

# The report the ticket wants in hand now rather than at 23:30. sudo runs
# journalctl; the redirect is performed by this shell as student, into the
# directory setup.sh made student the owner of.
sudo journalctl -b -p err --no-pager > "$OUT"
