#!/usr/bin/env bash
# Grade selinux/050-port-labels-and-modes.
#
# content/lib/assert.sh is prepended to this file before it runs, so ck_pass,
# ck_fail, ck_skip and ck are already defined here.
#
# Runs twice per fixture: once for verdict A ("works now") and again after a
# reboot for verdict B ("survives"). Read-only, so the order does not matter and
# the second run cannot repair what the first one measured.
#
# The exit status is ignored by the runner - only the checkpoint lines on stdout
# count - so every path below still has to reach every id. A grader that returns
# early leaves checkpoints unemitted, and an unemitted checkpoint is not a pass.
#
# baseline-fail: port-labeled, mode-enforcing-now, mode-enforcing-config
# unprobed-invariant: syslog-default-port-intact, kernel-cmdline-clean
#
# EVERYTHING HERE IS MEASURED FROM POLICY STATE. NOTHING IS MEASURED FROM
# BEHAVIOUR, AND THAT IS THE CENTRAL DECISION IN THIS FILE.
#
# The obvious probe for "is udp/5514 labelled" is "does rsyslog listen on it",
# and it is wrong for this task specifically: half the work here is the SELinux
# mode, and in permissive mode the daemon binds an unlabelled port perfectly
# happily while the denial goes to the audit log. So a student who set no label
# at all and left the host permissive would pass a behaviour probe, and a student
# who labelled the port correctly and put the host back to enforcing would look
# identical. Behaviour cannot distinguish the right answer from the wrong one
# while the mode is in play, so this grader asks the policy database instead:
# `semanage port -l` for the label, getenforce for the running mode, and
# /etc/selinux/config for the mode at the next boot.
#
# setup.sh proves the receiver really does listen while the host is permissive,
# which is where that fact belongs - a precondition, checked once, on the machine
# the student has not touched yet.
set -uo pipefail

PROTO=udp
PORT=5514
WANT_TYPE=syslogd_port_t
DEFAULT_PORT=514
REF_PROTO=tcp
REF_PORT=22
REF_TYPE=ssh_port_t
SYSLOGD_DOMAIN=syslogd_t
CONFIG=/etc/selinux/config

# --- probes, spelled identically in setup.sh ------------------------------

# The SELinux type of the narrowest port record covering a port, or empty.
#
# `semanage port -l` prints type, protocol, then the ports - single numbers and
# low-high ranges, comma separated (seobject.py, portRecords.list). Narrowest
# match wins: more than one record can cover a port, because the base policy
# labels whole ranges and a local record sits inside one. That also accepts a
# student who labelled a range containing the port, which is a real answer.
#
# The awk program has no `exit` in it, deliberately. Exiting early closes the
# pipe under `semanage`, which dies of SIGPIPE, and `set -o pipefail` then reports
# the pipeline as failed for a search that succeeded - the exact trap
# content/lib/assert.sh documents, with two real false verdicts to its name. This
# reads to EOF and prints once at END.
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

# The mode the next boot will use, parsed the way libselinux itself parses this
# file rather than the way the file looks like it should be parsed. This is a goal
# checkpoint, so the difference decides a verdict, and every clause below was read
# off `selinux_getenforcemode()` in libselinux-3.6-3.el9,
# src/selinux_config.c:89-131:
#
#   - the line must START with the literal eight bytes `SELINUX=`:
#     `strncmp(buf, SELINUXTAG, 8)`. Leading whitespace does NOT match, and
#     neither does `SELINUX = enforcing`. `SELINUXTYPE=` cannot match because its
#     eighth byte is `T`.
#   - the FIRST line whose value is recognised wins - the loop `break`s there. A
#     line whose value is not recognised does not stop the scan, so a later line
#     can still decide.
#   - the value is compared with `strncasecmp` as a PREFIX, after skipping any
#     whitespace that follows the `=`. So `SELINUX=Enforcing` and
#     `SELINUX=enforcing   # put back after the outage` are both enforcing.
#   - if no line is recognised the function returns -1 without writing its output
#     parameter, and `selinux_init_load_policy` (src/load_policy.c:265-270) then
#     falls back to `*enforce = 0`. An unparseable file boots PERMISSIVE: this
#     setting fails OPEN, which is why the `*` branch below is a failure and not
#     a skip.
#
# `sestatus`'s "Mode from config file:" line calls the same function
# (policycoreutils-3.6-5.el9, sestatus/sestatus.c:297-312), so this probe agrees
# both with what the next boot will do and with the command the student is told to
# read - which a grader that disagrees with either has no business doing.
#
# What this replaced, because the replacement is the point: the previous version
# took the LAST `^[[:space:]]*SELINUX[[:space:]]*=` assignment and stripped all
# whitespace from it, the parse selinux/032's grader still carries. There it is
# only an invariant nobody is asked to change, so it never decides anything; here
# it passed `printf 'SELINUX=enforcing\n' | sudo tee -a /etc/selinux/config`,
# which leaves the staged `SELINUX=permissive` above it still deciding the boot,
# and it failed a `SELINUX=Enforcing` that boots enforcing perfectly well.
#
# No `exit` in the awk, matching port_type above: the discipline is uniform across
# this file so that nobody has to work out which of its parsers may stop early.
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

