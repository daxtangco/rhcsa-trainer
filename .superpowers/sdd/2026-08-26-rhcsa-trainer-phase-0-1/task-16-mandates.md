# Task 16 — mandated changes to the brief

Seven **required** changes. They override `task-16-brief.md` wherever they
conflict; everything else in the brief stands, including its ranked fallback list
and its commit message.

**Read the measurement warning first.** Every number and every observation below
came from a command I ran on this machine, and I have pasted the real output so
you can re-run it. Twice in this project I have handed an implementer a confident
measurement that turned out to be wrong, and both times the escape clause below
is the only reason it cost nothing. So: **confirm anything you depend on with
your own command. If your measurement disagrees with mine, yours wins — say so in
the report and act on yours.**

## Measured environment facts

Run in `/home/daxtangco/rhcsa-trainer` unless noted. All read-only.

**`vmrun.exe` exists** at `/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe`. The brief's path is correct. Note the space; always quote it.

**No VM is running right now.** `"$VMRUN" list` → `Total running VMs: 0`.

**Two VMs exist on this host**, found with `find /mnt/c/VMs /mnt/c/Users -maxdepth 6 -name '*.vmx'`:

```
/mnt/c/Users/DaxAxisTangco/Documents/Virtual Machines/Ubuntu 64-bit/Ubuntu 64-bit.vmx
/mnt/c/Users/DaxAxisTangco/Documents/Virtual Machines/Windows 11 x64/Windows 11 x64.vmx
```

The Ubuntu one is the brief's intended subject. Its Windows path — the form
`vmrun` needs — is `C:\Users\DaxAxisTangco\Documents\Virtual Machines\Ubuntu 64-bit\Ubuntu 64-bit.vmx`. **It contains two spaces**, so it must be quoted at every use. `"$VMRUN" listSnapshots` on it reports `Total snapshots: 0`, and there is no `.vmss` beside the `.vmx`, so it is powered off, not suspended.

**WSL2 cannot see any VMnet adapter.** `ip -4 addr show` returns only:

```
    inet 127.0.0.1/8 scope host lo
    inet 10.255.255.254/32 brd 10.255.255.254 scope global lo
    inet 172.22.101.110/20 brd 172.22.111.255 scope global eth0
```

and `ip route` is just a default via `172.22.96.1 dev eth0` plus that link route. This is expected and permanent: WSL2 is its own Hyper-V guest behind its own NAT, and VMnet8 is a Windows *host* adapter. Mandate 4 exists because the brief mislabels this output.

**VMnet8's addressing, discovered two independent ways.** `ipconfig.exe` (which works from WSL) reports `VMware Network Adapter VMnet8` at `192.168.70.1 / 255.255.255.0`, and `/mnt/c/ProgramData/VMware/vmnetnat.conf` is readable and contains `ip = 192.168.70.2/24`. So on this host: **subnet `192.168.70.0/24`, Windows host adapter `192.168.70.1`, VMware NAT gateway `192.168.70.2`**, and DHCP will hand the RHEL guest something in `192.168.70.128–254`. Do not hardcode `192.168.70` — discover it, because it changes if the user ever runs the Virtual Network Editor.

**The headline finding, and it largely answers R1 already:**

```
$ ip route get 192.168.70.128
192.168.70.128 via 172.22.96.1 dev eth0 src 172.22.101.110 uid 1000

$ ping -c 3 -W 2 192.168.70.1
3 packets transmitted, 3 received, 0% packet loss, time 2004ms
rtt min/avg/max/mdev = 0.975/1.163/1.283/0.134 ms
```

**WSL2 reaches the VMnet8 host adapter with zero loss at about 1 ms.** Traffic to
the VMnet8 subnet is routed via WSL's default gateway (the Windows host), and the
host answers on its VMnet8 address. That is the specific fear R1 names, and on
this host it does not reproduce. Pinging the NAT gateway `192.168.70.2` gets 100%
loss, which is normal — the vmnet NAT device does not answer ICMP from outside
the guest subnet and its silence is not evidence of anything.

## 1. Add a guest-independent host-routing pre-check, and run it before touching any VM

The brief's probe cannot say anything at all until a VM is running, has
`open-vm-tools`, and reports an IP. That is three guest dependencies stacked in
front of a question that is **about host networking** — the script's own header
comment says so. The measurements above show most of the answer is obtainable
with no VM at all.

Add a section that runs **before** the running-VM check and needs no guest:

1. Discover the VMnet8 subnet. Prefer parsing `ipconfig.exe` for the
   `VMware Network Adapter VMnet8` block's IPv4 address; fall back to
   `/mnt/c/ProgramData/VMware/vmnetnat.conf`'s `ip =` line. If neither yields an
   address, say so and continue — this section is diagnostic, not a gate.
2. Print `ip route get <that address>` so the reader sees which interface WSL
   would use.
3. `ping -c 3 -W 2` the host adapter address (`.1` of the discovered subnet) and
   report it as the **host-routing** result, clearly labelled as separate from
   any guest result.

