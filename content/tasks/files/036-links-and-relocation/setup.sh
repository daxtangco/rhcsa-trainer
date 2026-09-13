#!/usr/bin/env bash
# Prepare the system for files/036-links-and-relocation.
#
# Builds the situation the prompt describes: a collector's output directory that
# somebody has been careless with - one capture filed into the wrong
# subdirectory, a core file and a scratch directory nobody cleaned up, a symlink
# to the collector's config sitting alongside the captures - plus an empty
# /srv/archive to put the copy in. Every detail is load-bearing for a checkpoint
# and each one is verified at the bottom of this file rather than assumed.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell.
#
# FULLY IDEMPOTENT, unlike content/tasks/storage/014-grow-home-lv/setup.sh, and
# it can afford to be: everything this task touches is a file or a directory
# entry under /srv, so the reset is a recursive removal and a rebuild. Nothing
# here is one-shot the way an XFS filesystem that cannot shrink is. Re-running
# this after solving the task returns the guest to the baseline, and the
# verification block below proves it did.
set -uo pipefail

# No `set -e`. The removals below legitimately "fail" on a first run and the
# probes are meant to be asked, not to abort the script. The commands that MUST
# work go through `need` instead, because a silent failure here stages the wrong
# machine and every checkpoint result afterwards is a lie. Same deliberate
# divergence from 014 that content/tasks/files/033-shared-group-directory and
# content/tasks/sys/035-persistent-journal-and-schedule document; do not
# "harmonise" them.
fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }
need() { "$@" || fail "FAILED: $*"; }

LIVE=/srv/telemetry
ARCHIVE_PARENT=/srv/archive
ARCHIVE=$ARCHIVE_PARENT/telemetry
REVIEW=/srv/review
CONF=/srv/telemetry-collector.conf
CONF_LINK=$LIVE/collector.conf
INCOMING=$LIVE/incoming
SCRATCH=$LIVE/scratch
CORE=$LIVE/core.4417
STAMP_DIR=/var/lib/rhcsa-lab
STAMP=$STAMP_DIR/036-source-facts

# The account and group the captures belong to. Both are guaranteed on the lab
# guest: `student` is created by the installer (docs/vm-build-checklist.md step
# 6) and `adm` is a stock RHEL system group, gid 4. Deliberately NOT
# student:student - the per-user group is conventional and not guaranteed, which
# is the same reason sys/035's setup gives for chowning by user alone. The pair
# matters because the archive-attrs checkpoint asks whether a copy kept its
# owner AND group, and a file owned root:root would be copied to root:root by
# any careless `cp` run under sudo, so the checkpoint would pass for the wrong
# answer.
OWNER=student
GROUP=adm
MODE=640

# Markers, one per capture, so the grader can tell a real copy from a truncated
# or regenerated file. Spelled identically in grade.sh.
M01=RHCSA036-P01-4b7e
M02=RHCSA036-P02-4b7e
M03=RHCSA036-P03-4b7e

# Fixed modification times, in the past and distinct from each other. Distinct
# on purpose: a grader comparing "the copy's mtime" against a single stamped
# value would accept a copy that gave every file the same wrong timestamp, and
# three different values make that impossible. `touch -d` with no timezone is
# read in the guest's local zone, which is fine because the value is stamped by
# reading the file back rather than by computing it here.
T01='2026-01-08 22:05:11'
T02='2026-02-11 04:32:56'
T03='2026-03-14 09:41:07'

# --- preconditions --------------------------------------------------------
# Convention for every task in this bank: verify every precondition the goal
# checkpoints depend on, not only the ones this script needs to run. A
# precondition that only guards the script leaves the checkpoints free to pass or
# fail for reasons that have nothing to do with the student.
id -u "$OWNER" &>/dev/null \
  || fail "user $OWNER does not exist, and the ownership half of archive-attrs is graded against that account"
getent group "$GROUP" >/dev/null \
  || fail "group $GROUP does not exist, and the group half of archive-attrs is graded against it"

