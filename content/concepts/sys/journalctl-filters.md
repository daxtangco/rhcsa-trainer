---
id: sys.journalctl-filters
title: The journal is a database, so filter it instead of grepping it
rhel: 9
objectives: [sys.logs.journal]
sources: [r9:ch13]
prerequisites: [sys.journald-storage-modes]
---
`/var/log/messages` is text, so you read it with `grep`. The journal is not
text. Every entry is a record with dozens of named fields — `PRIORITY`,
`_SYSTEMD_UNIT`, `_UID`, `_PID`, `_COMM`, `SYSLOG_IDENTIFIER`, `_BOOT_ID` — and
`journalctl` is a query tool over those fields. Piping it into `grep` works, but
it throws away the structure first and then tries to recover it with a regular
expression, which is how people end up with a filter that quietly matches the
wrong thing.

Run `journalctl -o verbose -n 1` once and read what comes back. That is the
whole vocabulary: anything you see there can be matched as `FIELD=value`, and
the underscore-prefixed fields are the trusted ones journald added itself, which
no process can forge.

The three filters that cover almost every question:

```
journalctl -p err            # priority err and worse
journalctl -u sshd           # this systemd unit
journalctl -b               # this boot;  -b -1  the previous one
journalctl --since 09:00 --until "1 hour ago"
journalctl -f                # follow, like tail -f
```

`-p` is the one that gets misread. It is a **threshold, not an equality**: the
levels run `emerg` 0, `alert` 1, `crit` 2, `err` 3, `warning` 4, `notice` 5,
`info` 6, `debug` 7, and `-p err` means "3 and anything more serious". If you
want exactly one level you have to say `PRIORITY=3`, or a range like
`-p warning..warning`. So "capture everything at err or worse" is `-p err` and
nothing else, and a report that also contains info-level lines was not filtered
by priority at all.

`-u` and `-t` are not the same filter and this is a real source of confusion.
`-u httpd` matches `_SYSTEMD_UNIT=httpd.service` — entries systemd attributes
to that unit's cgroup. `-t httpd` matches `SYSLOG_IDENTIFIER=httpd`, the tag the
program chose for itself, which is what `logger -t` sets. A tag is a label
anybody can pick; a unit is a fact about who logged it. Reach for `-u` for
services and `-t` when you are chasing something you logged yourself.

Two matches on the **same** field are OR'd; matches on **different** fields are
AND'd; a bare `+` between groups is an explicit OR. So
`journalctl _UID=1000 _UID=0` means either user, `journalctl -u sshd -p err`
means both conditions, and `journalctl -u sshd + -u crond` means either unit.
Getting AND when you wanted OR is the usual surprise.

**The mistake worth naming.** An unprivileged user does not see the whole
journal. Without membership in `wheel`, `adm` or `systemd-journal` you see your
own entries and nothing else — and journalctl does not say so loudly, it simply
returns less. This is why a filter that prints exactly what you wanted at your
shell can produce an almost-empty file when the same command runs from cron
under a service account, and why the fix is either group membership or `sudo`
rather than a different filter.

Finally, when the output is going somewhere other than your terminal, remember
that `journalctl` pages by default and turns the pager off automatically when
stdout is not a tty. Redirecting to a file is therefore fine as-is; `--no-pager`
costs nothing and makes the intent explicit, which is a good habit in anything
scheduled. And there is no reason to reach for `grep` at the end of a pipeline
you could have expressed as a match — build the query, then redirect it.
