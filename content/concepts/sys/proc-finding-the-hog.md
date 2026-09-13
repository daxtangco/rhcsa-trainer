---
id: sys.proc-finding-the-hog
title: Finding the process that is eating the machine
rhel: 9
objectives: [sys.proc.kill]
sources: [r9:ch10, r10:ch10]
prerequisites: []
---
"The server is slow" is not a fault, it is a symptom, and the objective asks you
to name the process behind it before you touch anything. Two tools answer that,
and they do not mean the same thing by `%CPU`.

**`top` is now. `ps` is the whole life of the process.** `top` recomputes usage
over its refresh interval, so what it shows is what is happening this second.
`ps aux`'s `%CPU` column is an *average over the process's entire lifetime* — so
a process that has been spinning since midnight and one that is spinning right
now look nothing alike, and a long-lived daemon that went mad ten minutes ago can
sit at 4% in `ps` while `top` shows it at 99%. When the two disagree, they are
both right and the question decides which one you wanted.

```
top                                    # then: P sort by CPU, M by memory, c full command line
ps -eo pid,ppid,ni,pcpu,pmem,etime,args --sort=-pcpu | head
ps -eo pid,rss,pmem,args --sort=-rss | head        # the memory question
```

**A script's name is its interpreter.** `top`'s default `COMMAND` column and
`ps`'s `comm` both show the executable, so every shell script on the box is
called `bash` and every Python service is called `python3`. That is the moment
people kill the wrong thing. `top -c` (or `c` inside `top`) and `ps -o args`
show the full command line, which is the only view where
`/usr/local/sbin/nightly-purge` is distinguishable from your own login shell.

**Then ask who owns it.** On RHEL 9 almost everything long-running was started by
systemd, and `systemctl status <pid>` walks the cgroup back to the unit that owns
that pid — the fastest route from "this process" to "this service", and the
answer that tells you whether stopping the process is even the right verb.
`systemd-cgtop` sorts the same picture by unit rather than by process, which is
how you find a service that is slow in aggregate without any single process
looking bad.

For memory pressure specifically: `%MEM` and `RSS` are the resident numbers that
matter, `VSZ` is address space a process merely reserved and is nearly always a
red herring, and `free -h` plus a `si`/`so` column moving in `vmstat 1` is what
distinguishes "used memory" (fine, that is what it is for) from "swapping"
(not fine).
