#!/usr/bin/env bash
# Grader for tools/047-archive-and-transfer.
#
# READ-ONLY. Changes nothing on the guest. The exit code is ignored; only the
# JSONL the checkpoint helpers write to stdout is read. content/lib/assert.sh is
# prepended by loadTaskScripts, so those helpers are already in scope - do not
# source it. (Their names are left unspelled in every comment in this file on
# purpose: the id extractor documented in docs/r1-findings.md reads comment text
# as readily as code, so prose that looks like a call invents a checkpoint.)
#
# ---------------------------------------------------------------------------
# The safety rule, observed here as in every other file of this task: the harness
# grades this guest over ssh as `student`, with the key in
# /home/student/.ssh/authorized_keys. Nothing in this file writes, chmods, chowns,
# moves or deletes anything - it stats, lists and greps, and it makes no network
# connection at all. Nothing here restarts or signals sshd, touches firewalld or
# the NIC, or powers anything off. The two paths under /home/student/.ssh are read
# and never repaired.
# ---------------------------------------------------------------------------
#
# The five requirements in the prompt map onto eight checkpoints because three of
# them are compound claims worth separating: an archive that exists but is bzip2,
# an archive that is gzip but is missing half the tree, and a tree that arrived
# with the wrong modes are three different mistakes with three different lessons,
# and one red line covering all of them teaches none of them.
#
# What is deliberately NOT graded, so nobody adds it later thinking it was
# forgotten:
#
#   - Which command built the archive, which command carried it, and which
#     command unpacked it. tar with scp, tar with sftp, a pipe through ssh, or
#     rsync over ssh all reach the same end state and spec 6.5 rule 1 forbids
#     grading the mechanism. The two shipped solutions take two of those routes.
#   - The archive's INTERNAL member prefix. `tar -czf x -C /srv reports` stores
#     `reports/ledger.csv`; `tar -czf x -C /srv/reports .` stores `./ledger.csv`.
#     Both are correct archives of the same tree, and the extraction has to be
#     spelled differently for each. What is graded is that the tree ends up at
#     /home/backupop/reports, which is the requirement the prompt actually states.
#   - Whether gzip was invoked at compression level 9, or through tar's `-z`, or
#     as a separate process in a pipe. The requirement is the format, and the
#     format is read out of the bytes.
#   - The GROUP of the unpacked files. A student who extracts as backupop gets
#     backupop's primary group for free and one who does not is caught by the
#     ownership checkpoint anyway; grading the group as well would fail an answer
#     that used a shared secondary group deliberately.
#   - Whether the archive is still there afterwards, or was tidied away once
#     unpacked. The prompt requires it to be at that path, so it is graded there -
#     but nothing requires the student to keep or delete anything else.
#   - Anything about student's own ~/.ssh beyond "it still works". See section 10.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: archive-present, archive-is-gzip, archive-holds-tree, unpacked-tree-present, unpacked-mode-preserved, unpacked-mtime-preserved, unpacked-owned-by-backupop, transfer-over-ssh
#
# One invariant is emitted here and knowingly not probed by any fixture in this
# task; the reasoning is at the checkpoint itself, in section 10.
# unprobed-invariant: student-channel-intact
set -uo pipefail

# --- constants, spelled identically in setup.sh ---------------------------
# If these two files ever disagree the task becomes unsatisfiable for every
# answer, so they are grouped, named the same, and worth diffing when something
# looks impossible.
BACKUP_USER=backupop
BACKUP_HOME=/home/backupop
ARCHIVE=/home/backupop/reports.tar.gz
UNPACKED=/home/backupop/reports

SRC_TREE=/srv/reports
STUDENT_USER=student
STUDENT_SSH_DIR=/home/student/.ssh
STUDENT_AK=/home/student/.ssh/authorized_keys
MARK=/var/lib/rhcsa-047-baseline-epoch

README_REL=README.txt
README_MODE=644
README_MTIME=1744976550
LEDGER_REL=ledger.csv
LEDGER_MODE=660
LEDGER_MTIME=1739006100
SCRIPT_REL=rotate-reports.sh
SCRIPT_MODE=2750
SCRIPT_MTIME=1750996800
DAILY_REL=daily
DAILY_MODE=750
LOG_A_REL=daily/2026-08-31.log
LOG_B_REL=daily/2026-09-01.log

README_MARK='rhcsa-047 reporting tree'
LEDGER_MARK='2026-09-01,north,4310'

