#!/usr/bin/env bash
# Grader for net/045-firewall-restricted-service.
#
# READ-ONLY. Changes nothing on the guest - no --add-*, no --remove-*, no
# --reload. The exit code is ignored; only the JSONL emitted by the assert
# helpers is read. content/lib/assert.sh is prepended by loadTaskScripts, so its
# helpers are already in scope - do not source it.
#
# ---------------------------------------------------------------------------
# WHY THIS GRADES CONFIGURATION AND NOT A LIVE CONNECTION, which is the one
# design decision in this task worth defending.
#
# The objective is "allow this service, but only from this source". Proving the
# "only" half by measurement needs a client on the permitted network and a
# second client somewhere else. This lab has neither: one guest, one NIC, one
# host-only network, 192.168.70.0/24. And the grader itself runs INSIDE the
# guest over ssh, where the only address it can originate from is loopback -
# which firewalld does not filter at all, so a local curl to port 8080 succeeds
# no matter what the firewall says. There is no probe available here that can
# tell "restricted" from "wide open".
#
# So the permitted network is 10.42.7.0/24, deliberately NOT the lab's own
# 192.168.70.0/24, and the restriction is graded as configuration. That choice
# is what makes the task safe as well as gradeable: a source-bound zone takes
# precedence over the interface binding, so if the student were asked to
# restrict to 192.168.70.0/24 and bound that source to a zone without ssh, the
# grader's own ssh session would land in that zone and verdict A could never be
# collected - the task would destroy its own measurement. With 10.42.7.0/24
# nothing the student can correctly do to that zone touches traffic from the
# grader, which arrives from 192.168.70.0/24 and keeps landing in the
# interface's zone where ssh is permitted.
#
# What is given up: nobody proves a packet from 10.42.7.0/24 would really be
# accepted. What is kept: both halves of the objective are still measured, and
# measured mechanism-agnostically - a rich rule in the interface's zone and a
# source-bound zone are both accepted, as are --add-port, --add-service and a
# rich rule naming a service (spec 6.5 rule 1).
#
# Rich-rule ORder IS modelled, because in firewalld it is not a toss-up. A
# priority-0 reject/drop rich rule goes in the zone's `deny` chain and every
# grant in that zone - a rich `accept`, and also a plain --add-port or
# --add-service - goes in its `allow` chain, and the chains are walked
# pre, log, deny, allow, post (firewalld.richlanguage(5) "Information about
# logging and actions"; firewall/core/nftables.py `_rich_rule_chain_suffix` and
# `build_policy_ports_rules`). So a student who adds the correct accept rule and
# then also adds an explicit "reject everything else" rule has not written a
# rule that MIGHT pre-empt their accept: the refusal always wins, and the one
# network they were told to allow is the one that gets refused. zone_refuses()
# below is what stops that configuration collecting a pass, and the concept card
# tells them not to write it in the first place.
#
# What is still NOT modelled: a refusal whose source is an inverted set that
# happens to cover $SRC without naming it (`source NOT address="192.168.70.0/24"
# ... reject`). zone_refuses only recognises a refusal aimed at everybody or at
# $SRC by name, so an exotic spelling under-detects rather than over-detects -
# it costs a wrong answer a fail it deserved, never a right answer a pass.
# ---------------------------------------------------------------------------
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start:
#   not-open-to-all-runtime / not-open-to-all-permanent  - true at baseline,
#     because at baseline 8080 is permitted nowhere. antisolutions/02 exists to
#     prove they are really probed.
#   ssh-permitted, service-answers - see the unprobed-invariant note below.
# baseline-fail: source-allowed-runtime, source-allowed-permanent
set -uo pipefail

# The permitted network and the port, spelled identically in setup.sh and in
# every fixture. If these ever disagree the task becomes unsatisfiable.
SRC=10.42.7.0/24
PORT=8080
SSH_PORT=22
# The marker setup.sh wrote into the document root.
MARKER=RHCSA045-REPORT-9c31

