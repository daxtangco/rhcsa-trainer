---
id: tools.script-command-substitution
title: $(...) captures stdout, and the status comes back separately
rhel: 9
objectives: [tools.script.command-output]
sources: [r9:ch19, r10:ch19]
prerequisites: [tools.redirection-and-streams]
---
`$(command)` runs the command in a subshell, captures its **standard output**, strips
**all trailing newlines**, and substitutes the result. Use it instead of backticks —
`$( )` nests, reads unambiguously, and does not change how backslashes behave.

Four consequences that bite in that order:

```
uid=$(id -u alice)                 # stdout only; the error message still goes to your terminal
uid=$(id -u alice 2>/dev/null)     # ...unless you say otherwise
files=$(ls -1 /etc)                # trailing newlines gone, interior ones kept
printf '%s\n' "$files"             # QUOTE the expansion or it re-splits into words
```

Unquoted, `$(...)` is subject to word splitting and globbing exactly like an
unquoted variable. `echo $(cat file)` collapses a file onto one line. Quote it.

**The exit status is not the output, and you usually want both.** An assignment takes
the status of the command substitution it contains, so this is a complete existence
test *and* a capture in one line:

```
if uid=$(id -u "$name" 2>/dev/null); then
  echo "$name has UID $uid"
else
  echo "$name does not exist"
fi
```

That is the shape to reach for. The version people write instead — capture, then test
whether the string is empty — is right often enough to be dangerous, because a
command can fail and still print something, or succeed and print nothing. Test the
status when you mean "did it work" and test the string when you mean "was there
anything".

Two traps particular to the exam. `local x=$(cmd)` and `export x=$(cmd)` return the
status of `local`/`export`, which is 0 whatever `cmd` did — declare first, assign on
its own line. And a script that ends with a command substitution inside a pipeline is
reporting the *last* stage's status, so `set -o pipefail` or `${PIPESTATUS[0]}`.

Prefer parsing something built to be parsed. `getent passwd "$name" | cut -d: -f3`
reads a colon-delimited record with a documented layout; `id -u "$name"` prints one
number and nothing else. Scraping human-formatted output — `ls -l`, `df -h`, the
pretty half of `systemctl status` — works until a column widens, a locale changes a
decimal separator, or a filename contains a space. Somewhere behind almost every
tool with pretty output there is one with machine output: `--no-legend`, `-p`, `-1`,
`--value`. Find it before you reach for `awk` on column seven.
