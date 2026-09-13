---
id: storage.partition-tables-and-tools
title: Partition tables, and the tools that write them
rhel: 9
objectives: [storage.partitions.mbr-gpt]
sources: [r9:ch14, r10:ch14]
prerequisites: []
---
A raw disk has no partitions and no table to hold them. Before anything can be
carved out of it you write a **partition table** — a label at the front of the
device that says how the rest of it is divided. RHEL 9 offers two:

**MBR** is the old one. Four primary entries, one of which can be an extended
partition holding logical ones, and a 2 TiB ceiling from its 32-bit sector
addressing. It goes by two names depending on who you ask: `parted` calls it
`msdos`, and `blkid -p -s PTTYPE` reports it as `dos`. GPT is `gpt` to both.

**GPT** is the one to write on anything new. It has no practical partition
limit, no 2 TiB ceiling, and keeps a backup copy of itself at the end of the
disk. Treat the choice as a single decision made once, at label time: the way
back is to wipe the table and start over. (`gdisk` can in fact convert an MBR to
GPT in place, by reading the old table and writing a GPT from it, but it is not
installed by default, it is not what exam wording asks for, and it is a much
worse habit than deciding correctly the first time.)

Three tools write these tables and any of them is a complete answer:

- `parted` is non-interactive-friendly: `parted -s /dev/sdb mklabel gpt`, then
  `parted -s /dev/sdb mkpart name 1MiB 1025MiB`. It takes **start and end
  offsets**, not a length, which is the single most common source of
  off-by-one-partition-size errors.
- `fdisk` is menu-driven and now handles GPT perfectly well (`g` creates a GPT
  label, `n` a partition, `p` prints, `d` deletes, `w` writes and exits, `q`
  leaves without saving). It takes a **length** for the end point (`+1G`),
  which is usually what you actually want.
- `gdisk` is fdisk's GPT-only cousin and shares most of its key letters (`n`,
  `d`, `p`, `t`, `w`, `q`), but not the one that makes a new table: in `gdisk` a
  fresh GPT is `o`, and `g` does something else entirely. It also ships in its
  own `gdisk` package, which a Minimal Install does not include — so unless you
  installed it, `fdisk` and `parted` are the two tools actually in front of you.

Nothing is written to the disk until you say so — `w` in fdisk/gdisk. That is
the safety net: if you have lost track of what you have done, `q` discards the
lot.

**Reading what is there** matters as much as writing it. `lsblk` shows the tree
of disks and their partitions with sizes; add `-f` to see filesystems, labels
and UUIDs. `blkid` names the type of what is on a device, and `blkid -p -s
PTTYPE /dev/sdb` reports the table type of the disk itself. `parted /dev/sdb
print` shows the label type and the partitions — but *not* the gaps between
them; `parted /dev/sdb print free` is the form that lists unallocated space as
rows of its own, which is what you want before choosing a start offset.

**Deleting** is the third verb in the objective and the one people practise
least. `parted -s /dev/sdb rm 2` or fdisk's `d` removes the entry from the
table; neither erases the data inside it, and neither will save you if the
partition is still in use — unmount it, and take it out of any volume group,
before removing the entry underneath.

Two habits keep partitioning from feeling flaky. First, the kernel does not
always notice a table it did not expect to change: `udevadm settle` after a
write, and `partprobe /dev/sdb` if `/dev/sdb1` still has not appeared. Second,
partition **type codes** are advisory labels for humans and installers — LVM does
not check them and neither does `mount`. Setting one is good practice, not a
prerequisite. The familiar two-hex-digit codes (`83` Linux, `8e` Linux LVM, `fd`
RAID autodetect) are an MBR thing; GPT uses 16-byte type GUIDs instead, which is
why `fdisk`'s `t` on a GPT disk offers a numbered menu of names rather than hex —
press `L` to list it rather than trusting a number you memorised, because the
numbering shifts between `util-linux` releases.

To start over completely, `wipefs -a /dev/sdb` removes the table and every
filesystem signature on the device, leaving it as blank as it shipped.
