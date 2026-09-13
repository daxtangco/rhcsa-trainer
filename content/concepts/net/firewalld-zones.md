---
id: net.firewalld-zones
title: A rule lives in a zone, and the packet picks the zone
rhel: 9
objectives: [net.firewall.settings, net.firewall.restrict-access]
sources: [r9:ch23, r10:ch23]
prerequisites: [net.firewalld-runtime-vs-permanent, net.nm-connections-are-the-config]
---
Nothing in firewalld is global. Every allowed service, every open port and every
rich rule belongs to a **zone**, and an arriving packet is filtered by exactly one
of them. So "is ssh allowed on this machine" is not a well-formed question. "Is ssh
allowed in the zone this packet will land in" is.

Which zone a packet lands in is decided in a fixed order: **a source match beats
an interface match, and an interface match beats the default zone.** That order is
the mechanism behind most of what firewalld is asked to do. Binding
`--add-source=10.0.0.0/8` to the `internal` zone takes those addresses out of the
default zone entirely, whatever interface they arrive on.

It is also the reason "restrict access to this service to one network" is not
written the way people expect. **There is no deny entry.** A zone is a list of what
it permits plus a default action for everything else, so you do not add a rule
excluding the world — you allow the service in a zone bound to the addresses that
may use it, and leave the zone everyone else lands in not allowing it:

```
firewall-cmd --permanent --zone=internal --add-source=192.168.1.0/24
firewall-cmd --permanent --zone=internal --add-service=ssh
firewall-cmd --permanent --zone=public   --remove-service=ssh
firewall-cmd --reload
```

`--remove-service` is the only way to take something away, and it must name the
zone the grant is actually in.

**Every `firewall-cmd` with no `--zone` means the default zone**, which RHEL ships
as `public`. Two commands keep you honest about that: `--get-default-zone` says
which zone the default is, and `--get-active-zones` says which zones currently
have an interface or a source bound to them. **A rule added to the default zone
while the interface sits in a different one has no effect whatsoever, and
`--list-all` will show it there looking perfectly correct** — the most convincing
wrong answer firewalld offers. Which zone an interface is in is a NetworkManager
property of the connection profile (`connection.zone`); unset means the default
zone, which is why the profile is worth reading when a firewall change refuses to
matter.

The shipped zones are best remembered by what they do to traffic they do not
recognise, because that is the only thing that distinguishes most of them:

- **`trusted`** accepts everything. Nothing is filtered.
- **`public`** — RHEL's default — accepts a short list and rejects the rest.
- **`block`** rejects everything with an ICMP prohibited message, so a client
  fails immediately with a refusal.
- **`drop`** discards silently, with no reply at all, so a client hangs until it
  times out.
- **`work`, `home`, `internal`** differ from `public` only in their permitted
  lists; **`external`** adds masquerading.

Reject versus drop is a real, observable difference and a fair thing to be asked:
an instant "connection refused" means something rejected you, a long silence means
something dropped you. Choosing `drop` to hide a machine and then wondering why
your own monitoring times out is the same fact seen from the other side.

Everything above also has the two-copies problem: zones, sources and interface
assignments are all part of the configuration that exists in a runtime copy and a
permanent copy. So each command above carries `--permanent` and is followed by
`--reload`, and the diagnostic is the same pair as always — `firewall-cmd
--list-all` against `firewall-cmd --permanent --list-all`, in the zone you actually
mean.