# Every measurement below is taken through sudo. /home/backupop is mode 0700 and
# owned by backupop - that is a requirement of the task, not an obstacle to it -
# so student cannot stat anything inside it directly. Reading is all this grader
# does with that privilege.

# --- fail closed ----------------------------------------------------------
# bash treats a missing tool's empty output as an empty string, and several of the
# comparisons below would then read as "the same" rather than as "unmeasurable".
# A grader that cannot measure must say so on every checkpoint it cannot answer,
# because the alternative is telling a student they got it right.
missing=
for tool in tar gzip stat od find awk journalctl grep sudo timeout cut tr cat head; do
  command -v "$tool" >/dev/null || missing="${missing:+$missing }$tool"
done
if [[ -n $missing ]]; then
  detail="grader cannot measure anything: missing tool(s): $missing"
  ck_fail archive-present "an archive file exists at $ARCHIVE" "$detail"
  ck_fail archive-is-gzip "$ARCHIVE is gzip-compressed" "$detail"
  ck_fail archive-holds-tree "the archive contains the whole /srv/reports tree" "$detail"
  ck_fail unpacked-tree-present "the tree is unpacked at $UNPACKED" "$detail"
  ck_fail unpacked-mode-preserved "the unpacked files carry the original permission bits" "$detail"
  ck_fail unpacked-mtime-preserved "the unpacked files carry the original modification times" "$detail"
  ck_fail unpacked-owned-by-backupop "everything under $UNPACKED belongs to $BACKUP_USER" "$detail"
  ck_fail transfer-over-ssh "the archive reached $BACKUP_USER over SSH" "$detail"
  ck_fail source-tree-intact "$SRC_TREE is untouched: same files, same modes, same times" "$detail"
  ck_fail student-channel-intact "student's own SSH access is untouched" "$detail"
  exit 0
fi

# --- helpers --------------------------------------------------------------
# `stat` through sudo, with the failure made visible rather than empty. Callers
# compare against a literal, and an unreadable path must not compare equal to
# anything - hence the sentinel.
sstat() { # sstat FORMAT PATH
  local out
  out=$(sudo stat -c "$1" -- "$2" 2>/dev/null) || { printf 'unreadable'; return 1; }
  [[ -n $out ]] || { printf 'unreadable'; return 1; }
  printf '%s' "$out"
}

