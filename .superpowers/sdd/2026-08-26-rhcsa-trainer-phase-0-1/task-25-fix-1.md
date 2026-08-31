# Task 25 — fix round 1 of 5. Three required, two required-and-cheap, two one-line corrections.

The review is at `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-25-review.md`.

**Verdicts: spec compliance CHANGES REQUIRED, task quality CHANGES REQUIRED.** Read the reason before
you read the list, because it is not a judgement on the work: the reviewer's own summary is *"the work
is good; it is stopped on three one-liners, not a rewrite."* Every brief and mandate value and copy
string landed verbatim. **Both of your refusals were verified independently and neither is wrong** —
mandate 7's unquoted-value chain reproduced under dash, and mandate 9 item 7's line numbers all
confirmed, including that the real defect is the `*)` arm. Your lint is a real gate: all four of your
plants reproduced, plus four of the reviewer's own; it does check every grader including a plant in the
*last* task; mandate 11's reuse is genuine and `checkpointIds` behaves as you assumed; and all three
committed negative shapes verified plus six more with **no false fail found**. Both mandate-6 floors
bite. The 1811/1766 gap is confirmed trimming, not drift. The RUN / NOT-RUN split is honest and
complete, and step 5's coverage block is byte-identical to a live run the reviewer executed.

Base is `ccdba26`. Commit on `phase-0-1`, stage by name, identity inline as before.

## 1. F1 — REQUIRED. The gate cannot fail when it has nothing to look at.

`lintContent` does `graders = files.filter((f) => f.endsWith('/grade.sh'))` with no
`graders.length === 0` guard. **An existing content root with zero `grade.sh` files exits 0**
(measured). It says `graders checked: 0` and `no problems in 0 grader(s)` in human-readable stdout — but
the thing that gates reads the **exit code**, and a CI step, a pre-commit hook, or `npm run
lint:content` in a wrapper sees green. A nonexistent root correctly exits 1 via ENOENT, so it is the
moved-or-emptied case that bites.

This is the attack I told the reviewer to make, and it landed: **"nothing to check" must not be
indistinguishable from "all clear."** It is the same shape as the eight silent `countCheckpoints`
defects — a tool reporting success it did not earn.

**Fix:** fail when `graders.length === 0`, unless an explicit `--allow-empty` is passed. Add a test that
points the lint at an empty directory and asserts a non-zero exit **and** a named problem, and a second
that asserts `--allow-empty` exits 0 there. Then mutate the guard away and confirm the first test dies.

Do **not** make the fix depend on `content-headers-golden.test.ts`'s `inventory.length > 20`. The
reviewer named that as a partial mitigation and then dismissed it correctly: it is a different command,
and this gate's contract must not rest on another gate.

## 2. F2 — REQUIRED, and it is the one that touches what this project is for.

`HeaderRecord` stores `{ kind, ids }` and `declaredIds` does
`parseExpectations(...).map((d) => d.id)`, which **discards the `@pre`/`@post`/`@both` suffix** before
sorting. Six shipped headers carry `@post`.

Measured: changing `home-from-lv@post` → `home-from-lv` and `fs-home-size@post` → `fs-home-size@pre`
gives `rhcsa lint` exit 0, empty stderr, and an inventory **byte-identical to the committed fixture**.
The drift detector cannot see the edit. Meanwhile `expectedStatus()` *does* read the phase, so the
runtime's verdict changes while every static check stays green.

**Why this is the most important item on the list.** `@pre` versus `@post` is verdict A versus verdict
B — "it works now" versus "it survives a reboot." That distinction is the single thing this app exists
to teach, and it is what the RHCSA exam actually punishes people for missing. A silent inversion of an
anti-solution's persistence semantics is a false green on the exact axis the project is built around.

**Fix:** carry the phase into the golden inventory — `id@phase`, or a parallel `phases` field. Then
regenerate the fixture, re-run the reviewer's mutation, and confirm the inventory now differs and the
test fails.

## 3. F4 — REQUIRED. This is the spec-compliance half, and it is my instruction you missed.

I told you to fold Task 24's fifteen handed-over checks into your checklist **rather than write a
parallel one, because a second list is how a check gets lost.** Thirteen survived. Two did not:

- **Check 1 has no home** — chapter numbers and the `supporting` badge in the picker.
- **Check 8 was halved** — its "derived, not self-reported" explanation half was dropped.

Both lost fragments are the **only** coverage of `TaskPicker.tsx:63-65` and `App.tsx:281`, neither of
which has a test. So the failure mode is real: the `supporting` badge stops rendering, nothing catches
it, and the checklist that claims to hold its check does not.

Credit where it is due — checks 9-11 (masking) and 12-13 (persistence), the two groups Task 24 flagged
as most likely to rot unnoticed, both survived **and got more rigorous**. You lost the two nobody
flagged, which is worth noticing for its own sake.

