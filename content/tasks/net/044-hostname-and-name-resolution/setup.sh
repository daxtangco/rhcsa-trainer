#!/usr/bin/env bash
# Prepare the system for net/044-hostname-and-name-resolution.
#
# Builds the situation the prompt describes: a host still carrying the template's
# name, with none of the site's names known to it and no resolver settings of its
# own. Then it records the four facts the grader needs about the network it is NOT
# allowed to disturb, and proves every goal checkpoint starts red.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell.
#
# FULLY IDEMPOTENT, like content/tasks/files/036-links-and-relocation/setup.sh and
# unlike content/tasks/storage/014-grow-home-lv/setup.sh: everything this task
# touches is a line in /etc/hosts, a line in /etc/hostname or a property of a
# NetworkManager profile, and all three are rewritten from scratch below. Nothing
# here is one-shot the way an XFS filesystem that cannot shrink is, so a human who
# re-runs this after solving the task lands back on the baseline, and the
# verification block at the bottom proves it.
#
# NOTHING HERE MAY DISTURB THE SSH CHANNEL THE GRADER ARRIVES ON. That rules out
# three things this file could plausibly have done and deliberately does not:
# `nmcli connection up` / `nmcli connection down` on the profile that owns the
# only NIC, `systemctl restart NetworkManager`, and any change to
# ipv4.addresses / ipv4.gateway / ipv4.method. The only NetworkManager write below
# is `nmcli connection modify ... ipv4.dns "" ipv4.dns-search ""`, which writes
# the profile to disk and applies nothing - see the "modify writes the profile,
# up applies it" paragraph of content/concepts/net/nm-connections-are-the-config.md
# and step 6 of the r9 book's exercise 8-4 ("After changing connection
# properties, you need to activate them"), which is the documentary evidence that
# `modify` on its own cannot bounce the interface.
set -uo pipefail

# No `set -e`. Several probes below are meant to be asked rather than to abort the
# script, and the awk rewrite of /etc/hosts legitimately finds nothing to remove on
# a first run. The commands that MUST work go through `need`, because a silent
# failure here stages the wrong machine and every checkpoint result afterwards is a
# lie. Same deliberate divergence from 014 that files/036 and sys/035 document; do
# not "harmonise" them.
fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }
need() { "$@" || fail "FAILED: $*"; }
warn() { printf 'setup.sh: WARNING: %s\n' "$*" >&2; }

# Spelled identically in grade.sh. If these ever disagree the task becomes
# unsatisfiable for every answer.
FQDN=app1.lab.example.com
SHORT=app1
PEER_FQDN=filer1.lab.example.com
PEER_SHORT=filer1
# RFC 5737 documentation range, deliberately unroutable, and the same choice
# content/tasks/sys/040-time-and-tuning makes for its time server. Nothing on the
# guest ever connects to it: this task grades name RESOLUTION, and every probe of
# it in grade.sh is a getent call.
PEER_ADDR=192.0.2.40
# The one lab-specific address in this task, and it is chosen for safety rather
# than for flavour. docs/offline-mode.md:126 records that VMware's NAT gateway is
# a DNS forwarder that stays on-link even in offline mode, and VMnet8's DHCP hands
# that same address out as the guest's nameserver already - so when verdict B's
# reboot makes NetworkManager apply this setting, the resolver the guest ends up
# with is the resolver it already had. A black-holed nameserver is the failure this
# avoids: with `hosts: files dns myhostname` (verified on RHEL 9.8, nsswitch.conf
# line 57 - note myhostname comes LAST) every lookup that misses /etc/hosts goes to
# DNS before nss-myhostname ever sees it, so an unreachable nameserver turns a
# missing hosts entry into a multi-second stall in sudo and in the grader's own
# getent probes. An on-link forwarder that answers immediately cannot do that.
DNS_SERVER=192.168.70.2
DNS_SEARCH=lab.example.com

