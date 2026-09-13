---
id: selinux.booleans-are-policy-switches
title: Booleans are switches inside the policy
rhel: 9
objectives: [selinux.booleans.modify, selinux.troubleshoot.violations]
sources: [r9:ch22, r10:ch22]
prerequisites: [selinux.labels-now-vs-policy]
---
A boolean is not a setting the service reads. It is a switch compiled into the
SELinux policy itself, wrapped around a block of rules that are otherwise not
there:

```
if (httpd_enable_cgi) {
    allow httpd_t httpd_sys_script_exec_t : file { execute execute_no_trans };
}
```

Apache has never heard of `httpd_enable_cgi`. Nothing in `/etc/httpd` mentions
it. The switch lives in the kernel's copy of the policy, and flipping it changes
what the kernel will permit — which is why a boolean change needs no service
restart and takes effect on the very next request.

They exist because the people who write the policy cannot know how you intend to
use the machine. Serving content out of user home directories, letting a web
application open a database socket on another host, allowing a CGI program to run
at all: each is legitimate somewhere and an obvious attack path somewhere else.
Rather than ship the loose policy, the policy ships tight with sanctioned
loosening points. A boolean is that: a decision the distribution deliberately
left to you.

Reading them is `getsebool -a` (usually with `| grep httpd`, or whatever domain
you are chasing) and `sudo semanage boolean -l`, which is the better of the two
because it prints a description of each switch and, crucially, **two** values:

```
SELinux boolean          State  Default Description
httpd_enable_cgi         (on   ,  off)  Allow httpd to enable cgi
```

`State` is the running policy. `Default` is the value stored on disk, which is
what the next boot will load. They differ in exactly one situation: somebody ran
`setsebool` without `-P`. That is the single most common SELinux mistake there
is, and the reason it is so common is that nothing about it looks wrong —
`getsebool` says `on`, the service works, the ticket gets closed, and the machine
breaks at the next reboot, weeks later, with no change to blame. `semanage
boolean -l` is how you catch it today rather than at 3am; `semanage boolean -l -C`
narrows the list to the switches somebody on this machine has changed, which is
the first thing worth looking at on a host you did not build.

So: `setsebool -P httpd_enable_cgi on` for anything you intend to keep. The `-P`
takes a few seconds where the bare form is instant, and the pause is the point —
it is writing the boolean into the policy store and reloading. `sudo semanage
boolean -m --on httpd_enable_cgi` is the same change made through the other
tool; both end up in the same place and either is a correct answer. Plain
`setsebool` with no `-P` is a *test*, valuable precisely because it evaporates.

Finding the right switch is usually not a search. The denial tells you: `sudo
audit2why -a` reads the audit log and, when a boolean is what stands between you
and the operation, says so by name. Failing that, the naming is predictable
enough to grep — `semanage boolean -l | grep home`, `| grep network`.

Three mistakes worth naming. **Reaching for a boolean first.** If the label on
the file is not the label the policy wants, no boolean will help you; check that
the inode and the policy agree before you go switch-hunting. **Taking the wide
switch when a narrow one exists.** `httpd_can_network_connect` lets Apache
connect to anything anywhere; `httpd_can_network_connect_db` lets it reach
database ports. Both fix a proxy that cannot connect; only one of them is still
defensible in a review. And **forgetting that booleans are system-wide.**
`httpd_read_user_content` does not mean "read this one user's files" — it means
Apache may read *every* user's content on the box. A boolean is the coarsest tool
in the SELinux kit; it is worth being sure the coarse tool is the right one before
you reach for it.
