# Task 16 review — `456e468..20d8a9b`

Reviewer note on inputs: `task-16-report.md` does not exist as a standalone file
(confirmed with `find`/`ls` — only `task-16-brief.md` and `task-16-mandates.md`
are present in the sdd folder). The report content lives inline in
`progress.md` under "Task 16 — implemented `20d8a9b`, review dispatched"
(~line 2033 onward), which I used in its place. See F0.

All four TCP/22 branches, the banner timing, and the host-routing checks below
were exercised live from this WSL host, no VM involved, per the review brief.
Script under test: `scripts/r1-probe.sh` at `20d8a9b` (verified `git show
20d8a9b:scripts/r1-probe.sh` byte-for-byte matches the diff before testing).

## Verdict 1 — spec compliance (the seven mandates)

1. **Host-routing pre-check before any VM check, no guest needed, both
   discovery sources, doesn't set exit code — SATISFIED.**
   `scripts/r1-probe.sh:19-79` runs before `hdr "vmrun"` (line 81). Uses
   `ipconfig.exe` (line 29-33) and `/mnt/c/ProgramData/VMware/vmnetnat.conf`
   (line 35-39), cross-checks them (line 51-60), and prints a disagreement
   warning if the subnets differ. No `exit` statement anywhere in this block —
   confirmed by reading lines 19-79 in full. The exit code is set only later,
   by the `vmrun`-not-found check, the no-VM-running check, the no-IP check,
   and the TCP/22 `case` statement — all guest-dependent. Live-confirmed: on
   this host the section printed `ok: both sources agree on subnet
   192.168.70.0/24` and the host-routing ping passed with 0% loss, matching
   `docs/r1-findings.md`'s own numbers exactly.

2. **Four-way TCP/22 classification — SATISFIED, with one significant
   reliability caveat (F1).** All four branches were driven live:

   - **connect succeeds** (local listener on `127.0.0.1:18022`) → `tcp_rc=0`,
     printed `ok: TCP/18022 open`, verdict `R1 RESOLVED`, **exit 0**. Correct.
   - **`Connection refused`** (`127.0.0.1:18099`, closed port) → stderr
     `bash: connect: Connection refused`, printed the refused message, verdict
     `R1 RESOLVED (refused - missing sshd only)`, **exit 1**, and — confirmed —
     **no fallback list printed** in this branch. Matches mandate 2 exactly.
   - **`No route to host`** (`192.168.70.222`, `192.168.70.99`,
     `192.168.70.50`, `192.168.70.150` — each on first attempt) → stderr
     `bash: connect: No route to host`, `tcp_rc=1`, ~2.8-3.0s, correctly
     classified `unreachable`, verdict `R1 INCONCLUSIVE`, exit 1, **no
     fallback list**. Matches mandate 2.
   - **silent drop / `timeout` rc=124** — reliably reproduced by re-querying
     the *same* address a second time within ~20s of the first (see F1): `tcp_rc=124`,
     empty stderr, correctly classified `dropped`, verdict `R1 CONFIRMED AS A
     PROBLEM`, exit 1, **fallback list printed** (all five items, including the
     `Set-NetConnectionProfile` and `firewall-cmd` advice, present only as
     printed strings — grepped the whole script for `powershell`, `netsh`,
     `Set-NetConnectionProfile`; every hit is inside a `say "..."` line, none
     is executed).

   The classifier's code is correct for the four stderr/exit-code shapes it is
   given. **F1** is that the two "nothing is there" branches (`unreachable` vs.
   `dropped`) are not a stable function of the real underlying condition on
   this host — see below.

