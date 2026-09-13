#!/usr/bin/env bash
# Prepare the system for net/045-firewall-restricted-service.
#
# Builds the situation the prompt describes: a reporting service that is already
# installed, already listening on tcp/8080, already enabled at boot - and a
# firewall that lets nobody reach it. Everything about the service is this
# script's job, so the task itself is only ever about firewalld.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell.
#
# IDEMPOTENT, and it has to be: the harness reverts the `clean` snapshot before
# every fixture, but a human studying in the Lab screen re-runs setup by hand on
# a machine they have already been changing. Everything here is either a package
# install, a file write, or a firewalld removal, all of which can be repeated.
# The firewall reset works by emptying the PERMANENT copy of this task's own
# artefacts and then reloading, which is what makes it total: --reload replaces
# the runtime configuration with the permanent one, so a runtime-only rule a
# previous fixture left in any zone at all disappears with it.
#
# `set -uo pipefail` without -e, following files/036 and sys/035: this file is
# full of removals that legitimately fail on a first run (there is no port to
# remove, no source to unbind). The commands that MUST work are wrapped in
# `need`, because a silent failure here stages the wrong machine and every
# checkpoint result afterwards is a lie.
set -uo pipefail

fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }
need() { "$@" || fail "FAILED: $*"; }

# Spelled identically in grade.sh and in every fixture. If these ever disagree
# the task becomes unsatisfiable for every answer.
SRC=10.42.7.0/24
PORT=8080
SSH_PORT=22
MARKER=RHCSA045-REPORT-9c31

HTTPD_CONF=/etc/httpd/conf/httpd.conf
DOCROOT=/var/www/html
INDEX=$DOCROOT/index.html
# The zones this script empties. Not every zone on the guest: the reset below
# ends in `firewall-cmd --reload`, which rebuilds the runtime configuration from
# the permanent one, so emptying the permanent copy of the three zones any
# shipped fixture of this task writes to is enough to clear the runtime copy of
# every zone. The verification block at the bottom then checks ALL of them, so a
# leftover anywhere else is reported rather than silently tolerated.
RESET_ZONES=(public internal work)

# --- tooling every checkpoint depends on ----------------------------------
# Convention for every task in this bank: verify every precondition the goal
# checkpoints depend on, not only the ones this script needs to run. A
# precondition that only guards the script leaves the checkpoints free to pass
# or fail for reasons that have nothing to do with the student.
command -v firewall-cmd >/dev/null \
  || fail "firewall-cmd is missing (package firewalld), so every checkpoint in this task would measure nothing; see docs/vm-build-checklist.md"
command -v curl >/dev/null \
  || fail "curl is missing; service-answers cannot be evaluated without it"
command -v ss >/dev/null \
  || fail "ss is missing (package iproute), so this script cannot prove the service is listening"
command -v semanage >/dev/null \
  || fail "semanage is missing (package policycoreutils-python-utils), so tcp/$PORT cannot be labelled for httpd; see scripts/guest-provision.sh"

# --- packages -------------------------------------------------------------
# A Minimal Install ships neither httpd nor, on some layouts, firewalld. Both are
# installed from the ISO-backed repository scripts/guest-provision.sh writes,
# because the alternative is a grader that fails every checkpoint on a guest that
# is merely missing a package - a failure pointing at the student instead of at
# the image. `< /dev/null` because dnf reads stdin and this script's stdin is the
# rest of the script.
for pkg in httpd firewalld; do
  if ! rpm -q "$pkg" &>/dev/null; then
    sudo dnf -y install "$pkg" &>/dev/null < /dev/null
    rpm -q "$pkg" &>/dev/null \
      || fail "$pkg is not installed and 'dnf -y install $pkg' did not fix that; check that /etc/yum.repos.d/rhcsa-dvd.repo points at a mounted DVD (docs/vm-build-checklist.md section 3.3)"
  fi
done

systemctl cat httpd.service &>/dev/null \
  || fail "httpd.service does not exist even though the httpd package is installed; this guest's httpd install is broken"

