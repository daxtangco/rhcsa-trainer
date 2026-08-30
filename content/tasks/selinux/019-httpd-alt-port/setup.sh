#!/usr/bin/env bash
# Idempotent: undo any previous attempt, then stage the content.
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

sudo systemctl disable --now httpd &>/dev/null
sudo dnf -y remove httpd &>/dev/null
sudo rm -rf /etc/httpd

sudo semanage port -d -t http_port_t -p tcp 82 &>/dev/null
sudo semanage fcontext -d '/srv/web(/.*)?' &>/dev/null
sudo semanage fcontext -d /srv/web &>/dev/null
# solutions/02 labels the tree with an *equivalence* rule rather than a type
# rule, and an equivalence is removed by naming both paths. Without this line a
# second run of setup would leave solution 02's rule in place and
# context-permanent would pass at baseline.
sudo semanage fcontext -d -e /var/www/html /srv/web &>/dev/null
sudo firewall-cmd --permanent --remove-port=82/tcp &>/dev/null
sudo firewall-cmd --reload &>/dev/null

need sudo mkdir -p /srv/web
printf 'RHCSA-MARKER-8842\n' | sudo tee /srv/web/index.html >/dev/null ||
  { printf 'setup.sh: FAILED: staging index.html\n' >&2; exit 1; }
need sudo chmod 0755 /srv/web
need sudo chmod 0644 /srv/web/index.html
# Default label for /srv is var_t, which Apache may not read. Leave it wrong
# on purpose - fixing it is the task.
need sudo restorecon -R /srv/web

# --- preconditions --------------------------------------------------------
# Every goal checkpoint measures a property of the *starting* state, and each
# one gets a check here. A precondition that only guards this script would
# leave the checkpoints free to pass at baseline for reasons that have nothing
# to do with the student, which is a student-facing false pass and not a
# solved task (Task 21 finding F1).

# Tooling the grader itself depends on. Without semanage or matchpathcon the
# cleanup above silently did nothing and port-labeled/context-permanent would
# measure whatever the guest happened to ship with.
command -v semanage >/dev/null \
  || fail "semanage is missing (policycoreutils-python-utils); see scripts/guest-provision.sh"
command -v matchpathcon >/dev/null \
  || fail "matchpathcon is missing (libselinux-utils); context-permanent cannot be evaluated without it"
command -v curl >/dev/null || fail "curl is missing; page-served cannot be evaluated without it"

# Every firewall-cmd above and in every solution needs firewalld running, and
# both firewall checkpoints read its state.
sudo systemctl is-active firewalld &>/dev/null \
  || fail "firewalld is not running, so neither firewall checkpoint measures anything"

# selinux-enforcing is an invariant: it must be true before the student starts,
# or it fails for every fixture and the failure looks like the student's fault.
enforce=$(getenforce 2>/dev/null)
[ "$enforce" = "Enforcing" ] \
  || fail "getenforce reports '${enforce:-nothing}'; this guest was not built to docs/vm-build-checklist.md"

