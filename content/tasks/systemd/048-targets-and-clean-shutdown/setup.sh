#!/usr/bin/env bash
set -uo pipefail

# No `set -e`. Half of what follows is idempotent removal - cancelling a shutdown
# that is not scheduled, disabling a unit that does not exist, stripping a kernel
# argument that is not there - and all three legitimately fail on a first run. The
# commands that MUST work are wrapped in `need` instead. Same contract as
# content/tasks/systemd/017-boot-time-service/setup.sh: a silent failure here
# stages the wrong machine and every checkpoint afterwards is a lie.
need() { "$@" || { printf 'setup.sh: FAILED: %s\n' "$*" >&2; exit 1; }; }
fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

UNIT=rhcsa-maintenance-window.service
UNIT_PATH=/etc/systemd/system/$UNIT
PIN='systemd.unit=graphical.target'
# Written by systemd-logind when a shutdown is scheduled. The path is a literal in
# the shipped /usr/lib/systemd/systemd-logind of systemd-252 (alongside its error
# string "Failed to write information about scheduled shutdowns"), which is why the
# grader is allowed to read it. What no shipped file states is whether logind
# *removes* it on cancel, so this script proves that round trip below rather than
# assuming it - see "the cancel round trip".
SCHED=/run/systemd/shutdown/scheduled

# `sudo test -e` because /run/systemd/shutdown is root-owned; bounded because
# logind writes the file from a D-Bus method handler and this script must never
# hang waiting for it.
wait_for() { # wait_for present|absent PATH SECONDS
  local want=$1 path=$2 limit=$3 i=0
  while [ "$i" -lt "$limit" ]; do
    if [ "$want" = present ] && sudo test -e "$path"; then return 0; fi
    if [ "$want" = absent ] && ! sudo test -e "$path"; then return 0; fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# --- tools -----------------------------------------------------------------
# grubby is the only reader that resolves a BLS entry the way the boot loader
# does, so the grader depends on it and this has to be a loud precondition
# rather than a fail-closed branch nobody reads.
command -v grubby >/dev/null || fail "grubby is not installed; boot-arg-pinned cannot be measured"
rpm -q grubby >/dev/null 2>&1 || fail "grubby is present but not owned by an rpm; refusing to grade against it"
command -v systemctl >/dev/null || fail "systemctl is missing"
[ -x /usr/sbin/shutdown ] || fail "/usr/sbin/shutdown is missing; the re-arming unit cannot run"

# --- cleanup, idempotent ---------------------------------------------------
sudo shutdown -c &>/dev/null
sudo systemctl disable --now "$UNIT" &>/dev/null
sudo systemctl unmask "$UNIT" &>/dev/null
sudo rm -f "$UNIT_PATH"
sudo systemctl daemon-reload
# --update-kernel=ALL is what makes this a real reset: on grub2 it strips the
# argument from every BLS entry, from grubenv's kernelopts, from
# GRUB_CMDLINE_LINUX in /etc/default/grub and from /etc/kernel/cmdline
# (/usr/libexec/grubby/grubby-bls, update_bls_fragment). Leaving it in any one of
# those would let boot-arg-pinned pass at baseline.
sudo grubby --update-kernel=ALL --remove-args=systemd.unit &>/dev/null

# --- invariants, staged and then proved ------------------------------------
# These two are what the student must NOT break, so they have to be true before
# the student starts: a failure afterwards can then only mean the student did it.
need sudo systemctl set-default multi-user.target
need sudo systemctl enable sshd

# --- preconditions ---------------------------------------------------------
# Every goal checkpoint measures a property of the starting state, and every one
# of them gets a check here. A precondition that only guards this script would
# leave a checkpoint free to pass at baseline for a reason that has nothing to do
# with the student, which is a student-facing false pass.

# boot-arg-pinned reads exactly this, so this has to parse exactly the way the
# grader parses: the args= line of the DEFAULT entry, with $kernelopts already
# expanded (grubby does that in get_bls_args; nothing else does).
info=$(timeout 60 sudo grubby --info=DEFAULT 2>&1) \
  || fail "grubby --info=DEFAULT failed: $info"
args=$(printf '%s\n' "$info" | sed -n 's/^args="\(.*\)"$/\1/p')
[ -n "$args" ] \
  || fail "grubby --info=DEFAULT printed no args= line; boot-arg-pinned would fail for every fixture including both solutions"
case " $args " in
  *" $PIN "*) fail "the default boot entry already carries $PIN; boot-arg-pinned would pass at baseline" ;;
