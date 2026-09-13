---
id: tools.script-reading-lines
title: for walks words, while read walks lines
rhel: 9
objectives: [tools.script.loops, tools.script.inputs]
sources: [r9:ch19, r10:ch19]
prerequisites: [tools.script-arguments-and-exit-status]
---
Bash has two loops that beginners use interchangeably and that iterate over
different things. `for` walks a **list of words**. `while read` walks a **stream of
lines**. Choosing the wrong one is the most common bug in a first shell script,
because it works on your test data.

`for` is right when the list is words you can see: `for f in *.conf`, `for name in
"$@"`, `for i in {1..5}`. It is wrong when the items come out of a file, and this
is the line to unlearn:

```
for line in $(cat file)      # WRONG
```

Command substitution produces one blob of text, and unquoted it is split on
whitespace and then glob-expanded. A line reading `web server` becomes two
iterations; a line containing `*` becomes a list of your filenames. Nothing warns
you.

The form that reads lines is longer and every piece of it earns its place:

```
while IFS= read -r line; do
  ...
done < "$file"
```

`IFS=` for this command only stops `read` from stripping leading and trailing
whitespace. `-r` stops it from treating a backslash as an escape, so a Windows path
survives. `done < "$file"` redirects the loop's stdin once, which is cheaper and
clearer than piping `cat` into it — and unlike a pipeline, it does not put the loop
body in a subshell, so variables you set inside are still set when it ends.

**`read` returns false on end of input, even when it read something first.** A file
whose last line has no trailing newline loses that line entirely. The guard is:

```
while IFS= read -r line || [[ -n $line ]]; do
```

On the final partial line `read` fails but has already filled `line`, so the second
test is true and the body runs once more. Files without a trailing newline are
common — anything a program wrote with `printf` rather than `echo`.

Two more habits. Skip the empty lines yourself with `[[ -n $line ]] || continue`; a
blank line is not a record, and a loop that silently processes the empty string
usually produces a nonsense entry rather than an error. And if the body runs
something that also reads stdin — `ssh`, `read`, some interactive tool — it will
swallow the rest of your file; give it `< /dev/null`.

`mapfile -t names < "$file"` is the third way: read the whole file into an array,
then `for name in "${names[@]}"`. Concise, correct about whitespace, and it costs
memory proportional to the file, which for a list of account names is nothing.