# $SRC with its dots escaped, for use inside a regex. Derived rather than
# written out a second time: two spellings of one address is one spelling that
# will be wrong.
SRC_RE=${SRC//./\\.}

RE_ACCEPT='(^|[[:space:]])accept([[:space:]]|$)'
# The two actions that refuse traffic. `reject` may carry a `type="..."`, so both
# are matched as whole words rather than at end of string.
RE_DENY='(^|[[:space:]])(reject|drop)([[:space:]]|$)'
# priority="N" on a rich rule. Absent means 0.
RE_PRIO='priority="?(-?[0-9]+)"?'
# The element keywords firewalld.richlanguage(5) lists. A rule carrying none of
# them is the "source black or white listing" form, whose action applies to every
# port from the addresses it names - so a refusal in that form closes tcp/22 as
# surely as tcp/8080. Enumerated rather than inferred so that a rule which limits
# itself to, say, `protocol value="icmp"` is NOT read as covering everything.
RE_ELEMENT='(^|[[:space:]])(service|port|protocol|icmp-block|icmp-type|masquerade|forward-port|source-port|tcp-mss-clamp)[[:space:]]'
RE_TCP='protocol="?tcp("|[[:space:]]|$)'
RE_SERVICE='service[[:space:]]+name="?([A-Za-z0-9_.:-]+)"?'
RE_SRC="source[[:space:]]+address=\"?${SRC_RE}(\"|[[:space:]]|\$)"
RE_ANYSRC='source[[:space:]]+address="?(0\.0\.0\.0/0|::/0)("|[[:space:]]|$)'
# `source NOT address="X"` means "everybody except X", so a rule wearing one is
# an open door with one exception, not a restriction.
RE_NOTSRC='source[[:space:]]+[Nn][Oo][Tt][[:space:]]+address='

# ---------------------------------------------------------------- firewalld I/O

# fw COPY ARGS... - one firewall-cmd call against the runtime or the permanent
# copy. Written as a function so no call site has to remember which flag it is
# in, and so `--permanent` can never leak into a call meant for the running
# configuration.
fw() {
  local copy=$1
  shift
  if [[ $copy == permanent ]]; then
    sudo firewall-cmd --permanent "$@" 2>/dev/null
  else
    sudo firewall-cmd "$@" 2>/dev/null
  fi
}

# Both copies are read ONCE, with --list-all-zones, and everything below is a
# query against those two strings. Two calls instead of four per zone: this
# guest ships nine zones, and a grader that shelled out per zone per field would
# spend most of a minute in dbus round trips.
RT=$(fw runtime --list-all-zones)
PERM=$(fw permanent --list-all-zones)

# ------------------------------------------------------------------ text access
# The shape being parsed, from `firewall-cmd --list-all-zones`:
#
#   public (active)
#     target: default
#     interfaces: ens160
#     sources:
#     services: cockpit dhcpv6-client ssh
#     ports: 8080/tcp
#     rich rules:
#   	rule family="ipv4" source address="10.42.7.0/24" port port="8080" protocol="tcp" accept
#
# A zone header is the only line starting in column 1. Fields are indented and
# `key: value`. Rich rules follow the `rich rules:` label, one per line, indented
# further - so they are recognised by NOT looking like a `key:` field, which
# holds whether firewalld indents them with a tab or with spaces.

zone_names() { awk '/^[^[:space:]]/ { print $1 }' <<<"${1-}"; }

# zfield TEXT ZONE KEY -> the field's value, possibly empty.
# `index(line, key ":") == 1` and not a substring search: `ports` must not be
# answered from the `source-ports:` line.
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

# zrich TEXT ZONE -> the zone's rich rules, one per line, leading blanks removed.
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

# in_list LIST ITEM - exact field comparison, so 8080/tcp is not answered by
# 18080/tcp and 10.42.7.0/24 is not answered by 10.42.7.0/16. awk reads to EOF,
# so this is not the `producer | grep -q` SIGPIPE trap content/lib/assert.sh
# documents.
in_list() {
  awk -v want="$2" '{ for (n = 1; n <= NF; n++) if ($n == want) hit = 1 } END { exit hit ? 0 : 1 }' <<<"${1-}"
}

# svc_covers COPY SERVICE PORT - does that firewalld service definition include
# PORT/tcp? A student who wrapped 8080 in a service of their own has answered
# the objective, and grading only --add-port would fail them.
svc_covers() {
  local info
  info=$(fw "$1" --info-service="$2") || return 1
  [[ -n $info ]] || return 1
  awk -v want="$3/tcp" '$1 == "ports:" { for (n = 2; n <= NF; n++) if ($n == want) hit = 1 } END { exit hit ? 0 : 1 }' <<<"$info"
}

# svc_list_covers COPY "svc1 svc2 ..." PORT
svc_list_covers() {
  local s
  for s in ${2-}; do
    svc_covers "$1" "$s" "$3" && return 0
  done
  return 1
}

# rule_grants COPY RULE PORT - does this rich rule's object include tcp/PORT,
# whether it was written as a port or as a service name?
rule_grants() {
  local copy=$1 rule=$2 port=$3 name re_port
  re_port="port[[:space:]]+port=\"?${port}(\"|[[:space:]]|\$)"
  if [[ $rule =~ $re_port && $rule =~ $RE_TCP ]]; then return 0; fi
  if [[ $rule =~ $RE_SERVICE ]]; then
    name=${BASH_REMATCH[1]}
    svc_covers "$copy" "$name" "$port" && return 0
  fi
  return 1
}

# ------------------------------------------------------------------- predicates

# zone_refuses COPY TEXT ZONE PORT WHO - is there a rich rule in this zone that
# REFUSES tcp/PORT, and that firewalld walks before every grant in the zone?
#
# WHO is `src` (would traffic from $SRC be refused?) or `any` (would traffic from
# an arbitrary address be refused?). A refusal naming no address, or naming
# 0.0.0.0/0 ∕ ::/0, refuses both. A refusal naming $SRC refuses `src` only - other
# addresses still reach the grant - so it does not make the zone closed to
# everyone. A refusal naming some third address refuses neither.
#
# Priority is the one thing that can save such a rule: only a strictly POSITIVE
# priority puts the refusal in the zone's `post` chain, after the grants. 0 (the
# default) puts it in `deny` and a negative value in `pre`, both walked first.
zone_refuses() {
  local copy=$1 text=$2 zone=$3 port=$4 who=$5 rule prio
  while IFS= read -r rule; do
    [[ -n $rule ]] || continue
    [[ $rule =~ $RE_DENY ]] || continue
    # A refusal that names an element only refuses that element's traffic; one
    # that names none refuses every port the addresses it names can ask for.
    if [[ $rule =~ $RE_ELEMENT ]]; then
      rule_grants "$copy" "$rule" "$port" || continue
    fi
    prio=0
    [[ $rule =~ $RE_PRIO ]] && prio=${BASH_REMATCH[1]}
    (( prio > 0 )) && continue
    if [[ ! $rule =~ address= ]] || [[ $rule =~ $RE_ANYSRC ]]; then return 0; fi
    # `source NOT address="$SRC"` is not a refusal of $SRC, and RE_SRC does not
    # match it, because RE_SRC wants `source` immediately followed by `address=`.
    [[ $who == src && $rule =~ $RE_SRC ]] && return 0
  done <<<"$(zrich "$text" "$zone")"
  return 1
}

# zone_permits COPY TEXT ZONE PORT [WHO] - would traffic that has landed in this
# zone reach tcp/PORT? Four ways to say yes, all of them correct answers: the
# zone's target accepts everything, the port is listed, a service covering the
# port is listed, or a rich rule in the zone accepts it (either unconditionally or
# for exactly our source, which is the belt-and-braces spelling).
#
# A refusal in the same zone settles the question before any of those are reached,
# so it is asked first.
zone_permits() {
  local copy=$1 text=$2 zone=$3 port=$4 who=${5-src} rule
  zone_refuses "$copy" "$text" "$zone" "$port" "$who" && return 1
  [[ $(zfield "$text" "$zone" target) == ACCEPT ]] && return 0
  in_list "$(zfield "$text" "$zone" ports)" "$port/tcp" && return 0
  svc_list_covers "$copy" "$(zfield "$text" "$zone" services)" "$port" && return 0
  while IFS= read -r rule; do
    [[ -n $rule ]] || continue
    [[ $rule =~ $RE_ACCEPT ]] || continue
    rule_grants "$copy" "$rule" "$port" || continue
    if [[ ! $rule =~ address= ]] || [[ $rule =~ $RE_SRC ]]; then return 0; fi
  done <<<"$(zrich "$text" "$zone")"
  return 1
}

# open_to_all COPY TEXT EXPOSED - can an arbitrary address reach tcp/$PORT?
# The zone bound to the interface is where every source that matched no source
# binding lands, so that zone permitting the port at all is the definition of
# "open to everyone". Two further ways to be open: a rich rule there that
# accepts the port for every address, and a zone that has bound the whole
# address space as a source.
open_to_all() {
  local copy=$1 text=$2 zone=$3 rule z srcs
  # A refusal aimed at everybody in this zone is walked before every grant in it,
  # so the port is not open to anyone regardless of what else is listed here.
  zone_refuses "$copy" "$text" "$zone" "$PORT" any && return 1
  [[ $(zfield "$text" "$zone" target) == ACCEPT ]] && return 0
  in_list "$(zfield "$text" "$zone" ports)" "$PORT/tcp" && return 0
  svc_list_covers "$copy" "$(zfield "$text" "$zone" services)" "$PORT" && return 0
  while IFS= read -r rule; do
    [[ -n $rule ]] || continue
    [[ $rule =~ $RE_ACCEPT ]] || continue
    rule_grants "$copy" "$rule" "$PORT" || continue
    if [[ ! $rule =~ address= ]] || [[ $rule =~ $RE_ANYSRC ]] || [[ $rule =~ $RE_NOTSRC ]]; then
      return 0
    fi
  done <<<"$(zrich "$text" "$zone")"
  while IFS= read -r z; do
    [[ -n $z ]] || continue
    srcs=$(zfield "$text" "$z" sources)
    in_list "$srcs" 0.0.0.0/0 || in_list "$srcs" ::/0 || continue
    zone_permits "$copy" "$text" "$z" "$PORT" any && return 0
  done <<<"$(zone_names "$text")"
  return 1
}

# allow_from_src COPY TEXT EXPOSED - is tcp/$PORT permitted to $SRC
# specifically? The two mechanisms the concept card teaches:
#   1. a zone with $SRC bound to it that permits the port. A source binding
#      beats the interface binding, so that zone is where those packets land.
#   2. a rich rule naming $SRC in the zone the interface is in.
# A wider source is deliberately NOT accepted: binding 10.0.0.0/8 permits
# addresses the prompt does not permit, so it is a different answer to a
# different question.
allow_from_src() {
  local copy=$1 text=$2 zone=$3 z rule
  while IFS= read -r z; do
    [[ -n $z ]] || continue
    in_list "$(zfield "$text" "$z" sources)" "$SRC" || continue
    zone_permits "$copy" "$text" "$z" "$PORT" src && return 0
  done <<<"$(zone_names "$text")"
  # No zone claims that source by name, so its packets land in the interface's
  # zone - where a refusal covering them is walked before this accept rule is.
  zone_refuses "$copy" "$text" "$zone" "$PORT" src && return 1
  while IFS= read -r rule; do
    [[ -n $rule ]] || continue
    [[ $rule =~ $RE_ACCEPT ]] || continue
    [[ $rule =~ $RE_SRC ]] || continue
    rule_grants "$copy" "$rule" "$PORT" && return 0
  done <<<"$(zrich "$text" "$zone")"
  return 1
}

# ssh_permitted COPY TEXT EXPOSED - is tcp/22 still allowed in the zone the
# grader's own packets land in? Read as `ssh`, as `22/tcp`, and as a rich rule,
# because all three are correct spellings - and refused first if a rich rule in
# the zone rejects tcp/22, or rejects everything, since that refusal is walked
# before the grant no matter which order they were typed in.
ssh_permitted() {
  local copy=$1 text=$2 zone=$3 rule
  zone_refuses "$copy" "$text" "$zone" "$SSH_PORT" any && return 1
  [[ $(zfield "$text" "$zone" target) == ACCEPT ]] && return 0
  in_list "$(zfield "$text" "$zone" services)" ssh && return 0
  in_list "$(zfield "$text" "$zone" ports)" "$SSH_PORT/tcp" && return 0
  while IFS= read -r rule; do
    [[ -n $rule ]] || continue
    [[ $rule =~ $RE_ACCEPT ]] || continue
    rule_grants "$copy" "$rule" "$SSH_PORT" && return 0
  done <<<"$(zrich "$text" "$zone")"
  return 1
}

# ------------------------------------------------------- the zone that filters
# The interface the guest actually answers on. The DEFAULT ROUTE is the primary
# source and the nmcli form is the fallback, with `lo` excluded from it: on RHEL
# 9.2+ NetworkManager manages loopback, so `connection show --active` lists it,
# `lo` is in no zone, and a grader that fell back to it would measure the
# default zone while the real NIC sat somewhere else. Same derivation as
# setup.sh's, which asserts this interface is in the default zone.
dev=$(ip -o route show default 2>/dev/null | awk '{for (n = 1; n < NF; n++) if ($n == "dev") { print $(n + 1); exit }}')
if [[ -z ${dev:-} ]]; then
  dev=$(nmcli -g DEVICE connection show --active 2>/dev/null | grep -vxF lo | awk 'NR == 1 { print }')
fi

# The zone that interface is bound to, read from the RUNTIME copy for both
# checks. That is deliberate: the binding comes from NetworkManager, not from
# firewalld's permanent zone files, so the permanent copy usually lists no
# interface at all - and NetworkManager re-applies the same binding on the next
# boot, which is what makes the runtime answer the right one for both verdicts.
EXPOSED=''
if [[ -n ${dev:-} ]]; then
  EXPOSED=$(awk -v i="$dev" '
    /^[^[:space:]]/ { z = $1; next }
    $1 == "interfaces:" { for (n = 2; n <= NF; n++) if ($n == i) { print z; exit } }' <<<"$RT")
fi
[[ -n $EXPOSED ]] || EXPOSED=$(fw runtime --get-default-zone)

# Fail closed. Every checkpoint below is a question about a zone, and with an
# empty $RT, an empty $PERM or an unknown zone name every one of those questions
# answers "no rule found" - which for the two invariants means PASS. A grader
# that could not read the firewall would then report the restriction as correct
# and ssh as fine. There is no safe way to continue without these three.
if [[ -z $RT || -z $PERM || -z $EXPOSED ]]; then
  detail="grader could not read the firewall: runtime=${#RT} bytes, permanent=${#PERM} bytes, interface=${dev:-unknown}, zone=${EXPOSED:-unknown}. firewalld may not be running, or firewall-cmd may not be usable under sudo"
  ck_fail source-allowed-runtime "the running firewall permits tcp/$PORT from $SRC" "$detail"
  ck_fail source-allowed-permanent "the permanent firewall configuration permits tcp/$PORT from $SRC" "$detail"
  ck_fail not-open-to-all-runtime "the running firewall does not permit tcp/$PORT from anywhere else" "$detail"
  ck_fail not-open-to-all-permanent "the permanent firewall configuration does not permit tcp/$PORT from anywhere else" "$detail"
  ck_fail ssh-permitted "ssh is still permitted in zone $EXPOSED" "$detail"
  ck_fail service-answers "the reporting service still answers on tcp/$PORT" "$detail"
  exit 0
fi

# why_not COPY TEXT - the reason $SRC cannot reach the port, for the detail line.
# A refusal that pre-empts the student's own accept rule is a completely
# different mistake from never having written one, and a verdict that called both
# "no rich rule accepting it" would send them looking for the wrong thing.
why_not() {
  local copy=$1 text=$2
  if zone_refuses "$copy" "$text" "$EXPOSED" "$PORT" src; then
    printf '%s' "zone $EXPOSED does carry a rule that would accept tcp/$PORT from $SRC, but it also carries a reject/drop rich rule covering tcp/$PORT that matches $SRC. firewalld walks a zone's deny rules BEFORE its accept rules, so the refusal always wins and $SRC is the network that gets refused. Remove the reject rule: restricting means leaving the port out of this zone, not rejecting from it"
  else
    printf '%s' "no zone in the $copy configuration permits tcp/$PORT to $SRC: nothing binds that source, and zone $EXPOSED has no rich rule accepting it"
  fi
}

# --- 1. the monitoring network may reach the service ----------------------
# "Permitted from $SRC" is true of a port opened to the whole world too, and
# that is on purpose: this checkpoint is the reachability half of the objective
# and not-open-to-all-* is the restriction half. Splitting them is what makes
# the verdict readable - a student who ran `--add-port=8080/tcp --permanent`
# sees "reachable: yes, restricted: no" instead of one undifferentiated fail.
if open_to_all runtime "$RT" "$EXPOSED"; then
  ck_pass source-allowed-runtime "the running firewall permits tcp/$PORT from $SRC"
elif allow_from_src runtime "$RT" "$EXPOSED"; then
  ck_pass source-allowed-runtime "the running firewall permits tcp/$PORT from $SRC"
else
  ck_fail source-allowed-runtime "the running firewall permits tcp/$PORT from $SRC" \
    "$(why_not runtime "$RT")"
fi

# --- 2. and it is written down ---------------------------------------------
# The permanent copy is the whole reboot story: a rich rule added without
# --permanent filters correctly this second and is gone at the next reload.
if open_to_all permanent "$PERM" "$EXPOSED"; then
  ck_pass source-allowed-permanent "the permanent firewall configuration permits tcp/$PORT from $SRC"
elif allow_from_src permanent "$PERM" "$EXPOSED"; then
  ck_pass source-allowed-permanent "the permanent firewall configuration permits tcp/$PORT from $SRC"
else
  ck_fail source-allowed-permanent "the permanent firewall configuration permits tcp/$PORT from $SRC" \
    "$(why_not permanent "$PERM"); note that a runtime-only rule does not survive a reload or a reboot"
fi

# --- 3. and nobody else may reach it --------------------------------------
# An invariant, in the sense that it holds on an untouched machine - at baseline
# 8080 is permitted nowhere - but it is the half of the objective a naive answer
# fails, and antisolutions/02 is the fixture that proves it is really probed.
if open_to_all runtime "$RT" "$EXPOSED"; then
  ck_fail not-open-to-all-runtime "the running firewall does not permit tcp/$PORT from anywhere else" \
    "zone $EXPOSED, where every other source lands, permits tcp/$PORT in the running configuration; restricting means not opening the port there at all"
else
  ck_pass not-open-to-all-runtime "the running firewall does not permit tcp/$PORT from anywhere else"
fi

if open_to_all permanent "$PERM" "$EXPOSED"; then
  ck_fail not-open-to-all-permanent "the permanent firewall configuration does not permit tcp/$PORT from anywhere else" \
    "zone $EXPOSED permits tcp/$PORT in the permanent configuration, so the port is open to everyone at the next reload"
else
  ck_pass not-open-to-all-permanent "the permanent firewall configuration does not permit tcp/$PORT from anywhere else"
fi

# --- 4. the grader's own door is still open -------------------------------
# Checked in both copies: an established ssh session survives the rule that
# would have refused it, so "we are still connected" proves nothing about the
# runtime configuration, and the permanent copy is what the next boot uses.
#
# Knowingly unprobed: no fixture may break it. The grader reaches this guest
# over ssh on tcp/22 on the only NIC, so an anti-solution that removed ssh from
# zone $EXPOSED would not fail this checkpoint - it would make verdict A
# uncollectable and the task unrunnable. The narrow vmrun retry the harness
# keeps for a dead post-reboot channel does not cover verdict A. So this
# checkpoint exists to name the mistake in a report, not to be exercised.
# unprobed-invariant: ssh-permitted, service-answers
if ssh_permitted runtime "$RT" "$EXPOSED" && ssh_permitted permanent "$PERM" "$EXPOSED"; then
  ck_pass ssh-permitted "ssh is still permitted in zone $EXPOSED"
else
  ck_fail ssh-permitted "ssh is still permitted in zone $EXPOSED" \
    "zone $EXPOSED no longer permits ssh in one of the two copies of the configuration; the next reload or reboot locks this machine"
fi

# --- 5. there is still something to protect -------------------------------
# firewalld does not filter loopback, so this says nothing about the firewall.
# It says the service the prompt promises is still installed, running and
# answering on tcp/$PORT - which is what makes the four checkpoints above worth
# reading. Knowingly unprobed (declared above with ssh-permitted): every
# fixture here changes firewalld and nothing else, so no shipped answer can
# fail it, and a fixture written to break httpd would be testing a different
# task's objective.
body=$(curl -s --max-time 10 "http://localhost:$PORT/" 2>/dev/null)
printf '%s' "$body" | grep -F -- "$MARKER" >/dev/null
ck service-answers "the reporting service still answers on tcp/$PORT" $? "got=${body:0:60}"

exit 0
