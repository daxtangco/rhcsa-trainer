---
id: net.ssh-permissions-and-strictmodes
title: The key is right and sshd will not tell you why it refused
rhel: 9
objectives: [net.ssh.key-auth]
sources: [r9:ch20, r10:ch20]
prerequisites:
  [net.ssh-keypairs-and-authorized-keys, files.directory-permission-semantics, selinux.fcontext-vs-chcon]
---
The public key is in `~deploy/.ssh/authorized_keys`, it is the right key, the file
is plainly there — and the login is refused with `Permission denied (publickey)`.
That message is the same three words you get when no key was installed at all,
which is why this failure eats afternoons.

sshd has a setting called `StrictModes`, it is **on** by default, and it means: I
will not read a key file that somebody other than its owner could have written.
Before authenticating, sshd walks up from `authorized_keys` through `~/.ssh` to the
account's **home directory and stops there** — `/home` and `/` are not its
business. Each of those three must be owned by that user or by root, and none of
them may be writable by group or other. If one is, the key is ignored. Not
reported — ignored. The reasoning is sound: if your colleague can write to
`~/.ssh`, your colleague can add their own key and become you.

Be precise about what that check is, because it is narrower than the advice: sshd
objects only to the **write** bits. A world-readable `authorized_keys` (0644)
authenticates fine. The modes below are what `ssh(1)` and `sshd(8)` *recommend* and
what an exam answer should show, and they are stricter on purpose — a readable key
list is a list of who may enter:

```
drwx------  deploy deploy  /home/deploy          # sshd only requires: no g/o write
drwx------  deploy deploy  /home/deploy/.ssh     # 0700
-rw-------  deploy deploy  .../authorized_keys   # 0600
```

Group write is the trap, and it arrives through a plausible decision: "the ops team
maintains this account, so let the group write to it." Correct for a shared
configuration directory, fatal here. Note also that sshd accepts ownership by the
user *or* root, so a file dropped in place with `sudo` and never chowned often
works — but an account that cannot manage its own key list is a half-finished
hand-over, so make it the user's.

**Where the answer actually is**: once the client has offered a key, all it is ever
told is `Permission denied`. The reason is in sshd's own log on the server.

```
sudo journalctl -u sshd -n 20
sudo grep -i 'bad ownership or modes' /var/log/secure
```

sshd names the directory and the reason in as many words. One `journalctl` is worth
ten minutes of re-reading the key file.

There is a second failure with identical symptoms and a different cause: the
**SELinux label**. `~/.ssh` and its contents are `ssh_home_t`, and that is the type
the policy has sshd in mind for. A directory created in place gets it automatically —
the policy has a rule for a directory named `.ssh` under a home — but a label
belongs to the inode and travels with the file, so anything *moved* in from
elsewhere (`mv`, `cp -a`, `cp --preserve=context`, a tar unpacked with `--selinux`)
arrives wearing the label of where it came from. `ls -l` shows perfection. `ls -lZ`
shows the label from somewhere else, and `restorecon -R -v ~/.ssh` fixes it.
Ask before you guess:

```
sudo ls -lZ /home/deploy /home/deploy/.ssh
sudo restorecon -n -v /home/deploy/.ssh     # -n: would relabel, changes nothing
```

One correction worth carrying, because the usual example of this is out of date: on
RHEL 9 a key **moved in from `/tmp`** keeps `user_tmp_t` and sshd reads it anyway —
the shipped policy grants sshd both `open` and `read` on that type, so the classic
`/tmp` story produces a wrong label with no refusal attached. The staging places that
do produce the refusal are the ones outside any home tree: `/root` (`admin_home_t`),
a data directory (`var_t`), an unlabelled restore. Which is the real lesson — **the
label being wrong and the login being refused are two different findings.** Fix a
wrong label because it is wrong; do not conclude from a working login that the labels
were right.

The instinct to reach for `setenforce 0` when the modes look right is the trap this
subject sets. It makes the login work instantly — which *confirms* the diagnosis and
rewards the wrong fix — and it changes only the running kernel. `/etc/selinux/config`
still says `enforcing`, so the next reboot brings the refusal back on a machine that
now looks untouched, and the person debugging it will not be you.

`StrictModes no` is the other wrong fix, for the same reason and worse: it turns off
a check for every account on the host to paper over the modes of one directory.
Diagnose in this order — modes and owner, then label, then sshd's log — and neither
temptation comes up.
