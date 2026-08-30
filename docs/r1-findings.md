# R1 findings: can WSL2 reach a VMnet8 guest over TCP/22? — INCONCLUSIVE

**Verdict: INCONCLUSIVE.** Host-routing into the VMnet8 subnet passed cleanly
(0% packet loss to the host adapter), but no guest could be reached at all —
the Ubuntu VM used as the subject has no `open-vm-tools` installed, so
`vmrun getGuestIPAddress` never got an IP to test. `SshTransport` stays the
intended default; the question of whether a *guest* on VMnet8 accepts inbound
TCP/22 is deferred to the real RHEL VM, which will have `open-vm-tools`
installed per the build checklist.

- **Date:** 2026-08-30
- **Subject VM:** `Ubuntu 64-bit` (the pre-existing Ubuntu VM, not RHEL — this
  question is about host networking, so any running VM answers it)
- **Windows path:** `C:\Users\DaxAxisTangco\Documents\Virtual Machines\Ubuntu 64-bit\Ubuntu 64-bit.vmx`
  (contains two spaces; quoted at every use below)

## Discovered VMnet8 addressing

Cross-checked two independent host-only sources, as `scripts/r1-probe.sh`
does:

| item | value | source |
|---|---|---|
| Subnet | `192.168.70.0/24` | agreed by both sources |
| Host adapter | `192.168.70.1` | `ipconfig.exe`, `VMware Network Adapter VMnet8` block |
| NAT gateway | `192.168.70.2` | `/mnt/c/ProgramData/VMware/vmnetnat.conf`, `ip =` line |
| DHCP range | `192.168.70.128–254` | implied by the gateway's `/24` and the one lease found |

`ip route get 192.168.70.1`:
```
192.168.70.1 via 172.22.96.1 dev eth0 src 172.22.101.110 uid 1000
    cache
```
Traffic to the VMnet8 subnet leaves WSL via its own default gateway
(`172.22.96.1 dev eth0`), not any local VMware interface — WSL2 is its own
Hyper-V guest behind its own NAT, and never sees VMnet8 directly. That is
expected, not a fault.

## Host-routing result (no guest involved)

```
$ ping -c 3 -W 2 192.168.70.1
3 packets transmitted, 3 received, 0% packet loss
```
WSL2 reaches the VMnet8 host adapter with zero loss. This is R1's core
question at the IP-routing layer, and on this host it does not reproduce as a
problem. It does **not** by itself prove a guest inside the subnet will
accept inbound TCP — that requires an actual guest, which is where this run
stalled.

## `vmrun` commands run, in order

```
VMRUN='/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe'
VMX='C:\Users\DaxAxisTangco\Documents\Virtual Machines\Ubuntu 64-bit\Ubuntu 64-bit.vmx'

"$VMRUN" start "$VMX" nogui
"$VMRUN" getGuestIPAddress "$VMX"          # (no -wait, to check state without blocking)
"$VMRUN" checkToolsState "$VMX"
bash scripts/r1-probe.sh
"$VMRUN" stop "$VMX" soft                  # never returned — no VMware Tools to ACK it
"$VMRUN" stop "$VMX" hard                  # fallback; succeeded
```

The VM was a cold boot: it had no snapshots (`listSnapshots` → `Total
snapshots: 0`, no `.vmss` beside the `.vmx`) and was powered off before this
run. **It was left powered off again at the end of this run** (confirmed via
`"$VMRUN" list` → `Total running VMs: 0`). Nothing was installed, configured,
or changed inside the guest, and no snapshot was taken.

## Step 3 — clean failure with no VM running

```
$ bash scripts/r1-probe.sh; echo "exit=$?"

== VMnet8 subnet discovery (host-only — no VM required) ==
This answers R1's core question — does WSL2 route into the VMnet8 subnet
at all — without depending on any guest being up. Diagnostic only: it
does not set this script's exit code.
host adapter (from ipconfig.exe (VMware Network Adapter VMnet8)): 192.168.70.1
NAT gateway (from /mnt/c/ProgramData/VMware/vmnetnat.conf): 192.168.70.2
ok: both sources agree on subnet 192.168.70.0/24

ip route get 192.168.70.1:
  192.168.70.1 via 172.22.96.1 dev eth0 src 172.22.101.110 uid 1000
      cache


== host-routing (no guest involved) ==
ok: WSL2 reached the VMnet8 host adapter (192.168.70.1) with 0% loss.
This proves WSL2 routes into the VMnet8 subnet at the IP layer — R1's
core question. It does NOT prove a guest inside that subnet accepts
inbound TCP; guest-side firewalld is a separate matter, checked below
once a VM is up.

== vmrun ==
ok: /mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe

== running VMs ==
Total running VMs: 0
FAIL: no VM is running. Start one in VMware Workstation and re-run.
usage: scripts/r1-probe.sh ['C:\path\to\vm.vmx']
exit=1
```

