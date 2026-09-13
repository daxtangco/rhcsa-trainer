#!/usr/bin/env bash
# Route 2, equally correct, and different from solutions/01 in every choice it
# makes:
#   - the name written to /etc/hostname by hand and pushed into the running kernel
#     separately, instead of hostnamectl doing both
#   - the hosts entries as one appended block, with each address's names spread
#     over two lines instead of using the alias column
#   - the resolver settings written into the connection's keyfile under
#     /etc/NetworkManager/system-connections and picked up with `nmcli connection
#     reload`, instead of `nmcli connection modify`
#
# Three routes, one end state. A grader that read hostnamectl's answer without
# looking at /etc/hostname, or insisted the aliases share a line with the
# canonical name, or only asked nmcli about the profile without noticing what is
# on disk, would wrongly reject this - which is the over-fitting a second solution
# exists to catch.
#
# Why this route is worth knowing rather than just being different: the keyfile is
# where the setting actually lives, so it is what you inspect when nmcli says one
# thing and the running system does another, and `nmcli connection reload` is the
# command that resynchronises the two WITHOUT reactivating anything - which is the
# distinction this whole task turns on.
set -euo pipefail

FQDN=app1.lab.example.com
SHORT=app1
PEER_FQDN=filer1.lab.example.com
PEER_SHORT=filer1
PEER_ADDR=192.0.2.40
DNS_SERVER=192.168.70.2
DNS_SEARCH=lab.example.com

# The interface and its address, from the address itself rather than from the
# default route: in drill and exam modes this guest has no default route
# (docs/offline-mode.md). `!seen` rather than awk's `exit`, so awk reads to EOF
# and cannot SIGPIPE the command feeding it under `set -o pipefail`.
dev=$(ip -4 -o addr show scope global | awk '$2 != "lo" && !seen { print $2; seen = 1 }')
cidr=$(ip -4 -o addr show scope global | awk '$2 != "lo" && !seen { print $4; seen = 1 }')
addr=${cidr%/*}
[[ -n $dev && -n $addr ]] || { printf 'no global IPv4 address to work from\n' >&2; exit 1; }

# --- the name, in two halves ---------------------------------------------
# /etc/hostname IS the persistent hostname - hostnamectl has no private store, it
# writes this file. One line, the name, nothing else.
#
# `tee` on the existing file truncates and rewrites it in place, which keeps
# whatever SELinux label the file already has. A route that created the file
# somewhere else and moved it over would get the label of wherever it was created,
# which is the trap `restorecon` below exists for either way.
printf '%s\n' "$FQDN" | sudo tee /etc/hostname >/dev/null
sudo chmod 0644 /etc/hostname
sudo restorecon /etc/hostname 2>/dev/null || true

# Writing the file changes nothing that is already running: the kernel keeps its
# own copy, set at boot from that file, and every program that asks
# gethostname() gets the kernel's answer. So the running name has to be set too,
# or the machine keeps answering to its old name until it reboots. This is the
# same split the other direction from `hostname app1...` on its own, which sets
# the kernel's copy and writes nothing.
#
# `hostname` is the obvious command for it, and it is in the `hostname` package
# rather than in coreutils - so this checks before using it and falls back to the
# kernel value itself, /proc/sys/kernel/hostname, which is what the command writes
# anyway. `sh -c` because the redirection has to happen as root, not as student.
if command -v hostname >/dev/null; then
  sudo hostname "$FQDN"
else
  sudo sh -c "printf '%s\n' '$FQDN' > /proc/sys/kernel/hostname"
fi

# --- the names this host has to know -------------------------------------
# The template's stale entry for this address goes first. Not a requirement -
# nothing grades it - but leaving a dead name mapped to your own address is how a
# later lookup answers something you did not expect.
#
# grep on FILES rather than on a pipe (no producer for -q to kill), and the
# replacement written through a variable rather than `awk file | tee file`, which
# would truncate the file before awk had read it.
hosts_kept=$(sudo awk '{ line = $0; sub(/#.*/, ""); keep = 1; for (i = 2; i <= NF; i++) if ($i == "template" || $i == "template.localdomain") keep = 0; if (keep) print line }' /etc/hosts)
printf '%s\n' "$hosts_kept" | sudo tee /etc/hosts >/dev/null

