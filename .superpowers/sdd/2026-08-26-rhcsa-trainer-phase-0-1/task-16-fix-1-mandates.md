# Task 16 — fix round 1

Three items, in this order. **Order matters for item 1** — it must happen while
`20d8a9b` is still `HEAD`, before any new commit lands, because interactive
rebase is not available in this environment.

Read the measurement warning from `task-16-mandates.md` again: every number
below came from a command I ran on this machine and pasted verbatim. **Confirm
anything you depend on with your own command. If your measurement disagrees
with mine, yours wins — say so in the report and act on yours.**

## 1. Amend `20d8a9b`'s commit message (do this first, before anything else)

The current message claims the commit resolves R1 and that the Ubuntu guest
"answers it." The delivered verdict is INCONCLUSIVE, and `docs/r1-findings.md`
explicitly defers the guest-side half to the RHEL VM. The message was taken
verbatim from the brief, which assumed — reasonably, before the run — that the
run would resolve R1. It didn't, and nothing updated the message when the real
outcome diverged. `git log --oneline` on this branch would otherwise say
"resolving risk R1" forever for a commit that did not resolve it.

`git commit --amend` it to exactly this, no other change to the commit's tree:

```
test(vm): probe WSL2 to VMnet8 reachability — host routing confirmed, guest side deferred (R1)

Runs against any VM, so the existing Ubuntu guest could answer it without
waiting for the RHEL ISO — but this guest has no open-vm-tools, so only the
host-routing half of R1 was demonstrated (WSL2 reaches the VMnet8 host
adapter with 0% loss). Guest-side TCP/22 reachability is deferred to the RHEL
VM. SshTransport stays the intended default; see docs/r1-findings.md.
```

Amending needs the same explicit identity as any commit here:

```bash
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit --amend -m '<subject>' -m '<body>'
```

Confirm afterwards with `git show --stat HEAD` that the tree is unchanged (same
four files, same 481 insertions) and only the message moved.

## 2. F1 (must fix) — the `unreachable`/`dropped` split is not a function of the real network state

`scripts/r1-probe.sh` lines 137-179. The reviewer found that the same unclaimed
address classifies as `unreachable` (→ INCONCLUSIVE, "just re-run") on one
attempt and as `dropped` (→ CONFIRMED AS A PROBLEM, prints the elevated-
PowerShell Windows Firewall advice) seconds later, with nothing about the
network having changed. I verified it, and then found it is worse than a flake.

**Confirmation.** Two fresh addresses, first try each:

```
192.168.70.77 attempt1 rc=1   dur=2.83s  "No route to host"
192.168.70.77 attempt2 rc=124 dur=5.05s  (no stderr)
192.168.70.88 attempt1 rc=1   dur=2.94s  "No route to host"
192.168.70.88 attempt2 rc=124 dur=5.05s  (no stderr)
```

**The reviewer's recommended fix (a) is backwards — do not implement it.** It
suggested "retry the connect 2-3 times and only classify `dropped` if *every*
attempt times out." The cause is ICMP Destination-Unreachable rate-limiting in
the Windows NAT/vswitch path: the **first** attempt is the informative one, and
every retry silently times out because the ICMP budget is already spent. So
retrying biases the classifier *toward* `dropped` — the exact wrong direction.

**And the script's own ordering already spends that budget.** The `ICMP`
section runs before the `TCP/22` section, so by the time `/dev/tcp` runs, the
error budget for that address is gone:

```
192.168.70.111 ping first: 3 transmitted, 0 received, +1 errors, 100% loss
  then tcp:                rc=124, no stderr
  ping again:              3 transmitted, 0 received, 100% packet loss   (no "+1 errors")
```

That means on a genuinely unclaimed address — the ordinary "guest isn't up yet"
case, and the single most likely thing a stuck user is actually looking at —
the script will *nearly always* reach `dropped` and print the Windows Firewall
advice. The wrong verdict is the common case here, not the edge case.

**The discriminating signal.** `ping` distinguishes the two states even when
`/dev/tcp` can't, and it does so in its *output*, which the script currently
throws away with `>/dev/null 2>&1`. An address nothing is claiming produces an
ICMP error; a claimed-but-silent address produces plain loss:

```
$ ping -c 3 -W 2 192.168.70.181        # unclaimed, fresh
PING 192.168.70.181 (192.168.70.181) 56(84) bytes of data.
From 192.168.70.1 icmp_seq=3 Destination Host Unreachable

--- 192.168.70.181 ping statistics ---
3 packets transmitted, 0 received, +1 errors, 100% packet loss, time 2083ms
rc=1

$ ping -c 3 -W 2 192.168.70.2          # the NAT gateway: claimed, and silent by design
--- 192.168.70.2 ping statistics ---
3 packets transmitted, 0 received, 100% packet loss, time 2056ms
```

The unclaimed address reports `+1 errors` and a `Destination Host Unreachable`
line; the claimed silent one reports neither. Reproduced on several fresh
addresses (`.111`, `.171`, `.181`) — the marker appears on the first probe of
a cold address every time. Note the count is `+1`, not `+3`: rate-limiting eats
the rest. So test for `+N errors` with N ≥ 1, never for a specific count.