# Does the listing hold this member, whatever prefix the archive used? See the
# "not graded" note above: `reports/ledger.csv`, `./reports/ledger.csv` and
# `ledger.csv` are all the same file in three correct archives.
#
# awk reading a here-string, not a pipe from tar: awk reads to EOF, so there is no
# producer left for SIGPIPE to kill, which is the false-verdict trap documented at
# the top of content/lib/assert.sh. A `tar -tf ... | grep -q` here would report a
# perfectly good archive as broken as soon as the member it wanted appeared early
# in a long listing.
listing_has() { # listing_has LISTING WANTED_RELATIVE_PATH
  awk -v want="$2" '
    {
      p = $0
      sub(/\/+$/, "", p)          # tar lists directories with a trailing slash
      sub(/^\.\//, "", p)         # and members from a "-C dir ." archive as ./x
      if (p == want) { found = 1; exit }
      n = length(p) - length(want)
      if (n >= 1 && substr(p, n) == "/" want) { found = 1; exit }
    }
    END { exit(found ? 0 : 1) }
  ' <<<"$1"
}

# --- 1. the archive exists at the path the prompt names -------------------
# A regular file, not a directory and not a symlink. A symlink would be graded as
# whatever it points at by every later check, which is how an "archive" that is
# really a link to a file in /tmp passes a naive grader; and `sudo test -f`
# follows one, so the type comes from `stat` instead. (`%F` on a symlink reports
# `symbolic link`, because `stat` does not follow by default.)
arch_type=$(sstat '%F' "$ARCHIVE") || arch_type=unreadable
arch_size=$(sstat '%s' "$ARCHIVE") || arch_size=
archive_ok=no

if [[ $arch_type == 'regular file' ]] && [[ ${arch_size:-0} =~ ^[0-9]+$ ]] && (( arch_size > 0 )); then
  archive_ok=yes
  ck_pass archive-present "an archive file exists at $ARCHIVE" \
    "$arch_size bytes"
elif [[ $arch_type == unreadable ]]; then
  ck_fail archive-present "an archive file exists at $ARCHIVE" \
    "nothing exists at $ARCHIVE (or it is inside a directory even root's stat could not reach)"
elif [[ $arch_type == 'symbolic link' ]]; then
  ck_fail archive-present "an archive file exists at $ARCHIVE" \
    "$ARCHIVE is a symbolic link, not the archive itself; the operator's copy has to be a file in the operator's home directory, not a pointer at one somewhere else"
elif [[ $arch_type != 'regular file' ]]; then
  ck_fail archive-present "an archive file exists at $ARCHIVE" \
    "$ARCHIVE is a $arch_type, not a regular file"
else
  ck_fail archive-present "an archive file exists at $ARCHIVE" \
    "$ARCHIVE exists but is empty"
fi

# --- 2. it is gzip, and that is read out of the bytes --------------------
# Never from the filename. The name is fixed by the prompt, so a candidate who
# reached for the wrong compressor still produces a file called reports.tar.gz -
# and that is precisely the mistake this checkpoint exists to catch. Two
# independent readings, both measured on this guest's own tools:
#
#   the magic number. gzip members start 1f 8b (RFC 1952 section 2.3.1, and
#     measured); bzip2 starts 42 5a 68 39 ("BZh9"); xz starts fd 37 7a 58 5a 00;
#     an uncompressed tar has ustar at offset 257 and nothing recognisable at 0.
#   gzip's own verdict. Measured on gzip 1.12: `gzip -t` exits 0 on a valid
#     member, 1 on a truncated one ("unexpected end of file") and 1 on a payload
#     that is not gzip at all ("not in gzip format"). That second case is the one
#     the magic number alone cannot see - a transfer that was interrupted leaves
#     a file with a perfect gzip header and no tail.
#
# Both must agree. Together they say "this is a complete gzip stream", which is
# the requirement.
if [[ $archive_ok != yes ]]; then
  ck_fail archive-is-gzip "$ARCHIVE is gzip-compressed" \
    "there is no archive at $ARCHIVE to read"
else
  magic=$(timeout 20 sudo od -An -tx1 -N4 -- "$ARCHIVE" 2>/dev/null | tr -s ' \n' ' ')
  gzip_rc=0
  gzip_says=$(timeout 45 sudo gzip -t -- "$ARCHIVE" 2>&1 < /dev/null) || gzip_rc=$?

  # Named formats first, so the failure detail can say what the file actually is
  # rather than only what it is not.
  actual=
  case ${magic# } in
    '1f 8b'*)       actual=gzip ;;
    '42 5a 68'*)    actual=bzip2 ;;
    'fd 37 7a 58'*) actual=xz ;;
    '04 22 4d 18'*) actual=lz4 ;;
    '28 b5 2f fd'*) actual=zstd ;;
    '50 4b 03 04'*) actual='a ZIP archive' ;;
    '')             actual= ;;
    *)              actual='not a compressed stream (an uncompressed tar, most likely)' ;;
  esac

  if [[ $actual == gzip ]] && (( gzip_rc == 0 )); then
    ck_pass archive-is-gzip "$ARCHIVE is gzip-compressed"
  elif [[ $actual == gzip ]]; then
    ck_fail archive-is-gzip "$ARCHIVE is gzip-compressed" \
      "the file starts with the gzip magic number but gzip cannot read it through to the end (it said: ${gzip_says:-nothing}). A truncated archive usually means the transfer did not finish; check the size against the file you sent"
  elif [[ -z $actual ]]; then
    ck_fail archive-is-gzip "$ARCHIVE is gzip-compressed" \
      "could not read the first bytes of $ARCHIVE to identify its format"
  else
    ck_fail archive-is-gzip "$ARCHIVE is gzip-compressed" \
      "$ARCHIVE is $actual, not gzip. The required name ends .tar.gz and the file has to match it - the extension is a promise about the bytes, and nothing checks it for you at the time you make it"
  fi
fi

# --- 3. the archive holds the whole tree ---------------------------------
# Listed, not extracted: this grader changes nothing, and a listing answers the
# question. `-t` with no compression letter on purpose - GNU tar identifies the
# payload from its magic number, so this reads a gzip, bzip2 or uncompressed
# archive equally well. Measured on tar 1.34: `tar -tf` lists a bzip2 archive
# named .tar.gz without complaint, while `tar -tzf` on the same file exits 2 with
# "gzip: stdin: not in gzip format". So this checkpoint answers "is the tree in
# there" independently of section 2's "is it the right format", and a candidate
# who used the wrong compressor gets one red line rather than two.
if [[ $archive_ok != yes ]]; then
  ck_fail archive-holds-tree "the archive contains the whole /srv/reports tree" \
    "there is no archive at $ARCHIVE to list"