# Everything this task grades lives under /srv, and two of its checkpoints
# depend on /srv being ONE filesystem:
#   - moved-in-place asks whether probe-2026-01.log kept its inode number, which
#     only a rename within a filesystem can do. A `mv` across a mount point is a
#     copy-and-unlink underneath, so the correct answer would fail.
#   - antisolutions/02 hard-links a capture into /srv/review to prove
#     review-symlink rejects it. A hard link cannot cross a filesystem, so on a
#     guest with /srv/review on its own mount that fixture would error out
#     instead of probing anything.
# A stray mount over one of those paths is not something this script should
# silently work around, so it is reported.
#
# Read the WHOLE mount table and filter, rather than `findmnt -R /srv`.
# findmnt can only recurse from a node that is itself in the table, so on the
# normal topology - /srv an ordinary directory on the root filesystem, which is
# what docs/vm-build-checklist.md builds - `findmnt -R /srv` reports nothing at
# all and a guard written that way never fires. Measured on util-linux 2.37.4,
# the version RHEL 9 ships: on a host where /mnt/wsl is mounted and /mnt is not,
# `findmnt -rno TARGET -R /mnt` prints nothing and exits 1.
#
# Scoped to the three paths this task uses, not to everything under /srv:
# content/tasks/storage/034-new-volume-and-swap has the student mount
# /srv/projects, and a guest where that is still mounted is a perfectly good
# guest for this task. Aborting on it would be a precondition failing for a
# reason no checkpoint here depends on.
mounted=$(findmnt -rno TARGET 2>/dev/null | awk -v a="$LIVE" -v b="$REVIEW" -v c="$ARCHIVE_PARENT" '
  $1 == a || index($1, a "/") == 1 ||
  $1 == b || index($1, b "/") == 1 ||
  $1 == c || index($1, c "/") == 1 { print $1 }')
if [[ -n $mounted ]]; then
  fail "these paths are separate mounts: $(printf '%s' "$mounted" | tr '\n' ' '); moved-in-place and antisolutions/02 both need $LIVE, $REVIEW and $ARCHIVE_PARENT to sit on one filesystem, so unmount them or revert to the \`clean\` snapshot"
fi

# --- reset ----------------------------------------------------------------
# Removes this task's own artefacts and every artefact any shipped fixture of
# this task creates. The harness reverts a snapshot before each fixture, so this
# block is for the human who re-runs setup by hand on a guest they have already
# solved the task on.
#
# Scoped to five fixed paths, all of them created by this file. Nothing here uses
# a glob or a variable that could be empty, because `rm -rf` with an unset
# variable is how a setup script eats a guest.
need sudo rm -rf "$LIVE" "$REVIEW" "$ARCHIVE_PARENT" "$CONF"

# --- build the pre-task state --------------------------------------------
need sudo mkdir -p "$LIVE" "$INCOMING" "$SCRATCH" "$ARCHIVE_PARENT"
need sudo chmod 0755 "$LIVE" "$INCOMING" "$SCRATCH" "$ARCHIVE_PARENT"

# The captures. Written through `tee` under sudo rather than with a redirect,
# because the redirect would be evaluated by the unprivileged shell.
printf '%s collector start\ncounter=17\ncounter=18\n' "$M01" | sudo tee "$INCOMING/probe-2026-01.log" >/dev/null
printf '%s collector start\ncounter=204\ncounter=205\n' "$M02" | sudo tee "$LIVE/probe-2026-02.log" >/dev/null
printf '%s collector start\ncounter=991\ncounter=992\n' "$M03" | sudo tee "$LIVE/probe-2026-03.log" >/dev/null

# The collector's config, and the symlink to it that lives beside the captures.
# The symlink is what makes archive-symlink a real checkpoint: a copy made
# without asking for symlinks to be preserved silently replaces this entry with a
# duplicate of the config file, which is the trap the concept card names. The
# target must EXIST for that trap to be quiet - a copy that dereferences a
# dangling symlink errors out instead, and a fixture that errors is a fixture the
# harness reports rather than one the grader catches.
printf 'interval=60\noutput=%s\n' "$LIVE" | sudo tee "$CONF" >/dev/null
need sudo chmod 0644 "$CONF"
need sudo ln -s "$CONF" "$CONF_LINK"

# The debris junk-gone is graded on. The scratch directory holds a file on
# purpose: an empty one would come away with `rmdir`, and "remove a directory
# that still has something in it" is the half of the delete objective worth
# practising.
printf 'not a real core file\n' | sudo tee "$CORE" >/dev/null
printf 'partial write, abandoned\n' | sudo tee "$SCRATCH/probe-2026-03.log.part" >/dev/null

# Ownership and mode of the captures, then the timestamps LAST. chown and chmod
# rewrite ctime and leave mtime alone, but doing it in the other order invites
# the next author to insert something between them that does not.
need sudo chown "$OWNER:$GROUP" "$INCOMING/probe-2026-01.log" "$LIVE/probe-2026-02.log" "$LIVE/probe-2026-03.log"
need sudo chmod "0$MODE" "$INCOMING/probe-2026-01.log" "$LIVE/probe-2026-02.log" "$LIVE/probe-2026-03.log"
need sudo touch -d "$T01" "$INCOMING/probe-2026-01.log"
need sudo touch -d "$T02" "$LIVE/probe-2026-02.log"
need sudo touch -d "$T03" "$LIVE/probe-2026-03.log"

# SELinux is Enforcing on this guest. /srv is var_t and everything created under
# it inherits that, so this is belt and braces rather than a fix - and it is
# cheap insurance against a guest where /srv was relabelled by hand, which would
# leave a student unable to read their own captures with no visible reason.
sudo restorecon -R /srv &>/dev/null

# --- stamp the facts the grader compares against -------------------------
# The grader must not hardcode a uid, a mode or a timestamp: it grades "the copy
# kept what the original had", and the only truthful source for that is the
# original as this script left it. Same device as sys/035's boot-id stamp, for
# the same reason.
#
# Read back with stat rather than echoed from the variables above, so a chown or
# a touch that did not take is recorded as what actually happened and caught by
# the verification block instead of being papered over.
need sudo mkdir -p "$STAMP_DIR"
read -r uid gid mode m01 ino01 < <(stat -c '%u %g %a %Y %i' "$INCOMING/probe-2026-01.log" 2>/dev/null)
m02=$(stat -c %Y "$LIVE/probe-2026-02.log" 2>/dev/null)
m03=$(stat -c %Y "$LIVE/probe-2026-03.log" 2>/dev/null)
conftarget=$(readlink "$CONF_LINK" 2>/dev/null)

{
  printf 'uid=%s\n' "${uid:-}"
  printf 'gid=%s\n' "${gid:-}"
  printf 'mode=%s\n' "${mode:-}"
  printf 'ino01=%s\n' "${ino01:-}"
  printf 'm01=%s\n' "${m01:-}"
  printf 'm02=%s\n' "${m02:-}"
  printf 'm03=%s\n' "${m03:-}"
  printf 'conftarget=%s\n' "${conftarget:-}"
} | sudo tee "$STAMP" >/dev/null
need sudo chmod 0644 "$STAMP"

# Read every fact back the way grade.sh reads it. The grader fails every
# checkpoint closed when a fact is missing, so a stamp that did not land is a
# task nobody can pass - better to say so here than to hand the student a grader
# that fails for a reason they cannot see.
fact() { awk -F= -v k="$1" '$1 == k { v = $2 } END { print v }' "$STAMP" 2>/dev/null; }
for key in uid gid mode ino01 m01 m02 m03 conftarget; do
  [[ -n $(fact "$key") ]] || fail "$STAMP has no value for $key; grade.sh fails closed on that and no answer could pass"
done
[[ $(fact mode) == "$MODE" ]] \
  || fail "the captures came out mode $(fact mode), not $MODE; the chmod above did not take"
[[ $(fact conftarget) == "$CONF" ]] \
  || fail "$CONF_LINK points at '$(fact conftarget)', not $CONF; archive-symlink compares the copy's target against that value"
[[ $(fact m01) != "$(fact m02)" && $(fact m02) != "$(fact m03)" ]] \
  || fail "two captures share a modification time, so archive-attrs could not tell a preserved timestamp from a copied-across one"

# The same one-filesystem requirement the precondition above screens for, now
# asserted positively by device number on the directories that actually exist.
# The table scan can only report an entry it can see; this reports the fact the
# checkpoints depend on. $REVIEW is not checked because the student creates it -
# /srv, the directory it will be created in, is checked instead.
dev_srv=$(stat -c %d /srv 2>/dev/null)
[[ -n $dev_srv ]] || fail "cannot stat /srv"
for p in "$LIVE" "$INCOMING" "$ARCHIVE_PARENT"; do
  [[ $(stat -c %d "$p" 2>/dev/null) == "$dev_srv" ]] \
    || fail "$p is on a different filesystem from /srv; moved-in-place needs the rename from $INCOMING into $LIVE to stay within one filesystem, and antisolutions/02 needs a hard link from $LIVE into $REVIEW, which the student creates under /srv"
done

# --- verify every goal checkpoint fails, and the invariant passes --------
# One block per checkpoint, in grade.sh's order. A goal checkpoint that already
# passes here is a student-facing false pass, not a solved task.

# current-hardlink
[[ ! -e $LIVE/current.log && ! -L $LIVE/current.log ]] \
  || fail "$LIVE/current.log already exists, so current-hardlink would pass at baseline"

# review-symlink and review-resolves
[[ ! -e $REVIEW && ! -L $REVIEW ]] \
  || fail "$REVIEW already exists, so review-symlink and review-resolves could pass at baseline"

# moved-in-place: the misfiled capture must still be in the wrong place, and
# nothing may already occupy the right one.
[[ -f $INCOMING/probe-2026-01.log ]] \
  || fail "$INCOMING/probe-2026-01.log is missing, so the move this task is about cannot be performed"
[[ ! -e $LIVE/probe-2026-01.log && ! -L $LIVE/probe-2026-01.log ]] \
  || fail "$LIVE/probe-2026-01.log already exists, so moved-in-place would pass at baseline"

# incoming-gone
[[ -d $INCOMING ]] || fail "$INCOMING does not exist, so incoming-gone would pass at baseline"

# junk-gone
[[ -e $CORE ]] || fail "$CORE does not exist, so half of junk-gone would pass at baseline"
[[ -d $SCRATCH ]] || fail "$SCRATCH does not exist, so half of junk-gone would pass at baseline"
[[ -n $(sudo find "$SCRATCH" -mindepth 1 -print 2>/dev/null) ]] \
  || fail "$SCRATCH is empty, so rmdir alone would clear it and the recursive-removal half of the delete objective is not exercised"

# archive-attrs and archive-symlink
[[ -d $ARCHIVE_PARENT ]] || fail "$ARCHIVE_PARENT is missing; the prompt promises it already exists"
[[ ! -e $ARCHIVE && ! -L $ARCHIVE ]] \
  || fail "$ARCHIVE already exists, so archive-attrs and archive-symlink could pass at baseline"

# originals-intact is an invariant: prove it holds before the student starts, so
# a failure afterwards can only mean the student broke it. Checked with the exact
# comparison grade.sh makes, not an approximation of it - on the bare existence
# of the files this would accept a guest whose captures were left mode 0644 while
# the grader rejects it, and the invariant would fail for every fixture including
# both solutions.
for f in probe-2026-02 probe-2026-03; do
  got=$(stat -c '%u %g %a' "$LIVE/$f.log" 2>/dev/null)
  [[ $got == "$(fact uid) $(fact gid) $(fact mode)" ]] \
    || fail "$LIVE/$f.log is '$got', wanted '$(fact uid) $(fact gid) $(fact mode)'; the originals-intact invariant would fail for every fixture"
done
[[ -L $CONF_LINK ]] || fail "$CONF_LINK is not a symbolic link, so archive-symlink is unsatisfiable"

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
