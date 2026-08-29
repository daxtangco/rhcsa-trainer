---
id: storage.filesystem-types
title: Filesystem types are not interchangeable
rhel: 9
---
XFS and ext4 solve overlapping problems differently: XFS cannot shrink, ext4
can. That single fact drives a lot of exam decisions — if a task might ask
you to shrink a filesystem later, don't format it XFS in the first place.
