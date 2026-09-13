---
id: tools.prompt-ps1-and-startup-files
title: The prompt is a variable, and the file you put it in decides who sees it
rhel: 9
objectives: [tools.shell.prompt]
sources: [r9:ch2, r10:ch2]
prerequisites: [users.login-shells-and-su]
---
There is no such thing as "the system's prompt". `PS1` is an ordinary shell
variable belonging to one running shell, and the shell prints it before every
command. Nothing stores it, nothing serves it, and no service needs restarting.
Every prompt that appears to be permanent is a line in a startup file being run
again by each new shell — so "change the prompt" is really two decisions: what the
value is, and which file the assignment lives in. The second one is where people
go wrong.

**Only an interactive shell has a prompt at all.** Bash sets a default `PS1` when
it is interactive and leaves it unset otherwise, which is why RHEL's own
`/etc/bashrc` wraps its work in `if [ "$PS1" ]` — that test *is* the "am I
interactive" test. A script has no prompt, and asking a non-interactive shell what
its prompt is gets you an empty answer rather than the answer you wanted:

```
echo "$PS1"                     # in your own shell: the recipe
bash -c 'echo "[$PS1]"'         # prints [] - not broken, just not interactive
bash -ic 'echo "$PS1"'          # -i forces interactive, so there is a prompt to see
printf '%s\n' "${PS1@P}"        # the recipe rendered the way it will be printed
```

That last one is worth keeping. `${PS1@P}` expands the escapes, so you see
`[dana@server1 doc]$` instead of `[\u@\h \W]\$`, which is how you find out that
the escape you used was not the escape you meant.

The escapes are in the PROMPTING section of `man bash` and about eight of them
matter: `\u` user, `\h` short host name, `\H` the full one, `\w` the working
directory, `\W` **only its last component**, `\$` a `#` for root and a `$` for
everyone else, `\t` the time, `\!` the history number. RHEL's default is
`[\u@\h \W]\$ ` and the `\W` in it is the one worth changing: a prompt reading
`[dana@server1 doc]$` tells you nothing about *which* `doc` you are about to
delete files in. `\w` prints the path in full. Colour goes in through
`\[`…`\]`, and the brackets are not decoration — they tell readline the bytes
between them take up no screen space, and without them long command lines wrap
over themselves.

Where the assignment goes is the part that gets graded, in an exam and in real
life, because each candidate file is read by a different set of shells:

```
~/.bashrc                one account, every interactive shell it starts
~/.bash_profile          one account, login shells only
/etc/bashrc              every account, every interactive shell
/etc/profile             every account, login shells only
/etc/profile.d/x.sh      every account, every interactive shell - see below
```

`~/.bashrc` is the answer for a single account and the reason is the middle
column: an interactive non-login shell reads it directly, and a login shell
reaches it too because RHEL's skeleton `.bash_profile` sources it. Put the same
line in `~/.bash_profile` instead and the prompt is there when you `su -` and gone
when you `su`, which is a bug you can only see by testing both.

`/etc/profile.d/*.sh` is the row that is worth reading twice, because the usual
summary of it — "login shells only" — is wrong on RHEL. `/etc/profile` does source
that directory, and only a login shell reads `/etc/profile`; but RHEL's
`/etc/bashrc` **also** sources it, inside a `if ! shopt -q login_shell` branch
written for exactly the shells `/etc/profile` misses. So on RHEL 9 a drop-in there
reaches both kinds of interactive shell, and `/etc/profile` itself is the only
file in the list a non-login shell truly never sees. Read `/etc/bashrc` before you
trust any table of these files, including this one: it is 90 lines, it is the
authority for the machine in front of you, and every distribution wires it
differently.

Two traps beyond the file choice. **Do not `export PS1`.** An exported prompt is
inherited by shells that then never consult their own startup files' opinion,
including the ones a different account's `su` starts, and you have quietly made a
per-shell setting into an environment variable that follows you around. And
**editing a startup file changes nothing about the shell you edited it in** —
startup files run at startup. `source ~/.bashrc`, or better, start the shell the
way it will really be started and look at what you get. Testing in the shell you
did the work in is how a broken prompt gets signed off.

`PS2` is the continuation prompt you see after an unbalanced quote (`>` by
default), which is worth recognising for a different reason: when a lab machine
appears to have stopped responding to commands, that `>` is usually the whole
explanation, and `Ctrl-C` is the fix.
