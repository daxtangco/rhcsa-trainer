#!/usr/bin/env bash
# Prepare the system for containers/030-container-web-service.
#
# Runs as student over ssh stdin, with passwordless sudo and NO TTY.
#
# No `set -e`. Like selinux/019's setup and unlike storage/014's, this file is
# mostly idempotent *removal*: tearing down a previous attempt's user units,
# containers, linger flag and fcontext rules. Every one of those commands
# legitimately fails on a first run, so the commands that MUST work are wrapped
# in `need` instead - a silent failure here stages the wrong machine and every
# checkpoint result afterwards is a lie.
set -uo pipefail

fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }
need() { "$@" || fail "FAILED: $*"; }

# Everything the grader measures, in one place, so setup and grade.sh cannot
# drift apart on a path or a port. grade.sh repeats these literals rather than
# sourcing them: the two scripts are shipped to the guest separately and a
# grader that depended on a file setup wrote could be fooled by a student
# editing that file.
CONTENT_DIR=/srv/webcontent
MARKER=RHCSA-MARKER-3007
PORT=8080
IMAGE=registry.access.redhat.com/ubi9/httpd-24

# The task is about *this* user's rootless containers, so the identity is
# derived, never hardcoded: the linger flag, the user manager and the container
# storage all belong to whoever setup and grade.sh run as.
USER_NAME=$(id -un)
USER_UID=$(id -u)
[[ -n $USER_NAME && -n $USER_UID ]] || fail "cannot determine the invoking user"

# `ssh host bash -s` gives a non-login shell. pam_systemd normally exports
# XDG_RUNTIME_DIR into the ssh session, but every `systemctl --user` call below
# and in the grader depends on it, and an unset value would make the user-unit
# teardown silently do nothing - leaving a previous attempt's unit in place and
# unit-boot-wanted passing at baseline. Set it explicitly and prove the
# directory is there.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$USER_UID}"
[[ -d $XDG_RUNTIME_DIR ]] ||
  fail "$XDG_RUNTIME_DIR does not exist, so there is no user session bus; the user-unit checkpoints cannot be evaluated"

# --- tooling preconditions ------------------------------------------------
# Checked before the teardown, because a teardown that silently did nothing
# leaves the machine looking solved.
command -v podman >/dev/null || fail "podman is missing; see docs/vm-build-checklist.md"
command -v curl >/dev/null || fail "curl is missing; page-served cannot be evaluated without it"
command -v ss >/dev/null || fail "ss is missing (iproute); cannot prove port $PORT is free at baseline"
command -v loginctl >/dev/null || fail "loginctl is missing; linger-enabled cannot be evaluated without it"
command -v getenforce >/dev/null || fail "getenforce is missing (libselinux-utils)"
# Only used by the teardown below, but a missing semanage means a previous
# attempt's fcontext rule survives and selinux-label passes at baseline.
command -v semanage >/dev/null ||
  fail "semanage is missing (policycoreutils-python-utils); a previous attempt's fcontext rule could not be removed"

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
# Checked up here rather than with the other preconditions at the bottom of this
# file so it lands before the teardown and before the ~250 MB image pull: a guest
# that cannot be staged should not cost a registry round trip to say so.
enforce=$(getenforce 2>/dev/null)
[[ $enforce == Enforcing ]] ||
  fail "getenforce reports '${enforce:-nothing}' and selinux-enforcing is an invariant of this task. Nothing in the lab ever turns SELinux off, so this is a leftover: most likely a fixture or a practice session run without the snapshot revert that normally precedes setup, or a 'clean' snapshot captured while the guest was already permissive. Revert to the clean snapshot and start again - not repaired here on purpose, see the SELinux state policy above. If a freshly reverted guest still does not report Enforcing, the image is wrong; rebuild it to docs/vm-build-checklist.md"

# The config half, and it is not theoretical for this task: task.yaml sets
# reboot_check: true, so selinux-enforcing is graded again after a reboot. A guest
# whose config says permissive passes it in verdict A and fails it in verdict B,
# which is a failure that arrives one reboot away from anything that could explain
# it. Same parse selinux/032's grader uses for mode-enforcing-config: the last
# assignment wins, a comment cannot match because the pattern is anchored and '#'
# is not whitespace, and SELINUXTYPE= cannot match because the character after
# SELINUX must be whitespace or '='.
SELINUX_CONFIG=/etc/selinux/config
cfg_mode=$(awk -F= '/^[[:space:]]*SELINUX[[:space:]]*=/ { v = $2 } END { print v }' "$SELINUX_CONFIG" 2>/dev/null | tr -d '[:space:]')
[[ $cfg_mode == enforcing ]] ||
  fail "SELINUX is '${cfg_mode:-nothing}' in $SELINUX_CONFIG, so the next boot leaves this guest permissive even if getenforce says Enforcing right now - and this task grades after a reboot. Same cause and same remedy as above: revert to the clean snapshot rather than hand-editing the file, because an edit here repairs the symptom and hides how the guest got into this state. If a freshly reverted guest still says '${cfg_mode:-nothing}', the image is wrong; rebuild it to docs/vm-build-checklist.md"

