---
id: tools.text-editing-in-place
title: Editing a file in place is a rewrite, not a nudge
rhel: 9
objectives: [tools.editor.text-files]
sources: [r9:ch4, r10:ch4]
prerequisites: [tools.redirection-and-streams]
---
Almost nothing that "edits a file in place" modifies the bytes where they lie.
`vi`, `sed -i` and every save in every editor build a *new* file and put it where
the old one was. Knowing that explains three surprises that otherwise look like
bugs, and one disaster.

**The disaster first.** `sort accounts.txt > accounts.txt` leaves you with an
empty file, exits 0, and says nothing at all. The shell performs the redirection
before `sort` starts, and `>` truncates: by the time the command opens the file
to read it, there is nothing in it. This is the most expensive mistake in this
chapter, because the original is gone. Some tools happen to check — measured on
RHEL 9, `grep -v x f > f` prints `grep: f: input file is also the output` and
exits 2 — but the file is 0 bytes either way, because the truncation happened
before the tool ran and the tool has nothing left to put back. Do not rely on
the warning. Write to a different name and move it into place, or use a tool
that does that for you — which is precisely what `sed -i` is.

**`sed -i` is that pattern, packaged.** It writes a temporary file in the same
directory and renames it over the original, which has consequences you can
predict from the mechanism alone: it needs write permission on the *directory*,
not just on the file; the result has a new inode, so a hard link to the old file
no longer sees your change; and `-i.bak` keeps the previous version instead of
discarding it. `sed` copies the original's mode onto the replacement (measured:
a 0640 file is still 0640 afterwards, and its owner survives too when sed is
running as root), but a
SELinux context is set when the new file is created, so a file whose label
differs from its directory's default can come back with the wrong one — `ls -Z`
to check, `restorecon` to fix. RHEL's `vi` is built with SELinux support and
copies the old context onto the new file, which is one reason the manual answer
is the safe one on a labelled file.

**Which brings us to `vi`, which you have to know because it is the editor RHEL
guarantees.** `vim-minimal` is in every install; `nano` may not be there and an
exam machine is not the place to find out. Four commands carry most of the work:
`:w` write, `:wq` write and quit, `:q!` quit and throw the edits away, and `:w
!sudo tee %` for the file you opened without the privilege to save. `dd` deletes
a line, `u` undoes, `/pattern` searches, and `:%s/old/new/g` is the substitution
you will reach for constantly.

`ex` is the same editor with the screen switched off — the same binary from the
same package, reading commands instead of keystrokes:

```
printf '%s\n' '%s/^depoly$/deploy/' 'g/^deployer$/d' 'wq' | ex -s file
```

That is worth knowing because it is how "edit this file" becomes scriptable
without leaving the editor you already understand.

Finally, two ways to create a file with no editor at all, both of which are
`man bash` rather than `man vi`: `cat > file <<'EOF' … EOF` for a block of exact
text — the quoted delimiter is what stops the shell expanding `$` inside it — and
`printf '%s\n' line1 line2 > file`, which is the one to reach for in a script
because `echo`'s treatment of backslashes is not portable.

**The mistake worth naming.** The file changing is not the change taking effect.
Nothing re-reads a configuration file because you saved it: a service reads it
when it starts or is told to reload, and `sudo systemctl reload sshd` or a
`--reload` flag is a separate step from `:wq`. An edit that is correct in the file
and absent from the running system is the commonest "but I fixed it" in this
material.
