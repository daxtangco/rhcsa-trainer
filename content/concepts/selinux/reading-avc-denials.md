---
id: selinux.reading-avc-denials
title: Reading an AVC denial
rhel: 9
objectives: [selinux.troubleshoot.violations, selinux.contexts.identify, selinux.modes.enforcing-permissive]
sources: [r9:ch22]
prerequisites: [selinux.labels-now-vs-policy, selinux.modes-now-and-at-next-boot]
---
When SELinux blocks something, it tells you exactly what it blocked, and the
message is the only non-guess available to you. Everything else — the 500 page,
the "Permission denied" on a file with mode 644, the service that will not start
on a free port — is the application's second-hand account of a decision it did
not understand.

The kernel hands each denial to the audit subsystem. With `auditd` running they
land in `/var/log/audit/audit.log`, and the tool that reads them is `ausearch`:
`sudo ausearch -m AVC -ts recent` is the command to build a reflex around
(`-ts today`, `-ts 09:00` when "recent" is too narrow). With no auditd they go
to the kernel ring buffer instead, so `dmesg | grep -i avc` and
`journalctl -k` are the fallbacks. If `setroubleshoot-server` is installed you
also get plain-English summaries in the journal under `journalctl -t
setroubleshoot`, which are genuinely useful and occasionally confidently wrong.

A denial reads like a sentence once you know the four words that matter:

```
type=AVC msg=audit(...): avc:  denied  { execute } for  pid=2311 comm="httpd"
  path="/srv/reports/status.sh" dev="dm-0" ino=8409
  scontext=system_u:system_r:httpd_t:s0
  tcontext=unconfined_u:object_r:var_t:s0 tclass=file permissive=0
```

`scontext` is who was denied — read the third field, the *type*: `httpd_t`.
`tcontext` is what they were denied it on: `var_t`. `tclass` says what kind of
thing that was: a `file`. `{ execute }` is the permission. So: *the web server
was not allowed to execute a file labelled var_t.* Nothing about Unix
permissions, nothing about the port, nothing about Apache's configuration. Read
that one sentence and the search space collapses.

From there the triage is short, and it is always the same order. **Is the target
label wrong?** Compare what is on the inode with what the policy wants —
`ls -Z` against `matchpathcon` — and if they disagree, `restorecon` is your
answer. **Do they agree?** Then the label is what the policy intends and the
answer is elsewhere: a boolean that is off, a port that is not labelled, or a
genuine gap in the policy. `sudo audit2why -a` (or `audit2allow -w`) reads the
same log and will often say *"one of the following booleans was not set"* and
name it. That is what `audit2why` is for.

What `audit2allow -M mymodule` is for is the last case, and only that one.
Generating a module and running `semodule -i` on it grants that permission to
every process of that type, forever, on this machine — a fine answer for a
legitimate local requirement and a terrible one for a mislabelled file, because
it hard-codes an exception around a mistake instead of correcting it.

Two things that make denials disappear when they should not. The policy contains
`dontaudit` rules that silence denials known to be harmless noise, so a real
problem can produce no log line at all; `sudo semodule -DB` disables them
temporarily and `sudo semodule -B` puts them back. And in **enforcing mode the
first denial aborts the operation**, which hides every problem behind it. Two
independent faults — a wrong label *and* an unset boolean — surface one at a
time: fix the first, make the request again, read the log again. Expect the
second denial rather than concluding your fix did not work.

Which brings us to `setenforce 0`. As a diagnostic it is legitimate and quick:
permissive mode still logs every denial but enforces none, so one request
collects the whole list instead of the first item. As an *answer* it is the worst
thing you can do. The symptom vanishes, you have learned nothing, the machine is
unprotected, and — because `setenforce` does not touch `/etc/selinux/config` —
the next reboot restores enforcing and the outage comes back at whatever hour
that reboot happens. If you switch it off to look, switch it back on before you
do anything else. `semanage permissive -a httpd_t` is the narrower version of
the same idea: one domain unenforced, the rest of the system intact. Useful while
investigating; still not a fix to hand back.
