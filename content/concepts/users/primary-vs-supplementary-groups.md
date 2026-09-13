---
id: users.primary-vs-supplementary-groups
title: One primary group, any number of the others
rhel: 9
objectives: [users.groups.manage, users.accounts.manage]
sources: [r9:ch6, r10:ch6]
prerequisites: []
---
A user's group memberships are stored in **two different files**, and which file a
membership lives in is what makes it primary or supplementary. That single fact
explains why the commands differ, why one of them is dangerous, and why a change
that clearly worked appears not to have.

The **primary group** is one GID, in field 4 of the user's line in
`/etc/passwd`. There is exactly one, always. It is the group that will own the
files this user creates — unless the directory is set-GID, which is a different
card — and it is what `id -gn` prints.

**Supplementary groups** are the user's name appearing in the member list of a
line in `/etc/group`. There can be any number, they grant access and nothing
else, and no file anywhere records them as belonging to the user: the group is
the thing that lists its members, not the other way round. So `getent group
devops` is how you check "who is in devops", and `id bob` is how you check "what
is bob in" — two questions, two commands, both reading the same data from
opposite ends.

RHEL's `useradd` creates a private group named after each user and makes it that
user's primary group, so `bob`'s primary group is normally `bob`. That is a
configured default (`USERGROUPS_ENAB` in `/etc/login.defs`, with `useradd -N` and
`useradd -g` to override per account), so read the file rather than trusting the
convention on a machine you did not build.

**The destructive typo, and it is silent:**

```
usermod -aG devops bob     # add bob to devops, keep what he had
usermod -G devops bob      # bob is now in devops and NOTHING ELSE
```

`-G` sets the complete list of supplementary groups. Without `-a` it removes
every membership you did not name, `usermod` reports nothing, and the damage
surfaces later as "bob cannot sudo any more" — because `wheel` was one of the
memberships that quietly went away. If that risk bothers you, `gpasswd -a bob
devops` and `gpasswd -d bob devops` cannot express it: they only ever add or
remove one membership. `usermod -g devops bob` (lower case) changes the *primary*
group, which is a different request again.

**Membership is decided when the session starts.** The kernel hands a process its
set of supplementary GIDs at login and never revisits it, so a shell bob already
had open does not gain the new group — `id` inside it keeps telling the truth
about a session that began before your change. He logs out and back in, or runs
`newgrp devops` in that shell to start a new one. Testing your own change in a
terminal you opened ten minutes ago is how people conclude `usermod` did not
work.

Creating and changing groups is the small part. `groupadd -g 5000 devops` when a
GID is specified, plain `groupadd devops` for the next free one above `GID_MIN`.
`groupmod -n newname devops` renames: harmless, because **files store the GID, not
the name**. `groupmod -g` changes the GID, which is the opposite — every file the
group owned is now owned by a GID nothing resolves, and `ls -l` starts printing a
number. `groupdel` refuses to remove a group that is some user's primary group,
which is a guard rather than an obstacle: it is telling you an account would be
left pointing at a GID that does not exist.
