# Task 24 — fix round 1 of 5. Two required fixes, four required tests, one parked.

The review is at `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-24-review.md`.

**Verdicts: spec compliance APPROVED. Task quality CHANGES REQUIRED.** Every mandate and every brief
step landed with the specified values, component names and all 16 prescribed test names verbatim; both
your disclosed deviations were ruled defensible; the `@vitejs/plugin-react` pin was confirmed
necessary by measurement. Your mandate-9 refusal was correct and I verified `app.ts:287-291` myself.
Your jsdom-comment catch holds — the reviewer re-inserted the directive and confirmed your assertion is
what kills it. What follows is a quality gate, not a rewrite.

Base is `7dbaaf4`. Commit on `phase-0-1`, stage by name, identity inline as before.

## 1. F1 — REQUIRED. A load-bearing false fail on the guided path, measured.

`App.tsx:41` derives `finished` from `rating !== null`. But `app.ts:315` returns `rating: null` for
guided mode. So after a successful guided Finish, `finished` stays `false` and **mandate 7's entire
guard is inert in the one mode a beginner uses first**: no confirmation box, Grade/Reset/F2/F4/F8 all
stay live, the clock keeps running until the rail says "over budget", and a second F4 hits the 409
whose `setReport(undefined)` **wipes the earned "5 / 5 passed" off the screen**.

The scenario is the one that matters: a beginner finishes a guided lab in four minutes, reads the
concept cards, and the rail tells them they went over a ten-minute budget. On a lab they solved.

**Fix:** derive `finished` from the finish response's `phase === 'graded'` — already on
`FinishResponse`, which you added — or from a dedicated state. Do not derive it from `rating`. Give the
rating box a guided arm so a guided finish still gets a confirmation. Two working probe tests exist at
`/tmp/t24/test/web/app-probe3.test.tsx`; read them, but write your own.

**Ruling on the mechanism:** use `phase`, not a `mode === 'guided'` special case. `Ruling: finished is
a property of the session's phase, not of whether a rating was produced — why: rating is mode-dependent
by design and phase is not, so keying the guard to phase makes the guard mode-independent and the next
mode added cannot silently reopen this hole — cost if wrong: one more field read in the finish
handler.`

## 2. F2 — REQUIRED. Two lines. The suite cannot tell the pass verdict from the fail verdict.

Mutant M8 replaces `Rail.tsx:186`'s emerald `All checkpoints passed.` with the rose
`Not all checkpoints passed.` and **all 28 web tests still pass**, because both positive assertions are
`screen.getByText(/all checkpoints passed/i)` (`rail.test.tsx:329`, `:346`) and the fail copy satisfies
that regex as a case-insensitive substring. The negative assertions are fine.

The gap is one-directional, in the only direction that tells a student who solved the lab that they did
not. Anchor both positive assertions — `getByText('All checkpoints passed.')` or
`/^All checkpoints passed\.$/`. Then re-run M8 yourself and confirm it now dies.

## 3. Your disclosed blocker was not real, and this part is REQUIRED, not recommended.

You reported that `createApi()` at module scope makes `App.tsx` un-fakeable without restructuring. The
reviewer measured otherwise: `vi.mock('../../src/web/api.ts', …)` **hoists above** the module-scope
call and the fake reaches `App`. The real blockers are two jsdom stubs — `matchMedia` (xterm needs it)
and `WebSocket`. The recipe is written out at `task-24-review.md:301-318`, including two gotchas the
reviewer hit: `TaskPicker`'s Start button is disabled for one render tick after the task list arrives,
so wait for `getAttribute('disabled')` to be null before clicking; and the mode buttons' accessible
name includes the blurb, so match `/^Guided /` not `/^Guided$/`.

The reviewer called these recommended. **I am requiring them.** `Ruling: require tests for App items 1,
4 and 5 plus one TerminalPane test, over the reviewer's "recommended" — why: F1 is a load-bearing
defect that existed precisely because items 1 and 4 were unmeasured, so treating the same surface as
optional a second time is choosing to be surprised again; the blocker that justified skipping them is
disproved and a working recipe is in hand, which makes this cheap now and expensive later — cost if
wrong: perhaps an hour of test-writing on code that was already correct.`

Required tests:

- **App item 1** — the key-handler gate. Assert F2/F4/F8 do nothing once the session is finished, **in
  guided mode**, since that is the arm F1 broke.
- **App item 4** — the timer stops at finish. This is the assertion that would have caught F1 outright;
  make it fail against the old `rating !== null` derivation before you trust it.
- **App item 5** — your `setReport(undefined)` fix. State in the test what it prevents: a stale passing
  verdict rendered against a new attempt. That is the false-pass class, so this test is not optional.
- **F3 — one `TerminalPane` test.** Mandate 6's `statusRef` fix is implemented correctly and read
  correctly but is entirely unmeasured, and it is exactly a latent-caller bug — it only shows up when
  someone later writes `onStatus={(s) => setStatus(s)}`. Render `<TerminalPane onStatus={inline arrow}/>`
  twice and assert **one** `WebSocket` construction. Confirm it bites by reverting the ref.

## 4. F4 — PARKED, no change. Do not fix this.

When `verdictFor` returns `null` (a truncated run, or `total > expectedTotal`), the rail says "This is
not a score" and Finish stays enabled, then derives a rating from `report.allPassed` — `false` for the
truncated case — so a grader that timed out records a `hard`-shaped rating against a lab the student
may have solved.

`Ruling: park F4 for the whole-branch review alongside P24 — why: disabling Finish there would trap the
student in a session with no way to close it, no mandate asked for it, Phase 0/1 does not schedule off
the rating yet, and the real fix is a countSuspect-aware finish path whose field mandate 10.5(b)
explicitly parks — cost if wrong: one early rating is shaped by a timed-out grader in a phase that does
not read ratings yet.` I agree with the reviewer's own recommendation here. **Leave it alone**, and do
not add a `countSuspect` field to the server report type.

## Scope — nothing else

Do not touch `src/server/session.ts`, `src/engine/grading/`, `content/`, `objectives.yaml`, or
`content/lib/assert.sh`. Do not renumber or rewrite Step 16's fifteen checks — the handoff was ruled
good enough for Task 25. Do not revisit the bundle size, the terminal dying on reset, or
`report.regressions` going unrendered; all three are accepted. Do not add features.

## Gates

`npm run typecheck`, `npx vitest run`, `npm run build:web` — all must pass, **0 skipped**. Current is
379/31; your new tests raise it. Confirm no new `as` casts, non-null `!`, `enum`, `namespace`, parameter
properties or decorators. `git status --porcelain` empty when you finish, work committed.

Re-run M8 and the F1 probe after your fix and report both as measured, not reasoned.

## Prohibitions

Unchanged: no VM operations, no `vmrun`, no `scripts/provision.sh`, no `sudo`, no `ssh-keygen`, nothing
written to `~/.ssh/`, no touching `.env.local`, nothing read under `/home/daxtangco/sechelp-tools`, no
subagents, nothing left listening.

## Report

Append a `## Fix round 1` section to `task-24-report.md`. Return only: status, the commit sha, a
one-line test summary, one line per required item above, and whether M8 and the F1 probe now die —
measured.

One question to answer: **did the App-test recipe work as written, or did you hit a third blocker the
reviewer did not?** If the recipe is wrong somewhere, say where — it is about to be the pattern every
later UI test in this project copies.
