---
id: users.shell-field-and-locked-accounts
title: Two fields decide whether an account can log in
rhel: 9
objectives: [users.login.switch, users.accounts.manage]
sources: [r9:ch6, r10:ch6]
prerequisites: [users.shadow-aging-fields]
---
"This account cannot log in" is almost never mysterious. Two fields in two files
decide it, they are independent of each other, and both are one command to read:
**field 7 of the `/etc/passwd` line** — the login shell — and **field 2 of the
`/etc/shadow` line** — the password. An account can have a perfect password and no
shell, or a perfect shell and no password, and the two failures look identical from
the login prompt.

```
getent passwd dana        # dana:x:1001:1001::/home/dana:/bin/bash
sudo getent shadow dana   # dana:$y$j9T$…:20340:0:99999:7:::
```

**Field 7 is a program, not a label.** `login` runs it, and whatever it does is
what logging in does. `/sbin/nologin` prints one polite line and exits, which is
how every service account on the machine is prevented from being a person; the
account is otherwise entirely healthy. `/bin/false` is the same idea with no
message. Neither is damage, and neither is fixed by anything to do with passwords.
Change it with `usermod -s /bin/bash dana` or `chsh -s /bin/bash dana`.

Two things about that field mislead people. `/etc/shells` is a *list of shells
users may choose for themselves* — `chsh` consults it for a non-root user and some
services check it — and `login` does not consult it at all, so being absent from
`/etc/shells` is not what stops a login. And `echo $SHELL` prints the shell
recorded in `/etc/passwd`, not the shell you are running: after `su -s /bin/sh
dana` the two disagree, and `ps -p $$` is the one that answers honestly.

**Field 2 has five states and only one of them is a password.** Reading it is the
whole skill:

```
$y$…  or  $6$…    a hash: yescrypt or SHA-512. This account can authenticate.
!!                no password has ever been set. What useradd writes.
!$y$…             locked: the hash is intact with a ! glued in front of it.
*                 disabled by policy, never intended to authenticate.
(empty)           NO password required. Anyone who reaches the prompt is in.
```

`passwd -S dana` prints the same fact in words, in a second field that reads `PS`
for a usable password, `LK` for locked and `NP` for none. Two details worth having,
both from the implementation RHEL 9 actually ships — `/usr/bin/passwd` comes from
the libuser-based `passwd` package, not from shadow-utils, and its
`pwdb_display_status` is what decides these (`libuser.c:281-311`). First, the token
is `PS`, not the `P` that shadow-utils' own `passwd` would print; RHEL 9 never
prints a bare `P`. Second, the mapping to the table above is not one-to-one:
*anything* beginning with `!` reports `LK`, so the `!!` of an account that has never
had a password reports locked rather than `NP`, and `NP` is reserved for a field
that is genuinely empty — the one case that lets anybody in. So `LK` answers
"cannot log in with a password" without distinguishing never-set from
deliberately-locked; field 2 itself, read directly, is what tells those apart. And
`passwd -l` / `usermod -L` produce the `!` prefix rather than destroying the hash —
which is why unlocking restores the old password instead of clearing it. It also
explains a message that reads like a bug: `passwd -u` on an account whose field is
`!!` refuses, because removing the `!` from `!!` leaves an empty field, and an
empty field means passwordless login. It is protecting you.

**`usermod -p` does not take a password.** It takes an already-encrypted string and
writes it into field 2 verbatim, so `usermod -p 'Secret123' dana` produces an
account whose recorded "hash" is that plaintext — and since `crypt(3)` cannot
produce that string from any input, the one password that will never work is
`Secret123`. Nothing warns you, the field is neither empty nor `!`-prefixed, and
every quick check says the password is set. Set passwords with `passwd dana`,
`echo 'Secret123' | passwd --stdin dana`, or `echo 'dana:Secret123' | chpasswd`,
and reach for `usermod -p` only with the output of something like
`openssl passwd -6`.

Last, **a locked password is not a locked account.** It stops password
authentication and nothing else: an SSH key still works, and `su - dana` from root
never asks for a password in the first place. Locking an account so it stays locked
means the password *and* an expiry — `chage -E 0 dana` — and if you want it to have
no way to run a shell either, field 7 as well. On the exam, "so-and-so must not be
able to log in" is a question about how many of those three you thought of.
