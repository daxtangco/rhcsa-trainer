#!/usr/bin/env bash
# Prepare the system for storage/043-nfs-and-autofs.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell.
#
# ---------------------------------------------------------------------------
# WHY THIS HOST EXPORTS TO ITSELF, and what that costs.
#
# The lab is one VM (docs/vm-build-checklist.md), and both objectives this task
# covers - "Mount and unmount network file systems using NFS" and "Configure
# autofs" - are CLIENT-side objectives. So the guest is made to stand in for the
# remote server: this script installs nfs-utils, exports two directories, starts
# nfs-server, and then proves the export is really mountable *by mounting it*
# before it hands over. Everything the student does afterwards is exactly what
# they would do against a real server. The prompt says so in its first sentence,
# because a student who works out for themselves that the server is localhost has
# been handed a puzzle nobody set them.
#
# The server is reached through a name, nfsstore.lab.example.com, added to
# /etc/hosts by this script and pointed at 127.0.0.1. Three reasons, in order of
# weight:
#
#   1. It keeps the lab's IP address (192.168.70.130) out of the content. A task
#      that hardcodes it breaks on the next guest that gets a different lease.
#   2. Loopback is the one path that cannot be broken by a firewall zone, a
#      dropped default route (docs/offline-mode.md drops it in drill and exam
#      modes) or a renumbered NIC. Traffic to the guest's own primary address
#      would also go over `lo`, so that would probably be fine too - but
#      "probably" is not a thing to build a grader on, and 127.0.0.1 needs no
#      argument at all.
#   3. The name is what the prompt names, so the prompt, the solutions and the
#      grader all say the same thing.
#
# The grader deliberately does NOT require the student to have typed that name:
# see the note above reports-mounted in grade.sh. An answer that mounted
# 127.0.0.1:/export/reports is the same end state and is graded as correct.
#
# IDEMPOTENT. The harness reverts the `clean` snapshot before every fixture, but a
# human studying in the Lab screen re-runs setup by hand on a machine they have
# already been poking at. Every mutation here is either "write this exact file" or
# "remove any line matching this task's paths", so a re-run after a solved attempt
# returns the guest to the baseline - and the verification block at the bottom
# proves it did rather than assuming it.
#
# `set -uo pipefail` without -e, following content/tasks/sys/040-time-and-tuning:
# this file is full of unmounts and disables that legitimately fail on a first run
# (there is nothing mounted, autofs was never enabled). The commands that MUST
# work go through `need`, because a silent failure here stages the wrong machine
# and every checkpoint result afterwards is a lie.
# ---------------------------------------------------------------------------
set -uo pipefail

fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }
need() { "$@" || fail "FAILED: $*"; }

# Spelled identically in grade.sh. If these ever disagree the task becomes
# unsatisfiable for every answer.
SERVER=nfsstore.lab.example.com
SERVER_SHORT=nfsstore
SERVER_ADDR=127.0.0.1
EXPORT_REPORTS=/export/reports
EXPORT_ARCHIVE=/export/archive
REPORTS_FILE=quarterly-summary.txt
ARCHIVE_FILE=archive-index.txt
REPORTS_MARKER=RHCSA043-REPORTS-7d2a
ARCHIVE_MARKER=RHCSA043-ARCHIVE-7d2a
CLIENT_REPORTS=/mnt/reports
CLIENT_OLD=/mnt/oldshare
AUTOFS_BASE=/nfsdata
AUTOFS_PATH=/nfsdata/archive

# The export lives in a drop-in rather than in /etc/exports. exportfs(8) reads
# /etc/exports and every /etc/exports.d/*.exports file, so this is a supported
# location, and writing a whole file rather than appending to a shared one is what
# makes this script idempotent without needing a saved baseline copy the way
# sys/040 needs one for chrony.conf.
EXPORTS_FILE=/etc/exports.d/rhcsa043.exports
AUTO_MASTER=/etc/auto.master
AUTO_MASTER_D=/etc/auto.master.d
STAMP_DIR=/var/lib/rhcsa-lab
PROBE=$STAMP_DIR/043-probe

# Exact mount-point rows, and never `findmnt --target`: --target walks UP to the
# nearest ancestor mount, so it answers "/" for a path nobody mounted and every
# test written on it reads as a pass. grade.sh uses the identical probe.
mp_rows() { findmnt -rno FSTYPE,SOURCE --mountpoint "$1" 2>/dev/null; }

# --- packages -------------------------------------------------------------
# A Minimal Install has neither of these. Installed from the ISO-backed repo
# scripts/guest-provision.sh writes, because the alternative is a grader that
# fails every checkpoint on a guest that is merely missing a package - a failure
# pointing at the student instead of at the image. `< /dev/null` because dnf reads
# stdin and this script's stdin is the rest of the script.
#
# autofs is installed here rather than left to the student on purpose: the
# objective is "configure autofs", not "install autofs", and the DVD repo means a
# student who removes it can put it back.
for pkg in nfs-utils autofs; do
  if ! rpm -q "$pkg" &>/dev/null; then
    sudo dnf -y install "$pkg" &>/dev/null < /dev/null
    rpm -q "$pkg" &>/dev/null \
      || fail "$pkg is not installed and 'dnf -y install $pkg' did not fix that; check that /etc/yum.repos.d/rhcsa-dvd.repo points at a mounted DVD (docs/vm-build-checklist.md section 3.3)"
  fi
