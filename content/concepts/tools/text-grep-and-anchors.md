---
id: tools.text-grep-and-anchors
title: A pattern that matches too much fails silently
rhel: 9
objectives: [tools.text.grep]
sources: [r9:ch4, r10:ch4]
prerequisites: []
---
A pattern that is wrong in the "too narrow" direction announces itself: you get
nothing back and you go and fix it. A pattern that is wrong in the "too wide"
direction returns output, the output looks like what you asked for, and nothing
anywhere says so. **Every real grep mistake is that one**, and the habit that
prevents it is deciding, before you type, what your pattern must *refuse* to
match.

A regular expression makes a claim about a *substring*, not about a whole line.
`grep user=deploy` says "this text appears somewhere in the line", so it matches
`user=deployer`, `user=deploy_svc`, `user=deploy2` and `note=deploy` with equal
enthusiasm. Nothing about the pattern claims the match ends after `deploy`,
because you never said so. Saying so is what anchors are for:

```
^root      the line begins here
root$      the line ends here
\<root\>   a word boundary on each side  (BRE; \b works too)
grep -w root       the same claim, spelled as an option
grep -x root       the whole line and nothing else
```

`-w` and `\<…\>` have a sharp edge worth learning once: a "word" is
alphanumerics and underscore. So `grep -w user=deploy` **rejects**
`user=deployer` and `user=deploy2` — the boundary fails — and **accepts**
`user=deploy-bot`, because `-` is not a word constituent, so a boundary
genuinely exists there. When the delimiter you care about is punctuation, spell
it out: `'user=deploy '`, or `-E 'user=deploy( |$)'`.

Two more choices that decide correctness rather than style. **BRE versus ERE**:
plain `grep` treats `?`, `+`, `|`, `(`, `)` as ordinary characters and needs them
backslashed, `grep -E` treats them as operators. Pick `-E` and stop escaping
rather than mixing the two. **`grep -F`** when the pattern is *data* — a path, an
IP address, a version string — because `.` in a basic pattern is any character,
so `10.0.0.1` also matches `10x0y0z1`, and `-F` is both correct and faster.

Then check yourself with the reject list. `grep -c pattern file` for the count,
and if two candidate patterns disagree, `diff <(grep -E 'a' f) <(grep -E 'b' f)`
shows exactly which lines the looser one dragged in. Reading the matches proves a
pattern found what you wanted; only reading what it *also* found proves it found
nothing else.

**The mistake worth naming** is not about patterns at all: grep's exit status has
three values, and the third one is the interesting one. `0` selected something,
`1` selected nothing, and **`2` means an error — usually a file it could not
read**. A search over a directory tree that hits one unreadable subdirectory
prints a complaint on stderr, exits 2, and still prints every match it did find.
So "the report is short" and "there was nothing to find" are different facts,
and the only thing that tells them apart is the stream you probably redirected
into oblivion.
