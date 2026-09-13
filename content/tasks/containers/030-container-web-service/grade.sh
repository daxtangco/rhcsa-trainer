#!/usr/bin/env bash
# Grader for containers/030-container-web-service.
#
# READ-ONLY. Changes nothing. Exit code is ignored; only the JSONL emitted by
# ck_pass / ck_fail / ck_skip is read. assert.sh is prepended by
# loadTaskScripts, so its helpers are already in scope.
#
# Seven checkpoints, because "the site is up" and "the machine will bring the
# site back" are different facts and this task fails silently in the gap between
# them. Six are goals; selinux-enforcing is an invariant.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: page-served, rootless-owner, content-mounted, selinux-label, unit-boot-wanted, linger-enabled
set -uo pipefail

# Repeated from setup.sh rather than sourced from a file setup wrote: the two
# scripts reach the guest separately, and a grader that read its own target out
# of a file on the guest could be told what to look for by the student.
CONTENT_DIR=/srv/webcontent
MARKER=RHCSA-MARKER-3007
PORT=8080

# Derived, never hardcoded: this task is about *this* user's rootless
# containers, user manager and linger flag, and the fixtures, the lab session
# and `rhcsa validate` all run as the same unprivileged account.
USER_NAME=$(id -un 2>/dev/null)
USER_UID=$(id -u 2>/dev/null)

# `ssh host bash -s` is a non-login shell. pam_systemd normally exports
# XDG_RUNTIME_DIR into an ssh session, but every `systemctl --user` call below
# depends on it, and with it unset they would fail with "Failed to connect to
# bus" - which would fail unit-boot-wanted for a student whose unit is perfect.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${USER_UID}}"

# --- fail closed -----------------------------------------------------------
# Three inputs are load-bearing, and if any of them is missing this grader
# cannot distinguish a solved task from an unsolved one. Reporting whatever the
# probes happen to say would be worse than saying nothing: an empty USER_UID
# makes XDG_RUNTIME_DIR point at /run/user/, and an empty MARKER would turn
# page-served's `grep -q` into a pattern that matches every possible response -
# a checkpoint that passes on any web page at all, or on none.
#
# The marker check is the interesting one. If $CONTENT_DIR/index.html no longer
# carries the marker, then a curl that DOES return the marker is being served
# from something other than the host directory - content copied into an image or
# into a named volume. That is precisely the answer this task rejects, so it
# must never be reported as a pass. There is no safe way to continue.
guard=
if [[ -z $USER_NAME || -z $USER_UID ]]; then
  guard='could not determine the invoking user: id -un / id -u produced nothing'
elif ! command -v podman >/dev/null 2>&1; then
  guard='podman is not installed, so no container fact can be read'
elif ! grep -q "$MARKER" "$CONTENT_DIR/index.html" 2>/dev/null; then
  guard="$CONTENT_DIR/index.html no longer contains $MARKER, so a page carrying it would prove content was copied somewhere else rather than served from the host directory"
fi
if [[ -n $guard ]]; then
  ck_fail page-served "http://localhost:$PORT/ returns the file from $CONTENT_DIR" "$guard"
  ck_fail rootless-owner "the service container belongs to this user's rootless podman, not root's" "$guard"
  ck_fail content-mounted "the container bind-mounts $CONTENT_DIR, so edits on the host are what is served" "$guard"
  ck_fail selinux-label "$CONTENT_DIR carries an SELinux type a confined container may read" "$guard"
  ck_fail unit-boot-wanted "a user systemd unit that runs podman is pulled in by default.target" "$guard"
  ck_fail linger-enabled "lingering is enabled, so this user's units start without a login" "$guard"
  ck_fail selinux-enforcing "SELinux is still enforcing" "$guard"
  exit 0
fi

# --- wait for the moving parts to settle ----------------------------------
# Both waits exist because of verdict B, and neither weakens a verdict.
#
# `reboot()` resolves as soon as ssh answers. At that moment systemd is still
# starting user@$USER_UID, which is what starts the container - so a grader that
# probed immediately would report "the site did not come back" for a completely
# correct answer, i.e. a false FAIL on the one checkpoint the reboot exists to
# measure. Polling cannot create a pass that a longer wait would not also
# produce; it only stops the grader from racing the boot.
#
# The ceilings are bounded by the transport: SshTransport kills the whole script
# at 120s (src/engine/vm/ssh.ts), and a timed-out grader emits nothing at all,
# which reads as every checkpoint vanishing. 10s + 48s worst case, plus the
# probes, stays well inside that.
for _ in 1 2 3 4 5; do
  systemctl --user show default.target --property=Wants --value &>/dev/null && break
  sleep 2
done

page=
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  page=$(curl -s --max-time 2 "http://localhost:${PORT}/" 2>/dev/null)
  case $page in
    *"$MARKER"*) break ;;
  esac
  sleep 2
done