done

# --- preconditions --------------------------------------------------------
# Convention for every task in this bank: verify every precondition the goal
# checkpoints depend on, not only the ones this script needs to run. A
# precondition that only guards the script leaves the checkpoints free to pass or
# fail for reasons that have nothing to do with the student.
#
# The sbin tools are looked for under sudo, because this script runs in a
# non-login shell whose PATH need not carry /usr/sbin (the same reason
# sys/040-time-and-tuning's setup asks for tuned-adm that way).
systemctl cat nfs-server.service &>/dev/null \
  || fail "nfs-server.service does not exist even though nfs-utils is installed; this guest's nfs-utils install is broken"
systemctl cat autofs.service &>/dev/null \
  || fail "autofs.service does not exist even though the autofs package is installed; this guest's autofs install is broken"
sudo sh -c 'command -v exportfs' >/dev/null \
  || fail "exportfs is missing, so the export could neither be published nor verified"
sudo sh -c 'command -v mount.nfs' >/dev/null \
  || fail "mount.nfs is missing, so no NFS mount could be made on this guest and every checkpoint would fail for a reason the student cannot fix"
sudo sh -c 'command -v automount' >/dev/null \
  || fail "the automount daemon is missing even though the autofs package is installed; this guest's autofs install is broken"
command -v findmnt >/dev/null \
  || fail "findmnt is missing, and every mount checkpoint in grade.sh is measured with it"
command -v timeout >/dev/null \
  || fail "timeout is missing; this script and grade.sh both use it to keep a hung NFS mount from wedging the run"

sudo test -f "$AUTO_MASTER" \
  || fail "$AUTO_MASTER does not exist even though the autofs package is installed; the master map is where both solutions start, so this guest's autofs install is broken"

# solutions/02 puts its master-map entry in $AUTO_MASTER_D, which automount reads
# only because the stock $AUTO_MASTER carries a `+dir:` line naming it (that line
# sits in the middle of the shipped file, above the `+auto.master` line it really
# does end with, and only its presence matters). Checked
# rather than assumed: without that line a file dropped there is a file nothing
# reads, solutions/02 would fail three checkpoints, and the failure would look
# like a grader defect. grep on a FILE, so there is no producer for -q to kill
# (the SIGPIPE trap content/lib/assert.sh documents).
sudo grep -qsE "^[[:space:]]*\+dir:[[:space:]]*$AUTO_MASTER_D" "$AUTO_MASTER" \
  || fail "$AUTO_MASTER has no '+dir:$AUTO_MASTER_D' line, so a map dropped into that directory would never be read and solutions/02 could not work on this guest; RHEL 9's stock autofs ships that line (and man 5 auto.master documents the .autofs suffix files in that directory must carry), so this guest's $AUTO_MASTER has been edited"
need sudo mkdir -p "$AUTO_MASTER_D"

# --- undo what a previous attempt can leave behind ------------------------
# Client side first, and in this order: nothing under /export may be rebuilt while
# a client mount of it is still live.

# Stopping autofs is what releases /nfsdata and anything under it.
sudo systemctl disable --now autofs &>/dev/null

# Any mount at the three paths this task uses. Lazy as a second attempt, because
# a student's shell sitting in the directory is the usual reason a umount fails
# and is not a reason to abandon the reset.
for m in "$AUTOFS_PATH" "$AUTOFS_BASE" "$CLIENT_REPORTS" "$CLIENT_OLD" "$PROBE"; do
  if [[ -n $(mp_rows "$m") ]]; then
    sudo umount "$m" &>/dev/null || sudo umount -l "$m" &>/dev/null
  fi
done

# A .mount unit from a previous solutions/02 run. reports-persistent accepts a
# unit as readily as an fstab line (that is content/lib/assert.sh's is_persistent,
# and spec 6.5 rule 1), so a leftover unit would make it pass at baseline.
while read -r unit; do
  [[ -n $unit ]] || continue
  # `< /dev/null` on everything inside the loop, so nothing can consume the
  # process substitution the loop itself is reading from.
  sudo systemctl disable --now "$(basename "$unit")" &>/dev/null < /dev/null
  sudo rm -f "$unit" < /dev/null
done < <(
  sudo grep -rlsE "^[[:space:]]*Where[[:space:]]*=[[:space:]]*$CLIENT_REPORTS[[:space:]]*$" \
    /etc/systemd/system --include='*.mount' 2>/dev/null
)
sudo systemctl daemon-reload &>/dev/null

