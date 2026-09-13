---
id: tools.ssh-client-and-remote-copy
title: One connection, four front ends, and the flag each of them hides
rhel: 9
objectives: [tools.ssh.client, tools.ssh.transfer]
sources: [r9:ch5, r10:ch5]
prerequisites: [net.ssh-keypairs-and-authorized-keys, tools.archive-tar-and-compression]
---
`ssh`, `scp`, `sftp` and `rsync -e ssh` are four interfaces to **one** thing: an
authenticated channel to an account on another machine. Same port, same host key,
same `~/.ssh/config`, same key. Since OpenSSH 9.0 `scp` does not even have a
protocol of its own — its own manual page says it "uses the SFTP protocol over an
ssh connection for data transfer", with `-O` there to force the legacy one for
servers that cannot do better. So a key that works for `ssh` works for all of them,
and a connection problem is one problem no matter which of the four surfaced it.

`ssh user@host` opens a login shell. `ssh user@host 'command'` runs one command and
comes straight back — **no TTY**, and a non-login shell, which is why a `PATH` or an
alias that works when you log in can be missing when you do this. `-t` forces a
terminal for something that insists on one; `-T` refuses one. `ssh` exits with **the
remote command's own exit status**, or 255 when ssh itself failed, so remote commands
compose into scripts and `|| exit` does what you expect. Quote the remote command:
everything inside the quotes is interpreted by the *remote* shell, so `ssh host 'ls
~/reports'` expands `~` there and `ssh host "ls $HOME/reports"` expands it here.

**`ssh` reads standard input and passes it to the remote command**, and that is the
one behaviour that ruins scripts. A script fed to `bash` on stdin, or any loop whose
body contains `ssh`, loses the rest of its input to the first connection — the loop
runs once and stops, with no error. `-n` is the documented cure ("prevents reading
from stdin"), and `< /dev/null` is the same cure spelled at the shell. Two other
options belong in every unattended invocation: `-o BatchMode=yes`, which turns "it
asked me for a password" into a non-zero exit instead of a hang, and
`-o ConnectTimeout=10`, because the default wait for an unreachable host is long
enough to look like a hung script.

A key with a non-default filename is **not offered** unless you say so: `-i
~/backup-key` on every command, or an `IdentityFile` line under a `Host` stanza in
`~/.ssh/config`, which is client-side, lives in your own home, and is not a change to
any server. `HostName`, `User`, `Port` and `IdentitiesOnly` go in the same stanza, so
`ssh backup` can carry all of it.

```
scp -i ~/backup-key -p file.tar.gz backupop@host:/home/backupop/   # one file, up
scp -pr /srv/reports backupop@host:/home/backupop/                 # a tree
sftp -b batch.txt -i ~/backup-key backupop@host                    # scripted
ssh -n backupop@host 'tar -xpzf ~/file.tar.gz'                     # act on the far end
```

**`scp -p` and `scp -P` are different flags and the manual says why**: `-p`
"preserves modification times, access times, and file mode bits from the source
file", and the port is capital `-P` "because `-p` is already reserved". Without `-p`
every file on the far side is created fresh, so its timestamp is the moment of the
copy and its mode is subject to the receiving umask — the same loss `cp` has without
`-p` and `tar` without `-p`, in the third tool that spells it the same way. `-r`
recurses, and note what its own manual warns: `scp` **follows symbolic links** during
the traversal, so a tree of links becomes a tree of duplicates.

**`scp -p` is still not `tar -p`, and the gap is the reason to archive a tree rather
than copy it.** Measured on this system's `scp` 9.9p1 against the shipped
`/usr/libexec/openssh/sftp-server`: `-p` and `-pr` carry the modification times and
the **low nine** permission bits faithfully — 0660 arrives 0660 — but `setuid` and
`setgid` are dropped, silently, with a zero exit status. 2750 arrived as 0750, 4750
arrived as 0750, and a 2775 directory arrived as 0775. That is a limit of the
protocol's transfer path, not a permission problem: `chmod 2750` typed at an `sftp`
prompt on the same connection, as the same user, against the same file sets the bit
and it sticks. Without `-p` you lose the timestamps too and files pick up the
receiving umask (0660 arrives 0640), but the high bits were already gone either way.
One trap if you measure this yourself: `scp` between two *local* paths is not an SFTP
transfer at all, and it preserves everything — a test with no `host:` in it will tell
you the opposite of the truth.

Past the high mode bits, what `-p` does **not** carry is everything outside the three
claims its manual makes. Ownership is not on that list, and no SFTP transfer sets it:
files arrive owned by the account you authenticated as. Neither are ACLs, extended
attributes, SELinux labels, hard links or sparseness. And `-r` resolves symbolic
links into copies of what they point at. What does carry all of it is an archive:

```
tar -czf - -C /srv reports | ssh -n host 'tar -xpzf - -C /var/backups'
```

One stream, no temporary file, and the flags that preserve attributes are tar's,
which has them. The mirror image — `ssh -n host 'tar -czf - -C /srv reports' >
local.tar.gz` — pulls instead of pushes. Both are the idiom worth memorising, and
both are why "compress the tree, then transfer one file" is the normal shape of a
handover rather than a formality.

`sftp` is the same protocol driven interactively, with `get`, `put`, `ls`, `mkdir`
and `chmod` at a prompt. It scripts through `-b batchfile`, which its manual notes
**aborts on the first failed** `put`, `get`, `mkdir` or `rename` — so a batch that
finished did everything in it, which is a stronger guarantee than a shell script
without `set -e`. `put -p` is where the preserve flag lives on that side, with exactly
the same nine-bit limit — which is why an `sftp` batch that has to land a `setgid`
directory needs an explicit `chmod` line after the `put`. `rsync -a
-e ssh` is the better tool for a tree if it is installed at both ends: `-a` carries
modes, times, symlinks and ownership-if-root the way `cp -a` does, and it copies only
differences on the second run.

Two last practicalities. The first connection to a host asks you to confirm a host
key fingerprint and records it in `~/.ssh/known_hosts`; when a recorded key later
changes, `ssh` refuses to connect and prints a long warning, and the honest response
is to find out why rather than to delete the line. And a client that "cannot log in"
is worth splitting in two before you debug it: `ssh -v` shows which keys were
offered and which authentication methods the server allowed, while the *server's*
reason for refusing a key it did not like is only ever in the server's log —
`journalctl -t sshd -t sshd-session` on the destination, or `/var/log/secure`. The
client is told `Permission denied (publickey)` for four different mistakes, and the
log is where they are told apart.
