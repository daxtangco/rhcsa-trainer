#!/usr/bin/env bash
# Prepare the system for sys/039-process-signals-and-priority.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell.
#
# IDEMPOTENT, and it has to be. The harness reverts a snapshot before every
# fixture, but a human re-runs this by hand on a guest they have been poking at,
# and this task's pre-state is *two running processes*. So every start below is
# preceded by the matching stop: a second run must leave exactly one runaway and
# exactly one collector, never two. A duplicate runaway would make purge-stopped
# unreachable - the student kills the process they found, the twin still matches
# the grader's pattern, and the checkpoint fails an answer that was correct.
# The counts are asserted at the bottom rather than assumed.
#
# `set -uo pipefail` without -e, following
# content/tasks/sys/035-persistent-journal-and-schedule/setup.sh: this file is
# full of idempotent removals that legitimately fail on a first run (there is no
# transient unit to stop, no drop-in to delete). The commands that MUST work are
# wrapped in `need` instead, because a silent failure here stages the wrong
# machine and every checkpoint result afterwards is a lie.
set -uo pipefail

need() { "$@" || { printf 'setup.sh: FAILED: %s\n' "$*" >&2; exit 1; }; }
fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

PURGE=/usr/local/sbin/rhcsa-lab-purge
METRICS=/usr/local/sbin/rhcsa-lab-metrics
PURGE_UNIT=rhcsa-lab-purge.service
METRICS_UNIT=rhcsa-lab-metrics.service
UNIT_FILE=/etc/systemd/system/rhcsa-lab-metrics.service
DROPIN_DIR=$UNIT_FILE.d
LOG_DIR=/var/log/rhcsa-lab
SHUTDOWN_LOG=$LOG_DIR/purge-shutdown.log
STATE_DIR=/var/lib/rhcsa-lab
STAMP=$STATE_DIR/039-setup-boot-id

# The patterns the grader matches on, spelled the same way here. The leading
# bracket is not decoration: `pgrep -f` and `pkill -f` match against every
# process's whole command line, and under `sudo pgrep -f rhcsa-lab-purge` the
# *sudo* process's own command line contains that string, so the search finds
# (and pkill would signal) its own parent. `[r]hcsa` matches "rhcsa" as a regex
# while the literal text `[r]hcsa` in sudo's command line does not match it.
# Measured: without the bracket, `sudo pkill -TERM -f rhcsa-lab-purge` kills its
# own sudo and returns 143.
PURGE_PAT='[r]hcsa-lab-purge'
METRICS_PAT='[r]hcsa-lab-metrics'

# --- preconditions this script itself needs -------------------------------
# systemd-run is how the runaway is started, and the reason it is used rather
# than `setsid ... &`: setup runs inside an ssh session that ends the moment
# this script exits, and a transient unit lives in systemd's own hierarchy
# rather than in that session's. It is also deliberately *transient* - the
# runaway must not come back after a reboot, because a process that respawns is
# a service-management task and not the "kill processes" objective.
command -v systemd-run &>/dev/null \
  || fail "systemd-run is missing; it is part of systemd and a guest without it cannot stage this task"

# The grader finds both processes with pgrep and reads the collector's nice
# value with ps. Both come from procps-ng, which is installed on every RHEL 9
# system, but if either is missing every checkpoint below decides the wrong way
# round, so this is checked rather than assumed.
command -v pgrep &>/dev/null || fail "pgrep is missing (procps-ng); the grader cannot find either lab process without it"
ni_probe=$(ps -o ni= -p $$ 2>/dev/null | tr -d ' ')
[[ -n $ni_probe ]] \
  || fail "'ps -o ni= -p PID' printed nothing on this guest; index-nice-running reads a nice value that way and would fail for every answer"

