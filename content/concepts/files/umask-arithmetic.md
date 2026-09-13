---
id: files.umask-arithmetic
title: umask is a mask, not a subtraction
rhel: 9
objectives: [files.permissions.umask, files.permissions.ugo-rwx, files.permissions.troubleshoot]
sources: [r9:ch7, r10:ch7]
prerequisites: [files.special-bits]
---
The umask is **process state**, not a file. Every process has one, every child
inherits its parent's, and it lists the permission bits to *remove* from
anything that process creates. Nothing consults it afterwards: it decides the
mode a file is born with and then has no further say.

The starting point is not 777. A program asks the kernel for the mode it wants,
and the conventions are **0666 for a regular file and 0777 for a directory** —
which is why a new file is never executable no matter what your umask is, and
why the same umask produces 0644 files but 0755 directories.

And it is a mask, not a subtraction. The kernel computes `requested & ~umask`:

```
umask 022   ->  files 666 & ~022 = 644     dirs 777 & ~022 = 755
umask 002   ->  files 666 & ~002 = 664     dirs 777 & ~002 = 775
umask 007   ->  files 666 & ~007 = 660     dirs 777 & ~007 = 770
umask 023   ->  files 666 & ~023 = 644     dirs 777 & ~023 = 754
```

That last line is the one that proves the point. Subtracting would give 643;
masking gives 644, because the execute bit the mask removes was never requested
for a file in the first place. Think "which bits does this forbid", never "what
do I take away from 666".

So the four values worth recognising on sight: `022` denies group and other
write — the general-purpose default. `002` denies only other write, so new files
are group-writable. `007` denies the group nothing and outsiders everything,
which is the collaboration value. `077` is the private-files value: 600 and 700.

**Where it comes from on RHEL 9 matters more than the arithmetic**, because this
is where "I set it and it did not take" comes from. In order, each overriding the
last for a bash login shell:

1. `pam_umask`, listed in `/etc/pam.d/postlogin` and reached by every real login,
   using the `UMASK` line in `/etc/login.defs` — `022` as shipped. On RHEL 9 this
   is the **only** thing that sets a umask before your shell starts.
2. `/etc/profile`, which sources `/etc/profile.d/*.sh`. This is the first point in
   the chain you can change, and a drop-in here is the system-wide answer.
3. `~/.bash_profile`, which on RHEL sources `~/.bashrc`, which sources
   `/etc/bashrc`. Last writer wins, so a line at the end of `~/.bash_profile`
   beats everything above it.

If you are coming from RHEL 7 or 8, unlearn one thing here. Those releases put an
explicit rule in `/etc/profile` — umask `002` if your UID was above 199 *and* your
primary group name matched your user name, `022` otherwise — and that is where the
familiar "ordinary users get 002, root gets 022" came from. **RHEL 9's
`/etc/profile` has no `umask` line in it at all.** `grep umask /etc/profile`
returning nothing is the file being correct, not you looking in the wrong place.
`/etc/bashrc` does still mention `umask`, but only in one line that sets `022`
when the current umask is literally `0`, and only for non-login shells: it is a
floor for an unset value and it will not overwrite one you chose.

So the RHEL 9 consequence is the reverse of the old one: `/etc/login.defs` is now
the only default, and changing `UMASK` there really does change what people get at
login. **It is still usually the wrong place to change it**, for two reasons that
have nothing to do with precedence. It is machine-wide — every account on the box,
which is rarely what a request naming one team means — and it only applies where
`pam_umask` is in the PAM stack, so a real `ssh` or console login picks it up
while `sudo -u alice bash -l` does not, because `/etc/pam.d/sudo` does not include
`postlogin`. A startup file is read by every shell the user opens however they got
in. That is what makes it the durable answer, and it is the change to reach for.

Which startup file, and the detail that silently costs people the whole job:

```
# System-wide. The .sh suffix is MANDATORY: /etc/profile sources
# /etc/profile.d/*.sh, so a file named payroll-umask is never read by anything.
cat > /etc/profile.d/payroll-umask.sh <<'EOF'
if id -nG | tr ' ' '\n' | grep -qx payroll; then
    umask 007
fi
EOF
chmod 0644 /etc/profile.d/payroll-umask.sh

# Or per user. Appended, so it is the last umask the login shell runs.
echo 'umask 007' >> ~dana/.bash_profile
```

The `if` earns its place as much as the suffix does. A bare `umask 007` in
`/etc/profile.d/` changes the default for *every* account including root's and
your own; making it conditional on group membership is how one team gets a
collaboration umask and nobody else is touched. `umask u=rwx,g=rwx,o=` in place of
`umask 007` is the same instruction and equally correct — see the symbolic form
below. And a drop-in has to be **readable** (`/etc/profile` skips anything it
cannot read) but does *not* have to be executable: it is sourced, not run.

There is also a symbolic form, and it is inverted relative to the numeric one:
`umask 007` and `umask u=rwx,g=rwx,o=` are the same instruction, but the numbers
name the bits to **remove** and the letters name the bits to **keep**. `umask -S`
prints the current setting in that keep-form. Both are correct; mixing up which
notation you are in is a reliable way to grant the opposite of what you meant.

The classic mistake is not arithmetic at all: **typing `umask 007` at a prompt
and considering the job done.** It applies to that shell and the processes it
starts, and it dies with the shell — nothing on disk changed, no other login sees
it, and a reboot certainly does not bring it back. A umask that is part of a
system's configuration lives in a startup file, and the way to check it is to
open a *fresh login shell* as that user — `sudo su - dana -c umask` — not to run
`umask` in your own. The `-` is the whole test: without it `su dana -c umask` does
not read the login startup files and tells you nothing about the change you just
made. Check it as each user you were asked about, not just the first one.

Two other blind spots worth carrying: programs that state a mode explicitly
ignore the umask entirely (`install -m 0644`, `mkdir -m 2770`, `tar`, `rsync`
and `cp -p` restoring stored modes), and a **default ACL** on the parent
directory takes precedence over it. If a new file's mode does not match the umask
you just set, `getfacl` on the directory is the next thing to look at.
