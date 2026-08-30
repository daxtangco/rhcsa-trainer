---
id: net.firewalld-runtime-vs-permanent
title: firewalld keeps two copies of everything
rhel: 9
objectives: [net.firewall.settings]
sources: [r9:ch25, r10:ch25]
---
firewalld holds two configurations at once. The **runtime** configuration is
what is filtering packets this second. The **permanent** configuration is what
will be loaded at the next boot or reload. `firewall-cmd` writes to one or the
other, never both, and which one depends on a flag that is easy to forget.

```
firewall-cmd --add-service=ssh                # runtime only - gone at reboot
firewall-cmd --permanent --add-service=ssh    # permanent only - not active yet
firewall-cmd --permanent --add-service=ssh && firewall-cmd --reload   # both
firewall-cmd --add-service=ssh && firewall-cmd --runtime-to-permanent # both
```

The last two are equally correct and it is worth being fluent in both.
`--permanent` then `--reload` is the one to reach for when you know what you
want. `--runtime-to-permanent` is the one for when you have been experimenting:
it commits whatever is currently working, which is exactly the situation where
retyping the commands with `--permanent` invites a typo.

**`--reload` discards the runtime configuration** and replaces it with the
permanent one. That is the point of it, and it is also the trap: any change you
made without `--permanent` disappears the moment you reload for an unrelated
reason. A rule that works and then vanishes an hour later was a runtime rule.

Read the two copies separately and compare them — this is the single most
useful firewalld diagnostic:

```
firewall-cmd --list-all               # runtime
firewall-cmd --permanent --list-all   # permanent
```

If they differ, you have found the bug. Note that `--list-all` prints services
*and* ports, while `--list-services` prints only services — so a rule added as
`--add-port=22/tcp` is invisible to `--list-services` even though it permits
ssh perfectly well. Two spellings, one effect: `--add-service=ssh` looks up the
port in `/usr/lib/firewalld/services/ssh.xml`, and `--add-port=22/tcp` says it
directly. Prefer the service name when one exists, because it stays right if
the service's ports ever change.

Everything above is per-zone, and every command silently means `--zone=public`
unless you say otherwise. `firewall-cmd --get-active-zones` tells you which
zone your interface is actually in, and a rule added to the wrong zone has no
effect at all while looking perfectly correct in `--list-all`.
