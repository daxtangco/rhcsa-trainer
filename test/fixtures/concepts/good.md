---
id: storage.lvm-abstraction-stack
title: Physical volumes, volume groups, logical volumes
rhel: 9
objectives: [storage.lvm.create, storage.lvm.resize]
sources: [r9:ch15, r10:ch15]
prerequisites: [storage.partitions]
---
LVM inserts two layers between a disk and a filesystem. A **physical volume**
is a whole disk or partition handed over to LVM. A **volume group** pools one
or more physical volumes into a single allocation space. A **logical volume**
is carved out of that pool and is what you actually format and mount.

The point of the pool is that a logical volume need not be contiguous, and
need not live on one disk. That is why growing a filesystem is normally a
two-step job: grow the logical volume, then grow the filesystem inside it.
