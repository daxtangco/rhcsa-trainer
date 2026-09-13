---
id: tools.redirection-and-streams
title: Three streams, and why 2>&1 goes last
rhel: 9
objectives: [tools.shell.redirection, tools.script.command-output]
sources: [r9:ch2, r10:ch2]
prerequisites: []
---
A process starts with three open file descriptors: **0 stdin, 1 stdout, 2
stderr**. Redirection is the shell rearranging which file each of those numbers
points at *before the program starts*. The program is never told and does not care.
Read every confusing form as "point descriptor N somewhere" and the magic goes
away.

`> file` points descriptor 1 at `file`, **truncating it first** — and it does that
before the command runs, which is why `sort file > file` produces an empty file
rather than a sorted one. `>> file` appends instead. `2> file` does the same for
descriptor 2. `< file` points descriptor 0 at a file, so the program reads from it
without knowing a file exists.

`2>&1` means "make descriptor 2 point at whatever descriptor 1 currently points
at". The `&` is what says *descriptor*, not filename: `2> 1` cheerfully creates a
file called `1` and puts the errors in it.

**Order matters, because each redirection is applied left to right against the
state at that moment.** This is the one people get wrong, and the two spellings
look interchangeable:

```
cmd > out 2>&1      # 1 -> out, then 2 -> where 1 now is: BOTH go to out
cmd 2>&1 > out      # 2 -> where 1 is now (the terminal), then 1 -> out: only stdout
```

`&> out` is bash shorthand for the first, correct one. If you write the second by
accident you get a log that is missing exactly the lines you were looking for.

**A pipe carries stdout only.** `cmd | grep x` never sees the error messages, which
is why a failing command in a pipeline can look as though it produced nothing
rather than as though it failed. `cmd 2>&1 | grep x` includes them. And the exit
status of a pipeline is the status of its **last** command, so `grep` finding
nothing hides the fact that `cmd` died — `set -o pipefail` in a script, or
`${PIPESTATUS[0]}` to read the first stage's status directly.

`/dev/null` is the sink. `2>/dev/null` hides errors, `>/dev/null 2>&1` hides
everything, and both belong at the end of a cron entry and nowhere near a command
you are debugging. `tee` is for when you need a file *and* the terminal: `cmd | tee
out`, `tee -a` to append — and because `tee` reads a pipe, `cmd 2>&1 | tee out` is
the form that captures both streams.

Capturing output into a variable is a different mechanism with its own two
surprises. `$(cmd)` runs the command, keeps **stdout only**, and **strips trailing
newlines**:

```
count=$(grep -c error /var/log/messages)   # stdout only
both=$(cmd 2>&1)                           # if you want the errors too
lines=$(wc -l < file)                      # < avoids wc printing the filename
text=$(<file)                              # bash reads the file with no process at all
```

`wc -l < file` versus `wc -l file` is worth the detour: the same count, but one of
them prints the filename next to it and the other does not, and a script comparing
that output to a number cares.

The mistake worth naming is not a syntax error. It is **proving that a scheduled or
scripted command works by running it and watching the terminal.** The terminal is
merely where descriptors 1 and 2 happen to point in your interactive shell. Under
cron they point at a mail message; under a redirect they point at a file that the
user the job runs as may not be able to create. Test the command with its
redirection attached, as the user that will run it, or you have tested something
else.