**Fix:** add the picker check (chapter numbers, `supporting` badge) and check 8's explanation half to
"The run." Then state in your report how many of the fifteen are now traceable, and by what means you
counted — not from memory.

## 4. F5 and F6 — REQUIRED. One line each, and both are classes that have already cost this branch.

- **F5 — `Array.isArray([])` is `true`.** Finishing returns `checkpoints: []` and the e2e assertion
  certifies the unmask on an empty result. It is not load-bearing *only* because the test is VM-gated
  and has never run — which is exactly the condition under which someone later nudges it green and it
  certifies whatever the code does. Assert a non-empty length, or the specific ids. This is the same
  defect class as mandate 6, which exists because `expect(nudgeBody).not.toMatch(...)` passes on `''`.
- **F6 — five rows read as "covered by a passing test" when that test has never executed.** Reword so a
  reader cannot mistake a never-run test for coverage. You already said you would rather state that
  than count it as coverage; this is the place it did not land. **A disclosure whose wording is wrong is
  worse than no disclosure**, because the next reader acts on its authority — that class has now
  appeared six times on this branch.

## 5. F7 and F8 — one-line corrections, only if they truly are one line each.

- **F7:** the `3 / 5` tally prediction is attributed to check 7; it belongs to check 9.
- **F8:** a reported margin says 577 where the measured value is 669.

Both are the **citation-drift** class — a number or pointer that proves something adjacent to its claim
— which has now bitten this branch three times (a moving working tree, a two-change mutant, and a
mutant tripping an earlier assertion in the same test). Fix them at point of use. If either turns out to
be more than a line, leave it and say so.

## 6. Not to be fixed — do not touch these

- **F3** — `! ck "$x"`, `if ck`, `while ck`, `LC_ALL=C ck`, `time ck`, `eval 'ck …'` invisible to the
  lint. `Ruling: leave F3 alone — why: the counter is blind to the identical shapes, so the lint's view
  matches the runtime's rather than diverging from it, no grader in the bank uses any of them
  (measured), it is already parked as the command-prefix divergence, and it is documented in the lint's
  docstring — cost if wrong: a future grader written with a command prefix has its ids uncounted by
  both tools equally, which is the pre-existing parked condition and not a new one.`
- **F9** (under dropped packets `beforeAll` times out at 120 s instead of printing the diagnostic),
  **F10** (coverage doc uses a fenced block; content is a byte-exact live run). The reviewer ruled both
  need nothing and I agree.
- **P24** (no `countSuspect` field), **P28** (the false comment at
  `test/server/checkpoint-oracle.ts:530-532`), Task 24's **F4**, and everything else in
  `whole-branch-parked.md`. The whole-branch review owns them.
- Do **not** create the `phase-1` tag. Mandate 1 stands: step 9's tag is the user's.
- Do not soften a NOT-RUN step, do not invent a result, and do not let anything imply Phase 1's exit
  criterion was met. The reviewer confirmed you got this right; keep it right.

## Scope

Nothing beyond the above. Do not modify `src/server/session.ts`, `src/engine/grading/`,
`content/lib/assert.sh`, or `objectives.yaml`. `content/` changes only where F2's fixture regeneration
requires them. No new features.

## Gates

`npm run typecheck`, `npx vitest run`, `npm run build:web`, `npm run lint:content` — all clean, **0
skipped**. Current is 408/35; your new tests raise it. Confirm `git tag -l` is still empty and
`git status --porcelain` is empty when you finish, with your work committed.

**Re-run the reviewer's two mutations yourself** — the empty-content-root case for F1 and the
`@post`→`@pre` edit for F2 — and report both as measured, not reasoned. For F2 specifically, confirm
the golden fixture now **differs**, because a fixture that still matches means the phase did not reach
the inventory.

## Prohibitions

Unchanged: no VM operations, no `vmrun`, no `scripts/provision.sh`, no `sudo`, no `ssh-keygen`, nothing
written to `~/.ssh/`, no touching `.env.local`, nothing read under `/home/daxtangco/sechelp-tools`, no
subagents, nothing left listening, no Red Hat credentials anywhere.

## Report

Append a `## Fix round 1` section to `task-25-report.md`. Return only: status, the commit sha(s), a
one-line test summary, one line per item above, how many of the fifteen checks are now traceable and how
you counted, and whether the F1 and F2 mutations now fail — measured.

One question to answer: **is there a third silent-green channel in the lint that neither of us has
found yet?** You have now seen two — a filter that can match nothing, and an inventory that drops a
field it compares on. Both are the same shape: *the gate compared successfully because it never looked
at the thing.* Go looking for a third with that sentence in hand, and if you find none, say what you
checked.
