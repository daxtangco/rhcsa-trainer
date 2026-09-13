---
id: storage.swap-activation-and-priority
title: Adding swap without touching the swap you have
rhel: 9
objectives: [storage.swap.nondestructive]
sources: [r9:ch14, r10:ch14]
prerequisites: [storage.fstab-fields-and-uuid]
---
Swap is not a filesystem. There is nothing to mount and no directory involved:
`mkswap` writes a small header onto a block device or a file, and `swapon` tells
the kernel it may page memory out there. That is the entire mental model, and it
is why swap has its own two verbs instead of using `mount`.

Adding swap is therefore three moves — make the area, switch it on, write it
down — and the third one is the one people skip:

```
lvcreate -L 1G -n swapextra rhel     # or a file, or a partition
mkswap /dev/rhel/swapextra           # writes the swap signature + a UUID
swapon /dev/rhel/swapextra           # active now, until the next reboot
UUID=…  none  swap  defaults  0 0    # active after the next reboot
```

**Additional swap is additional.** The kernel happily uses several swap areas at
once; `swapon --show` and `/proc/swaps` list them, and `free -h` shows the total.
So the correct answer to "this host needs more swap" is a second area, never a
bigger version of the first one. That distinction is what the objective's word
*nondestructively* is pointing at. Growing the existing swap volume means
`swapoff`, `lvextend`, `mkswap` again — a new signature, a new UUID, so any
fstab line naming the old UUID is now broken — and `swapon`. Every step of that
is a chance to leave a running machine with no swap at all, and it buys nothing
that a second volume does not.

The **priority** field is how you choose between areas. Each has a priority from
`swapon -p N` or the `pri=N` mount option in fstab; higher is used first, and
equal priorities are striped round-robin. Without an explicit value the kernel
hands out descending negatives in activation order, which is why a freshly added
area is usually used *last*. Set `pri=` when the areas differ in speed — swap on
an SSD-backed volume should outrank swap on spinning rust — and leave it alone
otherwise.

A swap **file** is a legitimate area and sometimes the only option on a host with
no free extents. Create it with `dd if=/dev/zero of=/swapfile bs=1M count=1024`,
which is the form Red Hat's own procedure uses and the one that works everywhere:
a swap area may not be sparse, and it may not be merely *reserved* either.
`fallocate -l 1G` is fine on ext4, but on XFS it leaves preallocated extents that
have never been written and `swapon` rejects the file — the failure is a bare
`swapon: /swapfile: swapon failed: Invalid argument`, which tells you nothing
about why. On RHEL the root filesystem is XFS by default, so `dd` is the habit to
have. Then `chmod 0600` — both `mkswap` and `swapon` warn about a world-readable
swap file rather than refusing it, so the warning is the only thing standing
between you and a file any user can read memory out of — then `mkswap`, `swapon`,
and an fstab line naming the path. Everything above about priority applies
unchanged.

The mistake, and it is nearly universal: `mkswap` + `swapon`, then move on. `free
-h` shows the new total, the ticket gets closed, and the swap is gone at the next
boot because nothing wrote it down. Nothing warns you — swap is optional, so its
absence is silent until the day the host needs it. The second mistake is the
mirror image: an fstab line added and never activated, so the machine is correct
after a reboot and wrong for the rest of the day. `swapon -a` (activate
everything in fstab that is not already on) closes that gap, and
`swapon --show` is the one command that tells you the truth about both.