# The maps a previous attempt or a shipped solution wrote. Matched by the paths
# and the map file names this task owns, so a map the guest had for its own
# reasons is left alone.
#
# Three patterns, not one. A drop-in for an INDIRECT map names $AUTOFS_BASE in its
# first field, but solutions/02's drop-in is a DIRECT map: its whole content is
# `/- /etc/auto.direct`, which contains neither /nfsdata nor anything else this
# task can recognise except the map file name. Matching on $AUTOFS_BASE alone left
# that file behind pointing at a map this block had just deleted, which is a
# master map entry nothing can satisfy and an autofs startup complaint on the next
# `systemctl start autofs` a student types.
sudo rm -f /etc/auto.nfsdata /etc/auto.direct
while read -r f; do
  [[ -n $f ]] || continue
  if sudo grep -qsF -e "$AUTOFS_BASE" -e /etc/auto.nfsdata -e /etc/auto.direct "$f" < /dev/null; then
    sudo rm -f "$f" < /dev/null
  fi
done < <(sudo find "$AUTO_MASTER_D" -maxdepth 1 -type f -name '*.autofs' 2>/dev/null)

# ...and any master-map line naming them. awk prints $0 unmodified, so every other
# line of the file - including the `+dir:` and `+auto.master` lines the package
# ships - survives byte for byte.
master_tmp=$(mktemp) || fail "could not create a temporary file"
sudo awk -v base="$AUTOFS_BASE" '
    $1 == base { next }
    index($0, "/etc/auto.nfsdata") { next }
    index($0, "/etc/auto.direct")  { next }
    { print }' "$AUTO_MASTER" > "$master_tmp" \
  || fail "could not filter $AUTO_MASTER"
grep -qsE "^[[:space:]]*\+dir:[[:space:]]*$AUTO_MASTER_D" "$master_tmp" \
  || fail "filtering $AUTO_MASTER would have removed its '+dir:' line; refusing to install the result"
need sudo cp "$master_tmp" "$AUTO_MASTER"
sudo restorecon "$AUTO_MASTER" &>/dev/null
rm -f "$master_tmp"

# --- the server this host is standing in for ------------------------------
# The name. Its own line rather than an edit to the stock `127.0.0.1 localhost`
# line: nothing in this task is worth risking localhost resolution for, and
# appending keeps `localhost` the canonical reverse name for 127.0.0.1 because it
# is still the first match in the file.
hosts_tmp=$(mktemp) || fail "could not create a temporary file"
sudo awk -v n="$SERVER" -v s="$SERVER_SHORT" '
    { for (i = 2; i <= NF; i++) if ($i == n || $i == s) next; print }' /etc/hosts > "$hosts_tmp" \
  || fail "could not filter /etc/hosts"
printf '%s\t%s %s\n' "$SERVER_ADDR" "$SERVER" "$SERVER_SHORT" >> "$hosts_tmp"
[[ -n $(awk '$2 == "localhost" || $2 == "localhost.localdomain"' "$hosts_tmp") ]] \
  || fail "the filtered /etc/hosts has no localhost line left; refusing to install it"
need sudo cp "$hosts_tmp" /etc/hosts
sudo restorecon /etc/hosts &>/dev/null
rm -f "$hosts_tmp"
[[ -n $(getent hosts "$SERVER") ]] \
  || fail "'$SERVER' does not resolve after the /etc/hosts edit, so nothing in this task could be mounted by name"

# SELinux is Enforcing on this guest, and the server side is the half that needs
# policy's permission: nfsd reads the exported files itself. The two booleans that
# govern exporting a directory whose label is not one of the public_content types
# are nfs_export_all_ro and nfs_export_all_rw. They are believed to default to ON
# in RHEL's shipped policy, but that is exactly the kind of belief this file is not
# allowed to rest on, so each one is READ and only turned on if it is off - which
# is also why this is not a plain `setsebool -P` (that rebuilds policy and costs
# tens of seconds on every fixture for nothing). A boolean the policy does not have
# at all is skipped rather than fatal: policy that lacks it cannot be denying on
# account of it.
#
# The CLIENT side needs nothing. Files reached over NFS are labelled nfs_t, and the
# student's own shell and this grader run unconfined, so no boolean is involved in
# reading them. use_nfs_home_dirs would matter if the mount were somebody's home
# directory served to a confined service; neither is true here.
if sudo sh -c 'command -v getsebool' >/dev/null 2>&1; then
  for b in nfs_export_all_ro nfs_export_all_rw; do
    cur=$(sudo getsebool "$b" 2>/dev/null | awk '{ print $NF }')
    if [[ $cur == off ]]; then
      need sudo setsebool -P "$b" on
    fi
  done
fi

# The exported directories and one recognisable file in each. The markers are what
# let grade.sh tell "an NFS mount of the right export" from "a directory that
# happens to be at the right path"; they are spelled identically there.
need sudo mkdir -p "$EXPORT_REPORTS" "$EXPORT_ARCHIVE"
need sudo chmod 0755 /export "$EXPORT_REPORTS" "$EXPORT_ARCHIVE"

# /export must be an ordinary directory on whatever filesystem carries it, not a
# mount point of its own. This is not fussiness: the automounter bind-mounts an
# export whose server is this machine (grade.sh's served_path_at explains why and
# cites the man page), findmnt renders a bind mount's SOURCE as
# `DEVICE[/path/within/the/filesystem]`, and grade.sh compares those brackets
# against $EXPORT_ARCHIVE. If /export were its own mount point the brackets would
# hold /archive instead and archive-automounted would fail every correct answer.
# Asserted here so a differently partitioned guest says so once, loudly, instead
# of producing a grader defect that looks like a content bug.
for p in /export "$EXPORT_REPORTS" "$EXPORT_ARCHIVE"; do
  [[ -z $(mp_rows "$p") ]] \
    || fail "$p is a mount point in its own right ($(mp_rows "$p" | tr '\n' ' ')); this task needs /export and everything under it to be plain directories on one filesystem, because grade.sh identifies the automounted directory by the path the bind mount reports inside it"
