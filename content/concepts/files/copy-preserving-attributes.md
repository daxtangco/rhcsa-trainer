---
id: files.copy-preserving-attributes
title: What a copy loses by default, and why mv is not cp plus rm
rhel: 9
objectives: [files.manage.copy-move, files.links.create]
sources: [r9:ch3, r10:ch3]
prerequisites: [files.hard-vs-symbolic-links]
---
A copy is a **new file**. The kernel allocates a fresh inode and `cp` fills it in;
everything about the original that lives in the inode rather than in the data
comes across only because you asked for it. Left to itself, `cp` carries the
contents and the permission bits and nothing else: the copy belongs to **whoever
ran the command**, and its modification time is **now**. An archive whose
timestamps all read "the day somebody archived it" has lost the only information
it was made to keep, and nothing warned about it — `ls -l` still shows the
familiar mode you were watching.

Two flags fix it, and they are not the same flag:

```
cp -p  src dst      # --preserve=mode,ownership,timestamps
cp -a  src dst      # -dR --preserve=all: the above plus symlinks, hard links,
                    # ACLs, SELinux contexts and other extended attributes
```

Preserving *ownership* needs root, and it fails **silently**. Measured on
coreutils 8.32, the version RHEL 9 ships: an ordinary user running `cp -p`,
`cp -a` or `cp --preserve=ownership` over a file somebody else owns exits 0,
prints nothing at all, and leaves the copy owned by the account that ran it. GNU
`cp` forgives the `EPERM` from `chown(2)` when the process never had the
privilege to refuse it with. So "the copy keeps its owner" is a `sudo`
requirement, and the only thing that tells you you forgot is `stat` on the
result.

**The symlink rule is the one everybody misremembers, and it cuts both ways.**
Name a symbolic link as an argument and `cp` follows it and copies the file at the
far end — so `cp /srv/dir/* /backup/` quietly turns your links into duplicates.
But symbolic links met *during a recursive descent* are copied as links:
`cp -r /srv/dir /backup/dir` keeps them (measured on coreutils 8.32, the version
RHEL 9 ships), and `-L` is what forces dereferencing everywhere. Since the
behaviour depends on how you spelled the source, say what you mean: `-a` for an
exact copy, `-L` when flattening is deliberate.

Hard links inside the tree are the quieter loss. Without `--preserve=links`
(inside both `-a` and `-d`) two names for one inode become two independent files,
so the copy is larger than the original and an edit through one name no longer
shows through the other.

**`mv` is not `cp` followed by `rm`.** Within one filesystem `mv` is `rename(2)`:
the same inode gets a new directory entry, no data moves, it is instant whatever
the file's size, and every other hard link still refers to it. Copy-and-delete
produces a different file — new inode, new blocks — that merely looks identical,
and any hard link to the original is left pointing at data no name reaches. Across
a mount point `mv` has no choice but to degrade into exactly that copy-and-unlink,
which is why moving between `/home` and `/var` is slow and why it does not
preserve the inode. "Same content" and "same file" are different claims.

`tar -C src -cf - . | tar -C dst -xpf -` run as root does what `cp -a` does and is
the habit worth having for whole trees; add `--xattrs --selinux` if the labels
matter, or run `restorecon -R` on the destination afterwards. And verify with
`stat`, not `ls`: the timestamps and the inode number you claimed to preserve are
not in `ls -l` output at all.
