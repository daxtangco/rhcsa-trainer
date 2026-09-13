#!/usr/bin/env bash
# Grader for storage/043-nfs-and-autofs.
#
# The exit code is ignored; only the JSONL on stdout is read. content/lib/assert.sh
# is prepended by loadTaskScripts, so its helpers are already in scope - do not
# source it. Their names are left unspelled in the prose of this file on purpose:
# the id extractor documented in docs/r1-findings.md reads comment text as readily
# as code, so a sentence that looks like a call invents a checkpoint.
#
# ---------------------------------------------------------------------------
# THE ONE PLACE THIS GRADER IS NOT READ-ONLY, and why it cannot be.
#
# Every other grader in this bank changes nothing. This one reads
# /nfsdata/archive before it measures the two archive checkpoints, and reading
# that path is what makes the automounter mount it. That is not a side effect to
# be apologised for; it is the only observation that exists. An automount that
# nothing has touched is *supposed* to be absent - that is the whole feature -
# so a grader that refused to touch it could only ever report "not mounted",
# which is exactly what a correct answer looks like from the outside.
#
# The change is bounded and reversible by design: the automounter unmounts it
# again after its idle timeout, and the state it leaves behind is the state a
# working configuration is meant to produce. Nothing else here writes anything.
#
# One consequence worth knowing, because it decides what this file does NOT
# grade: "it was not mounted before I looked" is unmeasurable. After a verdict-A
# grade run the archive is mounted for as long as the idle timeout lasts, and
# the student's own testing mounts it too. A checkpoint asserting absence would
# be a coin toss. archive-via-autofs below is the stable substitute: the
# automounter's own control mount is present whether or not the share is.
#
# ---------------------------------------------------------------------------
# WHY THE MOUNT PROBES LOOK LIKE THIS.
#
# `findmnt --mountpoint P` and never `--target P`. --target walks UP to the
# nearest ancestor mount, so for a path nobody mounted it answers "/", and a
# checkpoint written on it reads as a pass for a student who did nothing. That
# also rules out the library's own mount_source helper here, which is --target.
#
# Every probe scans ALL rows at the mount point, because these mounts stack: a
# direct autofs map puts its control mount and the NFS mount it triggers on the
# same path, and both appear.
#
# The export path is taken as the text after the LAST colon of the source, so
# nfsstore.lab.example.com:/export/reports, 127.0.0.1:/export/reports and
# [::1]:/export/reports are all read as /export/reports. Deliberate: the prompt
# names a host name, but the requirement is that the right export is mounted at
# the right place, and a student who reached the same server by its address has
# done the task. Identity is proved by reading a file that only that export
# contains, not by string-matching a host name.
#
# The AUTOMOUNTED path is read by served_path_at instead of nfs_export_at, which
# also accepts a bind mount, because RHEL 9's autofs bind-mounts an export whose
# server is this machine rather than speaking NFS to itself. That function is
# where the evidence for that lives; it is the one difference between how the two
# mounts in this task are measured, and it is load-bearing.
#
# No df and no stat anywhere. Both walk into the filesystem itself and both hang
# uninterruptibly on a hard NFS mount whose server has gone away.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: reports-mounted, reports-persistent, oldshare-released, autofs-enabled, archive-via-autofs, archive-automounted
set -uo pipefail

# Spelled identically in setup.sh. If these ever disagree the task becomes
# unsatisfiable for every answer.
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

# FSTYPE and SOURCE for every mount whose mount point is exactly $1.
mp_rows() { findmnt -rno FSTYPE,SOURCE --mountpoint "$1" 2>/dev/null; }