done
printf '%s\nQ3 revenue by region, generated nightly.\n' "$REPORTS_MARKER" \
  | sudo tee "$EXPORT_REPORTS/$REPORTS_FILE" >/dev/null
printf '%s\n2019-2024 captures, read rarely.\n' "$ARCHIVE_MARKER" \
  | sudo tee "$EXPORT_ARCHIVE/$ARCHIVE_FILE" >/dev/null
need sudo chmod 0644 "$EXPORT_REPORTS/$REPORTS_FILE" "$EXPORT_ARCHIVE/$ARCHIVE_FILE"
# /export is a fresh top-level directory, so it and everything under it get
# default_t from policy. restorecon is belt and braces against a guest where
# somebody relabelled it by hand.
sudo restorecon -R /export &>/dev/null

# The export table. Exported to `*` rather than to 127.0.0.1 alone: a student who
# tries the guest's own IP address instead of the name is doing something
# reasonable, and a host-match denial from the server would send them hunting
# through their own client configuration for an hour. no_subtree_check is the
# modern default and is written out so exportfs has nothing to warn about.
need sudo mkdir -p /etc/exports.d
printf '%s *(rw,sync,no_subtree_check)\n%s *(rw,sync,no_subtree_check)\n' \
  "$EXPORT_REPORTS" "$EXPORT_ARCHIVE" | sudo tee "$EXPORTS_FILE" >/dev/null \
  || fail "could not write $EXPORTS_FILE"
need sudo chmod 0644 "$EXPORTS_FILE"
sudo restorecon "$EXPORTS_FILE" &>/dev/null