# Both hosts, one appended block, each name on its own line. Perfectly legal: the
# file is a list of address-to-names lines and nothing says an address may appear
# only once, so the resolver collects every name it finds for an address. Using
# the alias column instead - `192.0.2.40 filer1.lab.example.com filer1` - is the
# more common spelling and is equally correct.
sudo tee -a /etc/hosts >/dev/null <<EOF
# net/044: this host and the site's file server
$addr $FQDN
$addr $SHORT
$PEER_ADDR $PEER_FQDN
$PEER_ADDR $PEER_SHORT
EOF

# SELinux is Enforcing and /etc/hosts is net_conf_t. The appends above keep the
# label they found, so this is belt and braces here - but it is the line that
# saves you after any edit that replaces the file rather than rewriting it, which
# includes `sed -i` and `mv`.
sudo restorecon /etc/hosts 2>/dev/null || true

# --- the resolver settings, written where they live ----------------------
# The active profile on this device, then the file NetworkManager keeps it in.
# Asked of nmcli rather than guessed from the profile's name: the filename usually
# matches the connection name, and when somebody has renamed a connection it does
# not.
uuid=$(nmcli -g UUID,DEVICE connection show --active | awk -F: -v d="$dev" '$2 == d && !seen { print $1; seen = 1 }')
[[ -n $uuid ]] || { printf 'no active connection on %s\n' "$dev" >&2; exit 1; }
keyfile=$(sudo nmcli -g UUID,FILENAME connection show | awk -F: -v u="$uuid" '$1 == u && !seen { sub(/^[^:]*:/, ""); print; seen = 1 }')
[[ -n $keyfile ]] && sudo test -f "$keyfile" \
  || { printf 'cannot find the keyfile for connection %s\n' "$uuid" >&2; exit 1; }

# The file has to be a keyfile, because the edit below is written in keyfile
# grammar. NetworkManager can also store a profile as an old-style ifcfg script
# under /etc/sysconfig/network-scripts - RHEL 9 still reads those, it just does not
# write them any more - and that file is shell syntax with different key names
# (DNS1=, DOMAIN=). Writing an [ipv4] section into one would produce a file that
# looks edited and configures nothing, so this route refuses rather than guesses:
# on such a host `nmcli connection modify` (solutions/01) is the answer, since it
# writes whichever format the profile is already in.
case $keyfile in
  *.nmconnection) : ;;
  *) printf 'the profile for %s is stored in %s, which is not a keyfile; use nmcli connection modify on this host\n' "$uuid" "$keyfile" >&2; exit 1 ;;
esac