State plainly in the output what a pass here means and what it does not: reaching
the host adapter proves WSL2 routes into the VMnet8 subnet at the IP layer, which
is R1's core question; it does not prove a *guest* inside that subnet accepts
inbound TCP, because guest-side `firewalld` is a separate matter. Do not let this
section set the script's exit code — the guest checks still decide that.

Both discovery paths are cheap and they cross-check each other. Use both rather
than picking one; if they disagree, print both and say so, because a disagreement
means the user has reconfigured VMnet8 and every hardcoded assumption downstream
is suspect.

## 2. Replace the binary TCP verdict with four distinguishable outcomes

This is the most important change, and the brief's design cannot express the
answer it most needs to give.

The brief does:

```bash
if timeout 5 bash -c "exec 3<>/dev/tcp/$ip/22" 2>/dev/null; then
  reachable=yes
else
  say "FAIL: cannot open TCP/22 on $ip"
  reachable=no
fi
```

One `else` covers four situations that mean completely different things, and it
discards the evidence that separates them by sending stderr to `/dev/null`. I
verified the outcomes are distinguishable:

```
$ timeout 4 bash -c 'exec 3<>/dev/tcp/192.168.70.199/22'
bash: connect: No route to host
bash: line 1: /dev/tcp/192.168.70.199/22: No route to host
exit=1
```

The four outcomes, and what each means for R1:

| observation | meaning | R1 verdict |
|---|---|---|
| connect succeeds | routed and `sshd` listening | **R1 resolved** |
| fast failure, stderr says `Connection refused` | routed, guest up, nothing listening on 22 | **R1 resolved** — the problem is a missing `sshd`, not the network |
| fast failure, stderr says `No route to host` / `Host is unreachable` | nothing answering at that address | **inconclusive** — usually the wrong IP or a guest that has not finished booting, not a firewall |
| `timeout` exits **124**, no stderr at all | packets silently dropped | **R1 confirmed** — this is the firewall signature |

So: capture stderr instead of discarding it, capture the exit code, and classify.
Treat `124` as the firewall signature and say so in the output. **`Connection
refused` must report R1 as resolved** — that distinction is the whole reason this
mandate exists, because it lets the probe answer R1 against a guest that has no
`sshd` at all, which is exactly the Ubuntu VM's likely state.

Keep the exit-code contract the brief's header documents (0 = SSH reachable and
`SshTransport` can default, 1 = not), but make the printed verdict carry the
four-way distinction. If TCP/22 is refused rather than dropped, exit non-zero —
`sshd` really is absent, so `SshTransport` cannot be the default *today* — but
say in the same breath that R1 itself is answered and that installing `sshd` is
all that stands in the way. Do not print the firewall fallback list in that case;
it would send the user chasing a problem they do not have.

## 3. Fix the SSH banner read — `head -c 100` blocks for the full timeout

```bash
banner=$(timeout 5 bash -c "exec 3<>/dev/tcp/$ip/22; head -c 100 <&3" 2>/dev/null | tr -d '\r')
```

An SSH banner is one short CRLF-terminated line, typically 20–40 bytes. `head -c
100` waits for 100 bytes that never come, so this always burns the full 5 seconds
and then dies to `timeout`'s SIGTERM, at which point whatever `head` had buffered
may or may not survive. A banner check that reports `<none>` for a perfectly
healthy `sshd` is worse than no banner check.

Read one line and return as soon as it arrives — `IFS= read -r -t 3 banner <&3`
inside the same `bash -c`, or any equivalent. Keep the `tr -d '\r'`. Keep the
`${banner:-<none>}` fallback, since a genuinely silent port is worth seeing.

## 4. The "VMnet8 host adapter as WSL sees it" label is false — fix it

```bash
say "VMnet8 host adapter as WSL sees it:"
ip -4 addr show | grep -E 'inet ' | sed 's/^/  /'
```

WSL never sees VMnet8. The measured output of that exact command is `lo` plus
`eth0` at `172.22.101.110/20` and nothing else. As written, the script prints
WSL's own private addresses under a heading claiming they are VMnet8's, which
will send a reader debugging the wrong network — a document that quietly asserts
something false is the failure mode this project keeps finding.

Relabel it as WSL's own addresses, and add one sentence saying VMnet8 is a
Windows host adapter that is *expected* to be invisible from inside WSL, so its
absence is not a fault. Then add `ip route get <guest-ip>` next to it, which is
the genuinely useful line: it shows the reader that traffic to the guest leaves
via WSL's default gateway rather than any local VMware interface.

## 5. The acceptance run: exactly what you may do to this machine

The brief's Step 4 says "Start the Ubuntu VM in VMware Workstation" — a GUI
action you cannot perform. Do it from WSL instead, and stay inside these limits.

**You may:**
- `"$VMRUN" start '<ubuntu vmx>' nogui` — the VM is powered off with no snapshots,
  so this is a plain cold boot.
- Wait for `getGuestIPAddress` (it takes a while; `-wait` handles that).
- Run the probe against it.
- `"$VMRUN" stop '<ubuntu vmx>' soft` when finished. **Do this even if the probe
  fails.** Leave the machine as you found it: powered off. Report in the report
  that you stopped it.