# --- make the local server start before remote mounts are attempted -------
# LAB INFRASTRUCTURE, and not part of anybody's answer. This is the block that
# has to earn that description, so it is spelled out at length.
#
# THE RACE. reboot_check is true, so verdict B is collected after a real reboot,
# and the answer to the first requirement is a mount that comes back on its own:
# an /etc/fstab line (solutions/01) or a .mount unit (solutions/02). Either way
# systemd ends up with a mount unit of Type=nfs, and "Default Dependencies" in
# man 5 systemd.mount says a NETWORK mount unit gains `After=remote-fs-pre.target
# network.target network-online.target` and `Before=remote-fs.target`. The fstype
# alone is what puts it in that class - the same page's `_netdev` entry says the
# option exists only to force the classification where the type does not imply
# it - so neither solution needs `_netdev` and neither has it, and both land in
# the same case.
#
# The shipped /usr/lib/systemd/system/nfs-server.service, though, declares
# `DefaultDependencies=no`, an `After=` list of network-online.target,
# local-fs.target, proc-fs-nfsd.mount, rpcbind.socket and nfs-mountd.service, and
# `Before=rpc-statd-notify.service` - and nothing whatsoever about
# remote-fs-pre.target or remote-fs.target. On a real machine that is right: the
# NFS server is a different host, so there is nothing to order against. On THIS
# guest the server and the client are the same machine: nfs-server is pulled into
# the boot by multi-user.target, the mount unit by remote-fs.target, and there is
# no ordering edge of any kind between the two - so at boot the mount can be
# attempted before rpc.nfsd is listening.
#
# HOW BAD, honestly: usually invisible, occasionally fatal. mount.nfs retries -
# `retry=` defaults to 2 minutes for a foreground mount (man 5 nfs), and
# nfs-utils' own nfs_is_permanent_error() treats ECONNREFUSED, which is what a
# connect to port 2049 with no nfsd behind it gives, as temporary, so the mount is
# retried after 1, 2, 4, 8, 10, 10... seconds. The binding ceiling is systemd's,
# not mount.nfs's: a mount unit's TimeoutSec defaults to DefaultTimeoutStartSec,
# which is 90s (man 5 systemd-system.conf, and the shipped
# /etc/systemd/system.conf leaves it commented at that default), so systemd kills
# the attempt 30 seconds before mount.nfs would have stopped trying. nfs-server
# needs a second or two here, so the first retry normally absorbs the race and
# nobody ever sees it. But when it is not absorbed the cost is total, because
# systemd does not re-try a failed mount unit later in the same boot: a CORRECT
# answer then fails reports-mounted in verdict B, and the harness reports that as
# a persistence regression - it tells a student who did everything right that
# their mount did not survive the reboot. Intermittently. That is the worst thing
# this bank can do to somebody, which is why a race this rare is worth a fix.
#
# WHY THIS IS NOT HELP. It changes no checkpoint and it measures nothing: grade.sh
# still demands an NFS mount of /export/reports at /mnt/reports, still reads the
# marker file back through it, and still demands it be written down somewhere. It
# makes nothing easier - an answer with no fstab line still fails
# reports-persistent, and one with a wrong line still fails reports-mounted. It
# teaches nothing false because it teaches nothing: it is not in the prompt, not
# in either solution, and not on the student's path. What it removes is an
# artifact of the one-VM rig this file's header describes, so that this guest
# behaves the way an exam machine does - where the server is another host and the
# race cannot arise. Same category of honesty as storage/042's note about
# manufacturing its spare disk out of a loop device.
#
# NO DEPENDENCY CYCLE - traced from the shipped unit files, not assumed, because a
# cycle would make systemd break some arbitrary edge at boot and that is strictly
# worse than the race being fixed. remote-fs-pre.target's own unit declares only
# `RefuseManualStart=yes`: no After=, no Requires=, no Wants=. So its only
# outgoing ordering edges are the ones other units impose on it -
# nfs-client.target and remote-fs.target, the network mount units, and
# Before=shutdown.target from the default target dependencies. Walking those
# transitively reaches remote-fs.target, autofs.service,
# systemd-user-sessions.service, the getty/rescue/graphical units,
# multi-user.target, umount.target and the shutdown units. nfs-server.service is
# in none of them, and nothing in that set is ordered before it. The three edges
# nfs-server already has that were worth checking individually all point the
# other way: network-online.target is only `After=network.target`,
# local-fs.target is `DefaultDependencies=no` with `After=local-fs-pre.target`,
# and rpcbind.socket is `DefaultDependencies=no` with `Before=rpcbind.target` -
# none of them is downstream of remote-fs-pre.target. So `Before=` here closes no
# loop.
#
# `Wants=` as well as `Before=`, and it is load-bearing rather than belt and
# braces. man 7 systemd.special says of remote-fs-pre.target that "this unit is
# generally not part of the initial transaction, unless the unit that wants to be
# ordered before all remote mounts pulls it in via a Wants= type dependency" - and
# an ordering against a unit that is not in the transaction orders nothing at all.
# nfs-client.target happens to pull it in on a stock guest (it ships
# `Wants=remote-fs-pre.target`), but that is another package's unit and another
# package's enablement state, and this fix must not rest on either.
#
# A DROP-IN rather than an edit to the packaged unit, and `Before=` in a drop-in
# is ADDITIVE: man 5 systemd.unit is explicit that "dependencies can only be added
# in drop-ins" and that removing one means overriding the whole unit. So the
# shipped `Before=rpc-statd-notify.service` survives and does not need restating.
# That was worth checking rather than guessing - in a file that REPLACED the list,
# omitting it would have quietly broken the packaged unit.
#
# What the ordering actually buys: nfs-server.service is `Type=oneshot` with
# `RemainAfterExit=yes`, so it only reaches `active` once /usr/sbin/rpc.nfsd has
# exited 0 - and rpc.nfsd hands its listening sockets to the kernel before it
# spawns threads and refuses to continue at all if it could not set a single
# socket. So "nfs-server is active" really does mean "something is listening",
# which is exactly the fact the mount needs and the only one worth waiting for.
#
# Two things come along for free. The /mnt/oldshare entry staged further down is
# an NFS line too, so it stops racing as well; and nfs-server ends up ordered
# before autofs.service, because autofs.service ships `After=... remote-fs.target
# ...` and remote-fs.target is `After=remote-fs-pre.target`.
#
# THE AUTOFS HALF NEVER HAD THIS PROBLEM, and this is here so nobody "fixes" it
# twice. An automount is triggered by access, not at boot, so there is no boot
# ordering to lose. And on this guest it could not fail even if there were: the
# map's server resolves to 127.0.0.1, which autofs classifies PROXIMITY_LOCAL, and
# autofs's own prune_host_list() returns immediately for a host list that is
# entirely local - its comment says it does so to avoid "probe latency for the
# common case of a single filesystem mount request" - so no RPC probe of the
# server ever happens, and what lands on /nfsdata/archive is a bind mount of
# /export/archive (grade.sh's served_path_at documents that at length). A bind
# mount of a local directory needs no nfsd at all. The ordering above is therefore
# tidiness for the autofs half and a real fix only for the fstab/mount-unit half.
NFS_DROPIN_DIR=/etc/systemd/system/nfs-server.service.d
NFS_DROPIN=$NFS_DROPIN_DIR/10-rhcsa-lab-order-before-remote-fs.conf

need sudo mkdir -p "$NFS_DROPIN_DIR"
# Idempotent in both directions. The file is written WHOLE rather than appended
# to, so a re-run over a previous version of it converges; and any drop-in an
# earlier version of this script left under a DIFFERENT name is removed first, so
# two of them cannot accumulate and disagree. Matched on the lab's own prefix
# only, so a drop-in this guest carries for its own reasons is left alone.
# `< /dev/null` inside the loop, so nothing there can eat the process
# substitution the loop is reading from.
while read -r stale; do
  [[ -n $stale ]] || continue
  [[ $stale == "$NFS_DROPIN" ]] && continue
  sudo rm -f "$stale" < /dev/null
