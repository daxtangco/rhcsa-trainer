#!/usr/bin/env bash
# Seven checkpoints, because this task fails silently in more than one way and
# each way needs its own verdict.
#
# Note what is NOT here: nothing greps httpd.conf. Where the DocumentRoot is
# written is not the objective and not the end state - "curl returns the file"
# is.
# baseline-fail: httpd-enabled, page-served, port-labeled, context-now, context-permanent, firewall-runtime, firewall-permanent
set -uo pipefail

# Anchored on the exact string, not on is-enabled's exit status, which is also 0
# for static, indirect, generated, alias and enabled-runtime. Only "enabled"
# means a symlink in /etc that survives a reboot, which is what the checkpoint
# name claims. Same spelling as systemd/017's stamp-enabled.
state=$(systemctl is-enabled httpd 2>&1)
printf '%s' "$state" | grep -qx enabled
ck httpd-enabled "httpd is enabled at boot" $? "is-enabled=$state"

# The grader runs inside the guest, and firewalld does not filter loopback, so
# this proves Apache serves the right directory and nothing about the firewall.
# That is why the firewall has checkpoints of its own.
body=$(curl -s --max-time 10 http://localhost:82/ 2>/dev/null)
printf '%s' "$body" | grep -q RHCSA-MARKER-8842
ck page-served "http://localhost:82/ returns the file from /srv/web" $? "got=${body:0:60}"

sudo semanage port -l 2>/dev/null | awk '$1=="http_port_t" && $2=="tcp"' | grep -qw 82
ck port-labeled "82/tcp is labelled http_port_t in policy" $?

now=$(stat -c %C /srv/web/index.html 2>/dev/null)
printf '%s' "$now" | grep -q httpd_sys_content_t
ck context-now "/srv/web/index.html is labelled httpd_sys_content_t right now" $? "context=${now:-none}"

# matchpathcon asks the policy what the label *should* be. It follows both a
# type rule and an equivalence rule, so it accepts either mechanism - and it
# fails for chcon, which changes the label without changing the policy.
want=$(matchpathcon -n /srv/web/index.html 2>/dev/null | tr -d ' ')
printf '%s' "$want" | grep -q httpd_sys_content_t
ck context-permanent "policy would relabel /srv/web to httpd_sys_content_t" $? "matchpathcon=${want:-none}"

sudo firewall-cmd --list-ports 2>/dev/null | grep -qw 82/tcp
ck firewall-runtime "82/tcp is open in the running firewall" $?

sudo firewall-cmd --permanent --list-ports 2>/dev/null | grep -qw 82/tcp
ck firewall-permanent "82/tcp is open in the permanent firewall config" $?

# Invariant: an answer that turns SELinux off is not an answer.
#
# Knowingly unprobed: the only way to fail this is to put SELinux in permissive
# or disabled mode, which the project forbids outright, and returning from
# disabled requires a full relabel and a reboot the harness does not control.
# unprobed-invariant: selinux-enforcing
[ "$(getenforce)" = "Enforcing" ]
ck selinux-enforcing "SELinux is still enforcing" $? "getenforce=$(getenforce)"

exit 0
