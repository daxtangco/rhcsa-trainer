# Enforced offline mode

Phase 2: *offline mode for drill and exam.* Design reference: §10.3 (the
requirement), §17 risk R1 (the reason it is not one line), §9.1 (which modes),
§4.2 (why package tasks still work).

Files: `src/engine/vm/offline.ts`, `applyNetworkMode` in `src/server/app.ts`,
`Rail.tsx`'s offline note.
Tests: `test/vm-offline/offline.test.ts`, `test/vm-offline/offline-script.test.ts`,
`test/vm-offline/stub-net.sh`, plus the wiring's own tests in
`test/server/app.test.ts`, `test/web/rail.test.tsx` and `test/web/app.test.tsx`.

§10.3 in full:

> In drill and exam modes the VM's default route is dropped. Package tasks
> continue to work because §4.2 configures a local ISO-backed dnf repository.
>
> **Honest limit:** this cannot stop the user opening a browser on the host. It is
> a habit device, not a cage.

The habit is the deliverable. `curl`, internet `dnf` and a pasted URL fail, so
`man` and `/usr/share/doc` become the path of least resistance — which is the
exam's actual constraint. Nothing here is hardened as if it were a cage, and
nothing here should be.

Practice and guided stay online (`OFFLINE_BY_MODE`). §9.1 makes practice the
untimed mode with the whole disclosure ladder open; a mode that withholds nothing
else has no business withholding the internet. Guided mode is showing the student
the command to type.

## The measurement that changed the design

Read from the host, R1 says the control channel dies. `docs/r1-findings.md`
(2026-08-30) records the WSL host on its own Hyper-V NAT and the guest on VMnet8:

```
ip route get 192.168.70.1
  192.168.70.1 via 172.22.96.1 dev eth0 src 172.22.101.110 uid 1000
```

Different subnets. So the guest has no on-link path back to `172.22.101.110`, its
replies must leave by the default route, and `ip route del default` takes ssh, the
grader and the terminal bridge with it.

**Asked from inside the guest instead, that is false — in the lucky direction.**
Windows SNATs WSL's traffic on its way onto VMnet8, so the guest never sees a
`172.22.x.x` address at all (2026-09-13, guest `192.168.70.130`):

```
SSH_CONNECTION=192.168.70.1 55044 192.168.70.130 22
ip route get 192.168.70.1  ->  192.168.70.1 dev ens160 src 192.168.70.130
```

No `via`. The ssh client arrives as the VMnet8 host adapter, **on-link on the
guest's own /24**, reachable without consulting the default route. Dropping the
default route cannot break ssh on this topology, and `enforceOffline` takes its
"peer needs no route of its own" branch: it adds nothing, records nothing, and
offline mode is free.

This is the second time on this project that a host-side inference about the guest
turned out to be wrong in a way only the guest could report (the first was
`/run/systemd/journal/flushed`, `content/concepts/sys/journald-storage-modes.md`).
The lesson is cheap to state and easy to skip: *the reply path is a fact about the
machine sending the replies.*

## So why is the preserve machinery there at all?

Because on-link-ness is a fact about one host's VMware NAT and one Windows build's
SNAT, not a property of this design. Bridged networking, a NAT port-forward, a
second NIC, or running the app anywhere other than WSL each put the client back
off-subnet — and two of those are R1's own ranked fallbacks. The script therefore
**asks** the guest which case it is in rather than encoding either answer. The
favourable topology is exploited, not depended on.

What it must never do is assume the unfavourable case and hardcode
`172.22.96.0/20`: that address comes from DHCP and changes across host reboots, so
a constant there is a habit device that bricks the control channel one reboot
later.

Three derivations, each for the same reason — the guest can be asked:

- **The peer** comes from `SSH_CONNECTION`, which sshd sets from the accepted
  socket, so it names the client of *this very command*. Falls back to the peers of
  established connections to sshd, because `SSH_CONNECTION` is unset over vmrun
  (the script runs from `vmtoolsd`) while the xterm.js bridge still holds its own
  ssh connection — an enforcement over vmrun that preserved nothing would silently
  kill the student's terminal.
- **The prefix is `/32`** (or `/128`), not the peer's subnet. Nothing on the
  guest's side of the link carries the client's prefix length, so any subnet form
  would be a guess. One host route suffices: §1 says one user, one VM.
- **The gateway** comes from `ip route get <peer>`, not from `192.168.70.2`.

## Ordering is the safety property

Enforcement adds the specific route **before** deleting the general one, and a
failed add aborts with the default route untouched. Restoration is the mirror: the
default route goes back first, and if it does **not** come back the preserve route
is **kept**, the state file is kept, and the call reports failure.

That mirror is load-bearing rather than symmetrical-for-neatness. Removing the
preserve route while the default route is missing converts a recoverable degraded
guest — offline, still reachable — into the one state nothing inside the guest can
repair, because there is no longer a control channel through which to repair the
control channel. It would also have done so on precisely the path this module
flags as unverified (that `ip route add` swallows an `ip route show` line
verbatim). The check is a **read-back** of `ip route show default`, not "did the
add command succeed", because NetworkManager may have re-added the route itself,
in which case the add fails with `File exists` and the guest is online anyway.
Both branches are pinned by tests.