done < <(
  sudo find "$NFS_DROPIN_DIR" -maxdepth 1 -type f -name '*rhcsa*.conf' 2>/dev/null
)
printf '%s\n' \
  '# Installed by content/tasks/storage/043-nfs-and-autofs/setup.sh, which owns' \
  '# this file and rewrites it on every run. Lab infrastructure, not a task' \
  '# answer: this one guest is its own NFS server, and nfs-server.service is not' \
  '# ordered against remote-fs-pre.target, so without this the boot-time NFS' \
  '# mount can be attempted before rpc.nfsd is listening. Wants= as well as' \
  '# Before=, because man 7 systemd.special warns that remote-fs-pre.target is' \
  '# not in the boot transaction unless something pulls it in.' \
  '[Unit]' \
  'Wants=remote-fs-pre.target' \
  'Before=remote-fs-pre.target' \
  | sudo tee "$NFS_DROPIN" >/dev/null \
  || fail "could not write $NFS_DROPIN; without it the boot-time NFS mount races this guest's own NFS server and reports-mounted can fail after the reboot on a correct answer. Check that /etc/systemd/system is writable by root and that the filesystem is not full"
need sudo chmod 0644 "$NFS_DROPIN"
sudo restorecon "$NFS_DROPIN" &>/dev/null
need sudo systemctl daemon-reload

# Read the result back out of systemd rather than off the disk. What matters is
# that the manager MERGED the drop-in, and a stray typo, a missing [Unit] header
# or a daemon-reload that did not happen all leave a file on disk that looks
# perfectly fine. Space-padded comparison rather than a pipe into grep, for the
# SIGPIPE reason content/lib/assert.sh documents.
nfs_before=$(systemctl show -p Before --value nfs-server.service 2>&1 | tr '\n' ' ')
case " $nfs_before " in
  *" remote-fs-pre.target "*) ;;
  *) fail "systemd does not report nfs-server.service as ordered before remote-fs-pre.target after $NFS_DROPIN was installed (its Before= is: $(printf '%s' "$nfs_before" | cut -c1-200)); without that ordering the boot-time NFS mount races this guest's own NFS server, and reports-mounted can fail in the post-reboot verdict on an answer that is correct" ;;
esac
nfs_wants=$(systemctl show -p Wants --value nfs-server.service 2>&1 | tr '\n' ' ')
case " $nfs_wants " in
  *" remote-fs-pre.target "*) ;;
  *) fail "systemd does not report nfs-server.service as wanting remote-fs-pre.target after $NFS_DROPIN was installed (its Wants= is: $(printf '%s' "$nfs_wants" | cut -c1-200)); man 7 systemd.special says that target is not part of the boot transaction unless something pulls it in, and an ordering against a unit that is not in the transaction orders nothing" ;;
esac

# enable as well as start: export-intact is graded after a reboot too, and a
# server that only ran because this script started it would take both halves of
# the task down with it in verdict B.
need sudo systemctl enable --now nfs-server
# Re-export, for the case where nfs-server was already running when the table
# above was written.
need sudo exportfs -r

etab=$(sudo exportfs -s 2>&1)
for p in "$EXPORT_REPORTS" "$EXPORT_ARCHIVE"; do
  printf '%s\n' "$etab" | awk -v p="$p" '$1 == p { hit = 1 } END { exit hit ? 0 : 1 }' \
    || fail "exportfs does not list $p as exported (it says: $(printf '%s' "$etab" | tr '\n' ' ' | cut -c1-200)); nothing in this task could be mounted"
done

# --- the firewall ---------------------------------------------------------
# Belt and braces, and deliberately so. The mount path in this task is loopback,
# and firewalld is understood to accept loopback traffic unconditionally - but
# firewalld is not installed on the authoring host, its manual pages could not be
# read there, and a grader must not rest on an unverified belief about a packet
# filter. So the three services an NFS client needs are ADDED to the default zone
# if firewalld is running, which makes the question moot either way.
#
# --add-service only, runtime and permanent as two separate calls, and no
# --reload anywhere. Nothing here can remove ssh from a zone, and no reload can
# interrupt the harness's own ssh session, because the two adds are additive and
# the runtime one takes effect immediately. `--remove-service`, `--set-*` and
# `--reload` are the three things this block must never contain.
if command -v firewall-cmd >/dev/null && sudo systemctl is-active --quiet firewalld; then
  zone=$(sudo firewall-cmd --get-default-zone 2>/dev/null)
  if [[ -n $zone ]]; then
    for svc in nfs rpc-bind mountd; do
      sudo firewall-cmd --zone="$zone" --add-service="$svc" &>/dev/null
      sudo firewall-cmd --permanent --zone="$zone" --add-service="$svc" &>/dev/null
    done
  fi
fi

# The harness reaches this guest over ssh as student. Asserted, not assumed:
# nothing above touches sshd or the ssh service in any zone, and if that ever
# stops being true this is the line that says so instead of the run dying with an
# unexplained transport error.
sshd_state=$(systemctl is-active sshd 2>&1)
[[ $sshd_state == active ]] \
  || fail "sshd is '$sshd_state' after staging this task; the grader reaches this guest over ssh and cannot collect any verdict without it"