# --- firewalld itself -----------------------------------------------------
# Enabling a service that is already running changes nothing about the rules in
# force, so this repair is safe to make unconditionally - and it is worth
# making, because source-allowed-runtime is collected again after a reboot and a
# firewalld that does not come back would fail it for a correct answer.
#
# Deliberately NOT started here if it is stopped. Starting firewalld installs a
# whole ruleset from the permanent configuration, and on a guest whose permanent
# public zone had had ssh taken out of it that would cut the channel this task is
# graded over. A guest with firewalld installed and not running is a build
# defect, so it is reported instead.
sudo systemctl enable firewalld &>/dev/null
fw_active=$(systemctl is-active firewalld 2>&1)
printf '%s' "$fw_active" | grep -qx active \
  || fail "firewalld is not running (is-active=$fw_active) and this script will not start it, because starting it applies a permanent configuration this script has not inspected and could cut the ssh channel the task is graded over. Start it by hand from the console, or revert to the \`clean\` snapshot"
fw_enabled=$(systemctl is-enabled firewalld 2>&1)
printf '%s' "$fw_enabled" | grep -qx enabled \
  || fail "firewalld is not enabled at boot (is-enabled=$fw_enabled) even after 'systemctl enable firewalld'; the post-reboot verdict would fail every firewall checkpoint for a correct answer"

# --- the service the task protects ---------------------------------------
# One Listen directive, edited in place in httpd.conf rather than added in a
# conf.d drop-in. A drop-in would be the tidier mechanism but not here: on a
# re-run it would give httpd two `Listen 8080` lines, httpd would refuse to bind
# the second, and the failure would look like a firewall problem. Rewriting the
# stock line is a no-op on the second run.
need sudo test -f "$HTTPD_CONF"
sudo sed -i "s|^Listen 80\$|Listen $PORT|" "$HTTPD_CONF"
sudo grep -qE "^Listen[[:space:]]+$PORT\$" "$HTTPD_CONF" \
  || fail "$HTTPD_CONF has no 'Listen $PORT' line after the edit; the stock 'Listen 80' line this script rewrites is missing, so this guest's httpd.conf is not the packaged one"

# The page the grader reads back. /var/www/html is httpd_sys_content_t already,
# and a file created under it inherits that, so the restorecon is belt and braces
# rather than a fix - the same habit files/036 and sys/035 keep.
need sudo mkdir -p "$DOCROOT"
printf '%s reporting service\n' "$MARKER" | sudo tee "$INDEX" >/dev/null \
  || fail "could not write $INDEX"
need sudo chmod 0644 "$INDEX"
sudo restorecon -R "$DOCROOT" &>/dev/null

# SELinux is Enforcing on this guest and httpd may only bind ports its policy
# labels for it, so tcp/$PORT is labelled http_port_t here - the task is about
# firewalld and should not turn into selinux/019.
#
# -m first, then -a. RHEL 9's base policy already maps tcp/8080 to
# http_cache_port_t - an exact (low, high, proto) key - so `-m` is the verb that
# applies here and it succeeds on the first try; the `-a` never runs on this guest.
#
# It is kept as a fallback for a policy where 8080 is not defined at all, and NOT
# because `-a` would fail on a defined port. It would not. RHEL 9's semanage
# carries a downstream patch that makes `add` fall through to modify:
# `portRecords.add` prints "Port tcp/8080 already defined, modifying instead" and
# calls `__modify` (/usr/lib/python3.9/site-packages/seobject.py:1170-1177), so a
# bare `-a` would in fact be sufficient on its own here. The pair is retained
# because it is correct in both directions without depending on that patch being
# present, which is worth more than the one saved call.
#
# Neither outcome is checked against `semanage port -l`: what matters is whether
# httpd can BIND the port, which is asserted below by starting it and reading the
# socket back, and that is a stronger statement than any listing.
sudo semanage port -m -t http_port_t -p tcp "$PORT" &>/dev/null < /dev/null \
  || sudo semanage port -a -t http_port_t -p tcp "$PORT" &>/dev/null < /dev/null
