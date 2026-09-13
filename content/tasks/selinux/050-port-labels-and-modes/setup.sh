#!/usr/bin/env bash
# Prepare the system for selinux/050-port-labels-and-modes.
#
# Stages the situation the prompt describes: a working UDP syslog receiver on a
# port SELinux does not allow the log daemon to bind, made to work by putting the
# whole host in permissive mode - now AND at the next boot - and left that way.
#
# Runs as student over ssh stdin with passwordless sudo and no TTY, so nothing
# here may prompt, read from the terminal, or rely on a login shell.
#
# Idempotent: every port record and permissive-domain module a solution or an
# anti-solution of this task can leave behind is removed before the preconditions
# run, and the drop-in and the two mode settings are written unconditionally. A
# second run against the same machine stages the same starting state as the first.
#
# `set -uo pipefail` without -e, following selinux/019, selinux/032 and net/045:
# this file is full of removals that legitimately fail on a first run (deleting a
# port record that was never added, removing a module that is not installed). The
# commands that MUST succeed are wrapped in `need` instead, because a silent
# failure here stages the wrong machine and every checkpoint result afterwards is
# a lie about the student's work.
#
# ---------------------------------------------------------------------------
# THIS SCRIPT WRITES /etc/selinux/config, AND THAT IS DELIBERATE.
#
# selinux/032's setup.sh carries a shared SELinux state policy for the three
# tasks whose graders emit an "SELinux is enforcing" invariant: no setup.sh
# repairs SELinux state, and no fixture writes a persistent global it is not
# graded on repairing. This task is the one place in the bank that stages the
# global instead, and the policy's own second clause is why that is consistent
# rather than a violation: the mode at the next boot is exactly what this task is
# graded on. mode-enforcing-config is a goal checkpoint, named in grade.sh's
# baseline-fail header, and every shipped solution puts the file back to
# enforcing. Nothing here is left damaged that a correct answer does not repair.
#
# The consequences are still real and are stated so nobody has to rediscover them:
#
#   - Between fixtures the harness reverts the `clean` VMware snapshot, so no
#     other task ever sees the permissive config this script writes.
#   - A HUMAN who runs this fixture by hand and then walks away leaves a host that
#     is permissive at the next boot. Solving the task fixes it; so does reverting.
#     A sibling task's enforcing invariant failing right after a hand-run of this
#     fixture points here and nowhere else.
#
# SELINUX=disabled WAS CONSIDERED AND IS EXCLUDED, everywhere in this task.
# Disabled is not a stronger permissive: while SELinux is disabled the labels are
# not maintained, so coming back to enforcing needs a full filesystem relabel
# (`touch /.autorelabel` and a reboot) that can run for many minutes and that the
# harness does not control. One fixture that wrote it would cost the whole
# validate run its guest. Nothing in this task ever writes the word, and the check
# below refuses to stage a guest that arrived in that state - a clear diagnosis
# instead of a mysterious result. No fixture here turns SELinux off in any sense:
# the closest any of them comes is antisolutions/01, which turns enforcement back
# ON in the running mode only and leaves the config file permissive, and the worst
# state this script itself leaves is permissive both ways. Permissive still
# maintains labels, so no path through this task can produce the unlabelled
# filesystem that the relabel above pays for - which is the property that makes
# staging the global safe to do at all.
# ---------------------------------------------------------------------------
set -uo pipefail

fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }
need() { "$@" || fail "FAILED: $*"; }

# Spelled identically in grade.sh and in every fixture of this task. If the two
# files ever disagree the task becomes unsatisfiable for every answer.
PROTO=udp
PORT=5514
WANT_TYPE=syslogd_port_t
# The shipped record the prompt points at ("the type it already uses for its
# standard 514/udp port") and that grade.sh checks was left alone. Verified
# against the shipped policy: selinux-policy-targeted-38.1.75-2.el9_8 defines
# syslogd_port_t as tcp 601,20514 and udp 514,601,20514, and nothing in the
# shipped policy defines 5514 at all - it falls inside the base
# unreserved_port_t range, which syslogd_t is not allowed to bind.
DEFAULT_PORT=514
# The reference lookup grade.sh fails closed on, and the reason it is ssh's port:
# it is a constant of the stock targeted policy (base defines tcp 22 as
# ssh_port_t), no task in this bank changes it, and it is not this task's subject,
# so a lookup that cannot find it means the port list could not be read or parsed
# rather than that the student did something.
REF_PROTO=tcp
REF_PORT=22
REF_TYPE=ssh_port_t
# The domain the log daemon runs in. Named here only to make sure it is NOT a
# permissive domain at baseline: `semanage permissive -a syslogd_t` is the other
# way to make this receiver work without labelling anything, and it leaves
# getenforce saying Enforcing while the daemon is unconfined for good.
SYSLOGD_DOMAIN=syslogd_t
CONFIG=/etc/selinux/config
DROPIN=/etc/rsyslog.d/rhcsa-log-receiver.conf
UNIT=rsyslog.service