# --- prove the export is really mountable from here -----------------------
# The one precondition that matters most and the only one no amount of reading
# configuration files can establish: that a client on this host can mount the
# export the student is about to be asked to mount. Done at a private path, never
# at $CLIENT_REPORTS, because a mount left at the student's mount point would make
# reports-mounted pass at baseline.
#
# retry=0 so mount.nfs gives up at once instead of retrying for its default two
# minutes; the loop below is this script's own retry, bounded and loud. timeout as
# a second belt, because a hung mount is worse than a failed one.
need sudo mkdir -p "$PROBE"
probe_err=
attempt=0
while (( attempt < 3 )); do
  attempt=$((attempt + 1))
  probe_err=$(sudo timeout 45 mount -t nfs -o retry=0 "$SERVER:$EXPORT_REPORTS" "$PROBE" 2>&1)
  [[ -n $(mp_rows "$PROBE") ]] && break
  sleep 2
done
if [[ -z $(mp_rows "$PROBE") ]]; then
  fail "mounting $SERVER:$EXPORT_REPORTS failed after $attempt attempts, so this task is unsolvable on this guest. mount said: ${probe_err:-nothing}. nfs-server is $(systemctl is-active nfs-server 2>&1), exportfs -s says $(printf '%s' "$etab" | tr '\n' ' ' | cut -c1-160), '$SERVER' resolves to $(getent hosts "$SERVER" | tr '\n' ' '), and journalctl -u nfs-server ends with: $(sudo journalctl -u nfs-server -n 3 --no-pager 2>&1 | tr '\n' ' ' | cut -c1-200)"
fi
probe_seen=$(sudo timeout 20 cat "$PROBE/$REPORTS_FILE" 2>&1)
case $probe_seen in
  *"$REPORTS_MARKER"*) ;;
  *) fail "the export mounted but $REPORTS_FILE did not read back through it (got: $(printf '%s' "$probe_seen" | tr '\n' ' ' | cut -c1-160)); grade.sh proves a mount is the right export by reading that file, so no answer could pass" ;;
esac
sudo umount "$PROBE" &>/dev/null || sudo umount -l "$PROBE" &>/dev/null
[[ -z $(mp_rows "$PROBE") ]] \
  || fail "the verification mount at $PROBE could not be unmounted; a stale NFS mount left here will confuse the next run"

# --- stage the leftover the student has to clean up ----------------------
# /mnt/oldshare, mounted AND in fstab, which is what makes oldshare-released a
# two-part answer: unmounting it is not enough, because the next boot brings it
# back. It also gives the student a working fstab line to read, which is a fair
# amount of help for the /mnt/reports half - and deliberately so; this task is
# about knowing which facts have to be written down, not about memorising six
# fields.
#
# The new file is built and checked BEFORE it is installed. /etc/fstab is the one
# file on this guest where a bad edit costs a boot, and the / and /home entries are
# checked by name because /home carries /home/student/.ssh/authorized_keys - the
# key the grader authenticates with. storage/014's own anti-solution took that
# path out and cost a validation run.
fstab_tmp=$(mktemp) || fail "could not create a temporary file"
sudo awk -v a="$CLIENT_REPORTS" -v b="$CLIENT_OLD" '$2 != a && $2 != b' /etc/fstab > "$fstab_tmp" \
  || fail "could not filter /etc/fstab"
printf '%s:%s %s nfs defaults 0 0\n' "$SERVER" "$EXPORT_ARCHIVE" "$CLIENT_OLD" >> "$fstab_tmp"
[[ -n $(awk '$2 == "/"' "$fstab_tmp") ]] \
  || fail "the filtered /etc/fstab has no entry for / left; refusing to install it"
[[ -n $(awk '$2 == "/home"' "$fstab_tmp") ]] \
  || fail "the filtered /etc/fstab has no entry for /home left, and /home carries the ssh key the grader authenticates with; refusing to install it"
[[ -z $(awk -v a="$CLIENT_REPORTS" '$2 == a' "$fstab_tmp") ]] \
  || fail "the filtered /etc/fstab still has an entry for $CLIENT_REPORTS, so reports-persistent would pass at baseline"
[[ $(awk -v b="$CLIENT_OLD" '$2 == b' "$fstab_tmp" | wc -l) -eq 1 ]] \
  || fail "the staged /etc/fstab does not have exactly one entry for $CLIENT_OLD"
need sudo cp "$fstab_tmp" /etc/fstab
sudo restorecon /etc/fstab &>/dev/null
rm -f "$fstab_tmp"
sudo systemctl daemon-reload &>/dev/null

need sudo mkdir -p "$CLIENT_OLD"
# Mounted through the fstab entry rather than with an explicit source, so this
# also proves the line that was just installed is one systemd can act on at boot.
old_err=$(sudo timeout 90 mount "$CLIENT_OLD" 2>&1)
[[ -n $(mp_rows "$CLIENT_OLD") ]] \
  || fail "mounting $CLIENT_OLD from the fstab entry failed (mount said: ${old_err:-nothing}), so oldshare-released would pass at baseline with nothing to release"

# The autofs mount point. Created empty so that BOTH map styles work: an indirect
# map (solutions/01) would create and remove this directory itself, while a direct
# map (solutions/02) mounts on a path that has to exist. An empty directory costs
# the indirect answer nothing.
need sudo mkdir -p "$AUTOFS_BASE"
need sudo chmod 0755 "$AUTOFS_BASE"
sudo restorecon -R "$AUTOFS_BASE" &>/dev/null