# 1 if <domain> has been made a permissive domain, 0 if not, empty if unreadable.
# `semanage permissive -a X` installs a CIL module named permissive_X containing
# `(typepermissive X)` (seobject.py, permissiveRecords.add), so the module list is
# a stable witness and needs no parsing of `semanage permissive -l`'s two
# sections.
permissive_domain() {
  local domain=$1 out
  out=$(sudo timeout 30 semodule -l 2>/dev/null)
  [[ -n $out ]] || return 0
  printf '%s\n' "$out" | awk -v m="permissive_$domain" '$1 == m { found = 1 } END { print found + 0 }'
}

# --- fail closed ----------------------------------------------------------
# Two things can make every measurement below meaningless: a missing tool, and a
# port list that cannot be read or parsed. Both report the same way - every
# checkpoint failed, with one line saying why - because the alternative is worse
# in both directions. Skipping would let a broken guest look like a task with
# nothing to check; passing would award the work to a student who did none.
guard=""
for tool in getenforce semanage semodule; do
  command -v "$tool" >/dev/null || guard="$tool is not installed"
  [[ -z $guard ]] || break
done

if [[ -z $guard ]]; then
  ref=$(port_type "$REF_PROTO" "$REF_PORT")
  if [[ $ref != "$REF_TYPE" ]]; then
    guard="'semanage port -l' does not report $REF_PROTO/$REF_PORT as $REF_TYPE (got '${ref:-nothing}'), so the port list could not be read or parsed"
  fi
fi

if [[ -n $guard ]]; then
  detail="cannot grade: $guard. Every checkpoint is reported as failed rather than skipped, because a grader that cannot measure must not award the work."
  ck_fail port-labeled "$PROTO/$PORT is labelled $WANT_TYPE in the policy" "$detail"
  ck_fail mode-enforcing-now "SELinux is in enforcing mode right now" "$detail"
  ck_fail mode-enforcing-config "$CONFIG selects enforcing mode for the next boot" "$detail"
  ck_fail syslogd-confined "$SYSLOGD_DOMAIN is still confined by the policy" "$detail"
  ck_fail syslog-default-port-intact "$PROTO/$DEFAULT_PORT still carries its shipped type $WANT_TYPE" "$detail"
  ck_fail kernel-cmdline-clean "the SELinux mode is decided by $CONFIG, not by a boot argument" "$detail"
  exit 0
fi

# --- goal 1: the port carries the right type ------------------------------
# The whole point of the port half. The policy database is the persistent state -
# there is no runtime-versus-on-disk split for port records the way there is for
# file contexts, and no `restorecon` equivalent - so the same probe answers both
# verdict A and verdict B, and verdict B is what proves the claim rather than
# assuming it.
#
# A wrong protocol is a failure here, and it is NOT the "nothing covers this port"
# failure, which is what the first version of this block assumed. The base policy
# carries `portcon udp 1024-32767 gen_context(...unreserved_port_t...)`
# (selinux-policy-38.1.75-2.el9_8, policy/modules/kernel/corenetwork.te.in:424),
# and `semanage port -l` lists every portcon in the policy, not only the local
# ones - `sepol_port_iterate` walks `policydb->ocontexts[OCON_PORT]`
# (libsepol-3.6-3.el9, src/ports.c:191). So udp/5514 always resolves to something
# on a stock guest, the `-z` branch below is unreachable except on a guest the
# fail-closed guard has already caught, and a student who labelled tcp/5514
# instead lands in the "wrong type" branch reading `unreserved_port_t`. That is
# where the protocol hint has to be, so the extra lookup below goes and finds the
# record they actually created rather than leaving them to guess.
#
# Only run on failure: `semanage port -l` reloads the policy through python and
# setools every time it is called, and the correct answer should not pay for the
# wrong one's diagnosis.
port_now=$(port_type "$PROTO" "$PORT")
if [[ $port_now == "$WANT_TYPE" ]]; then
  ck_pass port-labeled "$PROTO/$PORT is labelled $WANT_TYPE in the policy" \
    "the narrowest policy record covering $PROTO/$PORT is $WANT_TYPE"
