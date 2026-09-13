---
id: users.login-shells-and-su
title: Login shell, interactive shell, and why su - is not su
rhel: 9
objectives: [users.login.switch, users.sudo.superuser, files.permissions.umask]
sources: [r9:ch5, r10:ch5]
prerequisites: [users.sudoers-and-wheel]
---
Bash reads a different set of startup files depending on **how it was started**,
and three kinds matter. Almost every "I changed the setting and it had no effect"
is a person editing a file that the shell they tested in never reads.

A **login shell** reads `/etc/profile` (which sources `/etc/profile.d/*.sh`) and
then the first of `~/.bash_profile`, `~/.bash_login`, `~/.profile` that exists. On
RHEL, `~/.bash_profile` sources `~/.bashrc`, which sources `/etc/bashrc`, so a
login shell ends up reading everything.

An **interactive non-login shell** reads `~/.bashrc` only, and `/etc/bashrc`
through it. Nothing in `profile` is consulted. This is what you get by typing
`bash`, or from a new tab in a desktop terminal.

A **non-interactive shell** — a script, a cron job, `ssh host command` — reads
*neither*. That is why a `PATH` your `.bashrc` extends is absent under cron, and
why absolute paths are the rule in anything scheduled.

Which one you get is not obvious, and this is the table worth memorising:

```
ssh user@host          login shell
ssh user@host command  non-interactive, no startup files
su bob                 interactive, NOT a login shell
su - bob               login shell  (same as su -l bob)
sudo -i                root's login shell
sudo -s                root's shell, not a login shell
sudo command           the command itself; no shell startup files at all
```

`su bob` gives you bob's shell while keeping most of your environment and your
working directory. `su - bob` starts over as bob: his `PATH`, his `HOME`, his
startup files, his home directory as the cwd. The dash is not cosmetic.

**Which makes the dash the whole test when you verify a per-user change.** Put
`umask 007` in `~dana/.bash_profile` and the only thing that proves it took effect
is a shell that reads `~dana/.bash_profile`:

```
sudo su - dana -c umask     # reads dana's profile: this is evidence
sudo su   dana -c umask     # does not read it: this is nothing
```

The second command prints a value — the umask it inherited from *your* shell — so
it looks like an answer. It is the same trap for `PATH`, for anything set in a
profile, and in the other direction for aliases, which live in `.bashrc` and are
never seen by a script no matter how you start it. And when a task names two
users, check both: the file you edited for dana says nothing about erik.

The other half of the objective is who may become whom. **`su` asks for the target
account's password** — plain `su` means root's — while **`sudo` asks for your own**
and is governed by `/etc/sudoers`. On RHEL that is why `sudo -i` is the idiomatic
way to get a root shell and `su -` usually is not: a member of `wheel` needs no
root password at all, and on many builds root has no usable password to type.

Two small things that mislead people. `echo $SHELL` prints the login shell
recorded in `/etc/passwd`, not the shell you are actually running — `ps -p $$`
answers that. And `whoami` reports the *effective* user, so it says `root` inside
`sudo -i` and tells you nothing about who you were before — `sudo` records that in
`$SUDO_USER`, which is the variable to reach for in a script that needs to know.
When a question is about "switching users in multiuser targets", those are the
commands that distinguish "I am bob now" from "I ran one thing as bob".