esac
case " $args " in
  *" systemd.unit="*) fail "the default boot entry still carries a systemd.unit= argument after --remove-args: $args" ;;
esac

# graphical-target-active. Three separate things have to hold, and the second and
# third are the safety argument for asking a student to isolate a target on a
# machine that is graded over ssh:
#
#   1. graphical.target must not be active yet, or the checkpoint passes at baseline.
#   2. It must exist and permit isolation. The shipped unit sets AllowIsolate=yes
#      and Requires=multi-user.target, so everything multi-user.target pulls in -
#      sshd.service and NetworkManager.service among them - is inside the new
#      target's transaction and gets a start job, not a stop job. Isolating is not
#      free of stops (transaction_add_isolate_jobs() in systemd-252
#      src/core/transaction.c:1095 queues JOB_STOP for every active unit outside
#      that transaction), but on this guest the only units outside it are
#      D-Bus-activated ones - dbus-broker.service, polkit.service - and dbus.socket
#      itself stays up because sockets.target is inside, so the next connection
#      brings them straight back. Mounts, swaps, devices, slices and the ssh
#      session's own scope are exempt outright: scope.c, slice.c, mount.c, swap.c,
#      device.c and automount.c all set ignore_on_isolate = true at init.
#   3. There must be no display-manager.service. That is what makes claim 2 true
#      on this guest rather than merely likely - with no display manager present
#      graphical.target has literally nothing to add, so `isolate` cannot take a
#      console or a network away from anybody. Wants= on a missing unit is a
#      warning systemd ignores ("Cannot add dependency job, ignoring", a literal
#      in libsystemd-core-252.so), not a failed job.
active=$(systemctl is-active graphical.target 2>&1)
[ "$active" != "active" ] \
  || fail "graphical.target is already active (is-active=$active); graphical-target-active would pass at baseline"
allow=$(systemctl show -p AllowIsolate --value graphical.target 2>&1)
[ "$allow" = "yes" ] \
  || fail "graphical.target reports AllowIsolate='$allow', not yes; the task asks for an isolate that cannot work"
req=$(systemctl show -p Requires --value graphical.target 2>&1)
case " $req " in
  *" multi-user.target "*) ;;
  *) fail "graphical.target does not Require multi-user.target on this guest (Requires=$req); isolating it could stop sshd" ;;
esac
if systemctl cat display-manager.service &>/dev/null; then
  fail "a display-manager.service exists on this guest; isolating graphical.target would start a display manager and this task is not safe here"
fi

# default-target-unchanged and sshd-intact are invariants. Prove them, with the
# grader's own spelling - `grep -x enabled`, because is-enabled exits 0 for static,
# indirect, generated, alias and enabled-runtime too, and an invariant that fails
# for every fixture is worse than no invariant.
# Same line-shape extraction as grade.sh's, for the same reason and deliberately
# spelled the same way. setup.sh only ever runs on a freshly reverted guest, where
# nothing is on the kernel commandline yet and the advisory note cannot appear, so
# this copy was never the one that failed - but a precondition that reads the system
# differently from the grader it is a precondition for is a trap, and this one would
# spring the moment anything ran setup on a guest that had already booted with the
# argument pinned.
target_raw=$(systemctl get-default 2>&1)
target=$(printf '%s\n' "$target_raw" | grep -xE '[[:alnum:]@._:-]+\.target' | tail -n 1)
[ "$target" = "multi-user.target" ] \
  || fail "get-default reports '$target' after set-default (full output: $(printf '%s' "$target_raw" | tr '\n' ' ')); the default-target-unchanged invariant would fail for every fixture"
sshd_state=$(systemctl is-enabled sshd 2>&1)
printf '%s' "$sshd_state" | grep -x -- enabled >/dev/null \
  || fail "sshd reports is-enabled='$sshd_state', not enabled, after 'systemctl enable sshd'; the sshd-intact invariant would fail for every fixture"

# A scheduled shutdown is runtime state and that is the whole lesson of the second
# half, so the claim gets checked instead of assumed. On a guest where /run
# persisted, cancelling would look identical to never scheduling after a boot.
runfs=$(findmnt -no FSTYPE /run 2>/dev/null)
[ "$runfs" = "tmpfs" ] \
  || fail "/run is ${runfs:-not a mount point}, not tmpfs; a scheduled shutdown would not be runtime state here"

