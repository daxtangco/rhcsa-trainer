---
id: selinux.modes-now-and-at-next-boot
title: The mode is two questions, not one
rhel: 9
objectives: [selinux.modes.enforcing-permissive]
sources: [r9:ch22, r10:ch22]
prerequisites: [selinux.labels-now-vs-policy]
---
There are three states and one of them is not like the other two. **Enforcing**:
the policy is consulted, denials are refused, and each one is logged.
**Permissive**: the policy is consulted and each denial is logged, and nothing is
refused. **Disabled**: the policy is not consulted at all.

So permissive is not "SELinux off". It is SELinux with the enforcement removed and
the *measurement* intact, and that difference is the whole reason it exists.

Then the structure that matters, which is the same shape as `start` versus
`enable`. **What is the mode now, and what will it be at the next boot?** Two
questions, two places, and one command that answers both:

```
getenforce                                  # now
grep '^SELINUX=' /etc/selinux/config        # at the next boot
sestatus                                    # both: "Current mode" and "Mode from config file"
```

`setenforce 0` and `setenforce 1` change the running mode and write nothing to
disk. Editing `SELINUX=` in `/etc/selinux/config` changes the next boot and does
nothing right now. Neither implies the other, so a task that requires enforcing
mode "now and at the next boot" is asking you to check two things — and a machine
that was put in permissive mode with `setenforce` during troubleshooting looks
completely correct in the config file while being unprotected until somebody
reboots it.

**Edit that line; do not append one.** The config file is read by one small
function in libselinux, and it is fussier than it looks. It takes the **first**
line that begins with the literal eight characters `SELINUX=` and stops there, so
`echo SELINUX=enforcing >> /etc/selinux/config` leaves the old value above the new
one still deciding the boot. The line must start at the first column, and there is
no space before the `=`: `SELINUX = enforcing` matches nothing. The value itself is
forgiving — case-insensitive, and trailing text is ignored, so `SELINUX=Enforcing`
is fine. And if nothing in the file is recognised, the boot does not stop and does
not guess enforcing: it falls back to **permissive**. A typo here costs you your
enforcement silently, which is the reason to read the result back rather than trust
the edit:

```
sestatus | grep 'Mode from config file'    # asks libselinux, not your eyes
```

`setenforce` only moves between enforcing and permissive. There is no third
argument: reaching *disabled*, or coming back from it, needs a reboot, because it
is a question about whether the kernel is making decisions at all rather than what
it does with them.

**Permissive is an instrument, not a fix.** Its value is precise: in enforcing
mode a request stops at its first denial, so you learn about one problem at a time,
while in permissive mode the same request runs to completion and logs *every*
denial it would have hit. One reproduction, the complete list. Its cost is equally
precise: the machine is unprotected for as long as you leave it there. Every graded
SELinux task in this trainer insists on enforcing mode at the end, and that is not
strictness for its own sake — a task solved in permissive mode has not been
solved, because nothing was ever tested against the policy that will be running
tomorrow.

**Disabled is the expensive one, and the cost is on the way back.** While SELinux
is disabled the labels are not maintained: files created or modified get no
security context at all. Returning to enforcing therefore means relabelling the
entire filesystem — `touch /.autorelabel` and reboot — and a machine that comes up
enforcing with a partly unlabelled filesystem denies things everywhere at once,
which looks like a catastrophe and is really just unfinished bookkeeping.
Note also that on RHEL 9 `SELINUX=disabled` no longer switches SELinux off in the
kernel the way it did up to RHEL 8; it boots with SELinux enabled and **no policy
loaded**, which is why `getenforce` still says `Disabled` and why the labelling
bill above is still owed. Only `selinux=0` on the kernel command line disables it
outright. The shipped `/etc/selinux/config` says so in its own comments — worth
reading once.
Permissive gives you the same freedom to observe and never incurs that bill, which
is why "disable SELinux" is the wrong reflex even when it appears to be the fast
one.

One last place to look, for the case where the config file and reality disagree
and nothing explains it: the kernel command line wins. `enforcing=0` boots
permissive and `selinux=0` boots disabled regardless of what
`/etc/selinux/config` says, so `cat /proc/cmdline` is worth reading before you
conclude that the file is lying to you.