# The name the machine is handed over with. A real stale value rather than
# localhost.localdomain, because "the clone still calls itself template" is the
# situation the prompt describes, and because systemd treats a hostname of
# `localhost` as a special case that would make the baseline less like a real host.
BASE_FQDN=template.localdomain
BASE_SHORT=template

HOSTS=/etc/hosts
HOSTNAME_FILE=/etc/hostname
STAMP_DIR=/var/lib/rhcsa-lab
# This task's own stamp. Deliberately NOT /etc/rhcsa-conn, which
# content/tasks/troubleshooting/028-restore-remote-access/setup.sh owns: two tasks
# sharing one file means whichever ran last decides what the other one measures.
STAMP=$STAMP_DIR/044-net-facts

# --- tools the checkpoints depend on --------------------------------------
# Nothing is installed here, and that is not an omission: every tool this task
# grades through - hostnamectl, getent, ip, awk, nmcli - is in a RHEL 9 minimal
# install, so there is no dnf transaction to run and no DVD repo to check (compare
# content/tasks/sys/040-time-and-tuning/setup.sh, which does need chrony and
# tuned). They are verified present anyway, because a missing tool must be reported
# as a broken image and not as a failing checkpoint.
for t in hostnamectl getent ip awk nmcli; do
  command -v "$t" >/dev/null \
    || fail "$t is missing, and every checkpoint in this task is measured with it; this guest was not built to docs/vm-build-checklist.md"
done
# hostnamed answers over D-Bus and is bus-activated. If it is not there,
# `hostnamectl set-hostname` below cannot work and hostname-static and
# hostname-live are unsatisfiable by the route the exam expects.
sudo hostnamectl status &>/dev/null \
  || fail "hostnamectl cannot talk to systemd-hostnamed, so the hostname half of this task can be neither staged nor solved"
nmcli general status &>/dev/null \
  || fail "nmcli cannot talk to NetworkManager, so the resolver half of this task can be neither staged nor graded"

# --- the network this task must not disturb -------------------------------
# Derived from the ADDRESS, not from the default route, and that is a correctness
# requirement rather than a preference: in drill and exam modes the trainer drops
# the guest's default route (docs/offline-mode.md), so a route-derived device is
# empty for exactly the sessions a student studies in.
# content/tasks/troubleshooting/028-restore-remote-access/setup.sh derives it from
# the route because it runs over the vmrun transport and cares specifically about
# the path remote access arrives on; this task runs over ssh and needs a
# derivation that survives offline mode. grade.sh derives it the same way, and
# reads this stamp as its fallback.
read -r DEV CIDR < <(ip -4 -o addr show scope global 2>/dev/null |
  awk '$2 != "lo" && !seen { print $2, $4; seen = 1 }')
