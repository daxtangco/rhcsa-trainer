#!/usr/bin/env bash
# Grader for sys/040-time-and-tuning.
#
# READ-ONLY. Changes nothing on the guest. The exit code is ignored; only the
# JSONL the checkpoint helpers write to stdout is read. content/lib/assert.sh is
# prepended by loadTaskScripts, so those helpers are already in scope - do not
# source it. (Their names are left unspelled in every comment in this file on
# purpose: the id extractor documented in docs/r1-findings.md reads comment text
# as readily as code, so prose that looks like a call invents a checkpoint.)
#
# ---------------------------------------------------------------------------
# Why nothing here looks at `chronyc tracking`, and why that is not an omission.
#
# In drill and exam modes the trainer drops the guest's default route
# (docs/offline-mode.md), and the address this task names is in 192.0.2.0/24, the
# documentation range. The host can therefore never exchange a packet with its
# time server: `chronyc tracking` will report `Leap status : Not synchronised`
# and `chronyc sources` will show the source unreachable (state `?`) for as long
# as the lab runs. A checkpoint on synchronisation would fail every fixture,
# including both correct solutions, and it would fail for a reason the student
# cannot fix - which reads as a content bug and teaches nothing.
#
# So this grader measures what the objective actually is - "configure time
# service clients": which source is configured, whether the service is running
# and will run again, and what the system thinks its time zone is. Reachability
# is the network's business, not the student's.
#
# `timedatectl`'s own `NTP service: active` line is deliberately NOT a checkpoint
# either, and for a different reason: on RHEL 9 systemd-timedated computes it
# from chronyd.service's unit state (chronyd is the only entry in
# /usr/lib/systemd/ntp-units.d), so it cannot be true when chronyd-active is
# false or false when it is true. It would be a ninth verdict line that can never
# disagree with an existing one, and this bank grades one checkpoint per
# independent failure mode. `timedatectl set-ntp true` is a perfectly good route
# to chronyd-enabled and chronyd-active - solutions/02 takes it - and both of
# those checkpoints see it. The line is reported inside chronyd-active's detail
# so a student who typed set-ntp still sees the vocabulary they used.
#
# There is also no fail-closed preamble like storage/014's, because there is
# nothing to fail closed about: every target this file compares against is a
# literal spelled in the block below, and every probe is a positive match on
# command output. The one negative check - chrony-sole-source, "no OTHER source
# is configured" - is the one shape that could pass by finding nothing at all, so
# it is guarded explicitly where it is emitted.
# ---------------------------------------------------------------------------
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: timezone-set, chronyd-enabled, chronyd-active, chrony-source-live, chrony-source-persistent, chrony-sole-source, tuned-enabled, tuned-profile
set -uo pipefail

# Spelled identically in setup.sh.
WANT_TZ=Asia/Tokyo
NTP_SERVER=192.0.2.10
WANT_PROFILE=throughput-performance

CHRONY_CONF=/etc/chrony.conf
CHRONY_DIR=/etc/chrony.d

# One property out of `timedatectl show`, read the portable way (see setup.sh's
# copy). awk reads to EOF, so this is not the `producer | grep -q` SIGPIPE trap
# content/lib/assert.sh documents.
td_prop() {
  timedatectl show -p "$1" 2>/dev/null | awk -F= 'NR == 1 { print substr($0, index($0, "=") + 1) }'
}

# --- 1. the time zone -----------------------------------------------------
# Two witnesses, either sufficient, because there are two documented ways to set
# a time zone and both are correct answers (spec 6.5 rule 1):
# `timedatectl set-timezone Asia/Tokyo`, and the classic
# `ln -sf /usr/share/zoneinfo/Asia/Tokyo /etc/localtime`. The second is why the
# symlink is read directly: systemd-timedated is bus-activated and exits when
# idle, and a grader that trusted only its answer would be trusting a cache to
# have noticed a symlink somebody replaced by hand.
#
# What neither witness accepts is a COPY of the zone file over /etc/localtime.
# `date` would show the right time, but timedatectl reports nothing, every tool
# that asks systemd for the zone is wrong, and it is not what any manual page
# tells you to do. readlink -f on a regular file returns the file's own path, so
# that answer lands here as a fail with the path in the detail.
tz=$(td_prop Timezone)
tzlink=$(readlink -f /etc/localtime 2>/dev/null)
# The offset is evidence, not a criterion: Asia/Tokyo is +0900 all year (no DST),
# so a student reading the detail can see whether glibc agrees with systemd.
offset=$(date +%z 2>/dev/null)
if [[ $tz == "$WANT_TZ" || $tzlink == "/usr/share/zoneinfo/$WANT_TZ" ]]; then
  ck_pass timezone-set "the system time zone is $WANT_TZ"
