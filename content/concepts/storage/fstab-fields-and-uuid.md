---
id: storage.fstab-fields-and-uuid
title: What each field of /etc/fstab is for, and why UUID
rhel: 9
objectives: [storage.fstab.uuid-label, storage.filesystems.create-mount]
sources: [r9:ch14, r10:ch14]
prerequisites: []
---
`/etc/fstab` is a table of *intentions*: for each filesystem, which object to
mount, where to put it, and how. It is read at boot and by `mount -a`. A `mount`
command you type is a fact about right now; an fstab line is the fact that
survives.

It is not the only way to say so. systemd will mount from a `.mount` unit and
activate swap from a `.swap` unit, and at boot it converts every fstab line into
exactly such a unit anyway (`systemd-fstab-generator`), so the two mechanisms
end in the same place — a unit that `local-fs.target` or `swap.target` pulls in.
fstab is the one to reach for, because it is shorter, it is where every other
admin will look, and it is what the exam objective is worded around. A unit
written by hand has to be enabled (`systemctl enable srv-projects.mount`) or
nothing pulls it in at boot, which is the one extra way to get it wrong. What
does *not* survive a reboot is a bare `mount` or `swapon`, and that is the whole
point of this card.

Six whitespace-separated fields, in order:

```
UUID=6f1a…  /srv/projects  ext4  defaults  0  0
device       mount point   type  options   dump  fsck
```

1. **What to mount.** A device node, or — and this is the field the exam
   objective is about — `UUID=` or `LABEL=`.
2. **Where.** An existing directory, absolute path. For swap there is no mount
   point, so the field is written `none` (or `swap`) as a placeholder.
3. **Type.** `xfs`, `ext4`, `vfat`, `nfs`, `swap`. `auto` asks libblkid to
   guess, which works and tells the next reader nothing.
4. **Options.** `defaults` is the usual answer. Two are worth knowing:
   `noauto` means *do not* mount at boot (so a `noauto` entry does not satisfy
   "mount it at boot" — it is the one option that quietly cancels the whole
   line), and `nofail` means "if the device is missing, boot anyway".
5. **dump.** A backup tool from the 1990s. Write `0`.
6. **fsck order.** `1` for the root filesystem, `2` for other ext filesystems
   that should be checked, `0` for everything else. XFS ignores it entirely.

Now the field that matters. **Device names are not identities.** `/dev/sdb1` is
"the first partition on the second disk the kernel happened to enumerate". Add
a disk, move a disk to another controller, boot with a USB stick plugged in, and
yesterday's `sdb` is today's `sdc`. The fstab line still points confidently at
the wrong object. `UUID=` and `LABEL=` are written *inside the filesystem's own
superblock* by `mkfs`, so they travel with the filesystem itself: whatever the
device is called this morning, `blkid` will find it. That is the whole argument,
and it is why the objective is phrased "by universally unique ID (UUID) or
label" rather than "in /etc/fstab".

Read the UUID off the thing you just created — `blkid /dev/rhel/projects`, or
`lsblk -o NAME,UUID,LABEL` for the whole picture — and paste it. A label is set
at `mkfs -L` time, or later with `xfs_admin -L` / `tune2fs -L`, and is easier to
read but only unique if you keep it unique. LVM device names like
`/dev/rhel/projects` are *stable*, so using them is not the catastrophe that
`/dev/sdb1` is; it still fails the objective, and the habit is what is being
graded.

The mistake that costs people the whole exam: a typo in fstab does not fail
politely. At the next boot systemd cannot satisfy `local-fs.target`, and the
machine drops to an emergency shell asking for the root password. So the last
step after editing fstab is always to prove it: `sudo mount -a` mounts
everything not already mounted (or fails loudly, at a prompt, where you can fix
it), `sudo systemctl daemon-reload` makes systemd re-read the file it generates
mount units from, and `findmnt --verify` checks the table for problems without
mounting anything. Do that and a reboot holds no surprises.