**You may not, under any circumstances:**
- Install, remove, or configure anything **inside** the Ubuntu guest. It is the
  user's own unrelated VM. If it lacks `open-vm-tools` or `sshd`, that is a
  finding to record, not a problem to fix. The brief suggests `sudo apt install`
  in the guest — **that suggestion is overridden; do not do it.**
- Take a snapshot of it, or delete one. It has none; leave it that way.
- Touch the Windows 11 VM at all.
- Change any Windows setting. The brief's fallback list tells the *user* to run
  elevated PowerShell (`Set-NetConnectionProfile`) and to edit the Virtual
  Network Editor. The script must keep **printing** that advice; you must not
  **apply** it. A host-wide firewall reclassification is a security-relevant
  change that belongs to the user, and `sudo` cannot authenticate here anyway.
- Run anything under `sudo` on this WSL host. There is no TTY; it cannot
  authenticate. Nothing in this task needs it.

If the guest boots to something that wants interaction, or if `getGuestIPAddress`
never returns an address, stop the VM, record what happened, and report — do not
escalate your way around it.

Given the mandate-2 classification, the acceptance run is informative whatever
the Ubuntu guest turns out to have installed. A refused TCP/22 answers R1 just as
well as an open one. Say which of the four outcomes you observed.

## 6. `docs/r1-findings.md` must have three possible verdicts, not two

The brief's Step 5 offers "`SshTransport` default, or which fallback was
adopted". Mandate 2 creates a third state that matters more than either:
**answered but not demonstrable end-to-end today**, which is what a refused
TCP/22 on a guest with no `sshd` gives you. Recording that as "a fallback was
adopted" would push Task 18 into making `VmrunTransport` the primary on evidence
that does not support it.

Use exactly these three, and state which one applies in the first line of the
file so nobody has to infer it:

- **RESOLVED** — a guest was reached on TCP/22, or was refused on TCP/22 while
  host routing passed. `SshTransport` is the intended default. If it was a
  refusal, say plainly that the RHEL VM will need `sshd` enabled and that this is
  the checklist's job, not a transport decision.
- **INCONCLUSIVE** — host routing passed but no guest could be reached at all
  (no IP reported, or host-unreachable). Say what was missing. `SshTransport`
  stays the intended default; the question is deferred to the real RHEL VM.
- **CONFIRMED AS A PROBLEM** — the `timeout`-124 silent-drop signature, or host
  routing to the VMnet8 adapter failed. Only this verdict justifies making
  `VmrunTransport` primary, and only this one should carry the fallback list.

Also record, because later tasks need them and they are cheap to capture now: the
discovered VMnet8 subnet, host adapter and NAT gateway addresses; the `ip route
get` output; and the exact `vmrun` commands you ran, including the quoted Windows
path with its spaces, so the run is reproducible after a Windows update changes
something.

Include the full probe output in a fenced block as the brief asks. Do not
paraphrase it.

## 7. Update every place the spec mentions R1, not just the risk table

The brief's Step 5 says to update "spec §17's R1 row". There are two places, and
I grepped for them in
`docs/superpowers/specs/2026-08-26-rhcsa-lab-trainer-design.md`:

- **line 1034**, the `R1` row of the `## 17. Risks` table. Rewrite it to state
  the finding and cite `docs/r1-findings.md`. Keep the row in the table rather
  than deleting it — a resolved risk with its evidence is more useful to a future
  reader than a gap.
- **line 222**, the VM settings table: `| Network | NAT (VMnet8) | See risk R1 |`.
  The reason cell should now point at the finding rather than at an open risk.

There is a third mention at **line 988**, a Phase 0 exit criterion reading
`Verify WSL2 → VMnet8 reachability (risk R1)`. **Leave it exactly as it is** —
it describes work to be done, and this task doing it is what satisfies it, not
what invalidates it.

Match the surrounding table style and keep the edits to those two cells. Do not
restructure the spec, do not renumber sections, and do not change any other
requirement in it — the spec is the authority this whole plan argues from, and
this task's licence to edit it extends only to recording an answer it was asked
to find.

## Also worth doing while you are here

- The brief reads `vmx=${1:-}` *after* running `vmrun list`, so an explicitly
  passed `.vmx` still triggers the listing. Harmless, but reading the argument
  first and skipping the auto-pick is one line clearer.
- The auto-pick takes `head -n1` of the running VMs. It already prints
  `subject: $vmx`, which is adequate disclosure — but if more than one VM is
  running, say so, since silently probing the wrong VM would produce a confident
  wrong answer.
- `bash -n` only checks syntax. If `shellcheck` happens to be on PATH, run it and
  paste the output; if it is not, say so and move on rather than installing
  anything.

## Out of scope

- Do not touch `src/`, `test/`, `content/`, or `package.json`. No unit tests: this
  is a diagnostic shell script whose subject is host networking, and a test with
  the network mocked out would assert only that the mocks were wired up.
- Do not create or modify `.env.local`. Task 19 owns it.
- Do not build, download, or provision anything for the RHEL VM. That ISO is a
  user-owned blocker and this task is deliberately independent of it.
- Never read or copy `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools`. They are an unrelated project's secrets.