# --- helpers, each one spelled the same way in grade.sh --------------------

# The SELinux type of the narrowest port record that covers a port, or empty.
#
# `semanage port -l` prints one row per (type, protocol) - "%-30s %-8s " and then
# the port numbers, comma separated, with a range written low-high (verified in
# the shipped seobject.py, portRecords.list). So the type is field 1, the protocol
# field 2, and every field from 3 on is a number or a range.
#
# Narrowest match wins because more than one row can cover the same port: the
# base policy labels whole ranges (unreserved_port_t 1024-32767) and a local
# record for a single port sits inside one. Taking the smallest span is right
# whether or not this build's `semanage port -l` prints the range rows, and it
# accepts a student who labelled a range that contains the port.
#
# No `exit` in the awk program, on purpose. awk that exits early kills
# `semanage` with SIGPIPE, and `set -o pipefail` then reports the whole pipeline
# as failed for a search that succeeded - the trap content/lib/assert.sh
# documents at length. This awk reads to EOF and prints at END.
port_type() {
  local proto=$1 num=$2
  sudo timeout 30 semanage port -l 2>/dev/null | awk -v want_proto="$proto" -v want="$num" '
    NF >= 3 && $2 == want_proto {
      for (i = 3; i <= NF; i++) {
        f = $i
        gsub(/,/, "", f)
        lo = -1; hi = -1
        if (f ~ /^[0-9]+$/) { lo = f + 0; hi = lo }
        else if (f ~ /^[0-9]+-[0-9]+$/) { split(f, r, "-"); lo = r[1] + 0; hi = r[2] + 0 }
        if (lo >= 0 && want + 0 >= lo && want + 0 <= hi) {
          span = hi - lo
          if (best == "" || span < bestspan) { best = $1; bestspan = span }
        }
      }
    }
    END { if (best != "") print best }'
}

# The mode the next boot will use, from the config file. Byte-for-byte the same
# function as grade.sh's, which carries the full derivation: it is a transcription
# of `selinux_getenforcemode()` (libselinux-3.6-3.el9, src/selinux_config.c:89),
# so it agrees with the boot and with `sestatus`. In short: the line must begin
# with the literal `SELINUX=`, the FIRST recognised value wins, the value is a
# case-insensitive prefix after any whitespace following the `=`, and nothing
# recognised means the host boots permissive.
#
# It matters here as well as in the grader, and not only for symmetry: the
# precondition at the bottom of this file asserts that mode-enforcing-config
# starts out failing, and it has to assert that against the parse the grader will
# use, or the baseline claim is about a different file than the one being graded.
cfg_mode() {
  awk '
    /^SELINUX=/ && found == "" {
      v = substr($0, 9)
      sub(/^[[:space:]]+/, "", v)
      v = tolower(v)
      if (index(v, "enforcing") == 1) found = "enforcing"
      else if (index(v, "permissive") == 1) found = "permissive"
      else if (index(v, "disabled") == 1) found = "disabled"
    }
    END { print found }' "$CONFIG" 2>/dev/null
}

# "is this domain a permissive domain": 1 if a module named permissive_<domain> is
# installed, 0 if not, empty if the module list could not be read. `semanage
# permissive -a X` installs a CIL module called permissive_X holding
# `(typepermissive X)` - verified in the shipped seobject.py, permissiveRecords.add
# - so the module list answers the question without parsing the two-section output
# of `semanage permissive -l`, and it cannot confuse a domain the shipped policy
# already ships as permissive with one somebody added.
permissive_domain() {
  local domain=$1 out
  out=$(sudo timeout 30 semodule -l 2>/dev/null)
  [[ -n $out ]] || return 0
  printf '%s\n' "$out" | awk -v m="permissive_$domain" '$1 == m { found = 1 } END { print found + 0 }'
}

