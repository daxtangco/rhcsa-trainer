---
id: systemd.targets-and-default
title: A target is a unit, and the default is a symlink
rhel: 9
objectives: [boot.targets.default, boot.targets.manual, systemd.services.enable]
sources: [r9:ch17, r10:ch17]
prerequisites: [systemd.enabled-vs-started]
---
A target is a unit with no process behind it. It runs nothing, opens nothing and
has no `ExecStart`; all it does is **want other units**. That is the entire idea,
and every question about runlevels turns into a question about which units a
particular target wants.

`multi-user.target` is "the machine is up, the network is up, people can log in
on a terminal". `graphical.target` is that plus a display manager, and it says so
in its own unit file: it `Requires=multi-user.target` and is ordered `After=` it.
So booting graphical does not mean *instead of* multi-user, it means multi-user
and then more. This is also why enabling a service is a target question: `enable`
drops a symlink into `<target>.wants/`, so `WantedBy=multi-user.target` means "any
time this machine reaches a usable state", while `WantedBy=graphical.target`
means "only when it also has a GUI".

**The default target is a symlink, not a setting.**
`/etc/systemd/system/default.target` points at the target unit systemd reaches at
the end of boot, and `systemctl set-default multi-user.target` does nothing more
exotic than rewrite that link. Which means you can check the work two ways, and
`ls -l` is the one that shows you the mechanism:

```
systemctl get-default                       # multi-user.target
ls -l /etc/systemd/system/default.target    # -> /usr/lib/systemd/system/multi-user.target
systemctl set-default multi-user.target     # rewrites the symlink
```

Then the same split as `start` and `enable`, in different words. **`set-default`
answers "at the next boot". `isolate` answers "now".** `systemctl isolate
multi-user.target` starts what the new target wants and stops everything it does
not, which on a graphical machine takes the desktop away under you. Neither verb
implies the other, so "make this machine boot to a text login" is `set-default`,
and if the question also wants it to be text *right now*, that is a second
command.

Two conveniences worth recognising. `runlevel3.target` and `runlevel5.target` are
symlinks to `multi-user.target` and `graphical.target`, which is how old
documentation and old fingers still work. And `systemctl list-dependencies
multi-user.target` prints the tree a target pulls in, which is a far better
answer to "what actually starts at boot" than reading unit files.

The other two targets are for when the machine will not boot properly.
**`rescue.target`** brings up sysinit and local filesystems and then gives you a
root shell instead of logins — the old single-user mode. **`emergency.target`** is
smaller still: a shell with almost nothing started. You reach either one by
appending `systemd.unit=rescue.target` to the kernel line in GRUB at boot, which
is the manual half of the objective: the target you boot into once, without
changing what the machine does tomorrow.

The mistake to avoid is assuming the current state. A minimal RHEL install has no
display manager at all, so its default is already `multi-user.target`; a
workstation install is the other way round. Note what that does *not* mean:
`isolate graphical.target` on the minimal machine does not fail, it succeeds and
changes almost nothing, because `graphical.target` only `Wants=` a display manager
and systemd ignores a `Wants=` on a unit that is not installed. `systemctl
get-default` costs nothing and is the only honest way to know which machine you
are on before you change it — and it is also the check after, because a task
asking for a text login is asking about a symlink you can read back.
