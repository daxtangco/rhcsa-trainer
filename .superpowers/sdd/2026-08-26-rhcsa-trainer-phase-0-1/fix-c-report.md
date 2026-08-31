# fix-c report — the six-item final-rereview fixups

Base: HEAD `6e99c3e` (branch `phase-0-1`). Committed as `3b26a65843c9fa17652b2ceeae79bf0b136aafa2`.

## Status: DONE, all six items landed, committed, all four gates green.

## Items

1. **`src/cli/lint.ts:179`** — `SHELL_OPTION_LINE` widened from `/^set\s+[-+][^;]*$/`
   to `/^set\s+[-+][^;&|]*$/`, closing `&&` and `||` the same way `;` was already
   closed. Comment above it extended to explain the new exclusion and why `&&` is
   the likelier authoring shape than `;`. Added a test,
   `does not flag a set-options line joined to a real command by &&`
   (`test/cli/lint.test.ts`), mirroring the existing `;` test with the review's
   exact fixture body (`set -euo pipefail && sudo lvextend -L 12G /dev/rhel/home`).
   Verified: the new test and the existing `;` test both pass; the whole-bank test
   (`passes the shipped bank...`) and the `lint on the shipped bank` describe block
   both still pass, which is the "fires on none of the sixteen anti-solutions"
   property — I ran it rather than reasoning about it. All 50 tests in
   `test/cli/lint.test.ts` pass.

2. **`src/server/config.ts:85-86`** — "25 tasks cannot cover all 58 RHCSA
   objectives" → "5 shipped tasks cannot cover 68 RHCSA objectives — 58 are
   uncovered today". I did not take these numbers on the dispatch's word alone: I
   ran `node src/cli/index.ts coverage --content content` myself and it printed
   `tasks: 5`, `concepts: 10`, `objectives: 68`, `uncovered objectives: 58` —
   matching exactly. Reasoning and the refuse/log split left untouched, only the
   quantifiers changed, sentence not deleted.