port_label=$(sudo semanage port -l 2>/dev/null | awk -v p="$PORT" '$2 == "tcp" { for (n = 3; n <= NF; n++) { v = $n; sub(/,$/, "", v); if (v == p) print $1 } }' | tr '\n' ' ')

# enable AND start: the reboot verdict re-reads service-answers, so httpd has to
# come back on its own. Restarted rather than started, so a re-run picks up the
# Listen edit above even if httpd was already running on the old port.
need sudo systemctl enable httpd
sudo systemctl restart httpd &>/dev/null
httpd_active=$(systemctl is-active httpd 2>&1)
printf '%s' "$httpd_active" | grep -qx active \
  || fail "httpd is not running after 'systemctl restart httpd' (is-active=$httpd_active). tcp/$PORT is labelled '${port_label:-nothing}' in SELinux policy; if that does not include http_port_t, httpd was denied the bind and the semanage step above did not take. 'journalctl -u httpd -n 20' has the reason"
httpd_enabled=$(systemctl is-enabled httpd 2>&1)
printf '%s' "$httpd_enabled" | grep -qx enabled \
  || fail "httpd is not enabled at boot (is-enabled=$httpd_enabled), so the post-reboot service-answers invariant would fail for every fixture"

# The socket, then the page. Both, because "the unit is active" and "something is
# listening where the prompt says" are different facts, and the prompt promises
# the second one.
#
# The listening set is captured once and asked with awk rather than piped into
# `grep -q`: content/lib/assert.sh documents that `producer | grep -q` reports a
# successful search as a failed pipeline under pipefail, and awk reading to EOF
# cannot do that. The port is compared as a whole field after the last colon, so
# 18080 does not answer for 8080 and neither does a source port.
listening=$(ss -H -ltn 2>/dev/null | awk '{print $4}')
listening_on() {
  awk -v p="$1" '{ n = $0; sub(/.*:/, "", n); if (n == p) hit = 1 } END { exit hit ? 0 : 1 }' <<<"$listening"
}
listening_on "$PORT" \
  || fail "nothing is listening on tcp/$PORT after httpd started; tcp/$PORT is labelled '${port_label:-nothing}' in SELinux policy and $HTTPD_CONF was edited to Listen $PORT"
body=$(curl -s --max-time 10 "http://localhost:$PORT/" 2>/dev/null)
printf '%s' "$body" | grep -F -- "$MARKER" >/dev/null \
  || fail "http://localhost:$PORT/ did not return the marker the grader looks for (got: ${body:0:60}); service-answers would fail for every fixture"

# The prompt says the service listens on tcp/$PORT, so nothing may be answering
# on tcp/80 as well - a student who found an open door on 80 would be solving a
# different task. This fires if the Listen edit above matched a line that was not
# the only one.
if listening_on 80; then
  fail "something is still listening on tcp/80; $HTTPD_CONF should carry exactly one Listen directive and it should name $PORT"
fi

# --- readers, shared by the reset guard and the verification block ---------
# The helpers below are grade.sh's, copied verbatim, and they must stay that way:
# an enumeration wider or narrower than the grader's would make the assertions at
# the bottom of this file meaningless. A precondition that measures something
# other than what the checkpoint measures is not a precondition.
#
# Defined here rather than after the reset, because the guard immediately below
# has to read the firewall BEFORE this script changes it.
zone_names() { awk '/^[^[:space:]]/ { print $1 }' <<<"${1-}"; }

zfield() {
  awk -v want="$2" -v key="$3" '
    /^[^[:space:]]/ { z = $1; next }
    z != want { next }
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      if (index(line, key ":") == 1) {
        v = substr(line, length(key) + 2)
        sub(/^[[:space:]]+/, "", v)
        sub(/[[:space:]]+$/, "", v)
        print v
      }
    }' <<<"${1-}"
}

