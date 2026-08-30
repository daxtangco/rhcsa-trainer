#!/usr/bin/env bash
# Break three things, and record the connection name so grade.sh does not have
# to guess it. Idempotent with respect to a previous run of this script AND to a
# previous run of any shipped solution: both spellings of the firewall answer are
# removed below, not just the one the service name uses. It is not a claim about
# arbitrary hand edits; the preconditions further down catch those by failing
# loudly instead of by cleaning up.
set -uo pipefail

# No `set -e`: the cleanup commands above/below legitimately fail on a first run
# (removing a port label, an fcontext rule or a package that is not there).
# So the commands that MUST work are wrapped instead - a silent failure here
# stages the wrong machine and every checkpoint result afterwards is a lie.
need() { "$@" || { printf 'setup.sh: FAILED: %s\n' "$*" >&2; exit 1; }; }

# This is a deliberate divergence from content/tasks/storage/014-grow-home-lv/
# setup.sh, which uses `set -euo pipefail`. Do not "harmonise" them: 014 has no
# idempotent-removal commands and this file is full of them.
fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

conn=$(nmcli -t -f NAME connection show --active 2>/dev/null | head -1)
if [ -z "$conn" ]; then
  conn=$(nmcli -t -f NAME connection show 2>/dev/null | head -1)
fi
# Without this guard an empty $conn writes a blank /etc/rhcsa-conn, the nmcli
# modify below fails into nothing, the machine is not actually broken, and the
# baseline fixture reports "net-autoconnect passed at baseline" - a real
# failure reported as entirely the wrong thing.
if [ -z "$conn" ]; then
  printf 'setup.sh: FAILED: no NetworkManager connection found; cannot stage the break\n' >&2
  exit 1
fi
printf '%s\n' "$conn" | sudo tee /etc/rhcsa-conn >/dev/null ||
  { printf 'setup.sh: FAILED: recording the connection name in /etc/rhcsa-conn\n' >&2; exit 1; }
# grade.sh reads this file as `student`, without sudo. If a previous run left it
# unreadable, `cat` returns nothing and net-autoconnect measures the wrong
# connection - or none at all.
need sudo chmod 0644 /etc/rhcsa-conn

# 1. the service
need sudo systemctl disable --now sshd
# 2. the firewall - both spellings. solutions/02 opens ssh as --add-port=22/tcp
# rather than --add-service=ssh, and the grader accepts either, so removing only
# the service leaves a second run of this script tripping its own firewall-ssh
# precondition below.
sudo firewall-cmd --permanent --remove-service=ssh &>/dev/null
sudo firewall-cmd --permanent --remove-port=22/tcp &>/dev/null
sudo firewall-cmd --reload &>/dev/null
# 3. the connection - autoconnect only, so the network stays up until the next
#    boot. Taking the interface down here would make the break obvious and
#    would also strand the student's own console session if they are on one.
need sudo nmcli connection modify "$conn" connection.autoconnect no

need sudo usermod -aG wheel student

# --- preconditions --------------------------------------------------------
# Every goal checkpoint measures a property of the *starting* state, and each
# one gets a check here. A precondition that only guards this script would
# leave the checkpoints free to pass at baseline for reasons that have nothing
# to do with the student, which is a student-facing false pass and not a
# solved task (Task 21 finding F1).

# sshd-enabled: the exact negation of the grader's probe, which anchors on the
# string rather than on is-enabled's exit status. Kept in step with it on purpose;
# if one is loosened the other has to be, or setup stops proving the checkpoint
# starts red.
if printf '%s' "$(systemctl is-enabled sshd 2>&1)" | grep -qx enabled; then
  fail "sshd is still enabled after 'systemctl disable'; sshd-enabled would pass at baseline"
fi

# sshd-listening: the same probe the grader uses. This is the check that catches
# a guest where sshd.socket is enabled - disabling sshd.service alone leaves
# something listening on 22 and the task appears already solved.
if ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -qE '(^|:)22$'; then
  fail "something is still listening on TCP 22 (sshd.socket?); sshd-listening would pass at baseline"
fi

