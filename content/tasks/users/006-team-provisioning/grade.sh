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

# Field 8 of /etc/shadow is the expiry date as a day count, not a timestamp, so
# compare day counts. `date -d` is deliberately UTC: what shadow-utils stores for
# a bare YYYY-MM-DD is that calendar date's own day number, so the expected value
# has to be built the same way. Local midnight is what gets this wrong - on a
# guest ahead of UTC it lands on the previous UTC day, and the integer divide then
# truncates to the day before the one the prompt asked for. Do not drop the -u.
#
# This corrects an earlier comment here that claimed the opposite and forbade -u.
# Measured on this guest, shadow-utils-4.9-16.el9 in Asia/Manila: `chage -E
# 2027-06-30`, `useradd -e 2027-06-30` and `useradd -g devops -e 2027-06-30` all
# write 20999; `date -u -d 2027-06-30 +%s / 86400` is 20999 and plain `date` is
# 20998. Stated as a measurement rather than as a claim about strtoday() on
# purpose - the divergence is what the grader has to match, whatever the parsing
# path inside shadow-utils turns out to be. The old form was invisible on a UTC
# guest, cost four fixtures in the 2026-09-06 validate run, and failed them in
# the worst direction: three solutions and an anti-solution all told a student
# who typed exactly what the prompt asks that carol's expiry was wrong.
#
# Two steps, not one. Nested inside the arithmetic, a `date` that emitted nothing
# would leave `want` unset, the comparison below would trip `set -u`, and the
# grader would die mid-run: carol-expiry, alice-maxdays, sudo-devops and
# student-intact would VANISH from the JSONL instead of failing. A checkpoint that
# is absent reads as a pass to anything counting failures, which is the one thing
# the JSONL contract exists to prevent. Unreachable with GNU coreutils, and
# fail-closed anyway: the epoch read is tested directly below rather than through
# the value derived from it, so no shadow field 8 - not 0, not the sentinel string
# itself - can make this pass on a host where `date` produced nothing.
want_epoch=$(date -u -d 2027-06-30 +%s 2>/dev/null)
if [ -n "$want_epoch" ]; then
  want=$(( want_epoch / 86400 ))
else
  want=unavailable
fi
days=$(sudo getent shadow carol | cut -d: -f8)
[ -n "$want_epoch" ] && [ -n "$days" ] && [ "$days" = "$want" ]
ck carol-expiry "carol's account expires 2027-06-30" $? "shadow field 8=${days:-empty}, want=$want"

max=$(sudo getent shadow alice | cut -d: -f5)
[ "$max" = "30" ]
ck alice-maxdays "alice must change her password every 30 days" $? "maxdays=${max:-empty}"

# sudo -l -U asks the real sudoers parser what alice may run, so it does not
# matter whether the rule is in /etc/sudoers or a file in /etc/sudoers.d.
# The runas spec is matched loosely on purpose. All three of these are valid
# sudoers that grant everything, and sudo -l renders them differently:
#   %devops ALL=(ALL) ALL      -> (ALL) ALL
#   %devops ALL=ALL            -> (root) ALL
#   %devops ALL=(ALL:ALL) ALL  -> (ALL : ALL) ALL     (note the spaces)
# so the runas user, the optional runas group and the whitespace around the
# colon are all matched permissively. A non-ALL, non-root runas target still
# fails, because that grants something narrower than the prompt asks for.
sudo sudo -l -U alice 2>/dev/null | grep -qE '\((ALL|root)([[:space:]]*:[[:space:]]*(ALL|root))?\)[[:space:]]+(NOPASSWD:[[:space:]]*)?ALL'
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
