---
id: selinux.ports-are-labeled-too
title: Ports have SELinux types
rhel: 9
objectives: [selinux.ports.labels]
sources: [r9:ch22, r10:ch22]
prerequisites: [selinux.labels-now-vs-policy]
---
SELinux does not only label files. TCP and UDP port numbers are labelled too,
and a confined service may only bind a port whose type its policy allows.
`httpd` is allowed `http_port_t`, which by default covers 80, 443, 8080 and a
few others. Port 82 is not in that list.

So this happens:

```
# systemctl start httpd
Job for httpd.service failed.
# journalctl -u httpd
(98)Address already in use: AH00072: make_sock: could not bind to 0.0.0.0:82
```

Nothing is using port 82. `ss -ltn` shows it free. The message is wrong because
Apache is reporting a generic bind failure for a permission denial it does not
understand. This is the most misleading error in the whole SELinux surface, and
recognising it — a bind failure on a port that is demonstrably free — is worth
more than any command.

The fix is one line:

```
semanage port -a -t http_port_t -p tcp 82
```

`-a` adds, `-m` modifies an existing entry, `-d` deletes. List what is already
labelled with `semanage port -l`, and narrow it with
`semanage port -l | grep http`. There is no "restorecon for ports": the policy
database *is* the state, so unlike file contexts this is a one-step change and
it is permanent as soon as you make it.

The habit: when a service refuses to start on a port you chose yourself, and
the port is free, check `semanage port -l` before you check anything else. When
the port is one the service already owns, SELinux is not your problem.
