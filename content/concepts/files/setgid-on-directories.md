---
id: files.setgid-on-directories
title: Set-GID directories, and the four things they do not do
rhel: 9
objectives: [files.permissions.set-gid, files.permissions.ugo-rwx, files.permissions.troubleshoot]
sources: [r9:ch7, r10:ch7]
prerequisites: [files.special-bits, users.primary-vs-supplementary-groups]
---
When you create a file, Linux gives it **your primary group** — not the group of
the directory you created it in. That default is the reason shared directories do
not work by accident. Put dana and erik in a `payroll` group, give them a
directory they can both write, and dana's new file still comes out
`dana:dana`. Erik is in `payroll`; the file is not. He cannot edit it, and
neither of them can see why.

The set-GID bit on a **directory** changes that rule for everything created
inside it: a new file gets the *directory's* group instead of the creator's. It
is the one mechanism there is for "everything in here belongs to this team", and
it is why `chmod g+s` is in every collaboration recipe. New *subdirectories*
inherit the group **and** the set-GID bit itself, so the behaviour keeps working
all the way down a tree without you revisiting it.

The whole recipe is four separate decisions, and set-GID is only one of them:

```
groupadd payroll ; usermod -aG payroll dana ; usermod -aG payroll erik
chgrp payroll /srv/payroll            # the group the bit will propagate
chmod g+rwxs,o-rwx /srv/payroll       # group can work here; outsiders get nothing
chmod +t /srv/payroll                 # nobody deletes anyone else's file
```

Now the part that costs people marks — **the four things set-GID does not do.**

**It does not touch what is already there.** The bit applies at creation time, so
files that were in the directory before you set it keep their old group and their
old mode. A directory that looks perfect and a `handover.txt` still owned
`root:root` mode 0644 is the normal outcome of doing this job in the wrong order.
`chgrp -R payroll /srv/payroll` and a `chmod g+rw` on the existing files is the
missing step; `chmod -R g+rwX` is the safe form if some of that content is
executable, because capital `X` adds execute only where it already exists.

**It does not set permissions, only ownership.** A file that belongs to
`payroll` but is mode 0644 is still read-only to the group. What the group *may
do* with a new file is decided by the creator's umask, which is a completely
separate setting and a separate habit — see the umask card. Group ownership
without group write is the most common half-finished version of this task.

**It does not stop deletion.** Write permission on a directory is permission to
add and remove names in it, including names belonging to other people. In a
group-writable directory, every member can delete every other member's work
unless the sticky bit is set. Set-GID and sticky are a pair; `chmod 3770` is both
at once.

**It does not put anybody in the group.** `id -nG dana` is the check, and a
membership added with `usermod -aG` only reaches shells the user opens
*afterwards* — an existing login keeps the group list it started with. If
collaboration still fails after everything above looks right, have the user log
out and back in before you look for a deeper cause.

Two more behaviours worth knowing, because they look like the bit failing.
`mv` a file into a set-GID directory from elsewhere on the same filesystem and
the group does **not** change: nothing was created, the same inode was relinked,
and it carries its old ownership with it. `cp` creates a new file, so `cp`
inherits and `mv` does not. And a *default ACL*
(`setfacl -d -m g::rwx /srv/payroll`) is not an alternative to set-GID: it sets
the **permissions** new files get, overriding the umask, but it does not change
their group. The two solve different halves of the same problem, and neither
replaces the other.

Finally, the only real verification is behavioural. `ls -ld` proves the bit is
set; it does not prove collaboration works. Create a file as one member, `ls -l`
it, and then try to delete it as the other.
