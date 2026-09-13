#!/usr/bin/env bash
# Grader for files/036-links-and-relocation.
#
# READ-ONLY. Changes nothing on the guest. The exit code is ignored; only the
# JSONL emitted by the assert helpers is read. content/lib/assert.sh is prepended
# by loadTaskScripts, so its helpers are already in scope - do not source it.
#
# Nine checkpoints, because this task fails independently in nine ways and a
# single "did it work" verdict would tell a student they are wrong without saying
# which half. The three that matter most are the three a student can get wrong
# while everything on screen looks right:
#
#   current-hardlink  a symlink here works today and dangles the moment the
#                     collector renames the capture.
#   review-symlink    a hard link here reads correctly and keeps the capture's
#                     disk blocks allocated after the collector deletes it, so
#                     the cleanup job appears to work and the disk fills up.
#   review-resolves   a relative symlink created from the wrong directory prints
#                     perfectly in `ls -l` and resolves to nothing.
#
# What is deliberately NOT graded: no checkpoint looks for a particular command,
# a particular flag, or shell history. `ln` versus `cp -l` versus `link` are all
# hard links, an absolute and a correctly-written relative symlink are both
# symlinks, and `cp -a` versus a tar stream versus `--preserve=all` all preserve
# what the prompt asks to be preserved. Every checkpoint below reads the
# resulting inodes, directory entries and attributes (spec 6.5 rule 1).
#
# Two more things are knowingly not probed, and no checkpoint is emitted for
# either, so neither is an unprobed invariant - they are simply outside what this
# grader claims:
#   - whether the archive preserved the hard link between current.log and
#     probe-2026-03.log. Grading it would rule out a plain `cp -rp`, and the
#     prompt does not ask for it.
#   - whether the archive is a copy of the TIDIED directory. A student who
#     archived first and tidied afterwards leaves incoming/, scratch/ and
#     core.4417 inside /srv/archive/telemetry and still passes, because the four
#     conditions the prompt attaches to the archive are all about the three
#     captures and collector.conf.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start - here that is
# originals-intact, which antisolutions/06 exists to prove is really probed.
# baseline-fail: current-hardlink, review-symlink, review-resolves, moved-in-place, incoming-gone, junk-gone, archive-attrs, archive-symlink
set -uo pipefail

LIVE=/srv/telemetry
ARCHIVE=/srv/archive/telemetry
REVIEW=/srv/review
CONF_LINK=$LIVE/collector.conf
INCOMING=$LIVE/incoming
SCRATCH=$LIVE/scratch
CORE=$LIVE/core.4417
STAMP=/var/lib/rhcsa-lab/036-source-facts

# One marker line per capture, written by setup.sh. A copy that holds the marker
# is the capture's content; one that does not was truncated, regenerated or is
# some other file wearing the right name. Spelled identically in setup.sh.
MARK01=RHCSA036-P01-4b7e
MARK02=RHCSA036-P02-4b7e
MARK03=RHCSA036-P03-4b7e

# Every attribute the copy has to preserve, read from the stamp setup.sh wrote by
# reading the originals back. Deliberately not hardcoded here: student's uid is
# whatever the installer gave it, and "the copy kept what the original had" is
# the actual requirement, so a literal in this file would be a second source of
# truth that can disagree with the guest.
fact() { awk -F= -v k="$1" '$1 == k { v = $2 } END { print v }' "$STAMP" 2>/dev/null; }
WANT_UID=$(fact uid)
WANT_GID=$(fact gid)
WANT_MODE=$(fact mode)
WANT_INO01=$(fact ino01)
WANT_M01=$(fact m01)
WANT_M02=$(fact m02)
WANT_M03=$(fact m03)
WANT_CONF=$(fact conftarget)