# firewall-ssh: firewalld must be running for --permanent --list-all to mean
# anything, and the permanent config must permit neither spelling of ssh. The
# grader accepts either, so setup has to rule out both.
sudo systemctl is-active firewalld &>/dev/null \
  || fail "firewalld is not running, so firewall-ssh measures nothing"
perm=$(sudo firewall-cmd --permanent --list-all 2>/dev/null)
if grep -qw ssh <<<"$perm" || grep -qw 22/tcp <<<"$perm"; then
  fail "the permanent firewall config still permits ssh; firewall-ssh would pass at baseline"
fi

# firewall-ssh, continued. `firewall-cmd` with no --zone reads and writes the
# DEFAULT zone, and so does the grader's probe above. If this guest's NIC is
# bound to some other zone, the canonical answer
# `firewall-cmd --permanent --add-service=ssh` writes the default zone, the
# checkpoint goes green, and the traffic is still dropped by the zone that
# actually filters the interface. That is a student-facing false PASS - the one
# failure direction this project treats as unacceptable - so it is checked here
# rather than assumed. docs/vm-build-checklist.md pins no zone.
defzone=$(sudo firewall-cmd --get-default-zone 2>/dev/null)
[ -n "$defzone" ] \
  || fail "cannot read the default firewalld zone, which is the zone every firewall checkpoint in this task measures"

# The device is derived, never hardcoded. An active connection reports it in
# GENERAL.DEVICES; a profile that pins one reports connection.interface-name.
dev=$(nmcli -g GENERAL.DEVICES connection show "$conn" 2>/dev/null | head -1)
[ -n "$dev" ] || dev=$(nmcli -g connection.interface-name connection show "$conn" 2>/dev/null | head -1)

# The permanent half, and the one that matters most here because firewall-ssh is
# itself a permanent check: connection.zone re-binds the interface at every boot,
# so a profile pinning a non-default zone survives a reload that would hide it.
czone=$(nmcli -g connection.zone connection show "$conn" 2>/dev/null)
if [ -n "$czone" ] && [ "$czone" != "$defzone" ]; then
  fail "connection '$conn' pins firewalld zone '$czone', not the default zone '$defzone', so firewall-ssh would pass while ssh stayed blocked; this guest was not built to docs/vm-build-checklist.md"
fi

# The runtime half. --get-active-zones lists only zones with something bound, so
# an interface appearing under NO zone is handled by the default zone, which is
# what the grader assumes; an interface listed under a DIFFERENT zone is the
# hazard.
if [ -n "$dev" ]; then
  otherzone=$(sudo firewall-cmd --get-active-zones 2>/dev/null | awk -v i="$dev" -v d="$defzone" '
    /^[^[:space:]]/ { z=$1; next }
    $1 == "interfaces:" { for (n=2; n<=NF; n++) if ($n == i && z != d) print z }' | head -1)
  [ -z "$otherzone" ] \
    || fail "interface $dev is in firewalld zone '$otherzone', not the default zone '$defzone', so firewall-ssh would pass while ssh stayed blocked; this guest was not built to docs/vm-build-checklist.md"
else
  fail "cannot determine which interface connection '$conn' uses, so it is not possible to prove firewall-ssh measures the zone that filters this guest's traffic"
fi

# net-autoconnect: exactly the grader's probe, against the name it will read
# back out of /etc/rhcsa-conn rather than the local variable.
recorded=$(cat /etc/rhcsa-conn 2>/dev/null)
[ "$recorded" = "$conn" ] || fail "/etc/rhcsa-conn holds '${recorded:-nothing}', not '$conn'"
auto=$(nmcli -g connection.autoconnect connection show "$recorded" 2>/dev/null)
[ "$auto" = "no" ] \
  || fail "connection '$recorded' reports autoconnect='${auto:-unknown}', not no; net-autoconnect would pass at baseline"

# student-intact is an invariant: prove it is true before the student starts, so
# a failure can only mean the student broke it. Not named in mandate 2's wrap
# list, but it is the identical case to users/006 and vmrun logs in as student
# too, so it gets the same treatment.
id -nG student | tr ' ' '\n' | grep -qx wheel \
  || fail "student is not in wheel after usermod; the student-intact invariant would fail for every fixture"

cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