3. **`src/engine/disclosure/ladder.ts:33`** (`RUNGS`) and
   **`src/engine/validate/expectations.ts:10`** (`PHASES`) — added an
   exhaustiveness assertion beside each ordered array, did **not** convert either
   array to `Record<Union, true>`:
   - `ladder.ts`: `const _rungsExhaustive: Record<Rung, true> = { 1: true, 2: true, 3: true, 4: true, 5: true }`,
     with a comment naming why `RUNGS` stays an array (order load-bearing at
     `server/app.ts:279`, `RUNGS.map((r) => rungContent(r, ctx))` building the
     disclosure list served to the client).
   - `expectations.ts`: `const _phasesExhaustive: Record<ExpectPhase, true> = { pre: true, post: true, both: true }`.
   - **Which assertion trips, measured, not asserted from memory:** I added a 6th
     `Rung` member to the union in a scratch edit and ran `tsc --noEmit` — it
     failed at `_rungsExhaustive`'s line with `TS2741: Property '6' is missing in
     type '{ 1: true; ...; 5: true; }' but required in type 'Record<Rung, true>'`
     (plus a second, expected error on `NEXT_RUNG` two lines down — an existing
     `Record<Rung, Rung | undefined>` that was already exhaustive before this
     change). I reverted the mutation before moving on (`git diff --stat` on the
     file came back to only my intended 10-line addition). Same experiment on
     `ExpectPhase` (+`'extra'`) failed at `_phasesExhaustive` with the analogous
     `TS2741`, and I reverted that one too.
   - **Concern, stated because I found it, not because I was asked to look**:
     the brief and commit `3670925`'s message both assert "both are ordered
     arrays whose order is load-bearing at `server/app.ts`" for `RUNGS` **and**
     `PHASES` together. I checked: `PHASES` has exactly one call site,
     `isPhase`'s `PHASES.some((p) => p === v)`, which is order-independent, and
     `grep -rn "ExpectPhase\b"` outside `expectations.ts` returns nothing — there
     is no second consumer that could depend on its order. `PHASES`'s order is
     not load-bearing anywhere I can find. I did not repeat the shared-reason
     claim; the comment I wrote for `PHASES` says its order carries no meaning and
     that it stays an array for consistency with `RUNGS`, not because it needs the
     ordering guarantee itself. This is the same class-3 shape the rest of the
     dispatch is about (a citation proving something adjacent to its claim) and it
     predates me — it is in commit `3670925`'s own message, unchanged since. I did
     not fix that commit message; flagging it here since the review told me to
     surface anything I believe is wrong.

4. **`src/server/session.ts:542-543`** — "comparing sizes would fail every grader
   in the bank" → "would fail 2 of the 5 graders in the bank today, and any
   future grader with a baseline-passing invariant". I re-derived the per-grader
   emitted/declared counts myself from `rhcsa lint`'s own inventory output
   (`emits:` vs. the union of `baseline-fail:` + `unprobed-invariant:` per
   grader) rather than transcribing the dispatch's table, and got the same
   result: `014-grow-home-lv` 5 emitted / 3 declared (fails), `017-boot-time-service`
   5/4 (fails), `019-httpd-alt-port` 8/8 (equal), `028-restore-remote-access` 5/5
   (equal), `006-team-provisioning` 8/8 (equal) — 2 of 5 fail. Sentence and
   surrounding reasoning otherwise untouched.

5. **`src/server/session.ts:544-545`** — dropped the stale count. "(measured:
   exit 1, 9 problems)" → "(measured: exit 1)". Did not transcribe the reviewer's
   re-measured 15 either, per the instruction. I re-ran the reproduction myself in
   a `/tmp` copy (injected `cat <<NOPE` after the first `ck` in
   `content/tasks/selinux/019-httpd-alt-port/grade.sh`, ran
   `node src/cli/index.ts lint --content <copy>`) and got exit code **1** —
   confirming the one word I kept, from my own measurement, not the reviewer's.
   Temp copy deleted after.

6. **`test/web/app.test.tsx`** — added
   `withholds the rating on countDisputed alone, with incomplete and the total
   both clean`, driving `report.countDisputed: true` with `incomplete: false` and
   `total === expectedTotal`, asserting the same withheld-rating copy the
   `incomplete: true` test already asserts. Verified by mutation, not just by
   passing: I removed `report.countDisputed` from the `reportUntrustworthy`
   disjunct in `src/web/App.tsx:232` (mutant M10) and reran
   `test/web/app.test.tsx` — the new test failed (`getByText(/checkpoint count
   could not be trusted/)` not found) while the other 5 tests in the file stayed
   green, so the kill is attributable to this test alone. Reverted the mutant
   (`git diff --stat src/web/App.tsx` empty afterward). No source change to
   `App.tsx` in the final diff — item 6 is test-only, as the brief specified.

## Gates (rerun at my working tree, all four)

- `npm run typecheck` — exit **0**.
- `npx vitest run` — **35 files / 464 tests / 0 skipped**, exit **0**.
  (462 baseline + 2 new tests: the `&&` lint test and the `countDisputed`
  app test.) Skip count checked directly: `grep -cE 'skipped|todo'` over
  captured stdout is 0.
- `npm run build:web` — exit **0**, same pre-existing >500 kB chunk warning as
  baseline, nothing new.
- `npm run lint:content` — exit **0**, "no problems in 5 grader(s)", **3 notes**
  (`home-from-lv`, `persist-config` in 014; `default-target` in 017) — identical
  to the baseline set, in the same tasks.

## Concerns

- The `RUNGS`/`PHASES` shared-reason claim in commit `3670925`'s message (item 3
  above) — `PHASES`'s order is not actually load-bearing anywhere I could find,
  only `RUNGS`'s is. I wrote an accurate, per-array comment rather than repeat the
  claim, but did not edit the commit message itself (out of scope for a working-tree
  fix) or the final-rereview document.
- Everything else in the brief and the review held up under my own
  re-measurement: the config.ts numbers (5/10/68/58, via `rhcsa coverage`), the
  session.ts grader containment counts (2 of 5 fail, via `rhcsa lint`'s own
  inventory), and the deflation exit code (exit 1, via my own `/tmp` reproduction).
  I found no other numeric or citation error while touching these files.

## Commit

`3b26a65843c9fa17652b2ceeae79bf0b136aafa2`, staged by name (no `-A`, no `-a`),
identity inline as specified in the brief. `git status --porcelain` is empty at
HEAD after the commit.

Files touched: `src/cli/lint.ts`, `src/engine/disclosure/ladder.ts`,
`src/engine/validate/expectations.ts`, `src/server/config.ts`,
`src/server/session.ts`, `test/cli/lint.test.ts`, `test/web/app.test.tsx`.
