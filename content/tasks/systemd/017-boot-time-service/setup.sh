#!/usr/bin/env bash
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

sudo systemctl disable --now rhcsa-stamp.service &>/dev/null
sudo rm -f /etc/systemd/system/rhcsa-stamp.service
sudo rm -f /run/rhcsa-stamp
sudo systemctl daemon-reload

# `need` cannot wrap a pipeline or a heredoc, so this one is checked with an
# explicit `if !` instead. Same contract: a silent failure here stages a
# machine where the helper the prompt promises does not exist.
if ! sudo tee /usr/local/bin/rhcsa-stamp >/dev/null <<'EOF'
#!/usr/bin/env bash
printf 'stamped\n' > /run/rhcsa-stamp
EOF
then
  printf 'setup.sh: FAILED: staging /usr/local/bin/rhcsa-stamp\n' >&2
  exit 1
fi
need sudo chmod 0755 /usr/local/bin/rhcsa-stamp
need sudo restorecon /usr/local/bin/rhcsa-stamp

# These two stage the default-target and sshd-intact invariants. &>/dev/null is
# deliberately absent: if either fails the reason should be visible, because a
# silent failure would report that the student broke something setup never set
# up in the first place.
need sudo systemctl set-default multi-user.target
need sudo systemctl enable sshd

# --- preconditions --------------------------------------------------------
# Every goal checkpoint measures a property of the *starting* state, and each
# one gets a check here. A precondition that only guards this script would
# leave the checkpoints free to pass at baseline for reasons that have nothing
# to do with the student, which is a student-facing false pass and not a
# solved task (Task 21 finding F1).

# unit-verifies: no unit of that name may exist anywhere systemd looks. The
# /usr/lib check is the one that matters - rm above only clears /etc, and a
# packaged unit with this name would make systemd-analyze verify succeed at
# baseline with the student having written nothing.
[ ! -e /etc/systemd/system/rhcsa-stamp.service ] \
  || fail "/etc/systemd/system/rhcsa-stamp.service survived the rm"
[ ! -e /usr/lib/systemd/system/rhcsa-stamp.service ] \
  || fail "a packaged /usr/lib/systemd/system/rhcsa-stamp.service exists; unit-verifies would pass at baseline"
if sudo systemd-analyze verify rhcsa-stamp.service &>/dev/null; then
  fail "systemd already accepts rhcsa-stamp.service; unit-verifies would pass at baseline"
fi

# stamp-enabled: exactly the grader's probe, anchored the same way - which means
# grep -qx, because that is what the grader uses. `state` captures stderr as well,
# so a hint printed alongside the state makes `[ "$state" != "enabled" ]` compare a
# two-line blob and quietly stop matching, and setup would stage a guest where
# stamp-enabled passed at baseline.
state=$(systemctl is-enabled rhcsa-stamp.service 2>&1)
if printf '%s' "$state" | grep -qx enabled; then
  fail "rhcsa-stamp.service is still enabled (is-enabled=$state); stamp-enabled would pass at baseline"
fi

# stamp-effect rests entirely on /run being a tmpfs: that is the only reason a
# marker found there after the reboot proves systemd ran the unit at boot
# rather than the student running it by hand. On a guest where /run persisted,
# this task would grade "enabled" as "started once" and teach the wrong lesson.
runfs=$(findmnt -no FSTYPE /run 2>/dev/null)
[ "$runfs" = "tmpfs" ] \
  || fail "/run is ${runfs:-not a mount point}, not tmpfs; stamp-effect cannot distinguish enabled from started"

# The prompt promises the helper "already exists and works", so prove it: run
# it, confirm it produced the marker, then clear the marker again. Without this
# a broken helper would fail stamp-effect for every fixture including both
# solutions, and the failure would point at the student's unit file.
[ -x /usr/local/bin/rhcsa-stamp ] || fail "/usr/local/bin/rhcsa-stamp is not executable"
need sudo /usr/local/bin/rhcsa-stamp
[ -f /run/rhcsa-stamp ] || fail "/usr/local/bin/rhcsa-stamp did not write /run/rhcsa-stamp"
need sudo rm -f /run/rhcsa-stamp
[ ! -e /run/rhcsa-stamp ] || fail "/run/rhcsa-stamp survived the rm; stamp-effect would pass at baseline"

# default-target and sshd-intact are invariants: prove they are true before the
# student starts, so a failure can only mean the student broke them.
# Same line-shape extraction as this task's grade.sh, for the same reason: a
# precondition that reads the system differently from the grader it is a
# precondition for is a trap.
target_raw=$(systemctl get-default 2>&1)
target=$(printf '%s\n' "$target_raw" | grep -xE '[[:alnum:]@._:-]+\.target' | tail -n 1)
[ "$target" = "multi-user.target" ] \
  || fail "get-default reports '$target' after set-default (full output: $(printf '%s' "$target_raw" | tr '\n' ' ')); the default-target invariant would fail for every fixture"
# sshd-intact's grader probe is `grep -qx enabled` as of the F15 commit, so this
# has to be too. On the bare exit status setup accepted static, indirect,
# generated, alias and enabled-runtime while the grader rejects them - and the
# invariant would then fail for every fixture, which is the exact outcome the two
# checks above exist to rule out.
sshd_state=$(systemctl is-enabled sshd 2>&1)
printf '%s' "$sshd_state" | grep -qx enabled \
  || fail "sshd reports is-enabled='$sshd_state', not enabled, after 'systemctl enable sshd'; the sshd-intact invariant would fail for every fixture"

cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