else
  # Derived, not hardcoded, so this stays honest if PROTO is ever changed.
  if [[ $PROTO == udp ]]; then other_proto=tcp; else other_proto=udp; fi
  mixup=""
  if [[ $(port_type "$other_proto" "$PORT") == "$WANT_TYPE" ]]; then
    mixup=" $other_proto/$PORT, however, IS $WANT_TYPE: port records are keyed on the protocol as well as the number, so a $other_proto record does nothing at all for a $PROTO listener. Add the record again with '-p $PROTO'"
  fi
  if [[ -n $port_now ]]; then
    ck_fail port-labeled "$PROTO/$PORT is labelled $WANT_TYPE in the policy" \
      "the narrowest policy record covering $PROTO/$PORT is $port_now, not $WANT_TYPE. $WANT_TYPE is the type $PROTO/$DEFAULT_PORT already carries, and it is the one the log daemon is allowed to bind.$mixup"
  else
    ck_fail port-labeled "$PROTO/$PORT is labelled $WANT_TYPE in the policy" \
      "no record in the policy covers $PROTO/$PORT at all, which should not be possible on a stock targeted policy - the base policy's unreserved_port_t range covers it - so 'semanage port -l' is probably not being read correctly.$mixup"
  fi
fi

# --- goal 2: the running mode --------------------------------------------
# Read from getenforce rather than from sestatus so that the answer is one word
# with no output format to parse. Permissive is a failure here and is reported
# separately from Disabled, because the two are different mistakes: permissive is
# what setup.sh staged and what the student was asked to undo, while disabled
# means somebody went further than anything this task asks for or writes.
enforce=$(getenforce 2>/dev/null)
case $enforce in
  Enforcing)
    ck_pass mode-enforcing-now "SELinux is in enforcing mode right now" "getenforce reports Enforcing" ;;
  Permissive)
    ck_fail mode-enforcing-now "SELinux is in enforcing mode right now" \
      "getenforce reports Permissive. Editing $CONFIG does not change the running mode - that file is read at boot - so the running mode has to be set as well" ;;
  Disabled)
    ck_fail mode-enforcing-now "SELinux is in enforcing mode right now" \
      "getenforce reports Disabled. Nothing this task asks for disables SELinux, and enforcing cannot be reached from disabled without a reboot and a full filesystem relabel" ;;
  *)
    ck_fail mode-enforcing-now "SELinux is in enforcing mode right now" \
      "getenforce reported '${enforce:-nothing}', which is not a mode" ;;
esac

# --- goal 3: the mode at the next boot -----------------------------------
# The other half of the mode question, and the half `getenforce` cannot see.
# Separate from goal 2 on purpose: either can be right while the other is wrong,
# and the two commonest wrong answers to this task are exactly those two cases.
# In verdict B this checkpoint and the one above move together on a correct
# answer, and a `setenforce`-only answer shows the split - green now, red after
# the reboot.
cfg=$(cfg_mode)
case $cfg in
  enforcing)
    ck_pass mode-enforcing-config "$CONFIG selects enforcing mode for the next boot" \
      "the first SELINUX= line in $CONFIG selects enforcing, which is the line libselinux reads at boot and the one 'sestatus' reports as the mode from the config file" ;;
  permissive)
    ck_fail mode-enforcing-config "$CONFIG selects enforcing mode for the next boot" \
      "the SELINUX= line that decides the next boot still says permissive, so this host comes back permissive however it is running now. Two things to check. setenforce changes the running mode only and writes nothing to disk, so it cannot have done this. And libselinux stops at the FIRST line beginning 'SELINUX=', so a correct line appended to the bottom of the file changes nothing while a stale one sits above it - 'sestatus' shows you which one wins under 'Mode from config file'" ;;
  disabled)
    ck_fail mode-enforcing-config "$CONFIG selects enforcing mode for the next boot" \
      "$CONFIG says SELINUX=disabled, which is further from the goal than the permissive setting it replaced: the next boot loads no policy, so labels stop being maintained, and returning to enforcing then needs a full filesystem relabel. The value asked for is enforcing" ;;
  *)
    ck_fail mode-enforcing-config "$CONFIG selects enforcing mode for the next boot" \
      "no line in $CONFIG begins with 'SELINUX=' followed by enforcing, permissive or disabled, so libselinux recognises no setting at all and the next boot falls back to permissive - this file fails open. The line must start at the first column with no space before the '=': 'SELINUX = enforcing' and a leading-indented line both read as nothing" ;;
