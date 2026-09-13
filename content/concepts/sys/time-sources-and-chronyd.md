---
id: sys.time-sources-and-chronyd
title: Configuring a time client, and the two places a source can live
rhel: 9
objectives: [sys.time.chrony]
sources: [r9:ch25, r10:ch25]
prerequisites: [systemd.enabled-vs-started]
---
RHEL 9 keeps time with **chrony**: the daemon `chronyd`, the configuration file
`/etc/chrony.conf`, and the control program `chronyc`. There is no `ntpd` and no
`ntpq` any more; `timedatectl set-ntp true` is a systemd front end that enables
and starts `chronyd`, nothing more exotic than that.

A source is declared by one of three directives, and the difference matters:

- `server ADDRESS` — this one host, exactly.
- `pool NAME` — a *name that resolves to several addresses*, each of which becomes
  a source. This is what the stock file ships (`pool 2.rhel.pool.ntp.org iburst`),
  and it is why "I only configured one source" is often untrue.
- `peer ADDRESS` — a symmetric relationship between two equals, rarely what you
  want as a client.

`iburst` is worth adding to any of them: without it chrony sends its first few
probes minutes apart, so a freshly started daemon takes a long time to settle.

```
server 192.0.2.10 iburst          # in /etc/chrony.conf, or a file under /etc/chrony.d
systemctl enable --now chronyd
systemctl restart chronyd         # after ANY edit — see below
chronyc -n sources                # what the running daemon actually has
chronyc tracking                  # how well it is doing
```

**The mistake that catches nearly everybody: `chronyd` reads its configuration
once, when it starts.** Edit the file on a host where chronyd is already running
and nothing happens — no warning, no re-read, and `chronyc sources` still shows
the old sources. There is no `reload` for this; `systemctl restart chronyd` is the
fix. Getting into the habit of "edit, then restart, then `chronyc sources` to
confirm" is the single highest-value reflex in this objective, because the machine
looks correct either way.

**The other half of the same coin: `chronyc add server ADDRESS` is not
configuration.** It is a real command and a useful one — it adds a source to the
running daemon without a restart — but it writes nothing to disk. At the next boot
the source is gone. Anything asked of you "persistently" has to end up in a file.

Those two facts are why a time client is really two separate questions, and you
should check both every time: *does the running daemon have the source*
(`chronyc -n sources`) and *is it written down* (`grep -E '^(server|pool|peer)'
/etc/chrony.conf /etc/chrony.d/*.conf`). A correct answer satisfies both.

**Where to write it.** Either directly in `/etc/chrony.conf`, or as a drop-in
`/etc/chrony.d/something.conf`. The drop-in is the tidier habit — the package owns
`chrony.conf`, you own your file — but it works only if `chrony.conf` includes the
directory, and **on RHEL 9 it does not.** The stock file has no `confdir` line and
no `include` line, and the `chrony` package does not even create `/etc/chrony.d`.
So the drop-in route on this release is three steps, not one:

```
mkdir -p /etc/chrony.d
vim /etc/chrony.d/site-time.conf          # server 192.0.2.10 iburst
echo 'confdir /etc/chrony.d' >> /etc/chrony.conf
```

Skip the third and you have written a file `chronyd` never opens — no error, no
warning, and `chronyc sources` simply stays empty. `grep -E '^(confdir|include)'
/etc/chrony.conf` is how you check, and if it comes back empty the safe answer
under exam pressure is to put the `server` line in `/etc/chrony.conf` itself.

`sourcedir` is a third directive with a different rule: it reads `*.sources` files
(not `*.conf`) and they may hold only source lines. RHEL 9's stock file does carry
`sourcedir /run/chrony-dhcp`, where NetworkManager drops NTP servers handed out by
DHCP — so if a source appears that you did not configure, that is where it came
from.

Finally, "and from nothing else" is a real requirement whenever you see it. Adding
your site's server without removing the stock `pool` line leaves a host that still
asks the public internet for the time. Comment the line out or delete it —
`chronyc sources` after the restart should list what you intended and nothing
more.

Use `-n` with `chronyc` when the host has no working DNS: without it chronyc tries
to reverse-resolve every address and you wait for timeouts instead of getting
output. And read an unreachable source (`?` in the first column, `Reach` 0) as a
*network* answer, not a configuration one — the source can be perfectly well
configured and still unreachable.
