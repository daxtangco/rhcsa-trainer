#!/usr/bin/env bash
# Four goal checkpoints, all of which must hold in both verdicts, plus one
# invariant.
#
# There is deliberately no "does the machine have an IP" checkpoint. It would
# pass before the reboot and fail after it for the autoconnect case, and a
# checkpoint whose meaning changes between the two verdicts is a checkpoint
# nobody can interpret. net-autoconnect tests the same thing by reading the
# configuration, in both phases, unambiguously.
# baseline-fail: sshd-enabled, sshd-listening, firewall-ssh, net-autoconnect
set -uo pipefail

systemctl is-enabled sshd &>/dev/null
ck sshd-enabled "sshd is enabled at boot" $? "is-enabled=$(systemctl is-enabled sshd 2>&1)"

# ss over systemctl is-active: what matters is that something is listening on
# 22, not which unit put it there.
ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -qE '(^|:)22$'
ck sshd-listening "something is listening on TCP 22" $?

# --permanent covers both verdicts: if it is in the permanent config it is in
# the runtime config after the reboot, and the runtime check below would be
# redundant with sshd-listening before it.
# Both spellings count. --add-service=ssh and --add-port=22/tcp are equally
# correct answers, and spec 6.5 rule 1 forbids grading the mechanism, so
# accepting only the named service would fail a correct solution.
perm=$(sudo firewall-cmd --permanent --list-all 2>/dev/null)
grep -qw ssh <<<"$perm" || grep -qw 22/tcp <<<"$perm"
ck firewall-ssh "the firewall permits ssh permanently" $?

conn=$(cat /etc/rhcsa-conn 2>/dev/null)
auto=$(nmcli -g connection.autoconnect connection show "$conn" 2>/dev/null)
[ "$auto" = "yes" ]
ck net-autoconnect "connection '$conn' comes up automatically" $? "autoconnect=${auto:-unknown}"

# Knowingly unprobed: an anti-solution that damages the student account destroys
# the account both transports log in as, so the harness would lose the guest
# mid-fixture and could not tell "correctly broken" from "unreachable". vmrun
# authenticates to the guest as student too, so the fallback control plane is no
# help here.
# Replacing this check with an unconditional pass would validate green across
# all six fixtures; that is the risk being accepted here, not overlooked.
# unprobed-invariant: student-intact
id -nG student | tr ' ' '\n' | grep -qx wheel
ck student-intact "the student account is still in wheel" $?

exit 0