# --- the cancel round trip -------------------------------------------------
# Plant, confirm the grader's signal appears, cancel, confirm it disappears, plant
# again. The middle two steps are the part that matters: they prove `shutdown -c`
# actually clears what the grader reads, on this guest, before any fixture depends
# on it. Without them a logind that left the file behind would fail
# no-reboot-pending for both solutions and the failure would point at the student.
#
# -r, never -h. A reboot 48 hours out is the only schedule this task will ever
# plant: nothing here may power the guest off, and 2880 minutes is also far enough
# out that logind never creates /run/nologin, which is checked below because that
# file would lock student out of ssh and end the exercise.
need sudo shutdown -r +2880
wait_for present "$SCHED" 15 \
  || fail "$SCHED did not appear after 'shutdown -r +2880'; no-reboot-pending would pass at baseline"
need sudo shutdown -c
wait_for absent "$SCHED" 15 \
  || fail "$SCHED survived 'shutdown -c' on this guest; no-reboot-pending could never pass for a correct answer"
need sudo shutdown -r +2880
wait_for present "$SCHED" 15 \
  || fail "$SCHED did not reappear after the second 'shutdown -r +2880'"

# pam_nologin refuses every non-root login while this file exists, and the grader
# logs in as student. shutdown(8) says it is created 5 minutes before the system
# goes down, so 48 hours out it must not be there - but "must not" is exactly the
# kind of claim worth measuring rather than quoting.
[ ! -e /run/nologin ] \
  || fail "/run/nologin exists; student logins are blocked and no grade run can succeed"

# --- the re-arming unit ----------------------------------------------------
# This is what gives the shutdown half a post-reboot answer at all. Cancelling a
# schedule is runtime state and a reboot wipes it, so "did you cancel it" cannot
# be asked again in verdict B - but "does it come back" can, and only if something
# puts it back. Hence an enabled oneshot that re-schedules at every boot.
#
# Before=sshd.service is not cosmetic and must not be removed: the grader arrives
# over ssh, so without that ordering verdict B would race the unit and
# no-reboot-pending could pass at baseline just because the grader got there first.
# Ordering only - sshd still starts if this unit fails.
#
# logind is the other half of the same worry, and it is the ONLY other name here.
# `shutdown -r +NN` is a D-Bus client: it calls ScheduleShutdown on
# org.freedesktop.login1, so logind must be reachable or the unit fails and the
# baseline quietly stops failing no-reboot-pending in verdict B. dbus.socket is
# already up (sockets.target -> basic.target, and this unit is After=basic.target
# by default) and will socket-activate the broker, so the bus needs no mention.
#
# polkit deliberately gets no mention either, which is a correction of the obvious
# guess: root never reaches polkit for this call. logind's verify_shutdown_creds()
# passes CAP_SYS_BOOT to bus_verify_polkit_async() on all three of its branches,
# and sd_bus_query_sender_privilege() returns 1 the moment
# sd_bus_creds_has_effective_cap() finds that capability - polkitd is never
# contacted (systemd-252 src/login/logind-dbus.c, src/shared/bus-polkit.c,
# src/libsystemd/sd-bus/bus-convenience.c:659-690). Naming polkit.service here
# would have pulled it into the boot transaction and put one more service in front
# of sshd on a guest that is graded over ssh, for no authorization benefit.
if ! sudo tee "$UNIT_PATH" >/dev/null <<'EOF'
[Unit]
Description=Re-arm the change window reboot at every boot
Documentation=man:shutdown(8)
Wants=systemd-logind.service
After=systemd-logind.service
Before=sshd.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/shutdown -r +2880

[Install]
WantedBy=multi-user.target
EOF
then
  fail "FAILED: staging $UNIT_PATH"
fi
need sudo chmod 0644 "$UNIT_PATH"
need sudo restorecon "$UNIT_PATH"
need sudo systemctl daemon-reload
# enable, not `enable --now`: the schedule is already planted above, and running
# the unit here would only re-plant the same thing.
need sudo systemctl enable "$UNIT"

unit_state=$(systemctl is-enabled "$UNIT" 2>&1)
printf '%s' "$unit_state" | grep -x -- enabled >/dev/null \
  || fail "$UNIT reports is-enabled='$unit_state', not enabled; rearm-unit-disabled would pass at baseline"
# The unit must actually work, or verdict B of the baseline fixture would find
# nothing scheduled and the baseline would stop failing after the reboot. Running
# it by hand is the only check available before a boot: it re-schedules what is
# already scheduled, so the state afterwards is unchanged and the exit status is
# real evidence.
need sudo systemctl start "$UNIT"
wait_for present "$SCHED" 15 \
  || fail "$UNIT ran but $SCHED is absent; the baseline would stop failing no-reboot-pending in verdict B"
[ ! -e /run/nologin ] || fail "/run/nologin exists after starting $UNIT; student logins are blocked"

cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
