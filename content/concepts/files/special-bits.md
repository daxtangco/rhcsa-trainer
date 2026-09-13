---
id: files.special-bits
title: The fourth digit - setuid, setgid, sticky
rhel: 9
objectives: [files.permissions.ugo-rwx, files.permissions.set-gid, files.permissions.troubleshoot]
sources: [r9:ch7, r10:ch7]
---
A file's mode is four octal digits, not three. `chmod 755` is shorthand for
`chmod 0755`, and that leading zero is a real field: **4 is setuid, 2 is setgid,
1 is the sticky bit.** They are usually zero, which is why the whole digit
tends to be invisible until a task needs it.

The single most important thing about these three bits is that **what they mean
depends on what they are attached to**, and that several combinations mean
nothing at all:

| | on an executable file | on a directory |
|---|---|---|
| setuid (4) | runs as the file's owner | nothing on Linux |
| setgid (2) | runs as the file's group | new files inherit the directory's group |
| sticky (1) | nothing on Linux | only the owner of a file may delete it |

`/usr/bin/passwd` is mode 4755: any user runs it, but it runs as root, because
editing `/etc/shadow` needs root and the whole point is that you may change your
own password without being root. `/tmp` is mode 1777: everyone may write there,
and the sticky bit is what stops one user deleting another user's files.
Those two are worth memorising as anchors — when you cannot remember which bit
is which, `ls -ld /usr/bin/passwd /tmp` tells you.

You read them in `ls -l` in the *execute* column of the field they belong to,
because they have nowhere else to live: setuid replaces the user `x` with `s`,
setgid replaces the group `x` with `s`, and sticky replaces the other `x` with
`t`. So `drwxrws--T` is a directory with setgid and sticky set, and — read the
capital `T` — **without** execute permission for others.

That capitalisation is the diagnostic. **A capital `S` or `T` means the special
bit is set but the underlying execute bit is not.** `drwxr-S---` is a set-GID
directory the group cannot enter, which is almost never what anybody wanted.
When a shared directory does not work and the mode "looks right", check the case
of that letter first.

Setting them is either numeric or symbolic: `chmod 2770 dir` and
`chmod g+s dir` reach the same place, as do `chmod 1777 dir` and `chmod +t dir`.
Symbolic is the safer habit for exactly one reason, and it is the trap in this
whole area: **a numeric `chmod` sets all four digits, including the ones you did
not type.** Running `chmod 770` on a set-GID directory silently clears the
set-GID bit, because you asked for `0770`. Every "it was working yesterday"
collaboration directory has been through this.

Finding them is a `find` question, and the three `-perm` forms are not
interchangeable. `-perm -4000` matches files with *all* of the named bits,
`-perm /6000` matches files with *any* of them (setuid **or** setgid), and a bare
`-perm 4000` matches files whose mode is *exactly* that and nothing else, which
is almost never a useful question. `sudo find / -type f -perm /6000` is the audit
worth knowing by heart.

Last, a thing people lose an hour to: **the Linux kernel ignores setuid and
setgid on scripts.** `chmod u+s /usr/local/bin/backup.sh` sets the bit, `ls`
shows it, and nothing whatsoever happens when the script runs — the interpreter
named in the `#!` line is what actually gets executed, and it is not setuid. The
answer to "this script needs to run as someone else" is `sudo` and a rule in
`/etc/sudoers.d`, never the setuid bit.