zrich() {
  awk -v want="$2" '
    /^[^[:space:]]/ { z = $1; inrich = 0; next }
    z != want { next }
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      if (line == "") next
      if (index(line, "rich rules:") == 1) {
        inrich = 1
        rest = substr(line, length("rich rules:") + 1)
        sub(/^[[:space:]]+/, "", rest)
        if (rest != "") print rest
        next
      }
      if (line ~ /^[a-z][a-z-]*:/) { inrich = 0; next }
      if (inrich) print line
    }' <<<"${1-}"
}

in_list() {
  awk -v want="$2" '{ for (n = 1; n <= NF; n++) if ($n == want) hit = 1 } END { exit hit ? 0 : 1 }' <<<"${1-}"
}

svc_covers() {
  local info
  if [[ $1 == permanent ]]; then
    info=$(sudo firewall-cmd --permanent --info-service="$2" 2>/dev/null) || return 1
  else
    info=$(sudo firewall-cmd --info-service="$2" 2>/dev/null) || return 1
  fi
  [[ -n $info ]] || return 1
  awk -v want="$3/tcp" '$1 == "ports:" { for (n = 2; n <= NF; n++) if ($n == want) hit = 1 } END { exit hit ? 0 : 1 }' <<<"$info"
}

# expose_zone TEXT - the zone $dev is bound to in TEXT, or the default zone.
# Derived the way grade.sh derives it: the DEFAULT ROUTE first, nmcli as the
# fallback with `lo` excluded, because on RHEL 9.2+ NetworkManager manages
# loopback and `lo` is in no zone.
dev=$(ip -o route show default 2>/dev/null | awk '{for (n = 1; n < NF; n++) if ($n == "dev") { print $(n + 1); exit }}')
if [[ -z ${dev:-} ]]; then
  dev=$(nmcli -g DEVICE connection show --active 2>/dev/null | grep -vxF lo | awk 'NR == 1 { print }')
fi
[[ -n ${dev:-} ]] \
  || fail "cannot determine this guest's primary network interface, so it is not possible to prove which zone filters inbound traffic to tcp/$PORT"

defzone=$(sudo firewall-cmd --get-default-zone 2>/dev/null)
[[ -n $defzone ]] || fail "cannot read the default firewalld zone"

