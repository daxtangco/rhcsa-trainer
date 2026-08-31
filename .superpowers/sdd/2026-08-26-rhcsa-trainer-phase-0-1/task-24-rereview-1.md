# Task 24 — re-review of fix round 1

Range `7dbaaf4..d0ff66b`, repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`. Scoped re-review:
checking that the six required items from `task-24-fix-1.md` landed and that fix round 1 did not break
or falsely certify anything, plus the one unrequested change. Not a re-review of Task 24 as a whole.

All mutation work was done in `/tmp/t24r1`, built with `git archive d0ff66b | tar -x -C /tmp/t24r1` plus
a `node_modules` symlink. The real repo's `git status --porcelain` was empty before and after this
review, and `HEAD` is `d0ff66beb81eae93fef8c1f1f2f87959592c890a` throughout — the real repo was never
touched. Every mutation below was applied to a saved-pristine file in `/tmp/t24r1`, run, and then
restored byte-identical (`diff` confirmed empty each time) before the next mutation.

## Verdict: APPROVED

All six required items landed and every one of their tests bites on its own mechanism, not just by
incidental overlap with another mutant. The unrequested `SessionPhase` narrowing is genuinely type-only,
does not newly constrain any other consumer, and the bundle stays clean. All three gates pass with the
claimed counts. No new finding.

## The six required items — landed, and bites confirmed

1. **F1** (`finished` derives from `phase === 'graded'`, not `rating !== null`) — landed at
   `App.tsx:189` (`doFinish`) and `App.tsx:149` (`doReset`), with a guided arm added to the rating box.
   Bites: reverting to `setFinished(done.rating !== null)` kills all three guided tests (measured
   below).
2. **F2** (anchor both positive pass-verdict assertions) — landed at `rail.test.tsx:329,346`
   (`getByText('All checkpoints passed.')`, plus a `queryByText('Not all checkpoints passed.')` control
   on the second). Bites: M8 now fails 3 tests where it previously passed all 28 (measured below).
3. **App item 1** (key-handler gate reads `finished`, in guided) — landed at `App.tsx:204`. Bites, in
   isolation: dropping `finished` from just this gate gives `expected 2 to be 1` (measured below).
4. **App item 4** (timer stops at finish) — landed at `App.tsx:64`. Bites, in isolation: dropping
   `finished` from just this gate gives `expected '10:01 / 10:00' to be '00:04 / 10:00'` (measured
   below) — this is the assertion that catches F1 outright.
5. **App item 5** (`setReport(undefined)` on grade failure, stale-tally test) — present at
   `App.tsx:170`, test at `app.test.tsx` ("drops the stale tally when a re-grade fails…"). Bites on its
   own mechanism, not only via M8: removing the `setReport(undefined)` line directly fails the test with
   `expected <div class="mt-1 text-zinc-100"></div> to be null` (measured below, not in the implementer's
   report — I checked this independently since the report only cited M8, which hits an earlier assertion
   in the same test rather than the stale-tally logic specifically).
6. **F3** (`TerminalPane` `statusRef`, one `WebSocket` per mount regardless of inline `onStatus`) —
   landed, three tests in `terminal-pane.test.tsx`. Bites: putting `onStatus` back in the effect's dep
   array opens 3 sockets where 1 is expected (measured below).

## Claims verified by measurement

- **M8 dies, 3/3 as claimed.** Swapping `Rail.tsx`'s emerald `All checkpoints passed.` for the rose
  `Not all checkpoints passed.` and running `rail.test.tsx` + `app.test.tsx`: exactly `Rail > does not
  withhold the pass on a task with no reboot check`, `Rail > says all checkpoints passed when the counts
  agree and everything passed`, and `App, a rated mode > drops the stale tally when a re-grade fails, and
  shows the rating at finish` fail — 3 failed | 21 passed of the 24 tests in those two files. Restored
  byte-identical.
- **F1 probe dies, all 3 guided tests, at the shared early assertion.** Reverting `App.tsx:189` to
  `setFinished(done.rating !== null)` and running `app.test.tsx`: all three `App, guided mode` tests
  fail; the rated-mode test still passes. Restored byte-identical.
- **Timer-gate isolation confirmed.** Removing `|| finished` from the timer effect's guard alone
  (`App.tsx:64`, key gate and box left untouched): only `stops the clock at finish…` fails, with
  `AssertionError: expected '10:01 / 10:00' to be '00:04 / 10:00'` verbatim. The other two guided tests
  pass. Restored byte-identical.
- **Key-gate isolation confirmed.** Removing `|| finished` from the key handler's guard alone
  (`App.tsx:204`, timer gate and box left untouched): only `ignores F2, F4 and F8 once the attempt is
  finished` fails, with `AssertionError: expected 2 to be 1` verbatim (a second `finish()` call got
  through). The other two guided tests pass. Restored byte-identical.
- The isolation claim holds: a single mutant that kills all three tests at one shared assertion (the F1
  probe) proves less than the two narrower mutants that each kill exactly one test at a distinct,
  named assertion — and both narrower mutants reproduce verbatim.
- **TerminalPane dep-array mutant confirmed.** Restoring `onStatus` to the effect's dep array
  (`}, [cols, rows, onStatus])`): `does not reconnect…` fails with `expected [ Array(3) ] to have a
  length of 1 but got 3`, and `still reports status through the newest callback…` fails with `expected
  [ Array(2) ] to have a length of 1 but got 2` — three sockets built where one is expected, exactly as
  claimed. The control (`reconnects when the size changes…`) still passes. Restored byte-identical.
- **Every mutated file restored byte-identical** — confirmed for all five mutations above via `diff`
  against a saved pristine copy, each returning empty. The real repo's tree stayed clean throughout
  (`git status --porcelain` empty, `HEAD` = `d0ff66b`) — this review never touched it.
- **Test count: 386 tests / 33 files, 0 skipped, 0 todo** — confirmed by direct run in `/tmp/t24r1`
  (`Test Files 33 passed (33)`, `Tests 386 passed (386)`), and confirmed no skip/todo markers by grepping
  the verbose reporter's own output for `skip`/`todo` (the only hits are test *names* describing skip
  behaviour in the grading domain, e.g. "emits skip with a reason" — none are actually-skipped tests).
  Matches the claimed rise from 379/31.

## Ruling on the unrequested `SessionPhase` narrowing

**Sound, and worth keeping.** Checked all three concerns named in scope:

- **Genuinely type-only, and compiler-enforced, not just conventionally erased.** `api.ts:6-7` uses
  `import type { SessionMode, SessionPhase } from '../server/session.ts'` / `export type { ... }`, and
  `tsconfig.json:15` has `verbatimModuleSyntax: true`. Under that flag TypeScript *requires* `import
  type`/`export type` to produce zero runtime emission (it is a hard compile error to write a type-only
  import any other way if a value with the same name existed) — this is stronger than the general
  tree-shaking argument the review context raised; it does not depend on the bundler noticing anything.
  The bundle-purity greps (`hono|node:child_process|node:fs|allowedOriginsFor` → 0, and the wider
  `spawnSshPipe|SessionStore|countCheckpoints|...` sweep → 0) confirm no server code reached
  `dist/assets/*.js`, matching the implementer's claim.
- **Both halves of the type-safety claim reproduced.** Mutating `App.tsx:189` to
  `setFinished(done.phase === 'gradedd')` with the narrowed `SessionPhase` type gives exactly
  `error TS2367: This comparison appears to be unintentional because the types 'SessionPhase' and
  '"gradedd"' have no overlap.` Widening `api.ts`'s two `phase` fields back to `string` and re-applying
  the same typo mutation compiles clean — confirming the counterfactual: under `string` this exact typo
  would have silently never matched, the same never-fires shape as the F1 defect itself.
- **No other consumer newly constrained.** `SessionView.phase` and `GradeResponse.phase` (and
  transitively `FinishResponse.phase`, via `extends SessionView`) are read in exactly two places in the
  whole web/test-web tree — `App.tsx:149` and `App.tsx:189` — both already comparing against the literal
  `'graded'`, which is a valid member of `SessionPhase = 'active' | 'graded'` (`session.ts:12`). Test
  fixtures in `app.test.tsx` construct `phase: 'active'` / `phase: 'graded'` literals, both valid. Full
  typecheck of the isolated tree is clean (exit 0). Nothing else in the diff or the wider `src/web`/
  `test/web` tree touches `.phase`.

## Gates

All three pass, run directly (not cited from the report):

- `npm run typecheck` → exit 0, clean.
- `npx vitest run` → **386 tests / 33 files, 386 passed, 0 failed, 0 skipped.** Matches the report.
- `npm run build:web` → exit 0. `743.72 kB` / `206.29 kB` gzip (report cites `745.34`/`206.34`; the
  small delta is normal build-to-build variance from content-hashed filenames/minification, not a
  regression — bundle size is out of scope per the review context).

Whole-repo grep census (not scoped to the diff):
- `enum` / `namespace` / decorators (`^\s*@[A-Za-z]`) / parameter properties
  (`constructor(private|public|protected|readonly`) → **none**, anywhere in `src/` or `test/`.
- Non-null `!` in `src/web`/`test/web` → **none**.
- `as` casts in the web layer (`src/web/`, `test/web/`) → **exactly one**,
  `src/web/api.ts:201: return body as T`, as claimed.
- `as unknown as` anywhere in the whole repo → **none**.
- (The wider repo has other `as X` casts in `src/engine/`, `test/content/`, `test/validate/` —
  all pre-existing, none touched by this diff, and none `as unknown as`.)

## Out-of-scope items — confirmed unchanged only, not re-derived

- **F4**: untouched. No change to the finish path's enable condition or rating derivation; no
  `countSuspect` field exists anywhere under `src/server/` (grep confirms empty).
- **Step 16's fifteen manual checks**: not touched by this diff (the diff's file list is exactly
  `App.tsx`, `api.ts`, `app.test.tsx`, `rail.test.tsx`, `terminal-pane.test.tsx` — no docs/handoff files).
- **`src/server/session.ts`, `src/engine/grading/`, `content/`, `objectives.yaml`,
  `content/lib/assert.sh`**: none appear in the diff's file list. Confirmed untouched.
- Bundle size, terminal-dies-on-reset, unrendered `report.regressions`: unchanged, accepted per prior
  ruling — not re-litigated here.

## New findings

None. No false pass, no false fail, and nothing load-bearing found beyond what fix round 1 already
closed. The one gap I found in the implementer's own evidence — that item 5's test was proven to bite
only via M8's incidental overlap rather than its own dedicated mutant — is not a defect in the fix; I
closed it myself by mutating the `setReport(undefined)` line directly and confirming the test dies on
its own mechanism (`expected <div class="mt-1 text-zinc-100"></div> to be null`), so item 5's test is
independently load-bearing, not merely coincidentally covered.