# --- 1. the site is actually being served ---------------------------------
# The end-to-end fact, and the only checkpoint that depends on the container
# running right now. It also silently covers three things no separate
# checkpoint asserts: the port is published to the host, the image's httpd can
# read the mounted files, and the document root the student chose is the one the
# image serves from.
#
# curl runs inside the guest against localhost, which firewalld does not filter,
# so this says nothing about the firewall - and nothing in the prompt asks for
# outside reachability, which is why there is no firewall checkpoint.
case $page in
  *"$MARKER"*)
    ck_pass page-served "http://localhost:$PORT/ returns the file from $CONTENT_DIR" ;;
  *)
    ck_fail page-served "http://localhost:$PORT/ returns the file from $CONTENT_DIR" \
      "got=${page:0:80}" ;;
esac

# --- 2 and 3. whose containers, and what is mounted into them --------------
# Read through this user's own podman, with no sudo, which is exactly what makes
# it a statement about the ROOTLESS store: `podman` as student can only see
# containers in ~/.local/share/containers. A student who solved this with
# `sudo podman run` leaves that store empty and fails rootless-owner while
# page-served still passes - which is the whole point of having both.
#
# Config-level, not state-level, on purpose. `podman inspect` reports the mount
# list of a stopped container just as well as a running one, so these two
# checkpoints do not flicker with whether the container happens to be up at this
# instant - and an anti-solution that leaves a stopped container behind still
# gets an accurate verdict on the two facts it did get right.
#
# Accepted loophole, stated rather than hidden: a student who runs the service
# rootless AND leaves a second copy running under `sudo podman` passes both.
# Proving root's store is empty would mean running `sudo podman ps`, and podman
# initialises root's storage on first invocation - a grader that writes to
# /var/lib/containers is no longer read-only (mandate 3). page-served is served
# by loopback either way, so the two answers are indistinguishable from here;
# setup.sh removes root's containers so the situation cannot arise by accident.
containers=0
mount_owner=
for cid in $(podman ps -aq 2>/dev/null); do
  containers=$((containers + 1))
  # Trailing space in the template is load-bearing: it makes the pattern below
  # an exact match on the mount source, so a container that mounts
  # /srv/webcontent-copy does not read as a container that mounts
  # /srv/webcontent. Type is included so a named volume - whose Source is a path
  # under ~/.local/share/containers/storage/volumes - can never match.
  info=$(podman inspect --format '{{range .Mounts}}{{.Type}}:{{.Source}} {{end}}' "$cid" 2>/dev/null)
  case $info in
    *"bind:${CONTENT_DIR} "*) mount_owner=$cid ;;
  esac
done

if [[ $containers -ge 1 ]]; then
  ck_pass rootless-owner "the service container belongs to this user's rootless podman, not root's"
else
  ck_fail rootless-owner "the service container belongs to this user's rootless podman, not root's" \
    "'podman ps -a' as $USER_NAME lists no containers at all, so nothing here runs in this user's rootless store"
fi

# A bind mount of the directory itself. Deliberately not satisfied by a bind
# mount of $CONTENT_DIR/index.html alone: the ticket says the team keeps editing
# files in that directory, so a new file has to appear on the site too.
if [[ -n $mount_owner ]]; then
  ck_pass content-mounted "the container bind-mounts $CONTENT_DIR, so edits on the host are what is served"
else
  ck_fail content-mounted "the container bind-mounts $CONTENT_DIR, so edits on the host are what is served" \
    "none of this user's $containers container(s) has a bind mount whose source is $CONTENT_DIR; a named volume or a copy of the files is not the host directory"
fi

# --- 4. the content is labelled for a confined container ------------------
# Mechanism-agnostic by construction: it reads the label that is on the inodes
# now, which is what the container's own SELinux check reads. `:Z` (podman
# relabels the source at every start), `:z`, `chcon`, and `semanage fcontext` +
# `restorecon` all land here, and none is preferred.
#
# Both paths are checked because a confined container needs search on the
# directory as well as read on the file, and a student who labelled only the
# file would otherwise get a pass for something that cannot work.
#
# This is also the checkpoint that refuses the standard cheat. Running the
# container with `--security-opt label=disable` makes the site work with the
# labels left alone, which is why the prompt forbids it and why this checkpoint
# measures the label rather than the outcome - page-served alone cannot tell the
# two apart.
label_bad=
for path in "$CONTENT_DIR" "$CONTENT_DIR/index.html"; do
  ctx=$(stat -c %C "$path" 2>/dev/null)
  case $ctx in
    *container_file_t* | *container_ro_file_t* | *container_share_t*) ;;
    *) label_bad="${label_bad}${path}=${ctx:-unreadable} " ;;
  esac
done
if [[ -z $label_bad ]]; then
  ck_pass selinux-label "$CONTENT_DIR carries an SELinux type a confined container may read"
else
  ck_fail selinux-label "$CONTENT_DIR carries an SELinux type a confined container may read" \
    "still labelled: ${label_bad% }"
fi