## Step 4 — acceptance run against the booted Ubuntu VM

Full output, unedited:

```
== VMnet8 subnet discovery (host-only — no VM required) ==
This answers R1's core question — does WSL2 route into the VMnet8 subnet
at all — without depending on any guest being up. Diagnostic only: it
does not set this script's exit code.
host adapter (from ipconfig.exe (VMware Network Adapter VMnet8)): 192.168.70.1
NAT gateway (from /mnt/c/ProgramData/VMware/vmnetnat.conf): 192.168.70.2
ok: both sources agree on subnet 192.168.70.0/24

ip route get 192.168.70.1:
  192.168.70.1 via 172.22.96.1 dev eth0 src 172.22.101.110 uid 1000
      cache


== host-routing (no guest involved) ==
ok: WSL2 reached the VMnet8 host adapter (192.168.70.1) with 0% loss.
This proves WSL2 routes into the VMnet8 subnet at the IP layer — R1's
core question. It does NOT prove a guest inside that subnet accepts
inbound TCP; guest-side firewalld is a separate matter, checked below
once a VM is up.

== vmrun ==
ok: /mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe

== running VMs ==
Total running VMs: 1
C:\Users\DaxAxisTangco\Documents\Virtual Machines\Ubuntu 64-bit\Ubuntu 64-bit.vmx
subject: C:\Users\DaxAxisTangco\Documents\Virtual Machines\Ubuntu 64-bit\Ubuntu 64-bit.vmx

== guest IP via open-vm-tools ==
reported:
FAIL: no usable IP. open-vm-tools/vmtoolsd is probably not running in
      the guest (or took over 60s to report). Install it, then re-run.
      Without it, only the vmrun transport is available - which is
      supported, just slower.
exit=1
```

The script never reached the TCP/22 check — it correctly stopped at the
first thing that was actually missing (`open-vm-tools` in this particular
guest, which the checklist calls mandatory but this pre-existing Ubuntu VM
predates that checklist).

Independently confirmed with `vmrun` directly (not through the probe):
```
$ "$VMRUN" getGuestIPAddress "$VMX"
Error: The VMware Tools are not running in the virtual machine: ...Ubuntu 64-bit.vmx

$ "$VMRUN" checkToolsState "$VMX"
unknown
```
run once immediately after boot and again several minutes later with the
same result, ruling out "still booting" as the explanation.

Note on the script itself: the brief's original `getGuestIPAddress ... -wait`
call has no timeout and blocks until VMware Tools reports an IP — which,
against a guest with no tools installed, is forever. That first surfaced
during this very run: the initial invocation had to be killed after several
minutes of silence. `scripts/r1-probe.sh` now wraps that call in `timeout 60`
so an absent guest agent is a clean, bounded FAIL instead of a hang; this is
beyond the seven mandated changes but was added because it reproduced live,
not hypothetically.

### Supplementary manual check (informational only, not part of the official run)

`/mnt/c/ProgramData/VMware/vmnetdhcp.leases` (host-side, read-only, not a
guest change) had one stale lease, dated 2026-07-17:
```
lease 192.168.70.128 {
    hardware ethernet 00:0c:29:08:6c:dd;
    client-hostname "daxtangco-ubuntu";
}
```
Trying that address directly while the VM was up:
```
$ ping -c 3 -W 2 192.168.70.128
From 192.168.70.1 icmp_seq=3 Destination Host Unreachable
100% packet loss

$ timeout 5 bash -c 'exec 3<>/dev/tcp/192.168.70.128/22'
(timed out, rc=124, no stderr)
```
This is not evidence of a firewall — the host adapter itself answering
"Destination Host Unreachable" for a ping means nothing is currently claiming
that address, i.e. the lease is stale and the VM most likely came up on a
different address this boot (unsurprising for a lease from six weeks ago).
It does not change the verdict: still no guest reachable at a known-good
address, which is exactly the INCONCLUSIVE bucket, not CONFIRMED AS A
PROBLEM.

### Which of the four TCP/22 outcomes was observed?