else
  ck_fail timezone-set "the system time zone is $WANT_TZ" \
    "timedatectl reports Timezone=${tz:-nothing}, /etc/localtime resolves to ${tzlink:-nothing}, date reports offset ${offset:-unknown}"
fi

# --- 2 and 3. the time service -------------------------------------------
# Two checkpoints, not one, because running and will-run-again are independent
# properties (content/concepts/systemd/enabled-vs-started.md). A student who only
# ran `systemctl start chronyd` has a clock that is kept today and not after the
# next reboot.
#
# Anchored on the exact string rather than on is-enabled's exit status, which is
# also 0 for static, indirect, generated, alias and enabled-runtime. Only
# "enabled" means a symlink in /etc that survives a reboot, which is what the
# checkpoint name claims. Same spelling as sys/035's crond-enabled.
en=$(systemctl is-enabled chronyd 2>&1)
printf '%s' "$en" | grep -qx enabled
ck chronyd-enabled "chronyd is enabled at boot" $? "is-enabled=$en"

# Before the reboot this only says the student started it. After the reboot
# nothing started it by hand, so `active` can only mean systemd pulled it in at
# boot - the same trick sys/035's crond-active uses.
act=$(systemctl is-active chronyd 2>&1)
ntp_line=$(timedatectl show -p NTP -p NTPSynchronized 2>&1 | tr '\n' ' ')
printf '%s' "$act" | grep -qx active
ck chronyd-active "chronyd is running" $? "is-active=$act; timedatectl says ${ntp_line:-nothing}"

