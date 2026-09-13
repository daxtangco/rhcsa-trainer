#!/usr/bin/env bash
# Grader for sys/035-persistent-journal-and-schedule.
#
# READ-ONLY. Changes nothing on the guest. The exit code is ignored; only the
# JSONL emitted by ck_pass / ck_fail is read. content/lib/assert.sh is prepended
# by loadTaskScripts, so its helpers are already in scope - do not source it.
#
# Nine checkpoints, because this task fails silently in four independent ways -
# a journal that is not really on disk, a scheduler that will not come back
# after a reboot, a cron entry crond will never run, and a report with no
# filter - and each of them needs its own verdict line. One "did it work"
# checkpoint would tell a student they are wrong without saying which half.
#
# Note what is NOT graded anywhere below: no checkpoint greps journald.conf, and
# none looks for a particular journalctl flag. "Storage=persistent is written
# somewhere" is not the objective - "the journal is on disk and yesterday is
# still readable" is, and a student who got there by creating /var/log/journal
# with Storage left at auto has done the job (spec 6.5 rule 1).
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: journal-persistent, journal-history, crond-enabled, crond-active, cron-user, cron-schedule, extract-file, extract-filtered
set -uo pipefail

TARGET_USER=student
OUT=/var/log/rhcsa-audit/journal-errors.log
PERSIST_DIR=/var/log/journal
STAMP=/var/lib/rhcsa-lab/035-setup-boot-id
# Written into the journal by setup.sh: one message at err priority, one at
# info. A report that holds the first and not the second was produced by a
# priority filter, whatever the command line looked like. Spelled identically in
# setup.sh.
MARK_ERR=RHCSA035-ERR-9d41
MARK_INFO=RHCSA035-INFO-9d41

# The boot journald was running in when setup.sh staged this lab.
recorded=$(cat "$STAMP" 2>/dev/null | tr -dc '0-9a-f')
current=$(tr -dc '0-9a-f' < /proc/sys/kernel/random/boot_id 2>/dev/null)

