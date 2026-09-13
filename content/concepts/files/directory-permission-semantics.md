---
id: files.directory-permission-semantics
title: On a directory, rwx mean something else
rhel: 9
objectives: [files.permissions.ugo-rwx, files.permissions.troubleshoot]
sources: [r9:ch7, r10:ch7]
prerequisites: []
---
A directory is a list of names, each paired with an inode number. Read the three
permission bits against *that* — against the list, not against the files — and
they stop being arbitrary:

- **r** — read the list of names. That and nothing more.
- **w** — change the list: create, delete, rename entries. It is authority over
  the directory's contents-listing, not over the files themselves.
- **x** — use this directory as a step in a path. Often called "search". Without
  it, a name inside cannot be resolved at all, even a name you already know, even
  when the file itself is world-readable.

Two consequences follow that catch nearly everyone.

**You delete a file by having write permission on its directory, not on the
file.** Removing an entry from a list is a change to the list. So a file you
cannot even read can be deleted by anyone who can write the directory it sits in,
and `chmod 444 important.txt` protects nothing. The sticky bit exists precisely to
patch this for shared directories, and that is the other half of this story.

**Every component of a path needs x.** Opening `/srv/payroll/handover.txt`
requires execute on `/`, on `/srv`, and on `/srv/payroll` before the file's own
bits are consulted at all. A permission problem two directories up is
indistinguishable from a permission problem on the file, which is why "the file
looks fine" is such a common dead end.

The two lopsided combinations are worth recognising because both appear in real
configurations. **r without x**: `ls` prints the names and every one of them fails
to stat, so `ls -l` shows question marks and permission-denied lines. Names
without access. **x without r**: you can open a name you already know and `ls`
refuses to tell you any — mode `711` on a home directory, which is how a machine
lets everyone reach `~/public_html` without letting them browse the rest.

So granting a group access to a directory means giving that group **x, not just
r**. `chmod 750` is "enter and list"; `chmod 740` is "read a list of names you
cannot use", which is almost never anybody's intention. And shutting outsiders out
completely is `o-rwx` on the directory — taking away `x` alone is already enough to
make everything under it unreachable, whatever the files inside say.

One flag deserves its own paragraph. `chmod -R 770 /srv/payroll` marks **every
regular file in the tree executable**, because 7 means x and the recursion does not
know a text file from a directory. The fix is built into `chmod`:

```
chmod -R u=rwX,g=rX,o= /srv/payroll   # capital X: x on directories only
```

Capital `X` sets the execute bit on directories, and on files that already had an
execute bit somewhere. That is the entire reason it exists, and `-R` without it is
the most common way to quietly damage a tree while fixing it.

For diagnosis, walk the path rather than reasoning about it. `ls -ld /srv
/srv/payroll` prints the directories themselves — the `-d`, or you get their
contents instead. `namei -l /srv/payroll/handover.txt` prints the mode and owner
of every component in one shot, which is faster still. Best of all, stop guessing
and ask the kernel as the user in question:

```
sudo -u dana test -r /srv/payroll/handover.txt; echo $?
sudo -u dana touch /srv/payroll/probe && sudo -u dana rm /srv/payroll/probe
```

A `0` from the first and a silent success from the second are evidence. Your own
ability to read the file, as root or as yourself, is not.