# ...and empty really means empty, on a re-run too. A direct-map answer
# (solutions/02, and any student who copies it) has to `mkdir` $AUTOFS_PATH before
# the automounter will accept it, and that directory is an ordinary directory on
# disk that outlives the unmount above. Left in place it fails the two baseline
# assertions at the bottom of this file, so re-running setup on a machine that has
# already been solved once would abort instead of resetting it - which is the
# opposite of what the IDEMPOTENT note at the top of this file promises.
#
# rmdir, never `rm -r`: if the directory is not empty then something is there that
# this script did not put there and does not understand, and the assertions below
# should say so rather than have it deleted out from under them.
sudo rmdir "$AUTOFS_PATH" &>/dev/null

# --- verify every goal checkpoint fails, and the invariant passes ---------
# One block per checkpoint, in grade.sh's order. A goal checkpoint that already
# passes here is a student-facing false pass, not a solved task.

# reports-mounted
[[ -z $(mp_rows "$CLIENT_REPORTS") ]] \
  || fail "something is already mounted at $CLIENT_REPORTS ($(mp_rows "$CLIENT_REPORTS" | tr '\n' ' ')), so reports-mounted could pass at baseline"

# reports-persistent, checked exactly the way content/lib/assert.sh's
# is_persistent checks it: an fstab entry whose field 2 is the mount point, or a
# .mount unit whose Where= is. Both halves, because either one passing at baseline
# is a false pass.
[[ -z $(sudo awk -v t="$CLIENT_REPORTS" '/^[[:space:]]*#/ { next } NF >= 2 && $2 == t { print }' /etc/fstab) ]] \
  || fail "/etc/fstab still has an entry for $CLIENT_REPORTS, so reports-persistent would pass at baseline"
[[ -z $(sudo grep -rlsE "^[[:space:]]*Where[[:space:]]*=[[:space:]]*$CLIENT_REPORTS[[:space:]]*$" /etc/systemd/system --include='*.mount' 2>/dev/null) ]] \
  || fail "a .mount unit under /etc/systemd/system still names $CLIENT_REPORTS as its Where=, so reports-persistent would pass at baseline"

# oldshare-released: it must be BOTH mounted and configured to come back, or the
# checkpoint is half green before the student starts.
[[ -n $(mp_rows "$CLIENT_OLD") ]] \
  || fail "$CLIENT_OLD is not mounted, so half of oldshare-released would pass at baseline"
[[ -n $(sudo awk -v t="$CLIENT_OLD" 'NF >= 2 && $2 == t { print }' /etc/fstab) ]] \
  || fail "/etc/fstab has no entry for $CLIENT_OLD, so half of oldshare-released would pass at baseline"

# autofs-enabled, compared exactly the way grade.sh compares it. On the bare exit
# status of `systemctl is-enabled` this check would accept static, indirect,
# generated, alias and enabled-runtime while the grader rejects them, and a guest
# staged that way hands the student a green checkpoint. String equality rather than
# a pipe into grep, for the SIGPIPE reason content/lib/assert.sh documents.
aen=$(systemctl is-enabled autofs 2>&1)
if [[ $aen == enabled ]]; then
  fail "autofs is still enabled (is-enabled=$aen) after the disable; autofs-enabled would pass at baseline"
fi
aact=$(systemctl is-active autofs 2>&1)
if [[ $aact == active ]]; then
  fail "autofs is still running (is-active=$aact) after the stop; archive-via-autofs and archive-automounted would be graded against a daemon this script was supposed to have stopped"
fi

# archive-via-autofs
[[ -z $(findmnt -rno TARGET -t autofs 2>/dev/null | awk -v b="$AUTOFS_BASE" -v p="$AUTOFS_PATH" '$1 == b || $1 == p { print }') ]] \
  || fail "there is already an autofs mount at $AUTOFS_BASE or $AUTOFS_PATH, so archive-via-autofs would pass at baseline"

# archive-automounted
[[ ! -e $AUTOFS_PATH ]] \
  || fail "$AUTOFS_PATH already exists, so archive-automounted could pass at baseline"
[[ -z $(sudo find "$AUTOFS_BASE" -mindepth 1 -maxdepth 1 -print 2>/dev/null) ]] \
  || fail "$AUTOFS_BASE is not empty, and the prompt promises the student an empty directory"

# export-intact is an invariant: prove it holds before the student starts, so a
# failure afterwards can only mean the student broke it - or that the stand-in
# server died, which is the other thing this checkpoint exists to say out loud.
nfs_state=$(systemctl is-active nfs-server 2>&1)
[[ $nfs_state == active ]] \
  || fail "nfs-server is '$nfs_state' after being started; the export-intact invariant would fail for every fixture"
nfs_enabled=$(systemctl is-enabled nfs-server 2>&1)
[[ $nfs_enabled == enabled ]] \
  || fail "nfs-server is-enabled='$nfs_enabled', not enabled, so the export would be gone after the reboot and export-intact would fail in verdict B for every fixture"

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
