#!/usr/bin/env bash
# Grader for sys/039-process-signals-and-priority.
#
# READ-ONLY. Changes nothing on the guest. The exit code is ignored; only the
# JSONL the assert helpers emit is read. content/lib/assert.sh is prepended by
# loadTaskScripts, so its helpers are already in scope - do not source it.
#
# WHAT THIS GRADER CANNOT SEE, and the reason the first half is graded the way
# it is: *which signal a student sent*. A delivered signal leaves no record
# anywhere once the process that received it is gone - not in /proc, not in the
# journal, not in any accounting file RHEL 9 keeps by default. "Was SIGTERM used
# rather than SIGKILL" is therefore not a question a grader can answer, and a
# checkpoint claiming to answer it would be a guess dressed as a verdict.
#
# So the two things that ARE observable after the fact are graded instead:
#   purge-stopped   - no process matching the runaway is running any more.
#   purge-graceful  - the file the runaway writes from inside its own handler
#                     for the default termination signal exists. SIGKILL cannot
#                     be caught, so a process destroyed with it never writes
#                     that file. The evidence is the *effect* of the signal, not
#                     the signal.
# A student who sends SIGTERM and then SIGKILL passes both, and that is correct:
# the job got its chance and took it.
#
# Five checkpoints, because this task fails in five independent ways - the wrong
# process killed, the right process killed the wrong way, the collector taken
# down with the runaway, a nice value that is not configured anywhere, and a
# nice value configured but never applied. One "did it work" line would tell a
# student they are wrong without saying which of the five they are.
#
# On the phases in the header below. purge-stopped and purge-graceful are
# declared `@pre`, so the harness expects them to fail before the student acts
# and to pass after the reboot. That is not a loophole, it is what a reboot does
# to this half of the task: the runaway is a transient unit, so it is gone after
# any reboot whether or not the student ever found it, and systemd's own shutdown
# SIGTERM makes the handler write the record on the way down. An untouched
# machine therefore passes both of them in verdict B, and the baseline header
# below declares exactly that instead of pretending otherwise.
#
# What `@pre` does NOT mean is that verdict B stops measuring. Neither section
# below has a "the boot id changed, so pass" branch, and section 2 used to: that
# branch handed `kill -9` a clean sheet, because src/server/session.ts scores the
# student on finalVerdict(), which is verdict B whenever a reboot happened. A
# process destroyed with SIGKILL never writes the record and no later shutdown
# can write it on behalf of a process that no longer exists, so the absence
# still means what it always meant and is still graded. Section 2 says where
# that leaves each case.
#
# The nice half carries the persistence weight of this task and is declared for
# both verdicts.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: purge-stopped@pre, purge-graceful@pre, index-nice-config, index-nice-running
set -uo pipefail

UNIT=rhcsa-lab-metrics.service
SHUTDOWN_LOG=/var/log/rhcsa-lab/purge-shutdown.log
STAMP=/var/lib/rhcsa-lab/039-setup-boot-id
WANT_NICE=10

# Spelled identically in setup.sh, brackets included. `pgrep -f` matches a whole
# command line, and this grader runs the search under sudo - so a literal
# `rhcsa-lab-purge` would match the `sudo pgrep -f rhcsa-lab-purge` process
# itself and report a runaway that is nothing but this grader looking for it.
# `[r]hcsa` matches "rhcsa" as a regex; the literal text `[r]hcsa` does not
# match that regex, so sudo's own command line is invisible to it.
PURGE_PAT='[r]hcsa-lab-purge'

# sudo, not a bare pgrep: both lab processes belong to root, and while
# /proc/PID/cmdline is world-readable on a stock guest, a /proc mounted with
# hidepid would hide it - and "the grader could not see it" must never be graded
# as "the student stopped it". That direction is a false PASS, which is the one
# this bank refuses to risk.
purge_pids=$(sudo pgrep -f "$PURGE_PAT" 2>/dev/null | tr '\n' ' ')

# The boot systemd was running in when setup.sh staged this lab. setup.sh writes
# this stamp last, after asserting every precondition, so a readable stamp is the
# grader's evidence that the machine in front of it is the one that was staged.
recorded=$(cat "$STAMP" 2>/dev/null | tr -dc '0-9a-f')
current=$(tr -dc '0-9a-f' < /proc/sys/kernel/random/boot_id 2>/dev/null)