3. **Banner-read fix — SATISFIED.** Verified with a Python listener that
   accepts repeated connections and immediately writes one CRLF-terminated
   line (`SSH-2.0-OpenSSH_9.6\r\n`) then holds the socket open 10s. Full
   script run (TCP/22 open-check + fresh banner-read connection + verdict)
   completed in **0.266s wall clock**, banner correctly read as
   `SSH-2.0-OpenSSH_9.6`. This is nowhere near the 3-5s the brief's `head -c
   100` would have burned. `IFS= read -r -t 3 line <&3` inside the timeout
   wrapper does what it's supposed to (`scripts/r1-probe.sh:181-190`).
   (Note for anyone re-running this test: the banner check opens a *second*,
   independent `/dev/tcp` connection distinct from the one used for the
   open/closed check — a single-`accept()` test listener will make the second
   connection sit unaccepted and time out at exactly 3s. Not a script bug; a
   test-harness gotcha, recorded here so the next person doesn't lose 10
   minutes to it.)

4. **False "VMnet8 host adapter as WSL sees it" label — SATISFIED.**
   `scripts/r1-probe.sh:125-135`: header is now `"WSL's own network
   addresses"`, with the sentence "WSL2 is its own Hyper-V guest behind its
   own NAT; VMnet8 is a Windows host adapter and is expected to be invisible
   from inside WSL. Its absence below is not a fault" (line 126-128), and
   `ip route get $ip` was added right after (line 134-135) exactly as
   mandated.

5. **Acceptance-run limits (no install/snapshot/sudo/Windows-setting-change
   inside or around the guest) — SATISFIED, but see F2/S2.** Independently
   re-verified, read-only, without touching the VM:
   - `"$VMRUN" list` → `Total running VMs: 0` right now (matches "left
     powered off").
   - `"$VMRUN" listSnapshots` on the Ubuntu `.vmx` → `Total snapshots: 0`, no
     `.vmss` file in the VM directory (not suspended, no snapshot exists).
   - `vmware.log` in the VM's own directory (read-only `grep`, no VM
     interaction) contains **no** `soft`-related `InitiatePowerOff` or ACPI
     shutdown-request entry at all in this session's window, and exactly one
     power-off entry: `04:06:02.664 ... VMAutomation_InitiatePowerOff. Trying
     hard powerOff`, completing at `04:06:06.312` with `Transitioned
     vmx/execState/val to poweredOff`. This independently corroborates the
     report's narrative from a source the implementer didn't write: `stop
     soft` never even reached the VMX (consistent with "no VMware Tools to ACK
     it" — the client-side `vmrun` call had nothing to signal to and simply
     never returned), and `stop hard` is the only power-off event that
     happened. See S2 below for what this means.