None of this is a transaction, and the module says so. The remaining window is
enforcement's alone: if the delete lands and the preserved route turns out not to
carry replies, recovery is `vmrun revertToSnapshot clean` or a reboot. That is
also why the state file is `/run/rhcsa-offline.state` — on tmpfs, so both of those
recoveries clear it. A path under `/tmp` would survive a reboot and then claim the
guest was offline after DHCP had already re-leased the default route, and
`restoreNetwork` would act on that stale claim.

`enforceOffline` is idempotent, and the "no default route" check is the *first*
thing it does — so an already-offline guest, or a snapshot reverted mid-provision,
is an exit-0 no-op that adds and records nothing. Idempotence is also the
mitigation for NetworkManager: a caller may re-apply at any point in a session.

## Deliberately not enforced

- **DNS still resolves — measured, not just predicted.** Offline,
  `getent hosts mirrors.fedoraproject.org` returned four addresses and exited 0
  while `curl` to that same name failed with `exit=7`. VMware's NAT gateway is a
  DNS forwarder and stays on-link, so resolution never consults the default route;
  reachability does. That gap is the shape of this whole feature in one reading:
  the name still works, the connection does not. Breaking
  resolution means editing `/etc/resolv.conf` — a persistent change that a
  snapshot taken while offline mode was applied would carry into the reset
  baseline. A habit device must not leak into the golden image.
- **NetworkManager may put the default route back** on a DHCP renewal or a link
  event, and the VMnet8 lease is shorter than a 150-minute exam.
  `ipv4.never-default` would survive it but bounces the connection (killing ssh
  mid-command) and writes persistent config, so it is rejected for the same reason.
- **A reboot puts the route back, and nothing re-applies it mid-attempt.** Two
  things reboot the guest inside a session: a `reboot_check` task's own verdict-B
  reboot, and `POST /api/demos`. Both leave the guest online for the rest of that
  attempt, because DHCP re-leases the default route and `/run` is cleared with it.
  Not fixed, and the reason is the same one that put the state file on tmpfs: the
  only honest place to re-apply is after every reboot the app performs, which means
  `VmController.reboot` growing a dependency on training mode. A student who is
  three-quarters through a graded task and has just watched their machine restart
  is not the student about to go and read Stack Overflow, and `/reset` — the one
  that *does* get re-applied — is the path they take if they start over.

## Measured against the guest

The routing logic is exercised entirely against `stub-net.sh` — the real script
text under the host's `bash`, with `ip`/`ss`/`sudo` as shell functions, so nothing
touches this host's routing table and no test needs a hypervisor. Everything below
is what that cannot prove, and this section was a list of seven open items until
2026-09-14, when six of them were measured against the live guest (`192.168.70.130`)
as **enforce, then probe, then restore, then probe again** — because a single
post-enforcement reading cannot tell "offline mode did this" from "this guest never
had a way out in the first place". Item 4 took two passes; the first one is kept
below, because the way it failed is more useful than the fact that it did.

1. **A live `enforceOffline`: done, and it was the free case the topology
   predicted.** `preserved: []` and the note `peer 192.168.70.1 needs no route of
   its own`, so the on-link branch was taken, no host route was added, and the only
   change was `dropped default route (-4)`. **ssh survived it** — not argued but
   demonstrated, because the offline half of the probe was itself delivered over the
   ssh connection whose route had just been dropped.
2. **`curl` does report failure, and this is the item that most needed measuring.**
   Online, `http=301 exit=0` to a bare address and `http=302 exit=0` to a name.
   Offline, both are `curl: (7) Couldn't connect to server`, `http=000 exit=7`, and
   the FIB agrees: `ip route get 1.1.1.1` → `RTNETLINK answers: Network is
   unreachable`. Userspace and the kernel tell the same story, which is what the
   habit device needs. Internet `dnf` is still an inference rather than a
   measurement — it is the same missing route, but nothing ran it.
3. **`ip route add` does accept an `ip route show` line verbatim**, for the IPv4
   form this guest actually has: `default via 192.168.70.2 dev ens160 proto dhcp
   src 192.168.70.130 metric 100` went out and came back byte-identical, restore
   reported `restored default route (-4)`, and `status.after.defaultRoutes` equalled
   `status.before.defaultRoutes`. **The IPv6 `pref medium` form remains unmeasured
   and cannot be measured here**: this guest has no IPv6 default route at all
   (`ip -6 route show default` prints nothing), so there was nothing to round-trip.
