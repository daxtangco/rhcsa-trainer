#!/usr/bin/env bash
# baseline-fail: unit-verifies, stamp-enabled, stamp-effect
set -uo pipefail

unit=/etc/systemd/system/rhcsa-stamp.service
# systemd-analyze verify is the real parser: it catches a missing [Install]
# section, a typo'd directive, and an ExecStart that does not exist.
sudo systemd-analyze verify rhcsa-stamp.service &>/dev/null
ck unit-verifies "rhcsa-stamp.service exists and systemd accepts it" $? \
  "unit_file=$([ -f "$unit" ] && echo present || echo missing)"

# is-enabled covers enabled and enabled-runtime, and also "static" - which is
# why the grep is anchored: a static unit is not what was asked for.
state=$(systemctl is-enabled rhcsa-stamp.service 2>&1)
printf '%s' "$state" | grep -qx enabled
ck stamp-enabled "rhcsa-stamp.service is enabled" $? "is-enabled=$state"

# Before the reboot this only proves the unit can run. After the reboot, /run
# has been wiped, so the file can only exist because systemd ran the unit at
# boot - which is the actual requirement.
[ -f /run/rhcsa-stamp ]
ck stamp-effect "/run/rhcsa-stamp exists (after the reboot: it ran at boot)" $?

# An invariant, and the only one in this batch that an anti-solution does
# actually probe - antisolutions/03-broke-the-target.sh. That is the pattern
# the four checkpoints carrying an unprobed-invariant header would follow if
# breaking them were survivable.
target=$(systemctl get-default 2>&1)
[ "$target" = "multi-user.target" ]
ck default-target "the system boots to multi-user.target" $? "get-default=$target"

# Knowingly unprobed: breaking sshd is breaking the ssh control plane this task
# is graded over (transport: ssh), so the fixture would take the grader down
# with it. troubleshooting/028 probes exactly this failure, deliberately, over
# vmrun - which is why that task exists.
# unprobed-invariant: sshd-intact
# Anchored on the exact string, the same spelling as stamp-enabled above and as
# selinux/019 and troubleshooting/028 use. is-enabled's exit status is also 0 for
# static, indirect, generated, alias and enabled-runtime, and this is an
# invariant - nobody reads it until the day it lies, so the loose form is worse
# here than in a goal checkpoint.
sshd_state=$(systemctl is-enabled sshd 2>&1)
printf '%s' "$sshd_state" | grep -qx enabled
ck sshd-intact "sshd is still enabled" $? "is-enabled=$sshd_state"

exit 0
