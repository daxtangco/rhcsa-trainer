# Task 16 — fix round 2

One change, in one place, closing both of the re-review's remaining
observations. Neither blocked; both are cheap enough that parking them for a
"later hardening pass" would mean nobody touches the file again for months.

`scripts/r1-probe.sh`, the `ICMP` section. Two findings, one condition:

**F5 (re-review) — the raw ping dump is noise on the success path.** The dump
prints unconditionally, so a healthy ping shows eight lines of per-packet RTT
detail before the one-line `ok: ping $ip` that is all a happy-path reader needs.
On the *failure* paths that detail is the evidence `icmp_no_claim` is derived
from, so it belongs there and only there.

**The stale-flag edge case (re-review) — `icmp_no_claim` is computed even when
the ping succeeded.** If a burst got at least one reply (`ping_rc=0`, so the
address *is* claimed) but an earlier packet in the same burst logged a transient
ICMP-unreachable — a guest finishing its boot mid-ping — the flag is still set to
`yes`. It is then read again in the TCP section, and if TCP separately times out
at 124 the script reports `unreachable` for what could be a genuine same-run
firewall onset. This is the project's recurring shape once more: a check that
holds for the wrong reason.

The fix for the second is not a heuristic — it is a definition. If anything
answered the ping, then "nothing is claiming this address" is false, so the flag
must be `no` whenever `ping_rc -eq 0`.

### What to change

Gate both on the same condition: `ping_rc -ne 0`.

- Compute `icmp_no_claim` only when the ping did not succeed; leave it `no`
  otherwise.
- Print the indented raw `ping_out` only when the ping did not succeed.

Restructure the block however reads most clearly — moving both into the existing
`elif`/`else` arms is probably cleaner than adding a guard around each. Keep the
existing comment explaining *why* the output is captured rather than discarded,
and add a short clause saying why a successful ping forces the flag to `no`.

Do not change the regex, the TCP section, the `case` statement, the verdict
texts, or anything else. Do not touch `docs/r1-findings.md`.

### Verify before committing

1. `bash -n scripts/r1-probe.sh` clean.
2. Drive all three ICMP shapes and paste each. The classifier can be exercised
   without a VM by extracting the `ICMP` and `TCP/22` sections into a harness
   with `ip` set — that is how both the re-review and I tested it:
   - **success** (`127.0.0.1`): one `ok: ping` line and **no** raw dump.
   - **fresh unclaimed VMnet8 address you have not probed in the last few
     minutes**: raw dump present, `+N errors` visible, outcome `unreachable`.
   - **`192.168.70.2`** (NAT gateway, claimed and silent): raw dump present, no
     `+N errors`, outcome `dropped`.
3. `npx vitest run` — still 161 passing / 16 files.
4. `git status --porcelain` empty after committing.

Append a `## Fix round 2` section to `task-16-report.md`.

Commit message:
`fix(vm): only derive and print ICMP evidence when the ping actually failed`
