# Re-review of fix-c — commit `6e99c3e..3b26a65`

Scope: exactly this one commit, `3b26a65`, 7 files (per `review-6e99c3e..3b26a65.diff`).

## Verdict: APPROVED

## Method

Copied the tree at `3b26a65` via `git archive 3b26a65 | tar -x -C /tmp/rereview-c-tree`,
symlinked `node_modules` back, ran all mutation tests and gates there. Never touched the
shared working tree. All mutants reverted and diffed byte-identical against `git show
3b26a65:<path>` before moving to the next. Original repo confirmed untouched throughout
(`git status --porcelain` empty, `HEAD` = `3b26a65`) and again at the end. Temp tree and
logs deleted after use. No `phase-1` tag exists; none created.

## Item-by-item

1. **`lint.ts` regex, `SHELL_OPTION_LINE = /^set\s+[-+][^;&|]*$/`.** `MEASURED` (direct
   regex execution, not just the test suite): `set -euo pipefail && sudo lvextend -L 12G
   /dev/rhel/home` → no match (not flagged); the `||` form → no match; the bare `;` form →
   no match; a genuine no-op (`set -euo pipefail` alone) → still matches (still flagged).
   Also ran `test/cli/lint.test.ts` directly: 50/50 pass, including the new `&&` test, the
   pre-existing `;` test, and `rhcsa lint on the shipped bank > exits 0...` plus `lint
   enforces the fixture floors...> passes the shipped bank, so these rules are a floor
   under today's content` — the property that the rule fires on none of the anti-solutions.
   Counted anti-solution files directly: `find content/tasks -iname '*.sh' -path
   '*antisolutions*' | wc -l` → **16**, matching the claim. No over-widening: the no-op
   fixture is still caught, so this closes the false-fail (loud) direction without opening
   a false-pass on the bank.

2. **`ladder.ts`/`expectations.ts` exhaustiveness assertions.** `MEASURED` by mutation: set
   `Rung = 1|2|3|4|5|6` and `ExpectPhase = 'pre'|'post'|'both'|'extra'`, ran `npx tsc
   --noEmit` directly (not via npm script) → exit 2, with `TS2741: Property '6' is missing
   ... required in type 'Record<Rung, true>'` at `ladder.ts:43` (`_rungsExhaustive`) and a
   second, expected error at `ladder.ts:58` on the pre-existing `NEXT_RUNG: Record<Rung,
   Rung | undefined>`; and `TS2741: Property 'extra' is missing ... required in type
   'Record<ExpectPhase, true>'` at `expectations.ts:18` (`_phasesExhaustive`). Both
   assertions trip as claimed. Reverted both mutations; `diff` against `git show
   3b26a65:<path>` for both files came back empty (byte-identical). Confirmed `RUNGS` was
   **not** converted to a record (`export const RUNGS: readonly Rung[] = [1, 2, 3, 4, 5]`,
   unchanged) and its element order is unchanged. Confirmed the load-bearing consumer:
   `grep -n RUNGS src/server/app.ts` → line 279, `const all: RungContent[] =
   RUNGS.map((r) => rungContent(r, ctx))` — exact line the report cites, order-dependent.

3. **`config.ts` — "5 shipped tasks... 68 RHCSA objectives — 58 are uncovered today".**
   `MEASURED`: ran `node src/cli/index.ts coverage --content content` myself → `tasks: 5`,
   `concepts: 10`, `objectives: 68`, `uncovered objectives: 58`. Matches exactly.

4. **`session.ts` — "would fail 2 of the 5 graders in the bank today".** `MEASURED`,
   re-derived independently from `rhcsa lint`'s own inventory output rather than trusting
   either report's table: per grader, emitted count vs. the union of `baseline-fail:` +
   `unprobed-invariant:` declared ids —
   - `014-grow-home-lv`: emits 5 (`fs-home-size, home-from-lv, lv-home-size,
     persist-config, var-intact`), declared union 3 (`fs-home-size, lv-home-size,
     var-intact`) → **fails**.
   - `017-boot-time-service`: emits 5, declared union 4 (missing `default-target`) →
     **fails**.
   - `019-httpd-alt-port` (confirmed at `content/tasks/selinux/`, not `system/`): emits 8,
     declared union 8 → equal.
   - `028-restore-remote-access`: emits 5, declared union 5 → equal.
   - `006-team-provisioning`: emits 8, declared union 8 → equal.
   2 of 5 fail. Matches the sentence exactly.