else
  list_rc=0
  listing=$(timeout 60 sudo tar -tf "$ARCHIVE" 2>/dev/null < /dev/null) || list_rc=$?
  if (( list_rc != 0 )) || [[ -z $listing ]]; then
    ck_fail archive-holds-tree "the archive contains the whole /srv/reports tree" \
      "tar cannot list $ARCHIVE (it exited $list_rc). Whatever is in that file, it is not an archive tar can read"
  else
    absent=
    for rel in "$README_REL" "$LEDGER_REL" "$SCRIPT_REL" "$LOG_A_REL" "$LOG_B_REL"; do
      listing_has "$listing" "$rel" || absent="${absent:+$absent }$rel"
    done
    if [[ -z $absent ]]; then
      members=$(awk 'END { print NR }' <<<"$listing")
      ck_pass archive-holds-tree "the archive contains the whole /srv/reports tree" \
        "$members members listed"
    else
      ck_fail archive-holds-tree "the archive contains the whole /srv/reports tree" \
        "the archive does not contain: $absent. An archive of a directory has to be given the directory - a list of the files at its top level leaves the subdirectory behind"
    fi
  fi
fi

# --- 4. the tree is unpacked where the prompt says ------------------------
# Contents, not just names: five files that exist and are empty would satisfy any
# check that only looked at the paths, and an extraction into the wrong directory
# followed by a hand-made stand-in is a real way to arrive there. Two of the five
# are read back for a string setup.sh wrote.
unp_type=$(sstat '%F' "$UNPACKED") || unp_type=unreadable
unpacked_ok=no

if [[ $unp_type != directory ]]; then
  case $unp_type in
    unreadable) why="nothing exists at $UNPACKED" ;;
    'symbolic link') why="$UNPACKED is a symbolic link, not the unpacked tree" ;;
    *) why="$UNPACKED is a $unp_type, not a directory" ;;
  esac
  ck_fail unpacked-tree-present "the tree is unpacked at $UNPACKED" \
    "$why. Where the tree lands depends on the directory the extraction runs in and on the paths stored inside the archive; extracting the archive is not the same as extracting it into the right place"
else
  gone=
  for rel in "$README_REL" "$LEDGER_REL" "$SCRIPT_REL" "$LOG_A_REL" "$LOG_B_REL"; do
    [[ $(sstat '%F' "$UNPACKED/$rel") == 'regular file' ]] || gone="${gone:+$gone }$rel"
  done
  [[ $(sstat '%F' "$UNPACKED/$DAILY_REL") == directory ]] || gone="${gone:+$gone }$DAILY_REL/"

  if [[ -n $gone ]]; then
    ck_fail unpacked-tree-present "the tree is unpacked at $UNPACKED" \
      "$UNPACKED exists but these are missing or are the wrong kind of thing: $gone"
  elif ! timeout 20 sudo grep -qF -- "$README_MARK" "$UNPACKED/$README_REL" 2>/dev/null; then
    ck_fail unpacked-tree-present "the tree is unpacked at $UNPACKED" \
      "$UNPACKED/$README_REL does not contain the text it has in $SRC_TREE; the files at $UNPACKED are not the ones that were handed over"
  elif ! timeout 20 sudo grep -qF -- "$LEDGER_MARK" "$UNPACKED/$LEDGER_REL" 2>/dev/null; then
    ck_fail unpacked-tree-present "the tree is unpacked at $UNPACKED" \
      "$UNPACKED/$LEDGER_REL does not contain the data it has in $SRC_TREE; the files at $UNPACKED are not the ones that were handed over"
  else
    unpacked_ok=yes
    ck_pass unpacked-tree-present "the tree is unpacked at $UNPACKED"
  fi
fi

