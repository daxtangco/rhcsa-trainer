---
id: users.account-creation-defaults
title: What useradd decides for you
rhel: 9
objectives: [users.accounts.manage, users.passwords.aging]
sources: [r9:ch6, r10:ch6]
prerequisites: [users.shadow-aging-fields, users.primary-vs-supplementary-groups]
---
`useradd bob` is one word and about eight decisions. Every one of them has a
default written down in a file you can read, which turns "what did that just do"
into a two-command question:

- **`/etc/default/useradd`** — the login shell, the skeleton directory, the base
  directory homes are made under, and the defaults for the inactive and expiry
  fields. `useradd -D` prints it.
- **`/etc/login.defs`** — the UID and GID ranges, whether a home directory is
  created, the password-aging defaults (`PASS_MAX_DAYS` and friends), the umask,
  and the hashing method used for new passwords.

**Those defaults are read at creation time and never again.** Change
`PASS_MAX_DAYS` and not one existing account moves; accounts made afterwards get
the new value. `/etc/skel` is the same story in a more concrete form — its contents
are *copied* into the new home directory, so a file you add to `/etc/skel` next
week does not appear in a home directory made today. Both of these feel like a
change that failed. Neither is: they are changes that were never retroactive.

**A brand new account cannot log in.** `useradd` writes `!!` into the password
field of the `/etc/shadow` line, which is neither a hash nor an empty field, and
means "no password has been set". Password authentication is refused until you
run `passwd bob`. Creating users and then discovering they cannot log in is
overwhelmingly this and nothing more subtle. For scripted work, `echo 'secret' |
passwd --stdin bob`, or `chpasswd` when there is a list of them.

Three options look like dates and land in three different fields — this is the
distinction worth being fluent in, because a question about a contractor and a
question about a security policy sound alike and are not:

```
useradd -e 2027-06-30 carol   # account expiry, shadow field 8  (= chage -E)
useradd -f 7 carol            # inactive days after password expiry, field 7  (= chage -I)
chage -M 30 alice             # password maximum age, field 5   (from login.defs at creation)
```

Home directories: created from `/etc/skel` by default on RHEL, with `-m` and `-M`
to force the decision either way and `-d` to put it somewhere other than the
default base directory. The removal side is where the surprise lives. **`userdel
bob` leaves the home directory and its files behind**; `userdel -r` removes the
home directory and mail spool as well. What is left after a plain `userdel` is a
tree owned by a UID that no longer resolves, so `ls -l` prints a bare number — and
the next account created takes that UID and silently inherits everything the old
one owned. `find / -nouser` is how you find it later.

Service accounts are a different shape and `useradd -r` is the switch: it
allocates a UID from the system range below `UID_MIN` and, as `useradd(8)` puts it,
creates the account with no aging information. That is why `id -u` under 1000 is
the quick test for "this is not a person" — a distinction the exam cares about
because you must never hand a service account a password policy or a shell.

Read the result back rather than trusting the command: `getent passwd bob` for the
passwd line as the system resolves it, `id bob` for the groups, `chage -l bob` for
every aging field printed as dates, and `ls -la ~bob` for what `/etc/skel` gave
him.