# --- 4. the running daemon's own source list ------------------------------
# Asked of chronyd rather than of a file, because a configuration file the daemon
# has not read is not a configured client. This is the half that catches an edit
# made after the service was started and never reloaded, and the half a runtime
# `chronyc add server` passes.
#
# -n so chronyc does not try to reverse-resolve addresses: with no default route
# every lookup would wait for a DNS timeout, and a grader that hangs is worse
# than one that fails. timeout as a second belt for the same reason.
#
# The address is compared as a WHOLE FIELD, never as a substring, so a host
# pointed at 192.0.2.100 cannot satisfy a task that asked for 192.0.2.10. That
# rules out `grep -F -- 192.0.2.10`, even as a loosen-up fallback: measured
# against chronyc's real table, `grep -F` accepts the 192.0.2.100 line and hands
# a wrong answer a green checkpoint, which is worse than anything it was there to
# protect against.
#
# So both passes are awk, and neither is a substring test. The first knows
# chronyc's layout: `chronyc -n sources` formats each row as `%c%c %-27s ...`
# (read out of the chronyc binary), a two-character mode/state pair in column 1
# and the address in column 2. `^?`, `^*`, `=+`, `#*`; the `====` separator line
# satisfies the column-1 test too and is harmless, because its column 2 is empty.
# The second pass is the column-drift insurance the grep was meant to be: any
# field of any line, still compared whole. Both read to EOF, so neither is the
# `producer | grep -q` SIGPIPE trap content/lib/assert.sh documents.
live_out=$(sudo timeout 20 chronyc -n sources 2>&1)
live_rc=$?
live_has=no
if (( live_rc == 0 )); then
  if printf '%s\n' "$live_out" | awk -v ip="$NTP_SERVER" '
        $1 ~ /^[=#^]/ && $2 == ip { hit = 1 } END { exit hit ? 0 : 1 }'; then
    live_has=yes
  elif printf '%s\n' "$live_out" | awk -v ip="$NTP_SERVER" '
        { for (i = 1; i <= NF; i++) if ($i == ip) hit = 1 } END { exit hit ? 0 : 1 }'; then
    live_has=yes
  fi
fi

if [[ $live_has == yes ]]; then
  ck_pass chrony-source-live "the running chronyd is using $NTP_SERVER as a time source"
else
  ck_fail chrony-source-live "the running chronyd is using $NTP_SERVER as a time source" \
    "chronyc -n sources exited $live_rc and did not list it: $(printf '%s' "${live_out:-no output}" | tr '\n' ' ' | cut -c1-160). chronyd reads its configuration when it starts, so an edit made afterwards needs a restart; a source added with 'chronyc add' is never read from a file at all; and a drop-in under $CHRONY_DIR is only read if $CHRONY_CONF has a confdir line that includes it"
fi

# --- 5 and 6. what is written down ---------------------------------------
# The on-disk configuration, which is what makes the answer survive a reboot.
# chrony.conf(5): a line whose first non-blank character is #, !, ; or % is a
# comment, and a source is declared by `server`, `pool` or `peer`. Same grammar as
# setup.sh's copy. Read under sudo because a drop-in a student created by hand may
# be mode 0600 root:root, and "the grader could not read it" must never be graded
# as "there is no source there".
chrony_sources() {
  (( $# > 0 )) || return 0
  sudo awk '
    /^[[:space:]]*[#!;%]/ { next }
    /^[[:space:]]*$/      { next }
    {
      d = tolower($1)
      if (d == "server" || d == "pool" || d == "peer")
        printf "%s\t%s\t%s\n", FILENAME, d, (NF >= 2 ? $2 : "(none)")
    }' "$@" 2>/dev/null
}

# A drop-in only counts if chronyd would actually read it. Measured against the
# guest's own package (chrony-4.8-1.el9, RHEL 9.8): the stock /etc/chrony.conf
# contains no `confdir` and no `include` line, the RPM does not create
# /etc/chrony.d at all, and the chronyd binary carries no built-in default for
# that path. So on this image a file dropped into /etc/chrony.d is a file the
# daemon never opens, and counting it as "configured" would pass
# chrony-source-persistent - the checkpoint whose whole claim is "this survives
# the reboot" - for a host that comes back with no source. The directory is
# therefore read only when chrony.conf names it, which is what
# solutions/02-zoneinfo-symlink-dropin-and-setntp.sh has to add for its drop-in
# to work at all. grep on a FILE, so there is no producer for -q to kill (the
# SIGPIPE trap content/lib/assert.sh documents); -s because the file may be
# unreadable rather than absent.
dropins_included=no
if sudo grep -qsE "^[[:space:]]*(confdir|include)[[:space:]]+$CHRONY_DIR" "$CHRONY_CONF"; then
  dropins_included=yes
fi

cfgs=()
while read -r f; do
  [[ -n $f ]] && cfgs+=("$f")
done < <(
  sudo test -f "$CHRONY_CONF" && printf '%s\n' "$CHRONY_CONF"
  [[ $dropins_included == yes ]] &&
    sudo find "$CHRONY_DIR" -maxdepth 1 -type f -name '*.conf' 2>/dev/null | sort
)

if (( ${#cfgs[@]} == 0 )); then
  # This is the fail-closed branch chrony-sole-source needs. "No other source is
  # configured" is a negative claim, and a negative claim over an empty set is
  # true - so a grader that could not read a single configuration file would
  # report the host as correctly single-sourced. Both checkpoints fail instead.
  detail="no chrony configuration file could be read at $CHRONY_CONF or under $CHRONY_DIR"
  ck_fail chrony-source-persistent "$NTP_SERVER is configured as a time source in chrony's configuration" "$detail"
  ck_fail chrony-sole-source "no time source other than $NTP_SERVER is configured" "$detail"
else
  srcs=$(chrony_sources "${cfgs[@]}")
  # Whole-field comparison, not a substring search: `grep -F 192.0.2.10` would
  # also accept a host pointed at 192.0.2.100.
  want_count=$(printf '%s\n' "$srcs" | awk -F'\t' -v ip="$NTP_SERVER" '$3 == ip { n++ } END { print n + 0 }')
  other=$(printf '%s\n' "$srcs" | awk -F'\t' -v ip="$NTP_SERVER" '
      NF >= 3 && $3 != ip { printf "%s in %s; ", $3, $1 }')

  if (( want_count > 0 )); then
    ck_pass chrony-source-persistent "$NTP_SERVER is configured as a time source in chrony's configuration"
  else
    ck_fail chrony-source-persistent "$NTP_SERVER is configured as a time source in chrony's configuration" \
      "no server, pool or peer line naming $NTP_SERVER in ${cfgs[*]} (drop-ins under $CHRONY_DIR searched: $dropins_included); a source added with 'chronyc add' lives in the running daemon only and is gone at the next boot, and a drop-in under $CHRONY_DIR is read by neither chronyd nor this check unless $CHRONY_CONF carries a confdir or include line naming that directory - RHEL 9's stock file carries neither"
  fi

  # The half of the ticket that says "and from nothing else". The stock RHEL 9
  # chrony.conf ships `pool 2.rhel.pool.ntp.org iburst`, and adding a server
  # without dealing with that line leaves a host that still asks the internet for
  # the time - the answer that satisfies the letter of the prompt and not the
  # point of it. Commenting the line out and deleting it are equally correct;
  # nothing here cares which.
  if [[ -z $other ]]; then
    ck_pass chrony-sole-source "no time source other than $NTP_SERVER is configured"
  else
    ck_fail chrony-sole-source "no time source other than $NTP_SERVER is configured" \
      "still configured: ${other%; }"
  fi
fi

# --- 7 and 8. the tuning profile -----------------------------------------
# tuned-enabled, on the same reasoning as chronyd-enabled: a profile applied by a
# tuned that was started and never enabled is gone at the next boot, and nothing
# visible today says so.
ten=$(systemctl is-enabled tuned 2>&1)
printf '%s' "$ten" | grep -qx enabled
ck tuned-enabled "tuned is enabled at boot" $? "is-enabled=$ten"

# The profile, asked of tuned itself. NOT read out of /etc/tuned/active_profile:
# that file records what was requested, not what is in effect, so a machine whose
# tuned is dead still reads back the right answer there. `tuned-adm active` is
# what the manual page tells a student to check and what the exam question means
# by "the active profile".
#
# Conjoined with is-active on purpose, and on this image that conjunct is doing
# real work rather than being defensive. Read out of the guest's own package
# (tuned-2.27.0-2.el9_8, tuned/admin/admin.py): when the D-Bus call fails
# `tuned-adm active` FALLS BACK to reading /etc/tuned/active_profile, and on a
# host where tuned is not running it prints "Preset profile: <name>" instead of
# "Current active profile: <name>". So two independent things stop a dead tuned
# from scoring green here - the awk below only accepts the "Current active
# profile:" wording, and this comparison requires the unit to be active - and
# that redundancy is deliberate, because the wording is a release detail and the
# unit state is not. It is also the honest reading of "the profile in effect": a
# stopped tuned has none. This is why there is no separate tuned-active
# checkpoint - the fact is inside this one, named in the description so no
# verdict is silent about it.
#
# Read-only, verified rather than assumed: the tuned package ships no
# /usr/share/dbus-1/system-services/com.redhat.tuned.service, so tuned is NOT
# bus-activatable and the call below cannot start the daemon this grader is
# measuring. (`tuned-adm profile` would try `service tuned restart`; `tuned-adm
# active` never does.) is-active is captured first regardless.
tact=$(systemctl is-active tuned 2>&1)
tuned_out=$(sudo timeout 30 tuned-adm active 2>&1)
tuned_rc=$?
profile=$(printf '%s\n' "$tuned_out" | awk -F':[[:space:]]*' '
    /^Current active profile:/ { v = $2 }
    END { gsub(/[[:space:]]+$/, "", v); print v }')

if [[ $tact == active && $profile == "$WANT_PROFILE" ]]; then
  ck_pass tuned-profile "tuned is running and reports $WANT_PROFILE as the active profile"
else
  ck_fail tuned-profile "tuned is running and reports $WANT_PROFILE as the active profile" \
    "is-active=$tact; tuned-adm active exited $tuned_rc and reported profile '${profile:-none}': $(printf '%s' "${tuned_out:-no output}" | tr '\n' ' ' | cut -c1-160)"
fi

# --- 9. the invariant ----------------------------------------------------
# The hardware clock is still kept in UTC. This passes on an untouched machine -
# RHEL keeps the RTC in UTC and /etc/adjtime says so - so it is not a
# baseline-fail; it exists to catch the answer that goes after the wall clock
# instead of the time zone. `timedatectl set-local-rtc 1` makes `date` look no
# different, writes LOCAL into /etc/adjtime, survives the reboot, and breaks
# every consumer that assumes the RTC is UTC. antisolutions/05 does exactly that,
# which is what anchors this id: it is probed, not declared unprobed.
#
# Fails closed by construction: an empty read is not "no", so a guest where
# timedatectl could not answer fails this rather than passing it.
localrtc=$(td_prop LocalRTC)
if [[ $localrtc == no ]]; then
  ck_pass rtc-utc "the hardware clock is still kept in UTC"
else
  ck_fail rtc-utc "the hardware clock is still kept in UTC" \
    "timedatectl reports LocalRTC=${localrtc:-nothing}; /etc/adjtime holds $(sudo tail -n1 /etc/adjtime 2>/dev/null || echo 'nothing readable')"
fi

exit 0