# FAIL CLOSED, the same way content/tasks/storage/014-grow-home-lv/grade.sh does
# with its size targets and sys/035 does with its boot id. With an empty
# $WANT_UID the attribute comparisons below turn into a test against a string
# that any missing value also produces, so a grader that could not read its own
# stamp would report archive-attrs and originals-intact as passing on a machine
# where nothing was preserved - and would tell the student they got it right.
# There is no safe way to continue without these, so nothing passes.
if [[ -z $WANT_UID || -z $WANT_GID || -z $WANT_MODE || -z $WANT_INO01 ||
      -z $WANT_M01 || -z $WANT_M02 || -z $WANT_M03 || -z $WANT_CONF ]]; then
  detail="grader could not read the recorded source facts from $STAMP; setup.sh writes that file, so either setup did not run or /var was rolled back under it"
  ck_fail current-hardlink "$LIVE/current.log is a second name for probe-2026-03.log" "$detail"
  ck_fail review-symlink "$REVIEW/probe-2026-02.log is a symbolic link, so it holds no disk blocks of its own" "$detail"
  ck_fail review-resolves "$REVIEW/probe-2026-02.log resolves to $LIVE/probe-2026-02.log" "$detail"
  ck_fail moved-in-place "probe-2026-01.log was moved into $LIVE unchanged, not copied there" "$detail"
  ck_fail incoming-gone "$INCOMING no longer exists" "$detail"
  ck_fail junk-gone "the core file and the scratch directory are gone from $LIVE" "$detail"
  ck_fail archive-attrs "every capture under $ARCHIVE kept its owner, group, mode, timestamp and content" "$detail"
  ck_fail archive-symlink "$ARCHIVE/collector.conf is still a symbolic link to the same path" "$detail"
  ck_fail originals-intact "probe-2026-02.log and probe-2026-03.log are untouched in $LIVE" "$detail"
  exit 0
fi

# Everything below reads the filesystem through sudo. A student may have built
# the archive as root with a umask that leaves it unreadable to their own
# account, and "the grader cannot see it" must never be graded as "it is not
# there": that is a false FAIL and it sends the student looking for a problem
# that does not exist. sys/035 uses `sudo test -s` for the same reason.
#
# `stat` without -L is an lstat, so these report the LINK when handed a symlink,
# which is exactly what the link checkpoints need. The one place a dereference is
# wanted asks for it explicitly with -L.
ident() { sudo stat -c '%d:%i' "$1" 2>/dev/null; }
attrs() { sudo stat -c '%u %g %a %Y' "$1" 2>/dev/null; }
nlink() { sudo stat -c '%h' "$1" 2>/dev/null; }

# --- 1. one file, two names ----------------------------------------------
# Inode identity is the only honest test for "a second name for the same file",
# and it is why this task requires the hard-versus-symbolic card rather than
# merely mentioning it. The device number travels with the inode number on
# purpose: an inode number alone is meaningless across filesystems, and a
# `mount --bind` answer would otherwise have to be argued about instead of
# measured.
#
# Nothing here renames anything to prove the link survives a rename. The grader
# is read-only, and it does not need to: surviving the rename of the other name
# is a property of being a second directory entry for one inode, which is what is
# measured.
cur=$LIVE/current.log
cur_ident=$(ident "$cur")
src03_ident=$(ident "$LIVE/probe-2026-03.log")

if sudo test -L "$cur"; then
  ck_fail current-hardlink "$LIVE/current.log is a second name for probe-2026-03.log" \
    "it is a symbolic link to '$(sudo readlink "$cur" 2>/dev/null)'; a symbolic link stores a path and is resolved afresh every time, so renaming probe-2026-03.log leaves this dangling and the data unreachable through it"
elif ! sudo test -f "$cur"; then
  ck_fail current-hardlink "$LIVE/current.log is a second name for probe-2026-03.log" \
    "$cur is missing or is not a regular file"
elif [[ -z $src03_ident ]]; then
  ck_fail current-hardlink "$LIVE/current.log is a second name for probe-2026-03.log" \
    "$LIVE/probe-2026-03.log is not there to share an inode with; see originals-intact"
elif [[ $cur_ident != "$src03_ident" ]]; then
  ck_fail current-hardlink "$LIVE/current.log is a second name for probe-2026-03.log" \
    "current.log is device:inode $cur_ident and probe-2026-03.log is $src03_ident, so these are two separate files - a copy, not a second name for one inode"
else
  ck_pass current-hardlink "$LIVE/current.log is a second name for probe-2026-03.log"
