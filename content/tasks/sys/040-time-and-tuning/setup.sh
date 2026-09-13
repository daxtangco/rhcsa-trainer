#!/usr/bin/env bash
# Prepare the system for sys/040-time-and-tuning.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell.
#
# IDEMPOTENT. It has to be: the harness reverts the `clean` snapshot before every
# fixture, but a human studying in the Lab screen re-runs setup by hand on a
# machine they have already been poking at. The one thing a re-run cannot
# reconstruct is a stock /etc/chrony.conf, so the first run keeps a copy of it in
# /var/lib/rhcsa-lab and every later run restores from that copy. If there is no
# copy and the file has already been pointed at the lab server, this script fails
# and says so rather than inventing a "stock" chrony.conf of its own - a staged
# baseline nobody can audit is worse than a refusal.
#
# `set -uo pipefail` without -e, following
# content/tasks/sys/035-persistent-journal-and-schedule/setup.sh: this file is
# full of removals and disables that legitimately fail on a first run (there is
# no drop-in to delete, chronyd was never enabled). The commands that MUST work
# are wrapped in `need`, because a silent failure here stages the wrong machine
# and every checkpoint result afterwards is a lie.
set -uo pipefail

need() { "$@" || { printf 'setup.sh: FAILED: %s\n' "$*" >&2; exit 1; }; }
fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

# Spelled identically in grade.sh. If these ever disagree the task becomes
# unsatisfiable for every answer.
WANT_TZ=Asia/Tokyo
NTP_SERVER=192.0.2.10
WANT_PROFILE=throughput-performance
# The profile the template was left on, and the baseline this script stages.
# virtual-guest is what tuned's own `recommend` picks for a VM, so it is also
# what an untouched guest would land on by itself - staging it explicitly only
# makes that deterministic.
BASE_PROFILE=virtual-guest

BASE_TZ=UTC
CHRONY_CONF=/etc/chrony.conf
CHRONY_DIR=/etc/chrony.d
DHCP_SOURCEDIR=/run/chrony-dhcp
STAMP_DIR=/var/lib/rhcsa-lab
BASELINE=$STAMP_DIR/040-chrony.conf.baseline
TUNED_ACTIVE=/etc/tuned/active_profile

# One property out of `timedatectl show`, read the portable way. `--value` would
# be shorter and is fine on systemd 252, but awk on `Property=value` works on
# every version and costs nothing. awk reads to EOF, so this is not the
# `producer | grep -q` SIGPIPE trap content/lib/assert.sh documents.
td_prop() {
  timedatectl show -p "$1" 2>/dev/null | awk -F= 'NR == 1 { print substr($0, index($0, "=") + 1) }'
}

# Every time source the on-disk configuration declares, as `directive<TAB>address`.
# Same grammar as grade.sh's copy - chrony.conf(5) says a line whose first
# non-blank character is #, !, ; or % is a comment, and that a source is declared
# by `server`, `pool` or `peer`. Read under sudo because a drop-in a student
# created by hand may be mode 0600 root:root, and "the grader could not read it"
# must never be graded as "there is no source there".
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

# Is ADDRESS one of the addresses in a chrony_sources listing? An exact field
# comparison, not a substring search: `grep -F 192.0.2.10` would also match a
# host that had been pointed at 192.0.2.100.
has_source() {
  printf '%s\n' "$1" | awk -F'\t' -v ip="$2" '$3 == ip { hit = 1 } END { exit hit ? 0 : 1 }'
}