### What to change

1. Capture ping's **output**, not just its exit status. Keep `-c 3 -W 2`.
   Record in a variable whether the output contains either `+[1-9][0-9]* errors`
   in the statistics line or a `Destination Host Unreachable` /
   `Destination Net Unreachable` line. Call that "ICMP said nothing is there."
2. When that evidence is present, classify the address as `unreachable`
   (→ INCONCLUSIVE) **regardless of what the TCP attempt reported**, including
   when TCP returned 124. Independent evidence that nothing claims the address
   outranks a silent TCP timeout, because a silent timeout is exactly what a
   spent ICMP budget produces.
3. Classify `dropped` (→ CONFIRMED AS A PROBLEM, with the fallback list) **only
   when TCP timed out silently AND ping showed loss with no ICMP error
   evidence.** That is the combination that actually means "something is there
   and swallowing packets."
4. **Do not add retries** — and put a comment in the script saying why, naming
   the rate-limiting, so the next person to read it doesn't "improve" it into
   the reviewer's version. This comment is a required part of the fix.
5. Print the ping evidence you keyed off, so a reader can see which branch they
   landed in and why. The ICMP section's current "Not conclusive - Windows
   Firewall commonly drops ICMP while still forwarding TCP. The port check below
   decides." is now wrong in the case that matters: the port check does *not*
   solely decide any more, and ICMP silence-vs-error is load-bearing. Rewrite
   those two lines to match what the code now does.
6. In the CONFIRMED AS A PROBLEM verdict text, add one line telling the reader
   to re-run the probe once before touching any Windows Firewall setting. Even
   with this fix that verdict sends someone into elevated PowerShell, and a
   cheap re-run first is the right first move.

Keep all four labels and the exit-code contract exactly as they are. Do not
reorder the ICMP and TCP sections — ICMP first is what makes the evidence
available to the classifier; the ordering was never the bug, discarding the
output was.

## 3. F3 (cheap) — put the verdict in `docs/r1-findings.md`'s first line

Mandate 6 said the verdict goes "in the first line of the file so nobody has to
infer it." Line 1 is the title; the verdict is the first line of the body. Fold
it into the title:

```
# R1 findings: can WSL2 reach a VMnet8 guest over TCP/22? — INCONCLUSIVE
```

Leave the `**Verdict: INCONCLUSIVE.**` paragraph where it is; it carries the
explanation the title can't.

## Not in scope

- **F4 stays open, forwarded.** The `case` default at line 215 conflating
  `dropped` with `unknown` is a deliberate cautious default; a later hardening
  pass owns it. Do not change the `case` structure beyond what item 2 requires.
- **F2/S2** (the Ubuntu VM's hard power-off) need no code change. Already
  surfaced to the user.
- Do not start, stop, or otherwise touch any VM in this round. Everything here
  is host-side and needs no guest. You may run `ping` and `/dev/tcp` against
  unused VMnet8 addresses to verify — that is what I did, and it touches
  nothing.
- Do not touch `src/`, `test/`, `content/`, `package.json`, or `README.md`.
  No new tests.
- Do not apply the Windows Firewall advice or open the Virtual Network Editor.
  The script prints that advice; it must never apply it.
- No `sudo` on this WSL host — there is no TTY and nothing here needs it.
- Never read or copy `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools`. Unrelated project's secrets.

## Verify before committing

1. `bash -n scripts/r1-probe.sh` clean.
2. **Drive the two branches that item 2 changes, live, and paste both runs.**
   Pick two addresses you have not probed in the last few minutes:
   - a fresh unclaimed VMnet8 address → must now print the ICMP-error evidence
     and reach `R1 INCONCLUSIVE`, even though TCP will time out at 124.
     (Before this fix, this same address reaches CONFIRMED AS A PROBLEM. Show
     the before/after if you can — that contrast is the finding.)
   - a silent-but-claimed address → `192.168.70.2`, the NAT gateway, is the one
     you have: plain 100% loss with no `+N errors`. It should reach CONFIRMED
     AS A PROBLEM with the fallback list. That is the correct verdict for that
     evidence shape even though we know the gateway is not a firewall — say so
     in the report rather than tuning the classifier to special-case `.2`.
3. Re-confirm the two branches you did *not* change still behave: a successful
   connect and a `Connection refused` (a local listener on a high port and a
   closed local port respectively, as the reviewer did). One line of output each
   is enough.
4. `git status --porcelain` empty after committing.
5. `npx vitest run` — still 161 passing, 16 files. This round adds no tests and
   must not change that number.

Report to `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-16-report.md`
— **as an actual file this time**, appending a `## Fix round 1` section. The
reviewer's F0 was that this file never existed; create it now with a short
recap of the original run plus this round's section.

Commit message for the fix (after the amend):
`fix(vm): let ICMP evidence outrank a silent TCP timeout in the R1 probe`
