---
id: storage.lvm-abstraction-stack
title: Physical volumes, volume groups, logical volumes
rhel: 9
objectives: [storage.lvm.resize]
---
LVM inserts two layers between a disk and a filesystem: a physical volume is a
disk handed to LVM, a volume group pools physical volumes, and a logical volume
is carved out of that pool. Growing a filesystem is therefore a two-step job.
