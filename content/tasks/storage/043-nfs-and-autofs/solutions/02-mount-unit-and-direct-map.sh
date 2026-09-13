#!/usr/bin/env bash
# Equally correct, and deliberately different in every mechanism it chooses:
#
#   - persistence for the report share is a systemd .mount unit, not an fstab
#     line, so a grader that only reads /etc/fstab would wrongly reject this
#   - the mount itself is made by starting that unit, so no mount command runs
#   - the archive uses a DIRECT map (`/-` plus absolute keys) dropped into
#     /etc/auto.master.d, so a grader that expected an indirect map under
#     /nfsdata, or expected /etc/auto.master itself to have been edited, would
#     wrongly reject this too
#   - the leftover fstab line goes away by rewriting the file rather than by
#     editing it in place
#
# Loops and conditionals are allowed here: only the alphabetically first solution
# feeds the command sketch.
set -euo pipefail

# --- the leftover share ---------------------------------------------------
sudo umount /mnt/oldshare
sudo grep -v '[[:space:]]/mnt/oldshare[[:space:]]' /etc/fstab > /tmp/fstab.new
sudo install -m 0644 -o root -g root /tmp/fstab.new /etc/fstab
sudo restorecon /etc/fstab
rm -f /tmp/fstab.new

# --- the report share, as a mount unit ------------------------------------
# The unit's file name is not a free choice: systemd derives it from the mount
# point, so /mnt/reports must be described by mnt-reports.mount and nothing else.
sudo mkdir -p /mnt/reports
sudo tee /etc/systemd/system/mnt-reports.mount >/dev/null <<'UNIT'
[Unit]
Description=Report share from nfsstore.lab.example.com
After=network-online.target
Wants=network-online.target

[Mount]
What=nfsstore.lab.example.com:/export/reports
Where=/mnt/reports
Type=nfs
Options=defaults

[Install]
WantedBy=remote-fs.target
UNIT
sudo restorecon /etc/systemd/system/mnt-reports.mount
sudo systemctl daemon-reload
# --now mounts it, and the enable is what puts it in remote-fs.target for the
# next boot.
sudo systemctl enable --now mnt-reports.mount

# --- the archive, as a direct map -----------------------------------------
# /etc/auto.master.d is read because the shipped /etc/auto.master carries a
# `+dir:/etc/auto.master.d` line, so a file there is a master map entry without
# touching the packaged file at all. The `.autofs` suffix is not decoration: man 5
# auto.master says "Files in that directory must have a \".autofs\" suffix", and a
# file named anything else is read by nothing. `/-` in the first field says "the
# keys in the map are absolute paths", which is what a direct map is.
sudo mkdir -p /nfsdata/archive
printf '/- /etc/auto.direct\n' | sudo tee /etc/auto.master.d/rhcsa-archive.autofs >/dev/null
printf '/nfsdata/archive -fstype=nfs,rw nfsstore.lab.example.com:/export/archive\n' | sudo tee /etc/auto.direct >/dev/null
sudo systemctl enable --now autofs

# --- prove it, rather than assume it --------------------------------------
# Touching the path is the only way to see an automount happen, and a retry loop
# because the daemon may still be parsing its maps in the moment after it starts.
#
# What is checked here is "something got mounted on the path", NOT "an nfs mount
# got mounted on the path", and the difference matters on this one guest. The
# automounter measures how far away each server in a map entry is, and when the
# answer is "it is this machine" it bind-mounts the exported directory instead of
# speaking NFS to itself - man 5 auto.master documents the `nobind` pseudo-option
# as existing "to prevent bind mounting of local NFS filesystems". This lab host
# stands in for the file server, so nfsstore.lab.example.com is 127.0.0.1, so what
# lands on /nfsdata/archive is a bind mount of /export/archive and `-t nfs,nfs4`
# would reject a perfectly correct answer. grade.sh accepts both shapes for the
# same reason. The fstab/mount-unit half is unaffected: mount.nfs has no such
# shortcut, so /mnt/reports really is nfs.
for attempt in 1 2 3; do
  ls -A /nfsdata/archive >/dev/null 2>&1 || true
  # Every row at that exact path except the automounter's own control mount. No
  # pipe into grep: awk reads the whole variable, so nothing can die of SIGPIPE
  # and be reported by pipefail as a failure.
  if [[ -n $(awk '$1 != "autofs"' <<<"$(findmnt -rno FSTYPE --mountpoint /nfsdata/archive 2>/dev/null)") ]]; then
    break
  fi
  sleep 2
done
findmnt --mountpoint /mnt/reports -t nfs,nfs4 >/dev/null
# The end-to-end proof, and the only one that does not care which of the two
# shapes the automounter chose: the file that only /export/archive contains has
# to read back through the path the prompt named.
cat /nfsdata/archive/archive-index.txt >/dev/null
