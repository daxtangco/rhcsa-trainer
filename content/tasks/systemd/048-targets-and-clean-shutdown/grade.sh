#!/usr/bin/env bash
# baseline-fail: boot-arg-pinned, graphical-target-active, no-reboot-pending, rearm-unit-disabled
set -uo pipefail

UNIT=rhcsa-maintenance-window.service
PIN='systemd.unit=graphical.target'
SCHED=/run/systemd/shutdown/scheduled

# --- the boot loader half --------------------------------------------------
# Read through grubby rather than by grepping /boot/loader/entries, for two
# reasons that are both properties of RHEL 9 and not preferences:
#
#   1. /boot/loader/entries is mode 700, so an unprivileged grep sees nothing and
#      would report "not pinned" for a correct answer.
#   2. An entry's options line may hold the literal string $kernelopts, whose real
#      value lives in grubenv. grubby expands it (get_bls_args in
#      /usr/libexec/grubby/grubby-bls); grep does not. Grading the raw file would
#      mark a candidate wrong for arguments the boot loader will actually pass.
#
# DEFAULT, not ALL: the requirement is about the entry this machine boots.
# `grubby --info` prints one args="..." line per matched entry, root= split out
# onto its own line (display_info_values, same file).
info=$(timeout 60 sudo grubby --info=DEFAULT 2>&1)
args=$(printf '%s\n' "$info" | sed -n 's/^args="\(.*\)"$/\1/p')

# Fail closed. An unreadable boot configuration is not "probably fine": setup.sh
# proved this exact command works at baseline, so nothing here can be a missing
# tool, and a skip would let the harness accept a solution that was never measured.
if [[ -z $args ]]; then
  ck_fail boot-arg-pinned "the default boot entry passes $PIN" \
    "grubby --info=DEFAULT printed no args= line: $(printf '%s' "$info" | head -n 1)"
else
  # Space-padded on both sides so a pin at the start or the end of the line still
  # matches and systemd.unit=graphical.target-something never does. grep -F with
  # >/dev/null, not grep -qF: see the pipefail/SIGPIPE note in content/lib/assert.sh.
  printf '%s' " $args " | grep -F -- " $PIN " >/dev/null
  ck boot-arg-pinned "the default boot entry passes $PIN" $? "args=$args"
fi

# In verdict A this is the isolate: the candidate moved the running system without
# rebooting. In verdict B it is the kernel argument, and it can only be the kernel
# argument, because default-target-unchanged below asserts default.target is still
# multi-user.target - so nothing else on this machine asks for graphical.target at
# boot. That is how the two runs mean different things without the checkpoint
# meaning different things.
active=$(systemctl is-active graphical.target 2>&1)
[ "$active" = "active" ]
ck graphical-target-active "graphical.target is active right now" $? "is-active=$active"

# --- the shutdown half -----------------------------------------------------
# Two independent readings, and "pending" wins from either, because a false pass
# here is a candidate told they cancelled a reboot they did not cancel.
#
#   - The file systemd-logind writes when a shutdown is scheduled. sudo because
#     /run/systemd/shutdown is root-owned. setup.sh proves on this guest that it
#     appears on schedule and is gone after `shutdown -c`, so its absence here is
#     a measurement and not an assumption.
#   - logind's own ScheduledShutdown property, documented as (st) in
#     org.freedesktop.login1(5): a type string and a wall-clock usec. Empty type
#     means nothing is scheduled.
#
# The property is the softer of the two: if busctl is absent or the read fails,
# `stype` is empty and this checkpoint rests on the file alone rather than
# fabricating a failure. Both reads are timeout-bounded - the grader gets one ssh
# exec and must never be the thing that hangs it.
sched_file=absent
sudo test -e "$SCHED" && sched_file=present
prop=$(timeout 20 busctl get-property org.freedesktop.login1 /org/freedesktop/login1 \
  org.freedesktop.login1.Manager ScheduledShutdown 2>&1)
stype=$(printf '%s\n' "$prop" | awk '$1 == "(st)" { print $2 }')

pending=no
[ "$sched_file" = present ] && pending=yes
case "$stype" in
  '' | '""') ;;
  *) pending=yes ;;
esac

[ "$pending" = no ]
ck no-reboot-pending "no shutdown or reboot is scheduled" $? \
  "scheduled_file=$sched_file logind_type=${stype:-unreadable}"

# Passes for disabled, masked, and also for a unit file that is gone: all three
# mean the same thing, which is that this will not run at the next boot. Anchored
# with grep -x for the same reason 017 anchors it - is-enabled exits 0 for static,
# indirect, generated, alias and enabled-runtime as well, and "not enabled" has to
# mean not enabled.
unit_state=$(systemctl is-enabled "$UNIT" 2>&1)
printf '%s' "$unit_state" | grep -x -- enabled >/dev/null
still_on=$?
[ "$still_on" -ne 0 ]
ck rearm-unit-disabled "$UNIT will not run at the next boot" $? "is-enabled=$unit_state"

# --- invariants ------------------------------------------------------------
# Probed, and probed for a reason: `set-default graphical.target` is the near-miss
# that makes graphical.target come up at the next boot without touching the boot
# loader at all, and it is indistinguishable from a correct answer everywhere else
# in this grader. antisolutions/02 is exactly that answer and this is the only
# checkpoint that catches it.
#
# The unit name is extracted by line shape rather than by comparing the whole
# capture, and that is not defensive habit - comparing the whole capture failed all
# three of this task's reboot fixtures on the guest. In verdict B the boot argument
# the student pinned is finally on the kernel commandline, which is the entire point
# of the task, and `systemctl get-default` then prepends an advisory line:
#
#   Note: found "systemd.unit" on the kernel commandline, which overrides the default unit.
#   multi-user.target
#
# The default target was still multi-user.target in every one of those runs. Only
# the reading was wrong, and it was wrong in the one phase the task exists to grade:
# verdict A passes because the argument is written to the boot loader but not yet
# active, so a whole-capture comparison looks correct right up until the reboot it
# is supposed to survive. No simulation produces this - it needs a real kernel
# commandline - which is why it took a guest run to find.
#
# Matching `^<unit>.target$` is deliberately independent of which stream the note
# arrives on, so it cannot break again if that ever changes; `2>&1` is kept because
# the raw text is worth having in the failure detail.
target_raw=$(systemctl get-default 2>&1)
target=$(printf '%s\n' "$target_raw" | grep -xE '[[:alnum:]@._:-]+\.target' | tail -n 1)
[ "$target" = "multi-user.target" ]
ck default-target-unchanged "default.target is still multi-user.target" $? \
  "get-default=$(printf '%s' "$target_raw" | tr '\n' ' ')"

# Knowingly unprobed, for the same reason systemd/017 leaves it unprobed: this task
# is graded over ssh, so a fixture that broke sshd would take the grader down with
# it rather than be caught by it. troubleshooting/028 is where that failure is
# staged on purpose, over vmrun.
# unprobed-invariant: sshd-intact
sshd_state=$(systemctl is-enabled sshd 2>&1)
printf '%s' "$sshd_state" | grep -x -- enabled >/dev/null
ck sshd-intact "sshd is still enabled" $? "is-enabled=$sshd_state"

exit 0