# --- undo whatever a previous run or a previous attempt left behind -------
# Order matters twice over. Stopping the transient unit sends SIGTERM, the
# runaway's own handler answers it by appending to the shutdown log, and that
# log is what purge-graceful grades - so the log is removed *after* the stop,
# never before it. And the collector's drop-in directory goes before the unit
# file is rewritten, so a leftover Nice= from a solved run cannot survive into
# the machine the student is handed.
sudo systemctl stop "$PURGE_UNIT" &>/dev/null
sudo systemctl reset-failed "$PURGE_UNIT" &>/dev/null
sudo systemctl disable --now "$METRICS_UNIT" &>/dev/null
# reset-failed on the collector too, and for a different reason than the purge
# unit's: nothing here needs its name freed, but a previous attempt that killed
# the collector left the unit in `failed` with a start counter, and five starts
# inside StartLimitIntervalSec turn the `restart` below into "start request
# repeated too quickly". That would abort setup by way of `need` - loud, but for
# a reason that has nothing to do with the lab. reset-failed clears both.
sudo systemctl reset-failed "$METRICS_UNIT" &>/dev/null
sudo rm -rf "$DROPIN_DIR"

pids_of() { sudo pgrep -f "$1" 2>/dev/null | tr '\n' ' '; }
count_of() { pids_of "$1" | wc -w; }

# Polls rather than sleeping once: a trap that has to run `date` and append a
# line is not instant, and a fixed sleep is either flaky or slower than it needs
# to be. `[[ -z $(...) ]]` rather than `pids_of | grep -q .` for the SIGPIPE
# reason content/lib/assert.sh documents at length.
wait_gone() {
  local pat=$1 _
  for _ in $(seq 1 20); do
    [[ -z $(pids_of "$pat") ]] && return 0
    sleep 0.5
  done
  return 1
}

wait_present() {
  local pat=$1 _
  for _ in $(seq 1 20); do
    [[ -n $(pids_of "$pat") ]] && return 0
    sleep 0.5
  done
  return 1
}

# Anything still matching after the unit stop was started by hand (a student
# experimenting, or a fixture that re-launched the script outside systemd).
# SIGTERM, not SIGKILL, so the shutdown log it writes is removed by the rm below
# rather than appearing after it.
sudo pkill -TERM -f "$PURGE_PAT" &>/dev/null
sudo pkill -TERM -f "$METRICS_PAT" &>/dev/null
wait_gone "$PURGE_PAT" || fail "a process matching $PURGE_PAT survived SIGTERM; purge-stopped cannot be staged while a twin is running - reset the lab (snapshot revert)"
wait_gone "$METRICS_PAT" || fail "a process matching $METRICS_PAT survived SIGTERM; reset the lab (snapshot revert)"

need sudo mkdir -p "$LOG_DIR" "$STATE_DIR"
need sudo chmod 0755 "$LOG_DIR" "$STATE_DIR"
# SELinux is Enforcing on this guest. A directory created under /var/log
# inherits var_log_t from its parent, so this is belt and braces rather than a
# fix - and it is cheap insurance against a guest where /var/log was relabelled
# by hand, which would leave the runaway's handler unable to write its record
# and no visible reason why.
need sudo restorecon -R "$LOG_DIR" "$STATE_DIR"
sudo rm -f "$SHUTDOWN_LOG"

# --- the two jobs the prompt describes ------------------------------------
# Both scripts are written fresh every run, so an edited copy from a previous
# attempt cannot change what the student is graded on. Their comments are
# deliberately plausible-and-neutral: the student can read these files, so
# nothing in them may name a checkpoint or hint at the answer.
sudo tee "$PURGE" >/dev/null <<'EOF'
#!/usr/bin/env bash
# rhcsa-lab maintenance suite: incremental purge pass.
#
# Answers SIGTERM, SIGINT and SIGHUP by recording its own shutdown, so an
# interrupted pass can be audited afterwards.
#
# The work loop uses shell builtins only. bash defers a trap while it waits for
# a foreground external command, so a loop with a sleep in it would answer a
# shutdown request up to a second late.
LOG=/var/log/rhcsa-lab/purge-shutdown.log

on_signal() {
  printf '%s purge pass interrupted by SIG%s, state recorded\n' "$(date -Is)" "$1" >> "$LOG"
  exit 0
}
trap 'on_signal TERM' TERM
trap 'on_signal INT' INT
trap 'on_signal HUP' HUP

i=0
while :; do
  i=$(( (i + 1) % 1000000 ))
done
EOF
need sudo chmod 0755 "$PURGE"
need sudo restorecon "$PURGE"