6. **Three-verdict `r1-findings.md`, INCONCLUSIVE correctly bucketed —
   SATISFIED.** First paragraph after the title states `**Verdict:
   INCONCLUSIVE.**` (not literally the file's first line — the title `#
   R1 findings...` is — but it is the first substantive sentence, and mandate
   6's intent "so nobody has to infer it" is met; see F3, observation-level).
   Checked against mandate 6's own definition: INCONCLUSIVE = "host routing
   passed but no guest could be reached at all (no IP reported...)". That is
   exactly what happened — `open-vm-tools` absent, `getGuestIPAddress` never
   returned an IP, host-routing ping to `.1` passed 0% loss. The TCP/22 check
   was never reached, so mandate 2's finer four-way split played no role in
   *this run's* bucket assignment — INCONCLUSIVE is the textually correct
   bucket, not a hedge and not an overreach. The file also records subnet,
   host adapter, NAT gateway, `ip route get`, and the exact quoted `vmrun`
   commands as required.

7. **Spec updates — SATISFIED.** `docs/superpowers/specs/2026-08-26-rhcsa-lab-trainer-design.md`
   line ~222 (Network row) now reads "Host-routing confirmed reachable; see
   `docs/r1-findings.md`"; line ~1034 (R1 risk row) rewritten citing the same
   file. Line 988's Phase 0 exit criterion — confirmed still verbatim `Verify
   WSL2 → VMnet8 reachability (risk R1).` The diff touches only those two
   table cells in the spec (`git diff` shows exactly 2 insertions/2 deletions
   in that file) — no restructuring, no renumbering.

**Also-worth-doing items**: `vmx=${1:-}` reads the argument before `vmrun
list` (line 17, before line 81) — done. Multi-VM warning present (line 94-101,
`warn: N VMs are running; auto-picking the first one listed`) — done.
`shellcheck` is not on PATH in this environment; per instruction, not
installed, and `bash -n` passes clean.

**Beyond-mandate `timeout 60` around `getGuestIPAddress`**: correct and
correctly bounded. The un-timed `-wait` in the brief genuinely hangs against a
tools-less guest (this reproduced live per the report, and matches the general
behavior of `vmrun`'s Tools-dependent wait). 60s is a reasonable bound, and the
failure message self-describes the ambiguity ("or took over 60s to report"),
so a slow-but-real guest isn't silently misdiagnosed as tools-less without a
hint. No objection.

## Verdict 2 — task quality

The pre-check, refusal-handling, and banner fix are genuinely good diagnostic
engineering: they turn a script that could only ever say "yes" or "generic no"
into one that tells a frustrated user *which* no they're looking at, and two of
those distinctions (host-routing pass, and refused-not-firewalled) are
significant, correct, and exactly what a stuck user needs. The commit is not
"a classifier that collapses four meanings in more lines" — for three of the
four branches it doesn't.

**But F1 is real and it lands on the branch the whole mandate exists for.**
The distinction between `unreachable` (INCONCLUSIVE, "probably the wrong
IP, just re-run") and `dropped` (CONFIRMED AS A PROBLEM, "here's how to fix
your Windows Firewall") is not a stable read of firewall-vs-no-firewall on
this host — it flips for the *identical* unclaimed address depending on
how recently it was last probed, almost certainly because of ICMP
Destination-Unreachable rate-limiting somewhere in the Windows NAT/vswitch
path (first probe to a cold address gets a fast, explicit "No route to host";
probing the same address again within roughly 20s gets no ICMP back at all and
silently times out at the full 5s). I demonstrated this twice, independently,
on two different addresses (`.50` and `.222`), each flipping from fast-`unreachable`
to slow-`dropped` on a second attempt with nothing else changed. A user
running this script twice in a row against a guest that simply isn't up yet
could be told "just re-run it" the first time and "go into elevated
PowerShell and reclassify your network adapter" the second time, for the exact
same real condition. That is precisely the kind of confident-but-wrong verdict
this project has been finding elsewhere, just relocated into the branch that
was supposed to fix it. See F1 for the fix recommendation.

Apart from F1, every branch reaches an actionable verdict, the fallback list
is correctly gated to only the branch that needs it, and `docs/r1-findings.md`
is careful to claim only what its evidence supports — its own "why this
doesn't become CONFIRMED" / "why this doesn't become RESOLVED" sections show
the same discipline I'd want to see, including using an ICMP cross-check by
hand to rule out a stale-lease false-CONFIRMED in its one supplementary check.
That hand technique is exactly what F1 recommends folding into the script
itself.

## Findings

**F1 — must fix now.** `scripts/r1-probe.sh:145-179` (the `unreachable` vs.
`dropped` split). The same unclaimed address on this host classifies as fast
`No route to host` (~2.8-3.0s, INCONCLUSIVE) on one attempt and as a silent
5s timeout (CONFIRMED AS A PROBLEM, prints the Windows-Firewall fallback
advice) on a repeat attempt seconds later, with no change in the real network
state. Demonstrated:
```
$ for addr in 192.168.70.50 192.168.70.150 192.168.70.200 192.168.70.250 192.168.70.99; do ...; done
192.168.70.50   rc=1   dur=2.74s  "No route to host"
192.168.70.150  rc=1   dur=2.94s  "No route to host"
192.168.70.200  rc=1   dur=3.04s  "No route to host"
192.168.70.250  rc=1   dur=2.85s  "No route to host"
192.168.70.99   rc=1   dur=3.04s  "No route to host"

# ~1 minute later, retrying the same two addresses:
192.168.70.50   rc=124 dur=5.05s  (no stderr)
192.168.70.222  rc=1   dur=2.84s  "No route to host"   # first attempt
# ~20s later, same address again:
192.168.70.222  rc=124 dur=5.06s  (no stderr)
```
Recommended fix: don't let a single TCP attempt decide between these two
buckets. Either (a) retry the connect 2-3 times and only classify `dropped`
if *every* attempt times out with no stderr, or (b) do what
`docs/r1-findings.md`'s own supplementary check did by hand — cross-check with
`ping -c 3 -W 2 $ip`; if ICMP comes back with an explicit "Destination Host
Unreachable", downgrade `dropped` to `unreachable` regardless of what the TCP
attempt alone reported, since that's independent evidence nothing is
claiming the address. Either fix keeps the four labels; it just stops one
flaky signal from picking between two verdicts with very different
prescriptions (silent re-run vs. "reconfigure your Windows network adapter").

**F2 — observation, worth a mention to the user directly, not just this
file.** The Ubuntu VM's `vmware.log` (read separately from and independent of
the implementer's report) confirms `stop soft` never sent anything to the
VMX — the only power-off event logged is `VMAutomation_InitiatePowerOff.
Trying hard powerOff` at `2026-08-30T04:06:02.664Z`. This means the guest OS
never received an ACPI/graceful shutdown signal at all; it was a true
power-cut, not merely "VMware's automation used the hard code path for
convenience." Mandate 5 was followed correctly (soft was tried first, per the
letter of "You may... stop soft... Do this even if the probe fails," and only
fell back after it hung) and the *outcome* — powered off, no snapshots, no
guest-side changes — matches what mandate 5 required. But the *mechanism* was
an unclean power-off of a machine that belongs to the user and predates this
project. It is very likely harmless (ext4 journal replay handles this
routinely), but the user should know their Ubuntu VM's last shutdown was not a
clean one, in case they notice an fsck message or lose unsaved guest-side
state on next boot. This is not fixable in code — it's inherent to a
Tools-less guest — so it's a disclosure item, not a script defect.

**F3 — observation.** `docs/r1-findings.md`'s verdict statement is the first
sentence of the body, not literally line 1 of the file (line 1 is the `#`
title). Mandate 6's "first line of the file" is met in spirit but not letter.
No action needed; noting only because the mandate's own phrasing was specific.

