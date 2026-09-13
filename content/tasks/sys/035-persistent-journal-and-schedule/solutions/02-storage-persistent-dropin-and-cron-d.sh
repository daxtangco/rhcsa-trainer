#!/usr/bin/env bash
# Route 2, equally correct, and different from solutions/01 in every choice it
# makes:
#   - Storage=persistent in a journald.conf.d drop-in instead of creating
#     /var/log/journal by hand.
#   - a journald restart *and* an explicit journalctl --flush, where solutions/01
#     needs only the flush.
#   - /etc/cron.d instead of student's own crontab, which means SIX fields
#     because a system crontab carries a user column.
#   - a wrapper script, so the cron command line mentions neither journalctl nor
#     the report path. A grader that grepped the crontab for "journalctl" would
#     wrongly reject this, which is exactly the over-fitting risk R4 names.
set -euo pipefail

OUT=/var/log/rhcsa-audit/journal-errors.log
WRAPPER=/usr/local/bin/rhcsa-journal-audit

# The journal, by configuration.
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=persistent\n' \
  | sudo tee /etc/systemd/journald.conf.d/99-rhcsa-persistent.conf >/dev/null
sudo systemctl restart systemd-journald

# The restart is what makes journald *read* Storage=persistent, and the flush is
# what makes it act on it. Both are needed and this file used to have only the
# first, which is why it was the one fixture in the bank that failed: it claimed
# "under that setting journald creates the directory itself", and on RHEL 9.8 that
# is false.
#
# Measured on the guest. The real switch is the flag file
# /run/systemd/journal/flushed: journald writes to /var/log/journal only once that
# exists, `journalctl --flush` is what creates it, and a restart never does. So
# with the flag absent, drop-in + restart leaves /var/log/journal not merely empty
# but *absent*, and journald keeps logging to /run - 0 journal files after a
# logger call and 10s of polling. Issue the flush and the directory and two
# journal files appear at once.
#
# And the flag is absent on a stock guest, which is why this failed here rather
# than only in theory. Measured on the lab VM: systemd-journal-flush.service ran
# at boot, its ExecStart *is* `journalctl --flush`, it reports Result=success -
# and /run/systemd/journal/flushed still does not exist, because with Storage=auto
# and no /var/log/journal a flush has nowhere to go and so creates nothing. The
# flag only survives on a machine where persistence was already configured before
# the last boot, which is exactly the machine an author tests on after fixing it
# once. That is what makes restart-only treacherous: it starts passing on your box
# at the point you stop suspecting it. The flush makes the outcome independent of
# the flag either way.
sudo journalctl --flush

# journald opens the on-disk journal the first time it has something to write
# there, so give it something and then wait for the file to appear. Without this
# the fixture could be graded in the sliver of time before the first journal
# file exists - a flaky green, or worse a flaky red on a correct answer.
logger -t rhcsa-solution "journal persistence enabled via Storage=persistent"
for _ in $(seq 1 20); do
  # Command substitution, not `| grep -q .`: pipefail turns grep -q's SIGPIPE kill
  # of find into 141, so the loop would never see the file it is waiting for.
  if [[ -n $(sudo find /var/log/journal -maxdepth 3 -type f -name '*.journal' 2>/dev/null) ]]; then
    break
  fi
  sleep 0.5
done

# The scheduler. Split in two on purpose: enable is the half that survives the
# reboot, start is the half that does not, and this file uses both rather than
# --now so the distinction stays visible.
sudo systemctl enable crond
sudo systemctl start crond

# The capture, wrapped. Doing the redirect inside the script keeps the crontab
# line short, which is why real sysadmins write it this way.
sudo tee "$WRAPPER" >/dev/null <<'EOF'
#!/usr/bin/env bash
# Nightly journal error report for auditing.
set -euo pipefail
sudo journalctl -b -p err --no-pager > /var/log/rhcsa-audit/journal-errors.log
EOF
sudo chmod 0755 "$WRAPPER"
# SELinux is Enforcing: a file created under /usr/local/bin inherits bin_t from
# its parent, so this only guarantees what is already true. Same habit as
# systemd/017's setup.
sudo restorecon "$WRAPPER"

# Six fields: minute hour day-of-month month day-of-week USER command.
printf '30 23 * * * student %s\n' "$WRAPPER" \
  | sudo tee /etc/cron.d/rhcsa-journal-audit >/dev/null
sudo chmod 0644 /etc/cron.d/rhcsa-journal-audit

# Hand over a report that already exists, by running exactly what cron will run.
"$WRAPPER"
