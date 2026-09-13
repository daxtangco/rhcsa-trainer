---
id: tools.archive-tar-and-compression
title: An archive that lost its permission bits looks perfect
rhel: 9
objectives: [tools.archive.tar]
sources: [r9:ch3, r10:ch3]
prerequisites: [files.copy-preserving-attributes, tools.redirection-and-streams]
---
`tar` does exactly one of three things per run, and the letter that says which comes
first: **`-c` create, `-x` extract, `-t` list.** `-f` names the archive file, and
everything else is a modifier. Compression is a separate idea bolted on: `-z` filters
the stream through `gzip`, `-j` through `bzip2`, `-J` through `xz`, and `-a`
(`--auto-compress`) picks one from the suffix you asked for. So `tar -czf x.tar.gz
dir` and `tar -caf x.tar.gz dir` produce the same file, and `tar -cf x.tar.gz dir`
produces an **uncompressed** archive with a lying name — nothing checks the
extension for you.

**Reading is more forgiving than writing, and that asymmetry catches people out.**
GNU tar identifies a payload from its magic number, so `-tf` and `-xf` with no
compression letter read gzip, bzip2, xz and plain archives alike. Measured on tar
1.34: a bzip2 archive named `.tar.gz` lists cleanly under `tar -tf`, while
`tar -tzf` on the same file exits 2 with `gzip: stdin: not in gzip format`. Naming
the compression when you read is therefore a *check* rather than a requirement, and
a cheap one: it is how you find out that the file somebody handed you is not what
its name claims.

```
tar -czf /tmp/etc.tar.gz -C /etc sysconfig   # create; stores sysconfig/...
tar -tzf /tmp/etc.tar.gz                     # list, insisting the payload is gzip
tar -xpzf /tmp/etc.tar.gz -C /restore        # extract, keeping the modes
```

**`-p` is the flag whose absence is invisible.** Without it, an ordinary user's
extraction applies the process umask to every file — RHEL 9 gives an SSH session
umask 022, so a 0660 file arrives 0640 and the group can no longer write to it — and
`setuid`/`setgid` bits are dropped **whatever the umask is**. That second half is
the one to remember: measured under umask 000, 002 and 022 in turn, mode 2750
arrived as 0750 every time, and `-p` restored it in all three. tar's own `--help`
states the rule outright: `--no-same-permissions` is "default for ordinary users"
and `-p` is "default for superuser". So the flag changes nothing when root extracts
and changes everything when you do, which is why it is missing from so many
working-looking commands.

Ownership is a different flag and a different privilege. `--same-owner` is the
superuser's default and `--no-same-owner` is yours; restoring an owner needs
`CAP_CHOWN`, so an unprivileged extraction *cannot* reproduce the original owners
and is not failing when it does not. **Modification times need no flag at all** —
tar restores those by default. That gives you a two-line diagnosis: right modes and
wrong times means the tree was copied rather than unpacked; wrong modes and right
times means the extraction forgot `-p`. The one answer that fools it is `scp -pr`,
which brings the times and the low nine bits and drops `setuid`/`setgid` anyway — so
when only the high bits are missing, ask whether a `tar` ran at all.

**`-C` is not a convenience, it decides what the archive contains.** tar stores the
member names you gave it, minus any leading `/` — with a warning it is easy to miss,
``tar: Removing leading `/' from member names`` — so `tar -czf x.tar.gz /srv/reports`
stores `srv/reports/...` and unpacks into `./srv/reports`. `-C /srv reports` stores
`reports/...` and unpacks into `./reports`; `-C /srv/reports .` stores `./ledger.csv`
and friends and unpacks **loose into wherever you are**. All three are legitimate
and each needs a different extraction. `tar -tf` before `tar -xf`, always: it is one
second, and it is the difference between unpacking a directory and scattering forty
files across your home. `--one-top-level` fixes it after the fact.

The compressors alone behave like nothing else in the toolkit: **`gzip file` replaces
`file` with `file.gz` and deletes the original.** `-k` keeps it, `-c` writes to
standard output and leaves it alone, `-d` (or `gunzip`) reverses it, `-1` through
`-9` trade speed for size. `bzip2` takes the same four. Both have `-t`, which is the
cheapest integrity check there is — measured on gzip 1.12, `gzip -t` exits 0 on a
complete member, 1 on a truncated one (`unexpected end of file`) and 1 on a payload
that is not gzip at all (`not in gzip format`), and only that first case can tell a
finished transfer from an interrupted one. When you need to know what a file really
is: `file` says so, and `od -An -tx1 -N4` shows you the bytes it read — `1f 8b` gzip,
`42 5a 68 39` bzip2, `fd 37 7a 58` xz, and an uncompressed tar with `ustar` at
offset 257 and nothing recognisable at all at the front.

SELinux labels and ACLs are **not** in an archive unless you asked: `--xattrs`,
`--selinux` and `--acls` on both the create and the extract, or `restorecon -R` on
the destination afterwards. The default labels are usually right, which is exactly
why the exception is worth knowing before you meet it.
