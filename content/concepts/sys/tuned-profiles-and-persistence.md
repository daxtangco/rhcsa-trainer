---
id: sys.tuned-profiles-and-persistence
title: Tuning profiles, and what "active" actually means
rhel: 9
objectives: [sys.tuned.profiles]
sources: [r9:ch10, r10:ch10]
prerequisites: [systemd.enabled-vs-started]
---
**tuned** is a daemon that applies a named bundle of kernel and device settings —
a *profile* — and keeps applying it. A profile is a directory under
`/usr/lib/tuned/` containing a `tuned.conf` of sysctls, I/O schedulers, CPU
governor choices and the like; your own overrides go in `/etc/tuned/`, which wins.
Profiles can inherit from each other (`include=` in `tuned.conf`), so
`virtual-guest` is `throughput-performance` plus a few VM-specific changes rather
than something unrelated to it.

```
tuned-adm list                    # every profile available, and the current one
tuned-adm active                  # just the current one
tuned-adm recommend               # what tuned would pick for this hardware
tuned-adm profile throughput-performance
tuned-adm verify                  # are the profile's settings still in force?
tuned-adm off                     # apply nothing
systemctl enable --now tuned      # the half people forget
```

The profiles worth recognising by name: `throughput-performance` (server default —
trades latency and power for bulk throughput), `latency-performance`,
`balanced`, `powersave`, `virtual-guest` (for a VM), `virtual-host`.

**tuned is a daemon, and everything follows from that.** `tuned-adm` does not
change the system; it talks over D-Bus to `tuned`, which does. Two consequences:

- `tuned-adm profile ...` needs a daemon to talk to. Recent versions try to
  `service tuned restart` for you when there is none, and then either succeed
  quietly or fail with `Unable to switch profile` — which is a coin flip you do
  not want to be making. Start the service first and the command has one
  behaviour.
- Note what that convenience does **not** do: it may *start* tuned, it never
  *enables* it. Do not read a successful `tuned-adm profile` as evidence that the
  service half of the question is done.
- A profile applied by a `tuned` that was started but never *enabled* is gone at
  the next boot. Nothing on the running system hints at this — the settings really
  are in force, `tuned-adm active` really does name your profile — and after the
  reboot no profile is applied at all. `systemctl enable --now tuned` is one
  command; `systemctl start tuned` is a bug with a delay fuse.

**How persistence actually works**, because it explains what to check. When you run
`tuned-adm profile NAME`, tuned writes two small files: `/etc/tuned/active_profile`
(the name) and `/etc/tuned/profile_mode` (`manual`). At the next boot the daemon
reads them and applies that profile again. `profile_mode` matters more than it
looks: in `auto` mode tuned runs its own `recommend` logic at startup and picks for
itself, so on a VM it would land on `virtual-guest` no matter what you had chosen.
`manual` is what says "I decided this".

Knowing those files is useful; **reading them is not the same as checking your
work.** `/etc/tuned/active_profile` records what was *requested*. On a host where
tuned is dead or was never started, that file still reads back the profile you
asked for while nothing whatsoever is applied. `tuned-adm active` asks the daemon,
which is the only witness to a profile being in effect — and it is what the manual
page tells you to use.

Read its wording, though, and not just the profile name in it. With the daemon
running you get:

```
Current active profile: throughput-performance
```

With the daemon down, `tuned-adm active` falls back to that same
`/etc/tuned/active_profile` file and tells you so:

```
It seems that tuned daemon is not running, preset profile is not activated.
Preset profile: throughput-performance
```

Same name, opposite meaning. `Preset` means "this is what would be applied", not
"this is applied". So check with `systemctl is-active tuned` **and** `tuned-adm
active` **and** `systemctl is-enabled tuned`, and you have covered every half of
any question about a tuning profile: in effect now, and in effect again on Monday.