# --- 5. something will start it at boot ----------------------------------
# The mechanism-agnostic half of the persistence question. Two independent
# routes are accepted, because the two supported ways of doing this leave
# different traces and neither is more correct:
#
#   a. default.target's Wants, as the running user manager computes it. This is
#      how a quadlet .container file shows up: quadlet is a generator, so there
#      is no "enabled" symlink in $HOME to find - `systemctl --user is-enabled`
#      reports `generated` for those units, never `enabled`.
#   b. the default.target.wants symlink farms on disk. Immune to a stale
#      dependency graph (a student who wrote a unit file and enabled it but has
#      not reloaded yet), and it names the target explicitly - a unit enabled
#      into some other target would be `is-enabled: enabled` and would still
#      never start, so is-enabled on its own is not usable here.
#
# What is deliberately NOT checked: whether the unit is active. That is
# page-served's job, and a unit that is enabled but stopped is a different
# mistake from a unit that does not exist.
is_podman_unit() {
  local unit=$1 out
  # ExecStart is the one field every route fills with /usr/bin/podman: quadlet's
  # generated unit, `podman generate systemd` output, and a hand-written unit
  # all run the podman binary. Matching on it rather than on a file name is what
  # keeps this from being fitted to one author's naming habits.
  out=$(systemctl --user show "$unit" --property=ExecStart --value 2>/dev/null)
  case $out in
    *podman*) return 0 ;;
  esac
  # Fallback for a quadlet unit whose generated service could not be loaded (a
  # typo in the .container file): the file itself still proves the route was
  # taken, and reporting "no unit at all" there would be wrong.
  [[ -f "$HOME/.config/containers/systemd/${unit%.service}.container" ]]
}

boot_unit=
for unit in $(systemctl --user show default.target --property=Wants --value 2>/dev/null); do
  case $unit in
    *.service) is_podman_unit "$unit" && boot_unit=$unit && break ;;
  esac
done
if [[ -z $boot_unit ]]; then
  for link in "$HOME"/.config/systemd/user/default.target.wants/*.service \
    /etc/systemd/user/default.target.wants/*.service \
    "$XDG_RUNTIME_DIR"/systemd/generator*/default.target.wants/*.service; do
    # An unmatched glob arrives as the literal pattern, so existence is checked
    # rather than assumed. -e, not -f: these are symlinks.
    [[ -e $link ]] || continue
    unit=${link##*/}
    is_podman_unit "$unit" && boot_unit=$unit && break
  done
fi

if [[ -n $boot_unit ]]; then
  ck_pass unit-boot-wanted "a user systemd unit that runs podman is pulled in by default.target"
else
  ck_fail unit-boot-wanted "a user systemd unit that runs podman is pulled in by default.target" \
    "nothing in default.target's Wants and nothing in any default.target.wants directory for $USER_NAME runs podman; a container started by hand is not a service"
fi

# --- 6. and the user manager will be there to do it ----------------------
# The checkpoint the whole reboot_check exists for, and the one students lose
# marks on. Without lingering, user@$USER_UID only exists while a session does:
# the unit is enabled, the container runs, everything looks right, and at logout
# the manager and the container go away. Nothing in verdict A can distinguish
# that from a correct answer.
#
# Note what verdict B does NOT prove on its own. The grader reaches the guest by
# ssh, and that login itself starts the user manager, which then starts the
# enabled unit - so a student who forgot lingering can still have a serving site
# by the time the post-reboot probes run. That is why lingering is measured
# directly instead of being inferred from page-served@post.
#
# Mechanism-agnostic: `loginctl enable-linger` and creating
# /var/lib/systemd/linger/<user> by hand are the same fact, and logind reports
# the second one as Linger=yes. The file is checked as a fallback for the case
# where logind cannot answer at all.
linger=$(loginctl show-user "$USER_NAME" --property=Linger --value 2>/dev/null)
if [[ $linger == yes ]] || [[ -e "/var/lib/systemd/linger/$USER_NAME" ]]; then
  ck_pass linger-enabled "lingering is enabled, so this user's units start without a login"
else
  ck_fail linger-enabled "lingering is enabled, so this user's units start without a login" \
    "loginctl reports Linger=${linger:-unknown} for $USER_NAME and /var/lib/systemd/linger/$USER_NAME does not exist, so this user's manager stops at logout"
fi

# --- 7. invariant: SELinux is still enforcing ----------------------------
# An answer that turns SELinux off is not an answer, and the prompt says so.
#
# Knowingly unprobed: the only way to fail this is permissive or disabled mode,
# which the project forbids outright, and coming back from disabled needs a full
# relabel and a reboot the harness does not control. selinux/019 declares this
# same invariant for the same reason. What makes it worth emitting anyway is
# selinux-label: the two together are what force the student to fix the label
# instead of getting out of SELinux's way.
# unprobed-invariant: selinux-enforcing
enforce=$(getenforce 2>/dev/null)
[[ $enforce == Enforcing ]]
ck selinux-enforcing "SELinux is still enforcing" $? "getenforce=${enforce:-nothing}"

exit 0