# FAIL CLOSED, the same way sys/035's grader does with its boot stamp. Without
# the stamp this grader is reading a machine nobody staged - /var rolled back
# under it, or setup.sh never ran - and every section below would then report on
# absences it has no right to attribute to a student. There is no safe way to
# continue, so nothing passes. The comparison of the two ids is diagnostic only
# (section 2); it is their presence that gates.
if [[ ${#recorded} -ne 32 || ${#current} -ne 32 ]]; then
  detail="grader could not read a 32-hex boot id (stamp=${recorded:-empty} from $STAMP, current=${current:-empty}); setup.sh writes that stamp, so either setup did not run or /var was rolled back under it"
  ck_fail purge-stopped "the runaway maintenance process is no longer running" "$detail"
  ck_fail purge-graceful "the runaway was allowed to record its own shutdown" "$detail"
  ck_fail index-alive "$UNIT is still running" "$detail"
  ck_fail index-nice-config "$UNIT is configured to start at nice $WANT_NICE" "$detail"
  ck_fail index-nice-running "the collector process running now is at nice $WANT_NICE" "$detail"
  exit 0
fi

# --- 1. the runaway is gone -----------------------------------------------
# Graded in both verdicts even though a reboot satisfies it for free (see the
# header). Probing it after the reboot rather than short-circuiting is still
# worth the four lines: a student who "fixed" this by making the job restart at
# boot has not stopped it, and this is the only checkpoint that would notice.
if [[ -z ${purge_pids// /} ]]; then
  ck_pass purge-stopped "the runaway maintenance process is no longer running"
else
  ck_fail purge-stopped "the runaway maintenance process is no longer running" \
    "still running as pid(s) ${purge_pids% }; renicing a runaway or stopping some other process does not stop it"
fi

# --- 2. it was stopped in a way that let it clean up ----------------------
# The record is written by the runaway itself, into /var (not /run), so a correct
# answer given before the reboot is still evidence after it and the same probe
# runs in both verdicts.
#
# There is deliberately no "the boot id changed, so pass" branch here, because
# the two ways the record can be missing after a reboot are not symmetrical:
#   - an untouched machine gets the record for free. systemd SIGTERMs the
#     transient unit on the way down and the handler writes it during shutdown.
#     That is what `purge-graceful@pre` in the baseline header declares, and it
#     is the case a vacuous pass was there to protect.
#   - a process destroyed with SIGKILL leaves no record and no later shutdown can
#     write one for it. That absence is still the student's, in verdict B as much
#     as in verdict A, and passing it would tell someone whose reflex is `kill -9`
#     that they did this correctly.
#
# The one guest-side behaviour this rests on: the shutdown SIGTERM reaches the
# runaway while /var is still writable. A systemd-run transient unit carries the
# default Conflicts=/Before=shutdown.target dependencies, so it is stopped in the
# ordinary unit-stop phase, long before filesystems go read-only, and the handler
# needs one `date` and one append. If that ever stops holding, the *baseline*
# fixture fails loudly in `rhcsa validate` - which is the direction to fail in.
log_present=no
if sudo test -s "$SHUTDOWN_LOG"; then log_present=yes; fi

# Only ever diagnostic wording: whether a reboot has happened does not change the
# verdict below, it changes which sentence explains it.
if [[ $recorded == "$current" ]]; then
  boot_note="the lab has not been restarted since it was staged, so nothing else could have written it"
else
  boot_note="this is boot $current and the lab was staged in boot $recorded, so the shutdown in between did not write it either - the job was already gone"
fi

if [[ $log_present == yes ]]; then
  ck_pass purge-graceful "the runaway was allowed to record its own shutdown"
else
  ck_fail purge-graceful "the runaway was allowed to record its own shutdown" \
    "$SHUTDOWN_LOG is missing or empty; the job writes it from its handler for the default termination signal, and a signal that cannot be caught never gives it the chance ($boot_note)"
fi

# --- 3. the collector survived ------------------------------------------
# An invariant: it passes from the start, and exists to catch the answer that
# takes the whole maintenance suite down with the runaway - a `pkill -f` pattern
# loose enough to match both. It is absent from the baseline header for that
# reason, and named by antisolutions/03's own header, which is what keeps a
# rename of this id from going quiet.
#
# Both halves are needed. is-active alone says "systemd has not noticed yet" on
# a unit whose main process has just been killed, and a live pid alone would
# accept a copy of the script relaunched by hand outside the unit - the prompt
# asks for the service, not for a process that looks like it.
state=$(systemctl is-active "$UNIT" 2>&1)
main_pid=$(systemctl show -p MainPID --value "$UNIT" 2>/dev/null | tr -dc '0-9')
alive=no
if printf '%s' "$state" | grep -qx active && [[ -n $main_pid && $main_pid != 0 && -d /proc/$main_pid ]]; then
  alive=yes
fi
if [[ $alive == yes ]]; then
  ck_pass index-alive "$UNIT is still running"
else
  ck_fail index-alive "$UNIT is still running" \
    "is-active=$state, MainPID=${main_pid:-none}; a kill pattern wide enough to catch the runaway caught the collector too"
fi

# --- 4. the nice value is configured, not merely applied ------------------
# The persistence half, and the reason this task sets reboot_check: true. A
# renice touches one live process and dies with it, so the only evidence that
# the *next* start will also be nice 10 lives in what starts it.
#
# Mechanism-agnostic on purpose (spec 6.5 rule 1). Three independent kinds of
# evidence, any one of which is sufficient, because all three genuinely produce
# a collector that starts at nice 10 and grading only the first would be grading
# a spelling:
#   (a) systemd's own loaded value for the unit. This is the primary probe and
#       it accepts Nice= wherever it validly lives - in the unit file, in a
#       drop-in under .service.d/, added with `systemctl edit`, whatever.
#       Measured on RHEL 9.8, systemd 252-67.el9_8.2: a unit with no Nice=
#       reports `0` and a unit with a `[Service] Nice=10` drop-in reports `10`
#       after a daemon-reload, and the started process really is at nice 10.
#       Note that this property reports `0` for a unit that does not exist at
#       all, which is why it is a value comparison and never an existence test.
#   (b) the merged unit text, read section-aware. This is what catches an
#       on-disk edit that has not been through a daemon-reload yet: the file is
#       what survives a reboot, so it is honest evidence for a checkpoint about
#       the next start, even while (a) still reports the old copy.
#   (c) an ExecStart that runs the collector through nice(1). Unusual, entirely
#       correct, and rejected by any grader that only greps for Nice=.
# Section-awareness in (b) is load-bearing: `Nice=10` under [Unit] is silently
# ignored by systemd (it warns to the journal and carries on), so a text search
# that did not track sections would pass an answer that does nothing at all.
nice_prop=$(systemctl show -p Nice --value "$UNIT" 2>/dev/null | tr -d '[:space:]')
exec_start=$(systemctl show -p ExecStart --value "$UNIT" 2>/dev/null)
text_nice=$(sudo systemctl cat "$UNIT" 2>/dev/null | awk '
  # systemctl cat interleaves "# /path/to/unit" banners with the file bodies,
  # and a commented-out Nice= is not a setting either.
  /^[[:space:]]*[#;]/ { next }
  /^[[:space:]]*\[/ { sect = $0; gsub(/[[:space:]]/, "", sect); next }
  sect == "[Service]" && /^[[:space:]]*Nice[[:space:]]*=/ {
    v = substr($0, index($0, "=") + 1)
    gsub(/[[:space:]]/, "", v)
    # Last assignment wins, matching how systemd reads the merged text.
    last = v
  }
  END { print last }')

# `-n 10`, `--adjustment=10` and the bare `-10` form all mean the same thing to
# nice(1). Held in variables because a quoted regex in [[ =~ ]] is matched as a
# literal string.
re_nice_n='(-n[[:space:]]*|--adjustment[=[:space:]])10([[:space:]]|$)'
re_nice_bare='[[:space:]]-10([[:space:]]|$)'
exec_nice=no
if [[ $exec_start == *nice* ]] &&
  { [[ $exec_start =~ $re_nice_n ]] || [[ $exec_start =~ $re_nice_bare ]]; }; then
  exec_nice=yes
fi

if [[ $nice_prop == "$WANT_NICE" || $text_nice == "$WANT_NICE" || $exec_nice == yes ]]; then
  ck_pass index-nice-config "$UNIT is configured to start at nice $WANT_NICE"
else
  ck_fail index-nice-config "$UNIT is configured to start at nice $WANT_NICE" \
    "systemd reports Nice=${nice_prop:-unset} for the unit, the merged unit text assigns [Service] Nice=${text_nice:-nothing}, and ExecStart does not go through nice; a renice on the running process is forgotten the moment it exits"
fi

# --- 5. ...and it is in force on the process running now ------------------
# The other half of "now, and from here on". In verdict A this says the student
# applied their change to the live process - by restarting the unit or by
# renicing it, both accepted. In verdict B nobody restarted anything by hand, so
# a nice 10 here can only have come from the configuration systemd read at boot,
# which is the check a renice-only answer cannot survive.
#
# Read from the unit's MainPID rather than from a pgrep match, so "which process
# is the collector" is systemd's answer and not a pattern's guess.
run_nice=''
if [[ -n $main_pid && $main_pid != 0 ]]; then
  run_nice=$(ps -o ni= -p "$main_pid" 2>/dev/null | tr -d '[:space:]')
fi
if [[ $run_nice == "$WANT_NICE" ]]; then
  ck_pass index-nice-running "the collector process running now is at nice $WANT_NICE"
else
  ck_fail index-nice-running "the collector process running now is at nice $WANT_NICE" \
    "MainPID=${main_pid:-none} is at nice ${run_nice:-unreadable}, wanted $WANT_NICE; a unit file that has been edited but not reloaded, or reloaded but not restarted, leaves the running process where it was"
fi

exit 0
