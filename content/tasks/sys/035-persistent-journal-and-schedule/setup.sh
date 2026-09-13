#!/usr/bin/env bash
# Prepare the system for sys/035-persistent-journal-and-schedule.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell.
#
# `set -uo pipefail` without -e, following
# content/tasks/systemd/017-boot-time-service/setup.sh rather than 014's
# `set -euo pipefail`: this file is full of idempotent removals that
# legitimately fail on a first run (there is no crontab to delete, no report to
# remove). Do not "harmonise" the two. The commands that MUST work are wrapped
# in `need` instead, because a silent failure here stages the wrong machine and
# every checkpoint result afterwards is a lie.
set -uo pipefail

need() { "$@" || { printf 'setup.sh: FAILED: %s\n' "$*" >&2; exit 1; }; }
fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

# `producer | grep -q` is a trap under `set -o pipefail`, and this file used to
# fall into it three times. grep -q exits the instant it matches, the producer
# is killed by SIGPIPE, and pipefail reports the pipeline as 141 - a FAILURE for
# a search that actually SUCCEEDED. It only bites when the match sits further
# from the end of the stream than one 64 KiB pipe buffer, so it hides on small
# outputs and fires every time on a full journal: measured PIPESTATUS=141 0
# against a journal holding the marker. Every journal probe below goes through
# this helper, which drops -q so grep always reads to EOF.
jhas() { local pat=$1; shift; sudo journalctl "$@" --no-pager 2>/dev/null | grep -F -- "$pat" >/dev/null; }

TARGET_USER=student
OUT_DIR=/var/log/rhcsa-audit
OUT=$OUT_DIR/journal-errors.log
PERSIST_DIR=/var/log/journal
STAMP_DIR=/var/lib/rhcsa-lab
STAMP=$STAMP_DIR/035-setup-boot-id
# The pair of messages extract-filtered is graded on. Spelled identically in
# grade.sh; if these two strings ever disagree the filter checkpoint becomes
# unsatisfiable for every answer, which is why the checks at the bottom of this
# file prove both markers behave before the student is let anywhere near them.
MARK_ERR=RHCSA035-ERR-9d41
MARK_INFO=RHCSA035-INFO-9d41

# --- preconditions this script itself needs -------------------------------
id "$TARGET_USER" &>/dev/null \
  || fail "user $TARGET_USER does not exist, and cron-user grades the schedule against that exact account"

# cronie is installed on the lab guest (docs/vm-build-checklist.md). Without
# crond.service the task is unsolvable and crond-enabled/crond-active would
# fail for every fixture including both solutions, with the failure pointing at
# the student instead of at the image.
systemctl cat crond.service &>/dev/null \
  || fail "crond.service does not exist; install cronie from the rhcsa-appstream DVD repo"

# --- undo what a previous attempt can safely leave behind -----------------
# The harness reverts to a snapshot before every fixture, so this block is for
# the human who re-runs setup by hand on a machine they have been poking at.
sudo rm -f "$OUT"
# Removes student's crontab if there is one; exits 1 with "no crontab for
# student" when there is not, which is why this file does not use `set -e`.
sudo crontab -r -u "$TARGET_USER" &>/dev/null
# Both fixture-authored paths, named here so a hand-run setup after a fixture
# leaves no cron entry the grader would count.
sudo rm -f /etc/cron.d/rhcsa-journal-audit /usr/local/bin/rhcsa-journal-audit

# --- create the situation the prompt describes ----------------------------
# "The task scheduler is switched off." This is the believable half of the
# ticket and it is also what makes crond-enabled and crond-active fail at
# baseline: on a stock RHEL 9 install crond is enabled and running, so without
# this the student would be graded on two checkpoints that were already green.
sudo systemctl disable --now crond &>/dev/null

need sudo mkdir -p "$OUT_DIR"
# Owned by the account the schedule runs as, because a cron job that cannot
# write its output file is a task nobody can complete. Not chown'd to
# student:student - the per-user group is conventional but not guaranteed, and
# only the owner matters here.
need sudo chown "$TARGET_USER" "$OUT_DIR"
need sudo chmod 0755 "$OUT_DIR"
# SELinux is Enforcing on this guest. A directory created under /var/log
# inherits var_log_t from its parent, so this is belt and braces rather than a
# fix - and it is cheap insurance against a guest where /var/log was relabelled
# by hand, which would leave a cron job unable to write and no visible reason.
need sudo restorecon -R "$OUT_DIR"

