---
id: net.resolution-order-and-hosts
title: Where a name lookup goes, and what /etc/hosts really says
rhel: 9
objectives: [net.hostname.resolution]
sources: [r9:ch8, r10:ch8]
prerequisites: [net.hostname-vs-resolution]
---
A name lookup on RHEL follows the `hosts:` line of `/etc/nsswitch.conf`, in
order, stopping at the first source that answers. On RHEL 9 that line reads:

```
hosts:      files dns myhostname
```

- **files** is `/etc/hosts`. No network, no daemon, no delay.
- **dns** is whatever `/etc/resolv.conf` points at.
- **myhostname** answers for the local hostname and for `localhost`, so a machine
  keeps resolving its own name even if both of the above are empty.

Two consequences worth remembering. A name in `/etc/hosts` is never asked of a
name server, which is how you override DNS for one host. And a name in *neither*
`/etc/hosts` nor DNS costs a round trip to the name server before it fails,
because `dns` is consulted before `myhostname` gets a turn — a reachable server
answers "no such name" straight away, but an unreachable or wrong one makes that
lookup wait out the resolver timeout instead.

`/etc/hosts` has exactly one grammar, and getting it backwards is the commonest
mistake in the file:

```
192.168.4.210   server1.example.com   server1
```

**Address first**, then the canonical name, then any number of aliases. Anything
after `#` is a comment. An address may appear on more than one line, and all the
names found for it count. Reversed — `server1.example.com 192.168.4.210` — the
line is not an error and nothing warns you: the resolver cannot parse the first
field as an address, skips the line, and the name resolves exactly as well as it
did before, which is not at all.

Include the fully qualified name and not just the short one. The short form is
what a prompt shows, but the fully qualified name is what a certificate is issued
for, what a reverse lookup is expected to return, and what a peer usually asks
about.

Check with the resolver rather than with your eyes, because only one of the two
knows whether a line parsed:

```
getent hosts filer1.lab.example.com    # what the resolver answers, files first
getent hosts filer1                    # the short name too - test both
```

`ping` is a poor test here and `host`/`dig` are worse: those two query DNS
directly and ignore `/etc/hosts` entirely, so they will report a name as
non-existent that every ordinary program on the system resolves perfectly.

`/etc/resolv.conf` is the other half, and on a default RHEL 9 install it is an
**output**: NetworkManager owns it, so it carries a generated-by banner and is
rewritten from the active connection profile whenever that connection comes up.
Editing it works until the next activation or reboot. (NetworkManager can be told
to leave the file alone, with `dns=none` in `/etc/NetworkManager/conf.d`, but that
is a deliberate change to make and the banner tells you which world you are in.)
The setting belongs in the profile —
`ipv4.dns` for the name server and `ipv4.dns-search` for the domains appended to
short names — where `nmcli connection modify` writes it to disk and the next
activation applies it.
