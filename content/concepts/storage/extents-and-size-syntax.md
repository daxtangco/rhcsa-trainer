---
id: storage.extents-and-size-syntax
title: Extents, and the difference between -L 12G and -L +12G
rhel: 9
objectives: [storage.lvm.resize, storage.lvm.lv]
sources: [r9:ch15, r10:ch15]
prerequisites: [storage.lvm-abstraction-stack]
---
LVM does not hand out bytes. A volume group is chopped into fixed-size **physical
extents** — 4 MiB unless somebody passed `vgcreate -s` — and every logical volume
is a whole number of them. Two things follow, and both of them surprise people
once.

Sizes round **up**. Ask for 4.1 GiB and you get the next extent boundary, so `lvs`
reports a number you did not type. That is not a bug and it is why storage
requirements are written as "at least 4 GiB": the extent arithmetic makes exact
sizes unreachable in general, so exactness is not what is being asked for. And a
volume group with 63 free extents cannot give you 256 MiB no matter how much
free space `df` claims to see somewhere else — free space *in the group* is the
only number that matters, and `vgs` prints it in the `VFree` column.

Then the syntax, where a single character changes the request:

```
lvextend -L  12G  /dev/rhel/home   # make it 12 GiB in total
lvextend -L +12G  /dev/rhel/home   # add 12 GiB to whatever it is now
```

**`-L 12G` is a target. `-L +12G` is an increment.** A task that says "make /home
at least 12 GiB" wants the first one. Type the second against an 8 GiB volume and
you get 20 GiB — which does technically satisfy "at least 12", while consuming
twice the space you intended and quite possibly all the free space another
requirement in the same question needed. On a group without room for it you get an
outright failure instead, which is the lucky outcome, because at least you find
out.

`-l` is the same option counted in extents rather than bytes, and it is the one
that takes percentages:

```
lvextend -l +100%FREE /dev/rhel/home   # add every free extent in the group
lvcreate -L 4G -n projects rhel        # a new 4 GiB volume from group `rhel`
lvcreate -l 100%FREE -n projects rhel  # ...or all the room that is left
```

`+100%FREE` is the idiom for "use it all" and the reason to know it is that it
cannot be got wrong by arithmetic. When a question names a size, name the size;
when it says "the rest of the space", say that instead of computing it.

On units: `12G` is read as 12 gibibytes, and if you ever need certainty rather
than a claim in a card, `lvs --units b` prints sizes in bytes and settles it.

Two habits. **Read the free space before sizing anything** — `vgs`, or
`vgdisplay` for the `Free PE / Size` line — because every LVM question is really
"is there room, and where". And **grow the filesystem in the same breath**:
`lvextend -r` (`--resizefs`) resizes the filesystem after the volume, which is the
step the abstraction-stack card explains and the step people forget. Then verify
with two commands that measure different layers, `lvs` and `df -h`; when they
disagree you have already found the mistake.

The mirror image of all this is the dangerous direction. `lvreduce -L 4G` on a
12 GiB volume shrinks it, and LVM will do exactly what you asked whether or not
the filesystem inside is small enough to survive it — which for XFS it never is.
That is a separate card, and the reason to read it before ever typing a smaller
number than the current size.
