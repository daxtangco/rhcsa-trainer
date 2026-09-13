#!/usr/bin/env bash
# Prepare the system for containers/031-build-and-inspect-image.
#
# Idempotent: a reset reverts to the `clean` snapshot, but this must also
# survive being run twice, and after any fixture, on the same machine. Every
# artefact a solution or an anti-solution can leave behind - images in either
# store, the answer file, the build directory, the host copy of the stamp file,
# a permissive SELinux mode - is removed or checked below.
set -uo pipefail

# No `set -e`. Most of this file is idempotent removal, and `podman rmi -af` on
# an empty store or `rm -f` on an absent file failing is normal on a first run.
# The commands that MUST work are wrapped in `need` instead: a silent failure
# here stages the wrong machine, and every checkpoint result afterwards is then
# a statement about the machine rather than about the student. Deliberately
# different from content/tasks/storage/014-grow-home-lv/setup.sh, which uses
# `set -euo pipefail` because it has no removal step; do not harmonise them.
need() { "$@" || { printf 'setup.sh: FAILED: %s\n' "$*" >&2; exit 1; }; }
fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

# The same four constants the grader uses. If one of these ever changes, it has
# to change in both files or the preconditions stop guarding the checkpoints.
BASE_REF=registry.access.redhat.com/ubi9/ubi:latest
FACTS=/home/student/ubi9-facts.txt
BUILD_DIR=/home/student/rhcsa-build
STAMP=/etc/rhcsa-build.txt

# --- who we are -----------------------------------------------------------
# The grader hardcodes /home/student, and rootless podman keeps its store under
# the *invoking user's* home. Run as anybody else and every image checkpoint
# measures a container store the student never touched, which is a false fail
# nothing else in this file could detect.
me=$(id -un 2>/dev/null)
[ "$me" = student ] \
  || fail "running as '${me:-unknown}', not student; the grader reads student's rootless container storage and /home/student, so nothing here would measure the student's work"

command -v podman >/dev/null \
  || fail "podman is not installed; docs/vm-build-checklist.md specifies it, and every checkpoint in this task reads its storage"
# Solution 02 builds with buildah instead of podman, on purpose (risk R4: a
# grader must not be over-fitted to one command sequence). If buildah is
# missing, that fixture fails for a reason that has nothing to do with the
# grader being right or wrong.
command -v buildah >/dev/null \
  || fail "buildah is not installed; solutions/02 builds with it to prove the grader is not fitted to podman build alone"
command -v curl >/dev/null \
  || fail "curl is missing, so this script cannot prove the registry is reachable"

# --- SELinux state: the shared repair policy ------------------------------
# Carried verbatim by containers/030-container-web-service,
# containers/031-build-and-inspect-image and selinux/032-selinux-denial-triage -
# the three tasks whose graders emit an "SELinux is enforcing" invariant. Change
# it in one place and change it in all three, or the tasks disagree about whose
# job it is to repair a machine-wide global and one task's fixture quietly
# rewrites another task's baseline.
#
# THE RULE: no setup.sh repairs SELinux state. Not the runtime mode, not
# /etc/selinux/config. A setup.sh stages its own task and asserts what it staged;
# both of those are machine-wide state that outlives every task in the bank.
#
# Rejected - "every setup.sh repairs both halves before its preconditions run":
# it cannot tell a sibling fixture's leftover from a guest that was genuinely
# built permissive at boot, so it launders the second case into a green stage and
# the operator never learns the image is wrong. In selinux/032 it would also erase
# the exact state that task's invariant exists to detect.
#
# Rejected harder - `setenforce 1` alone, leaving SELINUX=permissive in the
# config: it repairs the half the next boot would have repaired anyway and leaves
# the half that persists. The task stages green, grades green, and the guest is
# permissive again at the next boot, failing this invariant and its siblings' in a
# later run that points back at nothing.
#
# So: CHECK BOTH HALVES, REPAIR NEITHER. Both, because `setenforce 1` does not
# touch the config and editing the config does not change the running mode, so
# either can be wrong while the other is right.
#
# And diagnose it identically in all three. The lab never turns SELinux off, so
# report what was found, name the likely cause - a fixture or a practice session
# run without the snapshot revert that normally precedes setup, or a `clean`
# snapshot captured while the guest was already permissive - and prescribe the
# revert. Only a freshly reverted guest that is still not enforcing means the
# image is wrong; no task may blame the image on its own evidence.
#
# The other half of the policy lives in antisolutions/: a fixture may break the
# runtime mode, which the next boot undoes, and may never write a persistent
# global it is not graded on repairing. That is why selinux/032's
# mode-enforcing-config is a declared unprobed invariant rather than one a `sed`
# in a fixture probes.
#
# THIS FILE IS WHERE THE REJECTED REPAIR CAME FROM, and that is recorded here
# rather than quietly dropped. It used to run `sudo setenforce 1 &>/dev/null` in
# the teardown below, on the reasoning that antisolutions/04 leaves the mode
# wrong and a runtime-only change needs no relabel and no reboot to undo. The
# reasoning was sound about this task's own fixture and wrong about everything
# else: the same line also silently repaired selinux/032's anti-solution, which
# at the time wrote SELINUX=permissive into the config as well. So 031 laundered
# a sibling's *persistent* damage into a green stage, and the guest came up
# permissive at some later boot with nothing left pointing at the cause. The
# repair is gone; 031 now reports and refuses, like its two siblings.
#
# Checked ahead of the teardown below, not with the other preconditions at the
# bottom of this file, and the ordering is deliberate: a guest that cannot be
# staged should say so before this script deletes containers/030's pre-pulled
# ~250 MB image and before the skopeo install.
#
# getenforce is checked separately from the mode it reports, because an empty
# result has two very different causes: a permissive guest is a leftover to
# revert, a missing binary is a broken image. Folding them together would print
# the revert advice at someone whose guest has no libselinux-utils.
command -v getenforce >/dev/null \
  || fail "getenforce is missing (libselinux-utils); the selinux-enforcing invariant cannot be evaluated, see docs/vm-build-checklist.md"