sudo tee "$METRICS" >/dev/null <<'EOF'
#!/usr/bin/env bash
# rhcsa-lab metrics collector: samples a handful of counters, then waits.
while :; do
  n=0
  while (( n < 150000 )); do
    n=$(( n + 1 ))
  done
  sleep 2
done
EOF
need sudo chmod 0755 "$METRICS"
need sudo restorecon "$METRICS"

# The collector's unit carries no Nice= and no drop-in: that absence is what
# makes index-nice-config and index-nice-running fail on an untouched machine.
# Restart=no is written out rather than left to the default so the next author
# does not "harden" it into Restart=always - a restarting unit would silently
# heal the over-broad-kill mistake and index-alive would prove nothing.
# Nothing in this file may hint at the answer either; the student reads it with
# `systemctl cat`.
sudo tee "$UNIT_FILE" >/dev/null <<'EOF'
[Unit]
Description=RHCSA lab metrics collector (background batch job)

[Service]
Type=simple
ExecStart=/usr/local/sbin/rhcsa-lab-metrics
Restart=no

[Install]
WantedBy=multi-user.target
EOF
need sudo chmod 0644 "$UNIT_FILE"
need sudo restorecon "$UNIT_FILE"

need sudo systemctl daemon-reload
# enable: the collector has to be running again after the reboot, or index-alive
# would fail in verdict B for every fixture including both solutions. restart
# after it, not `enable --now`: --now would leave an already-running process
# from a previous run in place, and that process may be sitting at nice 10 from
# a solved attempt, which is precisely the baseline this task must not start
# from.
need sudo systemctl enable "$METRICS_UNIT"
need sudo systemctl restart "$METRICS_UNIT"

# The runaway. Transient, so it is gone after a reboot; --collect so a unit that
# has exited leaves no failed husk behind for the next run to trip over.
need sudo systemd-run --unit=rhcsa-lab-purge --collect \
  --description='RHCSA lab maintenance purge pass' "$PURGE"

# --- verify every precondition the checkpoints depend on ------------------
# Not merely the ones this script needs: a precondition that only guards the
# script leaves the checkpoints free to pass or fail for reasons that have
# nothing to do with the student, which is a student-facing false pass and not a
# solved task. One block per checkpoint, in grade.sh's order.

# purge-stopped: exactly one process must match, and it must be the one just
# started. Zero means the runaway died and the checkpoint is already green; more
# than one means the student can do everything right and still be failed by a
# twin.
wait_present "$PURGE_PAT" || fail "no process matches $PURGE_PAT after systemd-run; purge-stopped would pass at baseline"
purge_n=$(count_of "$PURGE_PAT")
[[ $purge_n -eq 1 ]] || fail "$purge_n processes match $PURGE_PAT, expected exactly 1; a twin makes purge-stopped unreachable"

# The premise of the objective ("identify CPU intensive processes") is that this
# process is findable by how much CPU it is using, so that premise is measured
# rather than trusted. `ps -o pcpu` is an average over the process's whole life,
# which is near 100 for a spin loop that has just started; the floor is set low
# because the number only has to make the runaway the unambiguous top consumer.
purge_pid=$(pids_of "$PURGE_PAT" | tr -d ' ')
sleep 1
purge_cpu=$(ps -o pcpu= -p "$purge_pid" 2>/dev/null | tr -d ' ')
awk -v c="${purge_cpu:-0}" 'BEGIN { exit (c >= 20) ? 0 : 1 }' \
  || fail "the runaway is using ${purge_cpu:-0}% CPU, which is not enough for a student to find it in top(1); its work loop is not spinning"

# purge-graceful: the shutdown record must not exist yet, or the checkpoint is
# green before the student types anything.
if sudo test -e "$SHUTDOWN_LOG"; then
  fail "$SHUTDOWN_LOG exists after the rm; purge-graceful would pass at baseline"
fi

# index-alive: the invariant. Prove it holds before the student starts, so a
# failure afterwards can only mean the student broke it. Anchored on the exact
# strings the grader anchors on, not on systemctl's exit status.
act=$(systemctl is-active "$METRICS_UNIT" 2>&1)
printf '%s' "$act" | grep -qx active \
  || fail "$METRICS_UNIT reports is-active='$act'; the index-alive invariant would fail for every fixture"