fi

# --- 2. the review pointer holds no blocks -------------------------------
# The prompt's condition is about disk space, not about syntax: deleting the
# capture from $LIVE must actually free it. Only a symbolic link satisfies that.
# A hard link is a second name on the same inode, so the kernel frees nothing
# until the last name goes - the collector's cleanup runs, reports success, and
# the filesystem does not get any emptier. A copy is worse: the blocks are
# duplicated from the start.
rev=$REVIEW/probe-2026-02.log
src02_ident=$(ident "$LIVE/probe-2026-02.log")

if sudo test -L "$rev"; then
  ck_pass review-symlink "$REVIEW/probe-2026-02.log is a symbolic link, so it holds no disk blocks of its own"
elif sudo test -e "$rev"; then
  ck_fail review-symlink "$REVIEW/probe-2026-02.log is a symbolic link, so it holds no disk blocks of its own" \
    "it exists but is not a symbolic link (device:inode $(ident "$rev"), link count $(nlink "$rev")); a second hard link keeps the capture's blocks allocated after the collector deletes it from $LIVE, and a copy duplicates them immediately"
else
  ck_fail review-symlink "$REVIEW/probe-2026-02.log is a symbolic link, so it holds no disk blocks of its own" \
    "nothing exists at $rev"
fi

# --- 3. ...and it resolves today -----------------------------------------
# Split from checkpoint 2 because the two fail independently and for completely
# different reasons. `ln -s probe-2026-02.log /srv/review/` run from inside $LIVE
# creates a symbolic link that satisfies checkpoint 2 and resolves to
# /srv/review/probe-2026-02.log - itself. `ls -l` prints exactly what the author
# intended; nothing reads. A relative target is resolved against the directory
# the LINK lives in, never the directory the command was typed in, and this is
# the checkpoint that says so.
#
# -L is the deliberate dereference: this asks what the entry resolves to, so a
# correctly written relative target passes and only a target that lands somewhere
# else fails.
rev_target_ident=$(sudo stat -Lc '%d:%i' "$rev" 2>/dev/null)
if [[ -n $rev_target_ident && -n $src02_ident && $rev_target_ident == "$src02_ident" ]]; then
  ck_pass review-resolves "$REVIEW/probe-2026-02.log resolves to $LIVE/probe-2026-02.log"
else
  ck_fail review-resolves "$REVIEW/probe-2026-02.log resolves to $LIVE/probe-2026-02.log" \
    "the entry reads as '$(sudo readlink "$rev" 2>/dev/null)' and resolves to device:inode '${rev_target_ident:-nothing}', while $LIVE/probe-2026-02.log is '${src02_ident:-missing}'. A relative target is resolved against $REVIEW, not against the directory the command was run from"
fi

# --- 4. moved, not copied ------------------------------------------------
# The recorded inode number is the whole checkpoint. `cp` followed by `rm` leaves
# the file looking identical - with -a even the timestamps match - and it is a
# different file: a new inode, freshly allocated blocks, and any other name that
# pointed at the old one now points at something that is no longer there. Only a
# rename within one filesystem moves a file without replacing it.
moved=$LIVE/probe-2026-01.log
moved_ino=$(sudo stat -c '%i' "$moved" 2>/dev/null)
moved_attrs=$(attrs "$moved")
want_attrs01="$WANT_UID $WANT_GID $WANT_MODE $WANT_M01"

if sudo test -L "$moved"; then
  ck_fail moved-in-place "probe-2026-01.log was moved into $LIVE unchanged, not copied there" \
    "$moved is a symbolic link to '$(sudo readlink "$moved" 2>/dev/null)'; the capture itself has to be in $LIVE"
elif ! sudo test -f "$moved"; then
  ck_fail moved-in-place "probe-2026-01.log was moved into $LIVE unchanged, not copied there" \
    "$moved is missing or is not a regular file; it started in $INCOMING"
elif [[ $moved_ino != "$WANT_INO01" ]]; then
  ck_fail moved-in-place "probe-2026-01.log was moved into $LIVE unchanged, not copied there" \
    "this is inode $moved_ino and the capture was inode $WANT_INO01, so what is here is a new file that copies the old one rather than the file itself"
