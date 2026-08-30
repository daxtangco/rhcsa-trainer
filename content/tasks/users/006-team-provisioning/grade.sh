#!/usr/bin/env bash
# Graded end state. student-intact passes before any work is done: it is an
# invariant, there to catch an answer that solves the task destructively.
# baseline-fail: group-gid, alice-in-devops, bob-in-devops, carol-in-devops, carol-expiry, alice-maxdays, sudo-devops
set -uo pipefail

gid=$(getent group devops | cut -d: -f3)
[ "$gid" = "5000" ]
ck group-gid "group devops exists with GID 5000" $? "gid=${gid:-none}"

# id -nG lists every group, primary and secondary, whatever mechanism put the
# user there. Written out three times rather than looped, because every
# checkpoint id must be a literal - see the note below.
in_devops() { id -nG "$1" 2>/dev/null | tr ' ' '\n' | grep -qx devops; }

in_devops alice
ck alice-in-devops "alice is a member of devops" $?
in_devops bob
ck bob-in-devops "bob is a member of devops" $?
in_devops carol
ck carol-in-devops "carol is a member of devops" $?

# Field 8 of /etc/shadow is the expiry date in days since the epoch.
# 2027-06-30 is what the prompt asks for; compare as a date, not as a string,
# so any correct spelling of the date passes.
want=$(date -u -d 2027-06-30 +%s)
days=$(sudo getent shadow carol | cut -d: -f8)
got=$([ -n "$days" ] && echo $((days * 86400)) || echo "")
[ -n "$got" ] && [ "$got" = "$want" ]
ck carol-expiry "carol's account expires 2027-06-30" $? "shadow field 8=${days:-empty}"

max=$(sudo getent shadow alice | cut -d: -f5)
[ "$max" = "30" ]
ck alice-maxdays "alice must change her password every 30 days" $? "maxdays=${max:-empty}"

# sudo -l -U asks the real sudoers parser what alice may run, so it does not
# matter whether the rule is in /etc/sudoers or a file in /etc/sudoers.d.
sudo sudo -l -U alice 2>/dev/null | grep -qE '\(ALL(:ALL)?\)[[:space:]]+(NOPASSWD:[[:space:]]*)?ALL'
ck sudo-devops "members of devops may run any command with sudo" $?

# Knowingly unprobed: an anti-solution that damages the student account destroys
# the account both transports log in as, so the harness would lose the guest
# mid-fixture and could not tell "correctly broken" from "unreachable".
# Replacing this check with an unconditional pass would validate green across
# all six fixtures; that is the risk being accepted here, not overlooked.
# unprobed-invariant: student-intact
id -nG student | tr ' ' '\n' | grep -qx wheel
ck student-intact "the student account is untouched and still in wheel" $?

exit 0