enforce=$(getenforce 2>/dev/null)
[ "$enforce" = "Enforcing" ] \
  || fail "getenforce reports '${enforce:-nothing}' and selinux-enforcing is an invariant of this task. Nothing in the lab ever turns SELinux off, so this is a leftover: most likely a fixture or a practice session run without the snapshot revert that normally precedes setup, or a 'clean' snapshot captured while the guest was already permissive. Revert to the clean snapshot and start again - not repaired here on purpose, see the SELinux state policy above. If a freshly reverted guest still does not report Enforcing, the image is wrong; rebuild it to docs/vm-build-checklist.md"

# The config half. task.yaml sets reboot_check: false, so this one does not guard
# 031's own verdict B - there is no verdict B. It guards the CLAIM the checkpoint
# makes: "SELinux is still enforcing" is a statement about the machine the student
# hands back, and a machine whose config says permissive is one boot away from not
# being enforcing at all. Grading that green would teach that the config half does
# not count. Same parse selinux/032's grader uses for mode-enforcing-config: the
# last assignment wins, a comment cannot match because the pattern is anchored and
# '#' is not whitespace, and SELINUXTYPE= cannot match because the character after
# SELINUX must be whitespace or '='.
SELINUX_CONFIG=/etc/selinux/config
cfg_mode=$(awk -F= '/^[[:space:]]*SELINUX[[:space:]]*=/ { v = $2 } END { print v }' "$SELINUX_CONFIG" 2>/dev/null | tr -d '[:space:]')
[ "$cfg_mode" = "enforcing" ] \
  || fail "SELINUX is '${cfg_mode:-nothing}' in $SELINUX_CONFIG, so the next boot leaves this guest permissive even if getenforce says Enforcing right now. Same cause and same remedy as above: revert to the clean snapshot rather than hand-editing the file, because an edit here repairs the symptom and hides how the guest got into this state. If a freshly reverted guest still says '${cfg_mode:-nothing}', the image is wrong; rebuild it to docs/vm-build-checklist.md"

