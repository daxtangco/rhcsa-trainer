---
id: sys.journald-storage-modes
title: Where the journal lives, and why it vanishes at reboot
rhel: 9
objectives: [sys.logs.persistent-journal, sys.logs.journal]
sources: [r9:ch13]
prerequisites: []
---
On a stock RHEL 9 system the journal is in memory. Not "mostly", not "cached" —
`systemd-journald` writes it to `/run/log/journal`, and `/run` is a tmpfs. When
the machine reboots, everything the last boot logged is gone: no rotation, no
archive, nothing to grep. `journalctl -b -1` answers `Failed to look up boot
-1`, and that is the default state of the system you will be graded on.

The setting that decides this is `Storage=` in `journald.conf`, and it has four
values. `volatile` means `/run` only. `persistent` means `/var/log/journal`,
creating the directory if it is missing. `none` throws entries away entirely
(they still reach any syslog daemon, but nothing is stored). And `auto`, the
default, means **persistent if `/var/log/journal` already exists, volatile
otherwise** — the directory's existence *is* the switch.

That gives you two honest routes to a journal that survives a reboot, and both
are correct answers:

```
mkdir -p /var/log/journal            # auto now resolves to persistent
systemd-tmpfiles --create --prefix /var/log/journal
```

or, saying it out loud in `/etc/systemd/journald.conf` or a drop-in file under
`/etc/systemd/journald.conf.d/`:

```
[Journal]
Storage=persistent
```

Either way there is a second step, and it is the one people skip. journald
decided where to write when it started, and it does not re-decide because you
edited a file or made a directory. Until you tell it, it keeps writing to
`/run`. Two commands tell it, and both are sufficient on their own:

```
journalctl --flush                   # the one to remember
killall -USR1 systemd-journald       # the classic, and exactly equivalent
```

What they do is migrate what is already in `/run/log/journal` into
`/var/log/journal`, so the boot you are sitting in gets carried onto the disk
rather than left behind. That is also what `systemd-journal-flush.service` does
for you at every boot, which is why persistence normally looks automatic.

**`systemctl restart systemd-journald` is not a third option, and this is worth
knowing because it usually looks like one.** A restart makes journald re-read
`journald.conf`, so it is how the config route's new `Storage=` value gets
noticed — but reading the setting and acting on it are different things. journald
will only write to `/var/log/journal` once the flag file
`/run/systemd/journal/flushed` exists, and only a flush ever creates that file. On
a stock RHEL 9 machine that flag is **not** there, and the reason is worth
following, because it is the machine you will be graded on. At every boot
`systemd-journal-flush.service` runs `journalctl --flush` for you — but with
`Storage=auto` and no `/var/log/journal` there is nowhere to flush *to*, so it
succeeds having done nothing and creates no flag. Measured on RHEL 9.8: the unit
reports `Result=success`, and `/run/systemd/journal/flushed` does not exist. So
`Storage=persistent` plus a restart leaves `/var/log/journal` not merely empty but
*absent*, with journald still logging to `/run`.

Where restart-only *does* appear to work is on a machine where persistence is
already set up and has survived a reboot: `/var/log/journal` exists, so that boot's
flush service had somewhere to go, made the flag, and left it lying there for the
rest of the uptime. Which is to say the trap springs on the second try — you fix a
machine, reboot to check, and from then on a restart looks sufficient on the very
box that taught you it was. So the config route is a restart **and** a flush; the
directory route is just a flush. Either way, the flush is the step that does the
work.

**Here is the trap.** After you set this up, `journalctl` looks identical
whether you got it right or not — because journalctl reads `/run/log/journal`
**and** `/var/log/journal` and merges them. Your messages are all there. The
config file says `persistent`. Everything looks finished, and nothing on the
disk has been written. The only honest tests are to look at the filesystem
(`ls /var/log/journal/$(cat /etc/machine-id)/` should have `system.journal` in
it) or to ask which boots the journal knows about with
`journalctl --list-boots`. More than one line there means a journal that
genuinely outlived a boot; that is the evidence, and you cannot manufacture it
without rebooting.

Two more things worth knowing before you turn this on for real. Disk use is
capped, not unbounded: `SystemMaxUse=` defaults to 10% of the filesystem and
journald rotates and deletes on its own, with `journalctl --vacuum-time=2weeks`
and `--vacuum-size=500M` for a manual trim. And the journal is not the only
log: `rsyslog` is still running, still writing plain text into
`/var/log/messages` and friends, and that has always been persistent. If
someone says "we already keep logs", they may well mean that file — it is a
different mechanism with different retention, and it is not what "preserve
system journals" is asking about.