None, through the official script — it correctly stopped one step earlier,
at "no IP reported," because this guest has no `open-vm-tools`. The
supplementary manual attempt against a guessed (stale) IP produced a
timeout-with-no-stderr, which superficially resembles the "dropped" firewall
signature, but the ping evidence right above it points at "wrong/stale
address" instead, which is the same INCONCLUSIVE reading, not a fourth
data point worth promoting to CONFIRMED.

## Why this doesn't become CONFIRMED AS A PROBLEM

Per the three-way rule: CONFIRMED AS A PROBLEM requires either the
timeout-124 silent-drop signature *against a guest confirmed to be at that
address*, or host routing to the VMnet8 adapter itself failing. Neither
happened — host routing passed cleanly, and the only timeout-124 observed
was against an address with independent evidence (the ICMP host-unreachable)
that it isn't the guest's real current address. Downgrading that to CONFIRMED
would blame a firewall for what is actually a stale DHCP lease.

## Why this doesn't become RESOLVED either

RESOLVED requires either a successful TCP/22 connect or an explicit
`Connection refused` against a guest reached at a real address. This run
never got a real, confirmed guest address to test against, because
`open-vm-tools` is absent. The finding that matters for Task 18 is that the
part of R1 actually about *host* networking (WSL2 → VMnet8 routing) already
passed, and is unlikely to be the blocker; what remains open is a guest-side
prerequisite (`open-vm-tools`, and — per the build checklist — `sshd`) that
only the real RHEL VM can settle, because this Ubuntu VM cannot be modified
to test it.

## What this means for Task 18

`chooseTransport` should still be written to prefer `SshTransport` with a
`VmrunTransport` fallback, per the design's existing plan — the host-routing
evidence supports that default. This finding does not demonstrate an
end-to-end SSH connection working, so treat the RHEL VM's first boot (with
`open-vm-tools` and `openssh-server` per the build checklist) as the point
where R1 gets its final confirmation, not this task.

## Reading `scripts/r1-probe.sh`'s verdict

Added in Task 25, from a re-measurement of the script rather than from the run
above. One sharp edge to know about before you trust a verdict:

The summary's catch-all `*)` arm at `scripts/r1-probe.sh:258` prints
**"R1 CONFIRMED AS A PROBLEM"**, and it catches the `unknown` outcome as well as
`dropped`. So a probe that failed for a reason the script could not classify
reads as a confirmed firewall problem. Check the `rc=` the script prints before
acting on that headline.

What is *not* wrong, contrary to an earlier note that named this file: a
timed-out TCP probe is not swept into `unknown`. `tcp_rc -eq 124` is handled
explicitly at `:187` and resolves to `unreachable` when ICMP showed nothing
claiming the address, or `dropped` otherwise. `tcp_outcome=unknown` is set only
by the final `else` at `:221`, reached when the status is neither 0 nor 124 and
the stderr matches none of the known messages. The classification is sound; only
the headline over-claims.

## Validate failures and what they mean

Moved here in Task 25 from `task-21-report.md`, which is a workspace artifact
nobody diagnosing a real failure will open.

| Symptom | Cause | What to check |
|---|---|---|
| `needs at least 2 solutions` when `solutions/` looks present | the directory name is misspelled; `readdir` failures are swallowed | check the spelling of `solutions/` and `antisolutions/` |

### The id-extraction grep matches comment prose

Task 21's Step 11 extracted the checkpoint ids a grader emits with:

```
grep -oE 'ck_(pass|fail|skip) [a-z0-9-]+'
```

This matches a comment as readily as a call, and Task 21's implementer had to
reword two `grade.sh` comments to get around a collision. It is harmless for the
direction that check actually uses — a `comm -13` for declared-but-never-emitted
ids, where spurious extra tokens only inflate the emitted set and cannot produce
a false finding. The README's "Adding content" section now states the rule this
imposes on authors: no `ck_pass <word>` in a grader comment.

**Before anything derives a _total_ from this grep, teach it to skip comment
lines.** For a set difference a too-large emitted set is safe; for a count it is
a wrong number, and a wrong number is worse than no number — a checkpoint total
inflated by a comment is exactly the shape of failure the `incomplete` guard
exists to catch and would itself be fooled by. `npm run lint:content` is the
maintained version of this extraction: it reuses the runtime's own scanner
(`checkpointIds` in `src/server/session.ts`) instead of a regex, so it already
distinguishes a call from a comment, a heredoc body and a quoted string. Prefer
it over the grep above for anything new.