DEV=${DEV:-}
CIDR=${CIDR:-}
ADDR=${CIDR%/*}
[[ -n $DEV && -n $ADDR ]] \
  || fail "no non-loopback interface carries a global IPv4 address, so there is no address for the self-hosts-entry checkpoint to be graded against and no interface for the resolver settings to be recorded on"

# The active profile on that device, keyed by UUID. `-g UUID,DEVICE` rather than
# NAME: a profile name may contain a colon, which nmcli escapes as `\:` and which
# breaks -F: field splitting (the hazard 028's solutions/02 documents at length).
# A UUID cannot contain one, and it also survives the student renaming the profile.
UUID=$(nmcli -g UUID,DEVICE connection show --active 2>/dev/null |
  awk -F: -v d="$DEV" '$2 == d && !seen { print $1; seen = 1 }')
[[ -n $UUID ]] \
  || fail "no active NetworkManager connection owns $DEV, so the resolver settings this task grades have no profile to live in; this guest was not built to docs/vm-build-checklist.md"

# Read back rather than assumed: whatever this says is what grade.sh's
# network-intact invariant compares against later, so a guest configured with a
# static address is staged and graded correctly instead of failing an invariant
# that hardcoded `auto`.
METHOD=$(nmcli -g ipv4.method connection show uuid "$UUID" 2>/dev/null)
[[ -n $METHOD ]] \
  || fail "cannot read ipv4.method from the profile that owns $DEV (uuid $UUID); grade.sh's network-intact invariant compares against that value and would fail for every fixture"

# --- reset: take the task's own artefacts back out ------------------------
# Every line naming one of this task's five names goes, whoever put it there - this
# script, a solution, an anti-solution or a student. Matched on the NAME fields
# rather than on the whole line, so a line that merely contains the text `app1`
# inside some other name is left alone, and matched on field 1 as well so an entry
# written with the columns the wrong way round (antisolutions/04) is removed too.
#
# Read into a variable FIRST and written afterwards. `awk ... "$HOSTS" | sudo tee
# "$HOSTS"` would truncate the file before awk had read it, which is how a reset
# eats /etc/hosts.
#
# The guard against that is on the READ, not on the size of the result, and the
# difference is not academic: antisolutions/05-hosts-file-replaced.sh leaves a
# /etc/hosts whose every line names one of the five names below, so a correct
# filter legitimately returns NOTHING for it. A `[[ -n $hosts_new ]] || fail` here
# refused to run on exactly that machine - the one state this script most needs to
# be able to repair, since 05 is the fixture that breaks the hosts-localhost
# invariant - and left the guest with no localhost lines and no route back except a
# snapshot revert. An empty result is therefore accepted and rebuilt by the
# localhost repair below; what is rejected is a file this script could not read, or
# an awk that died partway, because those are the cases where "nothing to keep" is
# a lie rather than a fact.
sudo test -s "$HOSTS" \
  || fail "$HOSTS is missing or empty before the reset even started, so this script cannot tell which lines it is allowed to remove; this guest was not built to docs/vm-build-checklist.md"
hosts_new=$(sudo awk -v names="$FQDN $SHORT $PEER_FQDN $PEER_SHORT $BASE_FQDN $BASE_SHORT" '
  BEGIN { n = split(names, want, " ") }
  {
    line = $0
    stripped = line
    sub(/#.*/, "", stripped)
    drop = 0
    m = split(stripped, f, "[ \t]+")
    for (i = 1; i <= m; i++)
      for (j = 1; j <= n; j++)
        if (f[i] == want[j]) drop = 1
    if (!drop) print line
  }' "$HOSTS") \
  || fail "the reset filter could not read $HOSTS; refusing to rewrite a file this script did not manage to read"
# `printf '%s\n' ""` would write a newline into an otherwise empty file, so the
# empty case is written as a genuinely empty file rather than as a blank line.
if [[ -n $hosts_new ]]; then
  printf '%s\n' "$hosts_new" | sudo tee "$HOSTS" >/dev/null || fail "could not rewrite $HOSTS"
else
  printf '' | sudo tee "$HOSTS" >/dev/null || fail "could not rewrite $HOSTS"
fi

# The loopback entries, repaired rather than merely asserted. hosts-localhost is an
# invariant, antisolutions/05 exists to break it, and a human re-running this setup
# after that fixture must land on a baseline where the invariant is true again -
# otherwise the next fixture blames the student for the previous one's damage.
# nss-myhostname answers `localhost` even with no hosts file at all, which is why
# that anti-solution is safe to ship; it is not a reason to leave the file wrong.
if ! awk '{ sub(/#.*/, "") } $1 == "127.0.0.1" { for (i = 2; i <= NF; i++) if ($i == "localhost") found = 1 } END { exit found ? 0 : 1 }' "$HOSTS"; then
  printf '127.0.0.1   localhost localhost.localdomain localhost4 localhost4.localdomain4\n' |
    sudo tee -a "$HOSTS" >/dev/null || fail "could not restore the IPv4 localhost entry in $HOSTS"