# --- stop anything that could refill the store ----------------------------
# This runs BEFORE the removals below, and it exists because of one specific
# neighbour: containers/030-container-web-service leaves an ENABLED, LINGERING
# user-level podman unit behind (a quadlet .container, a `podman generate systemd`
# unit or a hand-written one, depending on which of its three solutions ran) plus
# a pre-pulled ~250 MB image it keeps on purpose. Alternate 030 and 031 on one
# guest without a snapshot revert in between and the sequence is: this file runs
# `podman rm -af; podman rmi -af`, 030's still-running user manager restarts its
# container from its unit - or user podman-restart.service does it at the next
# user-manager start - and the emptiness assertion further down fails with
# "student's rootless container storage still holds N image(s)". The task then
# refuses to start, and the message blames the store rather than the unit that is
# refilling it.
#
# So the units come down first: stop them, un-enable them, delete the files that
# re-generate them, and drop linger so no user manager outlives this ssh session
# to start anything after the removals below have run. Removed rather than merely
# detected and refused, because "this guest last ran 030" is an ordinary state to
# arrive from - a practice session alternating between the two container tasks -
# rather than an operator error worth refusing to stage. What 031 will not do
# quietly is repair machine-wide state; a user unit under /home/student that this
# task's own baseline requires to be gone is not that.
#
# THE COST, stated rather than accepted silently: 030 keeps its image pre-pulled
# so that a student's time budget is not spent on a ~250 MB registry pull, and the
# `podman rmi -af` below throws it away. Alternating between the two tasks on one
# guest therefore re-pays that pull every time 030 is staged. 031 cannot do
# better: its baseline REQUIRES an empty store, because six of its checkpoints
# read "the student produced this image" and any pre-existing image makes them
# passable at baseline. The real fix is the harness's snapshot revert, which
# 030's own setup.sh already relies on and which makes this whole section a
# belt-and-braces path for hand practice on a dirty guest.
#
# Every command here is best-effort: on a clean guest there is nothing to stop,
# and `set -e` is deliberately not in force (see the top of this file).
#
# `ssh host bash -s` gives a non-login shell, and every systemctl --user call
# below needs the bus this points at. Exported rather than passed, because
# systemctl reads it from the environment. If the directory is missing, every
# command below silently does nothing - which is caught downstream by the
# emptiness assertion and by the explicit XDG_RUNTIME_DIR check in the
# preconditions, both of which fail loudly.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# Match on ExecStart rather than on a unit name, which is what makes this
# route-agnostic: 030's three solutions produce webcontent.service (quadlet),
# container-websvc.service (`podman generate systemd`) and websvc.service
# (hand-written), and a student practising by hand will have invented a fourth
# name. `list-units --all` only sees *loaded* units; the file sweep below handles
# a unit file that never loaded.
#
# < /dev/null on the disable, following the pattern documented at
# content/tasks/sys/035-persistent-journal-and-schedule/grade.sh:206. This script
# is delivered on ssh stdin, and although this loop reads from a process
# substitution rather than from the script, systemctl is free to fork helpers;
# one that read a line would eat the next line of this file, which would then
# never run and never error.
while read -r unit; do
  [ -n "$unit" ] || continue
  exec_start=$(systemctl --user show "$unit" --property=ExecStart --value 2>/dev/null)
  case $exec_start in
    *podman*) systemctl --user disable --now "$unit" &>/dev/null < /dev/null ;;
  esac
done < <(systemctl --user list-units --type=service --all --no-legend 2>/dev/null |
  sed 's/^[^A-Za-z0-9]*//' | awk '{print $1}')

# The two shipped podman units that restart containers on their own, named
# explicitly because neither is necessarily *loaded* at this moment and the
# ExecStart sweep above only sees loaded units. podman-restart.service starts
# every container with --restart=always; the auto-update pair pulls and restarts
# on a timer.
systemctl --user disable --now podman-restart.service &>/dev/null < /dev/null
systemctl --user disable --now podman-auto-update.timer podman-auto-update.service &>/dev/null < /dev/null

# Quadlet reads this directory at every daemon-reload and at every boot, so the
# .container file IS the enablement - deleting it is the only way to un-enable it.
rm -rf "$HOME/.config/containers/systemd"

