---
id: net.ssh-keypairs-and-authorized-keys
title: Two files, and only one of them ever leaves the machine
rhel: 9
objectives: [net.ssh.key-auth]
sources: [r9:ch20, r10:ch20]
prerequisites: [net.service-reachability, files.directory-permission-semantics]
---
`ssh-keygen` writes two files whose names differ by four characters, and the whole
subject is knowing which is which. `~/.ssh/id_ed25519` is the **private** key: it
stays on the machine you log in *from*, it is never copied anywhere, and if it ever
leaves you generate a new pair rather than trying to get it back.
`~/.ssh/id_ed25519.pub` is the **public** key, one line of text, and it is meant to
be handed out.

The public key goes into `~/.ssh/authorized_keys` **in the home directory of the
account you want to log in as, on the machine you are logging in to**. Read that
sentence twice: the file belongs to the destination account, not to yours. Logging
in as `deploy` on a host means the key lands in `~deploy/.ssh/authorized_keys` on
that host. `authorized_keys` is a list — one public key per line, several lines
allowed, and adding a key means **appending**:

```
ssh-keygen -t ed25519 -N '' -C 'student@lab for deploy'   # -N '' = no passphrase
ssh-copy-id deploy@host                                    # the whole job, if you can log in
cat ~/.ssh/id_ed25519.pub | ssh deploy@host 'cat >> ~/.ssh/authorized_keys'
```

`ssh-copy-id` is the tool to reach for. It logs in the ordinary way once, appends
the public key, and creates the directory with the right mode — three things people
get wrong by hand. It needs some existing way in (usually a password) for that one
connection. Where there is none, someone with root on the destination puts the file
in place instead.

**`>` instead of `>>` is a revocation.** It silently deletes every key already
trusted by that account, which on a shared or automated login means whoever else
used it is now locked out. There is no warning and nothing in the file to say what
was there before.

Two mistakes account for most failures. The first is installing the **private** key
as `authorized_keys` — it is in the right place with the right mode and it cannot
work, because the file is a list of one-line public keys and a private key is a
multi-line PEM block. The give-away is the first line: `-----BEGIN OPENSSH PRIVATE
KEY-----`. Worse than not working, the private key is now sitting in another
account. The second is the passphrase. `ssh-keygen` offers one, and for your own
key you should take it — but a passphrase is a *prompt*, and an unattended job has
nothing to type into. Either the key for that job has no passphrase (`-N ''`) or a
human loads it into `ssh-agent` once per session, which is exactly what a cron job
or a systemd timer cannot do. `ssh-add` and `ssh-agent` are per-session and do not
survive a reboot; a key file does.

The private key's own mode is checked too, and by the **client**, before anything is
sent: if any group or other bit is set on it, `ssh` prints `UNPROTECTED PRIVATE KEY
FILE` and refuses to use that key. `ssh-keygen` creates it 0600 and nothing needs
doing — but a key copied about with `cp` under a loose umask, or one `chmod`-ed by
someone who thought the *server* wanted to read it, is silently not offered, and the
server's answer is the same `Permission denied` as if no key existed at all.

Lost the `.pub` file? It is not lost, it is derivable: `ssh-keygen -y -f
~/.ssh/id_ed25519` prints the public half from the private key. And when a login
fails, `ssh-keygen -lf` on both ends shows fingerprints you can compare, which
answers "is this the same key" without eyeballing base64.

One last habit: `ssh` only offers the **default** identity filenames
(`id_ed25519`, `id_rsa` and a few others) unless it is told otherwise. A key called
`deploy_key` is not tried at all — it needs `-i` on every command, or an
`IdentityFile` line under a `Host` stanza in `~/.ssh/config`. That file is
client-side, in your own home, and is not a change to the SSH server.
