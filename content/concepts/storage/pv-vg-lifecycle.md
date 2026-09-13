---
id: storage.pv-vg-lifecycle
title: Creating physical volumes and volume groups
rhel: 9
objectives: [storage.lvm.pv, storage.lvm.vg]
sources: [r9:ch15, r10:ch15]
prerequisites: [storage.lvm-abstraction-stack]
---
`pvcreate` writes an LVM label onto a block device, and from that moment LVM
considers the device its own. `vgcreate` pools one or more of those devices into
a named group that logical volumes are later allocated from. Those two commands
are the whole of the bottom half of LVM, and there are only a few things about
them worth knowing.

**Whole disk or partition — LVM accepts either.** `pvcreate /dev/sdb` works and
`pvcreate /dev/sdb1` works. The difference is not technical, it is
communicative: a disk with a partition table announces to anyone who runs
`lsblk` or boots an installer that the space is claimed, while a whole-disk
physical volume looks like an empty disk to every tool that does not speak LVM.
Partition first is the convention, and an exam task that asks for a partition
*and* a physical volume is asking for two distinct things — the layer being
graded is which device the PV landed on.

**`vgcreate` will run `pvcreate` for you.** `vgcreate vgdata /dev/sdb1` on a
device that is not yet a physical volume initialises it and puts it in the
group, in one step. Running `pvcreate` first is not wrong and is easier to
verify as you go, but do not be surprised when a one-command answer works.

Useful options: `vgcreate -s 32M vgdata /dev/sdb1` sets the extent size (the
default is 4 MiB; `vgchange -s` can change it afterwards, but only while no
allocated extent would have to move, so in practice choose it at creation time),
and a group can be created across several devices at once by listing them all.

**Inspecting.** `pvs` is the one-line-per-PV view and the important column is
`VG` — a physical volume with an empty VG column belongs to no group and can
never supply a logical volume. `vgs` shows each group's size and free space,
`pvdisplay` and `vgdisplay` show the same data at length, and `lsblk` shows how
the pieces stack up on the actual devices. `pvs -o pv_name,vg_name` asks for
exactly the two fields that answer "is this device in the right group".

**Growing and dismantling.** `vgextend vgdata /dev/sdc1` adds a physical volume
to an existing group; this is how a group grows, and it is also the trap in
tasks that ask for a *new* group, because extending the system's group is the
easier thing to type. Teardown runs in the reverse order of creation and every
step refuses to skip ahead: remove logical volumes (`lvremove`), then either
`vgreduce vgdata /dev/sdb1` to take one device back out or `vgremove vgdata` to
delete the group, and only then `pvremove /dev/sdb1` to strip the LVM label.
`pvremove` will not touch a device that is still in a group.

Two things bite on RHEL 9 specifically. If a physical volume vanishes — a disk
pulled, a loop device gone after a reboot — the group survives with a missing
member, and `vgreduce --removemissing vgdata` is what makes it whole again. It
refuses if any logical volume had extents on the vanished device; adding `--force`
makes it proceed by destroying those volumes' partial remains, so read the refusal
before reaching for the flag.
And RHEL 9 keeps a list of the devices LVM is allowed to look at in
`/etc/lvm/devices/system.devices`; `pvcreate` adds entries automatically, so it
only matters when you are cleaning up, where `lvmdevices --deldev /dev/sdb1`
removes a stale one.