# Every solution installs httpd. A guest with no configured repository fails
# every fixture inside the fixture script, which is diagnosable, but an empty
# /etc/yum.repos.d is worth naming here.
repos=(/etc/yum.repos.d/*.repo)
[ -e "${repos[0]}" ] \
  || fail "no dnf repository is configured, so 'dnf -y install httpd' cannot work; see docs/vm-build-checklist.md"

# httpd-enabled: httpd must not already be enabled at boot.
state=$(systemctl is-enabled httpd 2>&1)
[ "$state" != "enabled" ] || fail "httpd is still enabled after the remove; httpd-enabled would pass at baseline"

# page-served: nothing may already be answering on TCP 82. Same probe the
# grader's sibling checkpoint in troubleshooting/028 uses, for the same reason.
if ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -qE '(^|:)82$'; then
  fail "something is already listening on TCP 82; page-served would not measure the student's work"
fi

# port-labeled: exactly the grader's probe, so a pass here at baseline is
# impossible by construction rather than by hope.
if sudo semanage port -l 2>/dev/null | awk '$1=="http_port_t" && $2=="tcp"' | grep -qw 82; then
  fail "82/tcp is still labelled http_port_t after 'semanage port -d'; port-labeled would pass at baseline"
fi

# page-served also depends on the marker actually being in the file.
sudo grep -q RHCSA-MARKER-8842 /srv/web/index.html \
  || fail "/srv/web/index.html does not contain the marker the grader looks for"

# context-now: the label on the inode must be wrong at the start. This is the
# check that catches a guest where /srv, or an inherited rule, already labels
# the tree httpd_sys_content_t - the student would do nothing and pass.
now=$(stat -c %C /srv/web/index.html 2>/dev/null)
case $now in
  *httpd_sys_content_t*)
    fail "/srv/web/index.html is already httpd_sys_content_t (${now}); context-now would pass at baseline" ;;
esac

# context-permanent: and the policy must not already want that label either.
want=$(matchpathcon -n /srv/web/index.html 2>/dev/null | tr -d ' ')
case $want in
  *httpd_sys_content_t*)
    fail "the policy already labels /srv/web httpd_sys_content_t (${want}); context-permanent would pass at baseline" ;;
esac

# firewall-runtime and firewall-permanent: 82/tcp must be closed in both copies.
sudo firewall-cmd --list-ports 2>/dev/null | grep -qw 82/tcp \
  && fail "82/tcp is still open in the running firewall; firewall-runtime would pass at baseline"
sudo firewall-cmd --permanent --list-ports 2>/dev/null | grep -qw 82/tcp \
  && fail "82/tcp is still open in the permanent firewall config; firewall-permanent would pass at baseline"

# firewall-runtime and firewall-permanent, continued. Both probes above and both
# grader checkpoints read the DEFAULT zone, because firewall-cmd with no --zone
# does. This task's prompt promises port 82 is reachable from other machines, and
# the grader only ever curls localhost, which firewalld does not filter at all.
# So on a guest whose NIC is bound to a non-default zone, the student's correct
# `--add-port=82/tcp` writes a zone that filters nothing, both checkpoints go
# green, and the port is still closed to the outside. That is a student-facing
# false PASS, which is the one failure direction this project treats as
# unacceptable. docs/vm-build-checklist.md pins no zone, so it is checked here.
defzone=$(sudo firewall-cmd --get-default-zone 2>/dev/null)
[ -n "$defzone" ] \
  || fail "cannot read the default firewalld zone, which is the zone both firewall checkpoints measure"

# Derived, never hardcoded: the device behind the active NetworkManager
# connection, falling back to the device on the default route.
dev=$(nmcli -g DEVICE connection show --active 2>/dev/null | head -1)
[ -n "$dev" ] \
  || dev=$(ip -o route show default 2>/dev/null | awk '{for (n=1; n<NF; n++) if ($n == "dev") { print $(n+1); exit }}')

if [ -n "$dev" ]; then
  # --get-active-zones lists only zones with something bound, so an interface
  # under NO zone is handled by the default zone, which is what the checkpoints
  # assume; an interface under a DIFFERENT zone is the hazard.
  otherzone=$(sudo firewall-cmd --get-active-zones 2>/dev/null | awk -v i="$dev" -v d="$defzone" '
    /^[^[:space:]]/ { z=$1; next }
    $1 == "interfaces:" { for (n=2; n<=NF; n++) if ($n == i && z != d) print z }' | head -1)
  [ -z "$otherzone" ] \
    || fail "interface $dev is in firewalld zone '$otherzone', not the default zone '$defzone', so both firewall checkpoints would pass while port 82 stayed closed to other machines; this guest was not built to docs/vm-build-checklist.md"
  # firewall-permanent survives a reboot, and so does connection.zone: a profile
  # pinning a non-default zone re-binds the interface every boot.
  aconn=$(nmcli -g NAME connection show --active 2>/dev/null | head -1)
  if [ -n "$aconn" ]; then
    czone=$(nmcli -g connection.zone connection show "$aconn" 2>/dev/null)
    if [ -n "$czone" ] && [ "$czone" != "$defzone" ]; then
      fail "connection '$aconn' pins firewalld zone '$czone', not the default zone '$defzone', so both firewall checkpoints would pass while port 82 stayed closed to other machines; this guest was not built to docs/vm-build-checklist.md"
    fi
  fi
else
  fail "cannot determine this guest's primary network interface, so it is not possible to prove the firewall checkpoints measure the zone that filters inbound traffic to port 82"
fi

cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
