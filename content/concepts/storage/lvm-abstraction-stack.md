---
id: storage.lvm-abstraction-stack
title: Physical volumes, volume groups, logical volumes
rhel: 9
objectives: [storage.lvm.resize]
sources: [r9:ch15, r10:ch15]
---
LVM puts two layers between a disk and a filesystem, and almost every LVM
mistake comes from forgetting one of them.

A **physical volume** is a whole disk or a partition that has been handed over
to LVM with `pvcreate`. A **volume group** pools one or more physical volumes
into a single space to allocate from — `vgcreate`, `vgextend`. A **logical
volume** is a slice carved out of that pool with `lvcreate`, and it is the only
one of the three you ever format and mount.

Read the stack from the bottom up and the commands stop needing memorisation:

```
filesystem   xfs, ext4          mkfs, xfs_growfs
logical vol  /dev/rhel/home     lvcreate, lvextend, lvs
volume group rhel               vgcreate, vgextend, vgs
physical vol /dev/sdb1          pvcreate, pvs
disk         /dev/sdb           lsblk
```

The consequence that catches people: **a filesystem does not notice that its
logical volume grew.** `lvextend` changes the size of the container; the
filesystem inside it keeps using the size it was created with, so `lvs` shows
12 GiB while `df` still shows 8 GiB. You either grow the filesystem afterwards
(`xfs_growfs /home`) or tell `lvextend` to do it for you (`lvextend -r`).

The other consequence is the useful one: because a logical volume is allocated
from a pool, it does not have to be contiguous and does not have to live on one
disk. That is why growing a volume almost never requires touching a partition
table, and why leaving free space *in the volume group* rather than in a
partition is what makes a system easy to extend later.

Three commands are worth reaching for before anything else: `lsblk` to see the
shape of the storage, `lvs` to see what LVM thinks the sizes are, and `df -h`
to see what the filesystems think. When `lvs` and `df` disagree, you already
know what went wrong.
