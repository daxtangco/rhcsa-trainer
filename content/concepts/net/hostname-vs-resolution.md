---
id: net.hostname-vs-resolution
title: A hostname is not a name that resolves
rhel: 9
objectives: [net.hostname.resolution]
sources: [r9:ch8, r10:ch8]
---
Two separate facts get confused because one command appears to set both. **What
this machine calls itself** and **what names this machine can look up** are
independent, and either can be right while the other is wrong.

The name the machine calls itself lives in two places at once:

- the **transient** name, held by the running kernel. `uname -n` and `hostname`
  print it; `hostname app1.lab.example.com` sets it. It is a runtime value, so
  it is gone at the next boot.
- the **static** name, in `/etc/hostname`. One line, the name, nothing else. It
  is what systemd reads at boot and pushes into the kernel.

`hostnamectl set-hostname app1.lab.example.com` sets both at once (and the third,
cosmetic **pretty** name in `/etc/machine-info`), which is why it is the command to
use — and why `hostname app1.lab.example.com` is the classic near-miss. The prompt
changes, `uname -n` agrees, everything you think to check is right, and after a
reboot the machine is called what it was called before. `nmtui` does the same job
from its **Set System Hostname** menu entry.

```
hostnamectl                       # static, transient and pretty names at once
hostnamectl set-hostname app1.lab.example.com
hostnamectl --static              # just the persistent one
cat /etc/hostname                 # the same fact, from the file itself
```

Read `hostnamectl`'s output knowing that it prints a **Transient hostname** line
only when the transient name differs from the static one. One `Static hostname:`
line and no transient line means the two agree; a machine showing both has been
renamed at runtime and not on disk, which is precisely the near-miss above.

RHEL keeps **one** name, written in fully qualified form. There is no separate
"domain" setting to configure: the short name is simply everything before the
first dot, which is what a shell prompt shows.

Setting the name does not make it **resolve**. Resolution is a lookup, and a
lookup goes through `/etc/nsswitch.conf`'s `hosts:` line — on RHEL 9 that is
`files dns myhostname`, meaning `/etc/hosts` first, then a name server, then a
module that answers for the local hostname. So a freshly renamed host can be
called `app1.lab.example.com` while no name server has ever heard of it, and
`ping app1.lab.example.com` from anywhere else fails.

The reverse also happens: `getent hosts app1.lab.example.com` succeeding on the
host itself proves very little, because `nss-myhostname` answers for whatever the
current hostname is even with an empty `/etc/hosts`. To know whether the *file*
maps the name, read the file.

One practical reason to make the machine's own name resolvable locally: `sudo`
looks up the local hostname to match `sudoers` host specifications. If the name
is in neither `/etc/hosts` nor DNS, that lookup goes out to a name server first and
waits for its answer — or, on a host whose name server is unreachable, waits out
the timeout — and `sudo` feels slow for reasons that have nothing to do with
`sudo`. Renaming a host and adding its `/etc/hosts` entry are one job, not two.
