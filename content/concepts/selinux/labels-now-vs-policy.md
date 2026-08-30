---
id: selinux.labels-now-vs-policy
title: The label on the file and the label the policy wants
rhel: 9
objectives: [selinux.contexts.restore]
sources: [r9:ch22, r10:ch22]
---
There are two answers to "what is the SELinux context of this file", and
knowing which one you are looking at is most of SELinux troubleshooting.

**The label right now** is stored in an extended attribute on the inode. See it
with `ls -Z`, `stat -c %C`, or `ps -Z` for processes. `chcon` writes this
attribute directly.

**The label the policy wants** comes from a database of path patterns, most of
it shipped by the distribution and the rest of it yours. See what the policy
would assign with `matchpathcon /path` (or `semanage fcontext -l` to read the
rules themselves). `semanage fcontext -a` adds to this database.

`restorecon` is the bridge: it asks the policy what the label should be and
writes that onto the inode. `restorecon -Rv /srv/web` after a `semanage
fcontext -a` is the normal two-step, and the reason for the two steps is that
the first one changes what *should* be true and the second makes it true.

This is why `chcon` is a trap. It works. The site comes up. It survives
reboots. And then someone runs `restorecon`, or the filesystem gets relabelled
after a policy update, or a file is created fresh in that directory — and the
label reverts to whatever the policy says, because the policy never knew about
your change. A `chcon` fix is a fix with a fuse on it. Use `chcon` to test a
hypothesis in ten seconds; use `semanage fcontext` + `restorecon` to fix
anything you intend to keep.

Two more things worth knowing. A **file inherits the label of the directory it
is created in**, which is why copying a file into a directory gives it the
right label and moving one in with `mv` does not — `mv` preserves the
attribute. And an **equivalence rule**, `semanage fcontext -a -e /var/www/html
/srv/web`, says "label this tree exactly the way you label that one". It is
shorter and more accurate than reproducing a set of type rules by hand, and it
is a completely legitimate answer that looks nothing like the type-rule answer.

When a service cannot read a file it plainly has Unix permission to read, the
sequence is: `ls -Z` the file, `matchpathcon` the file, and if they disagree run
`restorecon`. If they agree and it still fails, the problem is not the file
label — look at `ausearch -m AVC -ts recent` and at the booleans.