fi
if ! awk '{ sub(/#.*/, "") } $1 == "::1" { for (i = 2; i <= NF; i++) if ($i == "localhost") found = 1 } END { exit found ? 0 : 1 }' "$HOSTS"; then
  printf '::1         localhost localhost.localdomain localhost6 localhost6.localdomain6\n' |
    sudo tee -a "$HOSTS" >/dev/null || fail "could not restore the IPv6 localhost entry in $HOSTS"
fi

# The resolver settings a previous solution may have recorded. This is the whole
# reason `nmcli connection modify` appears in this file: without it, a re-run after
# a solved attempt would leave dns-nameserver and dns-search green at baseline.
# Writes the keyfile, applies nothing.
need sudo nmcli connection modify uuid "$UUID" ipv4.dns "" ipv4.dns-search ""

# --- create the situation the prompt describes ---------------------------
# The stale name's hosts entry goes in BEFORE the hostname is set, and the
# ordering is the point.
#
# On the sudo-hang risk the reviewer asked about: the evidence on this platform is
# that a hostname with no hosts entry cannot hang sudo *indefinitely*, but can
# delay it. /etc/nsswitch.conf on RHEL 9.8 reads `hosts: files dns myhostname`
# (verified, line 57): a lookup of the machine's own name misses `files`, is sent
# to DNS, and only reaches nss-myhostname - which always answers for the local
# hostname - after DNS has answered or timed out. sudo resolves the local host name
# to match sudoers host specifications, so with an unreachable nameserver that is
# one resolver timeout per sudo call. It does not become a permanent hang because
# myhostname is in the chain and glibc falls back to 127.0.0.1 when resolv.conf
# lists no nameserver at all. Staging the entry costs nothing and removes the
# variable entirely, and the prompt requires the student to keep the machine
# resolvable under its NEW name for the same reason.
printf '%s %s %s\n' "$ADDR" "$BASE_FQDN" "$BASE_SHORT" | sudo tee -a "$HOSTS" >/dev/null \
  || fail "could not add the template's own hosts entry to $HOSTS"

# SELinux is Enforcing on this guest. /etc/hosts is net_conf_t (the r9 book's
# exercise 22-4 opens by reading exactly that label off exactly this file), and
# `tee` on an existing path truncates in place, so both writes above keep the
# label they found. restorecon is belt and braces for a guest whose file was
# replaced by hand at some point - the same habit files/036's setup documents.
sudo restorecon "$HOSTS" &>/dev/null

# The name itself. hostnamectl rather than `hostname` plus a file write, because
# this must be the persistent baseline: hostname-static has to read the stale name
# back out of /etc/hostname after verdict B's reboot.
need sudo hostnamectl set-hostname "$BASE_FQDN"

# --- stamp the facts grade.sh needs about the network -------------------
# Four facts, all of them about the thing this task must not disturb. grade.sh
# re-derives the device and the address for itself so that it still works when a
# DHCP renewal has moved the address between setup and grading, and uses this file
# for the two facts it cannot re-derive after the student has been at the machine:
# which profile was theirs to change, and what its addressing method was before
# they started.
need sudo mkdir -p "$STAMP_DIR"
{
  printf 'dev=%s\n' "$DEV"
  printf 'addr=%s\n' "$ADDR"
  printf 'uuid=%s\n' "$UUID"
  printf 'method=%s\n' "$METHOD"
} | sudo tee "$STAMP" >/dev/null || fail "could not write $STAMP"
# grade.sh reads this as student, without sudo. A stamp it cannot read is a stamp
# that measures nothing.
need sudo chmod 0644 "$STAMP"

fact() { awk -F= -v k="$1" '$1 == k { v = $2 } END { print v }' "$STAMP" 2>/dev/null; }
for key in dev addr uuid method; do
  [[ -n $(fact "$key") ]] \
    || fail "$STAMP has no value for $key; grade.sh's network-intact invariant fails closed on that and no answer could pass"
done

