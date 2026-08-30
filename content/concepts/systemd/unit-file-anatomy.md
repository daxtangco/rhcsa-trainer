---
id: systemd.unit-file-anatomy
title: Writing a service unit
rhel: 9
objectives: [systemd.services.enable]
sources: [r9:ch11, r10:ch11]
prerequisites: [systemd.enabled-vs-started]
---
A service unit is an ini file with three sections, and you can write a working
one from memory once you know what each section is for.

```ini
[Unit]
Description=Write a boot stamp to /run
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/rhcsa-stamp
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

`[Unit]` is metadata and ordering. `Description` is what `systemctl status`
prints. `After=` and `Before=` control *order* only; `Requires=` and `Wants=`
control *whether* something else gets pulled in. Mixing those up produces a
unit that starts too early rather than one that fails, which is harder to spot.

`[Service]` is the process. `Type=simple` is the default and means "ExecStart is
the daemon; consider it started as soon as it is forked". `Type=oneshot` means
"ExecStart is a job that exits", and is what you want for a script — pair it
with `RemainAfterExit=yes` so the unit shows as `active (exited)` rather than
flapping to inactive the instant it finishes. `Type=forking` is for old daemons
that background themselves. `ExecStart` must be an **absolute path**; there is
no shell, so pipes and globs do not work unless you invoke a shell explicitly.

`[Install]` is only read by `systemctl enable`, and `WantedBy=` names the target
whose `.wants` directory gets the symlink. `multi-user.target` is the normal
answer. Leave this section out and the unit cannot be enabled at all.

Where the file goes matters: **`/etc/systemd/system/` for anything you write**.
`/usr/lib/systemd/system/` belongs to packages and your file there will be
overwritten by an update. A file in `/etc` with the same name overrides the one
in `/usr/lib` entirely; if you only want to change one directive of a packaged
unit, use `systemctl edit foo` instead, which creates a drop-in under
`/etc/systemd/system/foo.service.d/override.conf` and leaves the rest alone.

Two commands after every edit. `systemctl daemon-reload` — systemd caches unit
files and will keep using the old one until you say this. And
`systemd-analyze verify foo.service`, which parses the unit the way systemd
does and reports typo'd directives, a missing `[Install]`, and an `ExecStart`
path that does not exist. It costs a second and catches the mistakes that
otherwise show up as a failed boot.
