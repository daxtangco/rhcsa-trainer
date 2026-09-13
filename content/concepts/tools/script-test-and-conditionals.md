---
id: tools.script-test-and-conditionals
title: if tests an exit status, and [[ ]] is the bracket to use
rhel: 9
objectives: [tools.script.conditionals]
sources: [r9:ch19, r10:ch19]
prerequisites: []
---
`if` does not evaluate an expression. It **runs a command and looks at its exit
status**: zero is true, anything else is false. Once that lands, the rest of shell
conditional syntax stops looking arbitrary.

```
if systemctl is-active --quiet crond; then ...     # no brackets needed, it is a command
if grep -F root /etc/passwd > /dev/null; then ...  # the status is the answer
```

`[` **is a command too** — `/usr/bin/[`, a synonym for `test`. That is why the spaces
are mandatory (`[$x]` is a command named `[$x]`) and why the closing `]` is an
argument. `[[ ]]` is bash syntax rather than a command, and in a bash script it is
the better default: no word splitting or globbing inside it, so an unset or empty
variable cannot turn `[[ $x = y ]]` into a syntax error the way `[ $x = y ]` does.
Use `[ ]` when the script must run under `/bin/sh`, and quote everything when you do.

The operators divide by type, and mixing them is the classic mistake:

```
[[ $a = $b ]]      [[ $a != $b ]]     [[ -z $a ]]  [[ -n $a ]]     # strings
[[ $i -eq 5 ]]     [[ $i -lt 1000 ]]  (( i < 1000 ))               # integers
[[ -e p ]] -f -d -r -w -x -s          [[ f1 -nt f2 ]]              # files
```

`[[ $i = 5 ]]` compares text: `05` is not `5`, and `10` sorts before `9`. The
reverse mistake is quieter and worse: inside `[[ ]]` the operands of `-eq` are
evaluated as **arithmetic**, so a word that is not a number is read as a variable
name, and an unset variable is 0. `[[ abc -eq 0 ]]` is *true*, silently. The old
`[` does complain — `[ abc -eq 0 ]` prints `integer expression expected` and exits
2 — so if the number came from somewhere you do not control, check it yourself with
`[[ $uid =~ ^[0-9]+$ ]]` rather than trusting the comparison to object. And note
the file tests
answer different questions: `-e` exists, `-f` is a regular file, `-s` is non-empty,
`-x` is executable *by you* — `[[ -f $s && -x $s ]]` is the honest test for "there is
a script here I can run".

Inside `[[ ]]` an unquoted right-hand side is a **pattern**, which is a feature once
you know: `[[ $name == web* ]]`. Quote it to compare literally. `=~` matches an
ERE, with the groups in `${BASH_REMATCH[@]}`.

Chain with `&&` and `||`, which are also status-driven and short-circuit —
`[[ -f $f ]] && process "$f"`. Resist writing a whole decision as one chain: the
`a && b || c` idiom is *not* if/then/else, because `c` also runs when `b` fails.
Write `if`/`elif`/`else` when there are three answers, and reach for `case` when you
are matching one value against a list of patterns; `case` reads better than five
`elif`s and cannot get the ordering subtly wrong.

Finally, decide the *boundary* deliberately. On RHEL 9, UID 1000 is the first
regular user, so "a service account" is `-lt 1000` and a person is `-ge 1000`. `-gt
1000` is the same sentence with one account misfiled, and it is the account you were
least likely to check.