elif [[ $moved_attrs != "$want_attrs01" ]]; then
  ck_fail moved-in-place "probe-2026-01.log was moved into $LIVE unchanged, not copied there" \
    "owner/group/mode/mtime are '$moved_attrs', wanted '$want_attrs01'"
else
  ck_pass moved-in-place "probe-2026-01.log was moved into $LIVE unchanged, not copied there"
fi

# --- 5 and 6. the tidying up ---------------------------------------------
# Both of these insist $LIVE is still a directory before they will report
# success, and that guard is load-bearing rather than defensive. Without it an
# answer that moved the whole capture directory away - antisolutions/06, which is
# a real misreading of "archive it" - would satisfy "incoming no longer exists"
# and "the debris is gone" vacuously, because nothing at all exists there. A
# checkpoint that passes because its subject was deleted is a false pass.
if ! sudo test -d "$LIVE"; then
  ck_fail incoming-gone "$INCOMING no longer exists" \
    "$LIVE is not a directory any more, so this cannot be judged; the captures were supposed to stay there"
  ck_fail junk-gone "the core file and the scratch directory are gone from $LIVE" \
    "$LIVE is not a directory any more, so this cannot be judged"
else
  if sudo test -e "$INCOMING" || sudo test -L "$INCOMING"; then
    ck_fail incoming-gone "$INCOMING no longer exists" \
      "$INCOMING is still there; the misfiled capture belongs directly in $LIVE and the empty directory it came from should not be left behind"
  else
    ck_pass incoming-gone "$INCOMING no longer exists"
  fi

  left=''
  sudo test -e "$CORE" && left+="$CORE "
  sudo test -e "$SCRATCH" && left+="$SCRATCH "
  if [[ -n $left ]]; then
    ck_fail junk-gone "the core file and the scratch directory are gone from $LIVE" \
      "still present: $left(the scratch directory is not empty, so it does not come away with rmdir)"
  else
    ck_pass junk-gone "the core file and the scratch directory are gone from $LIVE"
  fi
fi

# --- 7. the archive preserved what it had to -----------------------------
# One checkpoint for the whole archive rather than one per attribute: "the copy
# kept the owner, the group, the mode and the modification time" is one decision
# a student makes once, and four verdicts on it would be four ways of saying the
# same sentence. The detail names every attribute that is wrong, so the failure
# is still actionable.
#
# Compared against the values setup.sh recorded from the originals, NOT against
# the originals as they stand now. A student who "fixed" a mismatch by changing
# the source to match a careless copy has not preserved anything, and comparing
# copy to source would grade that as success. originals-intact is the other half
# of the same guard.
arch_bad=''
check_copy() {
  local name=$1 want_mtime=$2 mark=$3
  local p=$ARCHIVE/$name got
  if sudo test -L "$p"; then
    arch_bad+="$name is a symbolic link, not a copy of the capture; "
    return
  fi
  if ! sudo test -f "$p"; then
    arch_bad+="$name is missing from $ARCHIVE; "
    return
  fi
  got=$(attrs "$p")
  if [[ $got != "$WANT_UID $WANT_GID $WANT_MODE $want_mtime" ]]; then
    arch_bad+="$name has owner/group/mode/mtime '$got' and the capture had '$WANT_UID $WANT_GID $WANT_MODE $want_mtime'; "
  fi
  # A file argument, not a pipeline, so -q cannot turn a match into SIGPIPE here.
  if ! sudo grep -qsF -- "$mark" "$p"; then
    arch_bad+="$name does not contain the capture's marker $mark; "
  fi
}

if ! sudo test -d "$ARCHIVE"; then
  ck_fail archive-attrs "every capture under $ARCHIVE kept its owner, group, mode, timestamp and content" \
    "$ARCHIVE is not a directory; /srv/archive already exists, so the copy belongs directly inside it"
