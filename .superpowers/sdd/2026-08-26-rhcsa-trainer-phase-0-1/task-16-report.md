# Task 16 report

## Original run

Status: DONE_WITH_CONCERNS. Commit at the time: `20d8a9b` (later amended to
`79b5d50` in fix round 1 — same tree, message only; see below).

**R1 verdict: INCONCLUSIVE**, per `docs/r1-findings.md`'s three-way rule.
Host-routing into the VMnet8 subnet passed cleanly — WSL2 reached the host
adapter (`192.168.70.1`, discovered via `ipconfig.exe` and cross-checked
against `/mnt/c/ProgramData/VMware/vmnetnat.conf`) with 0% packet loss. But no
guest could be reached at all: the pre-existing Ubuntu VM used as the subject
(any VM answers this question; it's about host networking, not RHEL) has no
`open-vm-tools` installed, so `vmrun getGuestIPAddress` never produced an IP
to run the TCP/22 check against. `checkToolsState` reported `unknown` both
immediately after boot and several minutes later, ruling out "still booting."
`SshTransport` stays the intended default; the guest-side half of R1 is
deferred to the RHEL VM's first boot, which the build checklist requires to
have `open-vm-tools` and `sshd`.

All seven of `task-16-mandates.md`'s required changes were implemented:
guest-independent VMnet8 subnet discovery and host-routing pre-check before
touching any VM; the four-way TCP/22 classification (`open` / `refused` /
`unreachable` / `dropped`) with `Connection refused` correctly reporting R1 as
resolved; the SSH-banner read fixed to use `read -t` instead of a blocking
`head -c 100`; the false "VMnet8 host adapter as WSL sees it" label corrected
to "WSL's own network addresses"; the acceptance run done via `vmrun`
commands instead of a GUI action, staying inside all of mandate 5's limits
(no guest modification, no snapshot, Windows 11 VM untouched, no Windows
setting changed, no `sudo`); `docs/r1-findings.md` using the three-way
verdict; and both spec mentions (lines 222 and 1034) updated, line 988 left
untouched. My own measurements of the VMnet8 addressing matched the
mandate's pasted numbers exactly — no disagreement to act on.

Beyond the seven mandates: `getGuestIPAddress ... -wait` has no timeout and
hangs forever against a guest with no tools, which I hit live (a run had to
be killed after several minutes of silence). Wrapped it in `timeout 60` so
that failure mode is a clean, bounded FAIL instead of an indefinite hang.

The Ubuntu VM was cold-booted (`vmrun start ... nogui`), probed, and left
powered off. `vmrun stop ... soft` never returned — there's no VMware Tools
to acknowledge the ACPI signal — so after ~4 minutes I killed that call and
used `vmrun stop ... hard` instead, confirmed via `vmrun list` → `Total
running VMs: 0`. Flagged to the user as F2/S2 in review; no code change
needed for it.

Review (`task-16-review.md`, diff `456e468..20d8a9b`) found the delivery
solid but raised one must-fix (F1) plus three smaller items (F2/S2 observed
above, F3, F4). Fix round 1 below addresses F1 and F3; F4 is explicitly
forwarded to a later hardening pass per the fix-round mandate.

## Fix round 1

Status: DONE.

Commits:
- `79b5d50` — amended `20d8a9b`'s message only (tree unchanged: same 4 files,
  same 481 insertions). Confirmed via `git show --stat HEAD` before and after.
  Done first, before any new commit, per the fix mandate's ordering
  requirement (no interactive rebase available in this environment).
- `fc4a413` — `fix(vm): let ICMP evidence outrank a silent TCP timeout in the
  R1 probe`.

### F1 (must fix) — `unreachable`/`dropped` split now uses ICMP evidence, not just TCP's own result

The reviewer's finding, reproduced with my own measurements before touching
anything: the same unclaimed VMnet8 address classified as `unreachable`
(→ INCONCLUSIVE) on one attempt and `dropped` (→ CONFIRMED AS A PROBLEM,
prints the elevated-PowerShell Windows Firewall advice) seconds later, with
nothing about the network having changed:

```
$ ping -c 3 -W 2 192.168.70.201
... +1 errors, 100% packet loss ...   (Destination Host Unreachable)
$ ping -c 3 -W 2 192.168.70.212
... +1 errors, 100% packet loss ...   (Destination Host Unreachable)
$ ping -c 3 -W 2 192.168.70.2          # NAT gateway — claimed, silent by design
... 100% packet loss ...              (no "+N errors", no Unreachable line)
```

This matches the mandate's pasted numbers exactly. Cause, per the mandate:
Windows NAT/vswitch rate-limits ICMP Destination-Unreachable replies, and the
script's own ICMP check (which runs before the TCP check) spends that
address's error budget on the first probe. So a genuinely unclaimed
address — "the guest isn't up yet," the ordinary case — nearly always lands
on `dropped` if the TCP result alone decides, because by the time `/dev/tcp`
runs, the budget is gone and the timeout is silent either way.

**Did not implement the reviewer's recommended fix (a) — retrying the
connect.** The mandate is explicit that this is backwards: the *first*
attempt is the informative one, and every retry only ever sees the already-
spent budget, so retrying biases the classifier *toward* `dropped`, the wrong
direction. Implemented the mandate's fix (b) instead: capture ping's output
(not just its exit status), detect the marker (`+[1-9][0-9]* errors` in the
statistics line, or a `Destination Host Unreachable`/`Destination Net
Unreachable` line), and let that evidence — captured before the budget was
spent — outrank a silent TCP timeout. `scripts/r1-probe.sh`:

- ICMP section (`hdr "ICMP"` block): now captures `ping_out`/`ping_rc`,
  prints the output (previously discarded to `/dev/null`), and sets
  `icmp_no_claim=yes` when the marker is present. The two explanatory lines
  ("Not conclusive — the port check below decides") are rewritten to say the
  port check no longer solely decides.