# Hand-written and generated unit files, plus the .wants symlinks that enabled
# them. Scoped to files that mention podman, so an unrelated user unit is left
# alone.
for f in "$HOME"/.config/systemd/user/*.service; do
  [ -f "$f" ] || continue
  if grep -q podman "$f"; then
    rm -f "$f"
    rm -f "$HOME/.config/systemd/user/default.target.wants/$(basename "$f")"
  fi
done
systemctl --user daemon-reload &>/dev/null < /dev/null

# Linger off, both mechanisms: loginctl keeps its state in
# /var/lib/systemd/linger/<user>, and a student may have created that file
# directly. Without this a user manager outlives this ssh session and can start a
# container after the removals below have run. loginctl ships with systemd, so a
# missing binary here means a guest with bigger problems; the file removal covers
# that case anyway, which is why this is not a `need`.
sudo loginctl disable-linger "$me" &>/dev/null < /dev/null
sudo rm -f "/var/lib/systemd/linger/$me"

# --- undo any previous attempt -------------------------------------------
# Containers first: an image with a container referencing it will not remove.
podman rm -af &>/dev/null
podman rmi -af &>/dev/null

# And root's store too. `sudo podman pull` is the single most common wrong
# reflex on this task, so a previous attempt may well have left images there.
# They are removed rather than merely counted, because a leftover root-owned
# rhcsa-ubi:v1 would make the whole exercise look done to a student who ran
# `sudo podman images` to check their work.
sudo podman rm -af &>/dev/null
sudo podman rmi -af &>/dev/null

rm -f "$FACTS"
rm -rf "$BUILD_DIR"
# antisolutions/02 creates this on the HOST, which is the confusion that fixture
# exists to represent. Left in place it would not make any checkpoint pass - the
# grader only ever looks inside the image - but it would let a student who
# checked with `cat /etc/rhcsa-build.txt` believe the file was baked in.
sudo rm -f "$STAMP"

# Nothing repairs SELinux here. A `sudo setenforce 1` used to sit at exactly this
# point; see the SELinux state policy above this teardown for what it was, why it
# is gone, and what the two checks that replaced it do instead.

# --- tooling the task and its fixtures need ------------------------------
# skopeo is on the DVD AppStream repo but not installed on this guest, and
# "Perform container management using commands such as podman and skopeo" is one
# of the objectives this task claims. Installed here rather than assumed:
# solutions/02 retrieves the image with `skopeo copy`, and a student who wants
# `skopeo inspect` to read the image without pulling it should find it present.
#
# < /dev/null is load-bearing, not decoration. This file is delivered to the
# guest on ssh stdin (`bash -s`, src/engine/vm/ssh.ts:167-168), so the unread
# remainder of this script IS stdin, and rpm scriptlets are /bin/sh forks that
# inherit it. One scriptlet reading a single line silently deletes the next line
# of setup, which then never runs and never errors - including, potentially, a
# precondition that exists to catch half-staged state. Same pattern and same
# reason as content/tasks/sys/035-persistent-journal-and-schedule/grade.sh:206.
if ! command -v skopeo >/dev/null; then
  sudo dnf -y install skopeo &>/dev/null < /dev/null
fi
command -v skopeo >/dev/null \
  || fail "skopeo is not installed and could not be installed from the rhcsa-appstream repo; check that the DVD is still mounted at /mnt/rhcsa-dvd"

# --- create the situation the prompt describes ---------------------------
# The prompt says the build directory is already there and empty. Handing the
# student the directory removes an ambiguity (which path?) without giving away
# any part of the answer, and it means the grader can name one place to look.
need mkdir -p "$BUILD_DIR"
need chmod 0755 "$BUILD_DIR"

# --- preconditions --------------------------------------------------------
# Every checkpoint the grader emits gets a check here, not only the ones this
# script needs to run. A precondition that guards the script alone leaves the
# checkpoints free to pass or fail for reasons that have nothing to do with the
# student, which is a false pass wearing a green tick (Task 21 finding F1).

# All eight image and answer checkpoints depend on rootless podman working for
# this user at all. `podman images` is the cheapest command that touches the
# store, and its failure output is the diagnosis.
imgs=$(podman images -qa 2>&1) \
  || fail "'podman images' failed as student, so no image checkpoint can measure anything: $imgs"

# base-image-present, derived-image-tagged, derived-from-base, stamp-file-baked,
# image-label and default-cmd-prints-stamp all mean "the student produced this
# image". Every one of them would pass at baseline if the store were not empty.
# The clean guest has zero images; this proves the removals above worked too.
if [ -n "$imgs" ]; then
  fail "student's rootless container storage still holds $(printf '%s\n' "$imgs" | wc -l) image(s) after 'podman rmi -af'; every image checkpoint could pass at baseline. If this guest has run containers/030-container-web-service, a user unit it left behind may be recreating a container - and an image with a container on it will not remove. The teardown above stops those units and drops linger; a store that is still not empty means something outside 030's shapes is pulling or starting images, so check 'systemctl --user list-units' and 'loginctl show-user $me' before anything else"
fi

# Rootless pull and build need a subuid/subgid range for this user. Without one
# podman fails with a user-namespace error and every fixture dies in its first
# command - diagnosable, but worth naming here rather than reading it out of a
# fixture's stderr.
grep -q '^student:' /etc/subuid \
  || fail "no /etc/subuid range for student, so rootless podman cannot map UIDs and no image can be pulled or built"
grep -q '^student:' /etc/subgid \
  || fail "no /etc/subgid range for student, so rootless podman cannot map GIDs and no image can be pulled or built"

# `podman build` wants a runtime directory. A non-interactive ssh session gets
# one from pam_systemd; if the session stack ever stops creating it, the pull
# may still work while the build does not, which would look like the student
# writing a bad Containerfile.
runtime=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
[ -d "$runtime" ] \
  || fail "no runtime directory at $runtime (pam_systemd did not create one for this ssh session), so 'podman build' will fail for reasons unrelated to the student"

# stamp-file-baked is the only checkpoint that reads the contents of an image,
# and `podman image diff` is the only read-only way to do it - a grader may not
# start a container or mount an image. If this podman does not have the
# subcommand, that checkpoint would fail for every fixture including the correct
# ones, so it is better to say so now.
podman image diff --help &>/dev/null \
  || fail "this podman has no 'image diff' subcommand, which is the only read-only way the grader can look inside an image"

# facts-default-cmd and facts-image-id: the answer file must not exist yet.
[ ! -e "$FACTS" ] || fail "$FACTS still exists, so both answer checkpoints could pass at baseline"

# containerfile-authored: the build directory must be there and empty of any
# build file. Both names are checked because podman build accepts either, so a
# leftover Dockerfile would satisfy the checkpoint at baseline.
[ -d "$BUILD_DIR" ] || fail "$BUILD_DIR was not created, so the student has nowhere the grader will look"
[ ! -e "$BUILD_DIR/Containerfile" ] \
  || fail "$BUILD_DIR/Containerfile already exists, so containerfile-authored could pass at baseline"
[ ! -e "$BUILD_DIR/Dockerfile" ] \
  || fail "$BUILD_DIR/Dockerfile already exists, and podman build accepts that name too, so containerfile-authored could pass at baseline"
[ -w "$BUILD_DIR" ] || fail "$BUILD_DIR is not writable by student, so the Containerfile cannot be authored there"

# stamp-file-baked again, from the other side: the host copy must be gone. It
# proves the `sudo rm -f` above worked on a re-run.
[ ! -e "$STAMP" ] \
  || fail "$STAMP still exists on the host; the grader ignores it, but a student checking their work with 'cat' would be misled"

# selinux-enforcing is an invariant, and both halves of it - the runtime mode and
# /etc/selinux/config - are checked near the TOP of this file rather than here,
# ahead of the user-unit teardown, the image removals and the skopeo install. See
# the SELinux state policy there for why they are checked and never repaired.
# Nothing between there and here changes either half, so there is no gap.

# The pull is the task. Without egress to the registry there is no solution at
# all, so this is unsolvable rather than hard. /v2/ answers 200 unauthenticated
# on registry.access.redhat.com; 401 and 403 are accepted because they equally
# prove the endpoint was reached, and only a transport failure (000) or a 5xx is
# fatal here.
code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' https://registry.access.redhat.com/v2/ 2>/dev/null)
case $code in
  200 | 401 | 403) ;;
  *) fail "https://registry.access.redhat.com/v2/ answered '${code:-nothing}'; without egress to the registry the image cannot be retrieved and this task has no solution" ;;
esac

# The rootless store lives under /home/student, so the pull and the build both
# spend space there. UBI 9 is roughly 220 MB unpacked and the build adds a
# layer; 1 GiB is a floor that catches a full /home rather than a tight one.
avail=$(df -B1 --output=avail /home/student 2>/dev/null | tail -n1 | tr -d ' ')
[ -n "$avail" ] || fail "could not read the free space on /home/student, where the rootless image store lives"
if [ "$avail" -lt 1073741824 ]; then
  fail "only ${avail} bytes free on /home/student; the pull and the build need room, and an ENOSPC failure would read as a wrong answer"
fi

# The grader never reads history, but a student who reverts and finds their own
# previous commands has been given a hint nobody offered them.
: > "$HOME/.bash_history" 2>/dev/null || true

exit 0
