---
id: sys.cron-vs-timers
title: Four places a cron job can live, and the field that decides
rhel: 9
objectives: [sys.cron.schedule]
sources: [r9:ch12]
prerequisites: [systemd.enabled-vs-started]
---
"Schedule this job" has four answers on RHEL 9, and they are not
interchangeable:

- **A user's own crontab.** `crontab -e` as that user, or `crontab -e -u bob` as
  root. It lands in `/var/spool/cron/bob`, which you edit through the `crontab`
  command rather than with `vi` — `crontab` validates the file before installing
  it, and a hand-edited spool file with a syntax error is only reported by mail
  to the owner.
- **`/etc/crontab`.** The system's own file. Editable, but conventionally left
  alone.
- **`/etc/cron.d/somefile`.** A drop-in, and the right place for anything a
  package or a config-management tool owns. The filename must contain no dots,
  or crond ignores it.
- **`/etc/cron.hourly|daily|weekly|monthly/`.** Drop an executable script in and
  it runs at some point in that window, not at a time you choose. On RHEL these
  go through anacron, which catches up on jobs missed while the machine was off.
  Useful for maintenance, useless when a specific time is required.

**The field count is the difference that bites.** A schedule is five fields —
minute, hour, day-of-month, month, day-of-week — and then:

```
30 23 * * *  journalctl -p err > /tmp/report      # user crontab: 5 + command
30 23 * * *  bob  journalctl -p err > /tmp/report # /etc/crontab, /etc/cron.d: 5 + USER + command
```

Get it backwards and nothing tells you. A six-field line in a personal crontab
makes cron try to run a program named `bob`. A five-field line in
`/etc/cron.d/` makes cron read `journalctl` as the username, find no such user,
and skip the job — an error in crond's own log and silence everywhere else. When
a scheduled job "just never runs", this is the first thing to check.

On the fields themselves: `30 23 * * *` is 23:30 daily, `0 */4 * * *` is every
fourth hour, `0 3 * * 0` is 03:00 on Sundays. The order is minute-then-hour, so
`23 30 * * *` is not 23:30 — it is minute 23 of hour 30, which does not exist,
and `crontab` will refuse to install it. Day-of-month and day-of-week are OR'd
when both are set, which surprises everyone once.

The environment is the other classic trap. Cron runs your command with a nearly
empty environment: a minimal `PATH`, `HOME` and `SHELL` set, and **no profile
sourced**. So "it works when I type it" proves nothing about a `PATH` your
`.bashrc` extended, and the safe habit is absolute paths in anything scheduled.
Output is not discarded either — anything the job writes to stdout or stderr is
mailed to the owner, which is why `>` a file or `>/dev/null 2>&1` is standard.

And none of it happens unless **crond itself is enabled, not merely started**. A
`systemctl start crond` gives you a scheduler that works today and is gone after
the next reboot, with a crontab that still looks perfectly correct. For one-off
work `at 23:30` is the equivalent tool, with its own daemon — `atd` — that has
to be running for exactly the same reason, and `atq`/`atrm` to inspect and
cancel.

**Systemd timers do all of this too**, and better in places: a `.timer` unit
with `OnCalendar=23:30`, `Persistent=true` to catch up after downtime, journal
integration for free, and `systemctl list-timers` to see what fires next. Know
they exist and how to read one. But the RHEL 9 exam objective says "Schedule
tasks using **at and cron**", so when a task asks for a cron job, a timer is not
the answer to that question no matter how good it is — and when a task states
the mechanism, that statement is part of the requirement.
