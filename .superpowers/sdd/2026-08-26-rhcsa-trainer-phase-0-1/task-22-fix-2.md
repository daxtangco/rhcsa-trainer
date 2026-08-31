# Task 22 — fix round 2

The scoped re-review returned **APPROVED**. Every finding you fixed is CLOSED; F10,
F11 and F14 confirmed left alone as ruled. Full report:
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-rereview.md`.

It verified more than it was asked to and it reproduced your work rather than
inheriting it: all 26 declaration headers across `content/tasks` diffed against
`9d2dc22` with zero drift (you compared 5 files, it did all of them), its own
four-call-form extractor reproduced all five declared/emitted pairs, and
`storage/014` read 5/2 on its **first** run — so your disclosed under-count is not
reproducible and your correction was genuine. F1's fix was measured across 10
timezones from −11 to +14, all passing, on the reasoning that the grader now computes
literally the same expression `strtoday()` computes in the same TZ, so the two agree
by construction rather than by coincidence. The old form failed 6 of the 10.

This round is five small items the re-review named, and one of them is a fail-open in
F4's own device derivation. None of them is a defect in what I asked you for; they are
what a second measurement pass found underneath it.

---

## R1 — `019/setup.sh:131`: the device derivation can fail open. Do this one first.

`nmcli -g DEVICE connection show --active | head -1` can plausibly return `lo`, since
NetworkManager 1.42+ (RHEL 9.2+) manages loopback. `lo` is in no zone, and F4's check
treats "no zone" as fine — by my own ruling, correctly. So the two combine into
exactly the failure F4 exists to prevent: the check passes silently while the real NIC
sits in a wrong zone. Fail-open, which is the bad direction.

Fix: derive the device from the default route as the primary source —
`ip -o route show default` — and fall back to the `nmcli` form only if that yields
nothing. If you cannot get a form you can defend, exclude `lo` explicitly at minimum
and say in your report that you took the weaker option and why.

`028` is **not** exposed: it derives the device from `$conn`. But note the same
`head -1` idiom is pre-existing and unchanged at `028/setup.sh:21`, where the original
review passed it — if the hardened form is a clean drop-in there too, apply it and say
so; if it is not, leave `028/setup.sh:21` alone and flag it rather than reshaping code
this round has no finding against.

## R2 — the `want=` unset hazard, and it is the one that can make a checkpoint vanish.

`users/006/grade.sh`. `want=$(( $(date -d 2027-06-30 +%s) / 86400 ))` leaves `want`
unset if `date` ever emits nothing, and the next `"$want"` then trips `set -u` and
kills the grader mid-run. Measured by the re-reviewer: only `group-gid` survives, and
`carol-expiry`, `alice-maxdays`, `sudo-devops` and `student-intact` **disappear**
rather than fail. The old form left `want` empty and merely failed one checkpoint, so
the fix traded a wrong answer for a missing one.

Unreachable with GNU coreutils, so this is a nit by likelihood — but "a checkpoint
disappears instead of failing" is the precise thing `content/lib/assert.sh` and the
JSONL contract exist to prevent, and a vanished checkpoint reads as a pass to anything
that only counts failures. Split the two steps so the epoch read can fail loudly on
its own:

```bash
want_epoch=$(date -d 2027-06-30 +%s)
want=$(( want_epoch / 86400 ))
```

Use whatever guard shape the file already uses for a value it must have.

## R3 — `F5`'s comment claims something that is measurably false.

The comment says a colon in the profile path is safe. Measured by the re-reviewer: it
is not. `nmcli` writes `\:`, the `awk` does not un-escape it, and `sed` then fails
loudly on a stray backslash.

The behaviour is fine — a loud failure on an unreachable input is an acceptable
outcome, and it is still an improvement on the old form, which returned empty. **The
comment is what changes.** Say what it actually does: keys on `connection.uuid`,
handles names with spaces, and fails loudly rather than silently on an escaped colon
in a path.

Worth naming why this is in the list at all: the clause was measured against a
synthetic fixture that did not reproduce `nmcli`'s own escaping. That is the F1 defect
class in miniature — a real measurement against the wrong input, wearing a "measured"
label. Not a criticism of the round; it is the single most useful thing to have
surfaced, because it is the failure mode nobody catches by being careful.

## R4 — `019/setup.sh:75-76`: finish F9's unification.

Still `!= "enabled"` where the grader now uses `grep -qx`. You fixed the mirroring
precondition in `028` and not in `019`. Same reasoning as F15: after a deliberate
unification, the one site left in the old spelling cannot be told apart from an
oversight. Reasoned, LOW, three lines.

## R5 — correct the two rows in `task-22-report.md`.

F13 and the reporting half of F7 are PARTIALLY CLOSED for one reason only: the
corrections were published in `task-22-fix-1-report.md` §5 while
`task-22-report.md:118` and `:174` still carry the original wrong rows with no
pointer. Correct both rows in place, and leave a short parenthetical saying they were
corrected in fix round 1 so the history stays legible. Documentation only — no code,
no effect on Task 23.

---

## My F15 ruling was wrong, and you should know which part

I endorsed your claim that reusing `state` would have clobbered `stamp-enabled`'s
detail string, called it correct, and told the re-reviewer it was the one place a
careless edit could corrupt an unrelated diagnostic. The re-reviewer measured it:
`state=` is at `017/grade.sh:14`, `ck stamp-enabled … "is-enabled=$state"` is at `:16`,
and `ck` in `content/lib/assert.sh` prints immediately with no deferred evaluation —
so by line 42 that JSON was emitted 26 lines earlier. `state` is intact for
`stamp-enabled` **by ordering, not by naming**.

`sshd_state` is still the better name and nothing changes. I am telling you because
the reasoning I endorsed would have felt like a check without being one in a file
ordered the other way, and because it is the fourth time this task that I have
written or blessed a rationale for a path I did not execute. The rule I gave you
applies to me first: if my rationale and your measurement disagree, the measurement
wins — and "the team lead agreed with me" is not a measurement.

---

## Also confirmed, no action

- My F4 "an interface under no zone is fine" ruling holds.
- My F8 wider-pattern ruling holds, and the re-reviewer reproduced the measurement:
  my ruled pattern would have false-failed a real `(ALL : ALL) ALL`. Your widening was
  right and is a strict superset that rejects every must-not case, including four
  adversarial near-misses it added.
- One correction to the original review's phrasing, for the record: `Europe/London`
  also failed under the old check, because BST is UTC+1 in June. "East of Greenwich"
  was a zone too generous.
- A pleasant side effect of F1 worth keeping: `docs/vm-build-checklist.md:63` no
  longer needs a UTC pin. The fix removed the dependency instead of constraining the
  guest.
- `006/antisolutions/01`'s `# expect-fail:` list, which deliberately omits
  `carol-expiry`, becomes honest for the first time because of the F1 fix. Observation
  only.