# FAIL CLOSED, the same way content/tasks/storage/014-grow-home-lv/grade.sh
# does with its size targets. `grep -qiF -- "$recorded"` with an empty
# $recorded matches EVERY line of output, so a grader that could not read the
# stamp would report journal-history as passing on a guest whose journal is
# still entirely volatile - and would tell the student they got it right. There
# is no safe way to continue without both ids, so nothing passes.
if [[ ${#recorded} -ne 32 || ${#current} -ne 32 ]]; then
  detail="grader could not read a 32-hex boot id (stamp=${recorded:-empty} from $STAMP, current=${current:-empty}); setup.sh writes that stamp, so either setup did not run or /var was rolled back under it"
  ck_fail journal-persistent "the journal is stored on disk under $PERSIST_DIR" "$detail"
  ck_fail journal-history "the on-disk journal still holds the boot this lab was set up in" "$detail"
  ck_fail crond-enabled "crond is enabled at boot" "$detail"
  ck_fail crond-active "crond is running" "$detail"
  ck_fail cron-user "a cron entry that captures the journal runs as $TARGET_USER" "$detail"
  ck_fail cron-schedule "that entry is scheduled for 23:30 every day" "$detail"
  ck_fail extract-file "$OUT exists and is not empty" "$detail"
  ck_fail extract-filtered "the report holds the err-priority message and not the info-priority one" "$detail"
  ck_fail journald-active "systemd-journald is still running" "$detail"
  exit 0
fi

# --- 1. the journal reached the disk at all -------------------------------
# Journal FILES, not just the directory. `mkdir /var/log/journal` on its own
# changes nothing until journald is told to use it, and an empty directory is
# exactly what "I set Storage=persistent and forgot to restart or flush" leaves
# behind - which is the first anti-solution.
#
# find under sudo, because a student who created the directory by hand may have
# left it mode 0700 root:root. A permission error must not be graded as "the
# journal is not persistent": that is a false FAIL, and the student would go
# looking for a problem that is not there.
pfiles=()
mapfile -t pfiles < <(sudo find "$PERSIST_DIR" -maxdepth 3 -type f -name '*.journal' 2>/dev/null)
if (( ${#pfiles[@]} > 0 )); then
  ck_pass journal-persistent "the journal is stored on disk under $PERSIST_DIR"
else
  ck_fail journal-persistent "the journal is stored on disk under $PERSIST_DIR" \
    "no *.journal files under $PERSIST_DIR, so the journal is still only in /run/log/journal - and /run is a tmpfs"
fi

# --- 2. history that outlives a boot -------------------------------------
# This is the checkpoint whose MEANING changes between the two verdicts, and
# the reason this task sets reboot_check: true.
#
#   verdict A (no reboot yet): the boot recorded at setup time is the current
#     one, so this asks whether journald is writing THIS boot to disk. Nothing
#     available before a reboot can prove more than that.
#   verdict B (after the reboot): the recorded boot is the previous one, so the
#     same probe now asks whether entries from before the reboot survived it.
#     That is the actual objective, and it is only observable here.
#
# Both probes read ONLY $PERSIST_DIR, never /run. That restriction is the whole
# point: plain `journalctl` merges the runtime and persistent journals, so a
# probe that let it do so would find setup.sh's own messages on a guest whose
# journal is 100% volatile and report persistence that does not exist.
#
# Two probes, because one flag should not be able to decide a grade. The first
# asks the on-disk journal which boots it knows about; the second addresses the
# boot directly with a _BOOT_ID match against the very files find turned up.
# Either is sufficient evidence, and they fail independently.
history_ok=no
# grep without -q, stdout discarded: under `set -o pipefail` a `grep -q` here
# would exit on the match, kill journalctl with SIGPIPE and report 141, turning a
# found boot into "history not readable" - a false fail on a correct answer, and
# on a long-lived guest with many recorded boots that is the likely case, not the
# unlucky one. See setup.sh's jhas for the measurement.
if sudo journalctl -D "$PERSIST_DIR" --list-boots --no-pager 2>/dev/null | grep -iF -- "$recorded" >/dev/null; then
  history_ok=yes
elif (( ${#pfiles[@]} > 0 )); then
  fargs=()
  for f in "${pfiles[@]}"; do fargs+=("--file=$f"); done
  probe=$(sudo journalctl "${fargs[@]}" _BOOT_ID="$recorded" -n 1 --no-pager 2>/dev/null)
  # journalctl prints "-- No entries --" rather than nothing when a match finds
  # no records, so an emptiness test on its own would count that as a hit.
  if [[ -n $probe && $probe != *"No entries"* ]]; then
    history_ok=yes
  fi
fi

if [[ $recorded == "$current" ]]; then
  # Same boot as setup: this is verdict A, and the failure is "not on disk yet".
  hist_hint="journald is not writing this boot to $PERSIST_DIR yet; making the journal persistent takes effect for the running journal only after a flush or a restart of systemd-journald"
else
  # A different boot: the machine has rebooted, so the failure is the one this
  # whole task is about.
  hist_hint="boot $recorded ran before the reboot and is no longer readable, so persistence only took effect at this boot - the journal from before the reboot was thrown away with /run"
fi

if [[ $history_ok == yes ]]; then
  ck_pass journal-history "the on-disk journal still holds the boot this lab was set up in"
else
  ck_fail journal-history "the on-disk journal still holds the boot this lab was set up in" \
    "$hist_hint (looking for boot $recorded in $PERSIST_DIR; ${#pfiles[@]} journal files there)"
fi

# --- 3 and 4. the scheduler ----------------------------------------------
# Two checkpoints, not one, because running and will-run-again are independent
# properties (content/concepts/systemd/enabled-vs-started.md). A student who
# only ran `systemctl start crond` gets a job that works tonight and is gone
# after the next reboot, which is the second anti-solution.
#
# Anchored on the exact string rather than on is-enabled's exit status, which is
# also 0 for static, indirect, generated, alias and enabled-runtime. Only
# "enabled" means a symlink in /etc that survives a reboot, which is what the
# checkpoint name claims. Same spelling as systemd/017's stamp-enabled and
# setup.sh's precondition.
en=$(systemctl is-enabled crond 2>&1)
printf '%s' "$en" | grep -qx enabled
ck crond-enabled "crond is enabled at boot" $? "is-enabled=$en"

# In verdict A this only says the student started it. In verdict B nothing
# started it by hand, so "active" can only mean systemd pulled it in at boot -
# the same trick systemd/017's stamp-effect uses.
act=$(systemctl is-active crond 2>&1)
printf '%s' "$act" | grep -qx active
ck crond-active "crond is running" $? "is-active=$act"

# --- 5 and 6. the cron entry ---------------------------------------------
# Every cron entry on the machine, normalised to
#   USER<TAB>MIN<TAB>HOUR<TAB>DOM<TAB>MON<TAB>DOW<TAB>COMMAND
#
# Two grammars, and the difference between them is the mistake this half of the
# task exists to catch: a per-user crontab has five schedule fields and the
# command starts at field 6, while /etc/crontab and /etc/cron.d carry a SIXTH
# field naming the user to run as. Put a five-field line in /etc/cron.d and
# crond reads the first word of the command as a username and never runs the
# job; put a six-field line in `crontab -e` and it tries to execute the
# username. Both are graded here as what they are - an entry that will not do
# the work - rather than by pattern-matching the file the student edited.
cron_fields() {
  # $1: the user this file belongs to, or "" when the file uses the system
  #     grammar and the user is field 6.
  awk -v u="$1" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    # PATH=, MAILTO=, SHELL=: assignments, not schedules. A schedule field never
    # starts with a letter, and @daily starts with @, so this cannot eat one.
    $1 ~ /^[A-Za-z_][A-Za-z0-9_]*=/ { next }
    {
      # cronie accepts a leading "-" on the minute field to suppress logging.
      # Strip it so a student who used it is still graded on their schedule.
      sub(/^-/, "", $1)
      if ($1 ~ /^@/) {
        # @reboot, @daily and friends carry no fields. Recorded as-is so the
        # schedule check below rejects them: none of them is 23:30.
        min = $1; hour = "-"; dom = "-"; mon = "-"; dow = "-"; i = 2
      } else {
        # Five schedule fields and nothing to run is not an entry.
        if (NF < 6) next
        min = $1; hour = $2; dom = $3; mon = $4; dow = $5; i = 6
      }
      user = u
      if (user == "") { user = $i; i++ }
      cmd = ""
      for (; i <= NF; i++) cmd = cmd (cmd == "" ? "" : " ") $i
      if (cmd == "") next
      printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", user, min, hour, dom, mon, dow, cmd
    }'
}

cron_records() {
  local u f
  # Per-user crontabs. `crontab -l -u` rather than catting /var/spool/cron/NAME,
  # because that is the interface cronie documents and it is the one that
  # answers "whose crontab is this" without the grader assuming the spool
  # layout. The directory listing still comes from the spool, so an entry parked
  # in some third user's crontab is found and reported rather than silently
  # missed.
  while read -r u; do
    [[ -n $u ]] || continue
    # < /dev/null so nothing inside the loop can consume the process
    # substitution the loop itself is reading from.
    sudo crontab -l -u "$u" 2>/dev/null < /dev/null | cron_fields "$u"
  done < <(sudo ls -1 /var/spool/cron 2>/dev/null)

  # The system crontabs. /etc/cron.hourly and friends are deliberately not read:
  # run-parts directories cannot express "23:30", so an answer parked there
  # cannot satisfy the ticket and there is nothing for this grader to accept.
  for f in /etc/crontab /etc/cron.d/*; do
    [[ -f $f ]] || continue
    sudo cat "$f" 2>/dev/null | cron_fields ""
  done
}

# Does this command line produce the report? Three shapes are accepted, because
# all three genuinely do the job and grading only one would be grading a command
# sequence instead of an end state - that is risk R4.
#   - the command names journalctl
#   - the command names the report path (a wrapper doing its own redirect)
#   - the command runs a script, and that script names one of the two
# The third is why this is a shell function and not an awk expression: it has to
# read the file the entry points at. Wrapping the work in
# /usr/local/bin/something is good practice, not a wrong answer.
is_capture() {
  local cmd=$1 word
  local -a words
  [[ $cmd == *journalctl* || $cmd == *"$OUT"* ]] && return 0
  # read -ra, not `for word in $cmd`: an unquoted expansion would glob a
  # redirect's `*` against the grader's working directory.
  read -r -a words <<< "$cmd"
  for word in "${words[@]}"; do
    [[ -f $word ]] || continue
    sudo grep -qsF -e journalctl -e "$OUT" -- "$word" && return 0
  done
  return 1
}

# "Every day" in the three date fields. `*/1` is the same thing said the long
# way, so it is accepted; a list, a range or a step is not "every day" and is
# rejected with the schedule shown in the detail.
every_day() {
  local f
  for f in "$@"; do
    case $f in
      '*' | '*/1') ;;
      *) return 1 ;;
    esac
  done
  return 0
}

user_entry=no
schedule_entry=no
seen=''
# `done < <(...)` and not a pipe: a pipeline would run the loop body in a
# subshell and the two flags below would be discarded when it exited.
while IFS=$'\t' read -r cu min hour dom mon dow cmd; do
  [[ -n ${cu:-} ]] || continue
  is_capture "$cmd" || continue
  seen+="${cu}[$min $hour $dom $mon $dow] "
  # cron-schedule tests the same entry cron-user accepted, on purpose. Grading
  # the two independently would pass a machine where student has an entry at the
  # wrong time AND root has one at 23:30 - two wrong answers adding up to a
  # green verdict.
  [[ $cu == "$TARGET_USER" ]] || continue
  user_entry=yes
  if [[ $min == 30 && $hour == 23 ]] && every_day "$dom" "$mon" "$dow"; then
    schedule_entry=yes
  fi
done < <(cron_records)

found_detail="cron entries that capture the journal: ${seen:-none}"
if [[ $user_entry == yes ]]; then
  ck_pass cron-user "a cron entry that captures the journal runs as $TARGET_USER"
else
  ck_fail cron-user "a cron entry that captures the journal runs as $TARGET_USER" \
    "${found_detail:0:220}"
fi

if [[ $schedule_entry == yes ]]; then
  ck_pass cron-schedule "that entry is scheduled for 23:30 every day"
else
  ck_fail cron-schedule "that entry is scheduled for 23:30 every day" \
    "want minute 30, hour 23 and * for day-of-month, month and day-of-week; ${found_detail:0:220}"
fi

# --- 7 and 8. the report -------------------------------------------------
# `sudo test`, not `[ -s ]`: the student may have produced the report as root
# with a umask that leaves it unreadable to their own account, and "the grader
# cannot read it" must not be graded as "it is not there".
if sudo test -s "$OUT"; then
  ck_pass extract-file "$OUT exists and is not empty"
else
  ck_fail extract-file "$OUT exists and is not empty" \
    "the report is missing or empty; the ticket asks for one run now, not at 23:30"
fi

# The filter, graded by effect. setup.sh put one message in the journal at err
# priority and one at info, and proved before the student started that the info
# one is invisible to a priority filter and visible without one. So this accepts
# -p err, --priority=err, -p 3, PRIORITY=3 and anything else that does the same
# job, and rejects the two answers that only look right: no filter at all, and a
# filter on the rhcsa-audit tag (which matches both messages).
has_err=no
has_info=no
sudo grep -qsF -- "$MARK_ERR" "$OUT" && has_err=yes
sudo grep -qsF -- "$MARK_INFO" "$OUT" && has_info=yes
if [[ $has_err == yes && $has_info == no ]]; then
  ck_pass extract-filtered "the report holds the err-priority message and not the info-priority one"
else
  ck_fail extract-filtered "the report holds the err-priority message and not the info-priority one" \
    "err marker in the report: $has_err, info marker in the report: $has_info (wanted yes/no); an unfiltered capture holds both, a capture filtered on the rhcsa-audit tag also holds both"
fi

# --- 9. the invariant ----------------------------------------------------
# An answer that leaves the logging service dead is not an answer, and every
# probe above would be reading stale files if it were.
#
# Knowingly unprobed: no anti-solution can break this safely or reliably.
# systemd-journald is socket-activated and systemd brings it straight back, so a
# fixture that stops it races that restart and its verdict would be
# timing-dependent - flaky rather than a detection. Masking it instead leaves a
# guest whose logging cannot be restored without a reboot the harness does not
# control, and it would take journal-history's evidence down with it, so the
# fixture could no longer tell "correctly detected" from "guest ruined". That is
# the risk being accepted here, not overlooked: this checkpoint passes for every
# fixture in this task, so an unconditional ck_pass here would validate green.
# unprobed-invariant: journald-active
jstate=$(systemctl is-active systemd-journald 2>&1)
printf '%s' "$jstate" | grep -qx active
ck journald-active "systemd-journald is still running" $? "is-active=$jstate"

exit 0