5. **`session.ts` — the stale "9 problems" is gone, not replaced.** `MEASURED`: the
   sentence at `session.ts:544-545` now reads "(measured: exit 1)" with no count. I
   independently reproduced the deflation from scratch (own copy of `content/`, own
   `cat <<NOPE` injection after the first `ck` in `019-httpd-alt-port/grade.sh`, own run of
   `node src/cli/index.ts lint --content <copy>`) and got **exit 1, 15 problem(s)** —
   matching `final-rereview.md`'s own re-measurement (15 problems, 3 notes), and confirming
   the "exit 1" half of the retained sentence reproduces today. Per the dispatch's explicit
   ruling (the number goes stale every round because lint's own rules changed this round),
   dropping the count entirely rather than substituting 15 is correct; substituting a new
   count would have been a finding, and it did not do that.

6. **`app.test.tsx` — new `countDisputed`-alone test.** `MEASURED` by mutation: removed
   `report.countDisputed` from the `reportUntrustworthy` disjunct at `App.tsx:232` (mutant),
   ran `npx vitest run test/web/app.test.tsx` → 1 failed / 5 passed: the new test
   (`withholds the rating on countDisputed alone...`) failed, all 5 neighbours (including
   the other rated-mode and guided-mode tests) stayed green. Kill is attributable to this
   test alone. Reverted; `diff` against `git show 3b26a65:src/web/App.tsx` empty.

## `expectations.ts:13-17` comment — judgement: TRUE

Checked independently, not on the report's word: `grep -rn "PHASES\b" src/ test/` returns
only the declaration, the new comment, and `isPhase`'s `PHASES.some((p) => p === v)` — no
other reference anywhere in the tree. `grep -rln "ExpectPhase" src/ test/` returns only
`expectations.ts` itself — no second consumer of the type exists that could depend on
`PHASES`'s order. `.some()` is a pure membership test; its result does not depend on array
order. So the comment's claim — "`PHASES`' own order carries no meaning... unlike `RUNGS`"
— is true, and it correctly does not repeat commit `3670925`'s message's broader claim that
both arrays are load-bearing for order. This is the fix-c-report's own finding; I confirm it
independently rather than deferring to it. No further action needed — amending `3670925`'s
message is out of scope and has been ruled against.

## Gates (rerun in the isolated copy at `3b26a65`, all four)

- `npm run typecheck` → exit **0**.
- `npx vitest run` → **35 files / 464 tests / 0 skipped**, exit **0** (confirmed no
  skip/todo markers: `grep -icE 'skip|todo'` over captured stdout → 0; re-ran again after
  all mutation reverts, same 35/464/0).
- `npm run build:web` → exit **0**; same pre-existing >500 kB chunk warning
  (`dist/assets/index-*.js 745.75 kB`), nothing new.
- `npm run lint:content` → exit **0**, "graders checked: 5" / "no problems in 5 grader(s)",
  **3 notes** (`home-from-lv`, `persist-config` on `014-grow-home-lv`; `default-target` on
  `017-boot-time-service`) — matches the expected baseline exactly.

All four match the expected results stated in the dispatch.

## Tree state

`git status --porcelain` empty, `HEAD` = `3b26a65843c9fa17652b2ceeae79bf0b136aafa2`, no
`phase-1` tag, confirmed both before starting and after finishing. No commits, no pushes, no
VM operations, no `.env*` reads.

## My own findings

None. Every sentence this commit touches was re-measured independently (not transcribed
from either the dispatch or fix-c's report) and reproduced exactly as claimed. No direction
reversal found on any of the six items; no new false-pass, false-fail, or adjacent-citation
introduced by this commit.