# --- tear down any previous attempt ---------------------------------------
# Stop and un-enable every *user* service that drives podman, whatever route
# created it: a quadlet-generated unit, `podman generate systemd` output, or a
# hand-written unit. Matching on ExecStart rather than on a unit name is what
# makes this route-agnostic - the same reason grade.sh's unit-boot-wanted looks
# at ExecStart instead of at a filename.
while read -r unit; do
  [[ -n $unit ]] || continue
  exec_start=$(systemctl --user show "$unit" --property=ExecStart --value 2>/dev/null)
  case $exec_start in
    *podman*) systemctl --user disable --now "$unit" &>/dev/null ;;
  esac
  # `list-units` only sees *loaded* units, so a unit file left behind by a
  # previous attempt that failed to load is handled by the file sweep below.
done < <(systemctl --user list-units --type=service --all --no-legend 2>/dev/null |
  sed 's/^[^A-Za-z0-9]*//' | awk '{print $1}')

# Quadlet reads this directory at every daemon-reload and at every boot, so the
# .container file itself is the enablement - deleting it is the only way to
# un-enable it.
rm -rf "$HOME/.config/containers/systemd"

# Hand-written and generated unit files, plus the .wants symlinks that enabled
# them. Scoped to files that mention podman so an unrelated user unit a student
# happens to have is left alone.
for f in "$HOME"/.config/systemd/user/*.service; do
  [[ -f $f ]] || continue
  if grep -q podman "$f"; then
    rm -f "$f"
    rm -f "$HOME/.config/systemd/user/default.target.wants/$(basename "$f")"
  fi
done
systemctl --user daemon-reload &>/dev/null

# Containers and volumes, in both stores. Rootless first (the store the task is
# about), then root's: a student who reached for `sudo podman run -d -p 8080` on
# a previous attempt would otherwise leave port 8080 occupied and page-served
# passing at baseline. Images are deliberately NOT removed - the pre-pull below
# is the expensive part of this file.
podman rm -af &>/dev/null
podman volume rm -af &>/dev/null
sudo podman rm -af &>/dev/null
sudo podman volume rm -af &>/dev/null

# Linger off. Both mechanisms, because both are real: loginctl keeps its state
# in /var/lib/systemd/linger/<user>, and a student may have created that file
# directly.
sudo loginctl disable-linger "$USER_NAME" &>/dev/null
sudo rm -f "/var/lib/systemd/linger/$USER_NAME"

# Any SELinux policy rule a previous attempt added for the content directory.
# `:Z` is the expected answer and leaves no policy rule, but semanage fcontext
# is an equally correct route, and a surviving rule would make selinux-label
# pass at baseline after the restorecon below.
sudo semanage fcontext -d "${CONTENT_DIR}(/.*)?" &>/dev/null
sudo semanage fcontext -d "$CONTENT_DIR" &>/dev/null
sudo semanage fcontext -d -e /var/www/html "$CONTENT_DIR" &>/dev/null

# --- create the situation the prompt describes ----------------------------
# A directory that already holds the site, owned by the unprivileged user. The
# ownership is not cosmetic: `podman run -v ...:Z` relabels the source path, and
# an unprivileged user may only relabel files it owns. Staged root-owned, this
# task would be unsolvable by the intended route.
need sudo mkdir -p "$CONTENT_DIR"
printf '<html><body><h1>%s</h1></body></html>\n' "$MARKER" |
  sudo tee "$CONTENT_DIR/index.html" >/dev/null ||
  fail "FAILED: staging $CONTENT_DIR/index.html"
need sudo chown -R "$USER_NAME:$USER_NAME" "$CONTENT_DIR"
# 0755/0644 matters. In a rootless container the host's files are seen through
# the user namespace: host UID $USER_UID maps to container root, while the httpd
# process in this image runs as container UID 1001 - which maps to a subuid, so
# it is neither the owner nor root inside the container and reads the file
# through the "other" bits. Mode 0700 here would look like an SELinux problem
# and teach the wrong lesson.
need sudo chmod 0755 "$CONTENT_DIR"
need sudo chmod 0644 "$CONTENT_DIR/index.html"
# Put the label back to whatever policy says /srv content is (var_t on a stock
# guest). Leaving it wrong is the point: fixing it is part of the task.
need sudo restorecon -R "$CONTENT_DIR"

# --- pre-pull the image ---------------------------------------------------
# The student's time budget must not be spent on a ~250 MB registry pull, and
# the harness reverts to a snapshot before every fixture, so this runs again on
# every reset. `podman image exists` keeps a second run of setup on the same
# machine cheap. Pulled rootless, as the user, on purpose: an image in root's
# store is invisible to `podman run` as student.
if ! podman image exists "$IMAGE"; then
  for attempt in 1 2 3; do
    podman pull -q "$IMAGE" &>/dev/null && break
    sleep 5
  done
  podman image exists "$IMAGE" ||
    fail "could not pull $IMAGE after 3 attempts; the guest needs egress to registry.access.redhat.com"
fi

# --- prove rootless podman actually works --------------------------------
# Three separate things can be broken here, and every one of them fails every
# checkpoint in a way that looks like the student's fault.
#
# 1. No subuid/subgid range for this user. Then rootless podman cannot build a
#    user namespace at all and every `podman run` dies.
grep -q "^${USER_NAME}:" /etc/subuid ||
  fail "no subuid range for $USER_NAME in /etc/subuid, so rootless podman cannot map a user namespace"
grep -q "^${USER_NAME}:" /etc/subgid ||
  fail "no subgid range for $USER_NAME in /etc/subgid, so rootless podman cannot map a user namespace"

# 2. Storage resolving somewhere other than this user's home, which would mean
#    the grader's rootless-owner probe is reading a store the student is not
#    writing to.
graphroot=$(podman info --format '{{.Store.GraphRoot}}' 2>/dev/null)
case $graphroot in
  "$HOME"/*) ;;
  *) fail "rootless podman reports GraphRoot='${graphroot:-nothing}', which is not under $HOME; rootless-owner cannot mean anything" ;;
esac

# 3. Everything above fine and containers still not runnable (a broken
#    /etc/containers/storage.conf, missing newuidmap, an unwritable runroot).
#    This is the end-to-end assertion, and it is cheap now that the image is
#    local. --rm leaves nothing behind, which the container count below proves.
podman run --rm "$IMAGE" /bin/true &>/dev/null ||
  fail "rootless 'podman run' failed for $USER_NAME even though the image is present; the task is unsolvable on this guest"

# --- preconditions for every checkpoint ----------------------------------
# One check per goal checkpoint in grade.sh, using the grader's own probe
# wherever possible. A precondition that only guarded this script would leave
# the checkpoints free to pass at baseline for reasons that have nothing to do
# with the student - a student-facing false pass, which is the one failure
# direction this project treats as unacceptable.

# page-served: nothing may already answer on the host port, in either store or
# from any non-container service.
if ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -qE "(^|:)${PORT}\$"; then
  fail "something is already listening on TCP $PORT; page-served would not measure the student's work"
fi
if curl -s --max-time 5 "http://localhost:${PORT}/" 2>/dev/null | grep -q "$MARKER"; then
  fail "http://localhost:${PORT}/ already returns $MARKER; page-served would pass at baseline"
fi

# rootless-owner and content-mounted: this user's container store must be empty.
# Checked after the `podman run --rm` probe above, which is also how we know
# --rm cleaned up after itself.
leftover=$(podman ps -aq 2>/dev/null | tr '\n' ' ')
[[ -z ${leftover// /} ]] ||
  fail "rootless podman still has containers ($leftover) after 'podman rm -af'; rootless-owner would pass at baseline"

# page-served, again: the marker has to be in the file, or a correct answer
# cannot pass. grade.sh treats a missing marker as "nothing below can be
# interpreted" and fails closed, so this would red every fixture.
grep -q "$MARKER" "$CONTENT_DIR/index.html" ||
  fail "$CONTENT_DIR/index.html does not contain the marker the grader looks for"

# selinux-label: neither the directory nor the file may already carry a
# container type. Exactly the grader's probe, so a baseline pass is impossible
# by construction rather than by hope.
for path in "$CONTENT_DIR" "$CONTENT_DIR/index.html"; do
  ctx=$(stat -c %C "$path" 2>/dev/null)
  case $ctx in
    *container_file_t* | *container_ro_file_t* | *container_share_t*)
      fail "$path is already labelled '$ctx' after restorecon; selinux-label would pass at baseline" ;;
  esac
done

# unit-boot-wanted: the user manager must be reachable (or the checkpoint
# measures nothing), and default.target must not already want a podman unit.
wants=$(systemctl --user show default.target --property=Wants --value 2>/dev/null) ||
  fail "cannot read default.target from the user manager; unit-boot-wanted cannot be evaluated"
for unit in $wants; do
  exec_start=$(systemctl --user show "$unit" --property=ExecStart --value 2>/dev/null)
  case $exec_start in
    *podman*) fail "user unit $unit still drives podman and is wanted by default.target; unit-boot-wanted would pass at baseline" ;;
  esac
done

# linger-enabled: both mechanisms must read as off.
linger=$(loginctl show-user "$USER_NAME" --property=Linger --value 2>/dev/null)
[[ $linger != yes ]] ||
  fail "lingering is still enabled for $USER_NAME; linger-enabled would pass at baseline"
[[ ! -e "/var/lib/systemd/linger/$USER_NAME" ]] ||
  fail "/var/lib/systemd/linger/$USER_NAME still exists; linger-enabled would pass at baseline"

# selinux-enforcing is an invariant, and both halves of it - the runtime mode and
# /etc/selinux/config - are checked at the TOP of this file rather than here, ahead
# of the teardown and the image pull. See the SELinux state policy there for why
# they are checked and never repaired. Nothing between there and here changes
# either half, so there is no gap.

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
: > "$HOME/.bash_history" 2>/dev/null || true

exit 0
