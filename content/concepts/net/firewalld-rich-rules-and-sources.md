---
id: net.firewalld-rich-rules-and-sources
title: Allowing one network and nobody else
rhel: 9
objectives: [net.firewall.restrict-access]
sources: [r9:ch23, r10:ch23]
prerequisites: [net.firewalld-zones, net.firewalld-runtime-vs-permanent]
---
"Open port 8080 to the monitoring network only" is the request firewalld is actually
for, and the reason it trips people is that there is **no rule that denies anybody**.
A zone is a list of what it permits plus one default action for everything it does
not recognise. So restriction is never something you add — it is something you
decline to add to the zone the rest of the world lands in.

That leaves exactly two mechanisms, and they are both correct answers.

**A zone bound to the source.** Give a zone the addresses that may use the service,
then permit the service in that zone and nowhere else:

```
firewall-cmd --permanent --zone=internal --add-source=10.42.7.0/24
firewall-cmd --permanent --zone=internal --add-port=8080/tcp
firewall-cmd --reload
```

Traffic from 10.42.7.0/24 now lands in `internal` because a source match beats the
interface match, finds 8080 permitted, and is accepted. Everything else still lands
in the interface's zone, which does not permit 8080, and is rejected. Nothing was
denied anywhere. `--get-zone-of-source=10.42.7.0/24` answers "which zone did that
land in", and an address may be bound to only one zone at a time.

**A rich rule in the zone the interface is already in.** One line, no new zone:

```
firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="10.42.7.0/24" port port="8080" protocol="tcp" accept'
firewall-cmd --reload
```

Read it left to right: `family` (mandatory as soon as an address appears), then who
it is about (`source address=`, a single address, a CIDR, a `mac=` or an
`ipset=`), then what it is about (`port port= protocol=`, or `service name=`), then
the action — `accept`, `reject`, `drop` or `mark`. `log` and `audit` are optional
extras in the middle. Quoting matters to your shell, not to firewalld: wrap the
whole rule in single quotes and the inner double quotes survive.

Two traps, in the order people hit them.

**A rich rule with no source is not a restriction**, it is a long-winded
`--add-port`. If the rule names no address it applies to every address, so `rule
family="ipv4" port port="8080" protocol="tcp" accept` opens 8080 to the world and
looks careful while doing it.

**Adding an explicit reject rule for everyone else does not just fail to help — it
breaks the rule you got right.** Within one zone firewalld does not evaluate rich
rules in the order you typed them. It sorts them by action: every `reject` and
`drop` goes into the zone's *deny* set and every `accept` — along with every plain
`--add-port` and `--add-service` — goes into its *allow* set, and **the deny set is
always checked first**. So writing

```
# do NOT do this
firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="10.42.7.0/24" port port="8080" protocol="tcp" accept'
firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="0.0.0.0/0" port port="8080" protocol="tcp" reject'
```

does not produce "allow that network, refuse the rest". The reject matches
10.42.7.0/24 too, it is checked before the accept, and the one network you were
told to allow is the only one you have definitely blocked. There is no race and no
luck involved — it fails the same way every time, which is what makes it so
convincing right up until someone tries to connect. Restrict by leaving the port
out of the zone everyone else lands in, not by rejecting from it.

(`priority="N"` does let you place a rule deliberately: negative runs before
everything, positive after. It is real but it is not RHCSA material, and reaching
for it means you are working around a rule you should have deleted.)

Verification is the same pair as always, plus one more command:

```
firewall-cmd --list-all --zone=public          # the zone everyone else lands in
firewall-cmd --permanent --list-all --zone=public
firewall-cmd --list-rich-rules                 # runtime, default zone
```

`--list-all` prints `sources:` and `rich rules:` alongside `ports:`, so it is the
one view that shows both mechanisms at once. Read it in the zone your interface is
in — a rich rule in a zone with no interface and no source bound to it filters
nothing at all, and prints perfectly.

Removal is the last thing to know, because it is where the two-copies problem bites
hardest: `--remove-rich-rule` needs the **whole rule string, character for
character**, as `--list-rich-rules` prints it. Copy it from that output rather than
retyping it, and remember that removing it from the runtime copy leaves the
permanent copy holding a rule that comes back at the next reload.
