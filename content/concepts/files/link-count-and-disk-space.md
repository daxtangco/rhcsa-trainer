---
id: files.link-count-and-disk-space
title: rm removes a name, not a file — the link count decides the space
rhel: 9
objectives: [files.links.create, files.manage.copy-move]
sources: [r9:ch3, r10:ch3]
prerequisites: [files.hard-vs-symbolic-links]
---
`rm` does not delete a file. It calls `unlink(2)`, which removes a **name** and
decrements the inode's link count. The kernel frees the data blocks when that count
reaches zero *and* no process still holds the file open. Two facts follow, and
between them they explain most "I deleted it and `df` did not change" tickets:
another name still points at the inode, or something has it open.

The link count is the second column of `ls -l`, and `ls -li` prints it next to the
inode number. For a regular file it is simply how many directory entries name that
inode. A directory starts at 2 — its own entry and its `.` — and gains one for each
subdirectory's `..`, which is why an empty directory reads 2 and not 1.

**This is what makes the hard-link-versus-symlink choice a capacity decision and
not a style one.** Hard-linking a 4 GiB file into a second directory costs one
directory entry and no blocks at all, so it is free — and for the same reason it is
not a backup: there is one copy of the data, an edit through either name changes
it, and deleting the "original" frees nothing. That is exactly right when you want
a second path that keeps the data alive, and exactly wrong when you want a
reference that dies with it. A symbolic link is the other answer: it holds no
blocks of the target, the space is freed the moment the last real name goes, and
what you are left with is a dangling link — visible, fixable, and honest.

Get this backwards in a place a cleanup job runs and the failure is nasty because
it is silent. The job deletes yesterday's captures, reports success, `ls` shows
them gone, and the filesystem never gets any emptier, because something hard-linked
them somewhere else months ago. Nothing points at the cause; you find it by
counting links.

The tools for reading it back:

```
ls -li file                  # inode number and link count
find /srv -samefile file     # every other name for this inode
find /srv -type f -links +1  # every file that has more than one name
find /srv -xtype l           # dangling symbolic links
lsof +L1                     # unlinked files some process still holds open
```

`lsof` is not part of a minimal RHEL 9 install — `dnf install lsof` first, or read the
same thing out of `/proc` with `ls -l /proc/*/fd 2>/dev/null | grep deleted`, which
needs nothing installed.

`find -samefile` is the only way to enumerate an inode's names, because the inode
does not record them — names live in directories, and nothing indexes the reverse
direction.

Two limits are worth memorising because they decide the question for you: a hard
link **cannot cross a filesystem**, since an inode number only means anything
within one, and you cannot hard-link a directory. Any second path that has to cross
a mount point is a symbolic link whether you wanted one or not. `du` is inode-aware
within a single traversal and counts shared blocks once, so `du` on two trees
separately double-counts what `du` on their common parent counts once; when the
numbers argue, `df` is the filesystem's own answer.
