---
id: storage.why-xfs-cannot-shrink
title: XFS grows but never shrinks
rhel: 9
objectives: [storage.lvm.resize]
sources: [r9:ch15, r10:ch15]
prerequisites: [storage.lvm-abstraction-stack]
---
XFS has no shrink operation. Not "it is risky", not "it needs a flag" — the
tooling does not exist. `xfs_growfs` grows a mounted filesystem; there is no
`xfs_shrinkfs`, and there never has been. XFS is the default filesystem on
RHEL, so on a stock system this is the case you are in.

The reason is that XFS spreads metadata across allocation groups over the whole
device as it is used. Shrinking would mean relocating metadata that the format
was never designed to relocate. Growing only adds allocation groups, which is
straightforward, so that is the only direction supported.

What this means in practice:

- `lvreduce` on a volume holding XFS **destroys data**. The volume shrinks; the
  filesystem does not know and keeps addressing blocks that are no longer
  there. `lvreduce` warns you. Believe it.
- To genuinely reclaim space from an XFS filesystem you back up the data,
  `lvremove` the volume, create a smaller one, `mkfs.xfs` it, and restore. That
  is a maintenance window, not a command.
- ext4 *can* shrink, but only while unmounted: `umount`, then
  `resize2fs /dev/vg/lv 4G`, then `lvreduce`. Filesystem first when shrinking,
  volume first when growing — the order is opposite in the two directions,
  and getting it backwards is how people lose data.

This is why sizing decisions matter more on RHEL than they might elsewhere, and
why the habit worth building is to **leave free extents in the volume group
rather than handing every extent to a filesystem on day one.** Space still in
the volume group can go anywhere. Space inside an XFS filesystem is committed
for good.

So when a task asks you to make room, the question is never "what can I
shrink" — it is "what free space does `vgs` show, and if the answer is none,
what disk can I add".
