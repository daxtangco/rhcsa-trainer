---
id: storage.mkfs-mount-persist
title: New storage is three steps, and the third one is the exam
rhel: 9
objectives: [storage.filesystems.create-mount, storage.lvm.lv]
sources: [r9:ch14, r10:ch14]
prerequisites: [storage.lvm-abstraction-stack, storage.fstab-fields-and-uuid]
---
Every "give this host some new storage" task on RHEL is the same three steps in
the same order, and naming them out loud is most of the skill:

1. **Get a block device.** `lvcreate -L 4G -n projects rhel` carves one out of a
   volume group's free extents; `lsblk` and `vgs` tell you what you have to work
   with. On a machine with a spare disk this step is `pvcreate` / `vgextend`
   first, but the shape does not change.
2. **Put a filesystem on it.** `mkfs.ext4 /dev/rhel/projects`, or `mkfs.xfs`, or
   `mkfs.vfat`. This is the step that writes the UUID.
3. **Mount it, twice.** Once for now — `mount /dev/rhel/projects /srv/projects` —
   and once for every boot after this one, which means a line in `/etc/fstab` (or
   a systemd `.mount` unit). Two separate acts. Doing one is the single most
   common way to lose marks on this objective.

Some things about step 2 that are worth internalising. `mkfs` takes a **device**,
never a directory: pointing it at `/srv/projects` does not do what you meant, and
pointing it at the wrong device destroys whatever was there without asking twice.
It is the one command in this sequence with no undo, so read the path back before
pressing enter, and prefer the LVM name (`/dev/rhel/projects`) over `/dev/dm-4`
precisely because it is readable. XFS is the RHEL default and cannot be shrunk
afterwards; ext4 can, offline; `vfat` exists for interoperability and has no
ownership or permission model, so it is not a general-purpose choice. Pick
deliberately, because you are choosing for the life of the filesystem. `mkfs -L
somename` at this point saves you looking up a UUID later.

Step 3 has a trap of its own: **mounting over a directory hides what was in it.**
The old contents are not deleted, they are simply unreachable until you unmount,
which is exactly how a "the files vanished" ticket is born. So create the mount
point empty, or look at what is in it first. And a filesystem is only busy-free
while nobody is standing in it — `umount` failing with "target is busy" almost
always means a shell has that directory as its cwd; `lsof +D /srv/projects` or
`fuser -vm /srv/projects` names the process.

New filesystems also arrive with no SELinux labels of their own. Files created
under the mount get a label from policy, so ordinary directories are fine, but if
the path is one policy has an opinion about — a web root, a home directory — run
`restorecon -Rv` on it after mounting and before declaring victory.

The failure this card exists to prevent is not dramatic, which is why it keeps
happening: everything works. `df -h` shows the new filesystem, the application
writes to it, the change looks finished. Then the host reboots — a kernel update,
a power event, or a grader — and the directory is back to being an empty folder
on the root filesystem, with the data still safe on a volume nobody mounted. Get
into the habit of finishing with `mount -a` on a machine whose fstab you just
edited, and treat "it works now" and "it works after a reboot" as two different
claims that need two different pieces of evidence.