**F4 — forward to a later task.** The `case` statement's default branch
(`scripts/r1-probe.sh:215` `*)`) catches both the `dropped` (124) outcome and
an `unknown` outcome (any `/dev/tcp` error whose text matches neither
`refused` nor `no route/unreachable`). Both get the same "CONFIRMED AS A
PROBLEM" verdict and the same fallback list. Given F1, this is a defensible
default (an unrecognized error text defaulting to the most cautious verdict,
rather than silently misreporting RESOLVED), but Task 18 or a later hardening
pass should know these two are conflated if it ever wants to distinguish them.

**S1 — confirm, recommend amending.** Verified: `20d8a9b`'s subject is
`test(vm): probe WSL2 to VMnet8 reachability, resolving risk R1` and its body
says the Ubuntu guest "answers it," but the delivered verdict is
**INCONCLUSIVE** and `docs/r1-findings.md` explicitly defers the guest-side
half of R1 to the RHEL VM. The message follows the brief verbatim, and the
brief assumed (reasonably, before running it) that this run would resolve R1;
it didn't, and nothing updated the message once the real outcome diverged.
Recommendation: since `phase-0-1` is unmerged and this is the branch's most
recent commit, amend the message rather than only adding a corrective note —
a corrective note in `docs/r1-findings.md` (which already exists, and is
accurate) doesn't fix the fact that `git log --oneline` on this branch will
forever show "resolving risk R1" / "answers it" for a commit that did neither
for the guest side. Suggested replacement subject/body:
```
test(vm): probe WSL2 to VMnet8 reachability — host routing confirmed, guest side deferred (R1)

Runs against any VM, so the existing Ubuntu guest could answer it without
waiting for the RHEL ISO — but this guest has no open-vm-tools, so only the
host-routing half of R1 was demonstrated (WSL2 reaches the VMnet8 host
adapter with 0% loss). Guest-side TCP/22 reachability is deferred to the RHEL
VM. SshTransport stays the intended default; see docs/r1-findings.md.
```
This is a recommendation, not something I've applied — I have not amended
anything, per the "do not edit/commit" instruction for this review.