# The config files chronyd would actually read, enumerated with find rather than a
# glob so a drop-in directory left mode 0700 root:root is still seen.
#
# $CHRONY_DIR is included only when $CHRONY_CONF names it with confdir or include,
# for the reason grade.sh's copy spells out: chrony-4.8-1.el9's stock chrony.conf
# carries neither directive, the RPM does not create /etc/chrony.d, and chronyd has
# no built-in default for it - so an un-included drop-in is a file nothing reads.
# This must match grade.sh exactly, because the assertions at the bottom of this
# script are only meaningful if they see what the grader will see: an enumeration
# wider than the grader's could satisfy "some other source is configured" from a
# file the grader ignores, and chrony-sole-source would then pass at baseline with
# nothing to remove - the one defect this script exists to prevent.
chrony_config_files() {
  local -a out=()
  sudo test -f "$CHRONY_CONF" && out+=("$CHRONY_CONF")
  if sudo grep -qsE "^[[:space:]]*(confdir|include)[[:space:]]+$CHRONY_DIR" "$CHRONY_CONF"; then
    local f
    while read -r f; do
      [[ -n $f ]] && out+=("$f")
    done < <(sudo find "$CHRONY_DIR" -maxdepth 1 -type f -name '*.conf' 2>/dev/null | sort)
  fi
  (( ${#out[@]} > 0 )) && printf '%s\n' "${out[@]}"
  return 0
}

# --- packages -------------------------------------------------------------
# Both objectives rest on a package that a Minimal Install omits, and
# docs/vm-build-checklist.md:71 specifies Server rather than Minimal precisely
# so that tools like these are present. Installed here anyway, from the
# ISO-backed repo scripts/guest-provision.sh writes, because the alternative is a
# grader that fails every checkpoint on a guest that is merely missing a package
# - a failure pointing at the student instead of at the image. `< /dev/null`
# because dnf reads stdin and this script's stdin is the rest of the script.
for pkg in chrony tuned; do
  if ! rpm -q "$pkg" &>/dev/null; then
    sudo dnf -y install "$pkg" &>/dev/null < /dev/null
    rpm -q "$pkg" &>/dev/null \
      || fail "$pkg is not installed and 'dnf -y install $pkg' did not fix that; check that /etc/yum.repos.d/rhcsa-dvd.repo points at a mounted DVD (docs/vm-build-checklist.md section 3.3)"
  fi
done

# --- preconditions this script itself needs -------------------------------
systemctl cat chronyd.service &>/dev/null \
  || fail "chronyd.service does not exist even though the chrony package is installed; this guest's chrony install is broken"
systemctl cat tuned.service &>/dev/null \
  || fail "tuned.service does not exist even though the tuned package is installed; this guest's tuned install is broken"
command -v chronyc >/dev/null \
  || fail "chronyc is missing, so no answer could be checked against the running chronyd"
sudo sh -c 'command -v tuned-adm' >/dev/null \
  || fail "tuned-adm is missing, so the tuned profile could neither be set nor graded"

# The two profiles this task names have to exist on the guest. Checked in both
# layouts on purpose: RHEL 9's tuned keeps profiles in /usr/lib/tuned/<name>,
# and newer tuned moved them under /usr/lib/tuned/profiles/<name>. Asking tuned
# itself would be nicer but needs the daemon running, and this script's whole
# job is to leave it stopped.
for p in "$WANT_PROFILE" "$BASE_PROFILE"; do
  [[ -d /usr/lib/tuned/$p || -d /usr/lib/tuned/profiles/$p ]] \
    || fail "tuned profile '$p' is not installed under /usr/lib/tuned; this task names it and no answer could satisfy tuned-profile"
done

sudo test -f "$CHRONY_CONF" \
  || fail "$CHRONY_CONF does not exist, so there is no stock configuration to point at the lab server; reinstall chrony"

# --- undo what a previous attempt can safely leave behind -----------------
# Fixture-authored drop-ins first: any file under /etc/chrony.d that names the
# lab server. Matched by CONTENT rather than by filename, because a student or a
# fixture can call it anything, and a leftover would make
# chrony-source-persistent pass at baseline.
while read -r f; do
  [[ -n $f ]] || continue
  # `< /dev/null` on both, so nothing inside the loop can consume the process
  # substitution the loop itself is reading from.
  if sudo grep -qsF -- "$NTP_SERVER" "$f" < /dev/null; then
    sudo rm -f "$f" < /dev/null
  fi
done < <(sudo find "$CHRONY_DIR" -maxdepth 1 -type f -name '*.conf' 2>/dev/null)

need sudo mkdir -p "$STAMP_DIR"
if sudo test -f "$BASELINE"; then
  # Every later run: put the stock file back. This is what makes the script
  # idempotent - it undoes a solution's edit, a fixture's edit and a student's
  # edit in one move, without this file having to know what any of them did.
  need sudo cp -a "$BASELINE" "$CHRONY_CONF"
  # SELinux is Enforcing on this guest. cp -a carries the copy's own context, so
  # this only guarantees what is already true - the same belt-and-braces habit
  # as sys/035's setup.
  sudo restorecon "$CHRONY_CONF" &>/dev/null
else
  # First run on this guest. Only take the copy if the file still looks like the
  # stock one, or the "baseline" this script restores forever after would be
  # somebody's half-finished answer.
  if has_source "$(chrony_sources "$CHRONY_CONF")" "$NTP_SERVER"; then
    fail "$CHRONY_CONF already declares $NTP_SERVER as a time source and there is no saved baseline in $BASELINE to restore, so chrony-source-persistent would pass with no work done. The likeliest cause is that this task was solved on this guest before setup ever ran here; a revert to the \`clean\` snapshot is what makes it runnable again"
  fi
  need sudo cp -a "$CHRONY_CONF" "$BASELINE"
fi

# --- create the situation the prompt describes ----------------------------
# "Handed over at the template's defaults": the clock is on UTC, nothing is
# keeping it, and the tuning profile is the one tuned picks for any VM.
#
# set-local-rtc before set-timezone, and both before the disables: the RTC one is
# a REPAIR, not staging. antisolutions/05 leaves LocalRTC=yes behind, and without
# this a hand re-run after that fixture would start the student on a machine
# where the rtc-utc invariant is already failing - a checkpoint they would be
# blamed for.
sudo timedatectl set-local-rtc 0 &>/dev/null
need sudo timedatectl set-timezone "$BASE_TZ"

# The time service, off. On a stock RHEL 9 install chronyd is enabled and
# running, so without this the student would be graded on two checkpoints that
# were already green. `disable --now` rather than `timedatectl set-ntp false`
# because it says what it does; the two end in the same place.
sudo systemctl disable --now chronyd &>/dev/null

# tuned, off and on the template's profile. Written as a file rather than through
# `tuned-adm profile`, which would need the daemon running and then stopped
# again; /etc/tuned/active_profile is exactly the file tuned-adm writes and
# exactly the file tuned reads at startup.
sudo systemctl disable --now tuned &>/dev/null
need sudo mkdir -p /etc/tuned
printf '%s\n' "$BASE_PROFILE" | sudo tee "$TUNED_ACTIVE" >/dev/null \
  || fail "could not write $TUNED_ACTIVE"
need sudo chmod 0644 "$TUNED_ACTIVE"
# /etc/tuned/profile_mode is deliberately NOT touched, and the reason is worth
# spelling out because it is the one place this staging could have gone wrong.
# tuned-2.27.0-2.el9_8 ships that file EMPTY, and tuned/daemon/daemon.py's
# _get_startup_profile() reads empty as "manual if active_profile names a
# profile" - so on a freshly installed guest the line above is honoured on its
# own. If instead this guest's file says `auto` (which is what tuned writes the
# first time it picks a profile for itself), tuned re-runs `recommend` at startup
# and may ignore active_profile entirely. Neither case can green a checkpoint at
# baseline, because tuned is disabled and stopped here and tuned-profile requires
# is-active - whatever the file says, nothing is applied. And neither can fail a
# correct answer: `tuned-adm profile` writes profile_mode=manual for the student,
# and solutions/02 writes it by hand. Staging a value would be staging a file no
# answer depends on.

# --- verify every precondition the checkpoints depend on ------------------
# Not merely the ones this script needs. A precondition that only guards the
# script leaves the checkpoints free to pass or fail for reasons that have
# nothing to do with the student. One block per checkpoint, in grade.sh's order.

# timezone-set. Both witnesses grade.sh accepts have to be wrong at baseline, or
# the checkpoint is green before the student types anything.
tz=$(td_prop Timezone)
[[ $tz != "$WANT_TZ" ]] \
  || fail "the timezone is already $WANT_TZ after 'timedatectl set-timezone $BASE_TZ'; timezone-set would pass at baseline"
tzlink=$(readlink -f /etc/localtime 2>/dev/null)
[[ $tzlink != "/usr/share/zoneinfo/$WANT_TZ" ]] \
  || fail "/etc/localtime already resolves to /usr/share/zoneinfo/$WANT_TZ; timezone-set would pass at baseline"

# chronyd-enabled and chronyd-active, with the same anchored probes grade.sh
# uses. On the bare exit status of `systemctl is-enabled` this check would accept
# static, indirect, generated, alias and enabled-runtime while the grader rejects
# them, and a guest staged that way hands the student a green checkpoint.
en=$(systemctl is-enabled chronyd 2>&1)
if printf '%s' "$en" | grep -qx enabled; then
  fail "chronyd is still enabled (is-enabled=$en) after the disable; chronyd-enabled would pass at baseline"
fi
act=$(systemctl is-active chronyd 2>&1)
if printf '%s' "$act" | grep -qx active; then
  fail "chronyd is still running (is-active=$act) after the stop; chronyd-active would pass at baseline, and chrony-source-live would be graded against a daemon this script was supposed to have stopped"
fi

# chrony-source-live, chrony-source-persistent and chrony-sole-source all read
# the same list, so it is built once and asserted against three times.
cfgs=()
mapfile -t cfgs < <(chrony_config_files)
(( ${#cfgs[@]} > 0 )) \
  || fail "no chrony configuration file was found at $CHRONY_CONF or under $CHRONY_DIR; chrony-source-persistent and chrony-sole-source could not be graded"
srcs=$(chrony_sources "${cfgs[@]}")

# The lab server must not be configured yet.
if has_source "$srcs" "$NTP_SERVER"; then
  fail "a chrony configuration file still declares $NTP_SERVER after the restore and the drop-in sweep, so chrony-source-persistent would pass at baseline; reset the lab (snapshot revert). Found: $(printf '%s' "$srcs" | tr '\n\t' '  ')"
fi

# ...and some OTHER source must be, or chrony-sole-source ("nothing but the lab
# server is configured") passes vacuously at baseline. The stock RHEL 9
# chrony.conf ships `pool 2.rhel.pool.ntp.org iburst`, which is exactly the line
# the student has to notice and remove, so this is also the check that proves the
# task has something to remove.
[[ -n $srcs ]] \
  || fail "no time source at all is configured in ${cfgs[*]}, so chrony-sole-source would pass at baseline with nothing removed; the stock chrony.conf's pool line is what this task expects to find here, so reset the lab (snapshot revert)"

# RHEL 9's chrony.conf carries `sourcedir /run/chrony-dhcp`, and NetworkManager
# writes a .sources file there when the DHCP server hands out NTP servers
# (option 42). chrony-sole-source reads /etc only - deliberately, because a file
# that regenerates on every DHCP renew is not something a student can be asked to
# remove - so a source arriving that way would leave the grader calling this host
# single-sourced while the running chronyd had a second source. Verified rather
# than repaired, because deleting the file does not stop it coming back.
if [[ -n $(sudo find "$DHCP_SOURCEDIR" -maxdepth 1 -type f 2>/dev/null) ]]; then
  fail "$DHCP_SOURCEDIR holds DHCP-supplied time sources, so chrony-sole-source (which reads $CHRONY_CONF and $CHRONY_DIR only) could not honestly grade 'no other time source is configured' on this guest. The lab's DHCP server is offering NTP servers; this task needs a guest whose DHCP does not, or a chrony.conf without the sourcedir line"
fi

# tuned-enabled and tuned-profile.
ten=$(systemctl is-enabled tuned 2>&1)
if printf '%s' "$ten" | grep -qx enabled; then
  fail "tuned is still enabled (is-enabled=$ten) after the disable; tuned-enabled would pass at baseline"
fi
tact=$(systemctl is-active tuned 2>&1)
if printf '%s' "$tact" | grep -qx active; then
  fail "tuned is still running (is-active=$tact) after the stop; tuned-profile would be graded against a daemon this script was supposed to have stopped"
fi
staged=$(sudo cat "$TUNED_ACTIVE" 2>/dev/null | tr -d '[:space:]')
[[ $staged == "$BASE_PROFILE" ]] \
  || fail "$TUNED_ACTIVE reads back as '${staged:-empty}', not $BASE_PROFILE, so the baseline profile did not land"
[[ $staged != "$WANT_PROFILE" ]] \
  || fail "the staged profile is the one the task asks for; tuned-profile would pass as soon as the student started tuned, without their choosing anything"

# rtc-utc is an invariant: prove it holds before the student starts, so a failure
# afterwards can only mean the student broke it.
localrtc=$(td_prop LocalRTC)
[[ $localrtc == no ]] \
  || fail "timedatectl reports LocalRTC='${localrtc:-empty}' after 'set-local-rtc 0'; the rtc-utc invariant would fail for every fixture"

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