# --- 5. the permission bits survived the round trip ----------------------
# The checkpoint this task is really about, and the only one whose failure is
# invisible in `ls -l` unless you have the source next to you.
#
# Compared against the LITERALS at the top of this file rather than against the
# live source tree, and that is deliberate: a grader that compared the two
# directories would accept an answer that "fixed" a bad extraction by chmod-ing
# /srv/reports down to match it, which is the one thing the prompt asks the
# student not to do. Both sides are compared against the same constants, which is
# also what makes section 9 a real invariant instead of a tautology.
#
# Two files, chosen because they fail for different reasons - measured on
# tar 1.34, extracting as an ordinary user:
#
#   ledger.csv 0660 -> 0640 without -p, because the extraction applies the
#     process umask, and an ssh session on RHEL 9 has umask 022 (login.defs
#     UMASK 022 via pam_umask in /etc/pam.d/postlogin; the shipped /etc/profile
#     sets no umask at all).
#   rotate-reports.sh 2750 -> 0750 without -p under umask 000, 002 and 022
#     alike. The setgid bit is not a umask matter: it is dropped unless
#     permissions are asked for explicitly. So this half of the checkpoint cannot
#     be passed by accident on a guest whose default umask happens to be loose,
#     which is exactly why it is here and not just the group-writable file.
#
# README.txt 0644 is checked too, in the other direction: it is what stops a
# blanket `chmod -R 660` from turning a wrong answer into a right one.
if [[ $unpacked_ok != yes ]]; then
  ck_fail unpacked-mode-preserved "the unpacked files carry the original permission bits" \
    "there is no unpacked tree at $UNPACKED to measure"
else
  m_readme=$(sstat '%a' "$UNPACKED/$README_REL")
  m_ledger=$(sstat '%a' "$UNPACKED/$LEDGER_REL")
  m_script=$(sstat '%a' "$UNPACKED/$SCRIPT_REL")
  m_daily=$(sstat '%a' "$UNPACKED/$DAILY_REL")

  wrong=
  [[ $m_readme == "$README_MODE" ]] || wrong="${wrong:+$wrong; }$README_REL is $m_readme, should be $README_MODE"
  [[ $m_ledger == "$LEDGER_MODE" ]] || wrong="${wrong:+$wrong; }$LEDGER_REL is $m_ledger, should be $LEDGER_MODE"
  [[ $m_script == "$SCRIPT_MODE" ]] || wrong="${wrong:+$wrong; }$SCRIPT_REL is $m_script, should be $SCRIPT_MODE"
  [[ $m_daily == "$DAILY_MODE" ]] || wrong="${wrong:+$wrong; }$DAILY_REL/ is $m_daily, should be $DAILY_MODE"

  if [[ -z $wrong ]]; then
    ck_pass unpacked-mode-preserved "the unpacked files carry the original permission bits"
  else
    ck_fail unpacked-mode-preserved "the unpacked files carry the original permission bits" \
      "$wrong. An extraction that is not told to preserve permissions applies your umask instead, and drops the setgid bit whatever the umask is; a copy tool that preserves modes has to be told to as well. Fix the extraction, not the source"
  fi
fi

# --- 6. and so did the modification times -------------------------------
# A separate checkpoint from the modes because the two are lost by different
# mistakes. `tar` restores mtimes by default and needs no flag for it; a plain
# recursive copy stamps every file with the time the copy ran. So a red mtime
# line next to a green mode line points at the transport, and the reverse points
# at the extraction. `stat -c %Y` is whole seconds, and setup.sh set these from
# UNIX epochs with a zero nanosecond part (measured), so there is nothing here for
# an archive format to round.
if [[ $unpacked_ok != yes ]]; then
  ck_fail unpacked-mtime-preserved "the unpacked files carry the original modification times" \
    "there is no unpacked tree at $UNPACKED to measure"
else
  t_readme=$(sstat '%Y' "$UNPACKED/$README_REL")
  t_ledger=$(sstat '%Y' "$UNPACKED/$LEDGER_REL")
  t_script=$(sstat '%Y' "$UNPACKED/$SCRIPT_REL")

  wrong=
  [[ $t_readme == "$README_MTIME" ]] || wrong="${wrong:+$wrong; }$README_REL is $t_readme, should be $README_MTIME"
  [[ $t_ledger == "$LEDGER_MTIME" ]] || wrong="${wrong:+$wrong; }$LEDGER_REL is $t_ledger, should be $LEDGER_MTIME"
  [[ $t_script == "$SCRIPT_MTIME" ]] || wrong="${wrong:+$wrong; }$SCRIPT_REL is $t_script, should be $SCRIPT_MTIME"

  if [[ -z $wrong ]]; then
    ck_pass unpacked-mtime-preserved "the unpacked files carry the original modification times"
  else
    ck_fail unpacked-mtime-preserved "the unpacked files carry the original modification times" \
      "$wrong (UNIX epoch seconds; 'stat -c %y' prints them readably). Files stamped with the time you ran the command were copied, not unpacked from an archive that carried their timestamps"
  fi
fi