**S2 — confirmed independently.** See mandate 5 discussion above and F2. The
hard power-off happened, is corroborated by `vmware.log` itself (not just the
report's prose), and no snapshot was taken or deleted (`Total snapshots: 0`,
no `.vmsd` content, no `.vmss` file). I did not and could not check "no file
written inside the guest" by inspecting the guest filesystem (that would
require booting it, which is out of bounds for this review) — the strongest
available evidence is host-side: the only `vmrun` subcommands used were
`start`, `getGuestIPAddress` (×2), `checkToolsState`, `stop soft`, `stop
hard` — none of which write into the guest (no `runProgramInGuest`,
`copyFileFromHostToGuest`, `CopyFileFromHostToGuest`, or similar appear
anywhere in the report or in `scripts/r1-probe.sh` itself, which never calls
any state-changing `vmrun` subcommand at all). Recommend surfacing F2/S2 to
the user directly, since it's the one action in this task that touched
something outside the project.

## Blocking

Nothing blocks merge outright, but F1 sits in the code path that decides
whether a future user gets told to go mess with Windows Firewall settings for
no reason — I'd want it addressed (or at minimum, the script's own printed
CONFIRMED-AS-A-PROBLEM text softened to mention "try re-running once before
touching Windows Firewall settings") before this diagnostic is handed to
someone mid-frustration, which is the exact audience Verdict 2 asked me to
judge it against.

---

## Fix round 1 re-review — `456e468..fc4a413` (`79b5d50`, `fc4a413`)

Scope per the fix-round mandate: F1, F3, S1, and anything newly broken. The
seven mandates are closed and not re-checked. All testing below is live,
host-side, no VM touched, no `sudo`.

### S1 — amend: SATISFIED

`git diff --stat 20d8a9b 79b5d50` is empty (identical tree, same 4 files, same
481 insertions) — only the message moved. New message matches the fix-round
mandate's text exactly:
```
test(vm): probe WSL2 to VMnet8 reachability — host routing confirmed, guest side deferred (R1)
```
Recommendation from my first review adopted as specified.

### F1 — the load-bearing claim, checked adversarially: CORRECT, and independently reproduced

I re-derived the mandate's central claim myself before accepting it: pinged a
never-before-touched address three times in a row.
```
$ ping -c 3 -W 2 192.168.70.44   # attempt 1
3 packets transmitted, 0 received, +1 errors, 100% packet loss
$ ping -c 3 -W 2 192.168.70.44   # attempt 2, seconds later
3 packets transmitted, 0 received, 100% packet loss        # marker gone
$ ping -c 3 -W 2 192.168.70.44   # attempt 3
3 packets transmitted, 0 received, 100% packet loss        # still gone
```
This confirms the rate-limiting mechanism directly: the ICMP-unreachable
marker appears only on the *first* probe to a cold address and is
consistently absent on every retry within the following several seconds. My
original recommendation (a) — "retry 2-3 times, only classify `dropped` if
every attempt times out" — would therefore see the spent budget on every
retry after the first and would misclassify *more* often, not less. The
mandate's reasoning is right; my original fix (a) was wrong, and I'm
retracting it. Fix (b) — capture the evidence the script's own first-and-only
ping already produces, before anything spends it — is the correct approach,
and it works *because* it reuses evidence generated inside the same
script run, not a separately-issued probe.

