---
id: containers.quadlet-and-user-units
title: Making a rootless container come back by itself
rhel: 9
objectives: [containers.systemd.autostart, containers.service.run]
sources: [r9:ch26]
prerequisites: [containers.rootless-vs-rootful, systemd.enabled-vs-started, systemd.unit-file-anatomy]
---
A rootless container is supervised by a systemd manager that belongs to *you*,
not to the machine: `systemd --user`, one instance per logged-in user, addressed
by `systemctl --user`. Understanding when that manager exists is the whole
subject, because a container cannot start at boot if the thing that would start
it does not exist yet.

By default your user manager is created when you log in and destroyed when your
last session ends. So `systemctl --user enable --now web.service` gives you a
container that runs, that is enabled, that reports every state you would check —
and that dies at logout and never comes back on a reboot, because at boot nobody
is logged in. The fix is one command, and it is the single most-missed mark on
this objective:

```
loginctl enable-linger            # for yourself
sudo loginctl enable-linger student   # for somebody else
loginctl show-user student -p Linger  # yes / no
```

Lingering means "start this user's manager at boot and keep it after logout". It
is recorded as a file in `/var/lib/systemd/linger/`, which is why it survives a
reboot itself. Without it, `enable` is a promise about a manager that will not be
there.

There are two supported ways to write the unit, and neither is more correct.

**Quadlet** is the current one. Drop a `.container` file into
`~/.config/containers/systemd/` (rootless) or `/etc/containers/systemd/`
(rootful) with a `[Container]` section naming `Image=`, `PublishPort=`,
`Volume=`, and an `[Install]` section with `WantedBy=default.target`. A generator
turns `web.container` into `web.service` at every `daemon-reload` and at every
boot. Two consequences worth memorising: **you never edit the .service file, and
you never `enable` it.** The `[Install]` section inside the `.container` file is
what wires it into `default.target`, and `systemctl --user is-enabled
web.service` answers `generated`, not `enabled`. Deleting the `.container` file
is how you un-enable it.

**`podman generate systemd --new`** is the older route, deprecated but present
and still in the RHEL 9 material. It prints a unit to stdout; you save it under
`~/.config/systemd/user/`, `daemon-reload`, and `enable --now` it like any other
unit. `--new` matters: with it the unit runs `podman run` and creates a fresh
container each start, so the unit is self-contained; without it the unit runs
`podman start` against one specific existing container, and deleting that
container leaves you with a unit that can never start again.

Two operational details that waste people's time. `systemctl --user` needs
`XDG_RUNTIME_DIR` pointing at `/run/user/<uid>`; over `ssh host command` with no
login shell it is occasionally unset, and the symptom is "Failed to connect to
bus" rather than anything about containers. And a unit that starts a container
which then exits immediately looks *enabled and fine* — `systemctl --user status`
plus `podman logs` is the pair to reach for, in that order.

**The check that separates a right answer from a demo: `loginctl show-user`
before you say you are done.** "It works now" and "it will work when the machine
reboots with nobody logged in" are different claims, and for user units the
second one needs lingering as well as enabling.