# The export path of the first NFS mount at $1, empty if there is no NFS mount
# there. `nfs` and `nfs4` are both accepted: which one findmnt reports depends on
# how the mount was requested, and the protocol version was never the question.
nfs_export_at() {
  local fstype src path
  while read -r fstype src; do
    case $fstype in
      nfs | nfs4)
        path=${src##*:}
        # A trailing slash is the same export. `mount server:/export/reports/`
        # is a perfectly ordinary way to type it - tab completion adds the slash -
        # and a comparison that rejected it would fail a correct answer over a
        # keystroke.
        while [[ ${#path} -gt 1 && $path == */ ]]; do
          path=${path%/}
        done
        printf '%s\n' "$path"
        return 0
        ;;
    esac
  done < <(mp_rows "$1")
  return 1
}

# The server-side directory that the mount at $1 is showing, empty if nothing at
# $1 is showing one. Used for the AUTOMOUNTED path only; $CLIENT_REPORTS keeps
# using nfs_export_at above and stays NFS-only.
#
# Two shapes are accepted, and the second one is not a loophole - it is what
# RHEL 9's autofs actually does on this guest, and a checkpoint that demanded an
# `nfs` row here would fail both shipped solutions:
#
#   nfs / nfs4  SOURCE is `host:/export/archive`; the path is after the last colon.
#   a bind      SOURCE is `DEVICE[/export/archive]`; the path is in the brackets.
#
# Why a bind. From man 5 auto.master, on the `nobind` pseudo-option: it exists
# "to prevent bind mounting of local NFS filesystems". The automounter measures
# the proximity of every server named in a map entry, and when that server turns
# out to be this machine it bind-mounts the exported directory rather than going
# out over the wire - /usr/lib64/autofs/mount_nfs.so carries the message "is
# local, attempt bind mount" for exactly that path, and mount_nfs4.so carries it
# too, so `-fstype=nfs4` behaves the same way. This host stands in for the file
# server (setup.sh explains why), so nfsstore.lab.example.com IS 127.0.0.1, so
# every correct autofs answer on this guest ends in a bind mount. `mount -t nfs`
# and an fstab line are unaffected - mount.nfs has no such shortcut - which is
# why only this half of the task needs it.
#
# Nothing is conceded by accepting it, because this checkpoint has never been the
# one that proves an automounter is involved - archive-via-autofs is, and it is
# measured separately and unchanged. To get an autofs filesystem onto $AUTOFS_BASE
# or $AUTOFS_PATH you have to have written a master map entry and a map file that
# agree, which is the task; and having written them, the only way a bind mount
# appears under an INDIRECT map is that the automounter made it (the path lives
# inside the autofs filesystem, so there is nothing there to mount onto by hand).
# On top of that the directory shown still has to be the export the prompt named,
# and the marker file still has to read back through whatever was mounted.
#
# The bracketed path is compared for equality, which assumes /export is not
# itself a separate mount point - if it were, the brackets would hold /archive.
# setup.sh asserts that rather than leaving it to be discovered here.
served_path_at() {
  local fstype src path
  while read -r fstype src; do
    case $fstype in
      nfs | nfs4)
        path=${src##*:}
        ;;
      autofs)
        # The automounter's own control mount. It is stacked on the same path as
        # a direct map's real mount, and its SOURCE is the map file name.
        continue
        ;;
      *)
        # A bind mount, and only a bind mount: findmnt renders the subdirectory
        # the mount was taken from in trailing brackets, and a mount of a whole
        # filesystem has none.
        case $src in
          *\[*\]) path=${src##*\[}; path=${path%\]} ;;
          *) continue ;;
        esac
        ;;
    esac
    # A trailing slash is the same directory, for the reason spelled out in
    # nfs_export_at above.
    while [[ ${#path} -gt 1 && $path == */ ]]; do
      path=${path%/}
    done
    printf '%s\n' "$path"
    return 0
  done < <(mp_rows "$1")
  return 1
}

# Contents of a file, or the error text, without ever blocking forever on a
# healthy-looking mount whose server has stopped answering. Read into a variable
# and matched with a case statement rather than piped into grep, because a
# producer feeding `grep -q` dies of SIGPIPE and pipefail reports the successful
# search as a failure - the trap content/lib/assert.sh documents at length.
read_file() { timeout 15 cat "$1" 2>&1; }

# --- is the stand-in server even up? --------------------------------------
# Measured first and used as a guard, not just reported. A hard NFS mount whose
# server has died blocks any process that touches it in a state no signal can
# interrupt, which means the timeout above would not save this grader from
# hanging the whole run. So if the server is down nothing below reads through a
# mount at all: the checkpoints fail, and they say why.
# WAITED FOR, not merely sampled, and the reason is verdict B specifically.
#
# The harness's reboot() returns as soon as `waitForGuest` can reach the guest,
# and that poll is over ssh (src/engine/vm/vmrun.ts). sshd.service and
# nfs-server.service are both only `WantedBy=multi-user.target` with no ordering
# between them, so "ssh answers" says nothing whatever about whether rpc.nfsd has
# started - and after a reboot this grader is frequently the first thing to ask.
# Sampled once, the old form read `activating` or `inactive` on a machine that was
# two seconds from being fine, set server_up=no, skipped the automount trigger
# below, and failed reports-mounted, archive-automounted and export-intact on a
# CORRECT answer. As an intermittent verdict-B regression, that is the single
# worst failure this task could produce: it accuses a student of a persistence
# mistake they did not make, and only sometimes.
#
# The wait is conditional on the unit being ENABLED, which is what makes it a
# wait rather than a stall. setup.sh enables nfs-server - the export is lab
# infrastructure and never the student's responsibility - so `enabled` means "this
# is coming up, give it a moment", while `disabled` or `masked` means waiting
# could only ever burn the grader's budget. `failed` breaks out immediately for
# the same reason: systemd has already finished trying.
#
# 20 seconds is roughly seven times the start latency measured for this unit
# (nfs-server is Type=oneshot with RemainAfterExit=yes, so `active` means
# rpc.nfsd exited 0 with its listening sockets already set up), and it is chosen
# against the grader's own budget rather than against systemd's 90s unit timeout:
# one ssh exec gets 120 seconds total (src/engine/vm/ssh.ts), the automount
# trigger below can spend 40 of them, and the reads above are bounded at 15 each.
# On verdict A, and on any verdict B where the boot settled first, this loop exits
# on its first poll and costs nothing.
NFS_WAIT_SECS=20
nfs_state=$(systemctl is-active nfs-server 2>/dev/null)
nfs_enabled=$(systemctl is-enabled nfs-server 2>/dev/null)
nfs_waited=0
while [[ $nfs_state != active && ${nfs_enabled:-} == enabled && $nfs_state != failed ]] \
  && ((nfs_waited < NFS_WAIT_SECS)); do
  sleep 1
  nfs_waited=$((nfs_waited + 1))
  nfs_state=$(systemctl is-active nfs-server 2>/dev/null)
done

server_up=no
[[ $nfs_state == active ]] && server_up=yes

# The detail says WHY it stopped waiting, so that a state of `inactive` in a
# report can never be misread as "the grader asked too early". Three reasons, and
# they send a reader to three different places: a timed-out wait means the server
# genuinely did not come up, `failed` means systemd already tried and its journal
# has the reason, and not-enabled means nothing was going to start it at all -
# which on this task points at setup.sh rather than at the guest, since enabling
# nfs-server is setup's job and not the student's.
SERVER_DOWN_STATE=$(printf '%s' "${nfs_state:-unknown}")
if ((nfs_waited > 0)); then
  SERVER_DOWN_WHY="it is still $SERVER_DOWN_STATE after this grader waited ${nfs_waited}s for it to start"
elif [[ $nfs_state == failed ]]; then
  SERVER_DOWN_WHY="it is failed, so systemd has already stopped trying; 'journalctl -u nfs-server' has the reason"
else
  SERVER_DOWN_WHY="it is $SERVER_DOWN_STATE and 'systemctl is-enabled nfs-server' says '${nfs_enabled:-nothing}', so nothing was going to start it and it was not waited for"
fi
SERVER_DOWN_DETAIL="the NFS server on this host is not running: $SERVER_DOWN_WHY. Nothing could be read through any mount; see the export-intact line"

# --- 1. the report share is mounted here now ------------------------------
reports_rows=$(mp_rows "$CLIENT_REPORTS")
reports_export=$(nfs_export_at "$CLIENT_REPORTS" || true)
if [[ -z $reports_rows ]]; then
  ck_fail reports-mounted "$EXPORT_REPORTS from the file server is mounted at $CLIENT_REPORTS" \
    "nothing is mounted at $CLIENT_REPORTS"
elif [[ -z $reports_export ]]; then
  # Something is mounted, but it is not NFS. The bind-mount answer lands here:
  # /export/reports is on this host, so binding it looks identical from the
  # inside and is not the objective.
  ck_fail reports-mounted "$EXPORT_REPORTS from the file server is mounted at $CLIENT_REPORTS" \
    "$CLIENT_REPORTS is mounted, but not over NFS: $(printf '%s' "$reports_rows" | tr '\n' ';')"
elif [[ $reports_export != "$EXPORT_REPORTS" ]]; then
  ck_fail reports-mounted "$EXPORT_REPORTS from the file server is mounted at $CLIENT_REPORTS" \
    "the NFS mount at $CLIENT_REPORTS serves $reports_export, not $EXPORT_REPORTS"
elif [[ $server_up == no ]]; then
  ck_fail reports-mounted "$EXPORT_REPORTS from the file server is mounted at $CLIENT_REPORTS" \
    "$SERVER_DOWN_DETAIL"
else
  # The mount claims to be the right export; now read a file only that export
  # contains, which is what turns "a row in the mount table" into "the share is
  # actually usable".
  seen=$(read_file "$CLIENT_REPORTS/$REPORTS_FILE")
  case $seen in
    *"$REPORTS_MARKER"*)
      ck_pass reports-mounted "$EXPORT_REPORTS from the file server is mounted at $CLIENT_REPORTS"
      ;;
    *)
      ck_fail reports-mounted "$EXPORT_REPORTS from the file server is mounted at $CLIENT_REPORTS" \
        "$CLIENT_REPORTS is an NFS mount of $EXPORT_REPORTS but $REPORTS_FILE did not read back through it: $(printf '%s' "$seen" | tr '\n' ' ' | cut -c1-160)"
      ;;
  esac
fi

# --- 2. ...and it will be there again after a reboot ----------------------
# Mechanism-agnostic on purpose (spec 6.5 rule 1): the library helper accepts an
# fstab entry or a systemd mount unit, and both are correct answers. This is the
# checkpoint that separates "I typed a mount command" from "I configured a
# mount", and in verdict B the mount checkpoint above becomes its witness.
if is_persistent "$CLIENT_REPORTS"; then
  ck_pass reports-persistent "$CLIENT_REPORTS is configured to mount at boot"
else
  ck_fail reports-persistent "$CLIENT_REPORTS is configured to mount at boot" \
    "no entry for $CLIENT_REPORTS in /etc/fstab and no .mount unit under /etc/systemd/system whose Where= names it; a mount that only exists because somebody typed a command is gone at the next boot"
fi

# --- 3. the leftover share is gone, and stays gone ------------------------
# Two halves, because either one alone is a wrong answer that looks right:
# unmounting without removing the configuration comes back at the next boot, and
# removing the configuration without unmounting leaves it mounted right now.
#
# The configuration half reuses the same helper as reports-persistent, so
# `noauto` counts as removed - the entry is documentation at that point, and the
# requirement is that the share does not come back.
old_rows=$(mp_rows "$CLIENT_OLD")
old_persist=no
is_persistent "$CLIENT_OLD" && old_persist=yes
if [[ -n $old_rows ]]; then
  ck_fail oldshare-released "$CLIENT_OLD is neither mounted nor configured to mount at boot" \
    "$CLIENT_OLD is still mounted: $(printf '%s' "$old_rows" | tr '\n' ';')"
elif [[ $old_persist == yes ]]; then
  ck_fail oldshare-released "$CLIENT_OLD is neither mounted nor configured to mount at boot" \
    "$CLIENT_OLD is not mounted now, but it is still configured to mount at boot, so the next reboot brings it back"
else
  ck_pass oldshare-released "$CLIENT_OLD is neither mounted nor configured to mount at boot"
fi

# --- 4. the automounter will be running after a reboot --------------------
# Exact equality with `enabled`, not the exit status of the query: that command
# exits 0 for static, indirect, generated, alias and enabled-runtime as well, and
# a service that is merely running would collect a pass it has not earned. This
# is the half of the autofs answer that is invisible until the machine comes
# back - which is why it is its own checkpoint rather than folded into the two
# below.
autofs_enabled=$(systemctl is-enabled autofs 2>/dev/null)
if [[ $autofs_enabled == enabled ]]; then
  ck_pass autofs-enabled "the autofs service is enabled, so it starts on its own at boot"
else
  ck_fail autofs-enabled "the autofs service is enabled, so it starts on its own at boot" \
    "systemctl is-enabled autofs says '${autofs_enabled:-nothing}'; a service that was started but not enabled is gone after a reboot, and the automounted path goes with it"
fi

# --- trigger the automount ------------------------------------------------
# Bounded: three tries, hard timeout on each, and the loop stops the moment the
# NFS mount appears. The first attempt is usually the only one - the retries are
# for the case where the daemon is still reading its maps, which happens when a
# reboot has just finished and this grader is the first thing to ask for the path.
#
# `ls` on the path, because using the path is the trigger; there is no command
# that asks an automounter to mount something without pretending to want it.
#
# Not attempted at all when the stand-in server is down, for the same reason the
# reads above are not: this is the one line here that walks into a filesystem, and
# a hard NFS mount whose server has gone blocks in a state the timeout cannot
# reach. Skipping it costs nothing - the two checkpoints below still measure the
# mount table, and they still fail.
attempt=0
while [[ $server_up == yes ]] && ((attempt < 3)); do
  attempt=$((attempt + 1))
  timeout 12 ls -A "$AUTOFS_PATH" >/dev/null 2>&1
  [[ -n $(served_path_at "$AUTOFS_PATH" || true) ]] && break
  sleep 2
done

# --- 5. the archive path is under an automounter's control ----------------
# The evidence that the answer is on-demand mounting rather than a second boot
# mount. An autofs filesystem appears on whichever path the master map named:
# $AUTOFS_BASE for an indirect map, $AUTOFS_PATH for a direct one. Both shapes
# are accepted; nothing here cares which file the student wrote.
#
# Matched by exact target, not by grepping the whole list, because RHEL mounts an
# autofs filesystem on /proc/sys/fs/binfmt_misc as well and that one belongs to
# systemd.
autofs_targets=$(findmnt -rno TARGET -t autofs 2>/dev/null \
  | awk -v b="$AUTOFS_BASE" -v p="$AUTOFS_PATH" '$1 == b || $1 == p { print $1 }')
if [[ -n $autofs_targets ]]; then
  ck_pass archive-via-autofs "$AUTOFS_PATH is served by the automounter" \
    "autofs is mounted on $(printf '%s' "$autofs_targets" | tr '\n' ' ')"
else
  ck_fail archive-via-autofs "$AUTOFS_PATH is served by the automounter" \
    "no autofs filesystem is mounted on $AUTOFS_BASE or $AUTOFS_PATH; the automounter needs a master map entry, a map file it points at, and a running service"
fi

# --- 6. ...and touching it really does mount the archive ------------------
# The end-to-end check: after the read above, the archive must be mounted at the
# path the prompt named, be the right directory on the server, and hand back the
# file only that directory contains. A map with a typo in the server name, in the
# export path, or in the option field gets this far and no further.
#
# served_path_at rather than nfs_export_at, because on this guest the server is
# this machine and the automounter bind-mounts instead of speaking NFS. The long
# comment on that function is where the reasoning and the evidence live.
archive_export=$(served_path_at "$AUTOFS_PATH" || true)
archive_rows=$(mp_rows "$AUTOFS_PATH")
if [[ -z $archive_export ]]; then
  ck_fail archive-automounted "reading $AUTOFS_PATH mounts $EXPORT_ARCHIVE there" \
    "after reading $AUTOFS_PATH nothing on it is serving a directory from the file server (mount table says: $(printf '%s' "${archive_rows:-nothing}" | tr '\n' ';'))"
elif [[ $archive_export != "$EXPORT_ARCHIVE" ]]; then
  ck_fail archive-automounted "reading $AUTOFS_PATH mounts $EXPORT_ARCHIVE there" \
    "reading $AUTOFS_PATH mounted $archive_export, not $EXPORT_ARCHIVE"
elif [[ $server_up == no ]]; then
  ck_fail archive-automounted "reading $AUTOFS_PATH mounts $EXPORT_ARCHIVE there" \
    "$SERVER_DOWN_DETAIL"
else
  seen=$(read_file "$AUTOFS_PATH/$ARCHIVE_FILE")
  case $seen in
    *"$ARCHIVE_MARKER"*)
      ck_pass archive-automounted "reading $AUTOFS_PATH mounts $EXPORT_ARCHIVE there"
      ;;
    *)
      ck_fail archive-automounted "reading $AUTOFS_PATH mounts $EXPORT_ARCHIVE there" \
        "$AUTOFS_PATH is mounted from $EXPORT_ARCHIVE but $ARCHIVE_FILE did not read back through it: $(printf '%s' "$seen" | tr '\n' ' ' | cut -c1-160)"
      ;;
  esac