**Does the new `unreachable` route land in the right verdict arm, without the
fallback list?** Yes. Read `scripts/r1-probe.sh:190-200` and `244-250`:
both the "no route to host" text-match path and the new
`icmp_no_claim==yes` path assign the identical string `tcp_outcome=unreachable`,
and the `case` statement (line 229) switches on that string alone — it cannot
tell which path produced it. The `unreachable)` arm prints only "R1
INCONCLUSIVE..." and `exit 1`; the fallback list lives exclusively in the `*)`
arm. Confirmed by extracting the exact code into a harness and driving it:

- **Fresh unclaimed address** (`192.168.70.17`, never probed before in this
  session): ICMP → `+1 errors` / `Destination Host Unreachable`; TCP/22 → 124,
  no stderr; classifier → `unreachable`; verdict → **R1 INCONCLUSIVE**, exit 1,
  no fallback list.
- **Before/after contrast**, same address class: ran the pre-fix
  (ICMP-discarding) logic against a different fresh address
  (`192.168.70.28`) and got `dropped` → **R1 CONFIRMED AS A PROBLEM** on the
  identical kind of evidence (fresh, unclaimed, first probe). This directly
  confirms the mandate's central claim that the wrong verdict was the common
  case pre-fix, not an edge case — a genuinely fresh, unclaimed address
  reliably produced the wrong (alarming) verdict under the old code and the
  right (deferring) one under the new code.
- **`192.168.70.2`** (NAT gateway, claimed and silent by design): ICMP → plain
  100% loss, no error marker; TCP/22 → 124; classifier → `dropped`; verdict →
  **R1 CONFIRMED AS A PROBLEM**, fallback list printed (including the new
  line 0, "re-run once before changing anything"). Matches the mandate's
  explicit expectation that this evidence shape stays CONFIRMED even though
  the gateway isn't actually a firewall — correctly not special-cased.
- **Unchanged branches re-confirmed**: local listener → `open` → RESOLVED,
  exit 0. Closed local port → `Connection refused` → RESOLVED (refused-only),
  exit 1.

**Regex robustness** (`grep -qE '\+[1-9][0-9]* errors|Destination (Host|Net) Unreachable'`,
line 146): checked for the two failure modes asked about.
- *Locale false-negative*: `ping -V` on this host reports `NLS: no` (this
  `iputils` build has no locale/translation support at all), and
  `LC_ALL=C ping ...` produces byte-identical wording to the default
  `LANG=C.UTF-8` — there is no locale variance to misfire on, on this host.
- *False positive from unrelated text*: iputils' summary line format reports
  duplicate packets as `+N duplicates`, a distinct word from `errors` — no
  collision. The regex is applied only to `$ping_out` (captured via command
  substitution before any of the script's own `say` output exists), so there
  is no risk of the script's later text feeding back into its own match.
- *False negative on `+N` count*: confirmed the mandate's own note that the
  count is consistently `+1` (never `+3`) once the budget is spent by earlier
  packets in the same 3-packet burst — the regex's `[1-9][0-9]*` (any count
  ≥ 1) is the right test, not a fixed count.
- One edge case *not* covered, low-severity, not blocking: `icmp_no_claim` is
  computed unconditionally before the `ping_rc -eq 0` branch and is still
  read later regardless of `ping_rc`. If a ping run received at least one
  reply overall (`ping_rc=0`, address is up) but an *earlier* probe in the
  same 3-packet burst had logged a transient ICMP-unreachable (e.g. a guest
  finishing boot mid-ping), `icmp_no_claim` would still be `yes` even though
  the address answered. That stale `yes` is read again in the TCP section
  only if TCP separately times out at 124 despite the ping having succeeded —
  an unlikely combination, but if it happened the script would report
  `unreachable` (soft) instead of `dropped` for what could genuinely be a
  same-run firewall onset. Noting as an observation; not something I'd hold
  up this fix for.