# --- verify every goal checkpoint fails, and both invariants pass -------
# One block per checkpoint, in grade.sh's order, using the same probe grade.sh
# uses rather than an approximation of it. A goal checkpoint that already passes
# here is a student-facing false pass, not a solved task; an invariant that
# already fails here is a checkpoint every fixture loses through no fault of the
# student.

# The grader's own hosts-file reader, spelled identically.
hosts_names_for() {
  awk -v a="$1" '
    { sub(/#.*/, "") }
    NF >= 2 && $1 == a { for (i = 2; i <= NF; i++) print $i }' "$HOSTS" 2>/dev/null
}
has_name() { printf '%s\n' "$1" | awk -v w="$2" '$0 == w { hit = 1 } END { exit hit ? 0 : 1 }'; }

# hostname-live
live=$(uname -n)
[[ $live == "$BASE_FQDN" ]] \
  || fail "the running hostname is '${live:-empty}', not $BASE_FQDN, after 'hostnamectl set-hostname'; the baseline did not land"
[[ $live != "$FQDN" ]] \
  || fail "the running hostname is already $FQDN; hostname-live would pass at baseline"

# hostname-static, read from the file as well as from hostnamed, because grade.sh
# accepts either witness and both must be wrong at baseline.
static_file=$(awk '/^[[:space:]]*#/ { next } /^[[:space:]]*$/ { next } { gsub(/^[[:space:]]+|[[:space:]]+$/, ""); print; exit }' "$HOSTNAME_FILE" 2>/dev/null)
static_bus=$(hostnamectl --static 2>/dev/null)
[[ $static_file != "$FQDN" && $static_bus != "$FQDN" ]] \
  || fail "the static hostname is already $FQDN (file='$static_file', hostnamed='$static_bus'); hostname-static would pass at baseline"
[[ $static_file == "$BASE_FQDN" ]] \
  || fail "$HOSTNAME_FILE reads back as '${static_file:-empty}', not $BASE_FQDN; hostnamectl did not write the persistent baseline and hostname-static would not be measuring a stale name"

# self-hosts-entry
self_names=$(hosts_names_for "$ADDR")
if has_name "$self_names" "$FQDN" || has_name "$self_names" "$SHORT"; then
  fail "$HOSTS already maps $ADDR to $FQDN or $SHORT after the reset; self-hosts-entry would pass at baseline"
fi
has_name "$self_names" "$BASE_FQDN" \
  || fail "$HOSTS does not map $ADDR to $BASE_FQDN after staging it, so the machine's own name is not locally resolvable and the baseline is not the one this task describes"

# peer-resolves. Both names must be unresolvable, and unresolvable is checked with
# getent rather than by reading the file: if this guest's DNS did somehow answer
# for filer1.lab.example.com the checkpoint would be green with nothing done, and
# no amount of hosts-file tidiness would change that.
for n in "$PEER_FQDN" "$PEER_SHORT"; do
  if getent hosts "$n" >/dev/null 2>&1; then
    fail "$n already resolves on this guest (to $(getent hosts "$n" | awk 'NR == 1 { print $1 }')); peer-resolves would pass at baseline"
  fi
done

# dns-nameserver and dns-search, from both witnesses grade.sh accepts: the profile
# as nmcli reports it, and the keyfile on disk.
prof_dns=$(nmcli -g ipv4.dns connection show uuid "$UUID" 2>/dev/null)
prof_search=$(nmcli -g ipv4.dns-search connection show uuid "$UUID" 2>/dev/null)
[[ -z $prof_dns ]] \
  || fail "the profile that owns $DEV still lists ipv4.dns='$prof_dns' after the reset; dns-nameserver could pass at baseline"
[[ -z $prof_search ]] \
  || fail "the profile that owns $DEV still lists ipv4.dns-search='$prof_search' after the reset; dns-search could pass at baseline"
keyfile=$(sudo nmcli -g UUID,FILENAME connection show 2>/dev/null |
  awk -F: -v u="$UUID" '$1 == u && !seen { sub(/^[^:]*:/, ""); print; seen = 1 }')
if [[ -n $keyfile ]] && sudo test -f "$keyfile"; then
  # Scoped to the [ipv4] section, the same way grade.sh's key_val reads it. An
  # unscoped grep for `dns=` would also match the [ipv6] section, and an IPv6
  # resolver in the profile is neither what this task grades nor something setup is
  # entitled to refuse to run over.
  if sudo awk '
      /^[[:space:]]*\[/ { in4 = ($0 ~ /^[[:space:]]*\[ipv4\][[:space:]]*$/); next }
      in4 {
        key = $0; sub(/=.*/, "", key); gsub(/[[:space:]]/, "", key)
        val = $0; sub(/^[^=]*=/, "", val); gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
        if ((key == "dns" || key == "dns-search") && val != "") hit = 1
      }
      END { exit hit ? 0 : 1 }' "$keyfile"; then
    fail "$keyfile still carries a dns= or dns-search= line after the reset; dns-nameserver or dns-search could pass at baseline. nmcli reports the profile as clean, so this file is out of step with NetworkManager - 'nmcli connection reload' or a revert to the \`clean\` snapshot"
  fi
else
  # Not fatal: grade.sh treats nmcli's answer as the primary witness and the
  # keyfile as a second one, so a keyfile this script cannot locate costs the
  # student nothing. It is worth saying out loud, because it also means
  # solutions/02 - which edits that file - has nothing to edit.
  warn "cannot locate the keyfile for uuid $UUID (nmcli reported '${keyfile:-nothing}'); solutions/02 edits that file and will fail loudly if it is not there"
fi

# hosts-localhost is an invariant: prove it holds before the student starts, so a
# failure afterwards can only mean the student broke it.
for pair in "127.0.0.1" "::1"; do
  has_name "$(hosts_names_for "$pair")" localhost \
    || fail "$HOSTS does not map $pair to localhost even after the repair above; the hosts-localhost invariant would fail for every fixture"
done

# network-intact is the other invariant, and the one that exists because of the
# danger in this task: the grader arrives over this interface. Asserted here with
# grade.sh's own probes so that "the student broke the network" is the only thing a
# later failure can mean.
active_uuid=$(nmcli -g UUID,DEVICE connection show --active 2>/dev/null |
  awk -F: -v d="$DEV" '$2 == d && !seen { print $1; seen = 1 }')
[[ $active_uuid == "$UUID" ]] \
  || fail "the connection active on $DEV is now '${active_uuid:-nothing}', not the stamped $UUID; the network-intact invariant would fail for every fixture"
[[ $(nmcli -g ipv4.method connection show uuid "$UUID" 2>/dev/null) == "$METHOD" ]] \
  || fail "ipv4.method on uuid $UUID no longer reads '$METHOD'; the network-intact invariant would fail for every fixture"

# The DHCP-supplied resolver, checked but not enforced. If 192.168.70.2 is not what
# this lab's DHCP hands out, the task is still perfectly gradeable - every DNS
# checkpoint reads the profile, never resolv.conf - but the safety argument for
# choosing that address (verdict B's reboot applies a resolver the guest already
# had) no longer holds, and whoever re-points this lab should re-pick the address.
if ! awk -v s="$DNS_SERVER" '$1 == "nameserver" && $2 == s { hit = 1 } END { exit hit ? 0 : 1 }' /etc/resolv.conf 2>/dev/null; then
  warn "$DNS_SERVER is not among the nameservers in /etc/resolv.conf, so it is probably not what this lab's DHCP supplies. Grading is unaffected (dns-nameserver reads the connection profile), but after verdict B's reboot the guest would be resolving through an address nothing has confirmed answers - re-pick DNS_SERVER in setup.sh and grade.sh if lookups start stalling"
fi
[[ -n $DNS_SEARCH ]] || fail "DNS_SEARCH is empty, so dns-search cannot be graded"

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
