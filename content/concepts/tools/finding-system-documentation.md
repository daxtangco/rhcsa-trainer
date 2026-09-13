---
id: tools.finding-system-documentation
title: The answer is on the machine, and there are four places to look
rhel: 9
objectives: [tools.man.documentation]
sources: [r9:ch2, r10:ch2]
prerequisites: []
---
The exam has no browser. Every flag you cannot remember is on the disk in front of
you, and the skill being tested is not recall — it is knowing which of four
collections holds the answer and how to search that collection rather than scroll
it. The four are the manual pages, the manual page *index*, `/usr/share/doc`, and
the Texinfo manuals.

**Sections are not decoration, and the default is not the section you want.**
A name can exist in several sections, and man(1) lists what each one holds:
1 is "executable programs or shell commands", 5 is "file formats and conventions,
e.g. */etc/passwd*", 8 is "system administration commands (usually only for root)".
So `passwd` is two entirely different pages — the command in 1, the file format in
5 — and `man passwd` gives you the command, because RHEL 9's `/etc/man_db.conf`
sets the search order `SECTION 1 1p 8 2 3 3p 3pm 4 5 6 7 9 …` and section 1 comes
first. That single line explains most "the man page doesn't say that" confusion:
you were reading a different page. `man 5 passwd` asks for the one you meant, and
`man -f passwd` (the same thing as `whatis passwd`) lists every section a name
appears in so you can choose deliberately.

**`man -k` is a different program from `man`, and it reads a database.** `man -k`
is documented as "Equivalent to `apropos`" — literally so: `man` execs
`/usr/bin/apropos` to do the work. apropos searches the one-line descriptions
rather than the bodies of the pages, which is what makes it the right tool when you
know what a thing *does* and not what it is called. Precisely, apropos(1) says
"the standard matching rules allow matches to be made against the page name and
word boundaries in the description" — so a hit can come from either half of a
`whatis` line, and a keyword like `pathname` returns both the pages *named* for it
and the pages that merely *describe* themselves with it. `apropos -a word1 word2`
narrows that: "-a, --and" is documented as "Only display items that match all the
supplied keywords. The default is to display items that match any keyword." When it
finds nothing it says so on **stderr** and exits 16, measured:

```
$ apropos zzzznothing
zzzznothing: nothing appropriate.
$ echo $?
16
```

That distinction matters in a script — the failure arrives as an exit status with
an empty stdout, not as an error on the channel you are reading.

**"nothing appropriate" usually means the index is stale, not that the page is
missing.** apropos(1) says outright that the database "is updated by the `mandb`
program. Depending on your installation, this may be run by a periodic cron job, or
may need to be run manually after new manual pages have been installed." On RHEL 9
the update runs as a systemd service, `man-db-cache-update.service`, and the RPM
trigger fires it *in the background* after a package installs pages — so straight
after `dnf install` the index can be absent, half-built or complete. If a search
you know should match comes back empty, `sudo mandb` and search again. If the page
itself is gone, that is a different problem: a `tsflags=nodocs` install strips
documentation from the packages entirely, and no amount of reindexing brings it
back.

**When the index cannot help, brute force and file paths can.** `man -K` —
`--global-apropos` — searches the text of every page: the page itself says it "is a
brute-force search, and is likely to take some time; if you can, you should specify
a section". Use it as a last resort with a section, `man -K 5 GECOS`, not bare.
`man -w NAME` prints the source file instead of formatting it, which turns any page
into an ordinary file you can grep:

```
gzip -cd -- "$(man -w 8 useradd)" | grep -n 'login\.defs'
```

You are reading nroff markup that way, so the page's `--key` looks like
`\fB\-\-key\fR` — worth knowing before you conclude the option is not there. In the
other direction, `man -l ./page.8` formats a file you have but have not installed.
And when the pager is in your way, `man -P cat 1 df` sends the page to `cat`; the
default is `less`.

**`/usr/share/doc` is the fourth collection and the one people forget.** It holds
what upstream shipped that is not a man page: READMEs, changelogs, sample
configuration, and working example scripts. getopt(1)'s EXAMPLES section says only
that its example scripts "are installed in */usr/share/doc/util-linux* directory" —
it does not name them, so the page gets you to the directory and the directory gets
you `getopt-example.bash`. `rpm -qd PACKAGE` lists exactly which files a package
counts as documentation (`-d, --docfiles`), and `rpm -qdf /path/to/file` asks the
same question about whatever file you happen to be looking at.

**Texinfo is where GNU keeps the real manual.** Every coreutils page ends with the
pointer, and prints it in the form the reader wants: df(1) closes with `info
'(coreutils) df invocation'`, where `(coreutils)` is the manual and `df invocation`
is the node inside it. The manuals are files —
`/usr/share/info/coreutils.info.gz` — installed by `coreutils-common` whether or
not anything can read them: on RHEL 9 the reader is a separate package, `info`, and
coreutils-common does not require it. So `ls /usr/share/info` tells you the manual
is there even when `info` is not installed, and `dnf install info` is the fix. On a
Minimal Install you may find neither: minimal RHEL 9 ships `coreutils-single`, which
provides `/usr/bin/df` by itself and pulls in no `coreutils-common`, so both `df(1)`
and `coreutils.info.gz` can be missing on a machine whose `df` works perfectly —
`rpm -qf /usr/bin/df` is how you find that out. The man page is the summary; the
Texinfo node is where the behaviour you are arguing with is actually explained.

**The mistake worth naming.** Reaching for the internet, or for memory, when the
answer is one search away on the machine — and its mirror image, scrolling a long
page looking for a flag. Neither is a knowledge gap; both are a search-strategy
gap. Decide first *which* collection the answer lives in, then search that
collection: `man -k` for "what is it called", `man 5 name` for a file format,
`/usr/share/doc` for an example, `info` for the full story, and `man -w` plus grep
when you already know the page and only want the line.