en=$(systemctl is-enabled "$METRICS_UNIT" 2>&1)
printf '%s' "$en" | grep -qx enabled \
  || fail "$METRICS_UNIT reports is-enabled='$en'; after the reboot it would not come back and index-alive would fail in verdict B"
metrics_pid=$(systemctl show -p MainPID --value "$METRICS_UNIT" 2>/dev/null | tr -dc '0-9')
[[ -n $metrics_pid && $metrics_pid != 0 && -d /proc/$metrics_pid ]] \
  || fail "$METRICS_UNIT has no live MainPID (got '${metrics_pid:-empty}'); index-alive and index-nice-running both read it"

# The two patterns must not be able to find each other's process, or the
# over-broad-kill anti-solution proves nothing and the grader's two searches are
# one search.
metrics_n=$(count_of "$METRICS_PAT")
[[ $metrics_n -eq 1 ]] || fail "$metrics_n processes match $METRICS_PAT, expected exactly 1"
[[ $(pids_of "$METRICS_PAT" | tr -d ' ') == "$metrics_pid" ]] \
  || fail "the process matching $METRICS_PAT is not $METRICS_UNIT's MainPID $metrics_pid; the grader's two views of the collector disagree"
[[ $purge_pid != "$metrics_pid" ]] || fail "both patterns matched the same pid $purge_pid"

# index-nice-config: systemd must report a Nice property for this unit, and it
# must not already be 10. The first half is the load-bearing one - the grader's
# primary probe is `systemctl show -p Nice`, and on a systemd that did not
# expose that property the checkpoint could never pass for anybody. Better to
# say so here than to hand every fixture an unexplained red.
nice_prop=$(systemctl show -p Nice --value "$METRICS_UNIT" 2>/dev/null | tr -d ' ')
[[ -n $nice_prop ]] \
  || fail "'systemctl show -p Nice --value $METRICS_UNIT' printed nothing on this guest, so index-nice-config's primary probe is blind"
[[ $nice_prop != 10 ]] \
  || fail "$METRICS_UNIT is already configured with Nice=10; index-nice-config would pass at baseline - reset the lab (snapshot revert)"
# The other half of the same precondition: the merged unit text is the grader's
# second evidence, so a leftover Nice= anywhere in it would also pass at
# baseline. grep without -q so it reads to EOF.
if sudo systemctl cat "$METRICS_UNIT" 2>/dev/null | grep -E '^[[:space:]]*Nice[[:space:]]*=' >/dev/null; then
  fail "the merged unit text for $METRICS_UNIT already assigns Nice=; index-nice-config would pass at baseline"
fi

# index-nice-running: the live process must not already be at 10.
run_nice=$(ps -o ni= -p "$metrics_pid" 2>/dev/null | tr -d ' ')
[[ -n $run_nice ]] || fail "could not read the nice value of $metrics_pid; index-nice-running would fail for every answer"
[[ $run_nice != 10 ]] || fail "$METRICS_UNIT's process is already at nice 10; index-nice-running would pass at baseline"

# The boot systemd is running in right now. purge-graceful reads this to tell
# "the record is missing" from "the machine has restarted since the record could
# have been written", which are the same absence and very different verdicts.
boot_id=$(tr -dc '0-9a-f' < /proc/sys/kernel/random/boot_id)
[[ ${#boot_id} -eq 32 ]] \
  || fail "read a ${#boot_id}-character boot id from /proc/sys/kernel/random/boot_id, expected 32 hex digits"
printf '%s\n' "$boot_id" | sudo tee "$STAMP" >/dev/null
need sudo chmod 0644 "$STAMP"
# Read it back the way grade.sh reads it: the grader fails every checkpoint
# closed when this value is not 32 hex digits, so a stamp that did not land is a
# task nobody can pass.
stamp_back=$(cat "$STAMP" 2>/dev/null | tr -dc '0-9a-f')
[[ $stamp_back == "$boot_id" ]] \
  || fail "$STAMP reads back as '${stamp_back:-empty}', not $boot_id; grade.sh fails closed on that and no answer could pass"

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
