---
id: net.service-reachability
title: Four things must be true before a client connects
rhel: 9
objectives: [net.services.status, net.services.autostart, net.firewall.settings]
sources: [r9:ch8, r10:ch8]
prerequisites:
  [systemd.enabled-vs-started, net.firewalld-runtime-vs-permanent, net.nm-connections-are-the-config]
---
`systemctl status sshd` printing a green `active (running)` proves one thing out
of four. A client reaching a service on this machine needs all four, they fail
independently, and each one has its own instrument. Guessing between them is what
makes "nobody can connect" take twenty minutes; asking them in order takes two.

**1. The unit is running** — and, for tomorrow, enabled. `systemctl is-active
sshd; systemctl is-enabled sshd`. This is the one everybody checks, and a masked
or crashed unit is the one case where `status` really does tell you the whole
story: read the last lines it prints, then `journalctl -u sshd` for the rest.

**2. The process is listening where you think it is.** A daemon can be perfectly
healthy and bound to the wrong place. `ss -tlnp` is the question to ask:

```
ss -tlnp                        # -t tcp, -l listening, -n numbers not names, -p pid
LISTEN 0 128 0.0.0.0:22  0.0.0.0:*  users:(("sshd",pid=1042,...))
LISTEN 0 128 127.0.0.1:80 0.0.0.0:*
```

`0.0.0.0:22` (or `*:22`) means every address on the machine. **`127.0.0.1:80`
means loopback only** — that service works flawlessly from a local `curl` and does
not exist as far as the network is concerned, with nothing anywhere reporting an
error. The `users:` column needs root to show. If nothing is listening on the port
at all, you are back at condition 1 or the daemon is configured for a different
port than the one you are testing.

**3. The packets can arrive.** Two parts: the machine has an address and a route
(`ip -br addr`, and if it has none, the question is which NetworkManager profile
was supposed to bring the interface up), and the firewall permits the port in the
zone that interface is in. `firewall-cmd --list-all` shows the runtime rules for
one zone — remember there are two copies of the configuration and more than one
zone.

**4. SELinux permits it.** Almost always invisible until you move a service off
its standard port, at which point the daemon fails to bind and the log says
"permission denied" on something that looks like it should be allowed. Ports carry
labels of their own; that is a separate card and a separate command.

The order to test in is what makes this fast. **From the machine itself first:**
`curl http://localhost:80`, `ss -tlnp`. Working locally and failing remotely puts
the fault in condition 3 and nowhere else — do not touch the service. Failing
locally too rules condition 3 out entirely, so the firewall is not your problem no
matter how much it looks like a network issue. Then repeat from another host,
because that is the only test that exercises all four at once.

Two habits fall out of this. "Start, stop and check the status of network
services" is three verbs and a fourth implied one — after every start, ask
`is-enabled` as well, because a service that is up now and gone after a reboot
satisfies a demonstration and fails the requirement. And when someone hands you a
broken machine, expect **more than one** of the four to be wrong: the trainer's
own SSH-recovery task breaks three separate things at once precisely because
finding the first fault and declaring victory is the habit that costs marks.