4. **Local ISO-backed dnf keeps working with no default route — §4.2 holds, and it
   was measured rather than assumed.** Offline, `/dev/sr1` was still mounted at
   `/mnt/rhcsa-dvd`, `dnf repolist --enabled` still listed `rhcsa-baseos` and
   `rhcsa-appstream` at their `file:///mnt/rhcsa-dvd/...` baseurls, `repoquery`
   still answered `zsh-5.8-9.el9`, the depsolve still planned `Install 1 Package /
   Total size: 3.2 M`, and `--downloadonly` still finished with `Complete!`. Every
   one of those readings is **byte-identical to the online run**, which is the whole
   claim: a `file://` repo does not consult the routing table, so a package task in
   drill or exam mode behaves exactly as it does in practice mode. `rpm -q zsh` says
   `package zsh is not installed` in both states, so the probe planned and fetched
   without changing the guest.

   Two things to keep. The first attempt at this item **measured the probe, not the
   guest**: it asked for `--enablerepo=rhcsa-dvd` and got `Error: Unknown repo:
   'rhcsa-dvd'` in online, offline *and* restored states, which is the tell, since a
   network-dependent failure cannot be network-independent. `rhcsa-dvd` is the
   *filename* `scripts/guest-provision.sh:128` writes; the repo **ids** in it are
   `rhcsa-baseos` and `rhcsa-appstream` (lines 129 and 136). That is worth writing
   down rather than quietly overwriting, because an unknown-repo error is
   indistinguishable in a log from the broken repo this item exists to look for, and
   reading it as §4.2 failing would have sent someone to rebuild a guest that is
   fine. The second: `dnf clean packages` exited 0 afterwards and
   `/var/cache/dnf` still holds 24M. That is repodata, not the downloaded rpm — but
   the size was not read *before* the probe, so whether the probe grew it is not
   something this run can say. Any later probe that touches the cache should read it
   both sides.
5. **`sudo ip route` is passwordless for `student`**: `sudo -n ip route show`
   exited 0 in all three states. Note the second thing that follows from it — a
   student can undo offline mode from inside the guest in one command. That is not a
   hole to be closed; §10.3 already says this is a habit device and not a cage, and
   a `sudo` this bank's graders depend on cannot be taken away.
6. **`ss`'s column layout and the sshd port are as assumed.** Under the state
   filter, `ss -H -tln state listening '( sport = :22 )'` returned
   `0 128 0.0.0.0:22 0.0.0.0:*` and the `[::]:22` row, in the column order the
   script reads; `sshd -T` reports `port 22`, so `AppDeps`' fallback to 22 is
   correct on this guest and the vmrun-plus-terminal case does not degrade.
7. **The vmrun-with-no-client case stays unmeasured, deliberately.** By design it
   locks ssh out until a restore or a revert, so measuring it means taking the
   control channel down on purpose. That is a separate, supervised exercise, not
   something to slip into a sweep that other legs are queued behind.

## Wiring

`applyNetworkMode` in `src/server/app.ts`, called from **two** routes:
`POST /api/sessions` and `POST /api/sessions/:id/reset`, in both cases after
`applySetup` and before anything is returned. `deps.runtime` already satisfies
`GuestExec` (`Pick<LabTransport, 'exec'>`), so there is no plumbing.

Two orderings are load-bearing, for different reasons:

- **After `setup.sh`.** A `setup.sh` may install packages, and setup runs with the
  route still up so that it cannot be the thing offline mode breaks. §4.2's
  "packages still work offline" is now measured for the ISO-backed repo (item 4
  above, byte-identical readings online and offline), so this ordering is no longer
  covering an unverified claim — it covers the case the measurement does *not* reach:
  a `setup.sh` that pulls from anywhere other than the DVD. Keeping it means such a
  setup fails only when written, not intermittently by mode.
- **After the revert, every time** — which is what makes `/reset` a second call
  site rather than a nicety. `runtime.reset()` reverts to the *powered-on* `clean`
  snapshot: it restores the running kernel, so the default route is back and
  `/run/rhcsa-offline.state` is gone with the rest of tmpfs. Enforcing only at
  session creation means one press of Reset hands an exam-mode student the
  internet for the rest of the attempt while the rail still says they are offline.
  (The same property that makes `/run` the right place for the state file is what
  makes this necessary; it is one fact with two consequences, and the second one
  was missed on the first pass.)

Neither call refuses the session. Both report through `ok` rather than throwing,
and a guest that would not go offline is a degraded session, not a lost one —
refusing to open it would cost real practice to protect a nicety. What is *not*
allowed is silence: **a student told they are offline while they are not has been
lied to**, and would sit a whole rehearsal with the web open learning the habit
this feature exists to build against. So the response carries `offline` (for every
mode, not just the offline ones) and `offlineWarning` (only when the first is not
true), the `StartedSession`/`SessionView` types require the former, and `Rail`
shows the warning **instead of** the note when the two disagree — one corner of one
screen cannot hold both "no default route" and "you may still have one".

`/reset` returns its own `offline` and `offlineWarning` because the re-apply can
fail where the first one succeeded; `Lab.doReset` carries both onto the session and
clears a stale warning rather than leaving it standing over a guest that is now
fine.

Restoration lives at these two points rather than in `/finish` on purpose:
`/finish` is a synchronous handler, and creation-time restoration also covers the
student who closed the tab mid-exam and comes back to practice.