esac

# --- invariant: the daemon is still confined -----------------------------
# The other way to make this receiver work: exempt the domain instead of
# labelling the port. `semanage permissive -a syslogd_t` makes the denial go away
# for good, survives a reboot, and leaves getenforce saying Enforcing - so
# without this checkpoint the two mode goals and a happy listener would all agree
# while the log daemon ran unconfined forever. The prompt rules it out in words
# and this measures it.
#
# Not a goal checkpoint: it passes on an untouched machine, so it belongs to the
# invariant set and not to the baseline-fail header. It is named by
# antisolutions/03's expect-fail, which is the second reference that keeps a
# rename from going quiet.
perm=$(permissive_domain "$SYSLOGD_DOMAIN")
if [[ -z $perm ]]; then
  ck_fail syslogd-confined "$SYSLOGD_DOMAIN is still confined by the policy" \
    "'semodule -l' produced no output, so it cannot be shown that $SYSLOGD_DOMAIN was left confined"
elif [[ $perm == 0 ]]; then
  ck_pass syslogd-confined "$SYSLOGD_DOMAIN is still confined by the policy" \
    "no permissive_$SYSLOGD_DOMAIN module is installed"
else
  ck_fail syslogd-confined "$SYSLOGD_DOMAIN is still confined by the policy" \
    "$SYSLOGD_DOMAIN has been made a permissive domain (module permissive_$SYSLOGD_DOMAIN is installed), so it ignores the policy even while the host is enforcing. Remove it with 'semanage permissive -d $SYSLOGD_DOMAIN' and label the port instead"
fi

# --- invariant: the shipped record was left alone ------------------------
# `semanage port -a` on a port that is already defined silently modifies the
# existing record instead of erroring, and `semanage port -m` on the standard
# port would do it openly, so "relabel 514 to something else and point the
# collector at it" is a reachable wrong turn. It would also break every local
# syslog path that expects the standard port. The prompt says to leave it alone;
# this is where that is measured.
default_now=$(port_type "$PROTO" "$DEFAULT_PORT")
if [[ $default_now == "$WANT_TYPE" ]]; then
  ck_pass syslog-default-port-intact "$PROTO/$DEFAULT_PORT still carries its shipped type $WANT_TYPE" \
    "the narrowest policy record covering $PROTO/$DEFAULT_PORT is $WANT_TYPE"
else
  ck_fail syslog-default-port-intact "$PROTO/$DEFAULT_PORT still carries its shipped type $WANT_TYPE" \
    "$PROTO/$DEFAULT_PORT now resolves to '${default_now:-nothing}'. The shipped record was meant to be left as it was; the new port needed adding, not the old one changing"
fi

# --- invariant: the mode came from the config file -----------------------
# `enforcing=0`, `enforcing=1` and `selinux=0` on the kernel command line each
# make the two mode goals mean something other than what they say: the argument
# decides the mode at the next boot and the config file stops mattering, so
# verdict B would either fail a correct answer or pass an answer that never
# touched the file. setup.sh refuses to stage a guest that already carries one of
# these; this catches a student who adds one, which is the shortcut that looks
# like it works and hides the state the task is about.
cmdline=$(cat /proc/cmdline 2>/dev/null)
if [[ -z $cmdline ]]; then
  ck_fail kernel-cmdline-clean "the SELinux mode is decided by $CONFIG, not by a boot argument" \
    "/proc/cmdline could not be read, so the mode's source cannot be established"
else
  found=$(printf '%s\n' "$cmdline" |
    awk '{ for (i = 1; i <= NF; i++) if ($i ~ /^(selinux|enforcing)=/) out = out " " $i } END { print out }')
  if [[ -z ${found// /} ]]; then
    ck_pass kernel-cmdline-clean "the SELinux mode is decided by $CONFIG, not by a boot argument" \
      "no selinux= or enforcing= argument on the kernel command line"
  else
    ck_fail kernel-cmdline-clean "the SELinux mode is decided by $CONFIG, not by a boot argument" \
      "the kernel command line carries${found}, which overrides $CONFIG at boot. The mode was meant to be set in $CONFIG so that it is the file that decides"
  fi
fi

exit 0