# --- the two checks that must happen before anything is touched -----------
# Ordering is load-bearing, exactly as it is in selinux/032's setup.sh. A guest
# that arrived with SELinux disabled, or with the mode forced from the kernel
# command line, cannot be staged into the situation this task grades, and every
# failure further down would be a symptom rather than the cause.

command -v getenforce >/dev/null ||
  fail "getenforce is missing (libselinux-utils), so neither the mode this script stages nor the mode the grader measures can be read; see docs/vm-build-checklist.md"

enforce=$(getenforce 2>/dev/null)
case $enforce in
  Enforcing | Permissive) ;;
  *)
    fail "getenforce reports '${enforce:-nothing}'. This task never disables SELinux and must not be run on a host where it is disabled: returning to enforcing from disabled needs a full filesystem relabel, which can take many minutes and which the harness does not control. Revert to the \`clean\` snapshot. If a freshly reverted guest still reports this, the image is wrong; rebuild it to docs/vm-build-checklist.md" ;;
esac

[[ -f $CONFIG ]] ||
  fail "$CONFIG does not exist, so there is nothing to select the mode at the next boot and mode-enforcing-config could never pass; reinstall selinux-policy"

cfg=$(cfg_mode)
case $cfg in
  enforcing | permissive) ;;
  disabled)
    fail "$CONFIG says SELINUX=disabled. Nothing in this task ever writes that value, and it will not be staged on top of it: a host that has been booted disabled has unlabelled files, so putting it back to enforcing needs a full filesystem relabel (\`touch /.autorelabel\` and a reboot) that can run for many minutes and that the harness does not control. Revert to the \`clean\` snapshot; if a freshly reverted guest still says disabled, the image is wrong (docs/vm-build-checklist.md)" ;;
  *)
    fail "no line in $CONFIG begins with 'SELINUX=' followed by enforcing, permissive or disabled (parsed: '${cfg:-nothing}'), so libselinux recognises no setting there and this guest would boot permissive whatever is written. The line must start at the first column with no space before the '='. The grader reads the file with this identical function, so staging on top of it would produce a mode-enforcing-config result nobody can act on" ;;
esac

# kernel-cmdline-clean is an invariant, and it is a precondition rather than only
# a checkpoint because a mode forced on the kernel command line makes the whole
# task incoherent in BOTH directions: `enforcing=0` boots permissive whatever the
# config says, so a student who edits the file correctly still comes up
# permissive; `enforcing=1` boots enforcing whatever the config says, so a student
# who never touches the file passes the reboot anyway. `selinux=0` is worse again -
# selinux(8) states it disables SELinux regardless of the config file.
cmdline=$(cat /proc/cmdline 2>/dev/null)
[[ -n $cmdline ]] ||
  fail "/proc/cmdline could not be read, so it is not possible to prove the SELinux mode is decided by $CONFIG rather than by a boot argument"
