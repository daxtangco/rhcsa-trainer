---
id: tools.script-arguments-and-exit-status
title: A script's arguments are positional parameters, and its exit status is its API
rhel: 9
objectives: [tools.script.inputs]
sources: [r9:ch19, r10:ch19]
prerequisites: []
---
A script is a command. Everything you know about how commands take input applies to
it, and the shell hands that input over in **positional parameters**: `$1` is the
first argument, `$2` the second, `$#` how many there were, `$0` the name the script
was invoked as. Past nine you need braces — `$10` is `$1` with a `0` stuck on the
end, `${10}` is the tenth argument.

Two spellings of "all of them", and only one of them is right:

```
"$@"    # each argument as its own word, even the ones containing spaces
"$*"    # every argument mashed into one word, joined by the first char of IFS
$@      # unquoted: re-split on whitespace and glob-expanded. Never what you want.
```

`for f in "$@"` walks the arguments. `shift` drops `$1` and renumbers the rest,
which is how you consume an option and leave the filenames behind.

**Check the arity before you use it.** Under `set -u` a script referring to `$1`
when it was given nothing dies with `$1: unbound variable` and exit status 1 — a
real diagnostic, but the wrong one, and it arrives from wherever `$1` happened to be
mentioned first rather than at the top. Say what you meant:

```
if [[ $# -lt 1 ]]; then
  printf 'usage: %s LISTFILE\n' "${0##*/}" >&2
  exit 2
fi
```

Three things in that block are conventions worth keeping. The usage message goes to
**stderr**, because it is not the output the caller asked for and it must not land
in the middle of a pipe or a redirected report. `${0##*/}` strips the directory so
the message reads the same however the script was invoked. And the status is
non-zero, deliberately chosen — 0 means success and **nothing else**, and by long
Unix habit 2 means "you called me wrong" as distinct from 1, "I tried and failed".

That status is the only part of your script another program can see without parsing
text. `$?` holds the last command's status; a script that never says `exit` returns
the status of its last command, which is a coin flip dressed up as a contract. End
the happy path with `exit 0` and mean it.