# The err/info pair extract-filtered is graded on. Logged WITHOUT sudo on
# purpose: they land in the journal as student's own entries, so `journalctl -p
# err` finds them whether the student runs it privileged or not. Running them
# through sudo would also make sudo log the marker text itself as part of its
# authpriv record, and a second copy of the info marker in the journal is one
# more way for a correct filter to look wrong.
logger -p user.err  -t rhcsa-audit "$MARK_ERR nightly audit probe (err)"
logger -p user.info -t rhcsa-audit "$MARK_INFO nightly audit probe (info)"

# The boot journald is running in right now. journal-history is graded against
# this value: before the reboot it asks "did this boot reach the disk", after
# the reboot it asks "is the boot before this one still readable". One stamp,
# one probe, two meanings - which is the whole reason this task sets
# reboot_check: true.
need sudo mkdir -p "$STAMP_DIR"
boot_id=$(tr -dc '0-9a-f' < /proc/sys/kernel/random/boot_id)
[[ ${#boot_id} -eq 32 ]] \
  || fail "read a ${#boot_id}-character boot id from /proc/sys/kernel/random/boot_id, expected 32 hex digits"
printf '%s\n' "$boot_id" | sudo tee "$STAMP" >/dev/null
need sudo chmod 0644 "$STAMP"
# Read it back the way grade.sh reads it. The grader fails every checkpoint
# closed when this value is not 32 hex digits, so a stamp that did not land is
# a task nobody can pass - better to say so here than to hand the student a
# grader that fails for a reason they cannot see.
stamp_back=$(cat "$STAMP" 2>/dev/null | tr -dc '0-9a-f')
[[ $stamp_back == "$boot_id" ]] \
  || fail "$STAMP reads back as '${stamp_back:-empty}', not $boot_id; grade.sh fails closed on that and no answer could pass"

# --- verify every precondition the checkpoints depend on ------------------
# Not merely the ones this script needs: a precondition that only guards the
# script leaves the checkpoints free to pass or fail for reasons that have
# nothing to do with the student, which is a student-facing false pass and not
# a solved task. One block per checkpoint, in grade.sh's order.

# journal-persistent and journal-history: nothing may be on disk yet. If
# journald has already flushed to /var/log/journal then both checkpoints are
# green before the student types anything.
#
# Deliberately verified and NOT repaired. Un-persisting a journal means
# deleting /var/log/journal underneath a running journald, which leaves it
# writing to an unlinked inode until something restarts it - a worse machine
# than the one we started with. The remedy is the snapshot revert, so say so.
# Command substitution rather than `| grep -q .` for the same SIGPIPE reason as
# jhas: on a guest with enough journal files to fill a pipe buffer, grep -q would
# match the first path, pipefail would report 141, and this guard would let a
# machine through that already has journal-persistent and journal-history green.
if [[ -n $(sudo find "$PERSIST_DIR" -maxdepth 3 -type f -name '*.journal' 2>/dev/null) ]]; then
  fail "$PERSIST_DIR already holds journal files, so journal-persistent and journal-history would pass at baseline; reset the lab (snapshot revert) rather than re-running setup"
fi

# The other half of the same precondition, and the half that only bites in
# verdict B. If Storage=persistent is already set anywhere journald reads,
# journald creates $PERSIST_DIR by itself at the next boot - so
# journal-persistent would fail in verdict A, pass in verdict B, and the
# baseline expectation (fail in both) would be wrong for reasons invisible
# before the reboot. systemd-analyze cat-config is used because it merges
# /etc/systemd/journald.conf with the /etc/systemd/journald.conf.d drop-ins,
# which is where a student is told to put this and where a leftover would hide.
# The last assignment wins, matching how systemd itself reads the merged text.
storage=$(sudo systemd-analyze cat-config systemd/journald.conf 2>/dev/null \
  | awk -F= '/^[[:space:]]*Storage[[:space:]]*=/ { v = $2; gsub(/[[:space:]]/, "", v) } END { print v }')
case ${storage:-auto} in
  '' | auto) ;;
  *)
    # volatile and none are as wrong as persistent here, in the other
    # direction: they make the task unsolvable by the routes the concept card
    # teaches, and every fixture would fail on journal-persistent.
    fail "journald's effective Storage is '$storage', not the stock auto; reset the lab (snapshot revert)"
    ;;
esac

# crond-enabled and crond-active: prove the disable above actually took, with
# the same anchored probes grade.sh uses. On the bare exit status of
# `systemctl is-enabled` this check would accept static, indirect, generated,
# alias and enabled-runtime while the grader rejects them, and a guest staged
# that way hands the student two checkpoints that were already green.
en=$(systemctl is-enabled crond 2>&1)
if printf '%s' "$en" | grep -qx enabled; then
  fail "crond is still enabled (is-enabled=$en) after the disable; crond-enabled would pass at baseline"
fi
act=$(systemctl is-active crond 2>&1)
if printf '%s' "$act" | grep -qx active; then
  fail "crond is still running (is-active=$act) after the stop; crond-active would pass at baseline"
fi

# cron-user and cron-schedule: no cron entry anywhere may already capture the
# journal. Checked by content rather than by filename, because a leftover from
# a previous attempt can live in any of the four places cron reads from and
# this script only knows the names its own fixtures use.
if [[ -n $(sudo grep -rlsF -e journalctl -e "$OUT" /etc/crontab /etc/cron.d /var/spool/cron 2>/dev/null) ]]; then
  fail "a cron entry already mentions journalctl or $OUT, so cron-user/cron-schedule could pass at baseline; reset the lab (snapshot revert)"
fi

# extract-file and extract-filtered: the report must not exist yet, and the
# account that has to write it must be able to.
[[ ! -e $OUT ]] || fail "$OUT survived the rm; extract-file would pass at baseline"
need touch "$OUT_DIR/.rhcsa-write-probe"
need rm -f "$OUT_DIR/.rhcsa-write-probe"

# extract-filtered rests entirely on the two markers behaving, so all three
# halves of that are proved here rather than assumed. Without this a broken
# marker would fail the checkpoint for every fixture including both solutions,
# and the failure would point at the student's filter.
#
# logger hands the message to journald over a socket and returns; the entry is
# indexed a moment later. Poll rather than sleep once, so this is neither flaky
# nor slower than it has to be.
seen_err=no
for _ in $(seq 1 20); do
  if jhas "$MARK_ERR" -b -p err; then
    seen_err=yes
    break
  fi
  sleep 0.5
done
[[ $seen_err == yes ]] \
  || fail "the err-priority marker never appeared in 'journalctl -b -p err' after 10s; no answer could satisfy extract-filtered"

# The negative half has to be a real discriminator. If the info marker were
# visible at err priority - something re-logged it, or logger's facility.level
# argument was misread - then an unfiltered capture would satisfy
# extract-filtered too and the checkpoint would prove nothing.
#
# This one was the SIGPIPE bug's dangerous direction: as `| grep -q` it could
# only misreport in the case it exists to catch. A miss reads to EOF and returns
# 1 honestly; a HIT could be turned into 141 by pipefail, so the guard would
# have stayed quiet about exactly the corruption it is guarding against.
if jhas "$MARK_INFO" -b -p err; then
  fail "the info-priority marker is visible at err priority, so extract-filtered could not tell a filtered report from an unfiltered one"
fi

# ...and it has to be present *somewhere*, or the same thing is true from the
# other side: a filter that captured everything would still not contain it.
jhas "$MARK_INFO" -b \
  || fail "the info-priority marker is not in the journal at all, so extract-filtered would pass for an unfiltered capture"

# journald-active is an invariant: prove it holds before the student starts, so
# a failure afterwards can only mean the student broke it.
jstate=$(systemctl is-active systemd-journald 2>&1)
printf '%s' "$jstate" | grep -qx active \
  || fail "systemd-journald reports is-active='$jstate'; the journald-active invariant would fail for every fixture"

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