else
  check_copy probe-2026-01.log "$WANT_M01" "$MARK01"
  check_copy probe-2026-02.log "$WANT_M02" "$MARK02"
  check_copy probe-2026-03.log "$WANT_M03" "$MARK03"
  if [[ -z $arch_bad ]]; then
    ck_pass archive-attrs "every capture under $ARCHIVE kept its owner, group, mode, timestamp and content"
  else
    ck_fail archive-attrs "every capture under $ARCHIVE kept its owner, group, mode, timestamp and content" \
      "${arch_bad:0:400}(a plain recursive copy run under sudo gives every file root:root, the mode its own umask allows and this morning's timestamp)"
  fi
fi

# --- 8. the archive kept the symlink as a symlink ------------------------
# The trap the concept card names outright: most tools follow a symbolic link by
# default, so a recursive copy that was not told otherwise replaces this entry
# with a duplicate of the file at the far end of it. Nothing warns, and the
# archive silently stops being a copy of the directory.
#
# Two ways to pass, because both are true answers to the prompt's wording: the
# stored link text is the one setup.sh created, or the entry resolves to the same
# file that text names. That admits a correctly written relative target while
# still rejecting a link pointing somewhere else.
arch_conf=$ARCHIVE/collector.conf
if ! sudo test -L "$arch_conf"; then
  if sudo test -e "$arch_conf"; then
    ck_fail archive-symlink "$ARCHIVE/collector.conf is still a symbolic link to the same path" \
      "it exists and is not a symbolic link, so the copy dereferenced it and stored a duplicate of $WANT_CONF instead of the pointer to it"
  else
    ck_fail archive-symlink "$ARCHIVE/collector.conf is still a symbolic link to the same path" \
      "nothing exists at $arch_conf; the entry beside the captures has to come across too"
  fi
else
  arch_conf_text=$(sudo readlink "$arch_conf" 2>/dev/null)
  arch_conf_ident=$(sudo stat -Lc '%d:%i' "$arch_conf" 2>/dev/null)
  live_conf_ident=$(sudo stat -Lc '%d:%i' "$WANT_CONF" 2>/dev/null)
  if [[ $arch_conf_text == "$WANT_CONF" ]] ||
     [[ -n $arch_conf_ident && -n $live_conf_ident && $arch_conf_ident == "$live_conf_ident" ]]; then
    ck_pass archive-symlink "$ARCHIVE/collector.conf is still a symbolic link to the same path"
  else
    ck_fail archive-symlink "$ARCHIVE/collector.conf is still a symbolic link to the same path" \
      "it points at '$arch_conf_text', which is neither $WANT_CONF nor anything that resolves to the same file"
  fi
fi

# --- 9. the invariant: the captures themselves were left alone -----------
# An answer that reaches the required end state by damaging what it was copying is
# not an answer. This one passes at the unsolved baseline, so the header at the
# top of this file leaves it out - and it is genuinely probed rather than declared
# unprobed: antisolutions/06 reads "archive it" as "move it", which is the
# misreading this exists to catch.
orig_bad=''
check_original() {
  local name=$1 want_mtime=$2 mark=$3
  local p=$LIVE/$name got
  if sudo test -L "$p" || ! sudo test -f "$p"; then
    orig_bad+="$name is no longer a regular file in $LIVE; "
    return
  fi
  got=$(attrs "$p")
  if [[ $got != "$WANT_UID $WANT_GID $WANT_MODE $want_mtime" ]]; then
    orig_bad+="$name is now '$got' and was '$WANT_UID $WANT_GID $WANT_MODE $want_mtime'; "
  fi
  if ! sudo grep -qsF -- "$mark" "$p"; then
    orig_bad+="$name no longer contains its marker $mark; "
  fi
}

if ! sudo test -d "$LIVE"; then
  orig_bad="$LIVE is not a directory any more; "
else
  check_original probe-2026-02.log "$WANT_M02" "$MARK02"
  check_original probe-2026-03.log "$WANT_M03" "$MARK03"
fi

if [[ -z $orig_bad ]]; then
  ck_pass originals-intact "probe-2026-02.log and probe-2026-03.log are untouched in $LIVE"
else
  ck_fail originals-intact "probe-2026-02.log and probe-2026-03.log are untouched in $LIVE" \
    "${orig_bad:0:300}"
fi

exit 0