expose_zone() {
  local z
  z=$(awk -v i="$dev" '
    /^[^[:space:]]/ { z = $1; next }
    $1 == "interfaces:" { for (n = 2; n <= NF; n++) if ($n == i) { print z; exit } }' <<<"${1-}")
  printf '%s' "${z:-$defzone}"
}

# ssh_permitted_in COPY TEXT ZONE - the grader's three spellings of "tcp/22 is
# allowed here": the `ssh` service, a bare 22/tcp port, or a zone that accepts
# everything. Kept in step with grade.sh's ssh_permitted.
ssh_permitted_in() {
  local copy=$1 text=$2 zone=$3
  [[ $(zfield "$text" "$zone" target) == ACCEPT ]] && return 0
  in_list "$(zfield "$text" "$zone" services)" ssh && return 0
  in_list "$(zfield "$text" "$zone" ports)" "$SSH_PORT/tcp" && return 0
  return 1
}

# --- the firewall baseline ------------------------------------------------
# REFUSE TO RELOAD A PERMANENT CONFIGURATION THAT WOULD CUT SSH.
#
# The reset below ends in `firewall-cmd --reload`, and --reload REPLACES the
# running configuration with the permanent one. That is the same hazard the
# refusal to `systemctl start firewalld` above is about, and it needs the same
# guard: on a guest whose permanent copy of the exposed zone has had ssh taken
# out of it - a half-finished `--permanent --remove-service=ssh` from an earlier
# session is enough - this reload is the moment tcp/22 stops being permitted.
# `--reload` keeps conntrack state, so the session running this script survives
# and the damage is invisible until the next connection: the post-reboot verdict,
# or the next fixture, arrives at a closed door.
#
# So the assertion that used to live only at the bottom of this file is made here
# too, against the permanent copy, BEFORE anything is reloaded. Reported rather
# than repaired, because adding ssh back would be this script silently editing a
# firewall it was asked to leave alone.
pre_rt=$(sudo firewall-cmd --list-all-zones 2>/dev/null)
pre_perm=$(sudo firewall-cmd --permanent --list-all-zones 2>/dev/null)
[[ -n $pre_rt && -n $pre_perm ]] \
  || fail "could not read the firewall configuration with --list-all-zones before resetting it (runtime ${#pre_rt} bytes, permanent ${#pre_perm} bytes); refusing to --reload a configuration this script cannot inspect"
pre_exposed=$(expose_zone "$pre_rt")
ssh_permitted_in permanent "$pre_perm" "$pre_exposed" \
  || fail "zone '$pre_exposed' permits neither the ssh service nor $SSH_PORT/tcp in the PERMANENT configuration, and this script will not 'firewall-cmd --reload' that configuration into the runtime copy because doing so would stop tcp/$SSH_PORT being permitted and lose this guest at the next connection. Add ssh back to the permanent copy from the console ('firewall-cmd --permanent --zone=$pre_exposed --add-service=ssh'), or revert to the \`clean\` snapshot"
unset pre_rt pre_perm pre_exposed

# Empty the permanent copy of this task's own artefacts, then reload so the
# runtime copy is rebuilt from it. `--remove-*` only: nothing here removes a
# service from a zone, changes a target, or touches ssh.
for z in "${RESET_ZONES[@]}"; do
  sudo firewall-cmd --permanent --zone="$z" --remove-port="$PORT/tcp" &>/dev/null < /dev/null
  sudo firewall-cmd --permanent --zone="$z" --remove-source="$SRC" &>/dev/null < /dev/null
  # Rich rules are removed by naming the whole rule back, exactly as
  # --list-rich-rules prints it. `< /dev/null` on the body so nothing inside the
  # loop can consume the process substitution the loop is reading from.
  while IFS= read -r rule; do
    [[ -n $rule ]] || continue
    case $rule in
      *"$PORT"*) sudo firewall-cmd --permanent --zone="$z" --remove-rich-rule="$rule" &>/dev/null < /dev/null ;;
    esac
  done < <(sudo firewall-cmd --permanent --zone="$z" --list-rich-rules 2>/dev/null)
done
need sudo firewall-cmd --reload

# --- verify every goal checkpoint fails, and every invariant passes -------
# Re-read both copies AFTER the reload, because the reload is what made the
# runtime copy match the permanent one and every assertion below is about the
# machine the student is handed, not the one this script found.
RT=$(sudo firewall-cmd --list-all-zones 2>/dev/null)
PERM=$(sudo firewall-cmd --permanent --list-all-zones 2>/dev/null)
[[ -n $RT && -n $PERM ]] \
  || fail "could not read the firewall configuration back with --list-all-zones (runtime ${#RT} bytes, permanent ${#PERM} bytes), so no checkpoint in this task could be verified"

EXPOSED=$(expose_zone "$RT")

# solutions/01 adds its rich rule with no --zone, which means the default zone.
# On a guest whose NIC is bound to some OTHER zone that rule would filter
# nothing while `--list-all` showed it looking perfectly correct, and the
# student-facing verdict would be a false FAIL for a correct answer. The mirror
# of the guard content/tasks/selinux/019-httpd-alt-port/setup.sh keeps, and for
# the same reason: docs/vm-build-checklist.md pins no zone.
[[ $EXPOSED == "$defzone" ]] \
  || fail "interface $dev is in firewalld zone '$EXPOSED', not the default zone '$defzone', so a rule added without --zone would have no effect on inbound traffic; this guest was not built to docs/vm-build-checklist.md"

