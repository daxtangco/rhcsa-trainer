---
id: systemd.isolating-targets-and-shutdown
title: Three tenses - now, the next boot, and every boot
rhel: 9
objectives: [boot.targets.manual, boot.lifecycle.shutdown]
sources: [r9:ch18, r9:ch5, r10:ch18, r10:ch5]
prerequisites: [systemd.targets-and-default]
---
`set-default` and `isolate` are two tenses, and the manual-boot objective is about
a third one nobody teaches: **the next boot only.** All three are separate places
on disk or in memory, and knowing which one a question is asking about is most of
the work.

**Now** is `systemctl isolate graphical.target`. It starts what the new target
wants and stops what it does not, and it takes effect in seconds. It writes
nothing, so a reboot undoes it. **Every boot from now on** is
`systemctl set-default`, which rewrites one symlink and changes nothing about the
running system. **The next boot only** is a kernel argument:
`systemd.unit=graphical.target`, which systemd(1) documents as an override of the
unit it activates at boot, defaulting to `default.target`. In the exam room you
add it by hand at the GRUB menu — `e` to edit the entry, append it to the `linux`
line, `Ctrl-x` to boot — and because you edited nothing on disk, it applies once.

To make the same argument stick across several reboots without changing
`default.target`, write it into the boot loader entry instead. On RHEL 9 that is
**not** `/etc/default/grub`: entries live in `/boot/loader/entries/*.conf` (the
BootLoaderSpec), each with its own `options` line, and `grub.cfg` reads them
through the `blscfg` module. `GRUB_CMDLINE_LINUX` only seeds entries that are
*generated*, and on a BLS machine `grub2-mkconfig` deliberately leaves the
entries that already exist alone: it rewrites their `options` lines only when you
ask it to with `grub2-mkconfig --update-bls-cmdline`. Setting
`GRUB_UPDATE_BLS_CMDLINE=yes` in `/etc/default/grub` does not do it for you —
the script forces that variable back to `no` immediately after reading the file
whenever `GRUB_ENABLE_BLSCFG=true`, which on RHEL 9 it is. Use `grubby`, which
edits the entries themselves:

```
grubby --info=DEFAULT                                            # what the machine will pass
grubby --update-kernel=ALL --args=systemd.unit=graphical.target   # add it everywhere
grubby --update-kernel=ALL --remove-args=systemd.unit             # take it back out
cat /proc/cmdline                                                 # what this boot got
```

Two things stay true whatever you do here. `systemctl get-default` still reports
the symlink, not the kernel argument, so a machine booted with `systemd.unit=` is
running one target while claiming another — read both. And `rescue.target` and
`emergency.target` stop the network, so on a machine you reach over ssh they are a
one-way trip.

The shutdown verbs are shorter and have one wrinkle worth the space.
`systemctl reboot`, `poweroff` and `halt` act immediately; `shutdown -r` and
`shutdown -h` take a time argument and **schedule**. A scheduled shutdown is
runtime state — logind records it under `/run/systemd/shutdown/` — so `shutdown -c`
cancels it, `shutdown --show` prints it, and a reboot forgets it. That last part is
the trap: state in `/run` is gone at the next boot, so if a scheduled reboot keeps
coming back, cancelling it again is not the fix. Something enabled is putting it
there, and `systemctl list-unit-files` and `systemctl list-timers` are where to
look.

One kindness in the design: with a time argument, `/run/nologin` is created five
minutes before the machine goes down, so users stop being able to log in just
before the box disappears from under them. That file is also why a mistyped
`shutdown +1` is worth cancelling quickly rather than waiting out.
