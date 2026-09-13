---
id: files.hard-vs-symbolic-links
title: Two names for one inode, or a file containing a path
rhel: 9
objectives: [files.links.create, files.manage.copy-move]
sources: [r9:ch3, r10:ch3]
prerequisites: []
---
A directory entry is a name and an inode number. Everything about a file *except*
its name — its size, mode, owner, timestamps and the blocks holding its data —
lives in the inode. Hold that model and both kinds of link stop needing to be
memorised.

A **hard link** is a second directory entry pointing at the same inode. `ln a b`
makes one. There is no original and no copy: `a` and `b` are equally the file,
`ls -i` shows them sharing an inode number, and the inode's link count — the second
column of `ls -l` — is now 2. `chmod` through either name changes both, because
there is only one inode to change. Remove either name and the data survives; the
kernel frees it when the count reaches zero and no process still has it open.

A **symbolic link** is a small file of its own whose *contents are a path*,
resolved afresh every time something uses it. `ln -s target name`. It has its own
inode, `ls -l` prints `name -> target`, and it knows nothing at all about what it
points at: the target need not exist, and deleting the target leaves the link
intact and dangling rather than removing it.

Which one you can use is decided by two hard limits. **A hard link cannot cross a
filesystem**, because an inode number only means something within one filesystem,
and you cannot hard-link a directory. A symlink can point anywhere — another
filesystem, a removable disk, a path that does not exist yet — because it is only
text until something follows it.

**The trap is relative targets.** `ln -s` does not resolve the target when you
create the link; it stores the string. A relative string is resolved later,
relative to **the directory the link lives in**, not the directory you were
standing in when you typed the command:

```
cd /tmp
ln -s data.txt /srv/link      # /srv/link -> data.txt, which means /srv/data.txt
ls -l /srv/link               # looks fine
cat /srv/link                 # No such file or directory
```

Either give `ln -s` an absolute target, or `cd` to where the link will live first.
This is the most common cause of a broken symlink and it is completely invisible
until something reads it.

For reading them back: `ls -li` for inode numbers and link counts, `readlink -f`
for the fully resolved path a symlink ends at, `stat` for everything. `find /dir
-samefile /path/to/file` finds every hard link to one inode — the only way, since
the inode does not record its own names. `find /dir -xtype l` finds dangling
symlinks.

Then the question every tool answers differently: does it follow the link or act
on the link? Most follow by default. `cp` copies what a symlink points at unless
you pass `-P` (or `-a`, which preserves them along with everything else), which is
how a careful backup turns into a set of duplicated files. `rm link` removes the
link and never the target — and `rm link/`, with a trailing slash, is a different
request that resolves through the link to a directory instead. `chmod` and `chown`
follow symlinks (`chown -h` acts on the link itself), and a symlink's own
permission bits are meaningless on Linux. `tar` stores symlinks as symlinks unless
you ask for `-h`.

The habit that saves time: when something behaves as though a file is in two
places, `ls -li` first. Same inode number is a hard link and there is one file.
Different inode numbers with an arrow is a symlink and there are two, one of which
may be pointing at nothing.
