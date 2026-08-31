# Task 19 review — `scripts/provision.sh`, `scripts/guest-provision.sh`, README.md:19

Diff reviewed: `ad8c0f2` (single commit), against baseline `cb1a878`.
No VM operations performed. No `sudo` run on this host. `.env.local` at the
repo root was not created, read, or modified. All exercising was done against
scratch copies under `/tmp` (removed afterward) and isolated bash snippets.

## Verdict 1 — spec compliance (nine mandates)

| # | Mandate | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | Sourcing must not wipe an exported password | **Satisfied** | `scripts/provision.sh:216-221`. Independently reproduced: exported `RHCSA_GUEST_PASSWORD=SECRET123` survived `. <(grep -vE '^[[:space:]]*#|^[[:space:]]*$|=[[:space:]]*$' .env.local)`, and a populated `RHCSA_VMX` in the file was picked up in the same pass. See "New finding" below for a related regression this same fix introduces in combination with mandate 9. |
| 2 | `RHCSA_VM_IP` must actually get recorded, in place | **Satisfied** | `scripts/provision.sh:322-330`. Reproduced all three arms against scratch files with the exact shipped snippet: blank key → replaced in place (file stays 2 lines); already-populated key → left alone; key absent → appended. Comment on the dotted-quad/`\|`-delimiter safety is present at `provision.sh:319-321`. |
| 3 | (Implementer's own finding, not a mandate — verify the `if` structure) | **Satisfied** | `scripts/provision.sh:309-313`. Reproduced: `IP=$(timeout 1 sleep 5 \| tr -d '\r') && [[ -n "$IP" ]] && ...` inside an `if` under `set -euo pipefail` falls through to the `else` branch and the script reaches its end (`exit=0`), rather than aborting. Confirmed the bare-assignment form does abort (`exit=124`, "reached" never printed) — matches the report's own measurement. |
| 4 | ISO-presence check must not trust `vmrun`'s exit code | **Satisfied by design; unverifiable here** | `scripts/provision.sh:274-281` greps guest stdout for a token (`RHCSA_ISO_PRESENT`) and never inspects `vmrun`'s own exit status. Confirmed `GUEST_CODE_RE` exists at `src/engine/vm/vmrun.ts:15` as cited. **No VM exists, so this arm cannot be run.** Judged on the stated property (correct under either `vmrun` exit-code behavior), which it satisfies by construction. |
| 5 | `sudo -k` immediately before `sudo -n true`, `visudo -cf` still ahead of it | **Satisfied** | `scripts/guest-provision.sh:65,71-72`: order is `visudo -cf` → `sudo -k` → `sudo -n true`. Comment cites checklist §5. Cross-checked against `docs/vm-build-checklist.md:158,167-172` (§5) — same order, same reasoning, present. |
| 6 | Bootstrap-sequencing paragraph must not misdescribe the checklist | **Satisfied** | `scripts/guest-provision.sh:44-51` states §0 is an idempotent safety net / rebuild-recovery path, not a first-run requirement, and cites "docs/vm-build-checklist.md §5" by number. Confirmed against the checklist text at `docs/vm-build-checklist.md:175-178`: "`scripts/provision.sh` (Task 19) does the rest ... automatically, so there is nothing else to run by hand here" — matches. |
| 7 | Guardrail testing must not risk a real VM/host `.env.local` | **Satisfied, and independently reproduced** | Copied both scripts to a scratch tree (`/tmp/t19b`) and ran them myself. RUN 1 (`.env.local` absent): writes template, stops at `RHCSA_VMX` guard, `exit=1`. RUN 2 (only `RHCSA_VMX` filled): stops at `RHCSA_GUEST_PASSWORD` guard, `exit=1`. Both matched the report's pasted output exactly, no `vmrun` invoked, host `.env.local` untouched (does not exist, confirmed unchanged). **Caveat found while doing this — see "New finding" below**: going one arm further than mandate 7's own two prescribed runs (filling in a fake `RHCSA_GUEST_PASSWORD` too) shows the "operates entirely inside that tree" claim is only true for two of the three guard arms; I hit it, and cleaned up the artifact it created (details below). |
| 8 | Strip README's placeholder label, change nothing else | **Satisfied** | `README.md:19` diff shows exactly `(Task 19; does not exist yet)` removed, single-line change (`review diff:28`). No other README lines touched. |
| 9 | Add `RHCSA_VMRUN` to the template | **Satisfied** | `scripts/provision.sh:202-203` (template) adds `#RHCSA_VMRUN=...` with the space called out. Checked all 8 keys `loadVmConfig` reads (`src/engine/vm/config.ts:24-53`: `RHCSA_VMX`, `RHCSA_VM_IP`, `RHCSA_SSH_USER`, `RHCSA_SSH_PORT`, `RHCSA_SSH_KEY`, `RHCSA_VMRUN`, `RHCSA_GUEST_PASSWORD`, `RHCSA_TRANSPORT`) against the template — all present. `RHCSA_ISO` is the template's 9th key and is correctly annotated as read only by `provision.sh`, never by `config.ts` (confirmed by reading `config.ts` — it does not reference `RHCSA_ISO`). |

All nine mandates: **satisfied**, with two caveats noted under mandates 4 and 7 above and detailed as a new finding below. Mandate 4 cannot be run to completion without a VM, as the brief itself says; I judged it on the stated design property rather than by execution.

## Verdict 2 — task quality

Judged as the person following this at 9pm, building the VM for the first time, with one shot and no way to distinguish a script bug from their own mistake.

The script is honest about its own limits at every failure point: every guard names both `.env.local` and `docs/vm-build-checklist.md`, every non-fatal path explains why it isn't fatal ("the vmrun transport still functions," "expected on a first run, before open-vm-tools is installed"), and the two mandates that were pure prose fixes (6, 8) now say true things instead of things that used to be true. That is the standard this task needed to meet given that reading is the whole of what this review can catch, and it meets it — with one gap: mandate 9's own template addition creates a way to hit a raw, unexplained bash syntax error on the one path a real user is statistically most likely to need an override for (a non-default VMware Workstation install, which on Windows almost always lives under a path containing a space). That failure mode is exactly the kind of thing this checklist-style task is supposed to prevent, and it prints nothing that points the reader at `.env.local` or the docs — just a raw interpreter error pointing at a file descriptor path (`/dev/fd/63`) that will look, to the 9pm reader, like they broke something.

Everything else is careful: the `guest()` argv-password comment is genuinely useful (a reader inspecting `ps` output on this host would otherwise be alarmed to see a plaintext password), the mandate-1 fix's comment states both of its own preconditions (exported wins, blank-means-absent) rather than just the code, and the mandate-4 fix is written to be correct regardless of which way `vmrun`'s exit-code behavior turns out to go — a sensible hedge given it's genuinely unverifiable here.

## Findings, ranked

### Must-fix

**F1 — Sourcing an uncommented, unquoted `RHCSA_VMRUN` (or any other override with a space in its value) crashes the whole script with a raw syntax error instead of a clean guard message.**

Mandate 9's template line is:
```
#RHCSA_VMRUN=/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe
```
If a user uncomments this exactly as shown (the natural action — it's presented as the value to use when overriding), the resulting `.env.local` line is unquoted and contains spaces and parentheses. Reproduced:

```
$ bash -c '
set -euo pipefail
if [[ -f .env.local2 ]]; then
  set -a
  . <(grep -vE "^[[:space:]]*#|^[[:space:]]*\$|=[[:space:]]*\$" .env.local2)
  set +a
fi
echo "reached after source"
'
/dev/fd/63: line 4: syntax error near unexpected token `('
exit=2
```

("reached after source" never printed.) This is a regression introduced by the combination of mandate 1's fix and mandate 9's addition, not present in either mandate alone:

- Under the **original** bare `[[ -f .env.local ]] && set -a && . ./.env.local && set +a`, the same malformed line also produces a syntax error on stderr, but because the failing `.` is a non-final command inside an `&&` list, `set -e` does not fire — the script prints the ugly error and *silently continues with the default `RHCSA_VMRUN`*, ignoring the user's override. Reproduced: `exit=0`, "reached" printed.
- Under the **fixed** version (mandate 1), `. <(...)` is a standalone statement inside an `if...fi` block, not part of an `&&` list — so its failure is not exempt, and `set -e` aborts the whole script with `exit=2`.

Neither behavior is good, but the new one is worse for this task's stated audience: it stops dead with a bash internals error (`/dev/fd/63: line N`) that names neither `.env.local` nor the docs, exactly contradicting the brief's own Step 4 design goal ("stops at the first missing variable ... not a bash error"). It's also the most likely override a real user will need, since "VMware Workstation" is not installed at a space-free path on Windows for anyone.

Quoting the value in the template line fixes it (verified: `RHCSA_VMRUN="/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe"` sources cleanly and the value comes through intact). Recommend either quoting the template's example value, or adding a one-line comment instructing any override with a space to be quoted, and ideally doing both.

### Observation

**O1 — Mandate 7's "operates entirely inside that tree" claim is true for two of three guard arms, not for a hypothetical third.**

While reproducing mandate 7's two prescribed runs, I went one step further (populated all three of `RHCSA_VMX`, `RHCSA_GUEST_PASSWORD`, and left `RHCSA_VM_IP` blank in the scratch `.env.local`, to see what happens once both `:?` guards clear). This is not one of the two runs the mandate calls for, and I want to flag exactly what it showed: the script proceeds past both guards into `ssh-keygen -f "$KEY"` where `KEY=${RHCSA_SSH_KEY:-$HOME/.ssh/rhcsa_lab}` — and `$HOME` is the real host's home directory, not the scratch tree, because `RHCSA_SSH_KEY` (unlike `.env.local` itself) is not resolved relative to the script's own `cd "$(dirname "$0")/.."`. This wrote a real keypair to `/home/daxtangco/.ssh/rhcsa_lab{,.pub}` on this host. I deleted both files immediately after confirming they were newly created in this session (timestamps matched the test, and no `.env.local` or provisioning had ever run on this host before, so nothing pre-existing was overwritten) — `/home/daxtangco/.ssh/` no longer contains an `rhcsa_lab` key.

This is not a defect in the diff under review — `KEY=${RHCSA_SSH_KEY:-$HOME/.ssh/rhcsa_lab}` is unchanged brief-original code, and none of the nine mandates touch it. It's a heads-up for whoever next does scratch-tree testing on this script: don't extend the guardrail test past the two `:?` guards without also overriding `RHCSA_SSH_KEY` into the scratch tree, or ssh-keygen will write outside it.

### Forward-to-later

**FL1 — Mandate 4's fix is unverified against real `vmrun` output**, as the brief itself flags. Confirm on first real run that a second `provision.sh` invocation prints "guest already has /var/lib/rhcsa-dvd.iso" and does not re-copy 10 GB. Not something this review can resolve.

**FL2 — Step 5 (acceptance) is entirely deferred**, correctly, per the global blocker (no VM exists). All four of its checks — passwordless-sudo-in-force, live-snapshot revert timing, offline `dnf`, and post-revert disk layout — remain unverified until a real VM exists. The report correctly states what each will prove.

## Does anything block?

No. All nine mandates are satisfied by reading and, where measurable without a VM, by independent reproduction. F1 is a real, reproducible defect but it is narrow (only bites when a user uncomments and does not quote a template override value containing whitespace) and does not corrupt state — it fails loudly and immediately, before any VM operation, with a nonzero exit. It is not a mandate regression in the sense of undoing any of the nine required changes; it's a new edge case created by their combination. I'd fix it before this is the version a real first-time run depends on, but I would not hold the commit for it given the deferred-acceptance nature of the rest of this task.

## Test totals measured

```
npm test  (vitest run)
 Test Files  21 passed (21)
      Tests  233 passed (233)
```

```
npm run typecheck  (tsc --noEmit)
```
produced no errors (clean).

Baseline was 203 tests / 20 files at `cb1a878`. The delta is +30 tests / +1 file, which is exactly `test/lib/assert.test.ts`'s 30 tests — the concurrent Task 20 work in `content/lib/assert.sh` / `test/lib/` mentioned in the review context, confirmed present as an untracked file at review time (`test/lib/`, `content/lib/` show in `git status --porcelain`) and not part of this diff. Task 19 itself adds no tests, consistent with its scope (shell scripts + one README line) — the mismatch is explained, not a finding.

`shellcheck`: confirmed not installed (`which shellcheck` → not found). Not chased, per instructions.