bad_arg=$(printf '%s\n' "$cmdline" | awk '{ for (i = 1; i <= NF; i++) if ($i ~ /^(selinux|enforcing)=/) print $i }' | tr '\n' ' ')
[[ -z ${bad_arg// /} ]] ||
  fail "the kernel command line carries ${bad_arg}, which overrides $CONFIG at the next boot and makes this task's mode checkpoints meaningless. Nothing in this bank sets that argument - remove it from the boot loader configuration, or revert to the \`clean\` snapshot"

# --- tooling every checkpoint depends on ----------------------------------
# Convention for every task in this bank: verify every precondition the goal
# checkpoints depend on, not only the ones this script needs to run. A
# precondition that only guards the script leaves the checkpoints free to pass or
# fail for reasons that have nothing to do with the student.
command -v setenforce >/dev/null ||
  fail "setenforce is missing (libselinux-utils), so this script cannot put the host in permissive mode and no answer could put it back; see docs/vm-build-checklist.md"
command -v sestatus >/dev/null ||
  fail "sestatus is missing (policycoreutils); it is how the student reads the running mode and the mode from the config file in one place, and this task is built around that distinction"
command -v ss >/dev/null ||
  fail "ss is missing (package iproute), so this script cannot prove the receiver the prompt describes actually listens"

# A Minimal Install ships neither of these. Installed from the ISO-backed
# repository scripts/guest-provision.sh writes, because the alternative is a
# grader that fails every checkpoint on a guest that is merely missing a package -
# a failure pointing at the student instead of at the image. `< /dev/null` because
# dnf reads stdin and this script's stdin is the rest of this file: one rpm
# scriptlet that reads a line would silently eat the next line of setup.
for pkg in policycoreutils-python-utils rsyslog; do
  if ! rpm -q "$pkg" &>/dev/null; then
    sudo dnf -y install "$pkg" &>/dev/null < /dev/null
    rpm -q "$pkg" &>/dev/null ||
      fail "$pkg is not installed and 'dnf -y install $pkg' did not fix that; check that /etc/yum.repos.d/rhcsa-dvd.repo points at a mounted DVD (docs/vm-build-checklist.md section 3.3)"
  fi
done

command -v semanage >/dev/null ||
  fail "semanage is missing even though policycoreutils-python-utils is installed; the port cleanup below would silently do nothing and port-labeled cannot be evaluated"
command -v semodule >/dev/null ||
  fail "semodule is missing (policycoreutils), so syslogd-confined cannot be evaluated"
systemctl cat "$UNIT" &>/dev/null ||
  fail "$UNIT does not exist even though the rsyslog package is installed; this guest's rsyslog install is broken"

repos=(/etc/yum.repos.d/*.repo)
[[ -e ${repos[0]} ]] ||
  fail "no dnf repository is configured; see docs/vm-build-checklist.md"

# --- undo any previous attempt -------------------------------------------
# `semanage port -d` needs the same key that created the record - protocol plus
# the exact port or range - so every spelling any shipped fixture of this task can
# create is deleted by name:
#   udp 5514         solutions/01, antisolutions/03-05 and the wrong-type fixture
#   udp 5510-5520    solutions/02, which labels a range containing the port
#   tcp 5514         the wrong-protocol fixture
# Leaving any of them behind would make port-labeled pass at baseline, which is a
# student-facing false pass rather than a solved task. Deleting a record that is
# not there fails, which is why this file does not set -e.
sudo timeout 30 semanage port -d -p udp 5514 &>/dev/null
sudo timeout 30 semanage port -d -p udp 5510-5520 &>/dev/null
sudo timeout 30 semanage port -d -p tcp 5514 &>/dev/null

# The other route to a false pass: a permissive domain left behind by a previous
# attempt would let the daemon bind an unlabelled port with getenforce still
# saying Enforcing.
sudo timeout 60 semanage permissive -d "$SYSLOGD_DOMAIN" &>/dev/null

# --- stage the receiver the prompt describes ------------------------------
# Written by setup rather than by the student on purpose: this task is about the
# port label and the mode, and nothing else. The syntax is the shipped
# /etc/rsyslog.conf's own commented example for UDP reception, verbatim apart
# from the port number.
need sudo mkdir -p /etc/rsyslog.d
sudo tee "$DROPIN" >/dev/null <<'EOF'
# Network syslog receiver. Deployed by configuration management.
# Do not edit: the port number is fixed by the log collector's configuration.
module(load="imudp")
input(type="imudp" port="5514")
EOF
[[ -s $DROPIN ]] || fail "could not write $DROPIN, so nothing would listen on $PROTO/$PORT"
# The policy labels /etc/rsyslog.d(/.*)? syslog_conf_t, and a file created in that
# directory inherits it, so this is belt and braces rather than a fix - but a
# drop-in the daemon cannot read would make the receiver look like an SELinux port
# problem when it is not.
if command -v restorecon >/dev/null; then
  sudo timeout 30 restorecon "$DROPIN" &>/dev/null
fi

# --- stage the fault -----------------------------------------------------
# Half one: the running mode. Half two: the mode at the next boot. Both, because
# `setenforce` writes nothing to disk and editing the file changes nothing right
# now - which is the whole lesson of this task and the reason each half is its own
# checkpoint.
need sudo setenforce 0

# sed on the existing assignment rather than a rewrite of the file, so
# SELINUXTYPE= and the comments the shipped file carries survive untouched. The
# pattern cannot match SELINUXTYPE=: the character after SELINUX must be '=' or
# whitespace. It is deliberately LOOSER than cfg_mode's reader - it also rewrites
# indented or spaced-out assignments that libselinux would ignore - because the job
# here is to leave no other spelling of the setting behind, and the precondition at
# the bottom then checks the result through the strict reader the grader uses.
need sudo sed -ri 's/^[[:space:]]*SELINUX[[:space:]]*=.*/SELINUX=permissive/' "$CONFIG"

# The receiver comes up AFTER the host is permissive, which is the only order in
# which it can bind an unlabelled port - and that is exactly the state the
# colleague in the prompt left behind.
need sudo systemctl enable "$UNIT"
need sudo systemctl restart "$UNIT"

# --- prove the staged situation is the one the prompt describes -----------
# Bounded retry: `systemctl restart` returns when rsyslog is ready, but the
# listener appears a moment later and this is worth four seconds of patience.
# Three tries, and it stops at the first success, so it cannot turn a receiver
# that never binds into a pass.
listening=0
for attempt in 1 2 3; do
  listening=$(ss -H -lun 2>/dev/null |
    awk '{ n = $4; sub(/.*:/, "", n); if (n == "5514") found = 1 } END { print found + 0 }')
  [[ ${listening:-0} == 1 ]] && break
  [[ $attempt -lt 3 ]] && sleep 2
done
[[ ${listening:-0} == 1 ]] ||
  fail "nothing is listening on $PROTO/$PORT even with the host in permissive mode, so the receiver in $DROPIN is broken rather than blocked and no correct answer would change anything. Check that rsyslog ships imudp (/usr/lib64/rsyslog/imudp.so) and that '$UNIT' started"

# --- preconditions -------------------------------------------------------
# Every checkpoint grade.sh emits gets a check here, the invariants included and
# including the ones this script does not itself need, and each goal checkpoint is
# checked with the grader's own probe so that a pass at baseline is impossible by
# construction rather than by hope.

# The grader's fail-closed guard. If this lookup does not answer, grade.sh refuses
# to grade and reports every checkpoint as failed with one explanation - so it is
# a precondition of the task rather than of any single check.
ref_now=$(port_type "$REF_PROTO" "$REF_PORT")
[[ $ref_now == "$REF_TYPE" ]] ||
  fail "'semanage port -l' does not report $REF_PROTO/$REF_PORT as $REF_TYPE (got '${ref_now:-nothing}'), so either the port list cannot be read or this guest is not running the stock targeted policy. The grader fails closed on the same lookup and would report every checkpoint as failed"

# port-labeled must start out failing.
port_now=$(port_type "$PROTO" "$PORT")
[[ $port_now != "$WANT_TYPE" ]] ||
  fail "$PROTO/$PORT is already labelled $WANT_TYPE after the deletions above, so port-labeled would pass at baseline. Look for a leftover local record with 'semanage port -l -C' and delete it with 'semanage port -d'"

# syslog-default-port-intact must start out passing, and it is also what makes the
# prompt's "the same type it already uses for 514/udp" answerable at all.
default_now=$(port_type "$PROTO" "$DEFAULT_PORT")
[[ $default_now == "$WANT_TYPE" ]] ||
  fail "the policy labels $PROTO/$DEFAULT_PORT '${default_now:-nothing}' rather than $WANT_TYPE, so this guest is not running the stock targeted policy: the prompt points the student at that record and syslog-default-port-intact would fail for a reason no student caused"

# mode-enforcing-now and mode-enforcing-config must both start out failing, and
# they are checked separately because either can be wrong while the other is
# right - which is the entire subject of this task.
enforce=$(getenforce 2>/dev/null)
[[ $enforce == Permissive ]] ||
  fail "getenforce reports '${enforce:-nothing}' after 'setenforce 0'; mode-enforcing-now would pass at baseline and the student would have nothing to do"
cfg=$(cfg_mode)
[[ $cfg == permissive ]] ||
  fail "$CONFIG parses as '${cfg:-nothing}' after the edit above; mode-enforcing-config would pass at baseline and the reboot would hand the student a fix they never made"

# syslogd-confined must start out passing: the daemon is confined and the only
# thing standing between it and the port is the label.
perm=$(permissive_domain "$SYSLOGD_DOMAIN")
[[ -n $perm ]] ||
  fail "'semodule -l' produced nothing, so it is not possible to prove $SYSLOGD_DOMAIN is confined at baseline and syslogd-confined cannot be evaluated"
[[ $perm == 0 ]] ||
  fail "$SYSLOGD_DOMAIN is still a permissive domain after 'semanage permissive -d $SYSLOGD_DOMAIN'; syslogd-confined would fail at baseline for a fault no student caused"

# The grader never reads history, but a student who reverts and finds their own
# previous commands has been handed a hint nobody offered them.
cat /dev/null >~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