**Noise on the success path** (asked about specifically): confirmed the raw
`ping_out` dump prints unconditionally, including on outright success. A
control ping to `127.0.0.1` produced 8 lines of per-packet/RTT detail before
the one-line `ok: ping $ip` that is all a happy-path reader needs:
```
  PING 127.0.0.1 (127.0.0.1) 56(84) bytes of data.
  64 bytes from 127.0.0.1: icmp_seq=1 ttl=64 time=0.171 ms
  64 bytes from 127.0.0.1: icmp_seq=2 ttl=64 time=0.119 ms
  64 bytes from 127.0.0.1: icmp_seq=3 ttl=64 time=0.096 ms

  --- 127.0.0.1 ping statistics ---
  3 packets transmitted, 3 received, 0% packet loss, time 2056ms
  rtt min/avg/max/mdev = 0.096/0.128/0.171/0.031 ms
ok: ping 127.0.0.1
```
This is a real, if minor, regression in signal-to-noise versus the old
one-liner — the extra detail is exactly the evidence the classifier needs on
the *failure* paths (where it's read to justify `icmp_no_claim`), but it buys
nothing on the success path, where nothing downstream reads `ping_out` again.
**F5 — observation, not blocking.** Suggested fix if it's ever touched again:
only `sed`-indent-and-print `ping_out` inside the `elif`/`else` branches
(failure paths), or gate the dump on `[[ $ping_rc -ne 0 ]]`.

**Prose truthfulness** (asked about specifically): the rewritten ICMP-section
"warn" text ("Not conclusive by itself... but combined with a silent TCP
timeout below, this combination is the firewall signature") is a
forward-looking conditional, not an assertion that the combination already
happened — it reads correctly whether TCP subsequently times out, is
refused, or succeeds. The `dropped` branch's own text ("something is there
and swallowing packets... firewall signature") is, by the mandate's own
admission, an overconfident characterization when the evidence shape is
`.2`'s known-benign silence — but the mandate explicitly chose not to
special-case that address and accepted the verdict text as correct-enough for
the general case. I agree with that call: tuning the prose to hedge around one
known address would reintroduce exactly the kind of narrow, environment-
specific patching this project keeps flagging elsewhere.

### F3 — SATISFIED

`docs/r1-findings.md` title is now `# R1 findings: can WSL2 reach a VMnet8
guest over TCP/22? — INCONCLUSIVE`. The `**Verdict: INCONCLUSIVE.**` paragraph
was left in place as instructed.

### Anything newly broken?

- `bash -n scripts/r1-probe.sh` clean.
- `git diff --stat 79b5d50 fc4a413` touches only `docs/r1-findings.md` (1 line)
  and `scripts/r1-probe.sh` (52 lines) — `README.md`, `src/`, `test/`,
  `content/`, `package.json` untouched this round (the one `README.md` line in
  the full range is from the original `20d8a9b`/`79b5d50`, not this fix).
- `npx vitest run` → 16 files / 161 tests passing, unchanged.
- Re-grepped the full script for `powershell`, `netsh`, `Set-NetConnectionProfile`,
  and any `vmrun` subcommand: every hit is either the pre-existing read-only
  `list`/`getGuestIPAddress` calls or text inside a `say "..."` line. Nothing
  new executes a state-changing command.
- `git status --porcelain` empty; `task-16-report.md` now exists as an actual
  file (F0 from my first review) with an honest "Fix round 1" section whose
  numbers match my independent re-derivation (different addresses, same
  shapes and same conclusions).
- F4 confirmed untouched (case default structure identical apart from the
  `rc=124` branch's internal `if`, which is in scope). F2/S2 confirmed
  untouched, as instructed — no VM was started or stopped this round.

### Verdicts

**Does the fix satisfy the mandate?** Yes. F1 is fixed correctly, not just
plausibly — I derived the underlying rate-limiting mechanism independently
before trusting the mandate's explanation, and it holds. The `unreachable`
route lands in the correct verdict arm without the fallback list. F3 is a
one-line, exact match to spec. S1's amend is byte-for-byte the mandated
message on an identical tree.

**Is it good work?** Yes, with one small, non-blocking gap (F5, success-path
noise) and one lower-severity edge case worth knowing about (the stale
`icmp_no_claim` read when `ping_rc=0` but an earlier probe in the same burst
saw an ICMP error). Neither changes a verdict in the cases I could construct;
neither blocks. The more important thing this round demonstrates: the
mandate didn't just patch the reviewer's symptom, it correctly identified
*and rejected* the reviewer's own proposed fix using a mechanism (ICMP
rate-limiting) that a live measurement — not just plausible-sounding
reasoning — supports. That is the right standard for a fix to this kind of
finding, and it was met.

Nothing blocks.

## Fix round 2 confirmation — `fc4a413..5c7f650`

Scope as delegated: confirm the restructure that closes F5 and the stale-flag
edge case didn't move anything that shouldn't have moved, and that
`icmp_no_claim=no` initialised outside the `if` is still read correctly by the
TCP section in the success case. The three shapes were already driven by the
team lead; I did not re-drive them.

`git diff --stat fc4a413 5c7f650` touches exactly one file, `scripts/r1-probe.sh`,
21 insertions / 14 deletions, entirely inside the `ICMP` block (the raw
`printf ... | sed` dump and the regex check moved from unconditional, ahead of
the `if [[ $ping_rc -eq 0 ]]`, into the `else` (failure) arm only). Confirmed
by reading the diff and the resulting file, `scripts/r1-probe.sh:137-166`:

- **Regex unchanged**: still `\+[1-9][0-9]* errors|Destination (Host|Net)
  Unreachable`, same two lines, just re-indented one level into the `else`.
- **TCP section unchanged**: `scripts/r1-probe.sh:167-` on is byte-identical
  to `fc4a413` — same `tcp_rc` branches, same `if [[ $icmp_no_claim == yes ]]`
  read inside the `rc=124` arm, same comment about not retrying.
- **`case` statement, verdict texts unchanged** — outside the diff's single
  hunk entirely, and `git diff --stat` confirms no other file moved
  (`docs/r1-findings.md` untouched, matching the mandate's "do not touch"
  line).
- **The success-path read is correct.** `icmp_no_claim=no` is set once, before
  the `if [[ $ping_rc -eq 0 ]]` branches, and the `yes` assignment now lives
  only inside the `else` (`ping_rc != 0`) arm. So when `ping_rc -eq 0`, the
  variable is never reassigned and reaches the TCP section's
  `[[ $icmp_no_claim == yes ]]` check still `no` — which is the correct
  reading: a ping that succeeded should never cause the TCP section to treat
  a subsequent silent timeout as `unreachable`; a real, independently-firewalled
  TCP/22 on an otherwise-pingable host correctly falls through to `dropped`.
  This is exactly the case the mandate's F5/stale-flag fix targeted, and it
  resolves the way the mandate specifies.
- The new comment on the success branch states the flag's underlying
  definition ("nothing claims this address" is false whenever anything
  answered) rather than restating the mechanism — accurate and consistent
  with the failure-arm comment kept verbatim above it.

`bash -n scripts/r1-probe.sh` clean. `git status --porcelain` shows only an
unrelated untracked `test/vm/` directory (not part of this diff, not touched
by me — looks like concurrent work from another task in this shared repo, not
this task's scope). `shellcheck` is not on PATH; not installed, per
instruction. I did not re-drive the three ICMP shapes — the team lead's
per-address, single-run measurements already demonstrate the three outcomes
correctly and re-testing was explicitly out of scope for this round.

**Confirmed.** The restructure moved only what the mandate specified, moved
it correctly, and the success-case read of `icmp_no_claim` is exactly right.
F5 and the stale-flag edge case are both closed. F4 remains open and
forwarded, not re-raised. Nothing blocks; Task 16 is closed from my side.