# A connection profile pinning a non-default zone would re-bind the interface on
# every boot, so the check above has to hold after the reboot too. Asked of the
# profile that owns THIS device rather than of the first active row, for the same
# reason the device comes from the route.
aconn=$(nmcli -g GENERAL.CONNECTION device show "$dev" 2>/dev/null | awk 'NR == 1 { print }')
if [[ -n ${aconn:-} && $aconn != '--' ]]; then
  czone=$(nmcli -g connection.zone connection show "$aconn" 2>/dev/null)
  if [[ -n ${czone:-} && $czone != "$defzone" ]]; then
    fail "connection '$aconn' pins firewalld zone '$czone', not the default zone '$defzone', so after a reboot a rule added without --zone would filter nothing; this guest was not built to docs/vm-build-checklist.md"
  fi
fi

# source-allowed-runtime and source-allowed-permanent must both FAIL at
# baseline, and the grader has exactly two ways to say they pass: a zone with
# $SRC bound to it that permits the port, or a rich rule naming $SRC in
# $EXPOSED. Both are denied below by asserting the stronger property - no zone
# anywhere binds that source, and no zone anywhere carries a rich rule
# mentioning the port - which also covers a leftover in a zone RESET_ZONES does
# not name.
#
# not-open-to-all-runtime and not-open-to-all-permanent must both PASS at
# baseline, and the grader has four ways to say they fail: $EXPOSED's target
# accepts everything, it lists the port, it lists a service covering the port,
# or it carries a rich rule accepting the port for everyone. All four are denied
# below as well.
for copy in runtime permanent; do
  text=$RT
  [[ $copy == permanent ]] && text=$PERM

  while IFS= read -r z; do
    [[ -n $z ]] || continue
    if in_list "$(zfield "$text" "$z" ports)" "$PORT/tcp"; then
      fail "zone '$z' already lists $PORT/tcp in the $copy configuration, so source-allowed-$copy would pass with no work done; reset the lab (snapshot revert)"
    fi
    if in_list "$(zfield "$text" "$z" sources)" "$SRC"; then
      fail "zone '$z' already has $SRC bound as a source in the $copy configuration, so source-allowed-$copy could pass with no work done; reset the lab (snapshot revert)"
    fi
    while IFS= read -r rule; do
      [[ -n $rule ]] || continue
      case $rule in
        *"$PORT"*)
          fail "zone '$z' already carries a rich rule naming $PORT in the $copy configuration ($rule), so source-allowed-$copy could pass with no work done; reset the lab (snapshot revert)" ;;
      esac
    done <<<"$(zrich "$text" "$z")"
  done <<<"$(zone_names "$text")"

  target=$(zfield "$text" "$EXPOSED" target)
  [[ $target != ACCEPT ]] \
    || fail "zone '$EXPOSED' has target ACCEPT in the $copy configuration, so every port is open to every address and not-open-to-all-$copy would fail for every fixture including both solutions"

  # The one remaining way the restriction invariant could be false at baseline: a
  # service definition in $EXPOSED that happens to cover the port. Checked here
  # rather than assumed, because the grader resolves service names and this is
  # the only zone it resolves them for.
  for svc in $(zfield "$text" "$EXPOSED" services); do
    if svc_covers "$copy" "$svc" "$PORT"; then
      fail "zone '$EXPOSED' permits the firewalld service '$svc' in the $copy configuration and that service covers $PORT/tcp, so not-open-to-all-$copy would fail for every fixture"
    fi
  done

  # ssh-permitted is an invariant and it is also the channel this task is graded
  # over: prove it holds before the student starts, so a failure afterwards can
  # only mean the student broke it. The permanent copy was already asserted above
  # the reload, which is where the damage would have been done; this repeats the
  # question of both copies now that the reload has happened.
  ssh_permitted_in "$copy" "$text" "$EXPOSED" \
    || fail "zone '$EXPOSED' permits neither the ssh service nor $SSH_PORT/tcp in the $copy configuration, so the ssh-permitted invariant would fail for every fixture and the grader loses this guest at the next reload or reboot"
done

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