# --- 7. the operator owns its own copy ----------------------------------
# The requirement is stated as ownership rather than as "do not use sudo", but in
# practice it is the same check, and it is here because `sudo tar -xpzf` is the
# reflex this task most reliably provokes: root can write into a 0700 directory
# it does not own, the extraction succeeds, every file lands owned by root, and
# backupop cannot manage a single one of them.
#
# `find ! -user` covers the whole tree in one pass, which matters: an answer that
# extracted as root and then chowned the top directory alone leaves everything
# underneath wrong, and a check on $UNPACKED itself would call that correct.
#
# Note what is NOT required: preserving the ORIGINAL owner. Restoring ownership
# from an archive is root's privilege, and the files under /srv/reports belong to
# student - so an unprivileged extraction cannot reproduce that and is not asked
# to. content/concepts/files/copy-preserving-attributes.md documents the same
# thing about `cp -p`, which loses ownership silently for exactly this reason.
if [[ $unpacked_ok != yes ]]; then
  ck_fail unpacked-owned-by-backupop "everything under $UNPACKED belongs to $BACKUP_USER" \
    "there is no unpacked tree at $UNPACKED to measure"
else
  # `-printf` rather than `-print`, so the detail can name the offending owner.
  # Bounded output: a wrong answer has six wrong files, not six thousand, and the
  # head is there so a surprising tree cannot produce a detail nobody can read.
  strays=$(timeout 45 sudo find "$UNPACKED" \! -user "$BACKUP_USER" -printf '%p(%u) ' 2>/dev/null | cut -c1-300)
  find_rc=$?
  own_top=$(sstat '%U' "$UNPACKED")

  if (( find_rc != 0 )); then
    ck_fail unpacked-owned-by-backupop "everything under $UNPACKED belongs to $BACKUP_USER" \
      "could not walk $UNPACKED to check ownership (find exited $find_rc)"
  elif [[ -z ${strays// /} ]] && [[ $own_top == "$BACKUP_USER" ]]; then
    ck_pass unpacked-owned-by-backupop "everything under $UNPACKED belongs to $BACKUP_USER"
  elif [[ $own_top != "$BACKUP_USER" ]]; then
    ck_fail unpacked-owned-by-backupop "everything under $UNPACKED belongs to $BACKUP_USER" \
      "$UNPACKED itself belongs to $own_top, not $BACKUP_USER${strays:+, and so do files inside it: $strays}. An extraction run as root lands owned by root, and the operator cannot manage files it does not own; unpack as the account that is meant to own the result"
  else
    ck_fail unpacked-owned-by-backupop "everything under $UNPACKED belongs to $BACKUP_USER" \
      "these are owned by someone else (owner in brackets): $strays. Chowning the top directory does not reach what is underneath it"
  fi
fi

# --- 8. the archive travelled over SSH ----------------------------------
# The honest account of what this measures, because it is weaker than the other
# seven and should not be read as stronger:
#
# It asks the journal whether sshd accepted an authentication for backupop since
# the baseline was staged. That is EVIDENCE of a transfer, not proof of one: a
# candidate who logs in for any reason and then puts the file in place some other
# way satisfies it. It is graded anyway, for two reasons. The requirement is real -
# "get this to another system" is the objective, and a task that only checked the
# end state would be passed in full by `cp /srv/reports.tar.gz ~backupop/` under
# sudo, which teaches the opposite of the lesson. And there is no better
# observable: scp, sftp, rsync-over-ssh and a tar piped through ssh all leave
# nothing behind but the file and this log line, and refusing to grade the
# transport at all would be a bigger error than grading it loosely.
#
# The lower bound comes from a marker file setup.sh wrote AFTER its own login
# probe, so this cannot be satisfied by setup.sh's own connection. `--since @N`
# takes a UNIX epoch (systemd.time(7), "@" seconds-since-the-epoch form) and is
# inclusive of second N, which is why setup.sh sleeps before writing it.
#
# The message is not a guess. Read out of the shipped
# openssh-server 9.9p1-9.el9_8 /usr/libexec/openssh/sshd-session, whose
# authentication log format string is
# `%s %s%s%s for %s%.100s from %.200s port %d ssh2%s%s`, the leading %s being
# Accepted / Failed / Postponed / Partial. The identifier is not a guess either:
# measured on this build, per-session messages carry
# SYSLOG_IDENTIFIER=sshd-session while the listener's own carry sshd, so both are
# asked for - that also makes this work whether the guest runs sshd.service or a
# socket-activated sshd@.service.
#
# awk to EOF rather than `grep -c`, for the SIGPIPE reason given above.
mark_epoch=$(sudo cat -- "$MARK" 2>/dev/null | tr -dc '0-9')
if [[ -z ${mark_epoch:-} ]]; then
  ck_fail transfer-over-ssh "the archive reached $BACKUP_USER over SSH" \
    "the baseline marker $MARK is missing or unreadable, so there is no start time to search the journal from. That is a broken fixture and not your mistake: setup.sh writes that file, and re-running it fixes this"
else
  jrc=0
  accepted=$(timeout 45 sudo journalctl -t sshd -t sshd-session --since "@$mark_epoch" --no-pager -o cat 2>/dev/null \
    | awk -v u="$BACKUP_USER" '$0 ~ /Accepted/ && $0 ~ (" for " u " from ") { n++ } END { print n + 0 }') || jrc=$?
  if (( jrc != 0 )) || [[ ! ${accepted:-} =~ ^[0-9]+$ ]]; then
    ck_fail transfer-over-ssh "the archive reached $BACKUP_USER over SSH" \
      "could not read the journal to see whether $BACKUP_USER was logged in to (journalctl exited $jrc). That is a broken fixture and not your mistake"
  elif (( accepted > 0 )); then
    ck_pass transfer-over-ssh "the archive reached $BACKUP_USER over SSH" \
      "sshd accepted $accepted login(s) for $BACKUP_USER"
  else
    ck_fail transfer-over-ssh "the archive reached $BACKUP_USER over SSH" \
      "sshd has not accepted a single login for $BACKUP_USER since this task was set up, so nothing was carried to that account over SSH. Copying a file into another account's home directory with root privileges is not a transfer - the requirement is to move it the way you would move it to a different machine, and the private key named in the task is what lets you"
  fi
fi

# --- 9. the source tree was left alone ----------------------------------
# An invariant with teeth. The prompt says copy it, do not move it, and do not fix
# its permissions to match a copy that came out wrong - and both of those are
# things a candidate does on the way to a green board. Same constants as section 5
# and section 6, so "the two trees match" cannot be reached by dragging the source
# down to meet a bad copy.
#
# Ownership is included: an answer that ran the archive step under sudo and then
# chowned things about can leave /srv/reports owned by root, which breaks the task
# for the next person even though the handover itself worked.
src_type=$(sstat '%F' "$SRC_TREE") || src_type=unreadable
if [[ $src_type != directory ]]; then
  ck_fail source-tree-intact "$SRC_TREE is untouched: same files, same modes, same times" \
    "$SRC_TREE is ${src_type/unreadable/gone}. The reporting data was to be copied, not moved: whatever was handed to the operator, the original was still supposed to be here"
else
  bad=
  for rel in "$README_REL" "$LEDGER_REL" "$SCRIPT_REL" "$LOG_A_REL" "$LOG_B_REL"; do
    [[ $(sstat '%F' "$SRC_TREE/$rel") == 'regular file' ]] || bad="${bad:+$bad; }$rel is missing"
  done
  [[ $(sstat '%F' "$SRC_TREE/$DAILY_REL") == directory ]] || bad="${bad:+$bad; }$DAILY_REL/ is missing"

  if [[ -z $bad ]]; then
    s_readme=$(sstat '%a' "$SRC_TREE/$README_REL")
    s_ledger=$(sstat '%a' "$SRC_TREE/$LEDGER_REL")
    s_script=$(sstat '%a' "$SRC_TREE/$SCRIPT_REL")
    s_daily=$(sstat '%a' "$SRC_TREE/$DAILY_REL")
    [[ $s_readme == "$README_MODE" ]] || bad="${bad:+$bad; }$README_REL is now mode $s_readme, was $README_MODE"
    [[ $s_ledger == "$LEDGER_MODE" ]] || bad="${bad:+$bad; }$LEDGER_REL is now mode $s_ledger, was $LEDGER_MODE"
    [[ $s_script == "$SCRIPT_MODE" ]] || bad="${bad:+$bad; }$SCRIPT_REL is now mode $s_script, was $SCRIPT_MODE"
    [[ $s_daily == "$DAILY_MODE" ]] || bad="${bad:+$bad; }$DAILY_REL/ is now mode $s_daily, was $DAILY_MODE"

    st_ledger=$(sstat '%Y' "$SRC_TREE/$LEDGER_REL")
    st_script=$(sstat '%Y' "$SRC_TREE/$SCRIPT_REL")
    [[ $st_ledger == "$LEDGER_MTIME" ]] || bad="${bad:+$bad; }$LEDGER_REL's timestamp changed ($st_ledger, was $LEDGER_MTIME)"
    [[ $st_script == "$SCRIPT_MTIME" ]] || bad="${bad:+$bad; }$SCRIPT_REL's timestamp changed ($st_script, was $SCRIPT_MTIME)"

    # rc checked, not just the output: an empty result from a walk that never ran
    # is indistinguishable from "nothing is wrong", and a checkpoint that reads a
    # broken measurement as a pass is the one failure mode this whole file is
    # arranged to avoid. Section 7 does the same for the same reason.
    src_strays=$(timeout 45 sudo find "$SRC_TREE" \! -user "$STUDENT_USER" -printf '%p(%u) ' 2>/dev/null | cut -c1-200)
    src_find_rc=$?
    if (( src_find_rc != 0 )); then
      bad="${bad:+$bad; }could not walk $SRC_TREE to check ownership (find exited $src_find_rc)"
    else
      [[ -z ${src_strays// /} ]] || bad="${bad:+$bad; }no longer owned by $STUDENT_USER: $src_strays"
    fi
  fi

  if [[ -z $bad ]]; then
    ck_pass source-tree-intact "$SRC_TREE is untouched: same files, same modes, same times"
  else
    ck_fail source-tree-intact "$SRC_TREE is untouched: same files, same modes, same times" \
      "$bad. The handover was a copy: the original tree, its permissions and its timestamps were all to be left exactly as they were. If the operator's copy came out wrong, the extraction is what needs changing"
  fi
fi

# --- 10. student's own way in still works -------------------------------
# The invariant that protects the exercise rather than the answer, and the reason
# it is knowingly unprobed: no fixture in this task breaks it on purpose, because
# a fixture that did would take the harness's own access down with it and there
# would be no verdict to read - the failure mode README.md describes for
# storage/014's 02-removed-persistence.sh, where the checkpoints could not be
# collected at all. So it is emitted, declared unprobed, and left as a tripwire.
#
# It is here because this task hands the student a private key and a second
# account, which is one short step from "tidy up ~/.ssh". Every check is the
# minimum sshd itself requires, and nothing stricter: the directory exists, is
# student's, and is not writable by group or other (StrictModes is on by default
# and refuses an authorized_keys file underneath a directory that is), and the
# file is student's and not empty. What the key IS, how many there are, and
# anything the student added of their own are all their business.
sdir_type=$(sstat '%F' "$STUDENT_SSH_DIR") || sdir_type=unreadable
if [[ $sdir_type != directory ]]; then
  ck_fail student-channel-intact "student's own SSH access is untouched" \
    "$STUDENT_SSH_DIR is ${sdir_type/unreadable/gone}; the key this machine is graded through lives in it"
else
  sdir_owner=$(sstat '%U' "$STUDENT_SSH_DIR")
  sdir_mode=$(sstat '%a' "$STUDENT_SSH_DIR")
  ak_owner=$(sstat '%U' "$STUDENT_AK")
  ak_size=$(sstat '%s' "$STUDENT_AK")

  bad=
  [[ $sdir_owner == "$STUDENT_USER" ]] || bad="${bad:+$bad; }$STUDENT_SSH_DIR now belongs to $sdir_owner"
  if [[ $sdir_mode =~ ^[0-7]+$ ]]; then
    (( 8#$sdir_mode & 022 )) && bad="${bad:+$bad; }$STUDENT_SSH_DIR is mode $sdir_mode, writable by group or other, which StrictModes refuses"
  else
    bad="${bad:+$bad; }$STUDENT_SSH_DIR's mode could not be read"
  fi
  [[ $ak_owner == "$STUDENT_USER" ]] || bad="${bad:+$bad; }$STUDENT_AK now belongs to ${ak_owner/unreadable/nobody - it is gone}"
  [[ ${ak_size:-0} =~ ^[0-9]+$ ]] && (( ak_size > 0 )) || bad="${bad:+$bad; }$STUDENT_AK is empty or missing"

  if [[ -z $bad ]]; then
    ck_pass student-channel-intact "student's own SSH access is untouched"
  else
    ck_fail student-channel-intact "student's own SSH access is untouched" \
      "$bad. Nothing this task asks for is inside student's ~/.ssh - the key for the operator account is at /home/student/backup-key. This is how the lab reaches this machine, so repair it before doing anything else"
  fi
fi

exit 0