## Gates

Same as round 1, all re-run and reported with real output: `npm run typecheck` exit 0;
`npx vitest run` **246 passing / 23 files**; `bash -n` on every script you touch;
`node src/cli/index.ts coverage` exit 0 with no `problem:` lines; declared-vs-emitted
both directions with the five pairs unchanged; declaration headers still byte-identical
to `9d2dc22`; `git status --porcelain` empty when you finish.

**No checkpoint added, removed or renamed.** R2 edits a grader's variable handling and
R4 edits a setup precondition — neither touches a checkpoint id, description or
declaration header. If you find yourself needing to, stop and tell me.

One commit on `phase-0-1`, identity inline as before. The message should name R1 as the
fail-open it is and the rest as hardening, and must not imply anything ran against a
RHEL 9 guest.

## Prohibitions, unchanged

No VM operation. No `vmrun`. Do not run `scripts/provision.sh`. No `ssh-keygen`,
nothing written into `/home/daxtangco/.ssh/`. Do not create or read `.env.local`. No
`shellcheck`. No subagents.

## Report

Append as section 8 of `task-22-fix-1-report.md` — one task, one report file. Return
only: the commit sha, one line per item R1-R5 saying fixed or not with why, the gate
results, and anything you disagree with. Say per item whether you **measured** or
**reasoned** it. R1 and R2 are both measurable on this host in synthetic form; the rest
mostly are not, and saying so plainly is the right answer.