- TCP/22 section, `tcp_rc -eq 124` branch: now checks `icmp_no_claim` before
  choosing between `tcp_outcome=unreachable` (ICMP evidence present) and
  `tcp_outcome=dropped` (plain loss, no ICMP evidence — "something is there
  and swallowing packets"). A comment documents the rate-limiting cause and
  explicitly tells the next reader not to add retries, naming the reason, as
  the mandate requires.
- CONFIRMED AS A PROBLEM verdict text: added a `0.` line ahead of the
  Windows Firewall advice telling the reader to re-run the probe once before
  changing anything.
- Did not touch the `case` statement's structure or its default branch
  (F4, forwarded) — only the `tcp_outcome` value assigned in the `rc=124`
  branch changed.

**Live verification** (all host-side, no VM; addresses not probed in the
preceding few minutes), using the actual code in the file (extracted via
`sed` and run under a small `say`/`hdr` harness, not a reimplementation):

Fresh unclaimed address, post-fix (`192.168.70.221`, then `.231`):
```
== ICMP ==
  PING 192.168.70.231 ... From 192.168.70.1 icmp_seq=3 Destination Host Unreachable
  --- 192.168.70.231 ping statistics ---
  3 packets transmitted, 0 received, +1 errors, 100% packet loss, time 2081ms
ping got an ICMP error above ... nothing at 192.168.70.231 is claiming that address at all. ...

== TCP/22 ==
TCP/22 on 192.168.70.231 timed out silently, but ping's ICMP error (above) shows
nothing claims 192.168.70.231 at all. That outranks the silent timeout: this is
an unclaimed address, not evidence of a firewall.

== verdict ==
R1 INCONCLUSIVE: nothing answered at 192.168.70.231, even though host-routing to
the VMnet8 subnet may be fine (see above). Usually the wrong IP or a
guest still finishing boot. Re-run once the guest is confirmed up, or
pass its .vmx explicitly.
```

Same address's `tcp_rc` was 124 in both the pre-fix and post-fix runs — the
before/after contrast is entirely in the classification, not the raw TCP
result. Pre-fix logic (extracted from the committed `79b5d50` tree, same
address) reaches `tcp_outcome=dropped` because it never looks at ping's
output:
```
== ICMP ==
warn: ping failed. Not conclusive - Windows Firewall commonly drops
      ICMP while still forwarding TCP. The port check below decides.

== TCP/22 ==
FAIL: the connection attempt to 192.168.70.231:22 timed out with no error at all -
      packets are being silently dropped. This is the firewall signature.
```

Silent-but-claimed address (`192.168.70.2`, the NAT gateway — the one
address in this environment known to be claimed and silent by design), post-
fix:
```
== ICMP ==
  PING 192.168.70.2 ...
  --- 192.168.70.2 ping statistics ---
  3 packets transmitted, 0 received, 100% packet loss, time 2035ms
warn: ping showed plain packet loss with no ICMP error. Not conclusive
      by itself ... but combined with a silent TCP timeout below,
      this combination is the firewall signature.

== TCP/22 ==
FAIL: the connection attempt to 192.168.70.2:22 timed out with no error at all,
      and ping showed plain loss with no ICMP error either - something
      is there and swallowing packets. This is the firewall signature.

== verdict ==
R1 CONFIRMED AS A PROBLEM. Try these, in order of preference:

0. Re-run this probe once more before changing anything. Confirming the
   same result twice costs nothing and rules out a one-off blip before
   you touch Windows Firewall.
1. Windows Firewall. ...
```
This is the correct verdict for that evidence shape even though the gateway
is known not to be a firewall — per the mandate, the classifier was not
special-cased for `.2`.

Unchanged branches re-confirmed live (local high-port listener for `open`;
closed local high port for `refused`, same `/dev/tcp` mechanics as the
script uses against port 22):
```
--- open ---   ok: TCP/58022 open on 127.0.0.1 → tcp_outcome=open
--- refused --- bash: connect: Connection refused → tcp_outcome=refused
```

### F3 (cheap) — verdict folded into `docs/r1-findings.md`'s title

Title is now:
```
# R1 findings: can WSL2 reach a VMnet8 guest over TCP/22? — INCONCLUSIVE
```
The `**Verdict: INCONCLUSIVE.**` paragraph immediately below was left as-is.

### Not touched this round, as instructed

F4 (the `case` default conflating `dropped`/`unknown`) — forwarded, no
change. F2/S2 (the hard power-off) — already surfaced to the user, needs no
code change. No VM was started, stopped, or otherwise touched this round;
all verification was host-side (`ping`/`/dev/tcp` against unused VMnet8
addresses, plus a throwaway local listener). `src/`, `test/`, `content/`,
`package.json`, and `README.md` untouched. No Windows Firewall setting
applied, no Virtual Network Editor opened, no `sudo`.

### Verification

- `bash -n scripts/r1-probe.sh` → clean, both before and after each edit.
- Both branches F1 changes driven live against real addresses (above),
  including the before/after contrast.
- Both unchanged branches (`open`, `refused`) re-confirmed live (above).
- `git status --porcelain` → empty after both commits.
- `npx vitest run` → `Test Files 16 passed (16)`, `Tests 161 passed (161)` —
  unchanged from before this round, as expected (no test changes).

## Fix round 2

Status: DONE.

Commit: `5c7f650` — `fix(vm): only derive and print ICMP evidence when the
ping actually failed`.

The re-review of fix round 1 closed F1, F3, and S1 outright — it independently
re-derived the ICMP rate-limiting mechanism on a fresh address before
accepting the fix, then explicitly retracted its own earlier suggestion of
the retry approach (option a). Round 1 stands unchanged; this round only
touches the `ICMP` section.

Two non-blocking observations from the re-review, sharing one fix:

- **F5** — the raw `ping_out` dump printed unconditionally, so a healthy ping
  showed eight lines of per-packet detail ahead of the one-line `ok: ping
  $ip` a happy-path reader needs. That detail is only evidence on the
  failure paths `icmp_no_claim` is derived from, so it belongs there only.
- **Stale-flag edge case** — `icmp_no_claim` was computed even when
  `ping_rc -eq 0`. If a burst got a reply on packet 3 but logged a transient
  ICMP-unreachable on packet 1 (e.g. a guest finishing its boot mid-ping),
  the flag stayed `yes` even though the address is, by definition, claimed.
  The TCP section reads that flag again, so a same-run firewall onset that
  happened to coincide with a late ping reply could have been misreported as
  `unreachable` instead of `dropped`.

Fixed both by gating on the same condition, `ping_rc -ne 0`, restructured
into the existing `if`/`else` arms rather than added as separate guards:
`icmp_no_claim` is now computed only inside the `else` (ping failed) arm and
stays `no` otherwise; the raw dump is printed only in that same arm. The
existing comment explaining why the output is captured was kept, with an
added clause on the `if [[ $ping_rc -eq 0 ]])` arm explaining why a
successful ping forces the flag to `no` regardless of an earlier transient
error in the same burst. Nothing else changed — not the regex, not the TCP
section, not the `case` statement, not any verdict text, not
`docs/r1-findings.md`. Confirmed via `git diff`: only the `ICMP` block's
21 insertions / 14 deletions.

### Live verification — all three ICMP shapes

Extracted the actual `ICMP` and `TCP/22` sections from the file (`sed -n
'137,286p' scripts/r1-probe.sh`) into the same `say`/`hdr` harness used in
round 1, `ip` set per run, no VM involved.

**Success** (`127.0.0.1`) — one `ok: ping` line, no raw dump, as required:
```
== ICMP ==
ok: ping 127.0.0.1

== TCP/22 ==
  bash: connect: Connection refused
  bash: line 1: /dev/tcp/127.0.0.1/22: Connection refused
TCP/22 on 127.0.0.1 was refused: routed, guest is up, but nothing is listening
on port 22. That is a missing sshd, not a network problem.
```
(Nothing listens on 22 locally in this environment, so this run takes the
`refused` branch rather than `open` — irrelevant to what's being verified
here, which is the ICMP section showing no dump on the success path.)

**Fresh unclaimed VMnet8 address**, not probed in the preceding few minutes.
First attempt used `192.168.70.243`, immediately after `.231`/`.221` from
round 1 — the shared ICMP rate-limit budget was still down from that earlier
testing and it came back as plain loss with no marker, which is exactly the
confound the mandate warns about, not a fix regression. Confirmed the budget
is shared across destination addresses (not per-address) by round-tripping
several more fresh addresses in a plain `ping`, then running the harness
single-shot (no separate probing step first, since even a bare `ping` spends
the same budget) against `192.168.70.140`, untouched all session:
```
== ICMP ==
  PING 192.168.70.140 (192.168.70.140) 56(84) bytes of data.
  From 192.168.70.1 icmp_seq=3 Destination Host Unreachable

  --- 192.168.70.140 ping statistics ---
  3 packets transmitted, 0 received, +1 errors, 100% packet loss, time 2067ms
ping got an ICMP error above (a '+N errors' count or a Destination
Unreachable line) - nothing at 192.168.70.140 is claiming that address at all.
...

== TCP/22 ==
TCP/22 on 192.168.70.140 timed out silently, but ping's ICMP error (above) shows
nothing claims 192.168.70.140 at all. That outranks the silent timeout: this is
an unclaimed address, not evidence of a firewall.

== verdict ==
R1 INCONCLUSIVE: nothing answered at 192.168.70.140, ...
```
Raw dump present, `+1 errors` visible, outcome `unreachable` — matches the
required shape.

**`192.168.70.2`** (NAT gateway, claimed and silent), re-run fresh for this
round:
```
== ICMP ==
  PING 192.168.70.2 (192.168.70.2) 56(84) bytes of data.

  --- 192.168.70.2 ping statistics ---
  3 packets transmitted, 0 received, 100% packet loss, time 2050ms
warn: ping showed plain packet loss with no ICMP error. ...

== TCP/22 ==
FAIL: the connection attempt to 192.168.70.2:22 timed out with no error at all,
      and ping showed plain loss with no ICMP error either - something
      is there and swallowing packets. This is the firewall signature.

== verdict ==
R1 CONFIRMED AS A PROBLEM. Try these, in order of preference:

0. Re-run this probe once more before changing anything. ...
```
Raw dump present, no `+N errors`, outcome `dropped` — matches the required
shape.

### Verification

- `bash -n scripts/r1-probe.sh` → clean.
- All three ICMP shapes driven live above.
- `npx vitest run` → `Test Files 16 passed (16)`, `Tests 161 passed (161)` —
  unchanged.
- `git status --porcelain` → empty after committing.

No VM touched. `docs/r1-findings.md` untouched, as instructed. Nothing
blocks.

Nothing blocks.
