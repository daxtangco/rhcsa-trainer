---
id: sys.proc-signals-and-kill
title: kill sends a signal, and only one of them cannot be argued with
rhel: 9
objectives: [sys.proc.kill]
sources: [r9:ch10, r10:ch10]
prerequisites: [sys.proc-finding-the-hog]
---
`kill` does not kill. It sends a signal, and what happens next is up to the
program — which is the whole distinction the exam objective is testing.

**SIGTERM (15) is the default and it is a request.** A well-written program
catches it, finishes the write it is in the middle of, releases its lock, removes
its pidfile and exits. **SIGKILL (9) is not delivered to the program at all** — the
kernel destroys the process, so no handler runs, no buffer is flushed and no
temporary file is cleaned up. `kill -9` as a reflex is how a stuck job becomes a
corrupt file and a stale lock nobody can explain. Use it when SIGTERM has been
ignored for a while, and treat needing it as information about the program.

```
kill 1234              # SIGTERM
kill -9 1234           # SIGKILL, last resort
kill -HUP 1234         # "re-read your configuration", by long convention
kill -l                # the whole list
pgrep -a -f purge      # look before you shoot: -a shows the command line
pkill -f nightly-purge
```

**Two traps live in `pkill -f`.** The first is that `-f` matches against the whole
command line, so a pattern that names a *suite* rather than a process — `pkill -f
backup` — signals everything with that word in it, and pkill's silence on success
looks identical to having done the right thing. Check with `pgrep -a -f` first;
it takes the same arguments and kills nothing. The second is funnier and bites in
scripts: your own `sudo pkill -f backup` command line contains the pattern, so
pkill matches its own parent. Hence the old `[b]ackup` spelling — a regex that
matches the target while the literal text `[b]ackup` in your own command line does
not match it. `killall` sidesteps `-f` by matching the executable name exactly,
which also means it cannot see a script: every script is `bash`.

**For anything systemd started, `systemctl stop` is the right verb.** It signals
the unit's whole cgroup rather than the one pid you found, and it tells systemd
the exit was intended — kill the main process of a unit with `Restart=always` and
it is back before you have finished reading the output.

And a note on what can be proven afterwards: **nothing records which signal you
sent.** Once the process is gone, the only evidence is what it left behind — a
clean shutdown line in a log, or a truncated file where there should have been
one. That is the difference SIGTERM buys, and it is the only place it is visible.
