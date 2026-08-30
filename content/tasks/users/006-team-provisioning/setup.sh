#!/usr/bin/env bash
# Remove any prior attempt so the task is repeatable, and prove the names are
# free before the student is told to create them. "Any prior attempt" means
# every artefact the shipped solutions and antisolutions create: the three
# accounts, the group, /etc/sudoers.d/devops, and a %devops line appended to
# /etc/sudoers by solutions/02. It is not a claim about arbitrary changes a
# student might have made by hand; the preconditions below are what catch those,
# by failing loudly rather than by cleaning up.
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

for u in alice bob carol; do
  if id "$u" &>/dev/null; then
    sudo userdel -r "$u" 2>/dev/null || sudo userdel "$u"
  fi
done
getent group devops &>/dev/null && sudo groupdel devops
sudo rm -f /etc/sudoers.d/devops

# solutions/02 grants sudo by appending %devops to /etc/sudoers itself rather
# than by dropping a file in /etc/sudoers.d, so removing the drop-in is not
# enough to undo it. Without this line a second run trips its own %devops
# precondition below and exits 1. Same class as the fcontext -e cleanup in
# selinux/019's setup: idempotent with respect to a prior *solution*, not just
# with respect to a prior setup.
sudo sed -i '/^[[:space:]]*%devops/d' /etc/sudoers

# The task says not to touch student; make sure it starts correct so the
# invariant checkpoint means something.
need sudo usermod -aG wheel student

# --- preconditions --------------------------------------------------------
# Every goal checkpoint measures a property of the *starting* state, and each
# one gets a check here. A precondition that only guards this script would
# leave the checkpoints free to pass at baseline for reasons that have nothing
# to do with the student, which is a student-facing false pass and not a
# solved task (Task 21 finding F1).

# group-gid: the group must not exist, and GID 5000 must be free - if some
# other group holds 5000, `groupadd -g 5000 devops` fails in every solution and
# the failure would look like a grader bug.
! getent group devops &>/dev/null || fail "group devops still exists after groupdel"
if getent group 5000 &>/dev/null; then
  fail "GID 5000 is already taken by group '$(getent group 5000 | cut -d: -f1)'; this guest was not built to docs/vm-build-checklist.md"
fi

# alice-in-devops, bob-in-devops, carol-in-devops: all three are satisfied at
# baseline only because the accounts do not exist yet. carol-expiry needs the
# account to be absent too, but absence alone is not sufficient for it - see the
# EXPIRE guard below.
for u in alice bob carol; do
  ! id "$u" &>/dev/null || fail "user $u still exists after userdel"
done

# alice-maxdays: the checkpoint is `shadow field 5 == 30`. A guest whose
# /etc/login.defs already sets PASS_MAX_DAYS 30 would satisfy it from a bare
# `useradd alice`, so the aging half of this task would grade as done when
# nobody set any aging.
maxdef=$(awk '$1 == "PASS_MAX_DAYS" { print $2 }' /etc/login.defs 2>/dev/null | tail -n1)
if [ "${maxdef:-}" = "30" ]; then
  fail "/etc/login.defs sets PASS_MAX_DAYS 30, so useradd alone would satisfy alice-maxdays"
fi

# carol-expiry: the exact analogue of the guard above. EXPIRE= in
# /etc/default/useradd is the default `useradd -e`, so a guest that already sets
# it to the date the prompt asks for would satisfy carol-expiry from a bare
# `useradd carol` and the expiry half of the task would grade as done when
# nobody set an expiry. Compared as a day count in LOCAL time for the same
# reason grade.sh does - see the strtoday note there. Any other date is
# harmless: carol-expiry still starts red and the student still has to fix it.
expdef=$(awk -F= '$1 == "EXPIRE" { print $2 }' /etc/default/useradd 2>/dev/null | tail -n1)
if [ -n "${expdef:-}" ]; then
  wantday=$(( $(date -d 2027-06-30 +%s) / 86400 ))
  if expsecs=$(date -d "$expdef" +%s 2>/dev/null); then
    if [ "$(( expsecs / 86400 ))" = "$wantday" ]; then
      fail "/etc/default/useradd sets EXPIRE=$expdef, so useradd alone would satisfy carol-expiry"
    fi
  fi
fi

# sudo-devops: nothing may already grant devops members full sudo, and the
# sudoers files must parse - solution 02 rewrites /etc/sudoers, and a starting
# file that already fails visudo would break it for reasons of its own.
[ ! -e /etc/sudoers.d/devops ] || fail "/etc/sudoers.d/devops survived the rm"
if sudo grep -rqs '^[[:space:]]*%devops' /etc/sudoers /etc/sudoers.d; then
  fail "a %devops sudoers rule is already present; sudo-devops would pass at baseline"
fi
sudo visudo -c >/dev/null 2>&1 \
  || fail "the sudoers files do not already parse; solution 02 rewrites /etc/sudoers and cannot start from a broken one"

# student-intact: prove the invariant is true before the student starts, so a
# failure can only mean the student broke it.
id -nG student | tr ' ' '\n' | grep -qx wheel \
  || fail "student is not in wheel after usermod; the student-intact invariant would fail for every fixture"

cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