fi

# --- 7. the server this host stands in for is still serving ---------------
# An invariant. It passes from the start and exists for two readers. For the
# student it catches an answer that "fixed" a client-side problem by editing the
# export table or stopping the server. For whoever is looking at a wall of red
# checkpoints it is the line that says the failures are not theirs: every other
# checkpoint in this file depends on this one being true, and a lab guest whose
# NFS server died produces the same six failures as a student who did nothing.
#
# Knowingly unprobed: no anti-solution names it, and none can. Every way to break
# it - stopping the service, unexporting, deleting the directories - leaves the
# client mounts staged by setup.sh hanging on a server that no longer answers,
# and a hard NFS mount blocks uninterruptibly. The fixture would not fail
# cleanly; it would take the run's own reset with it. That is the risk being
# accepted here, not overlooked: an unconditional pass would validate green.
# unprobed-invariant: export-intact
if [[ $server_up == no ]]; then
  ck_fail export-intact "this host is still exporting $EXPORT_REPORTS and $EXPORT_ARCHIVE" \
    "the nfs-server service is ${nfs_state:-unknown}, so this host is not serving anything; nothing else in this task can work until it is running again"
else
  etab=$(sudo exportfs -s 2>&1)
  missing=$(printf '%s\n' "$etab" \
    | awk -v a="$EXPORT_REPORTS" -v b="$EXPORT_ARCHIVE" '
        $1 == a { seen_a = 1 }
        $1 == b { seen_b = 1 }
        END {
          if (!seen_a) printf "%s ", a
          if (!seen_b) printf "%s ", b
        }')
  if [[ -z $missing ]]; then
    ck_pass export-intact "this host is still exporting $EXPORT_REPORTS and $EXPORT_ARCHIVE"
  else
    ck_fail export-intact "this host is still exporting $EXPORT_REPORTS and $EXPORT_ARCHIVE" \
      "the export table no longer lists: $missing(it says: $(printf '%s' "$etab" | tr '\n' ' ' | cut -c1-160))"
  fi
fi