# The [ipv4] section gets a dns= and a dns-search= line, in the keyfile's own
# grammar: a semicolon-separated list, terminated with a semicolon, exactly as the
# book's sample keyfile shows (`dns=8.8.8.8;8.8.4.4;`). Any existing dns lines in
# that section are dropped first so a re-run does not stack duplicates, and the
# section is created if the profile has none. Everything else in the file - the
# addresses, the method, the ipv6 section - is copied through untouched, because
# nothing about addressing is being changed here.
#
# Read into a variable and written back afterwards, never `awk file | tee file`.
keyfile_new=$(sudo awk -v ns="$DNS_SERVER" -v sd="$DNS_SEARCH" '
  function emit() { print "dns=" ns ";"; print "dns-search=" sd ";"; print ""; done = 1 }
  /^[[:space:]]*\[/ {
    if (in4 && !done) emit()
    in4 = ($0 ~ /^\[ipv4\]/)
    print
    next
  }
  in4 {
    key = $0
    sub(/=.*/, "", key)
    gsub(/[[:space:]]/, "", key)
    if (key == "dns" || key == "dns-search") next
  }
  { print }
  END {
    if (in4 && !done) emit()
    else if (!done) { print "[ipv4]"; emit() }
  }' "$keyfile")
[[ -n $keyfile_new ]] || { printf 'refusing to write an empty keyfile\n' >&2; exit 1; }

# Structural check before the file is written, because this is the ONE place in
# this task where a mistake can take the interface down. Not through `up` or
# `down` - neither appears here - but through the reload below: if
# NetworkManager cannot parse the keyfile of a profile that is currently active,
# it treats that profile as having been deleted, and deleting the active profile
# deactivates the device. Over ssh that is the end of the session, with no
# addressing left to reconnect to.
#
# So: everything the original file said, minus the dns lines this edit is allowed
# to remove and ignoring blank lines, must still be there in the same order. Any
# other difference means the awk above misparsed the file - a section header in a
# shape it did not expect, a continuation, a stray CR - and the safe response is
# to leave the working file alone.
strip() { grep -vE '^[[:space:]]*(dns|dns-search)[[:space:]]*=|^[[:space:]]*$' || true; }
before=$(sudo cat "$keyfile" | strip)
after=$(printf '%s\n' "$keyfile_new" | strip)
if [[ $after != "$before" && $after != "$before"$'\n[ipv4]' ]]; then
  printf 'the rewritten keyfile is not %s with only its dns lines changed; refusing to write it, because NetworkManager drops a profile it cannot parse and dropping the active profile takes %s down. Use nmcli connection modify on this host instead.\n' "$keyfile" "$dev" >&2
  exit 1
fi

printf '%s\n' "$keyfile_new" | sudo tee "$keyfile" >/dev/null
# NetworkManager ignores a keyfile that other users can read, because these files
# can hold secrets. The mode matters as much as the content.
sudo chmod 0600 "$keyfile"
sudo restorecon "$keyfile" 2>/dev/null || true

# NetworkManager caches profiles in memory, so a file edited underneath it is
# invisible to nmcli until it re-reads the directory. `connection reload` is that
# re-read, and it is the safe half of the pair: it loads what is on disk and
# activates nothing, so the interface this session is running over is not touched.
# `connection up` is what would apply the new resolver immediately - and what
# would deconfigure and reconfigure the device to do it, which over this ssh
# session is how a command becomes the last one you run.
sudo nmcli connection reload

# --- prove the end state, loudly ----------------------------------------
# A solution that silently half-applied is worse than one that failed, because the
# checkpoint it loses points at the student instead of at this file.
fail() { printf '02-files-and-keyfile.sh: %s\n' "$*" >&2; exit 1; }

[[ $(uname -n) == "$FQDN" ]] || fail "the running name is $(uname -n), not $FQDN"

# The persistent name accepted from either witness, exactly as grade.sh accepts it:
# /etc/hostname IS the static hostname, and hostnamectl is a second reader of the
# same fact rather than the authority on it. Demanding hostnamed's answer here
# would make this solution's success depend on how promptly systemd-hostnamed
# notices a file changed underneath it - which is not a property this route is
# entitled to assume, and not one the task grades.
static_file=$(sudo awk '/^[[:space:]]*#/ { next } /^[[:space:]]*$/ { next } { gsub(/^[[:space:]]+|[[:space:]]+$/, ""); print; exit }' /etc/hostname)
static_bus=$(hostnamectl --static 2>/dev/null || true)
[[ $static_file == "$FQDN" || $static_bus == "$FQDN" ]] \
  || fail "the persistent name is file='$static_file', hostnamed='$static_bus', neither of which is $FQDN"
[[ $(getent hosts "$PEER_SHORT" | awk 'NR == 1 { print $1 }') == "$PEER_ADDR" ]] \
  || fail "$PEER_SHORT does not resolve to $PEER_ADDR"
printf '%s\n' "$(nmcli -g ipv4.dns connection show uuid "$uuid")" |
  awk -v w="$DNS_SERVER" '{ gsub(/[,;]/, "\n"); n = split($0, f, "\n"); for (i = 1; i <= n; i++) if (f[i] == w) hit = 1 } END { exit hit ? 0 : 1 }' \
  || fail "after the reload, nmcli still does not report $DNS_SERVER in ipv4.dns for $uuid; check $keyfile"
printf '%s\n' "$(nmcli -g ipv4.dns-search connection show uuid "$uuid")" |
  awk -v w="$DNS_SEARCH" '{ gsub(/[,;]/, "\n"); n = split($0, f, "\n"); for (i = 1; i <= n; i++) if (f[i] == w) hit = 1 } END { exit hit ? 0 : 1 }' \
  || fail "after the reload, nmcli still does not report $DNS_SEARCH in ipv4.dns-search for $uuid; check $keyfile"

# Read back from the tools that own each fact. Note what /etc/resolv.conf says:
# it has NOT changed, and that is correct - the resolver settings are recorded in
# the profile and NetworkManager writes that file when the connection next
# activates, which the reboot at the end of this lab does.
hostnamectl status
getent hosts "$FQDN"
getent hosts "$PEER_FQDN"
nmcli -g ipv4.dns,ipv4.dns-search connection show uuid "$uuid"
cat /etc/resolv.conf
