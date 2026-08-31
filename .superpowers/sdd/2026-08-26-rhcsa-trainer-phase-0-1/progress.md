# SDD ledger — plan: docs/superpowers/plans/2026-08-26-rhcsa-trainer-phase-0-1.md

Spec: docs/superpowers/specs/2026-08-26-rhcsa-lab-trainer-design.md (read; binding authority)
Repo: /home/daxtangco/rhcsa-trainer
Branch: phase-0-1 (created from master @ 6791d4d)

## Setup rulings

Ruling: work on branch `phase-0-1` in the primary checkout, not a separate git worktree
  — why: the plan contains ~50 literal `cd /home/daxtangco/rhcsa-trainer` commands, and
    the VM config it depends on (`.env.local`, `~/.ssh/rhcsa_lab`, the vmrun VMX path)
    is tied to that directory. A worktree would silently break every acceptance step.
  — cost if wrong: none material; a branch is still isolated from master and can be
    rebased or squashed.

Ruling: execute tasks in plan order 1 -> 24, implementing each task's code and content
  in full, and skipping ONLY the acceptance steps the plan itself marks as needing the
  RHEL 9 VM. Task 25 ends the run because it is nothing but a VM acceptance.
  — why: the plan's own blocker table says T17, T18 and T20 are "written and unit-tested
    against fakes now, with a clearly marked acceptance step deferred until the VM
    exists". T23 imports `chooseTransport` (T18) and `VmController` (T17), so skipping
    those tasks entirely would make T23 unbuildable. Plan order keeps producers ahead of
    consumers.
  — cost if wrong: content authored in T21/T22 goes unvalidated until the ISO lands, so a
    grader bug could sit undiscovered. Mitigated by validating every grader against
    `FakeTransport` where the plan already provides fixtures, and by collecting the
    deferred acceptance commands into one list at the end.

## Deferred acceptance (needs the RHEL 9 VM — user-gated)

(appended as tasks complete)

## Pre-flight conflict scan

Run as three parallel opus slices over the whole 11,653-line plan. Each slice was
required to produce rows, not a verdict: one row per pair of tasks sharing a file or
an interface (producer's output against consumer's expectation), and one row per task
for internal self-agreement (the tests it specifies against the code it specifies, the
files it creates against the files it later touches). Reports:

- `preflight-1-14.md`     — Tasks 1-14 (no VM). 16 findings: 4 high, 3 medium, 9 low.
- `preflight-15-22.md`    — Tasks 15-22 (the VM). 19 findings: 7 high, 6 medium, 6 low.
- `preflight-23-25-crosscut.md` — Tasks 23-25 + cross-cutting. 27 findings:
                            4 critical, 8 high, 9 moderate, 6 low.

Each report also carries an "explicitly checked and correct" list, so items already
cleared are not re-litigated during execution.

**62 findings total. All 62 ruled before Task 1 was dispatched.** The full rulings —
one per finding, each with its reasoning and its cost-if-wrong — are in `rulings.md`
in this workspace. Summary:

- 51 ruled ACCEPT-AS-DIAGNOSED: the plan was factually wrong (a wrong count, a wrong
  argv index, a missing import, a stale file list) and there was nothing to weigh.
- 10 needed a judgment call (rulings.md section B). One is a **rejection**: S3-F13
  wanted `--watch` restored to `dev:server`. Ruled that it stays dropped, because a
  restart drops the WebSocket terminal and the in-memory session store mid-lab.
- 2 findings were reported independently by two slices, which is the strongest signal
  in the scan. Both are architectural, and both are ruled in rulings.md section C.

Ruling: `countCheckpoints`' regex AND its stated counting rule are both wrong; fix both
  — why: the regex matches a bare `ck ` call only, but Task 21's real grader emits
    exclusively through `ck_pass`/`ck_fail`, from 12 call sites covering 5 ids. Widening
    the regex alone would then return 12. Tasks 23, 24 and 25 all assert the masked total
    is 5. Task 23's own unit fixture uses bare `ck`, so the unit test passed and nothing
    caught it — the fixture is complicit and gains a second case in Task 21's real style.
  — cost if wrong: the Lab screen's masked checkpoint count is wrong, which is the one
    number the user calibrates their confidence against during a timed attempt.

Ruling: grant `student` passwordless sudo in the guest via a validated
  `/etc/sudoers.d/rhcsa-trainer` drop-in installed by `guest-provision.sh`, and correct
  the Global Constraint claiming "the transports already run as root inside the VM"
  — why: that claim is false as implemented. Task 15 declines root SSH and only adds
    `student` to `wheel`; both transports connect as `student`; RHEL 9's default
    `%wheel ALL=(ALL) ALL` asks for a password; there is no TTY. Worse, guest-side
    scripts arrive on ssh's stdin, so sudo's prompt would eat the rest of the script and
    the failure would present as a broken grader. This is the only finding in the scan
    that would have shipped a system where **correct student work grades as failure** —
    on every task in the bank. Tasks 19-22 could not have passed a single fixture.
    Rejected alternatives: root SSH (Task 15 declined it for good reason) and
    authenticating sudo over stdin (impossible — the script *is* stdin).
  — cost if wrong: a local, disposable, credential-free lab VM has one unprivileged
    account that can become root without a password, and it is reverted to a snapshot
    between labs. The real exam hands you the root password outright.

Three spec-coverage gaps the scan surfaced were also ruled, since a plan that drops a
spec deliverable silently is worse than one that defers it out loud:
- spec section 16 Phase 0's exam duration / passing score constants had no owning task
  -> Task 9 now creates `src/engine/exam/limits.ts`, marked unconfirmed pending the
  user's Phase 0 check.
- spec section 16 P1's `reset` control existed in `LabRuntime` with no route and no
  button -> Task 23 gains `POST /api/sessions/:id/reset`, Task 24 gains the button.
  Reset deliberately does NOT reset the rung, or resetting becomes a way to launder hints.
- spec section 7.1's per-task `explanation.md`, spec section 11 rule 1's VM-state
  indicator, and spec section 14.4's `weight` scheduling are deferred to Phase 2 and now
  appear as stated limits in `docs/exit-criterion.md`, not as orphaned filenames.

No task was added, removed, split or reordered. The 25-task sequence stands.
Plan amendments applied on branch `phase-0-1`; see `plan-amendment-report.md`.

### Rulings corrected during amendment (rulings.md section E)

The agent applying the 62 amendments found that two of my own rulings were wrong.
Both re-ruled and fixed in commit 041977b:

Ruling: S3-F25 re-ruled — `MAX_SPARE_DISKS = 3` stays; the prose stops claiming disks
  are attached
  — why: the scan's premise was false in both directions. Spec section 4.1's VM design
    has three spare disk slots, Task 19 deliberately attaches ZERO in Phase 1 (already
    justified in the plan: a spare disk with stale partition tables makes later exercises
    non-deterministic), and Task 3's comment said three. Applying the scan's fix literally
    produced a worse sentence than the one it replaced. The cap is a schema bound from the
    spec, not a claim about the running VM — a task declaring `requires_disks: 2` is
    well-formed content Phase 1 cannot host, and that is the right distinction for a
    loader to draw. Tightening the cap to 0 would reject valid Phase 2 content at parse
    time and force edits to Task 3's test and five fixtures to buy nothing.
  — cost if wrong: a Phase 2 task could declare a disk the VM lacks and fail at runtime
    rather than at validation. Task 19's provisioning is where that belongs.

Ruling: S3-F9 re-ruled — restore `LabRuntime.gradeTask` to Task 23's Produces block
  — why: my ruling deleted a method that exists and that `app.ts` calls. I treated the
    scan's list of what was wrong as a complete list of what was there. Two of its three
    claims held (`runSetup` never existed, `exec` was undocumented); `gradeTask` was never
    spurious. A Produces block that omits the method doing the actual grading is worse
    than one naming a method that does not exist, because Tasks 24 and 25 plan against it.
  — cost if wrong: none; this is a correction to a correction.

Three deviations the agent reported were accepted as applied: the reset route is
`/api/sessions/:id/reset` (plural, matching its five siblings, beating my prose); the four
surviving `require(` hits are `#require(`, a private method of `SessionStore`, not
CommonJS; and S3-F24's sshd-race guard also had to wrap `controller.reboot`, because
`guestUp()` polls guest tools via vmrun there too — verdict B's reboot had the identical
unguarded race, and a 500 on that path reads as a persistence failure.

## Task log

BASE for Task 1: 041977b (plan amendments complete; no source code exists yet)

- Task 1 dispatched (sonnet): project scaffold. Brief carries the four amended defects
  with explicit "do not correct these back" notes, since three of them look like bugs.

## Environment verified 2026-08-28
- node v22.23.2 (Global Constraint floor: >= 22.23.2) OK
- npm 10.9.8; `node --env-file-if-exists` supported OK
- repo clean: only .gitignore + docs/ tracked; Task 1 scaffolds everything
- added `.env.local` and `.superpowers/` to .gitignore (workspace must not be committed)
- all 25 task briefs extracted to this workspace

## Incident log
- 2026-08-28: first pre-flight scan agent (opus, whole plan) died mid-run:
  "The SSO session associated with this profile has expired." Transient — a
  probe dispatch succeeded immediately after. Re-dispatched the scan as three
  smaller parallel jobs (1-14, 15-22, 23-25+cross-cutting) so a repeat expiry
  costs one slice instead of the whole scan.
- Task 1: complete. ce3b225 "chore: scaffold Node 22 + TypeScript + vitest, no build step".
  2/2 tests pass, typecheck silent, erasable-syntax guard fires TS1294 on `enum` (exit 2).
  Review: spec APPROVED, quality APPROVED, zero findings; reviewer re-ran both commands
  and reproduced the report's output exactly, and confirmed all four pre-ruled
  non-defects survived (engines.node >=22.18.0, the mkdir/rmdir bracket, `npx --no`,
  the filename-based vm gate). No fix rounds.
- Task 2 dispatched (sonnet): LabTransport + FakeTransport. BASE ce3b225.
- Task 2: complete. 23b0340 "feat(vm): add LabTransport interface and FakeTransport".
  7/7 pass, typecheck clean. Review: spec APPROVED, quality APPROVED, zero findings.
  Reviewer checked every declared name against the brief (ExecResult, LabTransport,
  TransportKind, FakeHandler, FakeTransport ctor + `calls`, ContentError) because seven
  later tasks write against them, re-ran both commands, and confirmed the RED was genuine.
  Both settled non-defects survived. No fix rounds.
- Task 3 dispatched (sonnet): TaskSpec loader. BASE 23b0340.
- Task 3: complete. a70d166 "feat(content): add TaskSpec loader with aggregating validation".
  11/11 pass, typecheck silent. Review: spec APPROVED, quality APPROVED, zero findings.
  The reviewer attacked the aggregation property specifically — no short-circuit path, no
  spurious problems on valid input — and independently invoked `loadTask` against the
  `bad` fixture outside the test runner, counting 12 problems itself rather than trusting
  the report. Both settled non-defects survived. No fix rounds.

  Ruling: park the reviewer's two non-blocking notes rather than opening a fix round
    — the notes: the brief's defaults test does not assert `requiresDisks` defaults to 0
      on omission (the implementation does default it correctly), and the
      scope/weight/transport checks cast via `as string` before `.includes` instead of a
      `typeof` guard.
    — why: both trace to the brief, which the implementer copied verbatim as instructed,
      and neither can produce a wrong result — the cast feeds `.includes` on a
      `readonly string[]`, which is false for any non-string, so the problem is still
      pushed. A fix round costs an implementer resume plus a scoped re-review to buy a
      test assertion for behaviour three later tasks exercise anyway.
    — cost if wrong: if the `requiresDisks` default ever regresses, Task 7 or Task 21
      catches it instead of Task 3, one task later.
- Task 4 dispatched (sonnet): ConceptSpec loader. BASE a70d166.
- Task 4: 37f8d7a "feat(content): add ConceptSpec loader with a body-length floor",
  15/15 pass, typecheck silent. Implementer reported DONE and flagged one concern itself.

  Ruling: the flagged concern is a real defect and gets fixed, against the brief that
  mandated it. `concept.ts` guards the empty-objectives check with
  `objectives.length === 0 && Array.isArray(fm.objectives)`, so an *omitted* `objectives`
  key passes validation silently, while Task 3's `task.ts` catches omission.
    — why: a concept with no objectives is unreachable. The disclosure ladder finds
      concepts by the current task's objective ids, so a forgotten front-matter key
      produces a card that is authored, validated, committed and then never shown to
      anyone — surfacing to the user as "the app taught me nothing on that task", which
      is the exact failure the length floor and this validator exist to prevent. Task 4's
      dispatch also told the implementer to match Task 3's idiom, and this diverges from it.
    — the fix is NOT simply dropping the guard: the guard does prevent double-reporting
      when `objectives` is present but not an array, since `stringArray` has already
      pushed "must be a list of strings". Correct condition:
      `if (fm.objectives === undefined || (Array.isArray(fm.objectives) && objectives.length === 0))`
      plus a test for the omitted-key case.
    — cost if wrong: one extra problem message on a mistyped `objectives` field.

  Review (sonnet): spec CHANGES REQUESTED, quality APPROVED. The reviewer independently
  reproduced the omission bug, patched a scratch copy with my proposed condition and ran it
  against omitted / explicit-[] / non-array / valid inputs plus all three fixtures, and
  confirmed the fix is correct and complete with no double-count and no fixture disturbance.
  It also re-derived `bad.md`'s problem count (5) with a standalone script rather than
  trusting the test. Two further findings, both non-blocking:

  Ruling: fix finding 3 in the same round — add the `isRecord` guard on `gray-matter`'s
  `parsed.data` (concept.ts:155), matching `task.ts`
    — why: without it a concept file whose front matter is not a mapping degrades to four
      "missing field" problems instead of one accurate one. Not a wrong result, but the
      author is told four things are missing when the real defect is that the front matter
      is malformed — and these loaders are the only feedback a content author gets. Fixing
      it costs one guard in a round that is already open.
    — cost if wrong: none; the guard cannot admit input the current code rejects.

  Ruling: park finding 2 — `MIN_BODY_CHARS` stays a raw character floor, and the fact that
  120 characters of filler would pass it is recorded as a stated limit, not fixed
    — why: the floor exists to catch the empty or stub card, which is the mechanical failure
      a loader can detect. "Does this card actually teach the objective" is a judgment no
      character count can make, and inventing a proxy for it (keyword lists, command counts)
      would reject good short cards and admit padded bad ones. The brief specifies this
      design deliberately. Content quality is gated where it belongs: at authoring time in
      Tasks 21-22 and at the final whole-branch review.
    — cost if wrong: a thin card ships and the user hits it mid-lab. Recoverable by editing
      one markdown file; no code change needed.

- Task 4 fix round 1 dispatched: resumed the original implementer (agent ae9ef65) with
  findings 1 and 3 and the exact conditions to use.
- Task 4: complete. 37f8d7a + ea86ba3 "fix(content): flag omitted objectives and non-mapping
  front matter in ConceptSpec". 17/17 pass, typecheck silent. One fix round, both findings
  ADDRESSED on scoped re-review. The re-reviewer verified the mandated condition in the
  shipped file (not just the diff), compared the `isRecord` guard against `task.ts`
  side by side, confirmed `missing-objectives.md` and `empty-objectives.md` exercise
  *distinct* branches so a future edit cannot collapse them, and re-derived every fixture's
  problem count with a standalone script outside the test runner: bad.md 5 (no regression),
  good.md and minimal.md clean. `MIN_BODY_CHARS` untouched as ruled; no scope drift.
- Task 5 dispatched (sonnet): verdict parser, JSONL -> checkpoints. BASE ea86ba3.
- Task 5: 25ed156 "feat(grading): parse grader JSONL into verdicts". 29/29 pass, typecheck
  silent. Review: spec APPROVED, quality APPROVED, zero blocking findings. The reviewer ran
  24 adversarial inputs beyond the brief's tests (empty string, CRLF, leading whitespace,
  array / null / number / wrong-case status / unknown status / non-string id / empty id /
  wrong-typed weight, a truncated JSON line sandwiched between two valid checkpoints, a 1 MB
  line, 3x duplicate ids, unknown extra fields, negative weight) and reported 0 of 24
  behaving wrongly: no checkpoint ever lost, no phantom checkpoint ever created, no throw.
  Three non-blocking findings.

  Ruling: open a fix round for the reviewer's finding 3 — add a regression test for a
  truncated, unparseable line sitting BETWEEN two valid checkpoints — and carry findings 1
  and 2 along in the same round
    — why: that one input is failure mode #1 in concentrated form. If a malformed middle line
      ever swallowed the checkpoint after it, the user would be shown a failing score on a
      lab they actually got right, and the scheduler would then make them re-study an
      objective they had already mastered — the worst outcome this app can produce, because
      it corrupts the study plan and not just one screen. The reviewer verified by hand that
      today's code handles it, so this buys no bug fix; it buys a lock. Task 23 wires this
      parser into the grading engine and Task 21's real grader emits through four different
      helpers, so this code gets touched again by people who will not re-derive the
      invariant. Findings 1 (`isRecord` idiom from `task.ts` instead of an inline guard plus
      an `as Record<string, unknown>` cast) and 2 (`statusById`'s last-wins choice is correct
      but undocumented) are style-and-comment work that would not justify a round alone, and
      cost nothing in one that is already open.
    — cost if wrong: one resumed implementer and one scoped re-review on a task that was
      already approved on both verdicts.
- Task 5: complete. 25ed156 + 079227f "fix(grading): lock the mid-stream truncation
  invariant, match isRecord idiom". 30/30 pass, typecheck silent. One fix round, all three
  findings ADDRESSED. The re-reviewer did the thing that makes a lock worth having: it wrote
  a deliberately broken parser that drops the line after a malformed one and confirmed the
  new test fails against it ("expected 2 checkpoints, received 1"). `isRecord` was defined
  locally and unexported in `verdict.ts`, matching `task.ts` and `concept.ts` without
  reaching across the content/grading boundary as instructed; the `as Record<string, unknown>`
  cast is gone with no `!` assertion in its place. Exports identical before and after, and
  all 8 spot-checked parsing behaviours unchanged.
- Task 6 dispatched: BASE 079227f.
- Task 6: 9c2febc "feat(content): add objectives taxonomy loader". 34/34 pass, typecheck
  silent, passed first try. Review: spec APPROVED, quality CHANGES REQUESTED. 25 adversarial
  inputs, 23/25 correct; the 2 exceptions are finding 2 below. `byId` verified consistent
  with `objectives` (equal length, every entry reachable and reference-equal), `isRecord`
  textually identical to the siblings, no `!` assertions.

  Ruling: fix finding 1 (test coverage) and finding 3 (message precision); park finding 2
  (error type) for Task 7
    — finding 1: the brief specified 4 tests for a loader whose siblings have 11 and 6. The
      reviewer confirmed by direct probing that duplicate-id counting with 3+ colliding
      entries, a non-list `objectives`, a non-mapping entry, wrong-JS-type `id`/`text`/
      `chapters`, 5-way simultaneous aggregation and the `byId` invariants all behave
      correctly today — and that nothing in the suite would catch a regression in any of
      them. This taxonomy is the spine: every task, concept and scheduling decision is keyed
      by objective id, so a duplicate id that collapses in `byId` makes an objective
      permanently unreachable and the user is never scheduled on it and never learns it
      exists. That is a silent hole in the study plan, not a visible bug, so a test is the
      only thing that can catch it. Cost if wrong: five tests that never fail.
    — finding 3: non-list `objectives` currently gets the same message as an empty list.
      Cheap to separate, and these messages are the only feedback a content author gets.

  Ruling: park finding 2 — `loadObjectives` throwing a raw `YAMLException` (invalid YAML) or
  a raw Node `Error` (missing path) rather than a `ContentError` is NOT fixed in Task 6
    — why: the reviewer confirmed this is identical to the pre-existing idiom in
      `task.ts:152-155` and `concept.ts:95-97`, so it is a cross-loader consistency gap, not
      a Task 6 regression. Fixing it here would make Task 6 the one loader out of three that
      behaves differently — strictly worse than three that agree. The right shape is a single
      wrapping boundary, and Task 7 is the first task that loads all content together, which
      makes it the natural place to decide. DEFERRED TO TASK 7: carry this ruling into
      Task 7's dispatch and settle it there.
    — cost if wrong: a malformed content YAML surfaces as a raw parser exception instead of
      a `ContentError`. The message still names the file, line and column, so it is
      diagnosable; the cost is that a caller cannot catch content problems by type.
- Task 6: complete. 9c2febc + 8dffbf6 "test(content): cover objectives edge cases, fix
  ambiguous list-type error". 40/40 pass (objectives 4 -> 10 tests), typecheck silent. One
  fix round, both findings ADDRESSED. The re-reviewer proved the two load-bearing tests are
  real rather than decorative: it broke duplicate reporting to fire once per occurrence
  (test failed, "expected length 1 but got 3"), and added an early return after the first
  problem (test failed, "expected length 5 but got 1"), reverting after each and confirming
  green. Non-list vs empty `objectives` now give distinct messages. The parked
  `YAMLException` behaviour was left untouched as instructed; scope clean, no exports moved.
- Task 7 dispatched: BASE 8dffbf6. Carries the parked Task 6 finding 2 (raw `YAMLException` /
  Node `Error` from all three loaders instead of `ContentError`) for a decision here.

  Ruling (settles the item parked in Task 6): `loadBank` becomes the single wrapping boundary,
  and it aggregates instead of failing fast. Two deviations from Task 7's brief, both carried
  into the dispatch:
    1. The brief writes `await Promise.all(taskFiles.map(loadTask))` and the same for concepts.
       `Promise.all` rejects on the FIRST rejection, so a bank with three malformed task files
       reports one error, and a raw `YAMLException` or Node `ENOENT` escapes `loadBank`
       untouched. Replace with `allSettled`: merge every `ContentError`'s `problems`, render any
       non-`ContentError` rejection as `<path>: <message>`, and throw ONE aggregate
       `ContentError`. Wrap `loadObjectives` the same way.
       — why: aggregating validation is the principle the entire content layer is built on
         (Tasks 3, 4 and 6 each enforce it within a file), and the brief abandons it at exactly
         the layer where it matters most. The user is authoring 28 chapters of content; a bank
         loader that surfaces one error per run turns a 10-problem content pass into 10 edit
         cycles. This also makes `loadBank` throw `ContentError` and nothing else, which is
         what Task 6's parked finding was asking for — fixed once at the boundary rather than
         three times in three loaders.
    2. `findFiles`/`findMarkdown` use `readdir(...).catch(() => [])`, so a missing or unreadable
       `tasks/` or `concepts/` directory yields zero files silently. Record the failure as a
       problem instead of swallowing it.
       — why: this is the worst kind of silent failure, because it has a plausible-looking
         symptom. A mistyped or absent `tasks/` gives an empty task list, and `checkCoverage`
         then reports every objective as uncovered — which the brief itself documents as
         "expected to be non-empty until the bank is complete". So a broken path reads as
         normal authoring progress. The user would conclude they have content left to write
         when in fact the loader never looked.
    — cost if wrong: `loadBank`'s failure path returns more problems at once than the brief's
      tests expect, and the two private helpers gain a problems accumulator. Both are internal;
      no exported signature changes.
- Task 7: 1b29a6d "feat(content): load the bank and report coverage". 52/52 pass, typecheck
  silent. Review (opus): spec APPROVED, quality CHANGES REQUESTED — implementation clean, test
  layer short. Both deviations implemented correctly in behaviour. The reviewer proved the
  central invariant empirically across 18 probe cases (raw `YAMLException`, `ENOENT`, `EISDIR`,
  `ENOTDIR`, `EACCES`, empty `task.yaml`, symlink loop, four objectives-failure paths):
  **nothing other than a `ContentError` ever escaped `loadBank`**, and no `TypeError` from a
  missing `ObjectiveSet`. `checkCoverage` verified independently on 12 hand-built `Bank`
  objects. Then it mutation-tested the suite, which is what turned up the real problem.

  Ruling: one fix round covering all seven findings; F1 is the one that matters
    — F1 (BLOCKING): reinstating fail-fast after the objectives load leaves 12/12 GREEN. That
      mutation is precisely the regression deviation 1 exists to prevent, so the deviation is
      currently unlocked: a future edit could restore the old behaviour and the suite would
      applaud. The behaviour is right today (probe case 10 reports both) — only the lock is
      missing, and an unlocked invariant in a plan this long is a defect with a delay fuse.
    — F2: `test/fixtures/bank-dupe/concepts/` is an empty directory, so git does not track it.
      The reviewer confirmed by fresh clone that the author tree yields 1 problem and a clone
      yields 2. It passes today only because the assertion is loose; the first person to
      tighten it gets a failure that reproduces nowhere but CI. Add a tracked placeholder.
    — F3: `toMatch(/tasks/)` at bank.test.ts:145 is vacuous — the fixture root is
      `bank-missing-tasks`, so the pattern matches the root name and would pass on a
      concepts-only problem. Assert the actual message.
    — F4, F5: duplicate-concept-id detection and concept-loader aggregation both survive
      deletion/reversion (M2, M6) while their task-side twins are locked. Symmetric code
      deserves symmetric tests.
    — F6: `if (file === undefined) continue` silently drops a problem inside the one function
      whose entire job is not losing problems. Unreachable today, but fix it structurally
      rather than defensively — zip files with their settled results so there is no index
      lookup to guard.
    — F7: the duplicate-id message names only the second file, so the author has to grep for
      the collision partner. Inherited verbatim from the brief; name both.
    — cost if wrong: five tests and three small edits on a task already approved for spec
      compliance, in the file every later content task builds on.
- Task 7: complete. 1b29a6d + 915bfc6 "fix(content): close mutation gaps in bank loader
  review". 55/55 pass (bank 12 -> 15 tests), typecheck silent. One fix round, all seven
  findings ADDRESSED.
    - F1's lock verified by reverting to fail-fast: the new test then fails on an escaping
      `YAMLException`. The invariant is now enforced, not merely true.
    - F6 was fixed structurally: `Outcome<T>` carries `file` on both branches, so no index
      lookup exists downstream and the dropped-problem case is unrepresentable rather than
      guarded. The re-reviewer read every throw site to confirm it (the loaders are `async`,
      so a sync throw converts to a rejection before `attempt` sees it, and `attempt`'s
      handlers only build literals).
    - The implementer's disclosed departure — `Promise.all` instead of `allSettled` in the
      task/concept loops, on the grounds that the wrapper can no longer reject — is SAFE and
      empirically so: dropping `attempt`'s rejection handler failed 3 of 15 tests exactly as
      predicted, so the no-reject guarantee is itself locked by tests. The objectives path
      keeps `allSettled` as instructed.
    - Headline invariant re-proved on the restructured code across 12 fresh cases: 10 threw
      `ContentError`, 2 correctly did not throw, zero raw escapes. Every fixture directory is
      now git-tracked and `find -type d -empty` returns nothing, so the working tree and a
      fresh clone agree.
- Task 8 dispatched: grading sequence with the reboot check. BASE 915bfc6.

  Ruling: three deviations from Task 8's brief, all of them closing a path where a broken
  machine grades as a pass. I read the brief's implementation and traced each consumer through
  the plan before ruling, because `finalVerdict` feeds `reportFor` (plan:9237-9247), which is
  what the user sees and what the scheduler rates.
    1. `finalVerdict` returns `verdictA` when `rebootError` is set. `reportFor` then computes
       `allPassed: allPassed(finalVerdict(result))`, so a user who breaks boot is told every
       checkpoint passed, with the reboot failure shown only as a separate note
       (plan:10940). Verified `allPassed` requires every checkpoint to be `pass`
       (verdict.ts), so verdictA passing means allPassed true. Ruling: when `rebootError` is
       set, `finalVerdict` downgrades every `pass` in verdictA to `fail` with an explanatory
       `detail`, preserving ids, descs, count and `noise`.
       — why: on the real exam an unbootable machine scores zero, and persistence is the
         thing this app exists to drill. "Nothing was verified to survive" is the honest
         answer, and telling the user they passed trains exactly the wrong lesson. Preserving
         the checkpoint count keeps the `countCheckpoints` masked-total invariant intact —
         which is why this is a downgrade and NOT a synthesized extra checkpoint.
       — checked for downstream breakage: the Task 12 test at plan:9098-9099 asserts only
         `r.rebootError`, so it survives.
    2. A checkpoint that PASSED in A and is ABSENT from B is invisible to the brief's
       regression filter, which iterates B's checkpoints only. A post-reboot grader that dies
       after its first checkpoint therefore yields `allPassed(verdictB) === true` on one of
       five checkpoints — a false pass, the worst outcome this system can produce. Ruling:
       every id verdict A reported must be accounted for in B; any id B omits is added to B as
       a `fail` with a detail saying it was not reported after the reboot, and counts as a
       regression if it had passed.
    3. Pass in A -> `skip` in B is not counted as a regression. `allPassed` already rejects a
       skip, so this is not a false pass — but the user is told "not everything passed"
       without being told which checkpoint regressed, which is the one fact that diagnoses a
       persistence bug. Ruling: pass -> skip is a regression too.
    — cost if wrong: `finalVerdict` reports a harsher result than the brief's tests expect on
      the reboot-failure path, and verdict B carries synthesized fail checkpoints on the
      partial-grader path. Both are visible in tests and reversible.
- Task 8: 83c5c1f "feat(grading): add the verdict A/B sequence and regression detection".
  70/70 pass, typecheck silent. Review (opus): spec APPROVED, quality APPROVED. All three
  deviations correct and complete. **13 of 13 assigned mutations killed, zero survived** —
  including every deviation-1 and deviation-2 mutation, and including the forbidden
  synthesized-checkpoint approach, which an explicit count assertion caught. The reviewer
  added 10 mutations of its own; 5 survived, none on a false-pass path. It enumerated all four
  `allPassed`-true paths and confirmed **no input lets a broken or unverified machine grade as
  a pass**. Zero `!` and zero `as` in the new file: the `desc`-by-id lookup I expected to need
  a cast was avoided structurally by iterating `Checkpoint` values instead of ids.

  Ruling: fix F1, F2, F3 and F5 in one round; park F4, F6, F7 and F8 with pointers
    — F1 (the reviewer's own pick for most important untested behaviour): the synthesized
      missing-from-B checkpoint carries A's `desc`, and replacing it with `''` survives the
      suite. `reportFor` shows `desc` to the user, so losing it means a regression appears as
      an unnamed failed checkpoint — the exact thing deviation 2 exists to surface. Test it.
    — F2: "append in A's original order" is untested because both completion tests have only
      one missing id, so `missing.reverse()` survives. Needs a two-missing-id case.
    — F3: completion's `noise` pass-through is untested (`noise: []` survives) while
      deviation 1's equivalent is asserted. Symmetric code, symmetric tests.
    — F5: the returned verdict aliases the input's `noise` array, so a caller pushing to the
      result writes back into verdict A. `finalVerdict` itself never mutates — verified — but
      this module's purity is a property I asked to be asserted, and an aliased array is a
      loaded gun in a module three later tasks consume. Copy the array.
    — F4 parked, DEFERRED TO TASK 17: a non-`Error` rejection from `reboot()` yields
      `rebootError = "[object Object]"`, which `reportFor` shows to the user verbatim. It
      fails safe (the downgrade still fires), and Task 17 owns `VmController.reboot` where the
      real rejection shapes are known. Fixing it here would be guessing at those shapes.
    — F6 parked, DEFERRED TO TASK 21: an id in verdict B that A never emitted is accepted
      silently and inflates `total` against the statically-derived masked count. The reviewer
      traced it and confirmed it cannot conceal a lost pass. It is a grader-authoring defect,
      and `validate` is where grader defects are caught.
    — F7 parked, DEFERRED TO TASK 17/23: an `exec` rejection on run B escapes `grade` and
      discards verdict A, so an SSH blip after the reboot loses the whole attempt. Scope-correct
      per the brief, and the retry/reachability policy belongs to the transport layer, not here.
    — F8 parked: `rebootError` precedence over a present `verdictB` is unreachable through
      `grade`, and the implementer's unconditional-precedence choice is the right one.
    — cost if wrong: four assertions and a one-line array copy on a task already approved on
      both verdicts.

### Task 8 — fix round 1

Commit `72ae25f` "fix(grading): close review gaps in the reboot check completion path".
Implementer reports 18 tests in `grader.test.ts` (9 brief, unmodified + 6 deviation + 3
new), full suite 73/73, typecheck clean. F1 fixed with break-and-revert evidence; F2 and
F3 fixed with structurally sensitive tests; F4 copied the `noise` array on both paths.

Disclosed caveat on F4's completion path: the added assertion documents the invariant but
cannot structurally catch a reversion, because verdict B's `noise` is created inside
`grade` by `parseVerdict` and nothing outside the module holds an independent reference to
it, so dropping that copy has no observable effect. Exporting the internal function to
make it observable was ruled out by the no-signature-changes constraint.

Ruling: accept the caveat if the re-review confirms the reachability analysis — the
aliasing is genuinely unobservable on that path, so the copy is consistency rather than a
behaviour with a test to own it. The implementer disclosed the limit instead of claiming a
lock it does not have, which is the behaviour I want. Cost if wrong: an unobservable alias
on a path whose observable twin is test-locked. Scoped re-review dispatched on haiku with
a mandate to mutation-test F1–F3 and adjudicate the F4 claim rather than accept it.

### Task 9 pre-flight (read before dispatch)

Brief: `task-9-brief.md`. Cascade traced against all ten `deriveRating` tests — consistent,
no dead branch, no unreachable rung. Test count claim of 16 verified (1 + 5 + 9 + 1).
`EXAM_PASSING_SCORE / EXAM_TOTAL_SCORE === 0.7` is exact in IEEE754 (correctly-rounded
division of 210/300 yields the same double as the literal), so `toBe` will not flake.

One override to mandate: the brief's `advance` writes `rung: (s.rung + 1) as Rung`. The
Global Constraints do not ban `as`, but I struck the equivalent cast from `verdict.ts` in
Task 5 and consistency across the grading and disclosure modules is worth more than the
marginal cost here. Replace with a `NEXT_RUNG: Record<Rung, Rung | undefined>` lookup so
the increment is checked rather than asserted, keeping `canAdvance` as the single
advanceability guard.

Ruling: mandate the `NEXT_RUNG` table; keep every brief test assertion verbatim. Why: an
unchecked widening cast in the one module that defines the rung type is where a future
rung 6 would silently pass typecheck. Cost if wrong: five lines and one lookup.

Forwarded to Task 12: plan line 9202 writes `mode === 'guided' ? 5 : MAX_RUNG[mode]`. That
`5` duplicates `MAX_RUNG.practice` and must reference it, or guided and practice can drift
apart. Plan line 10552 also re-declares `SessionMode` as a client-side literal union
mirroring the server type — carry to the final review, not to Task 12.

Task 8: complete. Re-review APPROVED at `72ae25f`. All three assigned mutations killed:
`desc: ''` and the injected `.reverse()` and `noise: []` each broke a named test. 73/73,
typecheck clean, working tree clean, no exported signature changed, no `!` and no `as`
introduced, two files touched. The F4 completion-path caveat was independently verified as
correct — verdict B's `noise` is created at `grader.ts:108` by `parseVerdict` and no caller
holds the original, so the alias is unobservable there; the copy stays as consistency.
Parked with forwarding addresses: non-`Error` reboot rejection → Task 17; unknown id in
verdict B → Task 21; `exec` rejection on run B → Task 17/23; `rebootError` precedence over
a present `verdictB` → unreachable, no action.

Correction to the Task 9 ruling above: I justified the `NEXT_RUNG` override by claiming
Task 5 struck the equivalent cast from `verdict.ts`. It did not — `verdict.ts:29` still has
`status: v.status as CheckpointStatus`, and `task.ts:96,101,108` have three more of the same
shape. Task 5 removed a different cast (`as Record<string, unknown>`). The override stands
on its own reasoning; the implementer was told not to tidy the approved files.

### Task 10 pre-flight (read before dispatch)

Brief: `task-10-brief.md`. Header regex verified not to cross-match: with `header` set to
`expect-fail`, `# baseline-fail: a` does not match, because `\s*` cannot absorb `baseline-`;
the reverse holds too, so the brief's "does not confuse the two header names" test is sound.
Test count claim of 13 verified (9 + 4). Aggregation inside the entry loop is correct — each
problem `continue`s rather than throwing, and the two pre-loop throws are terminal with
nothing to aggregate. Call sites confirmed at plan lines 3281, 3344 and 3358: Task 11
consumes both header names and both verdict labels, so the third parameter is load-bearing.

Four defects in the brief's own code, all in the class this module exists to prevent — a
malformed declaration that is silently accepted, which makes the harness assert the wrong
thing about a grader:

1. `entry.split('@', 2)` on `a@pre@post` returns `['a','pre']`. JavaScript's limit argument
   discards the remainder instead of reporting it, so a nonsense declaration parses as a
   valid `{id:'a', phase:'pre'}`. Must be a problem.
2. The header regex uses `exec` without `g`, so a second `# expect-fail:` line is silently
   ignored. An author who adds one expecting the entries to accumulate loses declarations
   with no error. Must be a problem.
3. `phase as ExpectPhase` at brief line 257 — the same guarded-union cast as `verdict.ts:29`.
   A local type predicate over a `readonly ExpectPhase[]` removes it with no cast and no new
   file, matching the per-module local `isRecord` precedent from Tasks 4 and 5.
4. `headerRe` interpolates `header` into a `RegExp` unescaped. No live risk with two literal
   callers, but typing the parameter as `'expect-fail' | 'baseline-fail'` removes the
   possibility and type-checks both call sites.

Also untested in the brief: the `empty checkpoint id` branch (an entry of `@post`). Deleting
that push leaves the suite green.

Ruling: mandate all four fixes plus a test for the empty-id branch. Why: every one is a way
a wrong anti-solution header reads as a correct one, and this module's only job is to make
the harness assert that the right checkpoint caught the error. Cost if wrong: about fifteen
lines and three tests in a new file with no consumers yet.

Documentation nit for the final review, not for the implementer: the brief's Interfaces
block gives `parseExpectations(script, where)` and omits the third `header` parameter that
its own code and tests use.

Carried to the final whole-branch review: four guarded-union casts now exist
(`verdict.ts:29`, `task.ts:96,101,108`) where an `includes` check guards a widening
TypeScript cannot connect to the type. Unify them behind one `oneOf` type-predicate helper
then, when touching approved files is in scope — not now, mid-task, across two closed tasks.

### Task 9 — review

Commit `0890bbb` "feat(disclosure): add the five-rung ladder and derived FSRS rating".
Sonnet review: SPEC COMPLIANCE APPROVED, TASK QUALITY APPROVED. 89/89, typecheck clean,
only the four named files touched, no extra exports or renames. The `NEXT_RUNG` deviation
verified correct: `canAdvance` called exactly once, not duplicated; the `next === undefined`
arm confirmed unreachable standalone and present only for narrowing; thrown message matches
the brief's regexes verbatim. Zero `!` and zero `as` in both new files.

Nine of ten mutations killed — `hadRegression` moved to the end of the cascade, deleted
entirely, each rung threshold shifted by one, the two `!passed` arms swapped,
`MAX_RUNG.drill` widened to 4, `canAdvance` loosened to `<=`, and `advance` made to mutate
its input. One survivor.

F1: flipping `durationS <= timeBudgetS` to `<` at `ladder.ts:67` survives, because no test
uses `durationS === timeBudgetS`. Ruling: fix — add the exact-tie test, break and revert to
prove the lock. Why: the tie is the boundary the `easy` rating turns on, and a silent
downgrade to `good` pulls that card into review early for months with no visible symptom,
which is the study-schedule corruption class rather than a one-screen bug. The brief's own
tests miss it too, so the gap was inherited. Cost if wrong: one assertion.

Reviewer also judged `test/exam/limits.test.ts` correct to pin only the 70% ratio rather
than the raw numbers, since all three constants are UNCONFIRMED placeholders that nothing
enforces and the ratio is what survives a Red Hat rescale. Agreed, no action.

Task 9: complete. Fix commit `66b9df9` "test: lock the budget boundary in deriveRating" —
five lines, one assertion, using `base.timeBudgetS` rather than a literal so it cannot drift
from the fixture. 90/90, typecheck clean, working tree clean.

Ruling: I verified this fix myself instead of dispatching a scoped re-review. Why: the diff
is a single assertion in one test file, and the check that matters is one mutation I can run
directly — I flipped `<=` to `<` in `ladder.ts:67`, watched exactly the new test fail 1/16,
restored, and confirmed 90/90 with a clean tree. A reviewer seat would have added a summary,
not evidence. Cost if wrong: a five-line test diff went unread by a second pair of eyes, and
the final whole-branch review still covers it.

### Recovery note

The previous process exited with five background agents mid-flight. Tasks 8 and 9 had
already reported and were verified independently against git: `72ae25f`, `0890bbb`, `66b9df9`
all present, 90/90, typecheck clean, tree clean. Task 10's implementer left nothing at all —
no commit, no `src/engine/validate/`, no report — so it was re-dispatched from scratch rather
than resumed. No work was lost and nothing was double-applied.

### Task 11 pre-flight (read before dispatch)

Brief: `task-11-brief.md`, 633 lines — the largest integration point so far, consuming
Tasks 2, 3, 5, 8 and 10. I traced all 13 tests against the fake world's state machine and
the expectation matrix; they are internally consistent and the brief is well-constructed.
Specifically verified: the `world()` handler's GRADE branch is reachable because
`# baseline-fail: ... persist-config ...` is lowercase and `includes('PERSIST')` is
case-sensitive; test 3's `not.toMatch(/lv-var-size/)` holds because that id matches its
declaration in both verdicts; test 1's four fixtures each produce zero failures under the
declared phases; the inventory gate is correctly absent from a passing task, which is what
lets test 1 assert exactly four names. Test count claim of 13 verified.

One behaviour defect, in the false-validation class this module exists to prevent:

1. `checkVerdict` maps status to `cp.status === 'pass' ? 'pass' : 'fail'`, so a `skip`
   silently satisfies an expected failure. A skipped check proves nothing about whether the
   grader detects the error — the grader gave up rather than caught it — yet the
   anti-solution and baseline gates both accept it. Solutions still catch a wholly-skipping
   grader, since `skip` is not `pass`, so this is narrow rather than fatal; it must still be
   reported as its own problem when `want === 'fail'` and the status is `skip`.

Four branches with no test, each of which survives deletion:

2. `reboot failed: ${result.rebootError}` — untested, on the reboot path, which is the
   highest-value output in the system.
3. `${cp.id} appeared only after the reboot` — untested.
4. `verdict B was skipped: no checkpoint passed before the reboot` for a solution — untested.
5. The `empty checkpoint id` equivalent here: the anti-solution parse-failure early return
   (`parseExpectations` throwing inside `runFixture`) — untested.

Ruling: mandate the `skip` distinction plus tests for all four branches. Why: this harness is
the only thing standing between a broken grader and a study plan built on false passes, and
an untested branch in it is a gate that can be removed without the suite noticing. Cost if
wrong: one condition and four tests in a file whose 13 existing tests already pass.

Analysis that did NOT become a mandate, recorded so it is not re-derived: an anti-solution
declaring only `@post` ids on a task whose verdict A had no passes is still caught, because
`@post` expects a pass in A and every checkpoint failed there. And the harness reads
`verdictA`/`verdictB` directly rather than through `finalVerdict`, so Task 8's `rebootError`
downgrade does not apply — but it checks `rebootError` explicitly, so the path is covered.

Forwarded to Task 12: `loadTaskScripts` has no test at all — it is the I/O half the design
note deliberately separated out, but `readFile` on a missing `setup.sh` or `grade.sh` rejects
with a raw ENOENT rather than the `ContentError` boundary settled in Task 7, and
`readdir(...).catch(() => [])` turns a typo'd or unreadable `solutions/` directory into
"needs at least 2 solutions" instead of the real cause.

Forwarded to Task 21: an anti-solution with an empty script that declares exactly the
baseline's goal checkpoints validates green while proving nothing. Writing one is nonsense,
so this is an authoring-convention concern rather than a harness bug.

### Task 10 — review

Commit `73f4622` "feat(validate): parse anti-solution expect-fail headers".
Sonnet review: SPEC COMPLIANCE APPROVED, TASK QUALITY APPROVED, **zero findings**. 106/106,
typecheck clean, diff confined to the two files, all 13 brief tests present verbatim, no `as`
and no `!`, exports exactly as specified.

All eight assigned mutations killed with no survivors: restoring `split('@', 2)`, reverting
the multi-header detection to first-match-only, deleting the empty-id push, `isPhase` →
`return true`, deleting the duplicate-id check, defaulting to `post` instead of `both`,
swapping the `post`/`pre` arms of `expectedStatus`, and flipping the undeclared-id default
from `pass` to `fail`.

The regex was probed directly rather than read: `# baseline-fail: a` does not match the
`expect-fail` header and vice versa, `# my-expect-fail: a` is rejected by the anchor, and the
multi-header count only counts real `^#\s*expect-fail:` lines rather than any line mentioning
the word. Aggregation confirmed intact — a header with two distinct malformed entries throws
one `ContentError` carrying both problems.

Ruling on the disclosed 106-vs-108 judgment call: the implementer was right and my arithmetic
was wrong. Fixes 3 and 4 are type-level with no runtime-observable difference, so no vitest
input can distinguish them; padding the suite would have added tests that cannot fail. The
reviewer verified both `tsc` locks are load-bearing rather than decorative — notably, widening
`header` back to `string` only fails typecheck once a call site passes a non-literal, which it
demonstrated with a scratch call site that compiles silently under `string` and is rejected
under the union. No fix round; Task 10 complete at `73f4622`.

**Escape found by the reviewer, now folded into Task 11's mandate.** A typo'd id in
`# expect-fail:` — say `fs-var-siz@post` for `fs-var-size` — parses cleanly, and
`expectedStatus` then returns `pass` for the real id in both verdicts by the undeclared-id
default. If the grader has a bug that makes that checkpoint always pass, the harness's derived
expectation matches the broken behaviour exactly and the defect ships. `parseExpectations`
correctly has no checkpoint registry to check against; that belongs to the harness. Task 11's
brief cross-checks emitted ids only for the **baseline** header, inside the `kind === 'none'`
branch — anti-solution `declared` ids are never cross-checked at all. That gap is live and is
now mandate 6 for Task 11.

### Task 12 pre-flight (read before dispatch)

Brief: `task-12-brief.md`, 215 lines. Correction to an earlier forwarding note: Task 12 is
the CLI with **only** the `coverage` command — `rhcsa validate` lands in Task 21, once
`chooseTransport` and `VmController` exist. So the `loadTaskScripts` concerns I forwarded to
Task 12 belong to **Task 21** instead. Test count claim of 5 verified. The `--strict` message
does satisfy its `/1 uncovered objective/` assertion, since the regex matches the `(s)` form.

Five defects, two of them the same false-pass class this project keeps running into — the
tool reporting success when it did not do what the user asked:

1. **Unknown options are silently ignored.** `flag()` is `argv.includes('--strict')`, so
   `rhcsa coverage --strick` runs without strictness and exits 0 while gaps remain. `--strict`
   is the gate that will eventually enforce complete coverage, and a typo silently disabling it
   is indistinguishable from a pass. Reject unknown flags with usage and exit 2.
2. **`option()` swallows the next flag, or silently falls back.** `--content --strict` sets the
   content root to the literal string `--strict`; `--content` as the final argument silently
   reverts to the default `content` directory. Either way the user believes they pointed the
   tool somewhere they did not. A missing or flag-shaped value must be a usage error.
3. **`let bank` has no type annotation.** With no initializer TypeScript gives it an evolving
   `any`, which `noImplicitAny` does not flag, so `bank.typo` would compile silently in the one
   file that is meant to be the typed boundary over the loader. Annotate it `Bank`.
4. **The direct-invocation guard compares `import.meta.url` to a hand-built
   `file://${process.argv[1]}` string.** Use `pathToFileURL` from `node:url`; the manual form
   breaks on any path needing percent-encoding, which is a real hazard the moment the repo is
   moved somewhere with a space in the name.
5. **The `problems.length > 0` branch is unreachable in tests and survives deletion.** That is
   the path where the CLI reports genuine authoring bugs — unresolvable concept and objective
   references. The existing fixtures either resolve cleanly or throw during load, and Task 7
   only reached this path by mutating a `TaskSpec` in memory, which the CLI cannot do. Needs a
   fixture on disk whose task requires a nonexistent concept, plus a test asserting exit 1 and
   the `problem:` line.

Ruling: mandate all five. Why: 1 and 2 make the CLI lie about what it did, 5 leaves the
hard-error path as dead code in the only command that exists, and 3 and 4 are each a
one-liner. Cost if wrong: two argument-parsing helpers, one annotation, one import, and one
fixture with a test, in a 90-line file with no consumers yet.

## Task 11 review (opus, agent a3144cc5e0e109b3b) — `0d544a7`

Verdicts: **spec compliance APPROVED**, **task quality CHANGES REQUESTED**.

Verified independently by the reviewer: 125 tests / 12 files, typecheck clean,
`test/validate/harness.test.ts` = 19 tests, brief's 13 tests byte-identical
(difflib produced exactly one hunk: the trailing `})` moved down). Diff is two
new files, 732 insertions, nothing else modified. Exports match the brief;
`checkEmittedIds` correctly unexported. Grader exit code never read.

Mutation table: 12 run, 9 caught, **3 survived** — all six mandated changes are
genuinely locked (mutations 1-6 each caught by their named test); the survivors
are all in the *preserved-behaviour* column:

- M9 `deps.reset()` moved to the end of `runFixture` → SURVIVED 125/125
- M10 `duplicateIds` moved inside `checkVerdict` → SURVIVED 125/125
- M12 `grader emitted no checkpoints` guard dropped → SURVIVED 125/125

### False-pass hunt: one found, and it is total

A grader that hardcodes an **invariant** checkpoint to `pass` returns `ok: true`
for all four fixtures. `no-action` (undeclared in `baseline-fail` → expected
`pass`), both solutions (expected `pass`), and the anti-solution (undeclared in
`expect-fail` → expected `pass`) all match. The harness requires ≥2 solutions
and ≥1 anti-solution but never requires that the **union of anti-solution
declarations cover every emitted checkpoint**, so a checkpoint no anti-solution
attacks is never falsified.

Ruling: **not a Task 11 defect — forward to Task 21 as a coverage rule.** Why:
it is inherent to the brief's design (the reviewer said so and I agree — the
per-checkpoint phase grammar is what *enables* the rule, and the harness has no
authority to invent an inventory requirement the plan never stated). The fix
belongs where the content gate lives. Cost if wrong: a grader with a
hardcoded-pass invariant ships green until Task 21 adds the union check —
contained, because every *goal* checkpoint is still falsified by
`# baseline-fail:` and by `checkEmittedIds`.

### Findings and rulings

- **F1 `harness.ts:177` — `deps.reset()` ordering unlocked. BLOCKS. FIX.**
  The only guard is `resets).toBe(4)`, which counts calls and is blind to
  position; the test is even named "so fixtures cannot contaminate each other",
  which is precisely the property it fails to assert. With reset at the end, the
  first fixture grades an un-reset machine and — worse — both early-return paths
  (`setup.sh` failure, anti-solution parse failure) skip the trailing reset
  entirely, so the next fixture inherits the previous fixture's mutations.
  Ruling: fix. Why: this is a false pass in the harness's core assertion,
  reachable by a one-line move, with zero test resistance. Cost if wrong: one
  ordering assertion.

- **F2 `harness.ts:120-122` — `grader emitted no checkpoints` guard unlocked.
  BLOCKS. FIX.** The reviewer's probe C shows the guard is load-bearing: for a
  grader emitting zero checkpoints on a `rebootCheck: false` task, that message
  is the *only* failure the solution fixtures produce. Delete it and both
  solutions report `ok: true` for a grader that emitted nothing.
  Ruling: fix. Cost if wrong: one test.

- **F3 `harness.ts:203-206` — `duplicateIds` scoped to verdict A only,
  unlocked. Non-blocking. FIX ANYWAY.** Report noise, not a false pass, but the
  lock is one assertion on failure count for a reboot task with duplicates, and
  it is in the same file as F1/F2. Ruling: fold into this round rather than
  forward it. Cost if wrong: one assertion.

- **F4 `harness.ts:242-248` — an anti-solution declaring only `@pre` never
  verifies verdict B. Non-blocking. FORWARD to Task 21.** With all A checkpoints
  failing, `grade()` skips the reboot; the `verdict B was skipped` push is
  correctly solution-only, so the anti-solution's "recovers after reboot" half
  goes unverified. Ruling: forward. Why: a `@pre`-only anti-solution is a
  declaration shape the content gate should reject outright, not something the
  harness should special-case. Cost if wrong: one rare anti-solution shape
  validates less than it appears to.

- **F5 `harness.ts:60` — `loadTaskScripts` prepends `assertLib` before
  `grade.sh`, so `# baseline-fail:` is parsed from the combined string.**
  Informational. An assertion library containing that literal would trigger
  `more than one "# baseline-fail:" header` — a loud failure, not a silent one.
  Ruling: accept as written, note it in the Task 21 forwarding entry alongside
  the already-parked `loadTaskScripts` gaps (raw ENOENT; `readdir().catch(() =>
  [])`). The reviewer independently confirmed those degrade into inventory-gate
  *failures*, never passes.

Working tree confirmed clean at `0d544a7`; all 12 mutations reverted, probe file
and /tmp scratch removed, no artifacts left in the repo.

### Task 11 fix round 1

Original implementer is not resumable (lost across the process boundary), so
round 1 goes to a **fresh** implementer on sonnet. Scope: F1, F2, F3 — three
test additions/strengthenings in `test/validate/harness.test.ts`, no source
change expected.

### Parked findings forwarded to Task 21 (consolidated — carry this list into the Task 21 dispatch)

Task 21 owns `rhcsa validate`, so it is where the content gate and the harness's
CLI surface meet. Everything below is already ruled and needs no re-derivation:

1. **Coverage-union rule (from Task 11's false-pass hunt).** Require that the
   union of anti-solution `# expect-fail:` declarations covers every checkpoint
   the grader emits. Without it, a grader that hardcodes an *invariant*
   checkpoint to `pass` validates green across all four fixtures.
2. **Reject a `@pre`-only anti-solution** (Task 11 F4). With every verdict-A
   checkpoint failing, `grade()` skips the reboot, so the declaration's
   "recovers after reboot" half is never verified.
3. **Reject an anti-solution that declares exactly the baseline** — an empty
   attack surface dressed as a real one (parked in Task 10's review).
4. **`loadTaskScripts` error boundary** (Task 11 F5 and earlier): raw `ENOENT`
   escapes instead of the `ContentError` boundary settled in Task 7, and
   `readdir(...).catch(() => [])` turns a typo'd `solutions/` directory into the
   misleading "needs at least 2 solutions". Both currently degrade into
   inventory-gate *failures*, never passes — confirmed by the Task 11 reviewer —
   so this is legibility, not correctness.
5. **`assertLib` is prepended before `grade.sh`**, so `# baseline-fail:` is
   parsed from the combined string. An assertion library containing that literal
   would trip `more than one "# baseline-fail:" header`. Accepted as written
   (loud, not silent); worth a comment at the concatenation site.
6. **Unknown checkpoint id appearing in verdict B** (parked from Task 8).

Fix round 1 landed: `40e89cf` "test(validate): lock reset ordering, the
empty-verdict guard and duplicate scope". **128 tests** (125 + 3), typecheck
clean, working tree clean. Diff is `test/validate/harness.test.ts` only, 106
insertions — no source change, as mandated, since all three findings were
missing tests rather than wrong code. Implementer re-ran each mutation and
reported the failing test for each; the line-306 `toBe(4)` count assertion was
left intact per the mandate.

Scoped re-review dispatched on sonnet (agent `task-11-rereview`). Beyond
re-running the three mutations independently, it is asked one adversarial
question: is there a *different* way to break reset ordering that the new test
still misses (reset after the `setup.sh` exec; reset dropped from only one
early-return path)? That is the review that matters here — the original defect
was a test guarding the wrong property, and a replacement that counts calls
under a new name would reproduce it.

### Task 11 fix round 1 verification — done by me, not the re-reviewer

Ruling: **I verified the gate myself rather than spend another reviewer seat.**
Why: the re-review agent went idle without delivering a report (same lost-child
mode that destroyed Task 10's first implementer), and the gate is four mechanical
mutations I can run in one pass — cheaper to do than to re-dispatch and chase.
Cost if wrong: I am the one who wrote the mandate, so this is self-approval on a
test-only diff; the four mutation results below are reproducible from the ledger
by anyone who doubts them, and the whole file is re-reviewed at the final
whole-branch pass.

Mutations run against `40e89cf`, each reverted immediately:

| Mutation | Result | Caught by |
|---|---|---|
| F1 `deps.reset()` moved to the end of `runFixture` | **caught**, 1 failed / 21 passed | `resets each fixture before its own setup.sh, even right after an earlier fixture failed setup.sh` |
| F2 empty-checkpoints push deleted | **caught**, 1 failed / 21 passed | `fails solution fixtures when the grader emits no checkpoints at all` |
| F3 `duplicateIds` moved into `checkVerdict` | **caught**, 1 failed / 21 passed | `reports duplicate checkpoint ids exactly once per fixture, not once per verdict` |
| **E (my adversarial variant)** `deps.reset()` moved to *after* the `setup.sh` exec — the alternative way to break ordering the reviewer was asked to hunt | **caught**, 3 failed / 19 passed | the F1 test plus `passes a well-formed task…` and `accepts an invariant checkpoint that passes at baseline` |

Variant E is the answer to the question that mattered: the new F1 test asserts
`sequence[i - 1] === 'reset'` for **every** `setup` index, so it pins position
rather than count and catches reset landing anywhere after setup — not just the
end-of-function move the mandate named. It also runs across a deliberately
failing middle `setup.sh`, which is what exercises the early-return path where an
end-of-function reset would be unreachable. That is the property the original
test was named after and failed to assert.

Non-vacuity check on the other two: F2 asserts the specific message on every
`kind === 'solution'` result of a `rebootCheck: false` task whose grader emits
nothing; F3 asserts `toHaveLength(1)` on a `rebootCheck: true` task, i.e. the
count, which is the whole point. The pre-existing `resets).toBe(4)` count
assertion survives at `test/validate/harness.test.ts:319`.

## Task 11: complete — `0d544a7` + `40e89cf`

`src/engine/validate/harness.ts` (fixture matrix harness) and
`test/validate/harness.test.ts`. **128 tests passing / 12 files**, typecheck
clean, working tree clean. Spec compliance approved by the opus reviewer with the
brief's 13 tests byte-identical; six mandated changes landed and locked; three
survivors from the reviewer's mutation table closed in fix round 1 and
independently re-verified above. Five findings forwarded to Task 21 (see the
consolidated list). Next: Task 12, BASE `40e89cf`.

## Task 12 dispatched — BASE `40e89cf`

`src/cli/index.ts` + `test/cli/coverage.test.ts`, sonnet. Mandates written to
`task-12-mandates.md` (the five pre-flighted defects, unchanged from the ruling
above). One ambiguity resolved in the dispatch: the brief's `flag()`/`option()`
helpers are to be **replaced** by a single explicit pass over `argv`, not patched
— patching leaves two helpers each needing their own guard, which is how the
false-pass got in.

Predicted test count 9 (brief's 5 + 2 for mandate 1 + 2 for mandate 2 + 1 for
mandate 5; mandates 3 and 4 are type-level and add none). The dispatch tells the
implementer to trust its own arithmetic over mine and say so, since my count was
wrong on Task 10.

## Task 13 pre-flight (read before dispatch)

Brief: `task-13-brief.md`, 171 lines. Test count claim of 8 verified (5 + 3).
`content/` does not exist yet — Task 13 creates it, so there is no collision with
the fixture banks.

Evidence gathered so the implementer and reviewer need not re-derive it:

- **The id regex and the chapters 1-28 range are already enforced** by
  `parseObjectives` in `src/engine/content/objectives.ts` (`OBJECTIVE_ID_RE`, and
  the `Number.isInteger(c) || c < 1 || c > 28` check). The brief states both as
  transcription rules; no extra test is needed to lock them, and adding one would
  duplicate Task 6's coverage.
- **`new URL(..., import.meta.url).pathname` is the established house pattern**,
  used in six test files from already-approved tasks (`objectives.test.ts:5`,
  `bank.test.ts:5` and six more, `task.test.ts:5`, `concept.test.ts:5`). It has
  the same percent-encoding hazard I mandated away in Task 12's *source* (change
  4, `pathToFileURL`). Ruling: **leave `.pathname` alone in Task 13.** Why:
  changing it in one new test file while six approved ones keep the old form
  makes the codebase inconsistent for no gain, and the hazard is confined to
  tests, which only ever run from the repo. Forward **one house-wide sweep to
  `fileURLToPath`** to the final whole-branch review. Cost if wrong: the test
  suite breaks if the repo is ever moved to a path needing percent-encoding —
  loud and immediate, not silent.
- **A fifth guarded-union cast for the final-review sweep:**
  `src/engine/content/objectives.ts:70` `chapters: bad ? [] : (rawChapters as
  number[])`. Same shape as `verdict.ts:29` and `task.ts:96,101,108` — a
  `.some()` check TypeScript cannot connect to the widening cast. Unify all five
  behind one `oneOf`-style predicate helper at the final review.

Four defects:

1. **The PDF page numbers are printed page numbers, not PDF page indices.** The
   brief says `pages: "38-40"` for the RHCSA 9 table and page 42 for RHCSA 10.
   A Cert Guide carries 20-40 pages of front matter, so printed p.38 is likely
   PDF page ~55-70. An implementer that trusts the number will read the wrong
   pages and either report BLOCKED or — far worse — transcribe whatever table it
   does find. This is the highest-cost defect in the task because a wrong
   transcription is permanent: the ids are the FSRS scheduling keys.
2. **The RHEL 10 tests state their answer before the source is read.**
   `expect(areas.has('containers')).toBe(false)` and
   `some(o => o.id.includes('flatpak'))` are assertions about facts on page 42
   that the implementer is supposed to *discover*, and Step 4 pre-announces both.
   Under test pressure an implementer transcribes to satisfy the assertion rather
   than transcribing the page — inverting source and expectation on the one
   artifact whose entire purpose is enumerating risk R2 accurately.
3. **Step 2's `WebFetch` of Red Hat's objectives page has no fallback.** If the
   fetch fails or the network is unavailable, the task has no defined path and
   will come back BLOCKED. It also matters for honesty: the test asserts
   `source` matches `/visual/i`, and the brief's `source:` string claims a Red Hat
   cross-check that may not have happened.
4. **Nothing enforces the id-reuse rule.** Step 4 says "reuse the same ids
   wherever an objective is unchanged", but no test checks that a shared id
   actually names the same objective. Reuse an id whose wording changed
   materially and the R2 delta *understates* the change — the exact failure the
   two-file design exists to prevent.

Ruling: **mandate all four.** Why: 1 and 2 both corrupt the transcription itself,
which is permanent and is the input to every later content task; 3 is the
difference between a completed task and a blocked one; 4 is one test that makes
an already-stated rule enforceable. Cost if wrong: some extra PDF reading, one
`source:` string that is more candid than it needs to be, and one normalized
string comparison.

Noted, deliberately **not** a mandate: after Task 13, `rhcsa coverage --content
content` will fail to load, because `content/` will have `objectives.yaml` but no
`tasks/` or `concepts/` directories (cf. the `bank-missing-tasks` fixture). That
is correct and expected until the content-authoring tasks land. The implementer
must not "fix" it by inventing placeholder tasks.

Late-arriving reports (both agents went idle before delivering; the messages
landed afterwards):

- **Task 11 re-reviewer: CLOSED.** Independently confirms all three mutations
  caught, 128/128, typecheck silent, diff scoped to the test file,
  `resets).toBe(4)` intact at line 318, none of the three tests vacuous. Its
  adversarial variant for part E was the *same* one I chose independently — reset
  moved to just after the `setup.sh` exec — and it too was caught. It reports it
  could not construct any mutation preserving both "reset count 3" and "every
  setup immediately preceded by reset" while still breaking the property. So the
  self-verification ruling above stands, and is now corroborated rather than
  self-approved. No change to Task 11's completion.

## Task 12: complete pending review — `2ff65ac`

`src/cli/index.ts` (124 lines), `test/cli/coverage.test.ts` (10 tests), and the
new `test/fixtures/bank-unresolved/` (objectives + one concept + one task whose
`requires_concepts` names a nonexistent concept). **138 tests / 13 files**,
typecheck clean. All five mandates applied: `option()`/`flag()` replaced by a
single-pass `parseCoverageArgs`; missing and flag-shaped `--content` values
rejected; `bank: Bank` annotated; `pathToFileURL` for the direct-invocation
guard; the `problems` branch now reachable from disk. Mandates 1, 2 and 5
mutation-tested; 3 and 4 correctly not padded with runtime tests, with Step 5's
real `node src/cli/index.ts` output standing as mandate 4's evidence.

**My arithmetic was wrong again.** The mandates doc's own terms — brief's 5, plus
2 for mandate 1, plus 2 for mandate 2, plus 1 for mandate 5 — sum to **10**, and
I wrote 9. The implementer trusted its own arithmetic as instructed and wrote 10.
Second time in this plan my predicted count has been off (Task 10 was the first).
Ruling: the count line in a mandates doc is a **hint, not a requirement** — from
here on I will state it as "expect roughly N" and keep the standing instruction
that the implementer's own arithmetic wins. Cost if wrong: nothing; a wrong hint
that the implementer is told to override costs one line in a report.

## Task 14 pre-flight (read before dispatch) — the heaviest pre-flight so far

Brief: `task-14-brief.md`, 316 lines. Test count claim of 5 verified. I ran the
real extraction myself rather than let the implementer discover these on Step 5,
because the brief tells it to **stop and investigate** on a count mismatch and
every one of the brief's counts is wrong.

Environment confirmed, so none of this is a blocker:
- `pdftotext` exists at `/home/daxtangco/.local/bin/pdftotext` (the rootless
  poppler wrapper) and is on PATH. Both PDFs are present and readable.
- `corpus/` is git-ignored at `.gitignore:8`, as the brief assumes.
- `pdftotext` prints ~80 `Syntax Error: Bad block header in flate stream` lines to
  **stderr** and still exits 0 with complete output (38954 lines for r9, 24548 for
  r10). `promisify(execFile)` rejects only on non-zero exit, so this is harmless —
  but an implementer seeing that wall of errors may think extraction failed. It
  did not.
- `execFile` takes an argv array, so the PDF path's spaces and parentheses need no
  quoting. Not a defect.

### Measured ground truth (mine, from the real PDFs)

| | r9 | r10 |
|---|---|---|
| unique lab ids | **32** | **33** |
| unique exercise ids | **96** | **87** |

Shared: **28 labs, 71 exercises → 99 cross-edition items.**
r9-only labs: `Lab 1.1, Lab 12.1, Lab 15.2, Lab 26.1`.
r10-only labs: `Lab 6.2, Lab 7.1, Lab 17.1, Lab 21.1, Lab 22.1`.

The brief's Step 5 expects `r9: 30 labs, 95 exercises` / `r10: 28 labs, 85
exercises` / `cross-edition: 112`. **Five of the six numbers are wrong.** Only
"28 shared labs" is right. The brief also asserts r10 has *fewer* labs than r9
(28 vs 30); in fact it has more (33 vs 32).

Ruling: **the counts stop being a gate and become a recorded measurement.** Why:
the brief's instruction "if the counts differ, stop and investigate rather than
adjusting the expectation" is sound reasoning applied to numbers that were never
measured, and obeying it literally sends the task to BLOCKED on its last step. My
figures come from the actual files and are reproducible from the commands in this
entry. Cost if wrong: the corpus is regenerable git-ignored output feeding
authoring, not the graded engine, so a miscount costs a re-run, not a rebuild. The
real correctness signal is the **body spot-check**, which the brief already has
and which I am strengthening.

### The substantive defect: the chapter terminator is dead code against both PDFs

`CHAPTER_RE = /^\s*Chapter +(\d+)[.\s]/` requires a character after the digits.
In the r9 text it matches exactly **28 lines, all of them in the table of
contents** (lines 245-894). The real chapter openings in the book's body look
like this — form feed, bare `Chapter N`, blank line, then the title on its own
line:

```
\fChapter 1
<blank>
Installing Red Hat Enterprise Linux
```

`[.\s]` cannot match end-of-line, so **no real chapter boundary in the body is
ever detected.** The comment in the brief ("RHCSA 9 uses `Chapter 15 `, RHCSA 10
uses `Chapter 15.`") describes the TOC, not the body. The test passes only
because `SAMPLE` uses the dotted TOC form that the body never uses.

Consequence: the last lab or exercise of every chapter runs on until the next
lab/exercise heading — which lives in the *following* chapter — bounded only by
`MAX_BODY_LINES = 120`. So roughly 28 items per edition carry up to 120 lines of
the next chapter's prose. That is corpus contamination on exactly the items an
author is most likely to reach for.

**Do not simply broaden the regex.** There are ~118 bare `Chapter N` lines in r9
against ~26 chapters. Every one I sampled was a genuine chapter opening, but the
surplus is unexplained and if any of them are running page headers, matching them
truncates every multi-page body at each page break — a worse failure than the one
being fixed. The implementer must establish what the surplus is before choosing a
pattern.

### Two more defects

- **The dedup test does not test dedup.** `deduplicates ids that appear in both a
  table of contents and the body` asserts only the *id list*, so it passes even if
  the implementation kept the *first* match instead of the longest. The
  `item.text.length > existing.text.length` comparison — the entire longest-wins
  rule — survives deletion.
- **`MAX_BODY_LINES` is untested.** No test exercises the cap, so it survives
  deletion, and it is the only thing standing between a missed heading and a body
  that swallows half a chapter.

Non-defects, recorded so they are not re-litigated: the unused `(Lab)` /
`(Exercise)` capture groups make the indices read oddly (`lab[2]`, not `lab[1]`)
but are harmless; the `for (let j …; j < end; …)` loop mutates `end` and then
breaks immediately, which is correct; `weightSignal` returning
`Record<string, string[]>` indexes to `string[] | undefined` under
`noUncheckedIndexedAccess`, which `toEqual` accepts.

Ruling: **mandate five changes** — replace the count gate with recorded
measurements plus a strengthened spot-check; fix the chapter terminator with
evidence; lock longest-wins; lock `MAX_BODY_LINES`; and use `pathToFileURL` for
the direct-invocation guard, matching the decision already made in Task 12.
Why: the terminator defect silently corrupts the corpus that every authoring task
downstream reads, and the two missing locks each guard a rule the brief states
explicitly in prose. Cost if wrong: one regex investigation, two tests, and one
import.

### Task 12 review — run by me after the reviewer went idle without reporting

Ruling: **I ran the review gate myself.** Why: `task-12-review` (sonnet) went idle
without delivering a verdict, a nudge produced nothing, and this is now the third
agent in this plan to finish its work and lose the report. The gate is mechanical —
five mutations, one verbatim-diff check, and a probe sweep — and rerunning it cost
less than re-dispatching and chasing. Cost if wrong: this is self-approval, so the
whole file goes back on the list for the final whole-branch review; every number
below is reproducible from the commands recorded here.

**Numbers, run not read:** 138 tests / 13 files, typecheck silent,
`test/cli/coverage.test.ts` = 10 tests. Working tree clean at `2ff65ac`. Diff is
`src/cli/index.ts` (124 lines), `test/cli/coverage.test.ts` (97), and three files
under the new `test/fixtures/bank-unresolved/`. Nothing else touched — confirmed
`git diff --stat 40e89cf..2ff65ac -- test/fixtures/bank/` is empty, so the fixture
whose exact counts the brief's first test pins was not perturbed.

**The brief's five tests survived verbatim.** Extracted each `it(...)` block from
the brief and substring-matched it against the test file: all five byte-identical,
no assertion weakened or retargeted.

**Mutation table (all reverted):**

| Mutation | Result | Caught by |
|---|---|---|
| M1 unknown args ignored instead of rejected | **caught**, 2 failed | `exits 2 with usage on an unknown option…` + `does not print the report when an unknown option is rejected` |
| M2 missing / flag-shaped `--content` value falls back silently | **caught**, 2 failed | `…when --content has no following value` + `…when --content is followed by a flag-shaped value` |
| M5 `problems` branch deleted | **caught**, 1 failed | `reports an unresolved reference as a problem, with counts still on stdout` |
| M3 `bank: Bank` annotation removed | 10 passed, **typecheck still CLEAN** | nothing — and that is the point |
| M4 `pathToFileURL` reverted to the hand-built string | 10 passed | nothing — false inside vitest by design |

M3's result is the evidence for the mandate rather than against it: stripping the
annotation leaves `tsc --noEmit` silent, which is precisely the claim ("evolving
`any`, which `noImplicitAny` does not flag"). It is preventive, not testable, and
the implementer was right to refuse to pad the suite. Same for M4, whose evidence
is the real invocation below.

**False-pass hunt: 18 probes, no false pass found.** Exactly one argv shape reaches
exit 0 — `coverage --content <dir>` on a bank with no `problems`. Everything else:

- `--strick`, `--Strict`, `-strict`, `--strict=true`, `--strict extra`, a bare
  positional `coverage BANK`, and `--content=<dir>` → **2**, usage on stderr, and
  `out` empty, so a rejected invocation cannot be mistaken for a clean report.
- `--content` with no value, and `--content --strict` → **2**.
- `--strict --strict` → **1** (idempotent, correct).
- A nonexistent directory, an empty directory, a *file* instead of a directory,
  `--content ""`, and the default `./content` (which does not exist yet) → **1**
  with a `ContentError`. `loadBank` wraps ENOENT rather than letting it escape, so
  the `throw e` rethrow at `src/cli/index.ts:69` is never reached — it is a genuine
  last resort, not a live path.
- `--strict` gates on `uncoveredObjectives.length + untaughtConcepts.length`
  (`:89`), so a bank with zero uncovered objectives but one untaught concept still
  fails. The `problems` check at `:83` precedes the `strict` check and returns 1
  regardless of `--strict`, which mandate 5's test locks.

**Real invocation (mandate 4's evidence):** `node src/cli/index.ts coverage
--content test/fixtures/bank` prints the eight report lines and exits **0**;
`node src/cli/index.ts` prints usage and exits **2**.

**Findings — both non-blocking, neither worth a fix round:**

- `src/cli/index.ts:40` — `--content ""` is accepted as an empty root, producing a
  message that begins with a bare `: 3 problem(s)`. Still exit 1, so it is
  cosmetic, but an empty string is never a root the user meant. Forward to Task 21,
  which extends this CLI with `validate`: reject an empty `--content` value in the
  same guard that already rejects a flag-shaped one.
- `src/cli/index.ts:69` — the non-`ContentError` rethrow is unreachable given
  `loadBank`'s boundary, and correctly so. Recorded so a future reviewer does not
  file it as dead code.

**Answer to "what breaks silently":** nothing in this diff, which is unusual and is
the point of mandates 1 and 2 — the two argument-parsing false-pass paths that
existed in the brief are now each locked by two tests. The residual risk is not in
the code but in the contract: exit 0 means "every reference resolves", **not**
"the bank is complete", and only `--strict` says the latter. Task 21 inherits the
job of making that distinction impossible to misread once `validate` shares the
same exit codes.

## Task 12: complete — `2ff65ac`

`src/cli/index.ts`, `test/cli/coverage.test.ts`, `test/fixtures/bank-unresolved/`.
**138 tests / 13 files**, typecheck clean. Spec compliance: APPROVED — the brief's
five tests verbatim, all five mandates applied, scope respected. Task quality:
APPROVED with two non-blocking findings forwarded to Task 21. Next: Task 13,
BASE `2ff65ac`.

## Task 13 dispatched — BASE `2ff65ac`, opus

Model choice: **opus**, one tier above the last several implementers. Justified
because this task's deliverable is transcribed fact rather than code, its ids are
permanent FSRS scheduling keys, and a wrong transcription is invisible to the test
suite — the failure mode is not "tests fail" but "tests pass on wrong data". The
four pre-flight mandates plus the anti-fabrication instruction (quote the table
heading and first/last row verbatim, state the real PDF page indices, disclose any
reliance on background knowledge) are the only evidence a reviewer will have, since
re-reading the PDFs to check is expensive.

### Correction to my own Task 14 pre-flight, made before dispatch

My pre-flight said the chapter terminator "never fires against either real PDF."
**That is wrong for RHCSA 10.** I re-extracted both texts and measured properly
while Task 13 was running:

| | body chapter opening | current `CHAPTER_RE` in body |
|---|---|---|
| r9 | form feed + bare `Chapter 8`, blank, title on next line (line 9467) | **dead** — all 28 matches are TOC, lines 245-894, and use a space not a period |
| r10 | `Chapter 9. Managing Software` on one line (line 8041) | **works** — 52 of 54 matches precede the last item |

So the defect is real but half as wide as I claimed: only RHCSA 9's ~26
end-of-chapter items over-run. `task-14-mandates.md` section 2 is rewritten to say
this, and the brief's comment turns out to be right about r10 and wrong about r9.

**I also resolved the mandate's own open investigation, which was its riskiest
instruction.** It warned that the ~118 bare `Chapter N` lines might be running page
headers, in which case broadening the regex would truncate every multi-page body at
each page break — worse than the bug. They are not page headers:

- r9: 118 bare lines = **31 with a form feed** (genuine body openings, 1722→29329)
  + **87 without**, all at line 29532+, all **Appendix A answer-section headings**
  (line 29529 is `␌  Appendix A`, then one indented `Chapter N` per chapter, twice).
  Indented, no trailing whitespace — hence invisible to the current regex.
- r9's last item heading is `Lab 26.1` at **29134**; its body cannot reach 29532
  even at full `MAX_BODY_LINES`. All 87 are past every item.
- r10's bare lines all sit at 22123+, past its last item (`Lab 25.1` at 21747).

Ruling: **broadening to a bare-form alternative is safe, and I am handing the
implementer the evidence rather than the investigation.** Why: this was a
multi-turn grep exercise whose wrong answer damages every body in the corpus, and I
had the texts open already. Cost if wrong: the mandate tells the implementer to
confirm my greps and says their measurement wins over mine if they disagree — so a
bad number of mine gets caught rather than inherited. Extracted texts left at
`/tmp/r9.txt` and `/tmp/r10.txt` so the confirmation is cheap.

### Task 13 report received — DONE_WITH_CONCERNS, commit `f14cc09`

`content/objectives.yaml` (68, rhel9), `content/objectives-rhel10.yaml` (62, rhel10),
`test/content/objectives-real.test.ts` (9 tests). **147 tests / 14 files**, typecheck
clean. Both brief bounds held; no test needed changing.

**My independent verification of its load-bearing provenance claims — all confirmed:**

- 147/14 and typecheck clean: reproduced.
- **The brief was wrong that both mapping tables are images.** RHCSA 9's Table 1 is
  machine-readable (`pdftotext -layout -f 39 -l 40` → 35 lines of letters); RHCSA
  10's pages 43-48 return **zero** letters. Only the RHEL 10 table is an image.
- Caption `Table 1 Coverage of RHCSA Objectives`, headings `Objective | Chapter
  Title | Chapter`, first row `Access a shell prompt… | Using Essential Tools | 2`,
  last row `Attach persistent storage to a container | Managing Containers | 26` —
  all four verbatim in the source as reported.
- The two blank-chapter rows (`Manage default file permissions`, `Manage SELinux
  port labels`) really do have empty cells in the book. Not an extraction artifact.
- YAML counts 68 / 62 as claimed.

The implementer disclosed rather than hid its two discretionary decisions, and both
are nominated for review: adding four `Manage software` RPM/Flatpak objectives that
Table 1 omits, and adding hyphen folding to mandate 4's normalizer. Reviewer
dispatched on opus with these as priorities 2 and 3, plus a genuine row-by-row
reconciliation as priority 1 (cheap now that the r9 table text is at `/tmp/r9tab.txt`).

### PROJECT-LEVEL FINDING — escalating to the user, not ruling on it

**Red Hat's published EX200 objectives page is already the RHEL 10 set.** Fetched
successfully 2026-08-30: 62 bullets, no `Manage containers` section, a new `Manage
software` section with the RPM/Flatpak objectives. It matches
`objectives-rhel10.yaml` bullet for bullet, and its bullet count is an independent
confirmation of that file's 62.

This is risk **R2 already realized on Red Hat's side**, which the plan treats as a
future possibility to hedge. Consequences:

1. The contractual objective list is now the RHEL 10 one, whatever the VM runs — and
   the user's VM is RHEL 9.
2. Authoring content against `objectives.yaml` inherits **10 objectives Red Hat no
   longer lists** (8 `containers.*` + `files.permissions.set-gid` +
   `selinux.troubleshoot.violations`) and **misses 4 it does** (RPM/Flatpak).
3. The brief's rule "Red Hat's wording wins over the book's" is now unusable for the
   rhel9 file — applying it would turn `objectives.yaml` into the rhel10 file. The
   implementer correctly applied it only to the rhel10 file and recorded why.

Ruling: **do not stall the loop, and do not swap the taxonomy on my own authority.**
Why: which exam version the user sits is theirs to decide, not a plan-internal
conflict I can settle from the spec — and it is cheap to defer because 52 of 62
objectives are shared, Tasks 14-20 are edition-agnostic (corpus extraction, VM,
control plane), and Phase 1's exit criterion is an LVM lab that is identical in both
editions. Cost if wrong: if the answer is RHEL 10, the FSRS scheduling keys should be
the rhel10 file's, and the swap gets more expensive the moment bulk content exists —
so this must be answered **before the content-authoring tasks**, not after Task 24.
Surfaced to the user now; the loop continues meanwhile.

Carried to the content-authoring tasks: the six superseded ids
(`tools.archive.tar` → `tools.archive.tar-gzip-bzip2`, `storage.partitions.mbr-gpt`
→ `storage.partitions.gpt`, `sys.cron.schedule` → `sys.cron.schedule-systemd-timers`,
`pkg.dnf.install` → `pkg.dnf.install-cdn`, `net.firewall.restrict-access` →
`net.firewall.restrict-access-firewalld`, `users.sudo.superuser` →
`users.sudo.privileged`) need an explicit old→new map if the project ever migrates,
because review history keyed on the old ids would otherwise be orphaned. The `#`
comments in both files record every pairing needed to build it.

Also carried to the plan narrative: nobody should budget visual-read effort for the
RHEL 9 table again, and the RHEL 10 table needs `pdfimages` rather than page
rendering — calibre places each of its six JPEGs across two consecutive PDF pages, so
rendering pages clips every row at both seams and silently loses rows.

### Task 13 review (opus) — both verdicts APPROVED WITH FINDINGS, nothing blocking

This reviewer did the work rather than reading the report back to me. It
independently reconciled **68/68** RHEL 9 rows (machine-diffed, positional *and*
set-wise: 0 text mismatches, 0 chapter disagreements, 0 orphans either way),
transcribed all **58** RHEL 10 Table 1 rows from the six extracted JPEGs itself,
ran its own `WebFetch` and got a **62/62 byte-exact positional match** against Red
Hat's published page, verified the section arithmetic from the parsed source
(`11+4+10+6+6+6+4+4+9+8 = 68`), confirmed the RHCSA 9 chapter 7 and 22 openers
supply the two blank-cell chapters, confirmed the same six `pdfimages` object ids
(1908-1918, two placements each), and confirmed all four stale-opener
counter-examples the implementer had raised against its own judgment call. It
finished with the tree clean, 147/14 green and typecheck silent, re-run *after* the
last revert.

**Ten mutations. Seven caught, three not — and the three are one gap.**

| caught | mutation |
|---|---|
| yes | reuse an rhel9 id for a substantively different rhel10 text → test 9 |
| yes | delete the `containers.*` block → test 4 |
| yes | drop "visually" from `source:` → test 2 |
| yes | remove the hyphen fold → test 9, exactly 2 divergences, both orthographic |
| yes | reword a *shared* rhel9 text → test 9 |
| yes | delete the four `Manage software` entries → test 8 |
| yes | duplicate an id → loader `ContentError` |
| **NO** | **merge two Table 1 rows into one entry (68→67)** |
| **NO** | **silently change a `chapters:` value** |
| **NO** | **reword a rhel9-*only* `text:`** |

The three uncaught mutations are the same defect: **nothing locks transcription
fidelity**, which is the entire deliverable. The brief claims at its line 151 that
the 20-80 count bound "exists to catch merged or split bullets" — it does not; 20-80
leaves 60 units of slack around a 68-row table.

**Rulings:**

1. **The four `Manage software` RPM/Flatpak objectives stay. RATIFIED.** Why: the
   brief's own source priority ranks Red Hat's published objectives *above* the
   book's Table 1, so including them obeys the brief rather than departing from it;
   Table 1's own `…Red Hat Content Delivery Network…` row maps to `Managing
   Software / 9`, so `chapters: [9]` never rested on the chapter 9 opener alone; and
   58+4 = 62 = Red Hat's published count, while 58 matches nothing. Mandate 2
   therefore does not fire — the `flatpak` assertion passes on the source's own
   authority, and mutation M9 shows it is load-bearing rather than vacuous. Cost if
   wrong: four objectives too many in a file nothing loads yet.
2. **The hyphen fold beyond mandate 4's three folds stays. RATIFIED.** Why: with the
   fold removed the only two divergences are `multiuser`/`multi-user` and
   `nondestructively`/`non-destructively` — purely orthographic — while every
   word-level change is still caught. Mandate 4's stated intent is that cosmetic
   rewording passes and substantive rewording fails, and the fold serves it better
   than its literal text. Forking two permanent FSRS scheduling keys over two
   hyphens is the wrong trade. Cost if wrong: a future edition could hide a
   meaningful hyphen-only distinction; the reviewer could not construct one.
3. **The `tools.shell.essentials` split was correct and is not charged against the
   implementer.** Table 1 has two distinct chapter-2 rows. The brief's worked example
   pairs that id with a chapter-4 grep objective — the example is itself defective
   (F9).
4. **F1 and F8 get fixed now, not deferred.** Why: no later task owns this file, so
   "defer the golden fixture" means it never happens, and the artifact whose fidelity
   is unenforced is the one whose ids are permanent. Cost if wrong: one extra data
   fixture to regenerate whenever the taxonomy legitimately changes — which is
   exactly the review signal I want.
5. **F3-F6 (four permanent-id corrections) get fixed now.** Why: free today because
   nothing loads the rhel10 file and no content exists, permanent the moment the
   first content task lands. That asymmetry is the whole argument.

Fix round 1 dispatched to the original implementer (resumed, opus, full context):
F1, F2, F3, F4, F5, F6, F7-nit, F8 in one commit.

**Brief/plan defects — not charged against the implementer, recorded for the final
review:**

- **F9** `task-13-brief.md:34-36`: the worked example pairs `id:
  tools.shell.essentials` with `text: Use grep and regular expressions to analyze
  text` / `chapters: [4]`. That text is a chapter-4 grep objective, not a shell one.
- **F10** `task-13-brief.md:3,20` and `task-13-mandates.md:33-34`: "both mapping
  tables are rendered images" and "do not use `pdftotext`" are false for RHCSA 9,
  whose Table 1 is machine-readable text. Only the RHCSA 10 table is an image, and it
  needs `pdfimages` rather than page rendering. Also: the brief's area list has no
  scripts area, so `tools.script.*` was minted here — record it as part of the
  vocabulary.
- **F11** test 2's `toMatch(/visual/i)` passes for any string containing "visual",
  including one that overstates provenance. That is how F2 got through. No mechanical
  test fixes this; it is a review responsibility. Noted so a green test 2 is never
  mistaken for a provenance check.

### Task 13 fix round 1 — `08cd2d9`, all eight findings closed

Ruling: **I ran the scoped re-review myself rather than spend a fourth reviewer
seat.** Why: the fix diff is mechanical (four id renames, one `source:` rewording, a
`.trim()` move, two count assertions, one golden test plus two generated fixtures)
and every claim in the fix report is checkable in two commands. Cost if wrong: the
file is already on the final whole-branch review list; every number below is
reproducible.

**Verified, run not read:**

- **150 tests / 15 files** green, typecheck silent, tree clean.
- **The renames touched ids only.** `git diff f14cc09..08cd2d9 -- content/` changes
  **zero** `text:` or `chapters:` lines. All four new ids present with the right
  occurrence counts (7 total); all four old ids gone from `content/` and `test/`.
- **Exact counts asserted:** `toBe(68)` and `toBe(62)`, replacing the 20-80 bound
  that mutation M4 proved toothless.
- **The golden fixtures are machine-generated, not hand-transcribed.** I regenerated
  both from the YAML through `loadObjectives` and compared to the committed files:
  **byte-identical**, 68 and 62 entries. This was the one claim most worth checking,
  because a hand-copied fixture would reintroduce exactly the transcription risk the
  test exists to close.
- **My own mutation** (a `chapters: [15]` → `[14]` edit) → **1 failed / 149 passed**,
  caught by the golden test alone, tree restored clean afterwards. This independently
  reproduces the implementer's mutation 1 and confirms the gap is closed.

The implementer's own three mutations were real suite runs, and its analysis is
sharper than mine was: mutation 3 (a merged pair) fired three tests only *because it
merged two shared ids* — a merge of two RHEL 9-only bullets would be caught by the
exact count and the golden test alone. That is the correct reading.

## Task 13: complete — `f14cc09` + `08cd2d9`

`content/objectives.yaml` (68, rhel9), `content/objectives-rhel10.yaml` (62, rhel10),
`test/content/objectives-real.test.ts` (10 tests), `test/content/objectives-golden.test.ts`
(2 tests), `test/fixtures/objectives-rhel{9,10}.golden.json`. **150 tests / 15 files**,
typecheck clean. Spec compliance: APPROVED. Task quality: APPROVED. Next: Task 14,
BASE `08cd2d9`.

**Parked to the final whole-branch review** (plan/brief defects, not work defects):
F9 (the brief's worked example pairs `tools.shell.essentials` with a chapter-4 grep
objective), F10 (the brief's "both tables are images" premise and mandate 1's "do not
use `pdftotext`" are false for RHCSA 9; record `tools.script.*` as part of the
vocabulary since the brief's area list has no scripts area), F11 (test 2's
`/visual/i` cannot detect an overstated `source:` — a review responsibility, not a
mechanical one).

**Parked to the first content-authoring task — a deadline, not a suggestion:** the
id-shape window closes the moment any content references an id. Still arguable:
`users.login.switch` (filed by topic though Red Hat lists it under "essential
tools") and the four `tools.script.*` ids. Any further id review must happen before
that task, and the RHEL 9-vs-RHEL 10 taxonomy decision must be answered there too.

## Task 14 dispatched — BASE `08cd2d9`, sonnet

Model choice: **sonnet**, down a tier from Task 13. Justified because the brief
contains the complete implementation — this is transcription plus testing — and the
one genuinely judgment-heavy part (mandate 2's chapter terminator) has had its
investigation resolved and handed over with line numbers. What remains is confirming
my measurements, choosing a pattern, and three break-and-revert proofs. The extracted
texts are pre-staged at `/tmp/r9.txt` and `/tmp/r10.txt` so the confirmation is cheap.

### Late-arriving Task 12 review — it found something my own gate missed, and corrected me

`task-12-review` delivered after all (same lost-child delay as `task-11-rereview`).
Both verdicts **APPROVED**. Its mutation table matches mine exactly on all five
mandates and its false-pass hunt independently found no path to a false exit 0,
including a synthetic fixture I did not build: 0 uncovered objectives + 1 untaught
concept under `--strict` → exit 1, proving the gate sums both quantities rather than
being fooled by either being zero.

**It found a real gap I missed.** Moving the `--strict` check *above* the `io.out`
block → **138/138 still pass.** The brief's `--strict` test asserts only on `c.err`,
never on `c.out`. So a refactor could silently stop printing the coverage report on
the `--strict` failure path and no test would flag it — a CI user would get pass/fail
with no diagnostic list of *which* objectives and concepts are gapped.

My own 18-probe hunt was exhaustive on **exit codes** and blind to **stdout content
on the failing path**. Recording the shape of that blind spot, because it generalizes:
I was testing the gate's verdict, not the gate's output.

Ruling: **forward to Task 21 rather than fix now.** Why: it is a one-line assertion
(`expect(c.out.join('\n')).toMatch(/tasks: \d/)` added to the existing `--strict`
test), Task 21 is the task that next extends this exact file with `validate`, and
committing to `src/cli/`or `test/cli/` right now would interleave with Task 14's
in-flight work and muddy its review diff. Cost if wrong: the gap persists a few tasks
longer in a CLI only I run.

**Correction to my own Task 12 ledger entry.** I wrote that M3 (removing the
`bank: Bank` annotation) leaving typecheck clean "is the evidence for the mandate
rather than against it." **That is wrong.** The reviewer went a step further than I
did: with the annotation removed it injected a typo at the real usage site
(`bank.thisFieldDoesNotExist`) and **TS still caught it (TS2339)**, because
control-flow analysis narrows from `loadBank`'s own return-type annotation. So
mandate 12.3's stated rationale — "evolving `any`, which `noImplicitAny` does not
flag" — does not hold for this code shape. The annotation is harmless
defence-in-depth, and the conclusion that no runtime test is possible still stands,
but my justification for requiring it was factually wrong.

The lesson, which applies to every mandate I write from here on: **I asserted a
type-safety rationale without testing it, and my verification was weaker than the
reviewer's.** Observing "typecheck stays clean when the annotation is removed" does
not distinguish "the annotation was load-bearing" from "the annotation was
redundant" — only injecting the error the annotation is supposed to catch does that.
Do not state a mechanism in a mandate unless I have made it fail.

## Task 14 — report received (`4986837`), controller verification before review

Status reported: **DONE_WITH_CONCERNS**. Concern is about *my* mandate 1, not the code.

Gates I ran myself before packaging the review:
- `npx vitest run` → **158 tests / 16 files** passing. `npm run typecheck` → silent. Tree clean.
- `git ls-tree -r 4986837 --name-only | grep -c '^corpus/'` → **0**. Nothing under `corpus/` was committed — the constraint that actually mattered (regenerable output derived from copyrighted PDFs).

### Ruling: ratify the unauthorized `.gitignore` change — `corpus/` → `/corpus/`

The brief's "Out of scope" said *"Only the script and its test are committed."* The implementer also changed `.gitignore`. I checked why: the unanchored pattern `corpus/` matches a directory named `corpus` **at any depth**, so it was silently ignoring `test/corpus/` — the directory holding this task's *required* test file. Verified now: `git check-ignore -v test/corpus/extract.test.ts` exits 1 (not ignored) and `git ls-files test/corpus/` lists the test. The diff is exactly one character.

**Ruling:** ratify. — Why: without it the mandated deliverable was uncommittable, so the change was load-bearing for the brief's own requirement, and it is the minimal form (root-anchor rather than a negation or an exclusion). The implementer disclosed it in its own section rather than burying it. — Cost if wrong: a future directory literally named `corpus` nested anywhere is no longer blanket-ignored and could be committed by accident. Accepted; the report already forwards this warning.

### Self-correction: **mandate 1's count table was mine and it was wrong.**

I told the implementer r9 = 32 labs / 96 exercises, r10 = 33/87, 99 cross-edition, and that five of the brief's six numbers were wrong. The implementer measured 30/95, 28/85, 112 — the brief's original numbers — diagnosed the discrepancy in *my* reproduction pipeline, and invoked my own "your measurement wins" instruction.

I reproduced the diagnosis independently just now. `pdftotext -layout` prefixes some heading lines with a raw form feed (`\x0c`). My pipeline's `tr -s ' '` squeezes only the space character and `sed 's/^ //'` strips only a literal leading space; neither touches `\x0c`, so `␌Lab 6.2` and `Lab 6.2` survived as two distinct byte strings and `sort -u` counted the same id twice. Adding `tr -d '\014'` to my own pipeline:

| | r9 labs | r9 ex | r10 labs | r10 ex |
|---|---|---|---|---|
| my mandate-1 pipeline (buggy) | 32 | 96 | 33 | 87 |
| same pipeline + `tr -d '\014'` | **30** | **95** | **28** | **85** |

`comm -12` on the FF-stripped id sets: **28 shared labs + 84 shared exercises = 112 cross-edition** — the report's figures and the brief's, exactly. Every number in mandate 1's table is wrong; every number in the brief's Step 5 was right.

**Ruling:** the measured baseline recorded in `scripts/extract-corpus.ts` (30/95, 28/85, 112) stands as the regression anchor. Mandate 1's table is void and must not be resurrected. — Cost if wrong: none identified; three independent methods agree (the script, the implementer's `findItems`-free Python canonicalization, and my corrected shell pipeline).

**The generalizable lesson, and it is now the second instance in two tasks.** Task 14 mandate 2 asserted a mechanism I had never made fail; mandate 1 asserted counts from a pipeline I had never validated against a known-good count. Both times I handed an implementer a confident number that was wrong, and both times the "your measurement wins" escape clause is the only reason it cost nothing. **A measurement I have not cross-checked by a second method is not evidence, and putting it in a mandate makes it authoritative to someone who cannot see how I got it.** Cross-check, or label it as unverified in the mandate itself. This is the same defect class as the recurring one: reporting success when the thing was not actually done.

Credit where due: the implementer did exactly what the mandate asked — reproduced, disagreed, diagnosed to the byte, cross-verified by an independent method, and acted on its own measurement rather than mine.

Review package: `review-08cd2d9..4986837.diff` (12821 bytes). Dispatching task reviewer.

## Task 15 — mandates prepared while Task 14's review runs

Brief extracted (265 lines; the whole checklist body is in it verbatim). Wrote `task-15-mandates.md` with six required changes. Two are real cross-task conflicts my pre-flight scan missed, and both are recorded here as rulings.

### Ruling: Task 15 **creates** `README.md`; the brief's "Modify" is wrong

Evidence: `git ls-files | grep -i readme` → nothing; the file is absent from the working tree; `docs/` holds only `superpowers/`. Every `README` mention in the plan is Task 15 or Task 25, Task 25 opens *"The README from Task 15 covers building the VM"* and appends after it, and the plan's file tree (line 55) labels the file `T15 + T25`. So no task creates it and two tasks append to it.

**Ruling:** Task 15 creates it, with a short head — title, two sentences of purpose, a Requirements list (Node 22+, VMware Workstation, WSL2, RHEL 9 DVD ISO) — above the brief's `## Getting started`, so Task 25's append lands in a real document rather than after an orphan heading. — Why: the plan's file tree assigns the file to T15 and Task 25's own opening sentence presumes it already exists, so "create" is what the plan meant. — Cost if wrong: a README head someone rewrites later. Trivial.

### Ruling: §6 must ask the user for **two** variables, not four — Task 19 supplies the rest

The brief's §6 shows a four-variable `.env.local` block and then, one paragraph later, tells the user to fill in only two. Task 19's `provision.sh` settles it: it writes the template itself when the file is absent (its own comment: *"Nothing earlier in the plan can create .env.local usefully: RHCSA_VM_IP is discovered by provisioning"*), it discovers the IP with `vmrun getGuestIPAddress -wait` and **appends `RHCSA_VM_IP=` to `.env.local` itself**, and the config loader defaults `RHCSA_SSH_USER` to `student` (plan line 4892).

**Ruling:** §6 asks for `RHCSA_VMX` and `RHCSA_GUEST_PASSWORD` only, states that `provision.sh` creates the template and records the IP, and notes `RHCSA_SSH_USER` matters only if the study user was not named `student`. §3 step 4's *"Note the IP address — `provision.sh` needs it once"* is factually wrong and becomes a DHCP sanity check instead. — Why: the checklist would otherwise instruct the user to hand-write a value they cannot know at that moment and that a later script overwrites; a document whose first instruction is unfollowable is worse than no document. — Cost if wrong: if Task 19 is later changed to require a hand-set IP, one paragraph changes.

**This is a pre-flight scan miss, and it is the second interface conflict to surface during execution rather than during the scan.** My scan's row for T15↔T19 recorded that T19 consumes `.env.local` from T15 §6 — it matched the *file* on both sides and never compared the *variable list* on one side against the writes on the other. A shared-file row is only checked when it names what one side writes and what the other reads, field by field. Recording that so the final review can look for the same shape elsewhere.

### Four smaller mandates
- **Firmware fallback.** §1 step 7 states `Firmware: BIOS` as a wizard page that may not appear for this guest OS, and firmware cannot be changed after install without breaking the boot path — the one omission in the document that costs a full reinstall. Added: VM → Settings → Options → Advanced → Firmware type, set before first power-on.
- **README step 4 is honest about a failing command.** `node src/cli/index.ts coverage` exits **1** today with two ENOENT problems (`content/tasks`, `content/concepts`) because no content is authored. Verified by running it. The README must say that is the expected result, not hand a reader a command that fails unexplained. Explicitly forbade "fixing" it with placeholder directories — Task 13 considered and rejected those.
- **Throwaway-credential note.** §6 puts `student`'s password in plaintext at the repo root. Kept, because it is a disposable local lab, but the document must say so and must offer the `read -rsp` + export alternative that `provision.sh` already supports. The prohibition on Red Hat account credentials in any repo file survives verbatim in substance.
- **Step 3's self-consistency check extended from three items to six**, each requiring a named action rather than "verified by inspection": every env var is one the user is told to set or is identified as script-set; every script path is committed or labelled with its creating task (checked with `ls` — `guest-provision.sh`, `provision.sh`, `r1-probe.sh` all still absent, all already labelled); and every runnable README command's real output pasted into the report.

Out of scope, stated explicitly: no `src/`, `test/`, `content/`, `scripts/` or `package.json` changes; **no creating `.env.local`** (Task 19 owns the template, and creating it here would kill `provision.sh`'s absent-file branch and silently change which of its two documented stop points the user hits); no test, because a test over this document's prose would lock its wording against every future edit for no benefit.

Task 15 dispatches once Task 14's review closes. Model: sonnet — the document is transcription, but six mandates rewrite it with reasoning, and the floor for prose work is mid-tier.

## Task 14 — review returned both verdicts; fix round 1 dispatched

Reviewer (sonnet) wrote `task-14-review.md` (9.7K). **Verdict 1 — spec compliance: satisfied**, all five mandates plus the brief's five original tests plus its out-of-scope constraints. **Verdict 2 — task quality: good, with two real test-adequacy gaps** found by going beyond the three proofs the implementer had already run.

What the reviewer reproduced independently rather than taking on trust:
- All three mandate mutations: exactly 1 failure each, the correct test named each time, `git diff --exit-code` clean after each revert.
- `npx vitest run` → 158/16. `npm run typecheck` → silent. `git ls-tree -r 4986837 | grep -c '^corpus/'` → 0.
- The real extraction run: 30/95, 28/85, 112, with `corpus/signal.json` showing 28 shared labs + 84 shared exercises.
- **Mandate 2's safety argument down to the line numbers** — the assumption whose failure would silently corrupt output rather than crash. r9: 31 form-feed bare-chapter matches (28 genuine openings, lines 1722–29329, plus 3 strays at 29572/35430/36207) and 87 indented Appendix matches all ≥29532, every one past r9's last item heading (`Lab 26.1`, 29134); r10's 88 all ≥22123, past `Lab 25.1` at 21747. The implementer's "28 genuine + 3 stray" refinement of my "31 genuine" claim is confirmed correct.
- **F4 — the one-sided-assertion pattern I asked it to hunt for does not bite here.** The `stops an item body at the next heading` test asserts only `not.toMatch`, the same shape as Task 12's stdout/stderr blind spot. The reviewer mutated `nextHeading` out of the body-end `Math.min` and the test caught it at once, because the content that gets swallowed is exactly what the assertion excludes. Closed by reproduction, not by argument. Good — the pattern is worth checking every time, and this is the first time it came back negative.

### Ruling: fix F1 and F2 now, in one test-only round

**F1 — `scripts/extract-corpus.ts:93-94`, body normalization is completely unlocked.** Deleting both `.replace(/\n{3,}/g, '\n\n')` and `.trim()` leaves all 8 tests green; deleting `.trim()` alone also leaves all 8 green. No assertion in the file touches leading/trailing whitespace or runs of blank lines.

**F2 — `scripts/extract-corpus.ts:108`, the final `.sort(...)` in `findItems` is unlocked.** Deleting it leaves all 8 green, because every fixture's headings already appear in id order, so `Map` insertion order coincides with sorted order by accident.

**Ruling:** close both now rather than forwarding. — Why: no later task owns `scripts/extract-corpus.ts`, so there is no cheaper moment; both fixes are pure test additions with zero risk to the script; and F1 is not cosmetic — against real `pdftotext` output, trailing blank lines before the next heading are the *common* case, so `.trim()` does real work on nearly every item and could silently stop. — Cost if wrong: one small commit of tests nobody needed.

**F3 — forwarded to the final whole-branch review, deliberately not fixed.** At `scripts/extract-corpus.ts:47-53` the capture-group accesses (`lab[2]`, `lab[3]`, `ex[2]`, `ex[3]`) are `string | undefined` under `noUncheckedIndexedAccess` with nothing narrowing them. It compiles only because `Number(...)` and a template literal both swallow `undefined` without a type error — yielding `NaN` or the literal string `"undefined"` at runtime instead of a compile-time signal. Safe today (a non-optional capture group in a successful match is always defined), the mandates forbid touching these regexes, and the reviewer agrees no change is warranted. A small `isMatch` type predicate is the house-consistent narrowing when a later task next touches these functions. **Added to the final-review list.** Note this is a sixth instance of the same shape as the five parked guarded-union casts — the `oneOf` predicate helper planned there should be checked for whether it covers this case too.

Fix round 1 dispatched to `task-14-impl` (round ≤3, so the same agent resumes with its context). Test-only: told explicitly that if a new test fails against the current script, the test is wrong and it must stop and report rather than change behaviour. Each new test must be proven by mutation the same way the last three were.

## Task 14 — fix round 1 verified by self-run gate; F6 found; round 2 dispatched

`b12b867` "test(corpus): lock body normalization and id ordering in findItems". +54 lines, **`test/corpus/extract.test.ts` only** — `git diff 4986837 b12b867 -- scripts/extract-corpus.ts` is **0 bytes**, so the test-only constraint held. 161 tests / 16 files. Typecheck clean. Tree clean.

I gated this round myself rather than dispatching a scoped re-review: the diff is three tests in one file with a provably unchanged script, and the gate is entirely mutation work I can run directly. All three reproduce exactly, each naming the intended test with the other ten green:

| mutation | failing test |
|---|---|
| delete line 93, the `\n{3,}` collapse | `collapses three or more consecutive blank lines inside a body to a single blank line` |
| delete line 94, `.trim()` | `trims leading whitespace from an indented heading and trailing whitespace from the body` |
| line 108 → `return [...best.values()]` | `returns items sorted by id even when headings appear out of order in the source text` |

`git diff --exit-code` clean after each revert. The implementer's decision to split F1 into **two** tests, one per operation, is better than the review's suggestion of a single combined assertion — a combined test would have let either operation cover for the other, which is the exact defect shape we have been closing.

### F6 — a fourth unlocked thing, found by my own probe inside the test just written

`scripts/extract-corpus.ts:108` — removing only `, 'en', { numeric: true }` from the `localeCompare` leaves **11 passed (11)**. Nothing notices.

It is load-bearing on the real data, because the *chapter* number in an id is multi-digit and lexical collation puts `'Exercise 10-1'` before `'Exercise 2-1'`. Measured against the real `corpus/r9/exercises.json`:

```
lexical first 8: Exercise 10-1, Exercise 10-2, Exercise 10-3, Exercise 10-4, Exercise 11-1, ...
numeric first 8: Exercise 2-1, Exercise 2-2, Exercise 2-3, Exercise 2-4, Exercise 2-5, ...
positions that differ: 95 of 95
```

**Why F2's brand-new test does not catch it, and this is the generalizable part.** The fixture uses `Exercise 24-2` and `Exercise 24-1` — a pair that sorts identically under both collations. So the test distinguishes *sorted* from *insertion-ordered* and cannot distinguish *numeric* from *lexical*. It locks that a sort happens, not which sort. **An assertion satisfied by more implementations than the one you meant is the same defect as no assertion at all, and writing a test to close a false pass is not proof that the new test has no false pass of its own.** The fix that closes a gap deserves the same mutation scrutiny as the code it is fixing — F2's test was itself mutation-proven, and the proof was sound for the mutation it was aimed at and blind to the neighbouring one.

Also worth recording: no real corpus id has a two-digit *item* suffix (0 of 95, 0 of 30, 0 of 85, 0 of 28), so the `Lab 5.10` case that first drew my eye is hypothetical. The chapter-number case is what makes this real, and I only found it by checking the actual output instead of reasoning about the id shape.

**Ruling:** fix now in round 2. — Why: one-line fixture change that makes an existing test strictly stronger, and no later task owns this file. — Cost if wrong: nothing; the test either locks the collation or it does not, and the mutation proof settles which.

Dispatched to `task-14-impl` (round 2 of 5, same agent resumes). Required both mutations: delete `{ numeric: true }` **and** delete the whole `.sort(...)`, so F2's original lock must survive the edit. Told it either extending the test or splitting it is fine, but not ending up with a test that catches only one of the two.

## Task 14: complete

Commits: `4986837` (implementation) → `b12b867` (fix 1, F1+F2) → `bddbe8f` (fix 2, F6). **161 tests / 16 files.** Typecheck clean. Tree clean.

Deliverables: `scripts/extract-corpus.ts` (180 lines) and `test/corpus/extract.test.ts` (11 tests), plus the one-character `.gitignore` anchor. Nothing under `corpus/` committed. The script is byte-identical across both fix rounds — `git diff 4986837 bddbe8f -- scripts/extract-corpus.ts` is 0 bytes — so both rounds were genuinely test-only, as instructed.

Measured corpus baseline, now recorded in the script as the regression anchor: **r9 30 labs / 95 exercises, r10 28 labs / 85 exercises, 28 shared labs + 84 shared exercises = 112 cross-edition.** Confirmed by three independent methods (the script, a `findItems`-free Python canonicalization, and my corrected shell pipeline).

### Round 2's fix, and why it is elegant

One fixture change closed both F2 and F6 with a single assertion. The fixture puts `Exercise 10-1` first in the source and expects `['Exercise 9-1', 'Exercise 10-1']`. That expectation matches neither insertion order **nor** a plain lexical sort — both give `[10-1, 9-1]` — so deleting `.sort(...)` entirely and deleting only its `{ numeric: true }` option each fail the same assertion. The comment in the test spells out the collation arithmetic (`'1' < '9'` lexically, `9 < 10` numerically) so the choice of chapter numbers does not look arbitrary to whoever reads it next.

### Final gate: six mutations, all run by me

| mutation | failing test(s) |
|---|---|
| delete only `, 'en', { numeric: true }` | the numeric-collation test |
| delete the whole `.sort(...)` | the numeric-collation test |
| delete `.trim()` (line 94) | the leading/trailing-whitespace test |
| delete the `\n{3,}` collapse (line 93) | the blank-line-collapse test |
| terminator → `CHAPTER_RE` only | the bare form-feed chapter-opening test |
| chapter-terminator loop made a no-op (`end = j` → `end = end`) | the bare-chapter test **and** the longest-body-wins test |

One failure each except the last, which fails two — correctly, since a body that never stops at a chapter boundary also stops being the shorter of the two dedup candidates. `git diff --exit-code` clean and `git status --porcelain` empty after every revert.

I ran M5 and M6 only after noticing I had written a "chapter terminator still locked" label into an earlier command without actually running that mutation. Caught before it reached the ledger, but worth recording: **the label almost became a claim, and a claim I had not run is the exact defect class this project keeps finding.** Write the check, run the check, then write the label.

### Forwarded from Task 14

- **F3 → final whole-branch review.** `scripts/extract-corpus.ts:47-53`: capture-group accesses (`lab[2]`, `lab[3]`, `ex[2]`, `ex[3]`) are `string | undefined` under `noUncheckedIndexedAccess` with nothing narrowing them; it compiles only because `Number(...)` and a template literal swallow `undefined` without a type error, yielding `NaN` or the string `"undefined"` at runtime rather than a compile-time signal. Safe today; the mandates forbid touching these regexes. A small `isMatch` type predicate is the house-consistent narrowing — **check whether the planned `oneOf` helper for the five guarded-union casts covers this shape too, making it six sites, not five.**
- **Mandate 1's table is void.** Do not resurrect 32/96/33/87. The form-feed dedup bug is diagnosed in `task-14-report.md`.
- **The three stray form-feed bare `Chapter N` lines in r9** (29572, 35430, 36207) are harmless only because they sit past the last real item heading (`Lab 26.1`, 29134). If a future edition moves real content past ~line 29000, re-verify.

Next: Task 15 (VM build checklist), mandates already written. Dispatching now.

## Task 16 — mandates prepared while Task 15 runs; **risk R1 is largely answered already**

Brief extracted (186 lines). Wrote `task-16-mandates.md` with seven required changes. This time I measured everything myself first and pasted the real output into the mandates, with the "your measurement wins" clause kept — after being wrong twice, a mandate that asserts without showing its command is not something I will write again.

### The headline: **WSL2 can reach the VMnet8 subnet.** R1 does not reproduce on this host.

Measured facts, all read-only:

- `vmrun.exe` is where the plan says. `"$VMRUN" list` → `Total running VMs: 0`.
- Two VMs exist: `Ubuntu 64-bit.vmx` and `Windows 11 x64.vmx`, both under `/mnt/c/Users/DaxAxisTangco/Documents/Virtual Machines/`. The Ubuntu path contains **two spaces**. `listSnapshots` → `Total snapshots: 0`, no `.vmss`, so it is powered off rather than suspended.
- **WSL2 sees no VMnet adapter at all** — `ip -4 addr show` is `lo` plus `eth0` at `172.22.101.110/20`, full stop. Expected and permanent: WSL2 is its own Hyper-V guest behind its own NAT; VMnet8 is a Windows *host* adapter.
- **VMnet8 addressing, discovered two independent ways that agree:** `ipconfig.exe` reports the VMnet8 adapter at `192.168.70.1/24`, and `/mnt/c/ProgramData/VMware/vmnetnat.conf` contains `ip = 192.168.70.2/24`. So subnet `192.168.70.0/24`, host adapter `.1`, NAT gateway `.2`, guest DHCP range `.128–.254`.
- **`ping -c 3 -W 2 192.168.70.1` → 3 received, 0% loss, ~1.1 ms**, routed `via 172.22.96.1 dev eth0`. Pinging the NAT gateway `.2` gets 100% loss, which is normal — the vmnet NAT device does not answer ICMP from outside the guest subnet, and its silence is not evidence.

Reaching the VMnet8 host adapter is the specific fear R1 names, and it does not reproduce. What remains genuinely untested is whether a *guest* inside that subnet accepts inbound TCP, which is guest-side `firewalld`, not host routing.

### The most valuable mandate: **the brief's binary TCP verdict cannot express the answer**

The brief collapses four distinct situations into one `else` and discards the evidence that separates them by sending stderr to `/dev/null`. I verified they are distinguishable:

```
$ timeout 4 bash -c 'exec 3<>/dev/tcp/192.168.70.199/22'
bash: connect: No route to host
exit=1
```

| observation | R1 verdict |
|---|---|
| connect succeeds | **resolved** |
| fast failure, stderr `Connection refused` | **resolved** — routed and the guest is up; the missing piece is `sshd`, not the network |
| fast failure, stderr `No route to host` | **inconclusive** — wrong IP or a guest still booting |
| `timeout` exits **124**, no stderr | **confirmed** — silent drop is the firewall signature |

`Connection refused` reporting R1 as **resolved** is the point: it lets the probe answer R1 against a guest with no `sshd` at all, which is the Ubuntu VM's likely state. Under the brief's design that case prints the whole firewall fallback list and sends the user chasing a problem they do not have.

### Ruling: allow the acceptance run against the Ubuntu VM, with hard limits

The brief's Step 4 says "Start the Ubuntu VM in VMware Workstation" — a GUI action a subagent cannot perform. **Ruling:** do it from WSL with `vmrun start ... nogui`, and **`vmrun stop ... soft` afterwards even if the probe fails**, leaving the machine powered off as found. — Why: the user approved this plan and R1 is a Phase 0 exit criterion that gates Task 18's transport default; the VM is powered off with no snapshots, so a cold boot is reversible and local. — Cost if wrong: a VM left running, which `vmrun stop` undoes.

Explicitly forbidden, and these are the part that matters:
- **No installing or configuring anything inside the Ubuntu guest.** The brief suggests `sudo apt install -y open-vm-tools` in the guest; **overridden.** It is the user's own unrelated VM, and a missing `sshd` is a finding to record, not a problem to fix. Mandate 2 is what makes this affordable — a refusal answers R1 as well as an open port does.
- **No snapshots** taken or deleted. It has none; leave it that way.
- **No touching the Windows 11 VM.**
- **No Windows setting changes.** The fallback list tells the *user* to run elevated PowerShell (`Set-NetConnectionProfile`) and edit the Virtual Network Editor. The script keeps **printing** that advice; the agent must not **apply** it. A host-wide firewall reclassification is security-relevant and belongs to the user.
- **No `sudo` on the WSL host.** No TTY; it cannot authenticate.

### Four smaller mandates
- **A guest-independent host-routing pre-check runs first.** The brief's probe can say nothing until a VM is running *and* has `open-vm-tools` *and* reports an IP — three guest dependencies stacked in front of a question its own header comment calls a host-networking question. Discover the subnet from `ipconfig.exe` with `vmnetnat.conf` as a cross-check, print `ip route get`, ping the host adapter. Diagnostic only; it must not set the exit code.
- **The SSH banner read is broken.** `head -c 100` waits for 100 bytes when a banner is 20–40, so it always burns the full `timeout 5` and then dies to SIGTERM with its buffer possibly lost — reporting `<none>` for a healthy `sshd`. Replace with a single `read -r -t 3` line read.
- **`"VMnet8 host adapter as WSL sees it"` is a false label.** That exact command prints WSL's own `lo`/`eth0` addresses. As written it sends a reader debugging the wrong network. Relabel, state that VMnet8 is expected to be invisible from WSL, and add `ip route get <guest-ip>` — the line that actually shows traffic leaving via WSL's default gateway.
- **`docs/r1-findings.md` gets three verdicts, not two:** RESOLVED / INCONCLUSIVE / CONFIRMED, stated in the first line. The brief's binary would record a refused TCP/22 as "a fallback was adopted" and push Task 18 into making `VmrunTransport` primary on evidence that does not support it. Only the `timeout`-124 signature or a host-routing failure justifies that.
- **Spec edits: two cells, not one.** Line 1034's `R1` risk-table row and line 222's `| Network | NAT (VMnet8) | See risk R1 |`. Line 988's Phase 0 exit criterion (`Verify WSL2 → VMnet8 reachability`) stays untouched — this task doing the work is what satisfies it. Licence to edit the spec extends only to recording the answer it was asked to find.

Task 16 dispatches once Task 15's review closes.

### Task 15 — review dispatched

Review package: `review-bddbe8f..8950d5a.diff` (11331 bytes, 1 commit).
Reviewer: `task-15-review` (sonnet), framed as a *documentation* review — the
standard is "could a person follow this start to finish without getting stuck,
and is every claim it makes about this repo's own scripts true", not "does it
run", because there is nothing to run and nothing to mutation-test.

Seeded with the finding I found in my own controller pass:

**README steps 2 and 3 name `scripts/r1-probe.sh` and `scripts/provision.sh`,
neither of which exists, and unlike step 4 they are not labelled.** A reader
following the Getting started list in order hits a bare "No such file or
directory" at step 2. This is the same defect class mandate 5 fixed for step 4;
my mandate missed it because I only checked step 4. The implementer's own check 5
noticed the gap and argued the linked checklist labels each script with its
owning task — a real mitigation for the checklist, a weak one for the README,
which is a standalone entry point that a reader reaches before the checklist.

Controller verification of `8950d5a`, done before dispatch:

- `git show --stat` → only `docs/vm-build-checklist.md` (234 lines) and
  `README.md` (24 lines), 258 insertions. Tree clean. No tests added, correctly:
  161 tests / 16 files unchanged.
- Transcription claim verified myself: `awk 'NR>=20 && NR<=222' task-15-brief.md`
  diffed against the committed checklist gives **exactly 3 hunks** — §1 step 7
  (firmware fallback + consequence sentence), §3 step 4 (IP note rewritten as a
  DHCP checkpoint), §6 (full rewrite). Everything else byte-identical, including
  the entire "Why these settings" justification table and the partition table.
  The report says "exactly four hunks" then lists three locations; the count is
  wrong (it counted mandate 3 as its own hunk although it folded into §6's), the
  localization is right.
- The report read `task-19-brief.md` itself rather than trusting my mandate's
  summary of it, and disambiguated §2.5's *root* password from §2.6's *student*
  password in §6 — a real ambiguity I had not flagged.

Ruling: the report's hunk miscount is an observation, not a finding — 3 vs 4 with
correct locations misstates nothing about the artifact. Cost if wrong: nil; the
diff is in the review package and the reviewer re-measures it independently.

### Task 15 — review returned, both verdicts given

`task-15-review.md`. **Spec compliance: satisfied** — all six mandates, each checked
against the artifact rather than the report. **Quality: not yet shippable**, on two
findings that are the same defect class the mandates were written to fix.

The reviewer re-measured everything it was asked to and its numbers agree with mine:
`diff … | grep -c '^@@'` → 3 hunks; the partition arithmetic (1+12+8+2+2 = 25 of
40 GB, ~15 GB free) is correct; `.env.local` really is git-ignored; `student`'s
password really is set in §2 step 6; `Node >=22.18.0` in `package.json` backs the
README's Requirements claim; and it ran `coverage` itself rather than trusting the
report's transcript.

- **F1 — must fix.** README steps 2 and 3 name `scripts/r1-probe.sh` and
  `scripts/provision.sh` unlabelled → exit 127 with no disclosure. Confirms my
  seeded finding.
- **F2 — observation, no action.** The report's "exactly four hunks" against three
  correct locations. Already ruled.
- **F3 — the reviewer's own find, and a good one.** `guest-provision.sh` runs
  `set -euo pipefail` and hits `PUBKEY=${RHCSA_PUBKEY:?RHCSA_PUBKEY must be passed
  in}` immediately after the sudoers section. `RHCSA_PUBKEY` is only ever supplied
  when `provision.sh` drives the guest script over `vmrun`, so the manual console
  run the checklist prescribes *always* ends in a hard error the checklist does not
  mention — after promising the script "will ask once and never again".

**F4 — mine, found while verifying F3, and it subsumes it.** `guest-provision.sh`
lives in the WSL repo. Nothing in §1–§3 clones the repo into the guest, copies the
file in, or mounts anything from the host, and the guest has no network path to it.
So §3 step 5 names a file that is not on the machine the reader is sitting at and
gives no way to put it there. F3 describes what happens *after* a prerequisite that
cannot be met.

Ruling: **fix both now by inlining, not by documenting the error** — replace §3 step
5's "run `scripts/guest-provision.sh`" with the four sudoers commands from section 0
of the script, taken verbatim from `task-19-brief.md`. Why: the only thing that
genuinely must happen at the console is installing the drop-in, and that is three
commands plus a `sudo -n true` proof; telling a reader to expect a spurious failure
is worse than removing the instruction that causes it. This authorizes a **fourth**
divergence from the brief's fenced block. Cost if wrong: the drop-in's one line is
now duplicated between the checklist and `guest-provision.sh` and could drift — held
low because the line is one line, `guest-provision.sh` is idempotent, and
`provision.sh`'s later run overwrites whatever the reader typed.

Ruling: **F3 is not forwarded to Task 19**, against the reviewer's suggestion. The
defect is in a document the user executes *before* Task 19's code exists, so
deferring it means the one hand-executed procedure in the project ships with a step
that cannot be followed. Cost if wrong: a fourth hunk in a transcription this task
was told to keep verbatim — visible in one `diff` and trivially revertable.

Note on provenance, since the mandates did not cause either: F3 and F4 are both
verbatim from the brief, outside all three authorized hunks, so the implementer
introduced neither. They are defects in the plan's own text that only surfaced when
someone read the document as its executor rather than as its author.

Fix round 1 dispatched: `task-15-fix-1-mandates.md`, resumed `task-15-impl`.

### Task 15 — fix round 1 committed `62ae28e`, scoped re-review dispatched

`README.md` +4/-8, `docs/vm-build-checklist.md` +29/-6. 25 insertions, 2 files, tree
clean. Verified myself:

- F1: steps 2 and 3 now read `(Task 16; does not exist yet)` and `(Task 19; does not
  exist yet)`. README still 24 lines — both edits lengthened their own line in place.
- F3+F4: §3 step 5 no longer names `guest-provision.sh`. It inlines the four sudoers
  commands, and I checked them against §0 of the script in `task-19-brief.md` myself:
  lines 1–2 character-identical, line 3 identical minus the trailing comment (moved to
  prose as mandated), line 4 changed from the `|| { echo FATAL…; exit 1; }` guard to
  `&& echo "passwordless sudo is in effect"` as mandated. All four prose points kept,
  including the `visudo -cf` lock-yourself-out warning.

**My verify instruction #1 was wrong, and this is the third instance of the same
mistake.** I told the implementer to confirm "exactly four" hunks. It measured **3**
and diagnosed why correctly: §3 step 4 and §3 step 5 are separated by one blank line
and one short fenced block, so unified diff's default 3-line context merges them into
one `@@` region — the same adjacency effect that already merged mandates 2 and 3 last
round, which F2 had noted. I reproduced it: hunks at `-41`, `-133`, `-181`, with the
middle one grown from 18 to 37 lines. Four divergences by location, three contiguous
regions by `grep -c`.

Recorded, again: **I predicted a count instead of deriving it.** The earlier form of
this was mandate 14.1's void table; this is the cheap form, caught by an implementer
who measured. The rule stands — a number in a mandate is either measured or labelled
unmeasured. "Expect exactly N hunks" is a prediction about `diff`'s context algorithm,
not about the artifact, so it should have been "expect changes at these four locations
and nowhere else" — which is what the check actually needed to assert.

Ruling: `grep -c '^@@'` is **retired as the transcription check** for this document.
Cost if wrong: none; hunk locations are strictly more informative than hunk count, and
the count was only ever a proxy for them.

Scoped re-review dispatched (`task-15-rereview`, sonnet). Scope is F1/F3/F4 plus one
thing nobody has verified: **the four inlined commands have never been run.** There is
no RHEL guest here and `sudo` cannot authenticate on this host, so the checklist now
asserts a console procedure on documentation faith alone. The re-reviewer must
fact-check each command against `man sudoers`/`man visudo` rather than memory — in
particular whether `visudo -cf` on a drop-in prints bare `parsed OK` as the prose
implies or `<path>: parsed OK`, whether `0440` is required and what `sudo` does with a
wrongly-moded drop-in, and whether the `tee`-then-`chmod` window can brick `sudo`
between the two commands. A procedure a person types at a console where a mistake locks
`sudo` out of the machine is not something to assert from memory.

### Task 15 — re-review: F1/F3/F4 closed, one new must-fix

`task-15-review.md` `## Re-review — fix round 1`. F1 closed, F3+F4 closed, four
commands confirmed against Task 19 §0 character by character, and everything outside
the four authorized locations byte-identical to the brief — the settings table, the
partition table with its ~15 GB prose, the `findmnt /var` hard stop, and line 103's
`getenforce # must print Enforcing` each checked individually. SELinux still
`enforcing`.

The re-reviewer did the fact-check honestly and reported its own limits: this host's
man pages are **`sudo-rs` 0.2.13**, not the Todd-Miller `sudo` RHEL 9 ships, so it
checked syntax locally and went to upstream `sudo-project/sudo` source for anything
about exact output or enforcement internals rather than generalizing from the Rust
reimplementation. That is the right instinct and worth keeping: **`man` on this host
is not evidence about RHEL 9.**

Results:

1. `visudo -cf` prints `<path>: parsed OK`, not bare `parsed OK` — from `visudo.c`'s
   `check_syntax()`: `printf(_("%s: parsed OK\n"), fname)`. The prose says "if it does
   not print `parsed OK`", which is true as a substring and no error path prints that
   phrase. Correctly ruled **not** a false claim. Folding a one-word tighten in anyway
   since round 2 touches the same paragraph.
2. `student ALL=(ALL) NOPASSWD: ALL` is valid `sudoers` grammar and grants what the
   prose claims. Confirmed.
3. **`0440` is not a mode `sudo` requires.** `sudo_secure_fd` rejects a sudoers file
   only for world-writable, group-writable, or wrong owner; `0440` is `sudo.conf`'s
   `sudoers_mode` default that `visudo` applies, not an enforced floor. The checklist
   never claims otherwise — it just says to run the chmod — so no fix. Worth knowing:
   **do not later "explain" 0440 as required.**
4. **New must-fix.** `sudo -n true` does not prove NOPASSWD is in effect. `sudo tee` is
   `student`'s first `sudo` call and prompts for the console password; a successful auth
   caches a per-TTY timestamp ticket for 15 minutes, and `-n` suppresses *prompting*
   only — it still honours a valid ticket. So `sudo -n true` two lines later succeeds
   off that ticket whether or not the drop-in applied. If the rule silently failed (an
   ownership slip makes `sudo` skip the file with a warning — documented, not
   hypothetical), the reader still sees `passwordless sudo is in effect` and walks away
   from a broken machine believing it good.
5. The `tee`-then-`chmod` window is **not** a lockout risk, following from 3: `tee`
   runs as root under `sudo`, so the file is root-owned and at `0644` under RHEL 9's
   default `umask 022` — not group- or world-writable, therefore already accepted. The
   `chmod 0440` is read hygiene, not an acceptance gate. Caveat recorded, not a
   finding: a `0002`/`0000` umask would make it group-writable in that window and
   `sudo` would refuse — not RHEL 9's default posture.

Finding 4 **is this project's core defect class in its purest form: a check that passes
for the wrong reason.** It is the same shape as verdict A vs verdict B — the reason
every task grades post-reboot rather than trusting "it works now." A green signal
sourced from the setup step instead of from the thing under test.

Ruling: **fix the check, not the prose** — `sudo -k && sudo -n true && echo …`.
`sudo -k` drops the ticket without prompting, so the check then tests the rule and
nothing else, and the "this is the proof" sentence becomes true instead of being
softened into a hedge. Why: softening the prose would leave a reader with a signal they
cannot act on; one extra word makes the signal real. Cost if wrong: `sudo -k` discards
a cached credential the reader may have wanted for their next command, so they type the
password once more — trivial, and the prose will say so.

**Forward to Task 19:** `guest-provision.sh` §0's own
`sudo -n true || { echo FATAL…; exit 1; }` has the identical blind spot. It is sound on
the paths that actually run it (delivered over ssh or `runProgramInGuest`, no TTY, so
there is no interactive auth to cache and `sudo tee` could not have succeeded without
the rule already in force), but it becomes non-probative the moment anyone runs that
script at a console. Add `sudo -k` there too — the argument for why it is currently
safe is exactly the kind of reasoning that stops holding when an invocation path is
added later.

Fix round 2 dispatched to `task-15-impl`: the `sudo -k` change plus the `: parsed OK`
tighten, both inside §3 step 5, so no new divergence location opens.

### Task 15: complete

Commits: `8950d5a` (checklist + README) → `62ae28e` (F1, F3+F4) → `456e468` (`sudo -k`).
Files: `docs/vm-build-checklist.md`, `README.md`. No tests, correctly — 161 tests / 16
files unchanged throughout, since nothing outside `docs/` and `README.md` was touched.

Verified by me at `456e468`:

- Divergences from the brief's fenced block stay at exactly the four authorized
  locations (§1 step 7, §3 step 4, §3 step 5, §6), reported as 3 `@@` regions because
  steps 4 and 5 are adjacent. Hunk headers `-41`, `-133`, `-181`.
- Grepped the whole brief-vs-committed diff for `enforc|findmnt|selinux|Why these` and
  the partition sizes: **none of those lines appear in the diff at all.** The settings
  table, the partition table, the `findmnt /var` hard stop, and `getenforce # must print
  Enforcing` are byte-identical to the brief. SELinux stays `enforcing`.
- §3 step 5's final command is now `sudo -k && sudo -n true && echo "passwordless sudo
  is in effect"`, and the prose explains that `sudo -k` discards the credential just
  typed for `tee` so the check proves the rule rather than a ten-second-old ticket.
  `sudo -k` alone runs no command and does not prompt, so the chain is typeable as
  written; on failure `sudo -n` exits 1 to stderr and the echo does not fire.
- `visudo -cf` prose now reads "does not end with `: parsed OK`", matching upstream's
  `printf("%s: parsed OK\n", fname)`.
- Tree clean.

Both verdicts obtained: spec compliance satisfied (all six mandates), quality approved
after two fix rounds. Three findings raised, three closed; F2 ruled an observation.

**What this task actually taught, worth more than the document:** every one of the four
real findings was invisible to the author and obvious to an executor. F1, F3 and F4 all
had the same shape — *an instruction that states an action without stating that what
the reader will see is an error* — and the `sudo -k` finding had the project's other
recurring shape, *a check that passes for the wrong reason*. Neither shape is findable
by re-reading your own prose for agreement, which is exactly the method the brief's own
Step 3 prescribed ("verify by inspection"). The method that found all four was: read the
document as the person typing it, and verify every claim about this repo with a command.
Use that framing for every remaining documentation deliverable.

### Task 16 — dispatched

BASE `456e468`. Implementer `task-16-impl` (sonnet). Brief + the seven mandates written
earlier. Model choice: sonnet, because the deliverable is a shell script plus a real
measurement run against a live VM plus two spec-table edits — mechanical transcription
would not survive contact with whatever the Ubuntu guest actually has installed.

**A cross-task defect found at dispatch time, and one my pre-flight scan could not have
caught.** Task 15's README step 2 reads `bash scripts/r1-probe.sh` **(Task 16; does not
exist yet)**. The instant Task 16 commits, that parenthetical is false — the fix for F1
becomes a new instance of F1's own defect class, just inverted: a label that now
misinforms because the world moved. Mandated into Task 16's dispatch: strip the label
from step 2 and include `README.md` in the commit, leaving step 3's Task 19 label alone
because it is still true.

Why the scan missed it: `README.md` **did not exist** when I scanned the plan. It was
created by mandate 1 during Task 15, so no T15↔T16 row could have named it. Recorded as
a scan limitation, not a scan error: **a shared-file row can only be written for files
the plan mentions. Files a mandate invents mid-run have no row, and every mandate that
creates a file needs its own forward check for who else must edit it.** This is the
second lesson of this shape — the earlier one was that a shared-file row must compare
the *variable list* one side writes against what the other reads, not just the filename.

**Forward to Task 19:** it owns README step 3's `(Task 19; does not exist yet)` label
and must strip it when `scripts/provision.sh` lands, exactly as Task 16 does for step 2.
Task 19 also inherits the `sudo -k` finding for `guest-provision.sh` §0.

### Task 16 — implemented `20d8a9b`, review dispatched

Files: `scripts/r1-probe.sh` (239), `docs/r1-findings.md` (239), 2 spec cells,
1 README line. 481 insertions. 161 tests / 16 files still passing (no tests added,
correctly — a diagnostic whose subject is host networking, mocked out, would assert
only that the mocks were wired). Tree clean.

**R1 verdict: INCONCLUSIVE**, which is the third bucket mandate 6 was written to create
and which the brief could not express. The reasoning is sound and it refused both
easier answers:

- **Not RESOLVED**, because no guest was ever reached at a confirmed address. The
  Ubuntu VM has no `open-vm-tools`, so `getGuestIPAddress` never produced one, and
  mandate 5 forbade installing it.
- **Not CONFIRMED AS A PROBLEM**, even though a manual attempt at a *guessed* address
  produced the timeout-124 firewall signature. It found the stale lease
  (`192.168.70.128`, dated 2026-07-17) in `vmnetdhcp.leases`, and the host adapter
  answered `Destination Host Unreachable` for ICMP — so nothing was claiming that
  address and the 124 meant "wrong address", not "firewall". **Declining to promote a
  matching signature when the evidence explains it another way is exactly the judgment
  this project keeps asking for**, and it is the opposite of the failure mode where a
  tool reports what it did not establish.

Host-routing half is confirmed independently of all that: `192.168.70.0/24`, adapter
`.1`, NAT `.2`, both discovery sources agreeing, `ping` 0% loss, `ip route get` showing
the path via `172.22.96.1 dev eth0`. This matches my own pre-dispatch measurements
exactly. **`SshTransport` stays the intended default for Task 18.**

Verified by me before dispatch: README step 2's `(Task 16; does not exist yet)` label is
gone and step 3's Task 19 label is untouched; spec line 222's Network row and line 1034's
R1 row both updated and both citing `docs/r1-findings.md`; **spec line 988's Phase 0 exit
criterion unchanged** per mandate 7.

Beyond the seven mandates, the implementer wrapped `getGuestIPAddress` in `timeout 60`
because the brief's un-timed `-wait` **hung live** against a tools-less guest and had to
be killed after several minutes. Added because it reproduced, not hypothetically. Ruling:
ratified. Cost if wrong: a slow-booting guest could be declared tools-less at 60 s — the
message already says "or took over 60s to report", so the failure is self-describing.

Two seeds handed to the reviewer:

- **S1: the commit message overstates its own evidence.** `20d8a9b`'s subject says
  "resolving risk R1" and its body says the Ubuntu guest "answers it" — but the verdict
  is INCONCLUSIVE and the guest-side half is deferred. The message was mandated verbatim
  by the brief, which *assumed* the run would resolve R1. It didn't. Git history is the
  most durable claim in this repo, and this one now says more than the evidence supports.
  Asked the reviewer whether a corrective note in `docs/r1-findings.md` suffices or the
  history is worth amending while the branch is unmerged.
- **S2: the user's Ubuntu VM was hard powered off.** `stop … soft` never returned —
  soft shutdown needs VMware Tools, which this guest lacks — so the implementer used
  `stop … hard`. Mandate 5's letter was met (it is powered off, nothing installed, no
  snapshot taken or deleted), but a hard power-off is an unclean shutdown of an
  unrelated machine belonging to the user. Flagged for independent verification because
  it is the one action in this task that touched something outside the project, and it
  must be surfaced to the user rather than buried in a report.

**The review's central problem, and why it cannot be a reading pass:** the live run
stopped at "no IP reported", so **mandate 2's four-way TCP classifier — the code that
decides the verdict — shipped completely unexercised.** The reviewer is required to drive
all four branches from this host with no VM (local listener → connect; closed local port
→ refused; `192.168.70.199` → no route; blackhole → 124) and to *time* the mandate-3
banner read against a listener that sends one short line, because code that looks like it
returns early is not evidence that it does. Replacing the brief's single `else` with a
classifier that collapses the same four meanings in more lines would be no fix at all.

Review package: `review-456e468..20d8a9b.diff` (26036 bytes). Reviewer `task-16-review`
(sonnet).

## Task 16 — review returned, fix round 1 dispatched

Review: `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-16-review.md`.
Both verdicts present. **Verdict 1: all seven mandates SATISFIED.** Verdict 2:
good, with one must-fix (F1). Reviewer drove all four TCP branches live, timed
the banner at 0.266 s (vs the 3–5 s `head -c 100` would have burned), grepped
that every `powershell`/`netsh`/`Set-NetConnectionProfile` occurrence sits
inside a `say "..."` string and none is executed, and corroborated the hard
power-off from the guest's own `vmware.log` — a source the implementer did not
write. Ratified its beyond-mandate `timeout 60` around `getGuestIPAddress`.

F0: `task-16-report.md` was never written as a standalone file; the reviewer
used `progress.md` in its place and said so. Folded into fix round 1.

### Ruling: the reviewer's own recommended fix for F1 is wrong — take (b), not (a)

The review offered two options. Option (a) — "retry the connect 2-3 times and
only classify `dropped` if *every* attempt times out" — is **backwards**, and I
measured it before dispatching:

```
192.168.70.77 attempt1 rc=1   dur=2.83s  "No route to host"
192.168.70.77 attempt2 rc=124 dur=5.05s  (no stderr)
192.168.70.88 attempt1 rc=1   dur=2.94s  "No route to host"
192.168.70.88 attempt2 rc=124 dur=5.05s  (no stderr)
```

ICMP Destination-Unreachable rate-limiting in the Windows NAT/vswitch path means
the **first** attempt is the informative one; retries silently time out because
the budget is spent. So retrying biases the classifier *toward* `dropped` — the
exact direction the finding says is wrong.

Ruling: implement option (b) only — cross-check with `ping` — plus an explicit
"do not add retries" comment naming the rate-limiting, so nobody later
"improves" it into (a). Cost if wrong: a comment that over-explains a two-line
decision.

### Ruling: F1 is the common case, not an edge case — and the fix is a rank order, not a retry

Found on top of the review. The script's `ICMP` section runs **before** its
`TCP/22` section, so it spends the address's ICMP error budget itself:

```
192.168.70.111 ping first: 3 transmitted, 0 received, +1 errors, 100% loss
  then tcp:                rc=124, no stderr
  ping again:              3 transmitted, 0 received, 100% packet loss   (no "+1 errors")
```

So on a genuinely unclaimed address — "the guest isn't up yet," the most likely
thing a stuck user is actually looking at — the script will *nearly always*
reach `dropped` and send them into elevated PowerShell. The wrong verdict is the
common case.

The discriminating signal is in ping's **output**, which the script discards
with `>/dev/null 2>&1`:

```
$ ping -c 3 -W 2 192.168.70.181        # unclaimed, fresh
From 192.168.70.1 icmp_seq=3 Destination Host Unreachable
3 packets transmitted, 0 received, +1 errors, 100% packet loss

$ ping -c 3 -W 2 192.168.70.2          # NAT gateway: claimed, silent by design
3 packets transmitted, 0 received, 100% packet loss          <- no "+N errors"
```

Reproduced on `.111`, `.171`, `.181`. Count is `+1`, not `+3` — rate-limiting
eats the rest — so the test must be `+N errors` for N ≥ 1, never a fixed count.

Ruling: ICMP error evidence **outranks** a silent TCP timeout. `dropped` fires
only when TCP times out silently AND ping showed loss with no ICMP error. Do not
reorder the sections: ICMP-first is what makes the evidence available; the
ordering was never the bug, discarding the output was. Cost if wrong: a real
firewall drop on an address that also happens to emit ICMP errors reads as
INCONCLUSIVE — and the re-run advice item 6 adds is what catches that.

### Ruling: amend `20d8a9b`'s message rather than annotate it

Its subject says "resolving risk R1" and its body says the Ubuntu guest
"answers it." The delivered verdict is INCONCLUSIVE. The message was taken
verbatim from the brief, which assumed the run would resolve R1; nothing
updated it when the outcome diverged. `docs/r1-findings.md` is already accurate,
but a corrective note there does not stop `git log --oneline` from claiming the
resolution forever. Branch is unmerged and this is HEAD, so amend — and amend
**before** the fix commit lands, since interactive rebase is unavailable here.
Cost if wrong: a rewritten SHA on an unmerged branch nobody has pulled.

### Note on the recurring defect class

F1 is the logic form of it again — *a check that passes for the wrong reason* —
but inverted: here the check **fails** for the wrong reason, and the failure is
the confident, actionable, wrong prescription. Same shape, worse blast radius,
and it landed in the branch that mandate 2 existed to make trustworthy.

Fix mandates: `task-16-fix-1-mandates.md`. Dispatched to `task-16-impl`
(resumed, round 1 of 5). F4 stays open, forwarded to Task 18 or a later
hardening pass. F2/S2 surfaced to the user directly.

## Task 17 — brief staged and pre-flighted (not yet dispatched; T16 fix round 1 still open)

Brief: `task-17-brief.md` (579 lines, `VmrunTransport` + `VmController` +
`loadVmConfig`). Mandates: `task-17-mandates.md`, nine required changes. Two
rest on measurements I ran and pasted; two rest on what Task 16 hit live.

### Ruling: `realRunner` gets a timeout, and a timeout reports as 124

The brief's `realRunner` calls `execFileAsync` with no `timeout`, so every
`vmrun` call can hang forever. This is not hypothetical — Task 16 measured both
`getGuestIPAddress` and `stop … soft` hanging indefinitely against the
tools-less Ubuntu guest (`docs/r1-findings.md`); `stop soft` never returned and
needed a `stop hard`. `VmController.stop()` is the same call.

Measured, on `node v22.23.2`:

```
TIMEOUT-TEST after 205 ms
  message: "Command failed: /bin/sh -c sleep 5"
  code: null  killed: true  signal: "SIGTERM"
```

`err.code` is **`null`** on timeout, so the brief's
`typeof err.code === 'number' ? err.code : 1` reports a 120-second hang as a
plain `exit 1`. Ruling: add an injectable `makeRunner({timeoutMs})` defaulting
to `120_000`, keep `realRunner` as its default instance, and return code **124**
with a legible stderr when the child was killed. 124 because `timeout(1)` uses
it and `scripts/r1-probe.sh` already trains the reader to read 124 as "timed out
silently" — one meaning per number across the project. Cost if wrong: a
legitimately slow `revertToSnapshot` on a huge VM reads as a timeout, which the
message will say plainly.

### Ruling: the guest password must be redacted out of every returned string

Measured on this host:

```
LEAK-TEST message: "Command failed: /bin/false -gp SUPERSECRET x"
  code: 1  stderr: ""
```

`execFile`'s error message echoes the full argv, `vmrun`'s only credential
interface is `-gp <password>` on the command line, and the brief's
`err.stderr ?? err.message ?? ''` puts that message into `ExecResult.stderr` —
a field that reaches the CLI, the API and the browser. Note the leak fires on
the *common* path: `stderr` is empty whenever `vmrun` itself fails to launch or
is killed, which is exactly when the message fallback is used.

Ruling: prefer `err.stderr` when non-empty, otherwise build the fallback from
`exe` plus a **redacted** args copy (`-gp` → `<redacted>`). Two real tests
against `/bin/false` and `/bin/sh` prove it, no hypervisor needed. Also required:
a comment saying plainly that argv exposure to the host process list is inherent
to `vmrun` and unfixable here — the redaction stops it from also becoming a
persisted string. Cost if wrong: nothing; the redaction is unconditional.

### Ruling: `guestPassword` moves into `VmConfig`/`VmrunConfigSlice`

`guestAuth` reads `process.env.RHCSA_GUEST_PASSWORD` directly, which falsifies
two of this task's own claims — that `config.ts` is where environment is read,
and that `Runner` is "the single injection seam". Ruling: add an **optional**
`guestPassword?: string` to both interfaces so the brief's `CFG` test literal
still satisfies the slice and Task 18 is unaffected. Cost if wrong: Task 18 has
one more optional field to ignore.

### Ruling: the "reboot waits" test passes for the wrong reason

`reboot()`'s own `exec` consumes both of the fake's two failing probes before
`waitForGuest` runs at all, so `expect(probes).toBeGreaterThan(2)` is satisfied
by `waitForGuest` succeeding on its **first** attempt. The test never
demonstrates polling — the behaviour it is named for. Ruling: count only
`runProgramInGuest`, fail the first two, assert exactly 3, and **require the
implementer to break it and watch it fail** before keeping it. Same defect class
as Task 11's false-pass hunt: a check that passes for the wrong reason.

### Ruling: `reboot()`'s `.catch(() => undefined)` goes

`exec` never rejects on a guest failure — `realRunner` converts those to a
non-zero code. It rejects only when host-side staging fails or the injected
`Runner` throws, i.e. when `vmrun.exe` is missing. Swallowing that converts a
host misconfiguration into a silent 120-second wait ending in `guest did not
come back within 120000ms`, pointing the reader at the guest. Ruling: drop the
catch, keep and extend the comment, add a test that a throwing runner surfaces
`ENOENT` instead of waiting out the timeout. (This closes the parked "`exec`
rejection on run B (also 17/23)" item for Task 17's half.)

### Ruling: fix the two unverified comments, not the code they describe

`revert()`'s `start is idempotent, so call it either way` is unverified and
probably false for the live-snapshot revert that *is* the design's ~5 s reset
mechanism. Ruling: **do not** add a `vmrun list` probe — that is an extra round
trip on the path the design advertises at ~5 seconds, and the code's outcome is
already correct because the result is ignored. Change the comment to state that
a live-snapshot revert may leave the VM running, that this `start` is then
expected to fail, that the failure is deliberately ignored, and that it is
unverified until VM acceptance. `stop()`'s comment gains what Task 16 measured:
soft needs `open-vm-tools` to ACK it and hangs without it, bounded now by
mandate 1. Cost if wrong: a comment that over-hedges a call whose result nobody
reads.

### Ruling: `KINDS` becomes exhaustive; the `as` cast stays and is parked

`const KINDS: readonly string[]` lets a future fourth `TransportKind` drift out
of the list silently. Ruled: `Record<TransportKind, true>` with
`Object.hasOwn`, so the omission is a compile error.

But `forced as TransportKind | undefined` **stays exactly as written.** Five
sites in `src/` already do this, all membership-guarded first:
`src/engine/content/task.ts:96,101,107-108`,
`src/engine/grading/verdict.ts:29`, `src/engine/content/objectives.ts:70`. All
are parked for one `oneOf` type-predicate helper at the final whole-branch
review. A bespoke predicate here would leave two idioms in the tree and make the
unification harder. **Task 17's site is the sixth — seventh counting Task 14's
F3 at `scripts/extract-corpus.ts:47-53`.** Reviewers: this is not a finding.

### Ruling: Step 7's acceptance command is missing `--env-file-if-exists`

Nothing in this project loads `.env.local` into `process.env`; the plan's answer
is `node --env-file-if-exists=.env.local`, used on every other VM-touching
entrypoint (plan lines 7107, 8566, 10319, 11597-11600) and explained at line
11487. Step 7 omits it, so a reader who did exactly what
`docs/vm-build-checklist.md` §6 told them gets `RHCSA_VMX is not set. Put it in
.env.local…` — an error instructing them to do the thing they just did. The
recurring documentation defect, this time in an acceptance step. Ruled: add the
flag. Confirmed supported here (`.env.local not found. Continuing without it.`,
exit 0). Step 7 itself **stays deferred** — no VM exists and no VM on this host
may be touched.

### Ruling: `guestScriptPath` uses `randomBytes`, not a process-local counter

Its comment claims uniqueness "so concurrent grading cannot clobber a staged
script"; two processes both start the counter at 1 and collide. The trainer runs
a server and a CLI against one guest, so it is reachable, and the failure — one
grading run overwriting another's staged script — is silent and looks like a
flaky grader. Ruled: `randomBytes(6).toString('hex')`, which still satisfies the
brief's existing `/^\/tmp\/rhcsa-[a-z0-9]+\.sh$/` assertion.

### Note on the count I did not predict

The brief predicts 5 config + 13 vmrun tests; I checked and that count is
correct **for the brief as written**. These mandates add three and rewrite one,
so it will change. Per the retired-hunk-count ruling, the mandate tells the
implementer to **report the number it observes and not to trust mine.**

## Task 16 — fix round 1 landed, re-review dispatched

Commits: `79b5d50` (S1: amended message, tree byte-identical to the retired
`20d8a9b`) and `fc4a413` (F1 + F3; `docs/r1-findings.md` 1 line,
`scripts/r1-probe.sh` +47/-7). Suite still **161 passing / 16 files**; tree clean.
Report file `task-16-report.md` now exists (11 KB), closing F0.

### F1 verified independently, before and after, against the committed code

I extracted the ICMP+TCP classifier out of the script at each commit and drove it
against addresses I had not probed:

| commit | address | ping evidence | outcome | verdict |
|---|---|---|---|---|
| `79b5d50` pre-fix | `.243` fresh | — | `dropped` | CONFIRMED + firewall advice |
| `fc4a413` post-fix | `.219` fresh | `+1 errors` | `unreachable` | INCONCLUSIVE |
| `fc4a413` | `.2` NAT gw (claimed, silent) | plain loss, no `+N errors` | `dropped` | CONFIRMED |

Same real condition, opposite prescriptions, before and after — the fix inverts
exactly the case that was wrong and leaves the case that was right alone.

Also checked myself, because the fix introduces a bare command substitution
where an `if` used to guard it: the script is `set -uo pipefail` with **no
`-e`**, so `ping_out=$(ping …)` does not abort on ping's non-zero exit. Had `-e`
been set, this fix would have made the script exit before reaching the TCP
section on every unreachable address — a much worse bug than the one it fixes.
Worth recording as the near-miss it was.

The implementer implemented all six sub-items of mandate 2, including the
"do not add retries" comment with the rate-limiting reason, and did not
implement the reviewer's option (a). Mandate 3's title fix is in.

Re-review dispatched to `task-16-review` (resumed, sonnet), scoped to F1/F3/S1
plus regressions, and explicitly asked to attack my own load-bearing claim —
that retrying biases toward `dropped` — since the whole fix rests on it. Told it
what I had already verified so it spends its budget on what I had not: whether
the new `unreachable` route lands in the `unreachable)` arm and suppresses the
fallback list, whether the `+[1-9][0-9]* errors` grep can misfire, whether the
new raw-ping dump is worth its noise on the success path, and whether the
rewritten prose is true of the code now.

## Task 16 — fix round 1 re-review: both verdicts positive, nothing blocks

`task-16-review.md` §"Fix round 1 re-review". F1, F3, S1 all closed.

**The reviewer attacked my load-bearing claim and confirmed it, then retracted
its own fix.** It pinged a never-touched address three times in a row:

```
attempt 1: 3 transmitted, 0 received, +1 errors, 100% loss
attempt 2: 3 transmitted, 0 received, 100% loss          # marker gone
attempt 3: 3 transmitted, 0 received, 100% loss          # still gone
```

and wrote: "My original recommendation (a) ... would therefore see the spent
budget on every retry after the first and would misclassify *more* often, not
less. The mandate's reasoning is right; my original fix (a) was wrong, and I'm
retracting it." It also independently reproduced the before/after contrast on
its own pair of fresh addresses (`.17` post-fix → INCONCLUSIVE, `.28` pre-fix →
CONFIRMED), matching my `.219`/`.243` pair.

Answered the four things I could not check myself:

- The new `unreachable` route **does** land in the `unreachable)` arm and prints
  no fallback list — both paths assign the identical string and the `case`
  switches on the string alone.
- The regex cannot misfire on this host: `ping -V` reports `NLS: no` (no
  translation support at all) and `LC_ALL=C` output is byte-identical, so there
  is no locale variance; iputils reports duplicates as `+N duplicates`, a
  different word from `errors`, so no collision; and `$ping_out` is captured
  before any of the script's own `say` output exists, so the script cannot match
  its own text.
- The prose is true of the code: the rewritten warn text is a forward-looking
  conditional, not an assertion that the combination already happened.
- It **agreed with the ruling not to special-case `.2`**: "tuning the prose to
  hedge around one known address would reintroduce exactly the kind of narrow,
  environment-specific patching this project keeps flagging elsewhere."

### Ruling: do the two remaining observations now, not in a later hardening pass

Two non-blocking observations left, and they share one condition, so round 2 is
a two-line change:

- **F5** — the raw `ping_out` dump prints unconditionally, so a healthy ping
  shows eight lines of RTT detail before the one `ok:` line a happy-path reader
  needs. The detail is evidence only on the failure paths.
- **The stale-flag edge case** — `icmp_no_claim` is computed even when
  `ping_rc -eq 0`. A burst that answers on packet 3 but logged an
  ICMP-unreachable on packet 1 leaves the flag `yes`; the TCP section reads it
  again and would soften a genuine same-run firewall onset to `unreachable`.
  The recurring shape once more: a check that holds for the wrong reason.

Ruled: gate both on `ping_rc -ne 0`. The second is a definition, not a
heuristic — if anything answered, "nothing claims this address" is false. Doing
it now rather than parking it because the fix is smaller than the ledger entry
describing it, and a parked two-line shell change in a diagnostic script is a
change nobody makes. Cost if wrong: the failure paths lose a dump they need,
which the mandate's three-shape verification catches immediately.

`task-16-fix-2-mandates.md`, dispatched to `task-16-impl` (round 2 of 5).
F4 still open and forwarded to Task 18 or a later hardening pass.

Task 16: complete — `5c7f650`.

Three fix commits after the original: `79b5d50` (amend), `fc4a413` (F1+F3),
`5c7f650` (F5 + stale flag). Both verdicts obtained; four findings raised (F0,
F1, F3, S1) and all four closed; F2/S2 disclosed to the user; F4 parked and
forwarded. 161 passing / 16 files throughout — Task 16 correctly adds no tests.
`bash -n` clean, tree clean.

Round 2 verified by me, one harness run per address so a spent ICMP budget could
not confound it:

```
127.0.0.1        dump lines: 0   ok: ping 127.0.0.1                     OUTCOME=refused
192.168.70.59    dump lines: 2   ... +1 errors, 100% packet loss        OUTCOME=unreachable
192.168.70.2     dump lines: 1   ... 100% packet loss (no +N errors)    OUTCOME=dropped
```

**A mistake worth recording, because it is the same mistake the finding is
about.** My first verification run invoked the harness twice per address — once
to count dump lines, once to grep the outcome. The first invocation spent the
address's ICMP budget, so the second saw plain loss and reported
`OUTCOME=dropped` for a fresh unclaimed address. I nearly read that as a
regression in the fix. The confound the whole finding is about is easy enough to
re-create that it caught the person who found it, one round later. Any future
verification of this script must be **one run per address**.

Scoped round-2 confirmation requested from `task-16-review` (narrow: did the
restructure move anything it shouldn't, and is `icmp_no_claim=no` still read
correctly in the success case). Task 16 is otherwise closed; the confirmation is
belt-and-braces, not a gate.

## Task 17 — dispatched

BASE `5c7f650`. Fresh implementer `task-17-impl`, sonnet — the brief carries
complete code (transcription) but the nine mandates need judgment, so not the
cheapest tier. Brief + mandates handed over as file paths; the dispatch carries
only the T2 interfaces it consumes, the T18 contract it produces, the global
constraints, and the deferral of Step 7.

Dispatched in parallel with the T16 round-2 confirmation: that reviewer is
read-only and this task touches only `src/engine/vm/` and `test/vm/`, so there
is no second implementer in flight.

### Task 17 — reviewer context staged in advance

`task-17-review-context.md` written while `task-17-impl` runs, so the review
dispatch carries three file paths and one line of framing rather than a pasted
essay. It records the four things a Task 17 reviewer cannot infer from the
brief and the mandates alone:

1. **Mandate 8 preserves `forced as TransportKind | undefined` on purpose** —
   sixth sibling of an established guarded-union idiom, all parked for one
   `oneOf` helper at the final whole-branch review. The context file says
   plainly: do not report it as a finding. Without that, a competent reviewer
   spends a finding on it, and I spend a ruling rejecting the finding.
2. **Mandate 4's rewritten polling test must have been broken and watched to
   fail** — the brief's version passed for the wrong reason (`reboot()`'s own
   two `vmrun` calls satisfied `probes > 2` before `waitForGuest` polled at
   all), so a reviewer who only reads the new test cannot tell the rewrite
   fixed anything.
3. **The reviewer re-derives the two `execFile` measurements itself** — the
   argv echo (`-gp` leak) and `code: null` on timeout. Mandates 1 and 2 rest
   entirely on those two facts; if either is wrong both mandates are wrong,
   and the escape clause ("your measurement wins") only works if someone
   actually measures.
4. The out-of-bounds block, verbatim: no VM operations, no `sudo`, no reading
   `/home/daxtangco/sechelp-tools` secrets, no `.env.local`.

### Replayed Task 16 messages — no action

Four `task-16-impl` / `task-16-review` reports arrived as replays after Task 16
had already closed at `5c7f650`: the original review, fix-round-1 completion,
the fix-round-1 re-review, and fix-round-2 completion. Every one had already
been read, ruled on, and ledgered above. Recorded here only so a later reader
who finds them in the transcript does not mistake them for a reopened task.
Task 16 remains closed; its round-2 confirmation child is belt-and-braces, not
a gate.


### Task 16 — round-2 confirmation in, task closed on both sides

`task-16-review` confirmed `fc4a413..5c7f650` and appended a "Fix round 2
confirmation" section to `task-16-review.md`. Scope verified as mandated: the
diff touches only `scripts/r1-probe.sh`'s ICMP block; the regex text, the TCP
section, the `case` statement, the verdict texts, and `docs/r1-findings.md` are
all untouched.

**It checked the inverse direction, which is the one that mattered and the one I
had not verified.** My round-2 verification drove the three ICMP shapes — I
confirmed the flag is set correctly. The reviewer confirmed it is *cleared*
correctly: `icmp_no_claim=no` is initialised once ahead of the
`if [[ $ping_rc -eq 0 ]]`, and the only `=yes` assignment now sits inside the
`else` arm, so on the success path the flag is never reassigned and the TCP
section's later `[[ $icmp_no_claim == yes ]]` reads `no`. That means a host that
answers ping but has TCP/22 genuinely firewalled still reaches `dropped`, not
`unreachable` — the real firewall case the stale-flag fix could plausibly have
broken while fixing the transient one. It resolves the right way.

F5 and the stale-flag edge case are closed. F4 stays open and forwarded, not
re-raised. `bash -n` clean; `shellcheck` is not installed on this host and was
correctly not chased.

The untracked `src/engine/vm/config.ts`, `src/engine/vm/vmrun.ts`, and
`test/vm/` the reviewer saw in `git status` are `task-17-impl`'s concurrent work
in the same worktree — expected, and the reason the parallelism invariant is
"never two *implementers* at once" rather than "never two agents at once". A
read-only reviewer alongside one implementer is safe; it just has to know not to
read a dirty tree as its own task's leakage, which this one correctly did.

**Task 16: complete.** `79b5d50` (amend) → `fc4a413` (F1+F3) → `5c7f650`
(F5+stale flag). Both verdicts obtained, four findings closed, one forwarded
(F4), 161 passing / 16 files, tree clean of this task's work.


### Task 17 — implemented `2aff6aa`, review dispatched

`task-17-impl` reported DONE. One commit, `2aff6aa` —
`feat(vm): VmrunTransport and VM lifecycle control`. BASE was `5c7f650`.

**Verified by me, not taken on report:** `npm run typecheck` clean and
`npx vitest run` → **183 passing / 18 files** (baseline 161/16; +22 = 6 config +
16 vmrun). The implementer's figures matched mine exactly.

Read-only spot checks on the four mandates most likely to be quietly missed:

- **Mandate 6** — `grep -rn RHCSA_GUEST_PASSWORD src/ test/ scripts/` returns
  exactly two hits: `src/engine/vm/config.ts:53` (populating the field) and
  `test/vm/config.test.ts:47` (test input). Nothing in `vmrun.ts`. The claim
  that `loadVmConfig` is the only reader of the environment, and that `Runner`
  is the single injection seam, is now true rather than aspirational.
- **Mandate 2** — `redactArgv` exists; the timeout message interpolates only
  `exe`, never the args; the error path prefers `err.stderr` and falls back to a
  redacted rebuild. **The redaction test is probative, which is the part worth
  checking:** `/bin/false` emits no stderr, so the assertion is forced down the
  redacted-rebuild path — delete `redactArgv` and the test fails. Had the test
  been written against a binary that writes its own stderr, it would have passed
  whether or not redaction existed, and that is precisely this project's
  recurring defect (a check that passes for the wrong reason).
- **Mandate 1** — `code: 124` present, with the `code: null` mechanism recorded
  in a comment beside it rather than left as folklore.
- **Mandate 8** — exactly one `as` cast across both new files, and it is the
  `forced as TransportKind | undefined` mandate 8 deliberately preserves. No
  bespoke predicate was introduced, so the `oneOf` unification parked for the
  final whole-branch review is still a single mechanical change. Site count for
  that parked item is unchanged at six in `src/`, seven counting Task 14's F3.

**Mandate 4's break-and-revert was performed and the failure observed:** with
`probes <= 2` changed to `probes <= 1`, the assertion failed as
`AssertionError: expected 2 to be 3` — i.e. `reboot()` returned after only two
`runProgramInGuest` calls. That is exactly the shape the mandate predicted: the
brief's original `probes > 2` was satisfied without `waitForGuest` ever looping.
File restored and the full suite re-run to 183/183 before committing.

**`VmrunConfigSlice` final field list, for Task 18:**

```ts
export interface VmrunConfigSlice {
  vmx: string
  vmrun: string
  sshUser: string
  guestPassword?: string
}
```

Structural, satisfied by `VmConfig`; `guestPassword` optional so the brief's
bare `CFG` test literal still satisfies it and Task 18's
`chooseTransport(cfg: VmConfig, opts?: ChooseOptions)` is unaffected.

The implementer independently re-measured all four claims the mandates rest on
(argv echo, `code: null` + `killed: true` on timeout, `--env-file-if-exists`
behaviour, `Record<TransportKind, true>` exhaustiveness) before implementing,
and reports they matched the pasted numbers exactly. Fifth consecutive task
where the "measure it yourself, yours wins" clause was exercised; first where it
found no disagreement.

Review dispatched: `task-17-review`, sonnet, given the brief, the mandates,
`task-17-review-context.md`, the report, and
`review-5c7f650..2aff6aa.diff` (23,329 bytes, 1 commit). Told to measure the
totals itself rather than repeat either the implementer's figures or mine,
since a matching independent measurement is worth something and a repeated one
is worth nothing.


### Task 18 — pre-flight during the Task 17 review (7 mandates, 2 findings disproved)

Brief extracted (459 lines: `src/engine/vm/ssh.ts`, `src/engine/vm/select.ts`,
9 ssh tests + 7 select tests). Pre-flighted while `task-17-review` runs. Every
cross-task fact checked against the committed code rather than assumed:
`VmConfig` does carry `ip?`/`sshUser`/`sshPort`/`sshKey`, so it structurally
satisfies `SshConfigSlice`; `FakeTransport(handler, opts?)` matches the brief's
`new FakeTransport(() => …)`; `npm test` is `vitest run`, so Step 6's command is
valid.

**Two findings I expected to raise and measured as NOT defects.** Recorded in the
mandate file so neither the implementer nor the reviewer re-derives them:

- **`child.stdin.end()` after the child has exited does not crash the process.**
  I predicted an unhandled `'error'` (EPIPE) — `BatchMode=yes` plus a missing key
  makes ssh exit immediately, and the brief then writes the script to a dead
  pipe. Measured: `execFile('/bin/false')`, 150 ms wait, 4 MB write under an
  `uncaughtException` watcher — no throw, no uncaught exception. The brief's
  `child.stdin?.end(stdin)` needs no error handler.
- **A late rejection from the losing side of `Promise.race` is not unhandled.**
  I predicted `availableWithin`'s `try/catch` covered only the fast half, leaving
  a post-deadline rejection to crash Node 22. Wrong: `Promise.race` subscribes to
  every input promise, so the loser's rejection is absorbed by race's own
  handler. Measured under `process.on('unhandledRejection')` — nothing fired.
  `availableWithin` is correct as written.

**Ruling: record disproved suspicions in the mandate file, not just discard
them.** Two rounds of reviewers have re-raised things an earlier round settled.
A named "I checked this and it is fine" costs four lines and saves a finding.
Cost if wrong: four lines of dead prose.

Seven mandates, each measured before being written down:

1. **`realSshRunner` has no timeout and reports a kill as exit 1** — Task 17
   mandate 1 recurring in a new file. `ConnectTimeout=10` bounds only the
   *connect* phase, so an established connection running a blocked grader hangs
   with no ceiling; Task 16 watched that happen live through the other transport.
   `makeSshRunner({timeoutMs})` defaulting to `120_000`, returning **124**. No
   redaction analogue is needed — ssh authenticates by key, so its argv carries a
   path and not a secret; required to be stated in a comment so the asymmetry
   with `vmrun.ts` reads as deliberate.
2. **Nothing in the brief proves the real runner delivers stdin at all.** The
   script-on-stdin decision is the brief's headline design claim, and all nine
   ssh tests verify it against `recorder()`, a mock. Delete
   `child.stdin?.end(stdin)` and every test still passes. Closed with a
   `/bin/cat` roundtrip (measured: returns `"hello-from-stdin\n"`), plus the
   Task 17-shaped 124 test, plus a required break-and-revert.
3. **A pinned `fake` transport is accepted and then silently discarded.**
   `loadVmConfig` validates `RHCSA_TRANSPORT` against a `KINDS` record that
   *includes* `fake`, so `cfg.forceTransport === 'fake'` is reachable through
   documented config — and `chooseTransport`'s `if (pinned === 'ssh' || pinned
   === 'vmrun')` then falls through to normal selection and hands back a live
   `SshTransport` against the real VM. **Ruling: throw a legible error in
   `select.ts` naming `RHCSA_TRANSPORT`; do not import `fake.ts` into the
   production selector, and do not reopen Task 17's `config.ts`.** The root cause
   — the set of valid `TransportKind`s and the set of valid `RHCSA_TRANSPORT`
   values being conflated — is forwarded to the final whole-branch review. Cost
   if wrong: someone wanting a VM-less UI smoke test gets an error telling them
   what to do instead.
4. **The known_hosts justification is false in both places it appears.** The
   comment and the design note both say a dedicated `UserKnownHostsFile` exists
   because "snapshot reverts change host keys". A revert *restores* the guest
   filesystem, host keys included — it cannot change them; what changes them is
   rebuilding the VM from the ISO. And `accept-new` would not rescue a changed
   key anyway: `ssh_config(5)` on this host says it adds new keys but "will not
   permit connections to hosts with changed host keys." The dedicated file is
   still right for a different reason (a rebuild's fallout is confined to a
   throwaway file instead of the user's real `known_hosts`). **Comment only — the
   code stays.**
5. **The probe echoes `rhcsa-probe` and never checks it.** `return r.code === 0`
   means the probe tests "can ssh connect", not "can this transport run a
   script" — and ssh exits 0 in cases where the remote `bash -s` never ran the
   script (a guest-side `ForceCommand`, a login shell that consumes stdin).
   Making the marker load-bearing requires editing one of the brief's own test
   fixtures (`stdout: 'ok\n'` → the marker), which is why it is a mandate.
6. **Step 7 lacks `--env-file-if-exists=.env.local`** — identical to Task 17
   mandate 9, both invocations, same reason: `RHCSA_VMX` lives in `.env.local`
   per checklist §6, so the reader is told to do what they already did. Step 7
   stays deferred; its second half (stop `sshd`, expect `vmrun`) is the only
   test the dual control plane's central claim will ever get.
7. **The 3 s probe ceiling's cost is undocumented.** Shorter than
   `ConnectTimeout=10` on purpose, but the consequence — a link needing >3 s
   silently downgrades the whole session to a 3-round-trip-per-exec transport,
   with nothing saying why — is nowhere stated. Comment only; `probeTimeoutMs`
   already exists for anyone who needs to widen it.

Also required: mandate 1's rewrite must drop the brief's two `as` casts in the
`code` derivation in favour of a local type predicate, rather than carrying them
forward and inflating the parked `oneOf` list.


### Task 17 — complete, `2aff6aa`

Both verdicts obtained from `task-17-review`. **Spec compliance: all nine
mandates PASS**, each with file:line evidence against the committed diff rather
than the report's claims. **Task quality: good** — the timeout/124 change lands
for the audience it was written for, and `reboot()` no longer hides a missing
`vmrun.exe` behind a 120 s guest-wait.

**The reviewer re-derived both load-bearing measurements independently** and both
matched: the `execFile` argv echo (`Command failed: /bin/false -gp SUPERSECRET x`)
and `code: null, killed: true, signal: SIGTERM` on timeout. It also ran its own
`npx vitest run` (183/18) and `npm run typecheck` rather than repeating the
implementer's or my figures. Three independent measurements of the same totals now
agree.

**A review technique worth reusing.** I told the reviewer it was read-only, which
blocked in-place mutation testing — so it got the same evidence a better way: a
standalone script importing the real, unmodified `VmController` and driving it
through the injected `Runner` seam at the implementer's claimed-broken boundary
(`probes <= 1` → `probes === 2`; `probes <= 2` → `probes === 3`). That
corroborates the break-and-revert instead of repeating the claim, and it needs no
write access at all. **Ruling: prefer this shape over in-place mutation wherever a
seam exists** — it leaves the tree untouched, so it composes with a concurrent
implementer, which in-place mutation does not. Cost if wrong: none; it is strictly
weaker only where no injection seam exists, and there the reviewer must still
mutate.

It correctly declined to flag the two mandate-8 traps: the preserved
`forced as TransportKind | undefined` cast and the `Record<TransportKind, true>`
replacement. The review-context file earned its cost on the first outing.

**Three non-blocking findings, none a Task 17 regression — dispositions:**

1. **A second, unguarded cast at `src/engine/vm/vmrun.ts:49`** —
   `const err = e as { stdout?; stderr?; code?; killed?; signal? }` in the catch
   block, inherited unchanged from the brief's original `realRunner`. Verified: a
   `grep -n ' as ' src/engine/vm/*.ts` returns exactly two real casts in that
   directory, `config.ts:54` (parked) and this one. **My own spot check missed
   it** — my pattern was `\bas [A-Z]`, which cannot match `as {`. Retiring that
   pattern; a cast check must match `as` followed by `{` as well as by a
   capitalised name.
   **Ruling: do not reopen Task 17. Task 18's mandate already requires a local
   type predicate for exactly this shape in `realSshRunner`'s catch block, so
   Task 18 becomes the first deliberate version of the idiom, and the final
   whole-branch review aligns `vmrun.ts:49` to it.** The mandate file was amended
   to require that predicate be written generically — about the shape of a caught
   `execFile` error, with no ssh-specific naming — so the alignment is a move
   rather than a rewrite. Cost if wrong: one extra file touched at the final
   review, which is already touching six sites for the `oneOf` helper.
   Note this is a *different* idiom from the parked guarded-union family; it does
   not join that count, which stays at six in `src/` (seven with Task 14's F3).
2. **`exec()` leaks its host temp dir if `writeFile` fails** — `mkdtemp` and
   `writeFile` run before the `try/finally` that removes the directory.
   Pre-existing in the brief, unchanged by this task. **Forwarded to the final
   whole-branch review.** Reachable only on a host-side write failure (a full
   disk), and the leak is one empty directory under `os.tmpdir()`.
3. **The report's stated reason for using a live grep over `git diff` was
   factually wrong** — it claimed `git diff` shows nothing for new files, and the
   reviewer confirmed `git diff <base>..<head>` does surface new-file diffs. The
   grep answer was still correct. No action, but recorded because it is this
   project's recurring shape in a third medium: after code and comments, now a
   *report* asserting a confident mechanism nobody checked. The conclusion being
   right is what makes it easy to miss.

**Task 17: complete.** One commit, `2aff6aa`. 183 passing / 18 files, typecheck
clean, tree clean. `VmrunConfigSlice` = `{ vmx, vmrun, sshUser, guestPassword? }`,
consumed structurally by Task 18.

### Task 18 — dispatched

BASE `2aff6aa`. Brief + seven mandates (pre-flight above) + the parked-findings
pointer for `vmrun.ts:49`.


## Task 19 pre-flight (mandates written, task not yet dispatched — blocked behind T18)

Wrote `task-19-mandates.md`: eight required changes over `task-19-brief.md`.
Every claim measured on this host or proven by quoting a file in the repo, except
mandate 4, which is explicitly marked unmeasurable without a VM.

Ruling: dispatch Task 19 with all eight mandates — the brief's `provision.sh` is
the single script standing between the user and a working VM, its acceptance step
is deferred, and nothing will exercise these paths until the user runs it for
real. Cost if wrong: a few comment rewrites and one `sed` idiom to unwind.

Five substantive defects, each with its measurement:

1. **Sourcing the template destroys an exported password.** The template the
   script itself writes contains `RHCSA_GUEST_PASSWORD=`, so
   `set -a; . ./.env.local` assigns empty over the environment. Measured:
   `after sourcing, RHCSA_GUEST_PASSWORD=[]`. This breaks Step 5's own documented
   invocation (`read -rsp … && export`), which is the **only** path that keeps a
   live VM credential off disk — and then `:?` tells the user to put it in
   `.env.local`, i.e. an error instructing them to do what they just did. Third
   instance of that shape in this plan (T17 m9, T18 m6) and the worst, because
   its failure mode pushes the user to persist a secret they chose not to.
   Fix measured working: `. <(grep -vE '^[[:space:]]*#|^[[:space:]]*$|=[[:space:]]*$' .env.local)`
   → preserves the exported password while still picking up `RHCSA_SSH_USER=student`.

2. **`RHCSA_VM_IP` is never recorded.** Guard is `! grep -q '^RHCSA_VM_IP='`, and
   the template ships that key blank, so `^RHCSA_VM_IP=` matches the placeholder
   and the branch never runs. Measured: `guard matched the blank template line ->
   IP never recorded`. The template's own comment ("leave blank and it will fill
   this in") and `docs/vm-build-checklist.md:144` both promise otherwise.
   Consequence: `SshTransport.isAvailable()` is false with no IP, so every session
   silently downgrades to the 3-round-trip vmrun transport — the same silent
   downgrade T18 mandate 7 documents from the selector's end. Fixed by replacing
   in place and keying on the value being empty rather than the key being present.

3. **`getGuestIPAddress -wait` can hang forever on run 1.** `open-vm-tools` is in
   `guest-provision.sh`'s own PKGS list, so it is explicitly not assumed present,
   and Task 16 measured that exact call hanging indefinitely against a guest
   without it (`docs/r1-findings.md`). The script installs the tools *after*
   waiting for them. The call's result is **discarded** — it is only a boot
   barrier — so bound it with `timeout 120` and make failure non-fatal with
   first-run-specific wording; bound the later step-6 capture too, where a failure
   *is* meaningful.

4. **The ISO-presence check cannot detect the ISO.** `if guest runProgramInGuest
   /usr/bin/test -f …` relies on vmrun's exit code carrying the guest program's.
   `src/engine/vm/vmrun.ts:15` — from this same plan — says it does not
   ("vmrun reports the guest program's exit status in prose on stdout"), which is
   why `GUEST_CODE_RE` exists at all. If so the `if` always succeeds, the 10 GB
   copy never happens, and the failure surfaces three steps later as
   `sudo dnf install` dying. **Not measurable without a VM** — said so in the
   mandate. Fix is correct under either behaviour: have the guest echo a token and
   grep stdout, consulting vmrun's exit code not at all.

5. **`guest-provision.sh` §0 has the very defect this repo already documents.**
   It runs `sudo -n true` immediately after an interactive `sudo tee`, so the
   15-minute per-TTY ticket makes it pass whether or not the NOPASSWD drop-in took
   effect. `docs/vm-build-checklist.md:167-172` already uses
   `sudo -k && sudo -n true` and explains exactly this in prose, twenty lines
   away. Mandate 5 makes the script match and cites §5 so they cannot drift again;
   `visudo -cf` stays ahead of the `-k`. This closes the parked `sudo -k` finding.

Plus three smaller items: the brief's line-140 cross-reference is false (the
checklist tells the user to install the drop-in by hand at §5 and says
provision.sh does the rest automatically — it never tells them to run
`guest-provision.sh` at a console, so §0 is an idempotent safety net, not a
bootstrap requirement); Step 4 must run from a scratch copy because its
guardrails only fire on *missing* values and a populated `.env.local` would let
it power on a VM and copy 10 GB unattended; and `README.md:19`'s
`(Task 19; does not exist yet)` label, forwarded from an earlier review, gets
stripped here because this is the task that makes it false.

Ruling: record disproved suspicions in the mandate file rather than discarding
them — same ruling as Task 18. `[[ -f .env.local ]] && set -a && . …` under
`set -e` does **not** abort when the file is absent (a non-final failure in an
`&&` list is exempt; measured `SURVIVED`, rc=0). Also recorded: `.env.local` is
already in `.gitignore`, so the template carries no commit risk. Cost if wrong:
four lines of mandate text. Benefit: two rounds of reviewers have re-raised
things an earlier round settled.

Out-of-bounds for T19, stated in the mandate: no VM operations of any kind
(the user's Ubuntu and Windows 11 guests are unrelated); Step 5 deferred, not
attempted; do not create, read, or modify the real
`/home/daxtangco/rhcsa-trainer/.env.local` (it may hold the user's live VM
password); no `subscription-manager` and no Red Hat credentials; no host `sudo`;
never read `sechelp-tools` secrets; `shellcheck` is not installed and is not to
be chased.

## Task 18 implemented — `cb1a878`, review dispatched

`task-18-impl` (sonnet, BASE `2aff6aa`) committed `cb1a878`
"feat(vm): SshTransport and automatic transport selection" — `src/engine/vm/ssh.ts`,
`src/engine/vm/select.ts`, `test/vm/ssh.test.ts`, `test/vm/select.test.ts`.
Reports **203 passing / 20 files** (from 183/18), typecheck clean, tree clean.
It went idle without messaging me; found by checking `git log` and the report file.
Step 7 deferred per mandate 6, with no VM operation attempted anywhere.

All seven mandates implemented per the report. Notable: `makeSshRunner({timeoutMs})`
defaulting to 120 s and returning **124** on a killed child, with `realSshRunner`
still exported under the same name and type; `isAvailable` now requires
`r.stdout.includes('rhcsa-probe')` as well as `code === 0`; a legible throw naming
`RHCSA_TRANSPORT` when `pinned === 'fake'`, placed before the ssh/vmrun branch;
`err: unknown` narrowed by a local `isExecFileError` predicate written generically
(fields `stdout`/`stderr`/`code`/`killed`/`signal`, no ssh-specific naming) so the
final review can move `vmrun.ts:49` onto it without a rewrite.

**Mandate 2's break-and-revert produced a failure mode I did not predict: a HANG,
not a failed assertion.** Commenting out `child.stdin?.end(stdin)` made the new
`/bin/cat` roundtrip test hit vitest's 10 s timeout — `cat` with no stdin and no
EOF blocks forever, so nothing resolves the promise. The other 11 ssh tests still
passed, which is exactly the mock-based blind spot mandate 2 was written to close.
The test is probative; noted for the reviewer that "fails by timing out" is weaker
than "fails loudly" and is fair game as a quality finding.

**Ruling: my verification item 4 was wrong and the implementer was right to
deviate.** I told it to confirm `grep -n "fake" src/engine/vm/select.ts` returns
nothing — impossible, because mandate 3's own required code contains
`pinned === 'fake'`. It flagged the contradiction and substituted the check that
actually matters: no `import` from `./fake.ts` (imports are only `./config.ts`,
`./ssh.ts`, `./transport.ts`, `./vmrun.ts`). Accepted; the reviewer is told to
verify the property rather than my broken command, and not to report the deviation.
Cost if wrong: none — the substituted check is strictly better.

**This is the fourth instance of the recurring defect class in my own output**,
and the second in a *verification instruction* specifically: an instruction that
states an expected result which the surrounding text makes impossible. Prior
three: mandate 5 for Task 15 (had the blind spot it was fixing); the fix-1 verify
instruction predicting an unmeasured hunk count (retired `grep -c '^@@'`);
mandate 14.1's void count table. **Rule going forward: a verification command
whose expected output I have not run must either be run first or be written as
"report what you observe" rather than "confirm it returns X".** I already apply
this to test totals; it applies to greps too. My mandate text also said the
mandates add "three" tests when they add four — the implementer's accounting (20)
is correct.

Review dispatched: `task-18-review`, sonnet, given the brief, the mandates,
`task-18-review-context.md`, the report, and `review-2aff6aa..cb1a878.diff`. The
context file flags mandate 3 (silent `fake` fallthrough) as the most important
item, mandate 2's break-and-revert, and mandate 1's 124 convention as load-bearing;
tells it not to re-raise the two disproved suspicions (post-exit `child.stdin`
write, late `Promise.race` rejection) without measuring; records that my item 4
was wrong; and marks mandates 4 and 7 comment-only so a code change there is
itself a finding.

## Task 19 dispatched — concurrent with Task 18's review

Added a **ninth** mandate before dispatching. I checked every key in the brief's
`.env.local` template against `loadVmConfig` and found eight of nine match
exactly; the template omits `RHCSA_VMRUN`, which both `provision.sh` and
`src/engine/vm/config.ts:52` read. A user whose VMware is not at the default path
therefore has no discoverable way to learn the key exists. Mandate 9 adds it to
the commented overrides block with the default spelled out and the space noted.
Also recorded there: `RHCSA_ISO` is script-only and never read by `config.ts`,
which is correct but worth a clarifying word.

Ruling: run Task 19's implementer concurrently with Task 18's read-only reviewer.
The parallelism invariant is "never two implementers in flight"; T18's implementer
is finished, and the reviewer is read-only. The two touch disjoint files — the
reviewer works in `src/engine/vm/` and `test/vm/`, T19 owns `scripts/` and
`README.md`. Cost if wrong: a confusing `git status` for one of them, which both
dispatches are explicitly warned about. Benefit: real wall-clock.

Told T19 in the dispatch that a read-only reviewer may briefly leave modified
files in `src/engine/vm/` and `test/vm/` while mutation-testing: do not revert
them, do not commit them, do not read them as its own leakage — its `git add` is
path-specific — and read the test total from its own run rather than assuming.
This is the collision point the T19 mandates' final `git status --porcelain`
check would otherwise have flagged as a false alarm. The T18 review context
carries the mirror-image warning about untracked files from a later task.

Dispatched `task-19-impl` (sonnet, BASE `cb1a878`) with the brief, all nine
mandates, the eight `loadVmConfig` env keys verbatim, the `SshTransport` /
`isAvailable`-with-no-IP linkage that gives mandate 2 its teeth, the
`docs/vm-build-checklist.md` §5/§6 pointers with "do not modify that file", the
full global-constraints block, and the instruction to confirm my measurements and
override them if they disagree — noting explicitly that one of my nine
verification instructions in Task 18 was impossible as written and the
implementer was right to deviate.

## Task 20 pre-flight (mandates written, not yet dispatched)

Wrote `task-20-mandates.md`: four required changes over `task-20-brief.md`.
`content/lib/assert.sh` is the grader helper library every `grade.sh` sources, and
it is entirely testable on this host, so I ran the brief's own proposed code
against the brief's own test table before writing anything.

Ruling: dispatch Task 20 with all four mandates. Three are false-pass paths in the
one component whose correctness the whole app rests on; a helper that returns the
wrong answer does not crash, it silently passes wrong work. Cost if wrong: one
escaping loop and two awk predicates to unwind.

**Three defects, all measured, all the "check that passes for the wrong reason"
class:**

1. **`_json_escape` handles only `\t`, `\r`, `\n`** — every other C0 control
   (`0x01`, VT `0x0B`, FF `0x0C`, **ESC `0x1B`**) passes through raw and makes the
   line invalid JSON. Measured: `JSON.parse` → "Bad control character in string
   literal". `parseVerdict` (`verdict.ts:50-52`) catches that and pushes the line
   to `noise`, so **the checkpoint vanishes from `v.checkpoints` rather than
   failing** — and `allPassed` (`verdict.ts:80-82`) is
   `every(cp => cp.status === 'pass')` over the survivors. So a grader emitting
   four passes and one fail-with-a-control-char-in-detail reports
   **`allPassed: true`**. Signature defect of this project, in the component where
   it costs the most, and `detail` is nearly always captured command output — an
   ESC from anything that colorizes gets there. Fix measured working, with a fast
   path so the per-character loop is skipped for normal strings; verified it does
   not disturb the brief's existing escaping test (`says "hi"` and
   `back\slash and<TAB>tab` still round-trip).

2. **`is_persistent` accepts `noauto`** — measured rc=0 where the function's own
   contract says "exit 0 if it will mount at boot". Fix: `$4 !~ /(^|,)noauto(,|$)/`.
   Measured that `defaults,nofail` still passes (nofail *does* mount; it is what
   `provision.sh` uses for the ISO) and a two-field fstab line still passes.

3. **`is_persistent` interpolates `$target` into an ERE** for the systemd-unit
   branch — measured that target `/var.d` matches `Where=/varXd`, a false pass on
   the evidence of a different path. The fstab branch of the *same function*
   already compares literally (`$2 == t`), so the two halves disagree on strictness
   and only one is defensible. Fix: literal comparison in awk. Measured all five of
   the brief's cases still behave, plus `Where = /var` with spaces still passes and
   exact `/var.d` still matches.

Mandate 4 is small: the new test file must use `fileURLToPath` rather than
`new URL(...).pathname`. There are already **seven** such sites in `test/`
(confirmed by grep, matching the parked "6+" note) and they are parked for one
sweep; a new file should not make that eight.

**Measured as NOT defects — recorded so no reviewer re-raises them:**
`to_bytes` is correct on all twelve cases in the brief's table. I specifically
expected `awk`'s `printf "%d"` to overflow past 2³¹ for `1T` and it does not —
this host is GNU Awk 5.3.2 and returned `1099511627776`, and 512T gave
`562949953421312`; `1.5G` and `4.00g` are exact. `to_bytes 'banana'` exits 1.
All five of the brief's `is_persistent` cases pass against the brief's own code —
the bugs are in cases it does not test. And the brief's comment claiming
`allPassed` treats `skip` as not-passed is accurate (`verdict.ts:80-82`).
Environmental caveat noted in the mandate, not a code change: these tests run awk
on the WSL host while a real grader runs awk in the RHEL 9 guest; both are GNU
awk, so the arithmetic carries, but the suite does not prove it.

Also verified the brief's own predicted test count of 26 is right by arithmetic
(6 emitter + 12 `to_bytes` + 3 `within_pct` + 5 `is_persistent`); the mandates add
four. Per the rule adopted after Task 18, the mandate still tells the implementer
to report observed totals rather than confirm a number.

## Task 21 pre-flight — `.../task-21-mandates.md` (eight mandates)

Highest-value pre-flight of the run: it is the first task with real content, so
it is the first chance to test the six rules parked here against something. Three
of the six turned out to be **mis-summaries** — written from the harness's side
before content existed — and the content disproves their strict form.

Ruling: **mandate 1 — `grade.sh` fails open on an empty size target.** Measured
`[[ 5 -ge "" ]]` -> rc=0, quoted or not. `to_bytes` returns 1 on failure and
`grade.sh` has no `set -e`, so a failed conversion leaves `TARGET=` and emits
`ck_pass` for `lv-home-size`, `fs-home-size` and `var-intact` — both goal
checkpoints included. Fix: fail closed with five `ck_fail`s and `exit 0`.
— why: worse than Task 20's `_json_escape`, where the checkpoint vanished; this
one actively asserts success on the flagship lab. — cost if wrong: five extra
lines in a grader.

Ruling: **mandate 2 — the fixture script's exit code is discarded**
(`harness.ts`, `await deps.transport.exec(fixture.script)`), twelve lines below a
`setup.sh` check that does it right and explains why. A `solutions/01` whose
`lvextend` hits a full VG produces the baseline machine, and Step 12's table
sends the reader hunting a grader that over-fits. Fix: check it for **both**
fixture kinds and return early, `|| true` as the documented escape hatch.
— why: same shape as Task 19 mandate 5 — the neighbouring code already agrees
with me. — cost if wrong: an anti-solution modelling a failing command must add
`|| true`, which is visible and one token.

Ruling: **parked finding 3 ("reject an anti-solution declaring exactly the
baseline") is NOT implemented as a content rule.** `03-wrong-lv.sh` declares
`lv-home-size, fs-home-size` — byte-for-byte the baseline set — and is still a
genuine detector: it grows root, so it catches a grader measuring "did the VG
shrink". The real risk is `03` silently not running at all, and mandate 2 closes
exactly that. — why: the strict rule would reject a good anti-solution while
leaving the actual hole open. — cost if wrong: an empty-attack-surface
anti-solution could ship in Phase 2; the final review sees the whole bank.

Ruling: **parked finding 2 ("reject a `@pre`-only anti-solution") is retired and
replaced.** It would reject `01` and `03`, both legitimate — each leaves several
checkpoints passing in A, so the reboot does run. The condition that matters is
"nothing passed in verdict A", and the live hole is `harness.ts:240-247`'s
`if (fixture.kind === 'solution')` guard, which lets an anti-solution's skipped
verdict B pass silently with its `@post` declarations unverified. Mandate 3 fixes
that instead. — cost if wrong: a general harness hole no current content trips.

Ruling: **parked finding 1 (coverage union) is recorded, not enforced.** Worked
the union: `var-intact` is probed by **nothing**, so an unconditional
`ck_pass var-intact` validates green across all six fixtures — the exact false
pass the rule targets, live in this grader. But it cannot be probed safely: XFS
cannot shrink, so breaking `/var` means `lvremove`, a reformat, or unmounting a
busy filesystem, all of which risk an unbootable guest — the hazard design
decision 1 refuses. And `validateBank` never sees emitted ids (they live in
`runFixture`'s verdict A), so enforcing it there means plumbing ids through
`FixtureResult`. Mandate 4 instead requires a `# unprobed-invariant: var-intact`
header in `grade.sh` with the reason, so Phase 1 content already carries it when
the check lands. — cost if wrong: the check ships a task or two later against
six files instead of one.

Ruling: **Step 12 is deferred and Tasks 22-24 do not wait for it.** Its "do not
proceed to Task 22 until this is 6/6" gate is unrunnable — no VM, user-owned ISO
blocker. — why: blocking would stop the run with three tasks of authorable work
left and buy nothing. — cost if wrong: content conventions established here get
corrected once the VM boots, across four tasks instead of one.

Mandates 5-8 are small: the test fixture's anti-solution has no body (and
`DO_WRONG` is a substring trap against the fake's `includes('DO')` — flagged
explicitly); `--content ""` accepted because `''.startsWith('--')` is false
(parked 8); the `--strict` test asserts no stdout (parked 7, and I verified
`tasks: N` is printed at `src/cli/index.ts:73`); `fileURLToPath` in the new test
file only; a comment at the `assertLib` concatenation site (parked 5) and a
troubleshooting row for the swallowed `readdir` (parked 4).

Measured as NOT defects, recorded so no reviewer re-derives them:
`storage.lvm.resize` exists at `content/objectives.yaml:135` (Step 10's warning
is defused); it exists at the **same id** in `objectives-rhel10.yaml:182`, so the
RHEL 9-vs-10 decision **does not block this task** and must not be raised as one;
the test fixture's `TaskSpec` matches all seventeen fields of
`src/engine/content/task.ts:22-40`; parked finding 6 is **already implemented** at
`harness.ts:252-255`; and `checkEmittedIds` already cross-checks declared ids
against emitted ones for both headers.

## Task 18: complete

Review returned (`task-18-review.md`). **Both verdicts delivered.** Spec
compliance: all seven mandates SATISFIED, each verified by mutation testing on a
scratch copy of the real module at `/tmp/rhcsa-mut*` with `node_modules`
symlinked back — not code reading. Task quality: good. **Nothing blocks.**
Independently measured **203 passing / 20 files**, typecheck clean, matching the
report exactly. `git status --porcelain` empty before and after.

The reviewer reproduced each mutation from a cold copy rather than trusting the
report: `code: 124`→`code: 1` failed the timeout test (`expected 1 to be 124`);
removing the `pinned === 'fake'` throw made `chooseTransport` **resolve** to
`FakeTransport{ kind: 'ssh' }` — the pre-mandate bug exactly; weakening
`isAvailable` to `r.code === 0` alone failed only the new ForceCommand test, so
the marker conjunct is load-bearing and the other 11 tests do not cover it.
It also confirmed `vmrun.ts:41-60`'s parked cast is field-for-field identical to
`ssh.ts`'s new `ExecFileError`, so the final-review swap is a straight one.

Ruling: **the one observation-level finding is parked, not fixed now.** Mandate
2's stdin test fails slowly — 10 s vitest timeout instead of an assertion —
because `/bin/cat` with no EOF blocks forever. The reviewer measured a fix:
`makeSshRunner({ timeoutMs: 500 })` in that one test surfaces the same mutation
as `expected 124 to be 0` in ~700 ms, and leaves the passing case at ~200 ms.
— why: it is test ergonomics on a non-blocking finding, and a fix round costs a
dispatch plus a re-review seat for a nuisance. — cost if wrong: a future
regression in that one test wastes 10 s of suite time before failing.
**Forwarded to the final whole-branch review** with the measured fix recorded
above, so nobody re-derives it.

## Task 19: implemented, review dispatched

Commit `ad8c0f2` "feat(vm): provision the lab VM and capture the clean
snapshot". All nine mandates applied. `README.md`, `scripts/provision.sh`,
`scripts/guest-provision.sh` — no `.env.local`, which does not exist on this
host, so there was nothing to preserve. 203/20 unchanged (measured twice, before
and after), `bash -n` clean on both scripts, `chmod +x` confirmed, tree clean.

The implementer **found a real defect the mandates missed** and fixed it:
mandate 3's step-6 IP capture had to be wrapped in an `if`, not left a bare
assignment, or `timeout` firing would abort the whole script under
`set -euo pipefail` instead of falling through to the existing "ssh did NOT
work … the vmrun transport still functions" path. Measured:
`IP=$(timeout 1 sleep 5 | tr -d "\r")` → `exit=124`, "reached" never printed.
Good catch; it makes mandate 3's non-fatal intent actually non-fatal.

Confirmed by measurement in the report: mandate 1's fix preserves an exported
`RHCSA_GUEST_PASSWORD=[SECRET123]` where the bare source gave `[]`; all three of
mandate 2's arms behave (blank → filled in place, populated → left alone, absent
→ appended). `shellcheck` unavailable, noted — these scripts have never been
linted. `timeout` is uutils coreutils 0.8.0.

Mandate 4's ISO-presence arm is **unverified against a real `vmrun`**, as
mandated, and Step 5 is deferred with all four of its checks described — check 0
(`sudo -n id -u` → `0`) named as the gate everything else depends on.

Task 19 review dispatched: `task-19-review`, sonnet, given the brief, the nine
mandates, `task-19-review-context.md`, the report, and
`review-cb1a878..ad8c0f2.diff`. The context flags mandates 1 and 2 as
load-bearing, marks 4 and 5 unverifiable without a VM (judge the *property*, not
my reading of `vmrun`), records the `set -e` AND-list suspicion as measured
not-a-defect, and pre-clears the implementer's step-6 `if`-wrapping deviation as
a correct improvement so it is not reported as a finding.

Task 20 dispatched: `task-20-impl`, sonnet, BASE `ad8c0f2`, given the brief and
the four mandates. Chose sonnet because the brief contains the complete library
and test code, so this is transcription plus three measured bug fixes plus a
break-and-revert.

Ruling: **Task 19's review and Task 20's implementation run concurrently.** Why:
the parallelism invariant is "never two *implementers* in flight" — T19's
implementer is finished and its reviewer is read-only. The two touch disjoint
paths (`scripts/` + `README.md` versus `content/lib/` + `test/lib/`). Both
dispatches carry mirror-image warnings naming the other's files, so neither reads
the other's work as its own leakage and neither reverts or commits it.
— cost if wrong: a confused `git status` note in one report.

## Task 22 pre-flight (mandates written, not yet dispatched)

Wrote `task-22-mandates.md` — eight mandates. Largest brief so far (1463 lines):
four task dirs + eight concept cards. Rulings:

Ruling: 11 of the brief's 13 objective ids do not exist in `content/objectives.yaml`
— substitute per the table in mandate 1 — objective ids are permanent FSRS
scheduling keys and the file's own header forbids renaming, so a reference to a
non-existent id either fails the cross-check or schedules against nothing; cost if
wrong: a wrong mapping credits the user with an objective they did not practise,
correctable later by editing the reference (never the taxonomy).

Ruling: `systemd.units.create` has no RHCSA 9 equivalent, so `systemd/017` carries
two objectives, not three, and `systemd.unit-file-anatomy`'s card points at
`systemd.services.enable` — writing a unit file is the means to "configure a
service to start automatically at boot", not a published objective in its own
right; cost if wrong: unit-file authoring is under-credited in the coverage
report, visible and cheap to add later if a real id ever exists.

Ruling: `net.ssh.configure` maps to `net.services.status`, NOT `net.ssh.key-auth`
— the grader checks enabled/listening/firewall/autoconnect and never touches a
key; cost if wrong: none material, but claiming key auth would over-claim an
untested objective (parked F9's defect class).

Ruling: `net.nm.configure` maps to `net.services.autostart`, with
`net.addressing.ipv4-ipv6` recorded as the rejected alternative — the fixture sets
`connection.autoconnect no` and configures no address anywhere.

Ruling: `setup.sh` keeps `set -uo pipefail` and gets a `need()` wrapper on the
load-bearing staging commands instead of `-e` — these scripts intentionally run
removals that fail on a first run (`semanage … -d`, `dnf remove`, `firewall-cmd
--remove-*`), so `-e` would abort setup partway on a clean machine; cost if wrong:
a little verbosity. Diverges deliberately from Task 21's `storage/014/setup.sh`
(which does use `-e`); mandate 2 requires a comment saying why, so nobody
harmonises them. Severity recorded as diagnostic-quality, not false-pass: the
harness's `kind: 'none'` baseline fixture (`harness.ts:208-228`) does catch a setup
that failed to break the machine.

Ruling: add two anti-solutions to `selinux/019` (`04-started-not-enabled.sh`,
`05-fcontext-without-restorecon.sh`) — `httpd-enabled` and `context-now` are goal
checkpoints no anti-solution fails, which is Task 11's F1 false-pass shape and,
unlike an invariant, cheap to close. Fixture arithmetic moves 6→8 for that task,
18→20 for the SSH run, 24→26 total; four places in the brief updated by mandate 3.

Ruling: the four unprobed invariants (`student-intact` ×2, `selinux-enforcing`,
`sshd-intact`) get Task 21's `# unprobed-invariant:` header rather than
anti-solutions — each would destroy the control plane the fixture is graded over,
or require a state the project forbids. `systemd/017`'s `default-target` gets no
header: it is an invariant that IS probed, by `03-broke-the-target.sh`, and is the
pattern the other four would follow if they could.

Ruling: renumber `users/006`'s anti-solutions 02,03 → 01,02 — the gap is an
artifact of promoting the original 01 to `solutions/03-primary-group-only.sh`, and
a missing `01` reads as a lost file.

Measured clean negatives, recorded in mandate 7 so nothing is re-derived: Task 21
mandate 1's empty-target false-pass class does NOT apply (these four graders
contain zero numeric comparisons); all four graders correctly omit `set -e`;
`users/006`'s `in_devops()` uses `id -nG` so `solutions/03`'s primary-group path
passes; `03-aging-skipped`'s `group-gid` declaration is accurate (`groupadd` with
no `-g 5000`); the expiry comparison is UTC-correct (`date -u` is load-bearing);
`sudo sudo -l -U` is deliberate; all eight card `id:` values are declared in
frontmatter, correctly shaped, and every `requires_concepts:` entry matches one;
`scope: instrumental` is valid; the brief's own Step 8 cross-check script is
correctly line-anchored; and the pre-mandate fixture arithmetic (6+6+6+6=24, 18
ssh + 6 vmrun) was right.

Dependency recorded: Task 22 writes into `content/concepts/`, which does not exist
yet — `content/` currently holds only `lib/assert.sh`. **Task 21 must land first.**

## Task 19: reviewed, one must-fix; fix round 1 dispatched

`task-19-review.md` (13k). **Both verdicts delivered. All nine mandates
SATISFIED.** Nothing blocks. Reviewer independently reproduced mandates 1, 2, 3
and 7 rather than trusting the report; mandate 4 judged on its stated design
property and marked explicitly unverifiable without a VM, as instructed. Measured
233 passing / 21 files and correctly attributed the +30/+1 delta to Task 20's
concurrent `test/lib/assert.test.ts` after reading `git log` — the mismatch check
worked exactly as the context asked.

**F1 (must-fix, reproduced).** The template line mandate 9 added,
`#RHCSA_VMRUN=/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe`,
breaks when a user uncomments it verbatim: the value is unquoted with spaces and
parens, so `. <(grep -vE ...)` dies with `/dev/fd/63: line 4: syntax error near
unexpected token '('`, exit 2. This is a regression from the *combination* of
mandates 1 and 9, present in neither alone — under the old bare
`[[ -f ]] && ... && . ./.env.local`, the same malformed line printed the error but
`set -e` did not fire (non-final command in an `&&` list, the exemption measured
during Task 19's pre-flight), so the script silently continued with the default
and ignored the override. Mandate 1 made the source a standalone statement, so now
it aborts.

Ruling: fix it — quote the template's example value, and sweep the template's
other path-valued examples for the same hazard; cost if wrong: a one-line
follow-up. Dispatched as `task-19-fix1` on haiku (single line, one file, no
judgement). It is a genuine defect on the path a real user is most likely to need
(VMware Workstation is never at a space-free path on Windows) and it fails in the
one way the script's design explicitly set out to avoid — a raw bash error naming
neither `.env.local` nor the docs, on the 9pm first build.

**This is the same recurring defect class in its documentation medium, fifth
instance: an instruction that states an action without stating that what the
reader will see is an error.** The instruction was mine, in mandate 9.

**O1 — a real side effect on the host, cleaned up, verified by me.** While going
one arm past mandate 7's two prescribed guardrail runs, the reviewer populated
both guarded variables, so the script proceeded to
`ssh-keygen -f "${RHCSA_SSH_KEY:-$HOME/.ssh/rhcsa_lab}"` — and `$HOME` is the real
host home, NOT the scratch tree, because `provision.sh`'s `cd "$(dirname
"$0")/.."` only relocates `.env.local`. It wrote a real keypair to
`/home/daxtangco/.ssh/rhcsa_lab{,.pub}` and deleted both. **Independently
verified: `/home/daxtangco/.ssh/` is now empty (only `.` and `..`), so nothing
pre-existing was overwritten.** The directory itself was created by that test and
is left empty and harmless.

Correction to my own instruction: `task-19-review-context.md` told the reviewer a
copy of `provision.sh` "operates entirely inside that tree". **That is false past
the two `:?` guards.** Any future scratch test of this script must also override
`RHCSA_SSH_KEY` into the scratch tree. Carried into `task-19-fix1`'s dispatch as
an explicit prohibition. Not a defect in the diff — that line is unchanged
brief-original code and no mandate touches it.

Forwarded: FL1 (mandate 4's ISO check unverified against real `vmrun` — confirm on
first run that a second `provision.sh` prints "guest already has
/var/lib/rhcsa-dvd.iso" and does not re-copy 10 GB); FL2 (Step 5 acceptance
deferred entirely, all four checks).

## Task 20: implemented at c1b3b01, review dispatched

`task-20-report.md`. All four mandates applied: `_json_escape` now covers the full
C0 range (`\b`, `\f`, then `\uXXXX`), `is_persistent`'s fstab branch rejects
`noauto` but not `nofail`, its systemd branch compares `Where=` literally via
`awk`, and the test file uses `fileURLToPath`. TDD order followed. **New baseline:
233 passing / 21 files** (30 new tests in `test/lib/assert.test.ts`), typecheck
clean, `bash -n` clean, tree clean.

Mandate 1's break-and-revert produced exactly the predicted shape and the
implementer pasted it: `v.noise` held the one line with raw ESC and bell bytes,
`v.checkpoints` was empty — the checkpoint vanished rather than failing, which is
the path by which `allPassed` can return true for a run that did not pass.
Implementer independently re-verified `verdict.ts:41-58` and `80-82` before
writing any code.

Wrote `task-20-review-context.md` and dispatched `task-20-review` (sonnet) with
`review-ad8c0f2..c1b3b01.diff`. The context records the four measured
not-a-defect items so nothing is re-derived — in particular **my awk `printf
"%d"` overflow suspicion was wrong** (gawk 5.3.2 returns `1099511627776` for `1T`
and `562949953421312` for `512T`, exact), and "the brief's five `is_persistent`
tests pass" is not evidence about mandates 2 and 3, whose bugs are in cases the
brief never tests.

Ruling: run the Task 19 fix and the Task 20 review concurrently — they touch
disjoint files (`scripts/provision.sh` vs `content/lib/`, `test/lib/`) and each
dispatch names the other's files as concurrent-not-mine; cost if wrong: a
confused finding, cheap to disposition. Both agents went idle without messaging
again — the recurring lost-child mode, now four for four. Found by `git log` and
`/bin/ls -lt` on the workspace, not by waiting. `ls` is aliased to `eza` in this
zsh, and the Bash tool runs zsh, so `$var` word-splitting and `--time-style` both
fail: use `bash -s <<'EOF'` and `/bin/ls`.

## Task 20: complete

`task-20-review.md`. **Both verdicts. Spec compliance 4/4. Task quality good.
Nothing blocks.** Measured 233 passing / 21 files, typecheck clean, `bash -n`
clean — matching the implementer with no discrepancy.

Reviewer used mutation testing on a scratch `/tmp` copy with `node_modules`
symlinked back and confirmed each of the three substantive mandates breaks
**exactly one** test and nothing else — so each has a genuine load-bearing
regression test rather than a coincidentally-passing one. `git status --porcelain`
empty throughout.

Went past the mandates on three points worth keeping:
- **`xnoauto` / `noautofs` / `defaults,xnoauto,rw` all still pass.** The fstab
  guard is `$4 !~ /(^|,)noauto(,|$)/`, anchored on the word, so it does not
  over-reject — the trap the review context named was checked and is absent.
- **`/var.d` vs `Where=/varXd` now fails** where the brief's interpolated regex
  would have matched via `.` as a wildcard, and `/var/log` vs `Where=/var` fails
  in both directions. No substring leakage.
- **DEL (`0x7f`) is deliberately not escaped and that is correct** — RFC 8259 only
  requires escaping `U+0000`-`U+001F`, and `JSON.parse` accepts raw `0x7f`.
  Recorded so nobody "fixes" it later. Reviewer's observation: my own mandate prose
  blurred "control character" with "C0" in places; one code comment would settle
  it. Parked, non-blocking.

Task 20: complete.

## Task 19: complete (F1 fixed over two commits)

`145c344` quoted the template's `RHCSA_VMRUN` example — the actual fix, verified
by reproducing both the syntax error and the clean source.

Round 2 was needed and is `17b8cd4`. Round 1 went beyond the instruction and
invented example values for two keys that had been blank:

Ruling: revert both invented values, keep the quoting guidance as one line — cost
if wrong: none, the placeholders return to what they were.
- **`#RHCSA_SSH_KEY="/home/user/.ssh/id_ed25519"` was a genuine footgun.**
  `provision.sh` runs `ssh-keygen -f "$KEY"` with
  `KEY=${RHCSA_SSH_KEY:-$HOME/.ssh/rhcsa_lab}`, and `id_ed25519` is the commonest
  filename for a person's real personal key — the example invited aiming a
  key-generating script at it. It also contradicted the project's own dedicated
  `~/.ssh/rhcsa_lab` default.
- **`#RHCSA_ISO="/mnt/c/ISO/rhel-9.6-x86_64-dvd.iso"`** invented a filename and
  asserted a point release nothing in this project has established.
- My instruction said to quote values that "could contain a space or a shell
  metacharacter when uncommented" — a **blank** value can contain neither, and the
  sourcing filter strips blank-valued keys anyway, so both were already safe.
  The instruction was loose; the fix over-read it.

Verified `17b8cd4` myself: both keys back to blank, `RHCSA_VMRUN` still quoted,
one `# Quote any value containing a space.` line in the overrides block, tree
clean. Dispatching a cheap verifier pass on `145c344..17b8cd4` rather than
self-approving.

Task 19: complete.

## Task 21: dispatched

BASE = `17b8cd4`. Mandates were written earlier (eight) plus an addendum added
this session verifying mandate 1's `TARGET=$(to_bytes 12G) || TARGET=` against the
now-real `content/lib/assert.sh` — it holds for a parse error (rc 1), for
`assert.sh` not prepended (rc 127), and for missing `awk` (rc 127, since the awk
call is the function's last command). Dispatched `task-21-impl` on sonnet.

---

## Ledger correction — the "Task 21: dispatched" line above was premature

The preceding block recorded `Task 21: dispatched` before the Agent call was
actually made. The line was ahead of reality for one turn. Correcting it here
rather than editing history, so the ledger stays append-only and the gap is
visible to anyone recovering from it.

**Actual dispatches, made now, both against BASE = `17b8cd4`:**

- `task-21-impl` (sonnet) — Task 21 implementation. Brief `task-21-brief.md`,
  mandates `task-21-mandates.md` (eight plus the `to_bytes` addendum), report
  to `task-21-report.md`. Dispatch carried the interfaces the brief cannot
  know: `content/lib/assert.sh` exists at `c1b3b01` with exactly ten helpers
  and is closed to edits; `to_bytes` returns 1 on a parse failure and 127 when
  `awk` or the library is missing; `_json_escape` now covers the full C0 range;
  124 means "timed out" project-wide; `chooseTransport` rejects a pinned
  `fake`; `SshTransport.isAvailable()` needs exit 0 **and** the `rhcsa-probe`
  marker; and — the one that matters most — **`harness.ts` already implements
  `checkEmittedIds(..., 'expect-fail', ...)` and the appeared-only-after-reboot
  check at ~252-255, so parked finding 6 must not be re-implemented.**
  Baseline stated as 233/21. Step 12 deferred (no VM). Staging by named path
  only, no `git add -A`, no `git commit -a`, because other tasks commit
  concurrently.
- `task-19-fix-verify` (haiku) — read-only verification of `145c344..17b8cd4`,
  the Task 19 F1 fix. Satisfies the standing "never self-approve in the same
  active context" rule at low cost, and it is disjoint from Task 21's files.
  Carries the explicit prohibitions on running `provision.sh`, touching
  `.env.local`, and running `ssh-keygen` or writing into `/home/daxtangco/.ssh/`
  — the last because the earlier reviewer escaped `/tmp` that way.

`Ruling: dispatch Task 21 and the T19-fix verification concurrently rather
than serially — why: they touch disjoint files (content/ + src/ vs. a
read-only look at scripts/provision.sh), so the verification costs no
critical-path time, and folding the T19 fix into the final whole-branch review
instead would leave a fixed must-fix unverified for the rest of the run — cost
if wrong: one cheap haiku pass duplicating what the final review would have
caught anyway.`

`Ruling: keep the append-only correction rather than editing the premature
line — why: a ledger that rewrites itself cannot be trusted as a recovery map
after compaction, and the failure mode being corrected (a recorded dispatch
that never happened) is exactly the one a reader needs to see documented —
cost if wrong: a few lines of ledger noise.`

---

## Task 21 — implementer DONE, reviewer dispatched

`task-21-impl` (sonnet) committed **`8513019`** "feat(content): first graded
task, two concept cards, rhcsa validate" against BASE `17b8cd4`, wrote
`task-21-report.md` (19,495 bytes), and left `git status --porcelain` empty.
It went idle without messaging me — five for five now; reconciliation by
`git log` + `/bin/ls -lt` is the reliable method on this branch, not waiting.

Report claims **246 passing / 23 files** (from 233/21), typecheck clean, +13
tests across two new files (`test/validate/run.test.ts`,
`test/cli/validate.test.ts`). Created the ten content files under
`content/tasks/storage/014-grow-home-lv/` and `content/concepts/storage/`,
plus `src/engine/validate/run.ts`; modified `src/cli/index.ts`,
`src/engine/validate/harness.ts`, `test/validate/harness.test.ts`,
`test/cli/coverage.test.ts`. Step 12 (the six-fixture VM matrix) deferred per
the standing ISO ruling; report says so explicitly and unprompted.

Review package: `review-17b8cd4..8513019.diff`, 1 commit, 44,229 bytes.

**Dispatched `task-21-review` on opus** with the four artifacts, the package
path, the global constraints, the defect class, and the 233/21 baseline with
"report the totals you observe."

`Ruling: review this task on opus rather than the mid-tier reviewer floor —
because it is the first content task and twenty-seven more will be written by
imitating its conventions, so a convention that is subtly wrong here is wrong
twenty-eight times and will look like a bug in each individual task rather
than in this one; and because mandate 1's subject matter is bash comparison
semantics where an empty operand silently passes. Cost if wrong: one
expensive review seat on a 44 KB diff.`

## Task 19 fix verification — re-dispatched, first run left no artifact

`task-19-fix-verify` (haiku) returned nothing and wrote no file. Nothing in
the workspace bears its name, so there is no partial result to salvage.

`Ruling: re-dispatch the verification on sonnet rather than folding it into
the final whole-branch review — the standing rule is never to self-approve a
fix in the same context that produced it, the files are disjoint from Task 21
so it costs no critical path, and the final review is already the most
expensive dispatch in the run and should not absorb work a cheap read-only
pass can close. This time the dispatch names the output file as the
deliverable and says the previous run left no artifact. Cost if wrong: one
sonnet read-only pass over two small commits.`

`Ruling: raise the floor for read-only verification dispatches from haiku to
sonnet for the rest of this run. Haiku produced no artifact and no message
here; the skill's own guidance is that turn count beats token price, and a
dispatch that returns nothing costs a full re-dispatch. Cost if wrong: a few
cents per verification pass.`

## Task 23 pre-flight complete — `task-23-mandates.md` written (28,184 bytes)

Nine mandates, every claim measured on this host with output pasted. The two
that matter most:

- **Mandate 2 is the run's first security finding.** `/ws/terminal` spawns
  `ssh -tt` into the guest as `student`, who has passwordless sudo via
  `/etc/sudoers.d/rhcsa-trainer`. As briefed, `serve()` passes no `hostname`
  (so the listener is reachable from the whole LAN) and the upgrade handler
  performs no `Origin` check. WebSocket upgrades are not subject to the
  same-origin policy, so any page the user visits could open a root shell in
  the lab VM, and loopback binding does not close that second hole because the
  request comes from the user's own browser. Both fixes are one line; the
  mandate requires both plus two tests, and allows a *missing* `Origin` on
  purpose so `wscat` acceptance still works.
- **Mandate 7 is the signature false pass, live in the student-facing path.**
  `reportFor` derives `total` from `v.checkpoints.length`, and `allPassed`
  only needs `length > 0` plus all-pass — so a grader truncated mid-stream
  (a 124 timeout, a wedged `lvs`, an early `exit`) reports `passed: 3,
  total: 3, allPassed: true` while the session's static `checkpointTotal` says
  7. Verdict **B** already has a backstop (`completeVerdictB` fills B's
  missing ids as `fail` with `NOT_REPORTED_DETAIL`); **verdict A has none**,
  and the validation harness's `checkEmittedIds` only runs under
  `rhcsa validate`, not on the route the student takes. Mandate adds
  `incomplete`/`expectedTotal` to `GradeReport` and requires the
  break-and-revert.

Also mandated: `sshArgs` moves to `ssh.ts` (not `config.ts`) keeping the no-IP
throw that `test/vm/ssh.test.ts:98-100` asserts — the brief's `cfg.ip ?? ''`
deletes it, and the brief pre-diagnoses the resulting failure as list drift,
which would invite editing the test; I diffed the two option lists and they
are byte-identical, so drift is not a possible explanation. Seven new `as`
cast sites refused with a named replacement each (measured current inventory:
five lines / six casts in `src/`). `TOP_RUNG` and `RUNGS` added to `ladder.ts`,
closing Task 12's parked magic-5 finding whose owner is this task.
`commandSketch` fixed with a before/after table over eight cases.
`countCheckpoints` pinned by a test against the real `assert.sh`.

`Ruling: mandate 5 (commandSketch) is a cheap-fix-with-tests, not a
must-fix-now blocker, even though it emits "]]", "d'" and "fstab" as commands
to look up. Rung 4 takes the FIRST solution (contextFor uses
scripts.fixtures.find(kind === 'solution') and loadTaskScripts sorts names), so
Task 21's flagship lab renders 01-lvextend-then-growfs.sh, which comes out
clean — and I grepped Task 22's four tasks: no first solution in Phase 1 trips
it. I nearly wrote this up as a live defect in the flagship lab on the strength
of solution 02's sed line before locating which file it belonged to. Cost if
wrong: student-facing nonsense at rung 4 for some Phase 2 task, caught by the
tests the mandate requires.`

`Ruling: Step 20's acceptance is deferred like Task 21's Step 12, and Task 24
does not wait for it. Its stated {"tasks":5} and "checkpointTotal":5 are
predictions about content that only exists after Task 22, not assertions —
the mandate forbids encoding either number in a test. Cost if wrong: the API
has never been exercised against a real VM or browser when the run ends, which
is already true of every VM-touching step in Phase 1 and is stated in every
report.`

## Task 19 fix rounds — VERIFIED, task closed

`task-19-fix-verify-2` (sonnet) wrote `task-19-fix-verify.md` (9,104 bytes) and
left the tree clean. All three questions verified:

1. **Round 2 reverted exactly the inventions and only the inventions.** Both
   invented values (`#RHCSA_SSH_KEY="/home/user/.ssh/id_ed25519"`,
   `#RHCSA_ISO="/mnt/c/ISO/rhel-9.6-x86_64-dvd.iso"`) are back to blank; the
   `RHCSA_VMRUN` quoting fix survives as the only net change. `git grep` finds
   zero residue of `id_ed25519` or `/home/user`; the two hits for
   `rhel-9.6-x86_64-dvd` are the script's own hardcoded default at
   `provision.sh:61` and the plan at line 5816, both predating `145c344`.
2. **The net quoting guidance is correct, confirmed empirically.**
   `provision.sh:52` sources `.env.local` through
   `. <(grep -vE ...)`, so surviving lines are executed as bash statements —
   the unparenthesised real path breaks with `syntax error near unexpected
   token '('` and leaves the variable empty; quoted, it sources cleanly with
   the spaces intact. Downstream `VMRUN` is always `"$VMRUN"`.
3. **The `:?` guards and the ISO-present check are consistent with the touched
   comments.** The two commits only ever touched the "Optional overrides"
   block; `:?` fires only for `RHCSA_VMX` and `RHCSA_GUEST_PASSWORD`, which are
   documented above it and untouched. `git grep RHCSA_ISO -- src/ test/` is
   zero hits, so the comment's "read by this script only, never by the app" is
   true.

**One finding, and it is about a commit message, not code.** `17b8cd4`'s message
calls the reverted `RHCSA_ISO` example "an unmotivated filename/version", but
that value is exactly `provision.sh:61`'s own default and exactly what the plan
specifies — it was grounded, not invented. The revert is still right, on the
different and valid ground that this template leaves optional-override keys
blank so the code-level default applies (matching `RHCSA_SSH_PORT` and
`RHCSA_TRANSPORT`). The `RHCSA_SSH_KEY` revert's stated rationale *is* accurate:
the real default is `$HOME/.ssh/rhcsa_lab` (`provision.sh:60`,
`config.ts:51`, spec line 272), and `/home/user/.ssh/id_ed25519` matches none of
it.

`Ruling: do not amend 17b8cd4 to correct its rationale. The resulting file is
correct and the message's error is a claim about why, not what; amending means
rewriting a commit that a later commit already builds on, and this branch's
ledger cites shas as its recovery map after compaction. The correction is
recorded here instead, which is where a future reader of that message will be
looking anyway. Cost if wrong: one commit message on this branch overstates a
rationale for one key.`

**Forward to Task 25** (which owns the docs and the acceptance checklist): the
general "Quote any value containing a space." comment sits at
`provision.sh:34`, between `RHCSA_TRANSPORT` and `RHCSA_VMRUN`, so it reads as
scoped to `RHCSA_VMRUN` rather than as a house rule that also covers an
`RHCSA_ISO` path under a Windows profile with a space in the username. A
one-line move. Harmless today because no example values remain for the other
keys.

`Task 19: complete` — implementation, review, two fix rounds, and an
independent verification pass on the fix rounds by a different agent.

## Task 24 pre-flight complete — `task-24-mandates.md` written (23,787 bytes)

Nine mandates. **The headline finding spans two tasks and both suites are green
across it**, so it also produced an addendum to `task-23-mandates.md`
(mandate 10, appended; file now 31,014 bytes):

**The transport-mismatch warning can never fire.** `POST /api/sessions` sets
`transport: deps.runtime.transportKind` (task-23-brief:1243) — the *server's*
transport. `/api/health` returns the same expression (line 1166). Task 24's Rail
computes
`mismatch = props.serverTransport !== undefined && props.serverTransport !== session.transport`,
which compares a value to itself, so the banner telling the student to go work
at the VMware console because the task needs `vmrun` is unreachable code. Its
Task 24 test passes because it hand-builds a state the server cannot produce
(`session({transport:'vmrun'})` with `serverTransport="ssh"`), and no Task 23
test can catch it either: the `TASK` fixture is `transport: 'ssh'` (line 782)
and the fake runtime is `transportKind: 'ssh'` (line 826), so
`expect(body.transport).toBe('ssh')` passes under *either* meaning of the field.
Fixed in Task 23 by adding `taskTransport: task.transport` alongside, with a
test that distinguishes them; Task 24 compares task-against-server and adds the
missing negative test.

Also mandated: `incomplete`/`expectedTotal` from Task 23 mandate 7 must reach
the screen as words (otherwise the truncated-grader false pass renders as
"3 / 3 passed" and the whole server-side guard is wasted at the last step);
the `Origin` allowlist must contain `http://localhost:5173` because a proxied
upgrade forwards the browser's origin and the failure would look like the
`ws: true` proxy bug the brief warns about; three of four new `as` casts
eliminated with a pasted `tsc` probe; `SessionMode` imported type-only instead
of hand-redeclared, with `vite build` + grep required to prove no server code
reaches the bundle; `onStatus` moved to a ref so an inline arrow cannot
reconnect the WebSocket every render; the controls disabled after Finish;
`environmentMatchGlobs` replaced with a per-file docblock.

`Ruling: allow exactly one `as` cast in src/web/api.ts, at the JSON
deserialization boundary (`return body as T`), and eliminate the other three.
Removing it properly needs a validator per route, which is Phase 2 and buys
little against a server in the same repo; hiding it by letting JSON.parse's
`any` flow through unannotated is the same unsoundness with none of the
visibility. Cost if wrong: a malformed server response becomes a runtime
TypeError in the browser instead of a caught ApiError — never a wrong grade.`

`Ruling: Step 16's fourteen browser-plus-VM checks are deferred like every other
VM step, but checks 4-6 ARE the Phase 1 exit criterion (learn the concept from
a card, solve the lab, no book), so they must survive verbatim into Task 25's
acceptance checklist rather than being dropped with the rest. Three of the
fourteen ("five tasks", "3 / 5 passed", "rating hard") are predictions about
Task 21 and Task 22 content, not assertions, and the mandate forbids encoding
any of them in a test. Cost if wrong: the app ships never having been rendered
in a browser, which is already stated in every report.`

Measured-correct list handed to the implementer so it cannot re-litigate them:
`summary()` matches `TaskSummary` field-for-field (ten fields); the session
response matches `StartedSession` field-for-field (ten fields); **the terminal
wire protocol is correct in both directions** — I went looking for a
`[object Blob]` bug and `spawnSshPipe`'s `setEncoding('utf8')` on both streams
means `onData` yields strings, `ws.send` produces text frames, and
`String(ev.data)` is right (inbound, `ws.on('message', d => b.onMessage(d.toString()))`
handles the Buffer); the test counts 5 and 11 are both correct; DTL's
`getNodeText` joins only direct text-node children, so `getByText('01:30 / 10:00')`
matches; `getAttribute('disabled')` is `""` not null for a React-disabled
button; native `.click()` needs no `act()` because both handlers are `vi.fn()`
that update no state; `vitest/globals` is not needed in `types` because the
tests import explicitly.

## Task 25 pre-flight — mandates written

`task-25-mandates.md` (9 mandates). Task 25 is the exit-criterion task; its
deliverable is a record, so most of the pre-flight went into stopping the
implementer from writing down things that have not happened.

Measured, all against the tree at HEAD (not inferred):

- delivered `content/tasks/storage/014-grow-home-lv/grade.sh` emits exactly 5
  distinct `ck` ids (`fs-home-size`, `home-from-lv`, `lv-home-size`,
  `persist-config`, `var-intact`); `# baseline-fail:` (line 14) names 2, so
  `checkpointTotal === 5`, `passed === 5` and Task 24's "3 / 5" are all correct
- `SessionPhase = 'active' | 'graded'` (t23 brief:542) — `phase === 'graded'` ok
- `deriveRating` hits `if (i.rungUsed === 3) return 'hard'` (ladder.ts:66) — ok
- 5 tasks / 10 concept cards reachable (1+4, 2+8); 30 fixtures = 5 x 6
- `createLabRuntime` stores `reboot: () => opts.controller.reboot()` (t23:746),
  read at call time, so Step 2's post-hoc monkey-patch works — my earlier doubt
  was wrong, no mandate needed beyond a comment
- `test:vm`'s `set -a` sourcing verified under dash: spaces survive, missing
  file still reaches vitest
- `task.yaml` has **no** `nudge:` field and needs none — rung 2 is synthesized
  by `rungContent` case 2 from objective texts + card titles (t23:284-295).
  Chased this as a suspected cross-task break; it is not one.

Findings written up as mandates:

1. **Step 9's `git tag -a phase-1` must not be created.** Its message asserts
   "graded end to end with the reboot check", which is ISO-blocked and has not
   happened. Handed to the user with the ordered prerequisite list.
2. `docs/exit-criterion.md` ships with an explicit NOT-YET-RUN banner and every
   form field blank. Hard prohibition on inventing dates/answers — an LLM
   filling in that form is the likeliest way this task produces a durable lie.
3. **`echo "exit=$?"` after `… | tail -40` reports tail's status** (t25:264,269),
   so Step 4's own primary acceptance check can never fail. Fixed with
   `set -o pipefail` (POSIX-2024, works in both bash and zsh — the user's shell
   is zsh). Implementer must audit the brief for the same shape.
4. Step 4's comment "the four SSH tasks plus the storage one" (t25:258) counts
   five; the command lists four and 24 = 4 x 6. storage/014 *is* an ssh task.
5. All **four** `as Record<string, unknown>` casts in Step 2 (t25:132,176,183,213)
   replaced with local `isRecord`/`obj`/`str`. Not just constraint compliance:
   under the cast a missing `content` yields `String(undefined)` === "undefined"
   and the test asserts on it.
6. **The two exit-criterion assertions both pass on content never assembled.**
   (a) `not.toMatch(/lvextend|xfs_growfs/)` passes on `''`, on empty
   `ctx.concepts`, and on a rung-1 body returned for rung 2 — added positive
   `toContain` for the objective text and both card titles. (b) measured card
   bodies are **1814** and **1773** chars, so `cardBody.length > 1500` is
   cleared by *either card alone* and cannot detect a dropped card; added both
   `## <title>` headings, the `\n---\n` separator, and raised the floor to 3000
   (real value 3587). These two assertions are the brief's only evidence for the
   "learned from a card, not a book" half of the criterion.
7. `set -a` sourcing exports blank keys, and `config.ts:35-55` defaults with
   `??`, which unlike `provision.sh`'s `${VAR:-default}` keeps `''` — so
   `RHCSA_SSH_KEY=` yields `ssh -i ''`. README warning now; `config.ts` fix
   forwarded to the final review. `RHCSA_VM_IP` and `RHCSA_TRANSPORT` are
   unaffected (falsy guard / legible throw respectively).
8. Measured-correct table so no reviewer reopens the nine items above.
9. All nine forwarded items placed: 4 into the README's "Adding content" rules,
   5 into "Known limits" / a new blank "Second manual scenario" section. Step 5's
   `npm run coverage` is the one artifact genuinely verifiable here — run for
   real, never hand-written.

Ruling: Task 25's implementer does not create the `phase-1` tag and does not
mark Step 10 complete — why: a tag is a durable named claim, and its message
asserts a verification that is ISO-blocked; ruled rather than stopped because a
local annotated tag is deletable and so is not the irreversible side effect that
stops the loop — cost if wrong: the user runs one `git tag` by hand after Step 8,
having been told the exact command and the reason it was withheld.

Ruling: the `config.ts` empty-string-defeats-`??` defect is documented in the
README and forwarded, not fixed in Task 25 — why: `config.ts` belongs to a closed
task and is outside Task 25's file list, and the final review already sweeps that
file for its `as` cast at line 54 — cost if wrong: the footgun survives one more
review cycle behind a README warning that names it.

Ruling: Step 2's `cardBody.length` floor is raised 1500 -> 3000 against the
brief's explicit number — why: 1500 sits below the length of a single card, so
the brief's own stated intent ("both cards rendered") is unenforceable at that
value; 3000 holds with 587 chars of margin on real content — cost if wrong: a
future card edit that shortens the pair below 3000 fails a test that names
exactly which assertion and why.

## Task 21 review returned (opus) — APPROVE WITH CHANGES, fix round 1 dispatched

`task-21-review.md` (22,804 bytes). The reviewer landed the artifact at 15:09
without messaging me — the sixth agent this run to finish silently. Found by
reconciling `/bin/ls -lt` against the workspace, per the skill's instruction to
chase children that finish without reporting.

Both required verdicts present:
- **Spec compliance: PASS.** All eight mandates plus the addendum satisfied.
- **Task quality: APPROVE WITH CHANGES.** Two must-fixes, both convention-level.

**Totals reconciled.** Reviewer measured 246 passing / 23 files, typecheck clean,
against a 233/21 baseline at `17b8cd4`. That matches `task-21-report.md` exactly
(+13 tests, +2 files). No discrepancy — the report was accurate. Reviewer's
`git status --porcelain` empty before and after; mutation work done on a scratch
copy at `/tmp/t21mut` with `node_modules` symlinked back, per the house technique.

The reviewer did not take the report's pasted evidence on faith: it re-ran all
three of mandate 1's guard failure modes, mutation-tested mandates 2, 3, 5 and
both halves of 6, hand-traced all six fixtures against `grade.sh`, and checked
all four parts of the grader contract. Also confirmed `# baseline-fail:` omits
`var-intact` (required, because the `kind: 'none'` fixture asserts everything
unlisted passes) and that `comm -23` names `var-intact` as the sole emitted-but-
undeclared id — exactly mandate 4's table.

### Must-fixes — dispatched as fix round 1 (`task-21-fix-1`, sonnet)

**F1. `setup.sh` never verifies `/home`'s starting size.** Its precondition block
checks that `/home` is its own LV and that VG `rhel` has >= 5 GiB free, but not
`/home`'s current size — the one property both goal checkpoints measure. Two
failure directions:
- built slightly small (8 GB decimal, or 8000 MiB = 7.8125 GiB): solution 02's
  *relative* `lvextend -r -L +4G` lands at 11.8125 GiB and fails `lv-home-size`,
  and Step 12's table routes that to "grader over-fitting … do not change the
  solution to suit the grader" — the wrong diagnosis, and the same red-herring
  shape mandate 2 exists to kill, reappearing on the content side where the
  exit-code check cannot catch it because `lvextend` succeeds.
- built at or near 12 GiB: student reads "almost full, make 12 GiB available",
  does nothing, grader passes. **Student-facing false pass** — the project's
  signature defect. `within_pct(..., 2)` gives `fs-home-size` a +/-245 MiB
  tolerance, so 11.76 GiB already satisfies it at baseline.
Fix dispatched: absolute `-L 12G` in solution 02, plus a setup precondition
failing at >= 11.5 GiB naming `docs/vm-build-checklist.md:74`.

**F2. `grade.sh:4-9` carries the literal `# baseline-fail:` in prose.** Mandate 8
asked for that paragraph at the concatenation site in `harness.ts:60-64`, where it
is inert; it is there, but it was *also* copied into the one file whose headers
are parsed. Correct as committed (the literal sits mid-line, parser anchors on
`^#\s*`), but the reviewer measured that reflowing the comment so the literal
starts a line throws `more than one "# baseline-fail:" header found`. Fails
loudly, so not a false pass — cheap-to-fix inherited fragility in the template
27 more graders clone from. Fix dispatched: delete the duplicate.

### Two of my own mandates were factually wrong. Accepted.

**F3 corrects mandate 1's addendum.** I claimed the fail-closed guard "behaves as
the message claims" when `assert.sh` is not prepended. It does not: `ck_fail` is
undefined in that mode too, so the guard emits **zero** checkpoints on stdout and
cannot deliver the diagnosis its own detail string names. Still fail-closed
(`parseVerdict('')` -> no checkpoints, `allPassed` requires `length > 0`,
`checkVerdict` reports "grader emitted no checkpoints"), and the two modes that
can occur in a working install both emit all five lines. Reviewer's measurement
stands over my claim, per the brief's own rule.

**F4 corrects mandate 3's rationale.** I framed the skipped-verdict-B arm as
closing a false pass — "the fixture passes green having tested half of what it
claims." Not reachable: `expectedStatus` returns `'pass'` for a `@post` id in
verdict A, so `checkVerdict` already reported `verdict A <id>: expected pass, got
fail`. Confirmed by the reviewer's mutation run. The change is still correct and
gives a far better message; it is a diagnostic improvement, not a closed hole.

That is two wrong rationales in one mandate file, both of the same kind: asserting
a failure mode's behaviour without measuring it. Same class as mandate 12.3's
wrong rationale and mandate 14.1's void count table. The standing correction
holds — do not write a rationale for a failure mode I have not executed.

### Observations forwarded, all placed

- **F5** (the `needs at least 2 solutions` troubleshooting row lives only in
  `task-21-report.md`, where no one diagnosing a failure will read it) and
  **F7** (Step 11's `grep -oE 'ck_(pass|fail|skip) [a-z0-9-]+'` matches comment
  prose, so the project now silently forbids `ck_pass <word>` in a grader
  comment) -> written into `task-25-mandates.md` as **mandate 10**, both destined
  for `docs/r1-findings.md` and the README's "Adding content" rules.
- **F1's generalisable convention** ("setup must verify every precondition the
  goal checkpoints depend on, not only the ones needed to run"), plus prefer
  absolute over relative arguments in solutions, plus "guest not built to spec"
  ranked ahead of over-fitting in failure tables -> written into
  `task-22-mandates.md` as **mandate 9**, since Task 22 clones the directory
  four times.
- **F6** (mandate 5's `WRONG` is load-bearing but buys traversal of the exit-code
  path, not "the anti-solution now does something wrong") and **F8**
  (`src/cli/index.ts:534` aliases `bank.tasks` behind an unreachable `push`;
  `const require` at 553 reads like the CJS builtin) -> parked, final review.

Ruling: F1 and F2 land now as a fix round rather than being parked or folded into
the final review — why: both are convention-level and Task 22 clones this
directory four times immediately, so parking them converts two one-file fixes
into 28 retrofits, which is the same argument mandate 4 used for writing
`# unprobed-invariant:` up front — cost if wrong: one extra commit and one scoped
re-review on a task whose spec verdict already passed.

Ruling: F3's and F4's corrections are recorded against my mandates and not
actioned as code changes — why: in both cases the delivered code is right and only
my stated reason was wrong, and the reviewer confirmed each change is
mutation-tested and load-bearing — cost if wrong: the ledger over-credits two
small changes, which F3 and F4 now permanently annotate.

Ruling: Step 12 stays deferred and no fixture in this task has ever executed
against a real machine — why: the RHEL 9 ISO is a user-owned blocker and the
six-fixture walkthrough is explicitly a design claim, not a result — cost if
wrong: F1 is the finding most likely to surface as a real Step 12 failure the day
the VM boots, which is why its fix is landing now rather than with the rest.

Reviewer's blocking answer: **No.** Tasks 22-24 may proceed on these conventions
once F1 and F2 land.

## Housekeeping — stray workspace outside the repo

The `task-19-fix1` agent wrote its report to
`/home/daxtangco/.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-19-fix1-report.md`
— i.e. under `$HOME`, not under the repo root, missing the `rhcsa-trainer`
component. That is outside this plan's workspace and outside git entirely, so it
was invisible to every later `/bin/ls` reconciliation of the workspace.

Copied into the workspace as `task-19-fix-1-report.md` (1,854 bytes). The stray
copy is left in place rather than deleted; it is one report file and deleting it
buys nothing. No other artifact was affected — Task 19's substance is
independently covered by `task-19-review.md` and `task-19-fix-verify.md`, both
of which are in the workspace, and the ledger's recovery map is the commit shas
(`145c344`, `17b8cd4`), which are in git.

Worth noting for the final review: a subagent given a workspace path can write
outside it, and nothing in the dispatch contract catches that. Every dispatch
from here on names the report path absolutely and in full, which these did — the
agent still mistyped it. The only reliable check is reconciling the workspace
listing against the reports I expect, which is how this surfaced.

Also flushed at this point: a backlog of idle notifications from the Task 18,
19, 20 and 21 agents, all for work already closed in this ledger. No new
information in any of them; the Task 21 review's truncated tail matches the
artifact I read in full.

## Task 21 fix round 1 — `aae2dca`, scoped re-review dispatched

F1 and F2 fixed in one commit. Totals held at 246 passing / 23 files, typecheck
clean. I read the whole diff myself before dispatching the re-review (5,584
bytes, three files, all shell) rather than relying on the fixer's summary.

**F2** — the duplicated paragraph is gone from `grade.sh:3-9`, leaving the
loader reference and dropping the sentence that quoted the literal
`# baseline-fail:`. The canonical copy at `harness.ts:60-64` is untouched.
Verified directly: exactly **1** line matches `^#[[:space:]]*baseline-fail:`, and
the five emitted ck ids are unchanged (`fs-home-size`, `home-from-lv`,
`lv-home-size`, `persist-config`, `var-intact`).

**F1** — all three edits present:
- `solutions/02-lvextend-r-by-uuid.sh:7` now `sudo lvextend -r -L 12G`. `-r` and
  the UUID fstab work are unchanged, so solution 02 keeps its value as an
  over-fitting detector, and the comment above it still names those two as its
  intended differences from solution 01 — no stale `+4G` reference left.
- `setup.sh` gains a precondition ahead of the free-extents check reading
  `sudo lvs --noheadings --nosuffix --units b -o lv_size rhel/home`, failing at
  `>= 12348030976`. Arithmetic checked: 11.5 x 1024^3 = 12348030976 exactly.
  The comment states the reasoning — that `lv-home-size` and `fs-home-size` both
  grade "/home reached 12 GiB" so the precondition they depend on is /home's
  *starting* size, and that 11.5 GiB sits under the 11.76 GiB point where
  `within_pct(..., 2)` would satisfy `fs-home-size` at baseline. The failure
  message names `docs/vm-build-checklist.md:74`.
- The convention comment is above the precondition block, phrased generally for
  the 27 clones.

Style is consistent with what was already there: same `fail()` helper, same
`[[ -n $x ]] || fail ...` idiom, same explicit non-interactive `sudo`, and the
new `lvs` call uses flags identical to the pre-existing `vgs` call.

One open question handed to the re-reviewer rather than settled here: the new
check compares `home_lv_bytes` with bash `(( ))`, and if LVM ever emits a
fractional value like `8589934592.00` under `--units b --nosuffix`, `(( ))`
throws and **both** the new check and the pre-existing `vgs` check break. I
could not test it — no VM. The new code is consistent with the convention it
was held to, so my expectation is this forwards as a shared pre-existing risk
rather than landing as a new defect, but I asked for independent judgement and
explicitly told the reviewer not to invent an answer about LVM's output format.

Ruling: the `(( ))` fractional-output question is asked, not assumed, and will
forward rather than block — why: the new call is byte-for-byte consistent in
flags and comparison style with a pre-existing call that already passed review,
so holding the fix to a stricter standard than the code it sits beside would be
incoherent, and Step 12 surfaces it the day the VM boots — cost if wrong: both
preconditions abort with a bash arithmetic error on first real run, which fails
loudly before any grading and names the line.

Re-review dispatched (`task-21-rereview`, sonnet) on
`review-8513019..aae2dca.diff`, scoped to F1 and F2 plus a regression check.
BASE for Task 22 will be `aae2dca`.

## Task 21: complete

Scoped re-review (`task-21-rereview.md`) returned **F1 CLOSED, F2 CLOSED**, no
regression, no new findings.

The re-reviewer did the work rather than reading the fix: it rebuilt the actual
`assertLib + '\n' + gradeBody` string `loadTaskScripts` produces and ran the real
`parseExpectations` on it (parses `lv-home-size, fs-home-size`, `var-intact`
still correctly absent), recomputed 11.5 GiB = 12348030976 independently, and
derived the `within_pct(..., 2)` pass boundary from `assert.sh`'s actual formula
at **12,627,203,850.24 bytes** (11.76 GiB), confirming the 11.5 GiB threshold
sits ~0.26 GiB below it. Totals 246 / 23, typecheck clean, `bash -n` clean on all
three scripts, `git status --porcelain` empty before and after.

On the `(( ))` question it added a fact I did not have: the identical
`lvs --units b --nosuffix | tr -d ' '` pattern **already exists in
`assert.sh`'s `lv_size_bytes()`**, which `grade.sh` itself calls for
`lv-home-size` and `var-intact`. So the new precondition is the *third* site in
this one task relying on LVM's byte output being integral, not the first. It
declined to guess whether LVM's `b` unit can be fractional, which is the right
answer. Forwarded to the final review as a three-site shared assumption:
`assert.sh:lv_size_bytes()`, `setup.sh`'s new home-size precondition, and
`setup.sh`'s pre-existing `vgs` free-extents check. Step 12 settles it the day
the VM boots.

Task 21: complete. Commits `8513019` (implementation) and `aae2dca` (fix round 1).

## Task 22 dispatched — four graded tasks, eight concept cards

BASE `aae2dca`. Model: **opus**.

Ruling: opus, not the cheap tier the "brief contains the content" heuristic would
suggest — why: the brief is 59 KB / 1,463 lines with 112 fenced blocks, so much of
it *is* transcription, but the deliverable is 36 files of RHCSA graders whose
correctness no VM can check yet (Steps 9-10 deferred), and a grader that passes on
a do-nothing student is a defect the user would carry into the exam; domain
judgement on RHCSA fact, not typing speed, is the binding constraint — cost if
wrong: a more expensive dispatch on a task whose output the whole of Phase 2
clones.

Ruling: Task 22 stays one dispatch rather than splitting Steps 1-4 (four
independent task directories) from Steps 5-6 (eight cards) — why: Step 7 checks
that every `requires_concepts` id resolves, which requires both halves present,
so splitting would commit a knowingly-broken intermediate state — cost if wrong:
one large review surface instead of two smaller ones.

The dispatch carries the conventions Task 21 settled that the brief predates:
`assert.sh` is prepended and must not be sourced; the `# baseline-fail:` /
`@post` / `# expect-fail:` / `# unprobed-invariant:` header vocabulary; that
every emitted-but-unlisted checkpoint must pass at baseline because the `none`
fixture asserts it; literal `ck` ids only; the two comment-collision
prohibitions from F2 and F7; fail-closed on uncomputable values; and mandate 9's
precondition rule with its report table.

## Task 22 — concern triage before review

The implementer returned DONE_WITH_CONCERNS. Per the skill, concerns about
correctness or scope get addressed before the review is dispatched. Two were
correctness-or-scope; the rest are observations that get forwarded.

**Concern: `libselinux-utils` missing from the guest package list.** Real, and a
cross-task blocker: `selinux/019`'s grader (`grade.sh:31,33`) and setup
(`setup.sh:52-53,104`) both call `matchpathcon`, which that package provides, and
`scripts/guest-provision.sh`'s `PKGS` did not list it. Fixed in its own commit
`85bf671`. Measured before fixing: `PKGS` had `policycoreutils-python-utils`
(so `semanage` was covered) but not `libselinux-utils`, while
`guest-provision.sh:117` already runs `getenforce` — also from that package — and
`docs/vm-build-checklist.md:103` tells the builder to run it too. So the project
already depended on the package without declaring it; the line is correct whether
or not RHEL 9 ships it in the base install. Untested: no VM exists.

Ruling: fix applied outside Task 22's diff, as its own commit — because it is a
Phase 0 script Task 22 does not own, and folding it into Task 22's commit would
have put a VM-provisioning change inside a content commit. Cost if wrong: the
Task 22 reviewer sees a commit range it was not briefed on, so the dispatch names
it explicitly.

**Concern: `httpd` also missing from `PKGS`.** Ruling: leave it out. That is not
an oversight, it is the point — `selinux/019` claims `pkg.dnf.install`, so the
student installs `httpd` themselves. Adding it to `PKGS` would pre-solve a step
the task grades. `guest-provision.sh:88-90`'s own comment already states this
rule ("every package pre-installed here is one the exam might expect you to
install yourself"). Cost if wrong: nothing — if the local ISO repo cannot serve
`httpd`, the task fails at the student's own `dnf install`, which is exactly where
a missing-repo problem should surface.

**Concern: the fixture counts.** The implementer's section 8 corrected its own
brief's numbers, and in doing so invalidated numbers in Task 25's brief and in my
own Task 25 mandate 4 — both of which assumed six fixtures per task. Recounted on
the tree at `85bf671`: `selinux/019` = 8 (2 sol + 5 anti + 1 none), the other four
= 6 each; 26 ssh, 6 vmrun, **32 total**, not 24 and 30. The implementer's own
figure of 20 for its three ssh tasks is consistent with this (26 − `storage/014`'s
6). Rewrote mandate 4 to cover all four stale sites in the Task 25 brief (lines
253, 258, 272, 508), and corrected the row in mandate 8's measured-correct table
that asserted "30 fixtures = 24 + 6" — that row was itself the defect, which is
the second time a mandate of mine has stated a number I did not measure.

Ruling: the numbers are corrected in the mandates, not in the brief or the plan
file, keeping the established pattern that mandates supersede the brief. Task 25's
implementer is told to reproduce the count itself and to say so in its report if
Task 23 or 24 changes it. Cost if wrong: an operator sees `26/26` where a document
promised `24/24` and correctly distrusts a successful run.

Ruling: **`systemd/017-boot-time-service` keeps two objectives, not three.**
`systemd.units.create` does not exist in `content/objectives.yaml`, mandate 6
forbids adding objectives, and the implementer declined to stretch
`systemd.services.enable` to cover unit authoring. That was the right call and I
am not overriding it. Objective ids are permanent FSRS scheduling keys — a
row added now to paper over one task's brief is a key the scheduler carries for
the life of the app, and it would be added without the taxonomy review that the
still-open RHEL 9-vs-10 revision question is going to force anyway. The skill
itself is not lost: `content/concepts/systemd/unit-file-anatomy.md` teaches it,
and `checkCoverage` will keep reporting the gap. Folding the question into the
Phase 2 taxonomy decision. Cost if wrong: one Phase 1 task under-credits its
objectives, and a Phase 2 migration has to backfill scheduling history for the new
id — annoying, reversible, and cheaper than an id we regret.

Ruling: **concern 6 forwards to the final whole-branch review, unfixed.**
`checkCoverage` cross-checks each *task*'s `objectives:` against
`objectives.yaml` but not each *concept card*'s, so a typo in a card's
`objectives:` is silent — the card simply teaches nothing, and coverage still
reports the objective as untaught with no explanation. The implementer hand-checked
all eight new cards. Not fixed here because it is a validator change in Phase 0
code, and Task 22 is a content task; making it now would put an unreviewed engine
change under a content review. Cost if wrong: a future card can be silently
inert until someone reads coverage output closely.

Ruling: **`# unprobed-invariant:` enforcement stays forwarded.** Already parked
for the final review from Task 21; Task 22 added four more headers. Nothing parses
them today and the implementer said so plainly. Cost if wrong: four honest records
of a known gap continue to be documentation rather than a check.

Observations forwarded without action: D6 (mandate 3's draft antisolutions were
functionally wrong and the implementer fixed them by copying `solutions/01`
verbatim — the reasoning is sound and I accept it; my draft omitted the
`DocumentRoot` change and the `<Directory>` block, so `page-served` would have
failed in verdict A, contradicting `04`'s own `@post` declaration); D7
(`troubleshooting/028` adds `usermod -aG wheel student` beyond mandate 2's list,
required by the `student-intact` invariant); D8 (`selinux/019` deletes a stale
`semanage fcontext -e` equivalence rule for idempotency, without which
`context-permanent` starts green and breaks the `kind: 'none'` baseline).

## Task 22 — review dispatched

Review package: `review-aae2dca..85bf671.diff`, 2 commits, 83483 bytes.
BASE `aae2dca` (Task 21's fix round), HEAD `85bf671`. The range deliberately
includes my own `libselinux-utils` commit as well as the implementer's `9d2dc22`;
the review context says so explicitly and tells the reviewer it is my work, not
the implementer's, so the reviewer neither credits it to Task 22 nor reports its
absence from the brief as a finding.

Dispatched `task-22-review` on **opus**. Model choice: the diff is 42 files of
new content whose defects are semantic rather than syntactic — an over-fitted goal
checkpoint or a mis-declared `@post` reads as perfectly ordinary bash and is only
catchable by reasoning about the grader contract end to end. This is also the
flagship content bank the whole Phase 1 exit criterion runs through. Cost if wrong:
an expensive review of a content diff.

Reviewer inputs: the brief, the mandates (marked as superseding the brief), the
report, the diff package, and a written context file rather than a pasted prompt.
Required: both verdicts, findings numbered, and an explicit invitation to say if
one of my mandates was wrong — the Task 21 reviewer corrected two of my rationales
and that was worth more than the mandates.

Ruling: review dispatched with Steps 9 and 10 (the two `npm run validate` runs)
still deferred and no VM in existence, and the reviewer told that the long
"not verified" list in report section 9 is **correct** for this task rather than a
defect. Cost if wrong: static review is the only gate this content gets until the
ISO is downloaded, so a runtime-only defect — a grader that emits a different id
than it declares, a setup that fails on a real guest — survives to the first real
run. That is the known and accepted shape of every content task in Phase 1.

## Task 22 — review returned, fix round 1 dispatched

Spec compliance **PASS**. Task quality **APPROVE WITH CHANGES**. 14 findings:
1 high, 4 medium, 5 low, 4 nits. Nothing blocks Task 23 — the reviewer verified
every `ck` id in the four new graders is a literal, so `countCheckpoints`'s static
inspection works. Report: `task-22-review.md`.

The reviewer measured what it claimed: tsc clean, 246/23, coverage exit 0 with no
`problem:` lines, `bash -n` clean on 37 scripts, all 10 cards' and 4 tasks'
objective ids resolved against `objectives.yaml` (no typo — my review-context item
7 is clean), declared-vs-emitted ids checked both directions, zero `ck_pass` in
comments, and it confirmed empirically in bash that `$?` in argument 3 expands
before argument 4's command substitution. `git status --porcelain` stayed empty; no
VM operation, no `ssh-keygen`, no `.env.local`, no `provision.sh`. It also
confirmed `85bf671` is correct — `libselinux-utils` does provide both
`matchpathcon` and `getenforce`, and `guest-provision.sh:118` uses the latter.

**F1 (HIGH) is a real bug, and my mandate 7 item 5 caused it.**
`users/006/grade.sh:26-29` compares `days * 86400` against
`date -u -d 2027-06-30 +%s`, but field 8 of `/etc/shadow` was written by
`chage -E` / `useradd -e` → shadow-utils `strtoday()` → GNU `get_date()`, which
parses a bare `YYYY-MM-DD` in **local** time. Measured on this UTC+8 host:
`date -d`/86400 = 20998, `date -u -d`/86400 = 20999. `docs/vm-build-checklist.md:63`
says "Time: your zone" — the checklist does not pin UTC. Direction is false-fail:
`users/006` would have failed 4 of 6 fixtures at Step 9 (solutions 01/02/03 on
`carol-expiry`, plus an undeclared `carol-expiry` failure in `antisolution/01`).

My mandate 7 item 5 asserted the opposite — that the `-u` was load-bearing and
that dropping it would break non-UTC guests — and then told the implementer not to
re-derive it. The `-u` is what *creates* the dependency. I verified the reading
side and never looked at the writing side, then attached a "measured clean" label.
Retracted in place in `task-22-mandates.md` with the mechanism written out.

That is the **third** time this exact error has appeared from me: Task 21 mandate 3
(wrong rationale for the skipped verdict-B arm), mandate 12.3 (same shape), and now
this. The first two cost a paragraph of reviewer time. This one would have cost a
four-fixture Step 9 failure with a note attached saying it had been checked, which
is worse than saying nothing — a wrong "verified" label spends the operator's
trust. The standing rule is now stated in the mandates file itself, not just here:
never write a rationale for a failure mode I have not executed, and never tell an
implementer to stop looking at something I only half traced. Also retracted:
mandate 8's "23 scripts" (real: 30) and "203 tests / 20 files" (real: 246/23,
already current at `aae2dca`) — F14, both mine, both unmeasured.

### Rulings on the 14 findings

Ruling: **fix eleven now** — F1 (the bug), F2, F3, F4, F5 (mediums), F6, F7, F8, F9
(lows), F12, F13 (nits). Every one is a bounded edit to content this round already
has open, and all four mediums are content-correctness that reaches a student.
Instructions in `task-22-fix-1.md`. Cost if wrong: one more fix round.

Ruling: **F4 ranks second only to F1** and is not forwarded despite being a medium.
Every firewall checkpoint in the batch silently means the default zone and no setup
verifies the interface is in it, so a student who runs the canonical
`firewall-cmd --permanent --add-service=ssh` on a guest whose NIC sits in another
zone gets a green checkpoint while the traffic is still dropped — against a prompt
that promises "reachable from other machines, permanently". It is the only finding
in the review that can make a **failure look like a pass**, which is this project's
named defect class, and it is the same shape as mandate 9's motivating example.
Cost if wrong: a precondition that fires on a correctly built guest, which is loud
and cheap to relax.

Ruling: **`solutions/03-primary-group-only.sh` stays a solution; the prompt
changes** (F3). The reviewer settled the question my review-context asked: the
grader does count primary membership (`id -nG` includes it, and `sudo -l -U`
resolves `%devops` through the full group list), so the fixture is not mis-filed
against the grader — only against the prompt clause "in addition to their own
primary groups", which no checkpoint measures. Deleting the clause is right and
the alternative is wrong: restricting `-g devops` to carol would destroy the
fixture's entire purpose, which is to prove the membership checkpoints grade end
state rather than mechanism. Cost if wrong: the prompt teaches one less habit
about primary groups, which a concept card can carry instead.

Ruling: **F2 gets a prompt bullet, not a checkpoint.** `stamp-effect` means "it ran
at boot" in verdict B and "you also started it by hand" in verdict A, and the
prompt asks for neither. Mandate 6 freezes the checkpoint set, and the honest fix
is to make the prompt ask for what the grader measures. Worth recording that
`028/grade.sh:5-9` explicitly declined to write a phase-ambiguous checkpoint for
this exact reason and `017` shipped one anyway — the convention existed, in the same
commit, and did not transfer. Cost if wrong: one extra sentence in a prompt.

Ruling: **F12 is reworded, not repaired.** Adding the missing `%devops` rule to
`antisolutions/01` would change what the fixture breaks and put its `# expect-fail:`
declaration in play, which is not a nit-sized change. The comment claims the
fixture demonstrates coupling between checkpoints; it fails for two independent
reasons and demonstrates nothing of the kind. Teaching material states what it
does. Cost if wrong: the coupling lesson stays untaught by a fixture.

Ruling: **F10 forwarded, deliberately not fixed.** The `pipefail` + `grep -q`
SIGPIPE hazard is real in principle, and the reviewer's own measurement is the
reason to leave it: every producer emits at most a few hundred bytes, well inside
the 64 KiB pipe buffer, so it finishes writing and exits 0 before `grep -q` can
close the pipe. Rewriting nine probe sites across four files to close a hazard that
cannot fire on this input is likelier to add a bug than remove one. Forwarded to the
final whole-branch review as one deliberate pass with a test behind it. Cost if
wrong: a probe reports 141 as a fail on some future grader with a chattier producer
— and the fix is the same one line then as now.

Ruling: **F11 forwarded to the engine backlog.** `vmrun.ts:252-292`'s `guestUp()`
proves only that VMware Tools can run `echo up`, so verdict B can be graded before
`multi-user.target` is reached; `019 page-served` and `028 sshd-listening` are
exposed, and Task 22 is the first content with three reboot-checking tasks, so it
is the first exposed at scale. Not Task 22's code and not its defect. The fix is to
poll `systemctl is-system-running` for `running` or `degraded` before grading
verdict B. It sits at the top of the verdict-B half of the reviewer's failure
table. Cost if wrong: intermittent verdict-B-only failures that look like content
defects — which is exactly why the failure table ranks it first.

Fix round 1 dispatched by resuming `task-22-impl` (rounds 1-3 resume the same
agent, per the skill). Instructions in `task-22-fix-1.md`, findings in
`task-22-review.md`; the message itself carries only the three things it must not
miss. Told explicitly: no checkpoint added, removed or renamed this round — stop and
ask instead — and say per fix whether it was measured or reasoned, because a
"verified" label on reasoning is the specific failure that produced F1.

## Task 22 — fix round 1 landed (`1ac01f2`), two rulings, one extra commit ordered

Commit `1ac01f2` on `phase-0-1`: 10 files, 191 insertions / 29 deletions, all under
`content/tasks`. Base was `85bf671` rather than `9d2dc22` because HEAD had already
moved to my `libselinux-utils` commit; the implementer said so unprompted and did
not touch `scripts/guest-provision.sh`. Eleven findings fixed as ruled; F10, F11,
F14 left as ruled and the implementer agrees with all three.

Gates: vitest 246/23 unchanged, tsc exit 0, `bash -n` clean, coverage exit 0 with no
`problem:` lines, declared-vs-emitted clean both directions with per-task counts
identical to before (8/7, 5/2, 5/3, 5/4, 8/7), and the checkpoint-declaration
headers **byte-identical** to `9d2dc22` — which is the specific thing I told it not
to move, verified the specific way that proves it.

Worth recording what F1's fix actually measured, because it is more than I asked
for: local 20998 vs UTC 20999 differing by exactly 1; the local midnight epoch not
a multiple of 86400 (remainder 57600), which is my "dropping `-u` alone makes it
worse" claim observed directly rather than argued; and a simulation of the
comparison against what `strtoday` would store, showing the old grader fails a
correct answer on this host while the new one passes it and still rejects a day
early, a day late, and an unset expiry. `want=` is now in the detail string, so a
recurrence is diagnosable from fixture output instead of requiring this analysis
again. What stays reasoned is only that `chage -E`/`useradd -e` route through
`strtoday`'s local parse — the one link that needs a guest.

Ruling: **the wider F8 pattern stands; my prescription was too narrow.** I ruled
`\((ALL|root)(:(ALL|root))?\)`; it shipped
`\((ALL|root)([[:space:]]*:[[:space:]]*(ALL|root))?\)` and measured that mine
rejects `(ALL : ALL)` while its own accepts it and still rejects `(ALL : bob)` and
`(bob : ALL)`. `sudo -l` renders a runas spec naming both a user and a group with
spaces, so `%devops ALL=(ALL:ALL) ALL` — valid, grants everything, and the common
idiom — would have been a false fail under my pattern. A strict superset that is
correct under either rendering is the right call whether or not the spacing claim
holds, and the spacing claim is reasoned, not measured, because `sudo` cannot run
here. Cost if wrong: the pattern accepts one runas spelling nobody writes.

That is the second time in this round the implementer's reading beat my
prescription (F8, and F4's split into runtime `--get-active-zones` and permanent
`nmcli connection.zone` halves — which I had not thought about, and which matters
because `firewall-ssh` and `firewall-permanent` are permanent checks while
`connection.zone` re-binds at boot). I told it so directly. The standing rule from
F1 cuts both ways: if my prescription and the implementer's measurement disagree,
the measurement wins.

Ruling: **F4's "an interface under no zone is fine" is accepted.** firewalld handles
an unbound interface through the default zone, and asserting positive membership
would have failed correctly built guests in a way the implementer said it could not
describe honestly. That last clause is the right test for whether a precondition
should exist. Whether a real NIC lands in the default zone is a guest question and
stays one. Cost if wrong: F4's precondition passes a guest whose NIC is bound to a
non-default zone only if firewalld also reports no active zone for it, which is not
a state firewalld produces.

Ruling: **F15 — fix the third loose `is-enabled` site, `systemd/017/grade.sh:37`'s
`sshd-intact`.** The implementer found it, flagged it instead of drifting the grader
surface on its own initiative (correct), and asked. F9 unified three sites to the
strict string form and named only two; leaving one of four loose after a deliberate
unification guarantees the next reader reopens the question and cannot tell whether
the odd one out was a decision or an oversight. It is also an **invariant**, and
invariants are the checkpoints nobody examines until one lies — a bare
`systemctl is-enabled` exit status is 0 for `static`, `indirect`, `generated`,
`alias` and `enabled-runtime`, so the loose spelling is worse there than in a goal.
Three lines, ordered as a separate commit so the re-review sees the two apart, with
the id unchanged and `sshd-intact` still absent from `# baseline-fail:`. Cost if
wrong: a stricter invariant fails a guest where `sshd.service` is legitimately not
literally `enabled`, which on a RHEL 9 guest built to the checklist it is —
`guest-provision.sh:109` runs `systemctl enable --now sshd`.

Round 1 is therefore two commits. Scoped re-review dispatches once the second lands.

## Task 22 — F15 landed (`decf75d`), scoped re-review dispatched

`decf75d`: `systemd/017/grade.sh`, 1 file, 8 insertions / 2 deletions. `sshd-intact`
now anchors on the string. Reasoned, not measured, and the implementer said so — that
`is-enabled` exits 0 for `static`, `indirect`, `generated`, `alias` and
`enabled-runtime` is read from systemd's exit-status table, not observed; there is no
systemd on this host. What it verified is mechanical only: parse, id set, identical
construction to the three already-reviewed sites.

Two things in it beyond the spelling, both worth keeping in the record:

- The variable is `sshd_state`, **not** `state`, because `state` is already live at
  line 14 for `stamp-enabled`. Reusing it would have clobbered the value that
  checkpoint's detail string reads and produced a misleading diagnostic on an
  unrelated checkpoint. That is the only real hazard in a change this small, and it
  is why F15 is not a literal copy of F9's two sites. Called out to the re-reviewer
  as the one place a careless edit could corrupt another checkpoint's diagnostic.
- It added the `"is-enabled=$sshd_state"` detail, matching the other three sites. The
  old form emitted no detail at all, so an `sshd-intact` failure said nothing about
  why — which for an invariant is most of the point of tightening it.

**The implementer corrected its own measurement tool, unprompted, and that is the
entry worth reading twice.** On the first cross-check run this round its inline id
extractor matched only the `ck ` wrapper form, reported `storage/014` as
`emitted=0 goal=2`, and produced two spurious `UNPROBED-GOAL` lines.
`storage/014/grade.sh` calls `ck_pass`/`ck_fail` directly and is untouched by this
round. It re-ran covering both call forms, got 5/2, and told me which tool produced
the numbers — noting that earlier rounds' counts came from the version handling both
forms, so nothing previously reported is affected.

Ruling: accept the corrected numbers, and require a **second source** rather than
taking them. A measurement tool that silently under-counts is precisely what F1 was,
one layer up — the difference is only that this one was caught by the person holding
it. So the re-review is instructed to build its own extractor covering `ck`,
`ck_pass`, `ck_fail` and `ck_skip` and say whether it reproduces all five pairs
(`selinux/019` 8/7, `storage/014` 5/2, `systemd/017` 5/3, `troubleshooting/028` 5/4,
`users/006` 8/7). Cost if wrong: two agents' extractors share a blind spot and the
counts are wrong together — which is why the re-review also diffs the declaration
headers against `9d2dc22` directly, a check that does not depend on an extractor at
all.

Scoped re-review dispatched as `task-22-rereview` on **opus**. Package
`review-85bf671..decf75d.diff`, 2 commits, 33350 bytes — BASE `85bf671` excludes my
own provisioner commit, which the original review already passed.

Model choice: the skill says scoped re-reviews of small fix diffs take a cheap-to-mid
tier, and I am deliberately going above that. Cost if wrong: an expensive review of a
200-line diff. Reason: this diff contains the one finding in the task that was
*only* catchable by measurement, and its fix is arithmetic whose correctness is the
entire justification for the round; F4 added two parsers written from scratch against
output formats nothing on this host can produce; and F15 edits a grader where the
wrong variable name silently corrupts a neighbouring checkpoint's diagnostic. A
cheaper model would very likely accept the reported gate numbers, and accepting
reported numbers is the failure this round exists to correct.

Instructions given: per-finding disposition for **F1 through F15** plus one overall
verdict; reproduce F1's arithmetic rather than inherit it, **including the
timezone-behind-UTC sign the original review asserted and did not measure**; verify
the `state` / `sshd_state` shadowing claim by reading the file; diff the
`# baseline-fail:`, `# expect-fail:` and `# unprobed-invariant:` lines against
`9d2dc22` directly; re-run every gate rather than accept the reported ones; leave
F10, F11, F14 closed as ruled without reopening them; and mutate only a `/tmp` copy
with `node_modules` symlinked back, with `git status --porcelain` empty at the end.
Also told, as the Task 22 reviewer was, to say directly if one of my rulings in
`task-22-fix-1.md` was wrong.

## Task 22 — re-review APPROVED; fix round 2 dispatched; my F15 rationale retracted

Overall verdict **APPROVED**. F1-F9, F12, F15 CLOSED; F7 and F13 PARTIALLY CLOSED on
their reporting halves only; F10, F11, F14 NOT ATTEMPTED as ruled. Report:
`task-22-rereview.md`.

It went past its brief in the two ways that mattered. It diffed **all 26** declaration
headers across `content/tasks` against `9d2dc22` rather than the 5 files the
implementer compared — zero drift, identical file set, `sshd-intact` in zero
`# baseline-fail:` headers. And it built its own four-call-form extractor, reproduced
all five declared/emitted pairs (019 8/7, 014 5/2, 017 5/3, 028 5/4, 006 8/7) with zero
`UNPROBED-GOAL` and zero `UNDECLARED-ID` both directions, and got `storage/014` = 5/2
on its **first** run — so the implementer's disclosed under-count is not reproducible
and its self-correction was genuine. Requiring the second source was the right call and
it paid for itself twice: once on the counts, once on F1.

F1 measured across **10 timezones from −11 to +14**, all passing, with the mechanism
stated rather than the result: the grader now computes literally the same expression
`strtoday()` computes in the same TZ, so they agree **by construction rather than by
coincidence**. The old form failed 6 of the 10. Two corrections it made to the
original review's own phrasing: `Europe/London` also failed under the old check,
because BST is UTC+1 in June, so "east of Greenwich" was a zone too generous; and the
old form wrongly *accepted* a date a day late on this host, which the first review did
not note. Side effect worth keeping: `docs/vm-build-checklist.md:63` no longer needs a
UTC pin — the fix removed the dependency instead of constraining the guest.

### RETRACTION — my F15 ruling's rationale was wrong

I endorsed the implementer's claim that reusing `state` would have clobbered
`stamp-enabled`'s detail string, called it correct in the ledger, and told the
re-reviewer it was "the one place a careless edit could corrupt an unrelated
checkpoint's diagnostic". Measured: `state=` is at `017/grade.sh:14`,
`ck stamp-enabled … "is-enabled=$state"` is at `:16`, and `ck` in
`content/lib/assert.sh` prints immediately with no deferred evaluation — so by line 42
that JSON had been emitted 26 lines earlier. `state` is intact for `stamp-enabled`
**by ordering, not by naming.** `sshd_state` remains the better name and nothing
changes.

This is the **fourth** instance in Task 22 alone (mandate 7 item 5, mandate 8's two
numbers, and now this), against three in Task 21. The new element is that this time I
did not invent the rationale — I *endorsed* one, and endorsing felt like checking.
That is the more dangerous shape, because an implementer's claim plus a team lead's
agreement reads to a reviewer like two sources when it is one. Ruling, stated in the
fix-2 brief to the implementer as well as here: an endorsement is not a measurement,
and I will not write "correct" against a claim whose mechanism I have not traced in
the file. Cost of the failure if unchecked: exactly what happened — a reviewer's
attention pointed at a non-hazard, with the real one (F4's device derivation, below)
found only because the re-review went past its brief.

### Rulings on the residuals

Ruling: **one more round, five items** (`task-22-fix-2.md`), rather than closing Task
22 on the APPROVED verdict. Two of the five are directional — one fail-open and one
vanishing-checkpoint — and both sit in code this round created, so they are cheaper to
close now than to forward into a bank that Tasks 23-25 build on. Cost if wrong: one
more small commit and a light re-verification on a ~20-line diff.

Ruling: **R1 is the important one and it is a fail-open in F4's own device
derivation.** `019/setup.sh:131` uses `nmcli -g DEVICE connection show --active |
head -1`, and NetworkManager 1.42+ (RHEL 9.2+) manages loopback, so `head -1` can
plausibly be `lo`. `lo` is in no zone, and my own accepted ruling says "no zone is
fine" — so the two compose into precisely the failure F4 exists to prevent: the check
passes silently while the real NIC sits in a wrong zone. Fixing by deriving from
`ip -o route show default` as primary. `028` is not exposed (it derives the device from
`$conn`). Note the exposure was created by the interaction of a correct ruling with a
convenient idiom, neither wrong alone — which is why it survived a full review and a
fix round. Cost if wrong: a precondition that fails loudly on a guest with no default
route, which is a guest that cannot run these tasks anyway.

Ruling: **R2 — split the `want=` arithmetic.** `want=$(( $(date …) / 86400 ))` leaves
`want` unset if `date` emits nothing; `"$want"` then trips `set -u` and kills the
grader mid-run, and the re-reviewer measured the consequence: only `group-gid` is
emitted, while `carol-expiry`, `alice-maxdays`, `sudo-devops` and `student-intact`
**disappear** rather than fail. The old form left `want` empty and merely failed one
checkpoint, so F1's fix traded a wrong answer for a missing one. Unreachable with GNU
coreutils, hence a nit by likelihood — but a vanished checkpoint reads as a pass to
anything that counts failures, and preventing exactly that is why `assert.sh` and the
JSONL contract exist. Cost if wrong: one extra line in a grader.

Ruling: **R3 — the comment changes, not the code.** F5's comment claims a colon in the
profile path is safe; measured, `nmcli` writes `\:`, the `awk` does not un-escape, and
`sed` fails loudly on the stray backslash. Loud failure on an unreachable input is an
acceptable outcome and still an improvement on the old form's empty return, so the
behaviour stands. Recording *why* this one matters more than its severity: the clause
was measured against a synthetic fixture that did not reproduce `nmcli`'s own
escaping — a real measurement against the wrong input, wearing a "measured" label.
That is the F1 defect class in miniature and it is the failure mode carefulness does
not catch. Cost if wrong: a comment that overstates by one case.

Ruling: **R4 — finish F9's unification at `019/setup.sh:75-76`**, still `!= "enabled"`
where the grader now uses `grep -qx`, and where `028`'s mirror was already fixed. Same
argument as F15: after a deliberate unification the one site left in the old spelling
cannot be distinguished from an oversight. Cost if wrong: three lines.

Ruling: **R5 — correct `task-22-report.md:118` and `:174` in place.** F7's and F13's
corrections were published in `task-22-fix-1-report.md` §5 while the original report
still carries both wrong rows with no pointer, which is how a corrected record becomes
a contradictory one. Documentation only, no effect on Task 23. Cost if wrong: nothing.

Confirmed holding, no action: my F4 "an interface under no zone is fine" ruling, and my
F8 wider-pattern ruling — the re-reviewer reproduced the F8 measurement and confirmed
my own ruled pattern would have false-failed a real `(ALL : ALL) ALL`, plus four
adversarial near-misses that the shipped pattern correctly rejects.

Forwarded, unchanged: F10 (nine `pipefail` + `grep -q` sites), F11
(`vmrun.ts:252-292` grading verdict B against a partially booted guest). Newly
forwarded observation: `006/antisolutions/01`'s `# expect-fail:` list, which
deliberately omits `carol-expiry`, becomes honest for the first time as a result of the
F1 fix.

Round 2 dispatched by resuming `task-22-impl` (round 2 of 5, same agent per the skill).

## Task 22 — fix round 2 landed (`850c567`), accepted in full; round 3 dispatched for one item

`850c567`: 4 files, 70 insertions / 18 deletions, all under `content/tasks`. Gates all
re-run: tsc 0, vitest 246/23, coverage 0 problems (5/10/68/58/0), `bash -n` clean,
declared-vs-emitted clean both directions with the five pairs unchanged. Headers checked
at the re-reviewer's scope rather than its own earlier one — **every** `.sh` under
`content/tasks` carrying a header, 21 files / 26 header lines (5 `baseline-fail`, 16
`expect-fail`, 5 `unprobed-invariant`), all byte-identical to `9d2dc22`, and the 26
reconciles with the re-reviewer's count exactly. `git status --porcelain` empty.

Ruling: **accept both scope extensions.** The implementer asked me to rule on whether
round 2 should have touched only the site R4 named. It should not have, and its own
sentence is the standard I am adopting: *fixing one of two instances of the same
fail-open in the same block is how the second survives review.* That covers R1's
permanent half (identical hole via `-g NAME connection show --active`, now resolved by
asking which profile owns `$dev`) and the two `017/setup.sh` sites. Cost if wrong: a
round touched four files where three were named.

### The F15 commit opened a hole, and the sweep found it — not the retraction

While sweeping for R4 the implementer found that **its own F15 commit left
`sshd-intact`'s setup mirror on the bare exit status** while making the grader strict.
Setup accepted `static`, `indirect`, `generated`, `alias` and `enabled-runtime` where
the grader now rejects them — so on such a guest the invariant would fail for every
fixture, which is verbatim the outcome that precondition's own comment says it exists to
rule out, and a direct violation of mandate 9's exact-negation requirement. The F15
report did not mention it because the implementer checked the other three *graders* for
uniformity and never checked the *setups* that mirror them.

This is the entry to remember from Task 22. My retraction two rounds ago was about
whether a variable name was safe — and it was the wrong question twice over: the
rationale was wrong, and the real hole was one check over in a file neither of us
re-read. Confident wrong reasoning cost less than the unexamined neighbour. Standing
rule now recorded in the fix-3 brief as well as here: **when a commit changes a
grader's spelling, the sweep covers the setups that mirror it, not just the other
graders.** Mandate 9 already implied it and neither of us read it that way until it was
measured. All eight sites — four graders, four setups — are now one spelling, with zero
`is-enabled … &>/dev/null` and zero `!= "enabled"` remaining outside comments.

### Two measurements that overturned my own severity calls

Ruling recorded, both against me:

**R2's first fix was still wrong, and the implementer caught it by measuring rather
than by re-reading.** Its `want=unavailable` sentinel meant a shadow field 8 literally
reading `unavailable` would have *passed*. A false pass reachable from data is strictly
worse than the `set -u` crash it replaced. The shipped form guards on `want_epoch`
directly, so no field value can pass when `date` produced nothing. I had specified the
fix shape loosely and would have accepted the sentinel.

**R4 was a bug, not the three-line consistency edit I ruled it as.** `!=` and
`grep -qx` are identical on one line, and it checked anyway: `state` captures stderr,
so on a two-line capture whose first line is `enabled`, the `!=` form compares the whole
blob, stops matching, and setup proceeds believing httpd is disabled — while
`httpd-enabled` passes at baseline. Fail-open. Recorded because my severity call was
wrong in the *safe-looking* direction, which is the harder error to notice: I graded it
LOW on the grounds that the two forms agree, which was true of the expression and false
of the input.

Also measured this round: R1's old form returned `lo` in **five** of 8 synthetic
shapes, not one; the most useful case being "only `lo` managed, no default route", where
the old form returned `lo` and the check passed silently while the new one returns
nothing and takes the loud `fail` branch. R3's backslash does survive the `sub()` and
`sed` exits 2, confirming the comment was the thing that was wrong.

### Ruling: R6 — override the recommendation to forward `028/setup.sh:21`

The implementer left it alone as instructed and flagged it, recommending it as its own
finding in the whole-branch review. I am overriding that, on the strength of its own
description: if `lo` sorts first, setup sets `autoconnect no` on loopback, records `lo`
in `/etc/rhcsa-conn`, and the break lands on the wrong interface — so the task's premise
never happens, `net-autoconnect` measures `lo`, and **every fixture passes**. A silent
false pass across a whole task, in the task whose entire subject is restoring remote
access, in content Tasks 23-25 build on. The existing guard catches only an empty
`conn`. Forwarding parks that until after three tasks have built on it.

Its objection is correct and not a dead end: line 21 needs a connection *name* while the
hardened R1 form yields a *device*. But that is the two-step pair R1's permanent half
now performs — default route → device, then `nmcli -g GENERAL.CONNECTION device show` →
the owning profile. **The missing piece was written this round**, which is why the fix
is cheaper and safer now than when it was flagged. It also matches the file's intent
better than `head -1`: the task means to break the network the student reaches the box
over, and the default route is the definition of that.

Constraint given: do not change which checkpoints exist, what `/etc/rhcsa-conn` is for,
or how the solutions read it — and if closing it cleanly requires touching the solutions
or the grader, stop and say so, because that would mean the finding is bigger than I
judged and belongs in the whole-branch review after all. Told explicitly that concluding
this mid-way is a legitimate outcome I would rather hear than have forced.

Cost if wrong: `028`'s setup selects a different profile than before on a guest with an
unusual routing table, and the failure is loud rather than silent — versus the current
state, where the wrong selection is silent and passes everything.

Round 3 of 5, same agent. One scoped re-verification will cover `850c567` and the R6
commit together once it lands.

---

## Task 22 — final verification dispatched (rounds 2 and 3)

Package: `review-decf75d..9300d2b.diff` — 2 commits, 23892 bytes. Chain confirmed by
`git log`: `9300d2b` → `850c567` → `decf75d` → `1ac01f2` → `85bf671` → `9d2dc22` → `aae2dca`.

Context written to `task-22-verify-context.md`. Dispatched `task-22-verify` on **opus**.

**Ruling: the final verification of rounds 2 and 3 goes on opus, not the mid tier the
model-selection guidance suggests for a small scoped re-review.** Why: the diff is 2
commits and 23892 bytes, which reads cheap, but its content is shell parsing under
adversarial input — `ip -o route` field positions that shift on a `metric` token, an
`awk` that passes when its comparison operand is empty, `nmcli` backslash escaping, and
a `!=`-versus-`grep -qx` distinction that is identical on one line and fail-open on two.
Every one of the four defects this round fixed was invisible to reading and visible only
to measurement, and two of them were mine. The cost if wrong: a mid-tier pass that
reproduces the implementer's own table instead of building an independent one, and Tasks
23-25 then build on a content bank whose highest-risk file was cleared by agreement
rather than measurement.

**Ruling: this is the last gate for Task 22 — one verification, no round 4.** Rounds 2
and 3 are hardening on top of an already-APPROVED round 1; the fix loop's escalation
ladder exists for findings that resist fixing, and nothing here has resisted. If the
verification returns CHANGES STILL REQUIRED on something load-bearing, I fix it and
close; if it returns residuals that are not load-bearing, they park for the whole-branch
review with the rest. Cost if wrong: a nit ships into the content bank and is caught by
the final review, which is where the other 20-odd parked items already live.

Instructions given that go beyond the prior re-review's scope, and why:

- **Reproduce R6's 8-shape table with an independently built harness, and add at least
  two shapes the table does not contain.** The table was written by the party being
  checked. The two rows that decide it are the ones moving from `lo` to LOUD-FAIL.
- **Verify the awk claim behind the deliberately-unreachable empty-`$dev` guard.** The
  implementer kept dead code and justified it with a mechanism: on an empty `$dev` the
  zone awk compares every interface against `""`, matches nothing, and *passes*. If that
  mechanism is real the guard must stay; if it is a fiction the guard is dead code
  wearing a rationale — which is precisely the error I made four times this task.
- **Verify R4's fail-open mechanism as a second party.** I graded it a three-line
  consistency edit. The implementer measured it as a fail-open via stderr capture. I want
  that confirmed or corrected by someone who is not the implementer and not me.
- **Confirm the mirror in both directions for R4c**, the site the F15 commit broke.
- **Confirm the corrected numbers behind all three self-disclosed tooling errors**, and
  give a judgement — not a diplomatic one — on whether three tooling errors in one task
  should reduce trust in the reported numbers.

Header check pinned at the widened scope (21 files / 26 lines) and the five
declared/emitted pairs required from the verifier's own four-call-form extractor, with
the comma-separated `# baseline-fail:` shape stated explicitly so the whitespace-split
error cannot recur in the checking tool.

Also carried: the standing prohibitions verbatim (no VM, no `vmrun`, no `provision.sh`,
no `ssh-keygen`, nothing into `~/.ssh/`, no `.env.local`, no `shellcheck`, no `sudo`, no
subagents), the zsh/eza/dash environment facts, and the explicit note that `nmcli`,
`firewall-cmd` and `systemd` do not exist on this host — so anything depending on their
real output is reasoned, and must be labelled that way rather than carrying a "verified"
label. A "verified" label on reasoning is the specific failure that produced rounds 2
and 3.

Invitation to contradict me repeated: four of my rulings were wrong in this task and
every one was caught by a reviewer rather than by me.

---

## Task 23 mandates audited before dispatch — six corrections, none prompted by a reviewer

While the Task 22 verification ran, I audited `task-23-mandates.md` for the error class
that produced four retractions in Task 22. It was there, in the most dangerous possible
shape.

**Ruling: audit every remaining mandates file for the "measured as correct — do not spend
a review finding on them" pattern before its task is dispatched, not after its review
finds it.** Why: Task 23's mandates opened with a section titled *"Measured as correct —
do not "fix" these, and do not spend a review finding on them"*, listing eleven claims.
That is structurally identical to Task 22's mandate 7 item 5, which asserted a fact and
instructed the implementer not to re-derive it, and which was wrong and cost an entire
fix round. Writing the instruction is what made the error expensive; the error alone
would have been caught. Cost if wrong: an hour of my own reading per task, spent on
mandates that turn out to be fine.

Corrections made:

1. **The section's prohibition is withdrawn.** Retitled "Checked and believed fine — with
   the strength of each check named", and the sentence telling the implementer not to
   spend a review finding on them is gone.
2. **Every one of the eleven claims is now labelled `COMMAND` (ran it, pasted output),
   `READ` (quote a file by line), or `TRACED` (executed the logic in my head).** The
   split is 3 COMMAND / 6 READ / **2 TRACED**. The two TRACED items — `deriveRating`
   returning `'hard'`, and `countCheckpoints`'s regex counting 2 and 3 on the two
   fixtures — are flagged in the section header as the most likely items on the page to
   be wrong, because hand-tracing is precisely what was wrong in Task 22.
3. **The self-tally was too generous and is corrected.** The file claimed "once it was
   wrong, and twice a verification instruction I wrote was impossible as stated." Task 22
   alone produced four, including one I endorsed rather than authored. Rewritten to say
   so, with the `date -u` mechanism named, because an implementer calibrates how hard to
   push back on me from that number.
4. **Mandate 7 is relabelled `READ` for the code and `TRACED` for the failure.** I quote
   `reportFor` and `completeVerdictB` by line, but I have never executed a truncated
   grader stream, so I do not know whether a mid-stream stop yields a short `checkpoints`
   array or a parse error — and that decides whether the mandate is a bug fix or
   defence-in-depth. The implementer must establish it first, and must not let the commit
   message call it a bug if it is not one. This is the same shape as Task 22's F1: a
   confident mechanism for a path nobody ran.
5. **Mandate 3's cast inventory re-measured (`COMMAND`).** `src/` is still exactly 5 lines
   / 6 casts — that number held. But the verify step's grep spans `test/` too, and `test/`
   holds **29** further casts across six files, all the single `(err as ContentError)`
   idiom on a caught rejection. An implementer running that grep sees 34 lines and could
   reasonably start "fixing" closed tasks. Now stated up front with the parked set named,
   the pass condition restated as "the count does not go up" (5 / 29 / 0), and the
   distinction drawn that mandate 3's `as unknown as` and `as never` fixture casts are a
   *worse* idiom than the parked 29, because they defeat the type they claim to model
   rather than merely skipping a guard. **Also: my own earlier ledger note claiming casts
   at `scripts/extract-corpus.ts:47-53` is stale — measured zero in `scripts/`.** Struck.
6. **The header said "Nine required changes" when there are ten.** Mandate 10 is an
   addendum sitting *below* the "Verify before committing" section, where a reader who
   stops at the verify list never sees it — and it is the one that fixes a dead feature
   (`mismatch` comparing a value to itself, with green tests on both sides). Header now
   says ten and names where 10 lives.

**And one error of my own, caught in the act, which is the reason this audit was worth
running.** Mandate 8 says seven test files use `new URL(...).pathname`. I ran
`grep -rn '\.pathname' test/` to check it, got **nine** files, and started writing the
correction. The grep was wrong: two of the nine —`test/lib/assert.test.ts` and
`test/cli/validate.test.ts` — already use `fileURLToPath` and only *mention* `.pathname`
in a comment explaining why. Seven was right. **My measurement tool over-counted and I
was one edit away from writing a false correction into a mandate, having audited the file
specifically to remove false claims.** This is the fifth over-counting extractor in this
project (three of the implementer's, now two of mine) and every one matched a word where
it should have matched a call. Standing rule added to the mandate in place, not just here:
grep for the call, not the word — and the seven files are now named individually with
their occurrence counts so the next reader does not repeat my grep.

`Ruling: name the parked sets file-by-file in the mandates rather than by count.` A count
invites a grep to confirm it, and a grep that disagrees produces either a false
correction or a wasted round. A list can be checked against without being recounted.
Cost if wrong: longer mandate files.

No mandate's substance changed — all ten required changes stand as written. What changed
is the strength claimed for each supporting fact, and the removal of the instruction not
to look.

---

## Task 24 mandates audited — the same block, and here it was guarding claims about uninstalled software

Task 24's mandates carried a byte-similar section: *"Measured as correct — do not "fix"
these, and do not spend a review finding on them"*, thirteen items, above a preamble
asserting every claim was "a command I ran on this host with the output pasted, or a line
I quote from the Task 23 brief."

**`COMMAND`: `react`, `react-dom`, `@testing-library/react`, `jsdom`, `tailwindcss` and
`@xterm/xterm` are all absent from `node_modules`.** Only `vite@7.3.6` is present. Task
24's Step 1 installs the rest. So the preamble was false for a majority of the block —
five items reason about React's boolean-attribute rendering, Testing Library's
`getNodeText` joining direct text-node children, whether `.click()` needs `act()`, and
whether jsdom defines a spy-able `window.confirm`, **for libraries that are not on this
machine.** Under a heading that said "measured", above a sentence telling the implementer
not to spend a review finding on them.

That is Task 22's F1 in a stronger form. F1 was a wrong claim about a command that at
least existed here. This was a set of claims about behaviour that cannot be observed here
at all, wearing the same "measured" label and the same instruction not to look.

Corrections: preamble rewritten to name the missing packages and withdraw the
do-not-look instruction; heading retitled; a fourth label added (`RECALLED` — documented
library behaviour for a package not installed) alongside `COMMAND` / `READ` / `TRACED`,
plus `DESIGN` for the one item that is a decision rather than a fact. All thirteen items
now labelled. Measured census: **4 `READ` / 7 `RECALLED` / 1 `TRACED` / 1 `DESIGN`** —
nine of thirteen resting on recall or reasoning.

**Second self-caught error in this audit, same class as the first.** I wrote the census
sentence by hand as "4 / 6 / 1 / 1 plus one READ-adjacent ordering note", then ran
`grep -oE '^- .(READ|RECALLED|TRACED|DESIGN).' | sort | uniq -c` and got 7 RECALLED. I
had miscounted the labels *in the sentence whose entire purpose was to stop readers
trusting my counts*, in a file I was editing specifically to remove miscounts. Corrected
to the measured census, with the method named in the text so a reader can re-run it.

Both of this audit's self-caught errors were counts, both were off by exactly the amount
a hand-count drifts, and both were caught by running the trivial command instead of
trusting the tally I had just written. `Ruling: any count that appears in a mandate must
be produced by a command in the same session that writes it, and the command goes in the
text beside the number.` Not "was measured once" — produced by a command whose invocation
the reader can see and re-run. Cost if wrong: mandate files get slightly noisier. The
alternative cost is the one this project keeps paying: five over-counting extractors so
far, three the implementer's and two mine, every one matching a word where it should have
matched a call.

**Task 25 checked: no measurement-warning block and no "measured as correct" section**, so
nothing to retract there. Its two known defects — mandate 4's stale fixture arithmetic and
mandate 8's wrong row — were already corrected in place earlier, with mandate 8's row now
reading that the row was itself the defect.

Net effect of the audit across Tasks 23-25: **no mandate's substance changed.** All ten
of Task 23's and all nine of Task 24's required changes stand exactly as written. What
changed is the strength claimed for each supporting fact, the removal of three
instructions not to look, and two corrected counts.

---

## Task 22: complete

Final verification returned **APPROVED**, all nine items **CLOSED**, nothing left
unclosed. Report: `task-22-verify.md`. Commit chain: `9d2dc22` (Task 22, 42 files) →
`1ac01f2` (fix round 1) → `decf75d` (F15) → `850c567` (round 2, R1-R5 + 3 scope
extensions) → `9300d2b` (round 3, R6). My own `85bf671` sits between `9d2dc22` and
`1ac01f2` and is not the implementer's.

Dispositions, every one on the verifier's own measurement rather than inherited: R1
CLOSED (11 shapes), R1b CLOSED, R2 CLOSED, R3 CLOSED, R4 CLOSED, R4b CLOSED, R4c CLOSED,
R5 CLOSED, R6 CLOSED. Gates independently re-run: tsc 0; vitest 246/23; coverage exit 0,
0 `problem:`, 5/10/68/58/0; `bash -n` 41 scripts 0 errors; out-of-scope empty; headers 21
files / 26 lines **md5-identical across all three of `9d2dc22`, `decf75d` and
`9300d2b`**; five declared/emitted pairs and zero UNPROBED-GOAL reproduced with its own
comma-aware extractor. R6's 8-row table reproduced exactly plus 7 shapes of its own;
R1's 8 rows likewise.

Three things it settled that I had wrong or could not settle myself:

1. **The kept empty-`$dev` guard's awk claim is TRUE.** `i=""` matches nothing and the
   zone check therefore *passes*. The implementer's justification for keeping
   unreachable code was correct, and the guard must stay. This is the first time in three
   tasks that a rationale offered to me for a failure mode survived an independent
   measurement unchanged.
2. **My R4 "three-line consistency edit" ruling was wrong and the fail-open is real** —
   confirmed by a second party, as I asked. `state` captures stderr; a two-line capture
   beginning with `enabled` makes `!=` stop matching, setup proceeds believing httpd is
   disabled, and `httpd-enabled` passes at baseline.
3. **The R2 sentinel near-miss reproduced**: `field8=unavailable` → PASS in the version
   the implementer nearly shipped, fail in the shipped one. A false pass reachable from
   data, caught by the implementer's own measurement.

### The count I propagated was wrong, and I measured it myself rather than pick a side

The verifier says the goal-id total is **23, not 22**, and that the whitespace-split bug
would have broken **18**, not all of them, because the last id in each header carries no
comma. My `task-22-verify-context.md` had told it "22 goal ids", inherited from the
implementer's report. `COMMAND`, run here:

```
7  selinux/019   2  storage/014   3  systemd/017   4  troubleshooting/028   7  users/006
TOTAL = 23        whitespace-split would break 18, leaving 5 intact (one per header)
```

7+2+3+4+7 = 23. **Both numbers in the implementer's sentence were wrong — the total and
the blast radius — and I copied one of them into the instructions for the agent checking
it.** That is the failure mode I have been writing rules about all day, committed in the
document whose purpose was to prevent it: I passed a number I had not run a command on
into a context file, three hours after ruling that reviewers must not inherit numbers.
The verifier caught it only because I also told it to build its own extractor. Substance
unaffected — no header changed, no checkpoint moved — but the lesson is that the rule has
to bind the context files I write, not just the mandates.

`Ruling: from Task 23 on, any count that appears in a review or verification context file
must be produced by a command I run while writing that file, pasted beside the number.`
Not carried from a report, not carried from a prior context file. Cost if wrong: a few
extra commands per dispatch. Cost of the alternative, measured twice today: a wrong
number reaches the one agent whose job is to check numbers.

### Two new findings, both parked

**N1 — `lo` is still reachable through the route path.** Measured: a route table
containing `default dev lo` makes both `028/setup.sh` and `019/setup.sh` select `lo`,
which is the precise hazard R1 and R6 were written to close, arriving by the other door.
`Ruling: park it for the whole-branch review rather than open a round 4.` Why: reaching it
requires a default route via loopback, which no path in this project produces — not
`guest-provision.sh`, not `docs/vm-build-checklist.md`, not any anaconda default — so it
is a deliberate-misconfiguration state, unlike the `lo`-sorts-first case which NM produces
on its own. The close is one line in each of two files (`[ "$dev" = lo ] && fail …`), it
belongs beside the empty-`$dev` guard that is already there, and the whole-branch review
already owns two other sweeps over these same files (F10's nine `pipefail` sites, the
`is-enabled` spelling now unified). Doing three small uniform passes as one is how the
project has been handling this class. Cost if wrong: a guest with a loopback default route
gets a silent whole-task false pass — the same severity as R6, at a much lower
probability, for the length of the remaining three tasks.

**N2 — the 23/22/18 count**, recorded above. No action beyond the ruling.

### On the three disclosed tooling errors — the verifier's judgement, which I accept

Asked for a non-diplomatic answer, it gave one: **they should not reduce trust, and the
asymmetry is the reason.** All three failed loudly; none produced a quiet green, which is
the exact complement of this project's named defect class. It inherited none of the
implementer's numbers — every table, extractor and gate rebuilt, with the code under test
extracted via `git show` rather than retyped — and everything came back identical except
the 22/23.

Its caveat is method, not trust, and I am adopting it: **all five over-counting extractors
in this project were written inline and thrown away.** `Ruling: the declared-vs-emitted
and header-drift checks become one committed script, owned by Task 25.` Task 25 already
touches the content-authoring rules and the README, so the script and its documentation
land together; every later task and the whole-branch review then run the same code instead
of five re-derivations of it. Cost if wrong: one script of maybe forty lines that the
final review has to read.

And the sentence worth keeping from its report: *the disclosed errors were in the checking
and failed loudly; the four wrong rationales this task produced were in the reasoning and
each had to be caught by someone else measuring.* Task 22 produced four of mine and zero
of the implementer's. The correct conclusion is not that the implementer needs watching.

**Task 22: complete.**

---

## Task 23 dispatched

BASE = `9300d2b4d32742dfa91916acdc7fe35205b17c9b`, branch `phase-0-1`, tree clean.
Implementer `task-23-impl` on **opus**. Brief 1756 lines + mandates 639 lines, handed as
paths; nothing pasted.

`Ruling: Task 23's implementer runs on opus rather than the mid tier.` Four files of new
server code plus a WebSocket bridge plus four new test files, with two of the ten mandates
being live security-and-correctness holes (an unauthenticated sudo-capable shell exposed
to the LAN and to any web page; a truncated grader reporting a pass). Integration across
`ladder.ts`, `ssh.ts`, the grading seam and the session store, under a no-`as`-casts
constraint that requires writing type predicates rather than reaching for a cast. Cost if
wrong: a cheaper model takes more turns and produces the casts, which is the more
expensive outcome.

Baseline measured in this session before dispatch, per the standing rule — not carried
from any report: `npx vitest run` → **246 passing / 23 files**; `git status --porcelain`
empty. Both pasted into the dispatch so the implementer can distinguish a regression from
a stale number.

Carried into the dispatch: the global constraints; the two parked sets named as parked
(five `as` cast sites in `src/`, seven `.pathname` test files); `content/lib/assert.sh`
closed; the engine directories that are off limits; Step 20 deferred with its two
content-dependent numbers flagged as predictions rather than assertions; the full standing
prohibitions verbatim; the zsh/eza/dash environment facts; stage-by-name and the inline
git identity. Also carried: that mandate 10 sits below the "Verify before committing"
section where a reader who stops at the verify list will miss it, and that it is the one
fixing a feature that can never fire.

Explicitly invited to contradict me, with the reason stated plainly: four of my claims
were wrong in Task 22 and an implementer or reviewer caught every one. The mandates file
now labels each supporting fact `COMMAND` / `READ` / `TRACED` so the implementer can see
which of my claims rest on a command and which rest on my reading.

Parked for the whole-branch review, unchanged by this task: N1 (`default dev lo` selects
`lo` through the route path in `019` and `028`), F10's nine `pipefail` + `grep -q` sites,
F11 (`vmrun.ts` grading verdict B before `multi-user.target`), the committed
declared-vs-emitted + header-drift script now owned by Task 25, and the rest of the
standing list.

---

## Task 23 implemented — `ab32303`, DONE_WITH_CONCERNS

14 files, 2101 insertions / 29 deletions. New: `src/engine/disclosure/content.ts`,
`src/server/{session,lab,app,terminal,index}.ts`, four test files. Modified:
`src/engine/vm/ssh.ts` (mandate 1), `src/engine/disclosure/ladder.ts` (mandate 4),
`package.json` / `package-lock.json`.

**Gates re-run by me, not inherited** (the standing rule now binds my own ledger entries):
`npm run typecheck` exit 0; `npx vitest run` → **301 passing / 27 files**, +55 on the
246/23 baseline I measured before dispatch; `node src/cli/index.ts coverage` exit 0 with
**0** `problem:` lines; `git status --porcelain` empty.

Independently verified without reading the implementer's numbers first:

- **Cast inventory unchanged: `src/` 5, `test/` 29, `scripts/` 0.** The two
  `as unknown as|as never` grep hits are the words "was never" inside prose comments at
  `grader.ts:91` and `assert.test.ts:118` — the implementer said exactly this and it is
  right. So mandate 3 held: seven new cast sites in the brief, zero shipped.
- **No non-null assertions** anywhere in `src/server/` or `content.ts`; no `enum`,
  `namespace` or decorator syntax.
- **`TOP_RUNG` / `RUNGS` are genuinely consumed**, six sites across `app.ts` and
  `session.ts`, including `maxRungFor`'s guided branch and `/hint`'s `RUNGS.map`. Mandate
  4 was not cosmetic compliance.
- **`package.json` gained only** `hono`, `@hono/node-server`, `ws` (dependencies),
  `@types/ws` (devDependencies — correctly placed), and the `dev:server` script. The
  `engines` block was reformatted onto three lines and is otherwise identical; no existing
  script, no `type`, no vitest config touched.

### My Step 21 stage list was wrong — fifth wrong claim of mine in three tasks

It staged `src/engine/vm/config.ts`, which this task **does not modify** (mandate 9 copies
that file's validation *shape* into `readPort`; it does not edit it), and it omitted
`src/engine/disclosure/ladder.ts`, which mandate 4 **does** modify. `app.ts` imports
`TOP_RUNG` and `RUNGS` from `ladder.ts`, so staging my list verbatim would have committed
a tree that does not typecheck. Confirmed from the diffstat: `ladder.ts` +10, no
`config.ts` entry.

`Ruling: accepted outright, no change requested.` The implementer dropped `config.ts`,
added `ladder.ts`, changed nothing else, and kept my commit message. That is the correct
resolution and it needed no ruling from me.

The pattern is now unmistakable and worth stating without softening: **my errors cluster
in the mechanical details I wrote fastest** — a stage list, two test-count numbers, a
fixture arithmetic table, a label census, an inherited goal-id count. Not in the design
calls, which have held. `Ruling: every file list, stage list and count I write gets a
command run against it before it ships, in the same session.` Cost if wrong: minutes per
dispatch. Cost so far of not doing it: five defects, four of them caught by someone else.

### Concerns still outstanding

The report's "Where I disagree, or had to depart" section **truncated in transit** at
`new Map([[TASK.id,`. I have concern 1 (the stage list) complete and concern 2 partial.
Requested the remainder verbatim rather than proceeding — `Ruling: do not dispatch the
task reviewer until the concerns are complete.` A concern that names a second defect in
the brief changes what the reviewer must check, and the skill's own handling of
DONE_WITH_CONCERNS is to read the concerns *before* review. Cost if wrong: one round-trip.

What I know of concern 2 so far: **two bugs in the brief's `test/server/app.test.ts` that
my mandates did not catch.** Hono's `res.json()` resolves to `unknown`, not `any`, so the
brief's `body.tasks[0].id` produced 40 `TS2571`/`TS18046` errors, and the brief's `start()`
helper contained an `as string` that mandate 3 forbids. Fixed with four cast-free readers
over the project's own `isRecord` idiom. I have asked specifically what each reader returns
on a **wrong path** versus a **missing leaf**, because a helper that quietly returns
`undefined` on a wrong path converts every masking assertion in the suite into a
tautology — the project's defect class relocated into a test helper, where it would be
invisible and permanent. The implementer's own summary says a wrong path throws and names
the key; that is the right shape, and it needs to be the reviewer's first check.

Also requested confirmation of the `package.json` question independently of its answer —
already measured above and clean.

### Known coverage gap, disclosed unprompted

`src/server/index.ts` is executed by no test: running it needs `.env.local` (off limits)
and `chooseTransport`, which probes a real VM (prohibited). Uncovered: `readPort`'s
`RHCSA_PORT` validation (reasoned against `loadVmConfig`, not executed), `HOST =
'127.0.0.1'` reaching `serve`, the `instanceof Server` narrowing, and the
`ALLOWED_ORIGINS` set contents. The *consequences* of the first two are measured elsewhere
— `@hono/node-server/dist/index.mjs:1305` is `server.listen(options?.port ?? 3e3,
options.hostname, …)`, so **the default is not loopback** and mandate 2(a) was load-bearing
rather than defensive — but the wiring in `index.ts` is read, not run. This is the honest
version of a gap and it goes to the reviewer as a named question, not as a finding.

---

## Task 23 — review dispatched

`task-23-review-context.md` written (measured in-session, per the standing rule), reviewer
dispatched on **opus** against `review-9300d2b..ab32303.diff` (1 commit, 82835 bytes).
Both verdicts demanded: per-mandate spec compliance for mandates 1-10, plus task quality.

**The `at` walker is verified by me, not deferred to the reviewer.** I read
`test/server/app.test.ts:111-150` rather than spending another round-trip on the
truncated report. The three outcomes are as the implementer described: array+numeric key
descends; record+string key descends but returns `undefined` when `Object.hasOwn` is
false; anything else throws with the key and the container in the message. The
`undefined` arm is reachable **only** through the record branch, so a wrong-shaped path
throws instead of quietly passing.

Measured in the same session (the rule that now binds context files as well as mandates):

```
grep -cE '\b(at|items|str|num)\(' test/server/app.test.ts   → 45
occurrences: at( 34  items( 5  str( 7  num( 3
grep -nE 'expect\(at\(' test/server/app.test.ts | wc -l     → 27
grep -n 'toBeUndefined' test/server/app.test.ts             → 2  (lines 215, 375)
casts (as unknown|as <Type>, as const excluded): src 5 / test 29 / scripts 0
non-null assertions in src/server/ + content.ts              → 0
git diff --shortstat 9300d2b..ab32303 → 14 files, 2101 insertions, 29 deletions
```

**Ruling: the tautology risk is bounded to two assertions, and both are intentional.**
The other 25 bare-`at` assertions compare against a concrete value that `undefined`
fails, and `items`/`str`/`num` throw on the wrong runtime type. Why: `toBe('storage/...')`
cannot pass on `undefined`, and `toContain` on `undefined` throws. Cost if wrong: the two
masking assertions (prompt omitted from `/api/tasks`, checkpoints masked in exam mode)
would be tautologies and exam masking would be unprobed — which is why the reviewer is
told to mutate the property name AND delete the masking logic, since only the second half
proves teeth. I did not accept the implementer's word for this; I read the file.

**Ruling: the review leads with the terminal bridge as its second check, ahead of the
brief's own ordering.** Why: `terminal.ts` hands a browser a guest PTY where `student`
has passwordless `sudo`, with no authentication, and its only three controls are bind
address, Origin allow-list, and both of those living in `src/server/index.ts` — a file
**no test executes**. Mandate 2(a) turned out to be load-bearing rather than defensive:
`@hono/node-server/dist/index.mjs:1305` is
`server.listen(options?.port ?? 3e3, options.hostname, …)`, so the default is not
loopback and omitting `HOST` would have exposed the shell on every interface. Cost if
wrong: nothing — a redundant check on the diff's highest-risk file is the cheapest
possible error.

Four judgement calls delegated to the reviewer rather than pre-decided by me: the `at`
helper's acceptability as a project convention; whether a **missing** `Origin` should be
allowed on an unauthenticated endpoint (it is, deliberately, so `wscat` works); whether
an untested 83-line entry point holding two of three security controls is acceptable or
needs a testable seam; and whether mandate 5's two disclosed redactor residuals
(`for u in alice bob` → `u`, a `case` label → `a`) are adequately mitigated by an
authoring convention.

**Ruling: item 3 asks the reviewer for the *opposite* direction from the one I already
confirmed.** I verified mandate 7's guard catches a truncated grader run (2-of-5 → the
old code said `true`). The unexamined direction is whether `allPassed && !incomplete` can
report a **fail on a correct solution** — every way `countCheckpoints` and the emitted
count can legitimately disagree (`ck_skip`, a `ck` in an untaken branch, a duplicated id,
a `ck` inside a heredoc). Why: for this app's purpose a false `incomplete` on a right
answer is worse than the false pass it replaced. Cost if wrong: a student is told they
failed a lab they solved, which is the failure that makes a trainer untrustworthy.

Parked sets named file-by-file in the context, never by count, per the standing rule: the
seven `.pathname` test files by name, with the warning that a naive grep returns **nine**
because `test/lib/assert.test.ts` and `test/cli/validate.test.ts` only mention it in a
comment; and the five `src/` cast sites by line. `scripts/` has zero.

---

## Task 25 mandate audit — the last remaining one. Four drifted pointers found.

Done while the Task 23 reviewer runs, discharging the standing rule that every remaining
mandates file is audited for the F1 pattern before its task is dispatched. Task 24 was
audited earlier; **Task 25 was the last, so the rule is now discharged for the plan.**

**Task 25's mandate 8 carried the F1 pattern with an aggravating clause I had not written
anywhere else: "Measured correct. Do not change these, and do not let a reviewer reopen
them."** Both halves were wrong and both are withdrawn.

*Wrong on authority.* The implementer has none over the reviewer. The one time this
project told a reviewer a row was already correct, the reviewer skipped it and the row
was a bug — that is F1. A row nobody may reopen is a row nobody checks.

*Wrong on fact.* "Every row was checked against the tree" was **false when written**:
five rows cited line numbers in `task-23-brief.md`, a brief. Task 23's code did not exist
yet, so those rows were read against a *description* of code. Task 23 has now shipped as
`ab32303`, so I re-ran all eleven rows against the real tree.

**All eleven rows are substantively correct. Four citations had drifted:**

| row | was | is |
|---|---|---|
| `# baseline-fail:` in `014/grade.sh` | `:14` | **`:10`** |
| `SessionPhase` | `task-23-brief.md:542` | **`src/server/session.ts:12`** |
| `deriveRating`'s `rungUsed === 3` | `ladder.ts:66` | **`ladder.ts:76`** |
| `createLabRuntime`'s `reboot` | `task-23-brief.md:746` | **`src/server/lab.ts:31`** |
| env-table sole reader | `task-23-brief.md:1658-1660` | **`src/server/index.ts:28,29,30` (+`:23` in `readPort`)** |

Plus one in mandate 9: `# unprobed-invariant: var-intact` is `grade.sh:82`, **not `:86`** —
Task 22's fixes moved it, and mandate 9 tells the implementer to cite that line in the
README, where a wrong pointer is worse than none.

Commands run in the session that wrote the corrections:

```
014 grade.sh distinct ck ids → 5  (fs-home-size home-from-lv lv-home-size persist-config var-intact)
014 grade.sh baseline-fail   → line 10, 2 goals → 3 pass untouched ✓
014 task.yaml                → 27 lines, 0 'nudge' ✓
tasks under content/tasks/*/*/ → 5 ;  cards via find content/concepts -name '*.md' → 10 ✓
grep -ic 'physical volume' content/concepts/storage/lvm-abstraction-stack.md → 3 ✓
fixtures: selinux/019 8, storage/014 6, systemd/017 6, users/006 6, troubleshooting/028 6 (vmrun)
         → ssh 26 + vmrun 6 = 32 ✓ unchanged at ab32303
ssh.ts:131 `if (!cfg.ip)`, :176 `if (!this.#cfg.ip) return false` ✓
config.ts:40 `forced !== undefined && !Object.hasOwn(KINDS, forced)` → '' throws at :42 ✓
```

**Ruling: `MEASURED` and `READ` replace the blanket claim, per row, and every row now
invites contradiction — "if you read it differently, follow your own measurement."**
Why: the blanket claim was the defect, not the rows. Cost if wrong: a reviewer spends a
round re-deriving eleven rows that were right, which is the cheap failure; the expensive
one is F1 again.

**Ruling: two `content/concepts` glob traps are named in the file.** `content/concepts/*.md`
matches **nothing** — the cards live in per-area subdirectories (`storage/`, `users/`, …) —
and under zsh a failed glob is an error, not an empty expansion. My own first count
returned 0 cards for exactly this reason before I switched to `find`. Cost if wrong: an
implementer concludes the card bank is empty and "fixes" content that is fine.

**Mandate 7's "Do not edit `config.ts`" is a legitimate scope boundary and stays** — it
forwards the item with the fix named and says which review owns it. Only its closing
"Not affected, verified: … Do not 'fix' either" was the pattern in miniature; both claims
are now `READ` with lines, and the prohibition is narrowed from "do not question this" to
"this is not a reason to edit a closed task's file."

Task 25's label census, by the method named in its own text
(`grep -oE ... | sort | uniq -c`): **8 `MEASURED` / 5 `READ` / 1 `RECALLED`**, the lone
`RECALLED` being my sentence stating there are none. Task 24's item list re-verified
unchanged at **4 `READ` / 7 `RECALLED` / 1 `TRACED` / 1 `DESIGN` = 13**, matching the
census I ledgered earlier. `git status --porcelain` empty throughout — mandates files are
git-ignored workspace artifacts.

**Two stale numbers remain in `task-25-brief.md` and are the implementer's to fix, not
mine:** mandate 4 names the four sites (lines 253, 258, 272, 508) carrying 24/30 and
orders a recount, with "your count wins over mine" stated explicitly. I did not edit the
brief — a brief is the extracted plan text and rewriting it would hide the plan's defect
rather than record it.

---

## N3 — `countCheckpoints` cannot see the idiom `assert.sh` documents. Sent to the live reviewer.

Found while sizing the committed-checker ruling for Task 25, not by looking for it. Task 23
shipped `CK_CALL` at `src/server/session.ts:34`:

```
/^[ \t]*ck(?:_pass|_fail|_skip)?[ \t]+["']?([a-z0-9][a-z0-9-]*)/gm
```

**Correction to my own review context, and it is a direction error, not a detail.** Item 3
of `task-23-review-context.md` told the reviewer to hunt a false *fail* — whether
`allPassed && !incomplete` can fail a correct solution. Wrong way round.
`incomplete = v.checkpoints.length < expectedTotal` (`session.ts:100`), so an **under**-count
in `countCheckpoints` makes `incomplete` **false** and disables mandate 7's guard. An
under-count is a false **pass** — mandate 7's own bug, reintroduced through the extractor
instead of the comparison. A false fail would need an over-count, which is harder to reach.

**Measured, 14 shapes through the real regex.** The reassuring half: comments at column 0,
indented comments, a trailing comment after a real call, prose reading `ck_pass <word>`, a
`# baseline-fail:` header, `echo "ck_pass fake-id"`, and `checkfoo bar` are **all correctly
ignored**. So F7's comment-matching problem — the throwaway grep from Task 21 that forced
two `grade.sh` comments to be reworded — is genuinely fixed by this regex. Also measured:
`content/lib/assert.sh` yields **zero** ids under it (`ck_pass() {` has no space before the
paren), so prepending assertLib changes nothing — `storage/014` is 5 and `selinux/019` is 8
either way. Task 25 mandate 8's "countCheckpoints over assertLib + grade.sh" is harmless.

**The hole:** a real `ck` call that does not begin its line is missed. `true; ck after-semi
"d" $?` → `[]`. `grep -q x f | ck piped "d" $?` → `[]`.

**And `content/lib/assert.sh:60` documents precisely that shape as the usage:**

```
# ck ID DESC EXIT_STATUS [DETAIL]
# Usage:  some_condition; ck my-id "what was checked" $? "what to look at"
```

The library teaches the one form the counter cannot see. A grader written to its own
documented usage under-counts `expectedTotal`, `incomplete` can no longer fire for the
missed checkpoint, and a truncated run reports `allPassed: true`.

**Reachability, measured: latent, not live.**
`grep -rnE '[;&|][[:space:]]*ck(_pass|_fail|_skip)?[[:space:]]+'` over all five `grade.sh`
plus `assert.sh` returns exactly one hit — `assert.sh:60`, the comment itself. Every `ck`
call in shipped content begins its line. Current distinct-id counts: 019=8, 014=5, 017=5,
028=5, 006=8.

**Ruling: this goes to the live Task 23 reviewer, not to the parked set.** Why: the diff
under review contains the defect, the reviewer is mid-flight and its context is already
loaded, and a latent false-pass in the guard against false passes is worth one round now
rather than a whole-branch round later. Cost if wrong: one reviewer round spent on a
latent issue. I also told it the fix has a cost in the other direction — widening the
regex to catch `;`/`|`/`&&` risks over-counting, which is the false-*fail* direction — and
asked it to price that rather than just widen.

**Ruling: I asked the reviewer to decide whether this is a Task 23 finding or a closed-task
finding, instead of deciding it myself.** My instinct is that the defect is in Task 23's
regex and the *evidence* is in a closed file, making it Task 23's — but my severity call
was wrong on R4 in Task 22 and a second party caught it, so the call goes to the second
party. Cost if wrong: the item lands in the whole-branch review instead, which is where it
would have gone anyway.

Also asked, and worth an answer on the record: is a regex over shell text the right
authority for `expectedTotal` at all? Task 23's report argues yes because the grade script
is static and a sick guest cannot truncate it, which I find convincing — but a static
source that is *mis-read* is not better than a dynamic one, and N3 is exactly a mis-read.

---

## Task 25 — the committed-checker ruling was missing from its mandates. Sizing it found N3.

The Task 22 verifier's one methodological caveat was that all five over-counting extractors
in this project were written inline and thrown away; my ruling was that the
declared-vs-emitted and header-drift checks become **one committed script owned by Task 25**.
Auditing the mandates showed that ruling is **not in `task-25-mandates.md`** — mandate 10's
F7 discusses the grep's inflation but orders no script. It needs a mandate 11, still to be
written. Recording the design findings now so the mandate is measured rather than recalled:

- **The runtime check already exists and is not the gap.** `checkEmittedIds`
  (`src/engine/validate/harness.ts:105-117`) compares declared against emitted, called at
  `:242` and `:252` — but only inside `npm run validate`, **which needs a VM**. The gap is a
  *static*, VM-free check over script text. That is what the five throwaway extractors were
  each reinventing.
- **Two pieces to reuse rather than rewrite.** `parseExpectations`
  (`src/engine/validate/expectations.ts:32`) already takes script text plus a header name
  and already reports a duplicated header as a problem. `CK_CALL` /
  `countCheckpoints` (`src/server/session.ts:34-38`) is already the comment-immune
  extractor F7 asked for — subject to N3.
- **It must be unit-tested, not just committed.** The whole reason for the ruling is that
  five untested extractors were wrong. An untested committed script would be the sixth.
  That argues for a CLI subcommand alongside `validate` and `coverage`
  (`src/cli/index.ts:223,225`) rather than a bash script in `scripts/`, because vitest can
  drive a subcommand with fixtures and cannot easily drive the bash.

### Mandate 11 written (`task-25-mandates.md`, now 748 lines)

The missing ruling is now a mandate. Shape decided and recorded:

**Ruling: a `rhcsa lint` subcommand with vitest tests, not a script in `scripts/`.**
Why: the entire reason for the ruling is that five *untested* extractors were wrong, so an
untested committed script would be the sixth. `src/cli/index.ts` already has the seam —
`run(argv, io)` dispatching on `argv[0]` (`:219-231`), `CliIo` as `{ out, err }` (`:12-15`),
the module inert on import via the `pathToFileURL` guard (`:236-237`), and
`test/cli/coverage.test.ts` already driving a subcommand with a fake `io`. Cost if wrong: a
subcommand is heavier than a shell script for a check this small.

**Ruling: emitted-but-undeclared is informational, not a failure.** Why: a grader
legitimately emits invariant checkpoints that pass at baseline and are therefore absent
from `# baseline-fail:` by design — the `kind: 'none'` fixture asserts everything unlisted
passes — and `# unprobed-invariant:` declares the knowingly-unprobed ones. Cost if wrong,
and this is the reason it is spelled out in the mandate: **inverting it fails every task in
the bank**, which is the kind of error that gets "fixed" by editing content.

**Ruling: the drift half becomes a golden fixture, because a committed script has only one
commit.** A deterministic header inventory locked against `test/fixtures/content-headers.golden.json`,
copying `test/content/objectives-golden.test.ts` — which already has the three properties
worth copying: a committed fixture, a `TO REGENERATE` command block, and the stated rule
"always regenerate, never hand-edit," because hand-transcribing reintroduces the copying
risk the fixture exists to close. Cost if wrong: a fixture diff on every deliberate header
edit, which is the point rather than the price.

**Ruling: `lint` must report the non-line-start `ck` form as a problem rather than widening
`CK_CALL` itself.** Why: flagging an uncountable call is strictly better than silently
miscounting it, needs no change to a closed file, and avoids the opposite error — widening
to accept `;`/`|`/`&&` risks over-counting, which produces a false `incomplete` and fails a
correct solution. That trade belongs to the Task 23 reviewer, which has N3 in front of it
now; the mandate tells the implementer to check `session.ts:34`'s state first and report
which state it found, because the fix may land before Task 25 starts.

Gates written into the mandate: `lint` runs with **no VM and no `.env.local`**, exits 0 on
the current bank, and exits non-zero against three planted defects in a `/tmp` copy — an
id in `# baseline-fail:` the grader never emits, a duplicated header line, and a
non-line-start `ck` call. Stated reason: *a checker nobody has seen fail is a checker
nobody has tested.* Step 1's `scripts` block gains `"lint:content"`, edited in Step 1
itself rather than in a second place, with no `--env-file-if-exists` for the reason Step 1
already gives for `coverage`.

Task 25 now has **11** mandates. This is the only one that adds a code deliverable to a
docs task, and the mandate says so in its first line so the implementer can see the scope
change rather than discover it.

---

## Parked set consolidated into `whole-branch-parked.md` — three of my own notes were wrong

Written while the Task 23 reviewer runs, so the final review dispatch does not have to
reconstruct the parked set from a 348k ledger. **Every pointer re-run against `ab32303`**,
each item labelled `MEASURED` (command run here) or `CARRIED` (inherited, verify first).

**Ruling: sets are named file-by-file, never by count, and the file says so.** Why: a count
invites a grep that produces either a false correction or a wasted round, which has already
happened twice here. Cost if wrong: the file is longer.

**Three of my own parked notes were wrong, all found by re-verifying rather than by anyone
telling me:**

1. **P7 was pointed at the wrong risk, in the safe direction.** I had it as "three LVM
   sites consuming `to_bytes`". `to_bytes` (`content/lib/assert.sh:77-95`) ends with
   `awk … 'BEGIN { printf "%d\n", n * m }'` — **`%d` forces an integer, so every
   `to_bytes` consumer is safe**, and `014/grade.sh` is additionally fail-closed at
   `:12-21`. The real exposure is the two reads that *bypass* `to_bytes` and feed a raw
   `lvs`/`vgs` string into `(( ))`: `014/setup.sh:32→34` and `:38→40`. Both `-n`-guarded,
   so the empty case is closed, and whether LVM can emit a non-integer under
   `--units b --nosuffix` is `reasoned` — there is no LVM on this host. Severity drops from
   "assumption to fix" to "route through `to_bytes` for uniformity."
2. **P6's file count was wrong; the cast count was right.** 29 `(err as ContentError)`
   casts across **five** files, not six: `objectives.test.ts` 8, `expectations.test.ts` 7,
   `bank.test.ts` 7, `concept.test.ts` 4, `task.test.ts` 3 = 29.
3. **P5 named a file that does not exist.** `checkCoverage` lives in
   `src/engine/content/bank.ts` with CLI wiring in `src/cli/index.ts`; there is no
   `coverage.ts`. An implementer sent to a nonexistent file reports "cannot find" or, worse,
   creates it.

Also corrected: **P1 is five *lines* but seven cast *tokens*** — `task.ts:96` and `:101`
each carry two (`raw.scope as string` **and** `raw.scope as TaskScope`). I had been writing
"five cast sites", which reads as five casts. `scripts/` confirmed **zero**; the old
`extract-corpus.ts:47-53` note is struck.

**P4 promoted to the highest-severity parked item, and its mechanism is now measured rather
than asserted.** `src/engine/vm/vmrun.ts:253-261` — `guestUp()` returns true as soon as
`echo up` runs, which happens long before `multi-user.target`. `waitForGuest()` (`:263-272`)
polls only that, `reboot()` (`:286-293`) sleeps one poll interval then waits on it, and
`src/engine/grading/grader.ts:97` grades **verdict B** immediately after. So a service that
is `enabled` but not yet `started` grades as failed against a passing verdict A, and
pass→fail is reported as a **persistence failure**. A false regression is the worst signal
this app can emit, because verdict B's whole meaning is "survives reboot" — it teaches the
student a correct answer was wrong. Fix: poll `systemctl is-system-running` accepting
`running` **or `degraded`**; `degraded` must be accepted or one unrelated failed unit hangs
the poll to timeout.

**P9 confirmed by reading the actual brace positions**, not the report: `mkdtemp` and
`writeFile` are at `vmrun.ts:136-139`, **outside** the `try` opening at `:141`, whose
`finally` at `:170-178` owns the `rm`. A `writeFile` rejection leaks the dir. Fix is moving
`writeFile` inside the `try`, leaving `mkdtemp` out.

**P12 re-scoped rather than left to be reported twice:** Task 25's new mandate 11 covers the
static half of `# unprobed-invariant:` enforcement, so the parked item is now only what
remains after `rhcsa lint` lands.

The file also carries a "Not findings" section — `shellcheck` absent (six tasks have
confirmed it), the VM-gated commands, and the `content/concepts/*.md` glob trap — so the
final reviewer does not spend rounds on them.

## Task 25 mandate 12 — guest password in shell history

`task-25-brief.md:267` instructs the user to run
`export RHCSA_GUEST_PASSWORD='<the student account password>'`. Substituting the real
password puts it in `~/.zsh_history` in plaintext, durably, with nothing later in the brief
telling them to remove it.

`docs/vm-build-checklist.md:245` already carries the safe spelling:
`read -rsp 'student password: ' RHCSA_GUEST_PASSWORD && export RHCSA_GUEST_PASSWORD`.
So this is not a design question — Step 4 is simply not using the form this project already
documents. No existing mandate in Task 24 or 25 covered it (measured: the brief mentions the
variable only at `:267` and in the env table at `:408`).

**Ruling: mandate 12 orders Step 4 rewritten to the `read -rsp` form, and orders the `-gp`
argv exposure documented rather than fixed** — because history is durable and survives the
run by months while argv is transient and visible only during the command, `vmrun` offers no
file-based guest-auth alternative, `scripts/provision.sh:64` already carries a comment
acknowledging the argv exposure, and `src/engine/vm/vmrun.ts:108` belongs to a closed task.
Cost if wrong: if the argv exposure actually matters on this host, we have shipped a
documented limit instead of a fix, and the note in `docs/exit-criterion.md` is where a later
pass finds it. If the `read -rsp` rewrite is wrong, one paragraph of a brief reads awkwardly.

Mandate 12 also generalises the rule: any instruction to type a secret as a command argument
is the same defect, including anything added to the README in Step 7 or to
`docs/exit-criterion.md` in Step 6. It explicitly forbids touching `config.ts:53`'s read of
the variable and forbids editing `vmrun.ts`.

Task 25 now carries **12** mandates (802 lines).

### Mandate 12's citations, verified before the reviewer returns — all six hold

Every pointer in mandate 12 was re-run against the tree. `MEASURED`, all six:

| claim | verified |
|---|---|
| `docs/vm-build-checklist.md:245` = the `read -rsp` form | yes, verbatim |
| `task-25-brief.md:267` = `export RHCSA_GUEST_PASSWORD='<…>'` | yes, inside Step 4's second validate run |
| `src/engine/vm/config.ts:53` = `guestPassword: env.RHCSA_GUEST_PASSWORD` | yes — and note it carries **no `??`**, so P2's empty-string defect does not touch this key |
| `src/engine/vm/vmrun.ts:108` = `['-gu', cfg.sshUser, '-gp', cfg.guestPassword ?? '']` | yes, inside `guestAuth()` |
| `scripts/provision.sh:64` = the argv-exposure comment | yes, and it is the comment's first line |
| `docs/exit-criterion.md`'s "Known limits at this point" | file is **absent on disk** — Task 25 Step 6 creates it (`task-25-brief.md:11,301`), and the brief already specifies the section at `:344` with **eight** bullets, none about the password |

The sixth was the one worth checking: I had asserted the section name from memory. It is
right, and finding that the brief already spells out eight bullets let me narrow mandate 12
from "record it there" to "add a ninth bullet, do not rewrite the eight" — so the implementer
cannot read it as licence to rewrite a section the brief already fixes.

**Scope of the defect class, measured across both remaining briefs and both mandate files:**
the only instance of `export <SECRET>=` is `task-25-brief.md:267` (and mandate 12's own
quotation of it). **Task 24's brief contains no secret handling at all** — zero matches for
password/secret/token — so no Task 24 mandate 10 is needed and its nine stand. Task 24's two
password mentions are in its *mandates*: `:208` describing passwordless sudo as the terminal
bridge's risk, and `:447` prohibiting reads of `.env.local`. Both correct, neither a defect.

Mandate 12 is therefore the complete close on this class for the plan, not a first instance.

## Task 23 review returned — CHANGES REQUIRED. Fix round 1 dispatched.

`task-23-review.md`, 684 lines / ~35 KB, opus, ~30 min. Verdicts: spec compliance
**PARTIALLY MET** (8 of 10 mandates MET, 2 PARTIALLY MET — 5 and 7 — 0 NOT MET); task
quality **NOT ACCEPTABLE AS SHIPPED**; overall **CHANGES REQUIRED**. 15 findings: 3 HIGH,
6 MEDIUM, 4 LOW, 2 INFO. Every one labelled measured or reasoned, every mutation done in
`/tmp/t23/repo` with `node_modules` symlinked back; `git status --porcelain` empty before and
after, HEAD still `ab32303`. All gates reproduced independently rather than inherited.

**The three HIGH findings are all in the two surfaces the review context named highest-risk**
— which is the strongest evidence yet that naming the risk surface in the dispatch is what
makes these reviews work:

- **F1** — `terminal.ts:142-152` registers no `ws.on('error')`. Seven bytes with RSV1 set
  after a valid handshake → `UNCAUGHT: Invalid WebSocket frame` → the process exits, taking
  the whole in-memory `SessionStore` with it. The irony is exact: `terminal.ts:49` comments
  that "a malformed frame is not worth ending a lab session over" and handles malformed JSON
  *inside* a frame, while a malformed frame one layer down kills the server.
- **F2** — `spawnPty` at `terminal.ts:143` is uncaught, and `sshArgs` throws whenever
  `cfg.ip` is empty. **The supported vmrun setup is exactly the one where the terminal cannot
  start**, and `index.ts:80` attaches unconditionally. One terminal click on a vmrun host
  takes the API down.
- **F3** — `/finish` is neither terminal nor idempotent. Measured end-to-end in exam mode:
  finish once to receive the full checkpoint key (which `/grade` deliberately withholds via
  `revealed: false`), fix exactly those, finish again → `rating: 'easy'`, `allPassed: true`,
  rung unchanged. The app certifies a cold solve that used the answer key.

**F4 is my defect.** Mandate 7's guard is `v.checkpoints.length < expectedTotal` —
comparing **lines** to **distinct ids**. `parseVerdict` does not dedupe and
`countCheckpoints` counts distinct ids, so a grader emitting one id twice and then killed
reports `allPassed: true` for a checkpoint that never ran. That re-opens the precise false
pass mandate 7 was written to close. Latent only because none of the five shipped graders can
emit an id twice (43 `ck` sites, all unconditional or in mutually exclusive branches) — and
`session.ts:29-32`, my own comment, describes emitting one id from several branches as
*routine*. Fix is one line: `statusById(v).size < expectedTotal`. The reviewer also found the
opposite direction: `CK_CALL` matches inside a heredoc body, so a heredoc'd `ck` produces a
**false `incomplete`**, i.e. a false fail on a correct solution. Both directions now pinned.

**F5 is the disclosure leak the mandate looked like it had fixed.** Rung 4 of
`selinux/019-httpd-alt-port` emits `Listen` and `DocumentRoot` — the replacement halves of
two `sed` expressions, and the two httpd directives the task is *about* — under a heading
promising arguments are omitted, then tells the student to `man Listen`. `content.ts:90`
asserts "neither can leak an argument". **F6:** the test named for this
(`content.test.ts:98`) passes only because every fragment of its synthetic line contains `[`
or `'`, so it verifies punctuation rather than the mechanism it is named after. The mandate's
mitigation was an authoring convention already violated by content in the repo.

### Rulings on the four delegated judgement calls

1. **`at` helper — accept**, per the reviewer, with the docstring corrected and an
   `expectMissing` added, no retrofit. It proved both halves: typo'ing the leaf *and* an
   intermediate key still passes (16/16), and both un-typo'd assertions fail when the masking
   logic is deleted. So the assertions have teeth and my premise was wrong — the `undefined`
   arm is **not** reachable only at the leaf (F11).
2. **Missing `Origin` — keep it**, per the reviewer. 14 handshake variants measured against a
   real loopback server, `[pty spawned]` marking real shells: every near-miss refused,
   including `''`, literal `null`, case, trailing slash, duplicate headers, `[::1]`, and
   absolute-form request URIs. Browser gap carried into Task 24, not blocking — **F15
   corrected my input document**: `terminal.test.ts:157` *does* observe the refusal arm
   against a real handshake, so the disclosure invited a heavier remedy than the gap needs.
3. **`index.ts` zero coverage — extract**, per the reviewer, and its reason is better than
   mine: not the line count, but that `HOST` is one character from binding `::` (measured
   both arms) and nothing would fail. New side-effect-free `src/server/config.ts`; the real
   obstacle was never purity but that importing `index.ts` executes `loadVmConfig`,
   `loadBank`, `chooseTransport` and `serve`.
4. **Redactor residuals — not adequate**, per the reviewer, and for the right reason: the two
   *disclosed* residuals are fine, but the same paragraph claims no argument can leak while
   the repo's own content leaks two.

**Ruling on F7 (mine, not delegated): the open card browser stays; the false claim goes.**
`/api/concepts/:id` returns a full card with no session, mode or rung check, one hop from the
task detail's concept ids — so calling rung 3 "gated" is false. But gating the library would
break what this app is for: the user's stated purpose is that it *replaces the book*, and a
concept library reachable only by failing a hint ladder is a worse book. So the endpoint
stays open, the wording gets corrected wherever rung 3's content is called gated, and exam
realism moves to the layer that owns it — **Task 24 must not surface concept-card links in
the exam-mode session view.** Cost if wrong: a student self-sabotages one rehearsal by
opening a card in another tab. Cost of the alternative: the book problem, rebuilt.

**Ruling on F13: park with a comment.** The shared `upgrade` listener destroys sockets for
every non-`/ws/terminal` path, but it is the only upgrade consumer today. A comment naming
the constraint is the whole fix; a second endpoint's author should not have to debug it.
Cost if wrong: one confusing afternoon for whoever adds the second WebSocket route.

**Correction to preserve, or the whole-branch review will drop a valid finding.** The
reviewer says mandate 9's premise — that `config.ts:35-55` holds an empty-string-defeats-`??`
defect — is "wrong in outcome". That is right **for the port keys only**: `Number('')` is 0,
`0 < 1`, so both `RHCSA_SSH_PORT=''` and `RHCSA_PORT=''` throw a named error. It does **not**
disprove **P2**, which is about `sshUser`, `sshKey` and `vmrun` — those have no range check,
so `RHCSA_SSH_KEY=` still yields `ssh -i ''`. P2 stands, narrowed to the keys without a range
check. Also newly parked: both parsers accept `'0x50'` as 80 and `' 22 '` as 22.

**Also carried:** the Step 20 manual prediction of `"rebooted": true` is contingent, not
certain — `grader.ts:88-92` returns early with `rebooted: false` when
`!task.rebootCheck || !anythingPassed`, so on an untouched guest the correct expectation is
`false`. Written into the fix brief so a `false` is not later read as a regression.

**Fix round 1 dispatched** to the same implementer (`task-23-impl`, rounds 1-3 resume it) with
`task-23-fix-1.md` as the specification: 3 HIGH + 6 MEDIUM + 4 LOW fixed, ruling 3's
extraction done, F13/F14/F15 and the hex/whitespace parsing parked.

### N3 sent to fix round 1 as an F4 addendum — it disables F4's fix rather than coexisting with it

Re-measured before sending, `MEASURED`. `CK_CALL` (`session.ts:34`) allows only `[ \t]*`
before `ck`, so a `ck` after a same-line command separator yields no id:

| script | ids counted |
|---|---|
| `ck alpha "d" $?` (column 0) | 1 |
| `    ck beta "d" $?` (indented) | 1 |
| `test -f /etc/fstab; ck gamma "d" $?` | **0** |
| `true && ck delta "d" $?` | **0** |
| `grep -q x /f \| ck epsilon "d" $?` | **0** |
| `ck one …` + `false; ck two …` | **1** of 2 |

The third row is the one that matters: `content/lib/assert.sh:60` documents
`some_condition; ck my-id "what was checked" $? "what to look at"` as **the** usage. An author
following the library's own documentation writes checkpoints the counter cannot see.

**Why this is not merely another latent bug:** it defeats F4's fix. A grader with five real
checkpoints, two written the documented way, declares 3. `expectedTotal` is 3, so a run
truncated after 3 of 5 yields `incomplete === false` and mandate 7's guard is disabled — the
same false pass, through the other door. Fixing F4's unit comparison without fixing the
counter would have left the hole open while making it look closed.

Still latent, stated precisely so the implementer does not over-fix: the only
`[;&|][[:space:]]*ck` match anywhere under `content/` is the documentation line itself, all
five graders put every `ck` at column 0 or indented, and the counts 019=8, 014=5, 017=5,
028=5, 006=8 are correct today.

The reviewer had independently found the **opposite** direction on the same regex — a `ck`
inside a heredoc body counts a checkpoint that never runs, giving a false `incomplete` and so
a false *fail* on a correct solution. Both directions are now in one fix. Two invariants must
not move and the implementer was told to report rather than adjust them if they do:
`countCheckpoints(assert.sh) === 0` (mandate 6's pinning test) and the five grader counts.

Parked file updated: P2 narrowed to the three keys with no range check (the reviewer disproved
it only for the port keys), P11 corrected per F14 (`bank.test.ts` has 8 call sites, not 7 —
the seven-*file* count is what is right), the `index.ts` zero-coverage item struck as closed by
ruling 3, P14 marked as closing in this round, and P15/P16/P17 added (hex-and-whitespace port
parsing; the shared `upgrade` listener; `transport` naming two different things across the
API, which Task 24 will read). A new "documented on purpose" section now lists the three
residuals the whole-branch review must not re-report.

## Session loss — fix round 1 never started; re-dispatched from a clean tree

The controller session ended between dispatching fix round 1 and the implementer reading it.
All 34 in-process agents died with it, including `task-23-impl`, so the dispatch and the N3
addendum both landed in an inbox that was never read.

**Verified state at re-entry, `MEASURED`:** HEAD still `ab32303`; `git status --porcelain`
empty; no `## Fix round 1` heading in `task-23-report.md`; `src/server/config.ts` absent
(ruling 3's extraction not done); `session.ts:100` still `v.checkpoints.length < expectedTotal`
(F4 unfixed); no `on('error'` in `src/server/terminal.ts` (F1 unfixed). So the round did
**zero** work and nothing needs unwinding.

**Nothing was lost, because the artifacts are files rather than context** — this is the second
time that has paid for itself. Surviving intact: `task-23-review.md` (684 lines),
`task-23-fix-1.md` (my adjudication of all fifteen findings), this ledger, the parked file, and
Task 25's twelve mandates.

**The one thing that existed only as a message was the N3 addendum**, so it has been appended
to `task-23-fix-1.md` (now 264 lines) rather than re-sent. Lesson for the rest of this plan:
an addendum to a running agent must also be written into the brief on disk, because a message
is the only artifact a session loss can destroy.

**Ruling: re-dispatch as a fresh implementer on opus rather than resuming at the same tier.**
The skill's rounds-1-3-resume-the-same-implementer rule presumes that agent still exists; it
does not. Opus rather than the original executor tier because this round is thirteen fixes
including three HIGH ones on the branch's only unauthenticated sudo-capable surface, a
disclosure leak on real content, a regex whose unit semantics were subtly wrong in both
directions, and an extraction of two security controls. Cost if wrong: a more expensive round
than needed on work that is mostly transcription from a measured report.

Dispatched as `task-23-fix-1`, opus, pointed at the fix brief as its instruction set and the
review as the per-finding specification.

## Task 23 fix round 1 complete — `b7c7f61`. Round 2 dispatched for F17.

12 files, +799/−89. Gates: `npm run typecheck` exit 0; `npx vitest run` **324 passed / 28
files** (baseline 301/27, so +23 tests and one new file `test/server/config.test.ts`);
`node src/cli/index.ts coverage` exit 0, zero `problem:` lines; no new casts, no banned
syntax; `git status --porcelain` empty.

**Fixed:** F1, F2, F3 (HIGH); F4, F5, F6, F8 (MEDIUM); F9, F10, F11, F12 (LOW); ruling 3's
`src/server/config.ts` extraction. **F16 is the implementer's label for my N3 addendum**, not a
sixteenth finding — it rated it HIGH, which is right, since the separator under-count disables
F4's fix rather than merely coexisting with it. **F13 was treated exactly as ruled**: the
`upgrade` listener now documents that it owns every upgrade and that a second endpoint must
share one dispatching listener — the comment was the whole fix. **F7 implemented as ruled**;
the false "rung 3 is gated" wording turned out to live in `ladder.ts`'s `MAX_RUNG` docstring
and a `content.ts` comment, not in the brief's `Produces` block as I had guessed.

**Both F4 invariants held after the rewrite**, re-measured by the implementer:
`countCheckpoints(assert.sh) === 0`, and 019=8, 014=5, 017=5, 028=5, 006=8 unmoved. That was
the constraint most likely to be quietly broken and it was not.

**Teeth verified by breaking the code**, which is the standard this project now holds itself
to: renaming an intermediate key made the new `expectMissing` fail with
`expected a record at taskzz.0, got undefined` where the old `toBeUndefined()` passed; and
deleting `ws.on('error')` reproduced `RangeError: Invalid WebSocket frame: RSV1 must be clear`
as an unhandled vitest error. Both restored and re-verified green.

### F17 — new finding, raised by the implementer and correctly not self-adjudicated

`CK_CALL`'s id class is `([a-z0-9][a-z0-9-]*)`, so `ck my_id` counts as `my`. Beside an
existing `ck my` that is truth 2 / counted 1 — the fail-open collision, a third door into the
same defect as F4 and F16. The implementer flagged it, documented it, and explicitly declined
to widen the regex, on the grounds that the one function under a "report it if an invariant
moves" constraint is the wrong place for an unrequested change. **That was the right call and
worth recording as the behaviour to want** — the alternative, a silent widening inside a
measured-invariant function, is how a fix round becomes unreviewable.

**Ruling: apply the widening to `[A-Za-z0-9_][A-Za-z0-9_-]*`.** It is the same fail-open class,
it moves none of the six invariant counts (measured), and nothing else would catch it —
`rhcsa validate`'s emitted-id check is VM-gated and Task 25's mandate 11 lint does not exist
yet, so today there is no gate at all. Cost if wrong: one regex accepts ids the authoring
convention forbids, which is the safe direction. Required a test for the collision
specifically (`ck my` + `ck my_id` must count **2**), not merely a test that an underscore
parses.

**The design split this creates is deliberate and is now written into both places.** The
counter is **permissive**, the validator **strict**: a counter that misses an id fails *open*
(false pass), a validator that rejects one fails *closed* (a loud authoring error). Enforcement
of the lowercase-kebab convention therefore belongs to the lint, not the counter — so
**Task 25's mandate 11 gained a fourth check** (`^[a-z0-9][a-z0-9-]*$` as an **error**, unlike
the emitted-but-undeclared check which stays informational), with a test asserting both halves
at once on the same input. Mandates file now 837 lines.

### Carried forward

- `GradeReport.total` and `passed` now count **distinct checkpoint ids**, not lines. Task 24
  renders "3 of 5" from these, so it must read them as ids.
- **New fail-closed residual on live content:** stripping quoted runs means a quoted command
  substitution no longer contributes its inner words, so `troubleshooting/028` solution 01's
  `nmcli … "$(cat /etc/rhcsa-conn)"` now sketches as `nmcli` alone and `cat` is no longer
  disclosed at rung 3. Agreed with not chasing it — under-disclosure is the safe direction and
  closing it means lexing substitutions. **Parked as a content concern rather than a code one:**
  a one-command rung-4 sketch is a weak hint, and it lands on the one task that is graded
  through `rhcsa validate` rather than the Lab screen, so its hint path is the least exercised.
- The report could not be committed because `.superpowers/` is git-ignored. That is correct by
  design — the workspace is scratch that travels with the plan, not history — and the
  implementer was right not to `-f` it.

### Task 23 — scoped re-review dispatched (fix rounds 1 and 2)

Package `review-ab32303..8083796.diff`, 2 commits (`b7c7f61`, `8083796`), 70883 bytes.
Context written to `task-23-rereview-context.md` (209 lines). Reviewer on **opus**.

Ruling: opus for a scoped re-review, against the skill's "cheap-to-mid tier for scoped
re-reviews of small fix diffs" guidance — why: +800 lines is not a small fix diff, and the
content is three HIGH fixes on the branch's only unauthenticated sudo-capable surface, a
disclosure leak measured against real bank content, a regex wrong in both directions at once,
and the extraction of two security controls into a new file. Cost if wrong: one expensive
review seat on a diff a mid tier could have judged.

Scoping decisions recorded in the context file:
- Per-finding table F1-F17 required, each FIXED / NOT FIXED / PARKED-AS-RULED / REGRESSED. A
  report without the table is not accepted.
- The reviewer must **re-measure** the six invariants itself rather than inherit them from the
  implementer's report: `countCheckpoints(content/lib/assert.sh) === 0`, 019=8, 014=5, 017=5,
  028=5, 006=8.
- Explicitly told **not** to report the "documented on purpose" residuals from
  `whole-branch-parked.md` (the unquoted-delimiter redactor case, the `for u in`/`case` label
  noise, the `vmrun.ts:108` argv exposure), nor the parked findings F7, F13, F14, F15, nor the
  `'0x50'`/`' 22 '` port parsing.
- Named the specific trade-one-defect-for-another shapes to hunt: a handler that swallows the
  error but leaks the pty; a 409 on two routes while the exam key stays reachable through a
  third; a counter that closes two directions and opens a fourth; a redactor that stops leaking
  by starting to hide real commands; a test that passes whether or not the fix is present.
- Asked for an adjudication of the one disclosed regression (`troubleshooting/028` solution 01
  sketching as `nmcli` alone) rather than presenting my ruling as settled.
- Every conclusion labelled `measured` or `reasoned`; where the implementer claims it broke the
  code to prove a test's teeth, redo it rather than believe it.

One remaining under-count is **disclosed in the code's own comment** and handed to the reviewer
to judge rather than pre-ruled: `CK_CALL` still misses a `ck` after `then`, `do`, `else`, `{`,
`(` or a line continuation, so the one-liner `if foo; then ck x "d" $?; fi` counts zero. All
five shipped graders put every `ck` at column 0 or indented, so it is latent — but under-count
is the fail-open direction, so the question is whether the disclosure is adequate or the
pattern must cover it.

### Task 24 — mandate 10 added (four requirements produced by the Task 23 review)

`task-24-mandates.md` 26187 → 589 lines. Mandates 1-9 were written before Task 23's review
existed; these four arrive from it, and two of them **correct** the earlier mandates.

- **10.1** — exam mode must not surface concept-card affordances in the session view. This is
  where the F7 ruling lands: the API stays open (gating the library recreates the book problem
  the app exists to solve), so exam realism becomes a UI affordance question, which is Task 24's
  layer. Both arms tested — exam shows none, practice shows them — because an exam-only
  assertion passes on a component that never renders cards at all.
- **10.2** — Step 16 grows from fourteen manual checks to **fifteen**: serve a page from a
  foreign origin (`python3 -m http.server 8123`) and confirm in the browser console that
  `new WebSocket('ws://localhost:5175/ws/terminal')` is refused. The allowlist's cross-origin
  refusal arm *is* observed server-side against a real handshake (`terminal.test.ts:157` — my
  earlier claim that it was never observed was wrong and the reviewer corrected it), but only a
  browser sets `Origin` on its own. Instructed to say *why* it is manual so a later reader does
  not "simplify" it into a unit test.
- **10.3** — P17's `transport` ambiguity, scoped to the UI boundary: `taskTransport` on the task
  summary type in `src/web/api.ts`, or a comment naming which meaning it carries. Not a server
  defect — Task 23 chose it and its reviewer agreed — but Task 24 reads the one endpoint where
  the field means the *task's* transport rather than the server's.
- **10.4** — two corrections to my own earlier mandates, both caused by Task 23's fix rounds:
  (a) `total`/`passed`/`expectedTotal` are now **distinct-id** counts (`session.ts:171-177`), so
  mandate 2's "3 of 7" copy is unchanged and now genuinely true — with an instruction not to
  compute a tally from any array length; (b) mandate 3 pointed at `index.ts` for the origin
  allowlist, which **moved** to `src/server/config.ts:49` in ruling 3's extraction.

I checked 10.4(b)'s set myself rather than making the implementer discover it, `MEASURED`: all
four origins present (`localhost`/`127.0.0.1` × server port/5173), `VITE_DEV_PORT = 5173`
declared once at `config.ts:38`, not hardcoded twice. So mandate 3's requirement is already
satisfied and its task shrinks to a confirmation — with the standing instruction that if the
implementer finds otherwise, my measurement was stale and it reports that rather than working
around it.

**Pattern worth keeping:** this is the third time a mandate of mine carried a pointer that a
later task's fix round moved. The cost is always the same shape — the implementer either
"fixes" something already correct or reports a phantom absence. Checking the pointer at
mandate-writing time takes one grep; checking it after costs a fix round.

### Task 23 — re-review verdict: CHANGES REQUIRED. Fix round 3 dispatched.

Report at `task-23-rereview.md` (316 lines). Reviewer reproduced every gate rather than citing
them: typecheck 0; **325 passed / 28 files**, 0 skipped, 0 todo; coverage 0 with zero `problem:`
lines; zero added casts/`!`/`enum`/`namespace`; porcelain empty before and after; no server left
listening. All 17 findings correctly dispositioned — nothing ruled FIX was skipped, nothing ruled
PARK was touched, and all three HIGH fixes were re-proved **by execution against an `ab32303`
control**, each with its test mutation-tested.

**Both of my open questions came back answered, and one of them corrected my framing.**

The reachability question on the disclosed `then`/`do`/`else`/`{`/`(` under-count: **disclosure is
adequate, pattern does not need to cover it** — 43 `ck` call sites across the five graders, every
one at column 0 or indented, nothing in `content/` or `docs/` matching
`(then|do|else|\{|\()[ \t]+ck`, and `assert.sh` documents only the comment form and the separator
form, which F16 now counts. But the disclosure is **not adequate as written**, because two of its
specifics are false (N5): a line continuation is *not* a miss when the continued line starts with
a separator or a bare `ck` (measured 1, base 0), and `$(( x << n ))` *is* a miss and is unlisted.

The 028 adjudication: **agreed with parking it, and my note understated the outcome.** The *line*
sketches as `nmcli`; the *task* sketches as `systemctl firewall-cmd nmcli`, measured through the
live `/hint` route. What was lost is `cat` — the only entry not part of the task. Exactly two
sketches in the whole bank changed (019 lost `Listen`/`DocumentRoot`, 028 lost `cat`); 014, 017 and
006 are byte-identical, and every command I named survived. So: fail-closed, three useful commands,
one incidental loss. My "one-command rung-4 sketch is a weak hint" was wrong about which number it
was describing.

**Why CHANGES REQUIRED: `countCheckpoints` closed two directions and opened two new ones**, both
regressions against `ab32303`.

- **N1 MEDIUM, fail-open.** `session.ts:61`'s `HEREDOC_START` is unanchored and quote-blind — the
  anchored version landed only in `content.ts`, so F8's fix was applied to one of the two files
  that has this regex. `echo "a << b"` or `want=$(( 1 << shift ))` opens a phantom heredoc and
  discards the rest of the grader: **0 ids, base 1**, with `ck` at column 0 so only heredoc
  handling can move it. Deflated `expectedTotal` → truncated run matches it → `incomplete` false →
  a student who changed nothing is told the task passed.
- **N2 MEDIUM, fail-closed.** The widened `CK_CALL` counts a phantom id when a separator precedes
  `ck` **inside a string**, falsifying the exact sentence at `session.ts:38-39` claiming blindness
  there. `printf "ok; ck phantom-id\n"` → **2, base 1.** A grader printing a progress line
  containing `; ck ` declares one too many and a correct solution is reported `incomplete`.

That function has now produced **four** fail-open/fail-closed defects across three rounds (F4's
unit, F16's under-count, F17's collision, N1/N2). Recorded as the branch's most defect-dense
surface; every edit to it needs measuring in both directions, not one. The reviewer supplied a
single-pass scan it measured green at 325/325 with all six invariants unmoved, **plus the two
naive variants that do not work** (emptying quoted runs without a `ck`-id exception breaks
`GRADE_BRANCHED`'s quoted id; emptying them before reading the delimiter breaks `<<'EOF'`) — that
negative result is worth as much as the fix, and it went into the brief so the implementer cannot
rediscover it at cost.

Also dispatched: N5 (correct the misses list + warn when `total > expectedTotal`, since
over-arrival is the *runtime signature of N1 itself* — had it existed, N1 would have surfaced in a
run rather than a review), N3 (deleting the entire heartbeat block leaves terminal tests at 12/12),
N4 (adding `result` to `view()` publishes the exam answer key through two routes with the app suite
still 18/18 — and Task 24 wanting one more field on the Lab screen is the live path), N7 (the
`HOST` test has teeth for its own `serve` call, but `index.ts:38` is the line that binds and
deleting `hostname: HOST` from production breaks nothing — so ruling 3's control is still unpinned
where it counts), N9 (pin 028's sketch, the one bank output besides 019 this diff changed), N8
folded into N1, and the `sh -c` wrapped-command residual added to the docstring.

**Ruling: `/reset` refuses a finished session with 409; `/hint` stays open. — Because the rating is
derived at finish and never persisted, so no stored value can be contradicted by a later rung, and
a finished practice lab is exactly where this app is supposed to keep teaching. — Cost if wrong: a
later view's `rung` sits above the `rungUsed` the rating was built from.**

This is the one place I ruled **against** the reviewer, which proposed 409 on both. I checked the
code before ruling rather than after, `MEASURED`: `rating` at `app.ts:294-304` is a local returned
once; `/finish` is already 409 on a second call; `rungUsed: s.rung` is captured at derivation time;
`MAX_RUNG` is 2 for exam and 3 for drill, so post-finish reading cannot reach solution content in
the graded modes. `/reset` is genuinely incoherent and does get the 409 — `restart(s.id, now())`
moves `startedAt` to 4000 while `endedAt` stays 3000, so any duration computed from the pair goes
negative, and `/reset`'s own comment at `app.ts:211-214` already argues this principle for the rung
without ever applying it to the clock. The asymmetry is the point: the rung is disclosure spent and
must not roll back, the clock is a measurement and must not move after the measurement is taken.

Refusing `/hint` would have been the wrong kind of correct — internally consistent and against the
product. The user's constraint is "I'm creating this app to prevent from reading any other
references like a book", and the moment they most want rung 5 is right after their attempt is
scored.

Round 3 resumes `task-23-fix-1` per the skill's rounds-1-3 rule; the agent survived and was idle.
Brief written to `task-23-fix-3.md` **before** messaging it — the lesson from the session loss two
rounds ago, now applied by default: a message is the only artifact a session loss can destroy.

### Task 23 — fix round 3 landed at `2cfbe8b`. Verified independently. Round-3 re-review dispatched.

`fix(api): rewrite the checkpoint scanner and pin the heartbeat, reset and bind` — 11 files,
+492/−26. All nine findings N1-N9 reported fixed.

**Verified myself rather than accepting the report, `MEASURED`:**

```
HEAD 2cfbe8b, porcelain 0
npm run typecheck                 exit 0
npx vitest run                    337 passed / 28 files, 0 skipped   (was 325/28)
countCheckpoints(assert.sh) = 0   019=8  014=5  017=5  028=5  006=8   — all six unmoved
round-3 diff: zero added `as` casts, zero non-null `!`, zero enum/namespace/decorator
```

Counter behaviour measured directly against the shipped function, all 13 shapes as expected: N1's
two forms now 1 (were 0), N2's two forms now 1 (were 2), heredoc bodies still skipped for `<<EOF`
and `<<'EOF'`, `<<<` herestring 1, quoted id `ck_pass 'home-from-lv'` survives, F16's separator and
`&&` forms 1 each, F17's collision 2, comment still ignored.

**One of my own numbers was wrong and the implementer's was right.** My fix-3 brief carried "no new
casts (src 5, test 29)". Test 29 is P6's count of the `(err as ContentError)` pattern in five
*content* test files — not a count of all casts anywhere. The implementer reported test 44 and
asserted it identical to `8083796`, which is the claim that actually matters. My verification grep
`\bas [A-Za-z]` was also wrong in the other direction: it matches English prose in comments and
returned 36/85. **Ruling: absolute cast figures are retired from every future gate in this plan;
the gate is "this commit adds none", measured on the diff.** Cost if wrong: a pre-existing cast
survives to the whole-branch sweep, which is where P1 and P6 already send it.

**The disclosed `$(( ))` residual is narrower and stranger than either document said.** `MEASURED`:
`$(( 1 << shift ))` → **0**, but `$(( bytes << 3 ))` → **1**. The anchored opener requires
`[A-Za-z_]` after `<<`, so a shift by a **variable** opens a phantom heredoc while a shift by a
**literal** does not. I checked the docstring rather than assuming: `session.ts:66-71` gives the
identifier example explicitly and names `reportFor`'s over-arrival warning as the runtime net, so
N5's requirement — that a disclosure be accurate, since a false one is worse than a disclosed miss —
is met. Handed to the fresh reviewer as a question rather than settled by me.

**Two corrections the implementer made to its own earlier work, both unprompted and both real:**
its comment claiming the `<<<` branch is kept "because `<<<WORD` should not contribute `WORD`" was
**false** — measured, the branch *emits* `WORD` where falling through emits nothing — now rewritten
as defence against a future loosening of the anchor. And it sharpened `/grade`'s comment saying
"409 for the same reason /hint uses it", since `/hint`'s 409 is the rung cap, not a finished
session. It also found and closed an unreported fail-open case the review missed:
`printf "a # b"; ck real-id` was 0, now 1.

It built both naive variants my brief warned about and confirmed both fail — anchoring alone leaves
N2 at 2 *and* breaks real heredocs; emptying every quoted run drops `GRADE_BRANCHED` from 3 to 2.
Recorded because it means the reviewer's negative result was correct and transferring it into the
brief saved the round.

**Ruling: the round-3 re-review goes to a FRESH reviewer, not the one that produced N1-N9. — Because
the scan in this commit was built from that reviewer's own measured recipe, so approving it would be
reviewing its own design, which is the self-approval the process exists to prevent. — Cost if wrong:
one review seat spent re-establishing baselines the previous reviewer already had.**

That cost is real and I paid it deliberately: the fresh reviewer must re-measure the `ab32303`
controls the first one already had in context. Worth it, because the alternative is the branch's
most defect-dense function being signed off by the author of its fix.

Package `review-8083796..2cfbe8b.diff`, 1 commit, 50735 bytes. Reviewer on **opus** — same
justification as before plus a sharper one: this function has broken four times, and both previous
reviews of it found a real fail-open defect that the entire suite passed over. Context tells it to
assume a fifth exists until it has tried hard and failed, and lists the specific seams to attack
(escaped quotes, unterminated quotes, nested quote types, unterminated heredocs, `<<-EOF` with an
indented terminator, two heredocs on one line, and the `ck`-precedes-quote exception used as a
weapon to declare two ids from one call).

Also ordered: mutation-test all four new pins, because N3, N4 and N7 each existed *because* the
thing they cover was unpinned while passing — so a toothless new pin is that same defect
re-committed. And a direct test of my N6 ruling: if a stored value exists that a post-finish rung
contradicts, the ruling is wrong.

## Task 23 — round-3 re-review verdict (fresh reviewer, `8083796..2cfbe8b`)

Verdict **CHANGES REQUIRED**. N1-N9 all FIXED, none REGRESSED among them. Every new pin has teeth
(mutations M1-M8 done in `/tmp/mut`, repo untouched). All six of my own measurements confirmed
independently: typecheck 0, 337 passed / 28 files / 0 skipped, six invariants unmoved
(`assert.sh` 0; 019=8, 014=5, 017=5, 028=5, 006=8), zero added casts / non-null / banned syntax.

Two of my questions answered:

- **The `$(( ))` disclosure is adequate.** One optional wording clause offered (a shift by a literal
  is counted, only a shift by an identifier is not) — the reader's error is in the safe direction.
  The reviewer named the genuinely inadequate disclosure in that same comment block as R7 instead.
- **The N6 ruling survives.** Driven across all three modes: exam finish `rating="hard" rung=1
  maxRung=2`, hint#1 200 → rung 2, hint#2 409, finish2/grade2/reset all 409, clock frozen at
  1000/2000; drill caps at 3; practice reaches rung 5 "A full solution" then 409. No stored value
  contradicts a post-finish rung. `/reset` 409 + `/hint` open is the shipped shape.

Eight new findings, R1-R8, each measured against real bash with the reproducing shape:

| id | sev | direction | one line |
|---|---|---|---|
| R1 | HIGH | fail-open, **REGRESSION** | `indexOf(ch, i+1)` ignores `\"`, so odd `"` parity desyncs the walk and discards the rest of the line: `echo "it\"s ok"; ck real-id "d" $?` → bash 1, `b7c7f61` 1, `8083796` 1, `2cfbe8b` **0** |
| R2 | MEDIUM | fail-closed | `CK_BEFORE_QUOTE` not word-anchored, so any word ending in `ck` keeps and rescans the next quoted run: `ck perm-check "checked; ck also-ran"` → bash 1, scanner 2. `-check` is the natural id suffix |
| R3 | LOW | fail-closed | the kept `ck`-quoted run is scanned whole: `ck "real-id; ck phantom"` → bash 1, scanner 2 |
| R4 | LOW | fail-closed | heredoc terminator matched with `trim()`, so an indented `EOF` ends a plain `<<EOF` body early → bash 1, scanner 2 |
| R5 | LOW | fail-closed | only the first opener on a line tracked: `cat <<A <<B` → bash 1, scanner 2 |
| R6 | LOW-MED | both | bash starts a comment at any word start incl. after `;`/`)`/`}`/`&`/`|`; `true;# note; ck phantom` → 2, and **`true;#uses <<EOF style` → 0** |
| R7 | MEDIUM | fail-open | the corrected known-misses list still omits a `case` label — a *closing* paren, which no reader gets from "`(`": `enabled) ck en-id "d" 0 ;;` → bash 1, scanner **0**. `content/tasks/storage/014-grow-home-lv/grade.sh:44-46` and `content/lib/assert.sh:88-91` already contain `case`, so the bank is one line away |
| R8 | MEDIUM | fail-open, pre-existing | a `/reset` between `/grade` and `/finish` moves `startedAt` while `s.result` survives the revert: grade→finish gives `startedAt 0, endedAt 1200000, good`; grade→reset→finish gives `1200000/1200500, easy`. A 20-min solve on a 10-min task laundered into a cold inside-budget one |

Structural note from the reviewer, which I acted on: R1's truncation, R6's third row, and the
disclosed `$((` residual are **four distinct routes into "a phantom heredoc discards the rest of the
file"**, and recognising `<<` only in redirect position closes them at once — "worth costing before
disclosing them one at a time."

**Verified independently before scoping round 4:** I rebuilt the bash differential oracle myself.
`ck` is pure bash string manipulation plus `echo`, so `{ cat content/lib/assert.sh; cat snippet; } |
bash | grep -oE '"id":"[^"]*"' | sort -u` is ground truth. For R1's shape bash emits exactly one id
(`real-id`) where `countCheckpoints` returns **0**. `MEASURED`. R1 confirmed.

**Ruling: close R4/R5/R6 and the `$((` residual in code rather than disclosing them.** — Because
`countCheckpoints` is the sole source of `expectedTotal`, each is fail-open toward telling a student
they passed, and the disclosure list has now been wrong twice (N5, R7) while the code has been wrong
five times. — Cost if wrong: a scanner slightly more complex than the hint-sketcher twin needs.

**Ruling: widen `CK_CALL` to accept `then`/`do`/`else`/`{`/`(`/`)` instead of documenting the group a
third time.** — Because the differential oracle makes widening verifiable in a way earlier rounds
could not, and every member of that list is a latent fail-open on a function whose miscounts are
silent by construction. — Cost if wrong: an over-count the oracle missed, which is fail-closed and
loud. This supersedes fix-3's "do not change the pattern to cover that group": that instruction was
correct when the only alternative to a disclosure was an unverifiable guess.

**Ruling: the bash differential oracle is mandated as round 4's verification method.** — Because
three rounds derived their expectations by reasoning about the regex, and that is precisely how five
defects passed every test. — Cost if wrong: a test helper nobody needed.

Fix round 4 dispatched to a **fresh implementer on opus** (rounds 4-5 take fresh eyes one tier up;
round 1's implementer was already opus, so top tier is the ceiling). Brief:
`task-23-fix-4.md`. Scope: R1-R8 plus arithmetic-depth tracking. The breaker trips at round 5.

## Task 23 round 4 in flight — downstream document work done while waiting

**`whole-branch-parked.md` reconciled.** P14 closed and re-measured rather than assumed (the
separator forms count 1 each; the six invariants hold). Added a pointer that `session.ts`'s
docstrings, not that file's history, are the authority on the counter. Added the `sh -c` wrapped-command
sketch to "documented on purpose — do not report these". Added "any absolute `as`-cast figure in these
documents" to "not findings", with the reason: they count one specific pattern, and my own verifying
grep matched English prose in comments. **P4 remains the highest-severity parked item** (`waitForGuest`
returns before boot completes → verdict B graded against a half-booted guest → false regression).
R3-R6 were deliberately *not* added as disclosures, because round 4 is closing them in code.

**Ruling: absolute line numbers are retired as addresses in the Task 24 and 25 mandates; the symbol
name is the address.** — Because a fourth pointer of mine has now been moved by a later fix round:
`session.ts:171-177` (mandate 10.4a) now lands in the middle of `countCheckpoints`'s heredoc loop, and
`config.ts:49` (mandate 10.4b, written by me last segment) moved to 70 when round 3 inserted
`serveOptions` above it. — Cost if wrong: a reader greps for a symbol instead of jumping to a line.
Both corrected to name `reportFor` and `allowedOriginsFor`. Re-verified the origin set itself: all four
loopback origins present, both Vite entries interpolating `VITE_DEV_PORT` rather than spelling `5173`.
`app.ts:56` → `transport: t.transport` still exact. Every `file:line` in the Task 25 brief and mandates
resolved and checked; the rest are accurate.

**Task 25 brief Step 4 corrected myself rather than delegating it (mandate 4's four sites).** Two
findings, one of them mine:

- **My own fixture recount was wrong and I caught it against mandate 4 rather than overwriting it.** I
  counted files under `solutions/`/`antisolutions/` and got 22 ssh + 5 vmrun = 27; mandate 4 said 26 + 6
  = 32. Mandate 4 is right. A run's fixture count is `1 + solutions + antisolutions` per task, because
  each task gets a synthetic empty `no-action` baseline (`harness.ts:67`), while the `fixture-inventory`
  gate enters the results **only when it fails** (`harness.ts:308`) so a healthy bank contributes none.
  Per task 8/6/6/6/6 — the same shape the coverage table uses, which is the cross-check I should have
  used first. Both traps are now written into the brief beside the numbers so the next recount does not
  "correct" a correct figure. Mandate 4's four sites are marked applied, with the line numbers
  deliberately not refreshed.
- **A real defect in the step, not on mandate 4's list:** `npm run validate … 2>&1 | tail -40` followed
  by `echo "exit=$?"` reports **`tail`'s** status, so a failing validate run printed `exit=0`. The
  branch's recurring defect class — a tool reporting success when it did not do what was asked — sitting
  inside the step whose whole purpose is catching broken content. Now redirects to a log, checks the
  status, then tails. Swept both remaining briefs: these were the only two sites.

**Ruling: Task 25's `lint` must not flag a `ck` that follows a command separator.** — Because that
mandate section still described `CK_CALL` as line-start-anchored and ordered the lint to report the
separator form as a problem, which fix round 1 made *correct* and which `content/lib/assert.sh:60`
documents as the usage; shipping it would fail every conforming grader and destroy the linter's
credibility. — Cost if wrong: a shape goes unflagged that the lint could have caught, backstopped at
runtime by the `incomplete` guard and the over-arrival warning. The mandate's own gate had the same bug
— it required planting the non-line-start form and expecting a non-zero exit, i.e. it would have proved
the linter wrong and called it tested. Plant 3 is now **a `ck` whose id is a variable** (`ck "$id"`),
which the counter cannot see by design under Task 22's literal-id rule and which is genuinely
fail-open; an optional fourth plant covers the lowercase-kebab convention `session.ts` explicitly
delegates to this lint. The section now also points Task 25 at round 4's bash differential helper
instead of at the regex.

## Task 23 — fix round 4 landed, `f65d0a4`

Commit `f65d0a4` "Task 23 fix 4: measure countCheckpoints against real bash, close R1-R8" —
5 files, +925/−50 (`session.ts` +248, `checkpoint-oracle.ts` +448 new, `checkpoint-oracle.test.ts`
+62 new, `session.test.ts` +136, `app.test.ts` +81). Review package
`review-2cfbe8b..f65d0a4.diff` (1 commit, 57405 bytes).

**Dispositions.** R1-R8 all closed in code, plus the `$(( ))` arithmetic-depth residual.
`session.ts` 376 → 537 lines: `closingDoubleQuote()` pairs quotes after escape removal
(double-quoted runs only — single quotes process no escapes, so the two are deliberately not
treated alike); `QUOTED_ID` keeps the minimal id-prefix exception; a `PendingHeredoc[]` queue
replaces the single-heredoc assumption; `WORD_BREAK = /[ \t;&|()]/`; arithmetic depth tracks
`$((`/`((`; `CK_CALL` accepts `^` or any of `; & | { ( )` plus optional `then`/`do`/`else`, and the
known-misses list is retired; `restart()` now does `delete s.result`.

**The implementer ran the oracle against the unmodified scanner first and reproduced 28
disagreements** before changing a line — independently confirming the review's measurements rather
than taking them on faith. Oracle final state: 73 cases, 0 disagreements.

**My independent verification at `f65d0a4`** (not cited from the report): typecheck exit 0;
**345 passed / 29 files**, 0 skipped, up from 337/28; coverage exit 0, zero `problem:` lines,
`untaught concepts: 0`; **all six invariants unmoved** standalone and combined (assert.sh 0; 019=8,
014=5, 017=5, 028=5, 006=8) — the riskiest check of the round, since a widening that accepts `)`
and `{` runs straight into `assert.sh:88-91`'s and `014/grade.sh:44-46`'s `case` statements; my own
**independent** 20-shape bash oracle covering every R1-R7 shape and both arithmetic parities:
**all 20 agree**; 5 prefix-collision probes show no silent id truncation (full hyphenated and
underscored ids survive R3's prefix cut); zero added `as` casts (the one diff hit is the English
word in a comment), zero non-null `!`, zero banned syntax.

**Ruling: my own round-4 brief carried a wrong instruction and the implementer was right to refuse
it.** Mandate 4's R6 bullet — repeating round 3's review prose — listed `}` among the positions
where `#` starts a bash comment. Measured, `}` is not a bash metacharacter: `{ true; }#note` is a
syntax error and `${x}#tag` is a single word. Adding it to `WORD_BREAK` would have *introduced* a
fail-open, cutting `echo ${x}#tag; ck real-id "$y" 0` at the `#` and losing a real checkpoint. The
implementer excluded `}` (and `<`/`>` on the same reasoning), documented why, and pinned it with
mutant M-F2. Cost if wrong: nothing — the mutant is the standing test. This is the brief's
report-a-measurement-that-changes-my-mind clause working as intended, and it is the second time this
task's review chain has propagated a plausible-sounding claim about bash that measurement refuted.

**Ruling: accept M-B as an honestly-labelled surviving mutant rather than manufacture a test for
it.** Removing `CK_BEFORE_QUOTE`'s word anchor breaks no test, because R3's fix makes the anchor
unobservable: the retained text is `"` + id-prefix + `"`, which contains no whitespace, and
`CK_CALL` requires whitespace after `ck`. The implementer reported this against itself instead of
papering over it. Anchor kept as defence in depth with the explicit statement that no test proves
it. Cost if wrong: a distinguishing shape exists and R2 is not closed the way the report claims —
which is why the re-review is asked to try to construct one.

**Two new divergences the oracle found, outside R1-R8**, pinned in `ORACLE_DIVERGENCES` with
measured pairs and directions:

- `quoted-run-spanning-lines` — bash 1, counter 2, **fail-closed**. Deliberately unfixed: carrying
  quote state across lines trades a loud over-count for the silent swallow-the-rest-of-the-file
  mode that four of this round's own findings were instances of. No grader in the bank has a
  multi-line string.
- `ansi-c-quoting-with-escaped-quote` (`$'a\'b'`) — bash 1, counter **0**, **fail-open**. R1 through
  a third quoting form: `$'…'` *does* honour `\'`, unlike a plain single-quoted run. Measured
  unreachable today (no `$'` in any grader). Classified an **open fail-open risk, not a residual**.

**`content.ts`'s twin `scanLine` left alone deliberately**, with the asymmetry measured: `\"` occurs
once under `content/` (`assert.sh:16`, even parity), the only odd-double-quote lines are two
comments in `028/setup.sh:41-42`, `commandSketch` runs over solutions not setup scripts, and no
`$'…\'…'` exists anywhere under `content/`.

The report's own answer to "correct or merely more correct": **merely more correct** — a
line-at-a-time static walk of a language whose lexer is not line-at-a-time. `countCheckpoints`
remains the branch's most defect-dense function (five defects across three rounds, each round's fix
introducing the next); round 4 is the first to break that chain by measuring instead of reasoning.

**Next:** round-4 re-review dispatched to a **fresh** reviewer on the most capable model — the
round-3 reviewer authored R1's and R8's suggested fixes and would be reviewing its own design.
Context file `task-23-rereview-4-context.md` (Priority 1 is the instrument, not the function).
The re-review must also rule on the `$'…\'…'` fail-open: close in round 5, or accept as disclosed.
**The breaker trips at round 5.**

## Task 23 — round-4 re-review verdict: CHANGES REQUIRED. Round 5 scoped (FINAL round).

Fresh reviewer (Opus), review at `task-23-rereview-4.md`. **Fourth consecutive review of
`countCheckpoints` to find a real defect that every test passed over.** R1-R8 all confirmed FIXED,
none regressed, each killed by a targeted mutant *and* independently by the oracle table. Six
invariants UNMOVED. Gates re-run by the reviewer and matching mine.

**Oracle ruled VALID** — the Priority 1 question. Breaking `countCheckpoints` to `ids.size - 1` in a
/tmp copy turns both tests red; all three vacuity modes fail loudly; single-path is self-enforcing
(a `ck` on an untaken branch surfaces as counter>bash and the table is green); 72/73 rows have
bash ≥ 1 and the one 0/0 row is the intentional must-not-count case; the helper is genuinely not
collected by vitest. The instrument holds.

**M-B ruled unkillable and acceptable.** Fuzzed anchored vs unanchored over **419,328** generated
lines: 0 differ, with the proof — the anchor only matters when the char before `ck` is in
`[A-Za-z0-9_-]`, but `CK_CALL` requires `^` or one of `;&|{()` there, mutually exclusive. R2 is
closed by R3's fix; the anchor is defence in depth. No change wanted. Round 4's decision to report
this against itself rather than manufacture a test was the right call.

### Ruling REVERSED: round 4's decision to leave multi-line quote state alone was wrong, and I ratified an inverted cost argument.

I accepted the implementer's argument that carrying quote state across newlines would trade a loud
over-count for a silent swallow-the-rest-of-the-file mode. **Both halves were backwards.** Measured
by the reviewer and **independently reproduced by me** at `f65d0a4` via `/tmp/n8.mjs`:

```
awk-then-ck-same-line      bash=1 counter=0    <- assert.sh's own two idioms, composed
single-quoted-2line        bash=1 counter=0
double-quoted-2line        bash=1 counter=0
heredoc-inside-quoted-run  bash=2 counter=0    <- the swallow mode, ALREADY reachable
```

The natural arrangement is **under**-counting and **silent**. The swallow mode is not a risk the fix
introduces — the current code already has it, via a `<<` on a middle line queueing a phantom heredoc.
And the shape is in the counted text: `assert.sh` has three multi-line single-quoted `awk` programs
(`:103-107`, `:150-153`, `:164-170`) and `harness.ts:65` prepends `assert.sh` to every grader
**before** counting (verified: `grade: \`${assertLib}\n${gradeBody}\``). No checkpoint is lost today
only because those three closing lines happen not to carry a trailing `ck` — a line-break coincidence
nothing pins, while `assert.sh:60` documents `some_condition; ck my-id "…" $?` as *the* usage.
Composing the bank's own two documented idioms yields a silent false pass. Cost of my wrong ruling:
one extra fix round, caught before shipping.

**Ruling: bundle all seven of the reviewer's ranked recommendations into round 5, and round 5 is the
last round.** Because the breaker trips here, a partial round leaves the remainder to adjudication
rather than to a round 6. Brief at `task-23-fix-5.md`. Cost if wrong: a larger final diff than a
minimal one, mitigated by the oracle making each item independently measurable.

**Ruling: do NOT extract a shared `lexBash` in round 5.** The reviewer is right that ~165 lines of
hand-rolled lexer with six defects in four rounds and a divergent twin in `content.ts` wants
extracting, and it explicitly declined to block on it. But round 5 is the last round before the
breaker, so a regression introduced by a refactor has nothing downstream to catch it; bundling a
structural change with the correctness fix trades a measured win for an unmeasured risk. **Parked for
the whole-branch review.** Cost if wrong: the twin stays divergent and `content.ts` keeps R1's escape
bug — measured unreachable through the sketcher, since `commandSketch` runs over `ctx.solution`.

### New findings, all seven carried into round 5's brief

| # | sev | direction | reachable in bank today |
|---|---|---|---|
| **N8** | HIGH | **fail-open**, silent, unbounded | **shape yes** (3× in assert.sh); loss held off only by a line-break coincidence |
| **N9** | HIGH | disclosure defect (N5/R7 class, third time) | n/a — the `quoted-run-spanning-lines` entry is false on direction, quote type *and* reachability |
| N10 | MED | both (`HEREDOC_START` narrower than a bash word) | no — no `<<` opener in the counted text, only a `<<<` herestring at `028/grade.sh:33` |
| N11 | MED | coverage gap — **M-J survives**: round 4's own `$(` tracking has no test | n/a; both directions load-bearing |
| N12 | MED | instrument limit — gate compares cardinalities not id sets; direction guard is a tautology | n/a — these are the guards that should have caught N9 and structurally could not |
| N13 | LOW | fail-open (`! ck`, `LC_ALL=C ck`, `time ck`, `eval`, `ck \`+newline) | no |
| N14 | LOW | fail-closed (brace expansion, sketcher family) | no — already parked |

N12 matters out of proportion to its severity: the oracle's own gate could not have caught the false
disclosure it was supposed to police. Fixing the instrument is ranked above fixing N10/N13/N14.

**Round 5 dispatched to a fresh implementer on Opus** (skill: rounds 4-5 use a fresh implementer one
tier up; round 4's implementer is idle and deliberately not resumed). Expected test movement flagged
in the brief as a trap: the `quoted-run-spanning-lines` pin will fail because the divergence now
*agrees*, and the fix is to convert it into a regular `ORACLE_CASES` row proving agreement — not to
renumber it, which would be a test asserting the bug is still present.

## Task 23 — fix round 5 landed, `4ba3b01`. Breaker has tripped.

Commit `4ba3b01` "fix(session): carry bash quote state across newlines in countCheckpoints", parent
`f65d0a4` — 4 files, **+643/−94** (`session.ts` +238, `checkpoint-oracle.ts` +318,
`checkpoint-oracle.test.ts` +69, `session.test.ts` +112). Review package
`review-f65d0a4..4ba3b01.diff` (61622 bytes). Fresh implementer on Opus, per the skill's
rounds-4-and-5 escalation; round 4's implementer deliberately not resumed.

All seven mandates landed. **My independent verification at `4ba3b01`** (measured, not cited):
typecheck 0; **29 files / 349 tests, 0 failed, 0 skipped** (baseline 345); coverage exit 0, zero
`problem:` lines, `untaught concepts: 0`; **all six invariants unmoved** standalone and prepended
(assert.sh 0, 019=8, 014=5, 017=5, 028=5, 006=8); zero real casts / non-null / banned syntax added
(every `as` on the diff is the English word in prose); `git status --porcelain` empty.

**Twelve independent bash-differential probes at `4ba3b01` (`/tmp/r5probe.mjs`), and the N8
fail-opens are closed:**

```
agree  awk-then-ck-same-line            bash=1 counter=1   <- was 1/0 at f65d0a4
agree  heredoc-inside-quoted-run        bash=2 counter=2   <- was 2/0 at f65d0a4
agree  escaped-dollar-then-quote        bash=1 counter=1
agree  real-ansi-c-escaped-quote        bash=1 counter=1
agree  single-quote-backslash-asymmetry bash=1 counter=1
agree  heredoc-EOF-dash-1 / backslash-EOF / quoted-hyphen   all 1/1
agree  cmdsubst-hash-tag / cmdsubst-inner-ck                all 1/1
```

The only surviving DIFFERs are the two disclosed N14 brace-expansion rows (fail-closed, unreachable,
sketcher family).

### Both refusals of my mandates were correct, and both are measured.

**Ruling: the implementer was right to refuse "delete the oracle's direction assertion".** My mandate
3 repeated round 4's review, which labelled
`expect(d.direction).toBe(d.counter > d.bash ? 'over' : 'under')` a tautology. The implementer
measured that flipping *only* `direction` at `f65d0a4` **fails** the round-4 test, so it was a live
check and deleting it would have removed working coverage. It re-sourced it from the measured row and
extended it to express `both` (equal counts, different ids) — strictly stronger than what I asked for.
The round-4 review's label was imprecise: the pinned pair is itself asserted against a real bash run,
so direction was checked transitively. **This is the second time a review's prose, repeated by me into
a brief, would have made the code worse** (the first was `}` as a comment-start in round 4). The
re-review is asked to confirm this independently. Cost if wrong: a deleted assertion nobody notices.

**Ruling: the implementer was right to deviate on the ANSI-C formula.** Round 4's review proposed
`charAt(i - 1) === '$'`; that also fires on an **escaped** dollar (`echo \$'a\'`), which would have
introduced a *new* fail-open while closing an old one. It tracked `$` state instead, with M-M2 to
discriminate. **Verified by me:** `echo \$'a\'; ck real-id "d" 0` agrees at 1/1, and the `'it\'`
single-quote asymmetry — which is R1's fix — is intact.

**My brief's N14 numbers were wrong and the correction is right.** I wrote `echo {ck one,two}` as
counter 2 vs bash 1. Measured: alone it is **bash 0 / counter 1**; the 1-vs-2 reading needs the
two-line form, which is what got pinned. Direction (fail-closed) was right. Verified both readings
myself. That is the third factual error of mine this task has caught — the pattern is that my numbers
drift when I restate a measurement instead of re-running it, which is why the brief now tells
implementers to refuse mandates with measurements.

### Other round-5 dispositions

- **N9 corrected by removal**: the false divergence entry became two `ORACLE_CASES` rows proving
  agreement on the exact `assert.sh:60` idiom, plus four measured residual classes.
- **N8**: `scanLine` carries the open quote across the newline and suppresses both `ck` and heredoc
  registration while a run is open. Predicted single failure occurred (344/1) and **both pins were
  converted, not renumbered** — the trap the brief flagged. Its 38-case battery went 27 → 8
  disagreements, 19 fixed, 0 regressed.
- **N12**: id sets on both lists, `checkpointIds` exported, `why.length > 80` deleted.
- **N11 / M-J**: pinned both directions, docstring states the `$( )` suppression is correct because
  the JSONL goes into the captured substitution. My mid-round addendum warned against copying the
  reviewer's `printf`-re-emitting probe into `ORACLE_CASES`; the natural shapes were used.
- **N10**: `HEREDOC_START` **widened** into a bash-word parser rather than disclosed — three of six
  shapes were silent fail-opens discarding the rest of the grader, and no `<<` exists in the counted
  text so the invariants provably cannot move.
- **N13/N14**: four measured divergence entries. M-B untouched by ruling.
- **Mutation testing** in `/tmp/r5`: 10 new mutants killed, all 8 round-4 mutants still dead.
  **M-O is killed by the new id-set gate and survives the old cardinality gate** — the proof mandate 3
  bought something. **M-N2 initially survived because the implementer's own first heredoc pin had a
  space in it**; it measured `cat <<EOF>/dev/null` against bash and added a discriminating case. That
  finding exists only because mutating one's own new pins was mandatory.

### Open items going into adjudication (no round 6)

1. **The synthesised prologue** `code = carried.quote + carried.quote` — the implementer's own named
   seventh-defect candidate. It fabricates text never present in the script, so a continuation line's
   `code` is not a substring of the input. Id sets stay correct, so neither the oracle nor the six
   invariants would notice if anything downstream became positional.
2. **`heredocDelimiter` returns `undefined` for an unclosed quote inside the delimiter word**, where
   bash keeps reading. Claimed fail-closed and unreachable; not buildable as a single-path oracle case.
3. **N13's command-prefix family** (`! ck`, `VAR=x ck`, `time ck`, `eval`, `ck \`+newline) — disclosed,
   not fixed. The implementer names it the residual it would fix first: three silent fail-opens, one
   regex change. **This is the strongest candidate for overriding a tripped breaker**; the re-review is
   asked to verify both the unreachability and the one-regex cost before I rule.
4. **The property-test recommendation** — generate lines from the grammar, run bash, compare id sets.
   Test-only, and claimed to have caught all six historical defects. Carried to the re-review for a
   view, since it changes how this code is verified rather than what it does.

Round 5's own answer to "correct or merely more correct": **merely more correct.** The line-at-a-time
gap is closed for quoted runs; what remains is that `CK_CALL` decides where a command may start from a
fixed anchor set while bash uses a grammar.

**Final scoped re-review dispatched** to a fresh reviewer on Opus (the round-4 reviewer authored N8's
prototype and N12's recommendation, and two of its recommendations were refused this round — it cannot
adjudicate its own refusals). Context: `task-23-rereview-5-context.md`, which states plainly that
there is no round 6 and asks for findings ranked by whether they are load-bearing enough to override a
tripped breaker.

---

### Task 23 — final re-review of round 5: verdict and adjudication

**Verdict: APPROVED** at `4ba3b01`. All seven round-5 mandates ADDRESSED. Six invariants unmoved
(re-measured by the reviewer, standalone and prepended: assert.sh 0, 019=8, 014=5, 017=5, 028=5,
006=8). Nothing downstream of the synthesised prologue is positional. Both refusals upheld
independently. The oracle is valid as an instrument after its gate change — six sabotages all fail
loudly, and the decisive datum is that a compensating-pair mutant (rename one id, cardinality
unchanged) **dies under the new id-set gate, survives the old cardinality gate, and is invisible to
all 29 other test files** because `GradeReport.expectedTotal` is a number, so the two errors cancel and
the `incomplete` guard is silently disarmed.

**The finding that matters is the review's lead:** round 5 is a large net improvement *and* it landed
**10 new divergences from bash, 9 of them silent fail-opens** — measured as agreeing at `f65d0a4` and
disagreeing at `4ba3b01`. None is reachable in the bank today. But it is the pattern round 3's own
disclosure predicted about carrying quote state across the newline — the disclosure whose ruling I
reversed to authorise round 5.

- **F1 (HIGH, silent fail-open, unbounded)** — `session.ts:282` passes `carried.ansiC` as `escapes` for
  a carried run, but bash honours `\"` inside `"…"`. The sibling call site `:371` gets it right
  (`ch === '"' || ansiC`). This is **R1 re-opened through the newline**, six lines from a docstring
  warning that "collapsing any two of them re-opens R1". Six measured shapes, all bash-1/counter-0.
  **No test distinguishes defect from fix in either direction**: 349 green both ways, invariants
  byte-identical both ways. Unreachable only because the three carried runs in the counted text are all
  single-quoted, for which `carried.ansiC === false` is right *by accident*.
- **F2 (HIGH, silent fail-open, pure round-5 regression)** — `session.ts:449` checks `pending.at(0)`
  before `scanLine(raw, quoted)`, and the docstring at `:441-445` justifies the order with a claim
  about bash that is **measurably backwards**; the docstring's own example is a failing case.
- **F3** (`$[1 << 2]` read as a heredoc opener — fail-open, and it contradicts round 5's own "widening
  can only fail closed" argument), **F4/F5** (LOW, fail-closed, one of them a prose defect),
  **F6/F7** (PROCESS: mutants M-O/M-P/M-Q named by effect not by edit, so unauditable; and the report's
  "three fail-opens, one regex change" overstates N13 — one character closes only `! ck`, one of three).

**Ruling: one narrowly-scoped exception to the tripped breaker, for F1 + F2 only.** —
Four grounds. (1) F1 and F2 are regressions *this round introduced*, not inherited debt; a breaker
exists to stop unbounded iteration, not to ratify a regression that a measured two-line change
reverses — letting a round counter outrank a measurement is the wrong way to lose. (2) F1's direction
is silent fail-open and unbounded: the walk stays inside the string and discards the rest of the
grader, so `expectedTotal` collapses toward 0, `incomplete` goes false, and a grader that died on its
first command tells a student who changed nothing that the lab passed. (3) My own override bar —
"reachable in the bank as it exists today" — is the weakest guarantee available in *this* project: the
bank holds five graders and the curriculum is 28 chapters, and F1's distance to reachability is one
authoring choice (an awk program or message string written with `"` instead of `'`, and awk programs
routinely contain `\"`). (4) The fix is measured, not proposed: the reviewer applied both edits and got
11 divergences closed — including the pre-existing A6 over-count — 0 new disagreements across three
batteries, 349/349 green, invariants unmoved. — **Cost if wrong:** one more small commit and a
re-verification, against the risk that a two-line change is defect #8; mitigated by the oracle being
the only instrument that catches this class, plus the six invariants and three batteries.

**Not granted, by ruling:** N13/`! ck` (inherited debt, and one character closes only one of its three
fail-opens), F3/F4/F5 (disclose accurately, do not fix — `$[ ]` deprecated since bash 2 and absent from
`content/`), the `lexBash` extraction, `content.ts`'s twin, and the property test. The exception is for
regressions only; scope creep is how a granted exception becomes round 7.

**The stopping rule is absolute and stated in the brief:** if either edit moves any invariant or adds
any new disagreement, the implementer reverts and reports. "Reverted, and here is why" is a success
outcome. There is no round 7.

**Property test — endorsed as a follow-up with a non-optional condition:** the generator must itself be
mutation-tested and must assert a floor on `bash -n`-valid cases. The reviewer's own first fuzzer run
produced 78% invalid cases and false `OVER` verdicts because `>/dev/null` in its pool redirected the
checkpoint JSONL away — the same "looks measured, proves nothing" failure as the round-5 implementer's
spaced M-N2 pin. And decisively: **the fuzzer did not find F1 or F2.** Those came from reading the diff
and asking which argument crosses the newline. Carried to the whole-branch review, not built here.

**Fix round 6 (exception) dispatched** to the round-5 implementer (resumed, full context, edits fully
specified by an independent reviewer): `task-23-fix-6-exception.md`. It is asked to re-measure F2's
bash-ordering claim itself rather than accept the review's word, since it authored the false docstring —
its refusal record last round (two upheld, plus a correction of my own numbers) is why it was resumed
rather than replaced.

**My own independent measurement of F2, before the implementer reports** (I have restated a measurement
instead of re-running it three times on this task; not again). I wrote the docstring's own example to a
file with `ck() { echo "ID:$1"; }` prepended and ran it under real `bash`: the opener line
`cat <<EOF; x="a`, then `ck inside "d" 0`, then `b"`, then the delimiter line, then
`ck real-id "d" 0`.

`bash -n` exits 0, so the shape is legal. The run emits **`ID:real-id` and nothing else**, and `cat`
prints **nothing at all** — so bash completed the unterminated `"a … b"` word across the newlines
first, consuming the `ck inside` line into the string, and only then gathered the heredoc body, which
began after `b"` and hit the delimiter immediately (hence empty). `checkpointIds` on the same text at
`4ba3b01` returns `[]`, count 0.

**bash 1 / counter 0 — silent fail-open, on the very shape the docstring cites as its justification.**
Both halves of F2 confirmed: the divergence is real *and* the docstring's stated reason is backwards.
I am **not** sending these numbers to the implementer — the brief told it to re-measure independently,
and anchoring it would destroy the only check I have on that mandate. Its report gets compared to this.

Aside worth keeping: composing this ledger entry, my own `cat >>` heredoc terminated early on a bare
delimiter line inside a fenced code block and appended a truncated paragraph, which I then had to
truncate and rewrite. That is the same class of defect as F2 — a nested quoting context ending where
the author did not intend — hit by hand, in the middle of adjudicating it. Fixed by using a unique
delimiter; the general lesson is that this shape is not exotic, which is the argument for the fix.

**Correction to the measurement above, and a process error of mine worth recording.** I ran my first
probe batch against the live working tree while the round-6 implementer was editing it. `git status`
showed ` M src/server/session.ts`: HEAD still had `closingQuote(line, 0, carried.quote, carried.ansiC)`
at `:282` while the tree already had `carried.quote === '"' || carried.ansiC` at `:286`, uncommitted.
So my nine F1 shapes "all agreeing" measured **the implementer's in-progress fix**, not `4ba3b01`, and
my odd-versus-even escaped-quote hypothesis was built on that bad ground. The bash half of every
measurement was never affected — that runs on real bash and does not read the repo.

Re-measured properly, against a clean `git archive 4ba3b01` extracted to `/tmp/adj-4ba3b01` with
`node_modules` symlinked back (call site verified as the defective `carried.ansiC` form before running):

```
DIFFER F2-docstring-own-example   bash=["real-id"] counter=[]           <- FAIL-OPEN
DIFFER F1-odd-1-escaped-dquote    bash=["real-id"] counter=[]           <- FAIL-OPEN
DIFFER F1-even-2-escaped-dquote   bash=["real-id"] counter=[]           <- FAIL-OPEN
AGREE  F1-msg-odd-escape          bash=["real-id"] counter=["real-id"]
AGREE  control-plain-dquote-2line bash=["real-id"] counter=["real-id"]
```

**F1 and F2 are both independently CONFIRMED by me at `4ba3b01` as silent fail-opens**, and the plain
two-line double-quoted control agrees, so this is a specific defect and not blanket breakage. One of my
three F1 shapes agrees, so the exact shape matters more than the review's "any double-quoted awk
program" framing suggests — that narrows F1's *reachability* argument somewhat but not its direction,
its unboundedness, or the two-line cost. **The exception ruling stands, now resting on my own
measurements rather than on the review's.**

**Rule I am adopting for the rest of this plan:** never measure against the shared working tree while an
implementer is dispatched. Every adjudication measurement goes against `git archive <sha>` in `/tmp`
with `node_modules` symlinked, which is what I required of the reviewers and should have required of
myself. The failure mode was exactly this project's recurring one — a tool reporting a result whose
ground truth had moved underneath it — and it produced two wrong conclusions in a row before `git
status` caught it.

---

### Task 23 — fix round 6 (breaker exception): implementer report and my independent verification

**Commit `28ad7f0`** "fix(session): close two carried-quote regressions in countCheckpoints" —
3 files, +256/−12: `src/server/session.ts` +29, `test/server/checkpoint-oracle.ts` +188,
`test/server/session.test.ts` +51. Tree clean. Nothing touched under `content/`, `src/cli/`,
`objectives.yaml`, `content/lib/assert.sh`, `src/engine/grading/grader.ts` or `package.json`.

**Status: complete, not reverted.** The stopping rule was never triggered.

Implementer's numbers: typecheck 0; 29 files / **351 passed**, 0 failed, 0 skipped (baseline 349);
coverage 0 with zero `problem:` lines and `untaught concepts: 0`; six invariants unmoved; battery
**23 → 12 of 62 — 11 closed, 0 new**, reproducing the reviewer's number exactly. Closed: H1-H5, H9,
A1, A3, A4, A5, plus **A6**, the pre-existing over-count — one condition closed four under-counts and
one over-count. All ten controls agree before and after.

Per mandate: F1 done at `session.ts:292`. **F2 done, and it re-measured the premise before accepting
it** — its docstring was backwards, and its probe was better than mine: it inspected the contents of
`$x` (`a⏎ck inside d 0⏎b`), which show *which lines went into the word*, where I only checked emitted
ids. The docstring now records the measurement including `$x`. 18 rows promoted (6 H-family, 5 A-family
with A6 labelled fail-closed, 7 controls) plus two unit tests, so each edit is caught by two independent
instruments. Three disclosures landed without fixes, including `deprecated-arith-read-as-heredoc`
stating plainly that it refutes round 5's "widening can only fail closed" argument. Both reporting
defects corrected in place as block quotes at the offending sentences; for F6 it re-derived M-O/M-P/M-Q
as stated edits and re-measured rather than reconstructing from memory.

Mutation testing, each edit written down: **M-R** (F1's literal single-token revert) killed by all six
H-family rows; **M-S** (F2's literal condition revert) killed by all five A-family rows; **M-T**
(`escapes` forced to `true`) killed — so testing the quote *character* rather than passing `true` is
load-bearing. It discarded its first M-R attempt because that also altered the `quote` argument and so
was not a faithful revert — the same class of error as round 5's spaced pin, caught the same way.

**My independent verification at `28ad7f0`**, against a clean `git archive` in `/tmp/adj-28ad7f0` with
`node_modules` symlinked (both edits confirmed present first: `:292` computes
`carried.quote === '"' || carried.ansiC`; `:465` reads `if (open !== undefined && quoted === undefined)`):

- typecheck exit 0; **29 files / 351 tests passed, 0 failed, 0 skipped**; coverage exit 0, 0 `problem:`
  lines, `untaught concepts: 0`.
- **Six invariants unmoved**, standalone and prepended: `assert.sh` 0, 019=8, 014=5, 017=5, 028=5, 006=8.
- **Ten differential probes, 10 agree / 0 differ** — the three shapes that were silent fail-opens at
  `4ba3b01` now agree, and seven controls hold: plain 2-line `"…"` and `'…'`, the `echo 'it\'` ANSI-C
  asymmetry that is R1's fix, a multi-line single-quoted `awk` program then `ck` (N8), a heredoc then
  `ck`, and a two-`ck` baseline.

**Ruling: one scoped re-review, and still no round 7.** — The breaker caps *fix rounds*, not gates, and
five consecutive reviews of this function have each found a real defect that the whole suite passed
over. Skipping the gate on the one commit that changes this function's control flow would remove the
only instrument with a 5-for-5 hit rate, at the moment its own author has just told me the shape it
could not cover. Findings will be adjudicated and parked, never dispatched as a fix. — **Cost if
wrong:** one reviewer's time, and a parked-item list that grows by a few entries.

**Re-review dispatched** on Opus: context `task-23-rereview-6-context.md`, package
`review-4ba3b01..28ad7f0.diff` (23291 bytes). Six ranked items, the top two being (1) F2's
*unconditional* precedence of a carried run over a pending heredoc — the implementer's own named
uncovered case, the inverse nesting, where I asked for the **mechanism** behind "cannot arise today"
rather than the observation, because that argument decays as the bank grows to 28 chapters; and
(3) **the zero-checkpoint hole** — its closing concern that A6 now agrees with bash on a script that
silently grades nothing, and that possibly nothing in scope detects a grader emitting nothing. If
`expectedTotal === 0` is indistinguishable from "no checkpoints reached", that is a false pass needing
**no lexer defect at all**, and it would be the most serious thing found on this task.

**Implementer's own answers.** No disagreement with either edit. Highest-severity remaining item is
`! ck` and the command-prefix family (P19) — silent fail-open, and the cost is *smaller* than round 5
reported: one character closes `! ck` with zero collateral. Out of scope by ruling; first thing any
future work should do. Second is the lexical-state lifetime split (P20), now named in the docstring as
the seam the next defect most likely arrives through. Its stated concern is that **the finding is the
process**: both regressions were invisible to 349 tests and to the reviewer's fuzzer, and were found
only by reading the diff — and F1 was fixed by *duplicating* the expression, since extraction is parked,
which leaves the same latent drift shape (P18). Its final paragraph arrived truncated; I have asked for
the remainder plus the mechanism behind the "cannot arise" claim and the `expectedTotal === 0` question.

### Two corrections from the round-6 implementer, both verified by me. One of them corrects my own claim.

**1. The inverse-nesting mechanism — confirmed, and it is stronger than "unreachable today".**
`quoted` is declared at `session.ts:461` with **exactly one** assignment, `quoted = scanned.open` at
`:480`, and that sits *after* the heredoc-body branch's `continue` at `:474`. A line consumed as heredoc
body takes the `continue` and never calls `scanLine`, so it cannot return an `open` and cannot set
`quoted` — the body is opaque by construction, which is correct, since its content is text the grader
prints rather than code. Therefore the state pair "`pending` non-empty **and** `quoted` set" has exactly
one producer: a single line that both opens a heredoc and leaves a quote open, because `scanLine`
returns `heredocs` and `open` from the same call. That is the A-family, which is why F2's precedence rule
only ever has to arbitrate that one arrangement.

I confirmed the structure myself by reading `28ad7f0`. **This is a control-flow property, not a property
of the bank**, so unlike "no `<<` in the counted text" it does **not** decay across 28 chapters of new
graders. What would re-open it is narrow and nameable: a future change that routes heredoc-body lines
through `scanLine` for any other reason. The guard is `grep -n 'quoted' src/server/session.ts` — one
assignment, after the `continue`. Parked with that trigger condition rather than as a shape count.

**2. `expectedTotal === 0` — MY CLAIM WAS WRONG about the mechanism. Corrected.**
I wrote, in the round-6 brief and in this ledger and to the user: "`expectedTotal` collapses toward 0,
`incomplete` goes false, and a grader that died on its first command reports the lab passed to a student
who changed nothing." The implementer measured it, corrected itself and me, and I verified the decisive
line: **`allPassed` (`src/engine/grading/verdict.ts:81`) is `v.checkpoints.length > 0 && every(pass)`.**

| scenario | `incomplete` | `allPassed` |
| --- | --- | --- |
| real total 8, counter collapsed to 0, nothing arrived | false | **false** |
| real total 8, counter collapsed to **1**, that 1 passed | false | **true** ← the false pass |
| real total 8, counter correct at 8, only 1 arrived | **true** | false |

So `incomplete` genuinely cannot distinguish a legitimately-zero grader from a counter that swallowed the
file — both give `false` — but `allPassed`'s length guard is the backstop against a **total** collapse.
**The false pass requires a PARTIAL collapse**: the counter landing on a small nonzero number that the
surviving checkpoints satisfy, which is reachable precisely when the swallowed run starts partway down
the file. Direction and severity of F1/F2 are unchanged; the stated mechanism was overstated.

That overstated sentence is now propagated into **four places**: the F1 code comment in `session.ts`, the
`28ad7f0` commit message, and both the round-5 and round-6 reports. This is the **N5/R7/N9 false-disclosure
class for the sixth time on this task**, and it is the version that matters most, because "zero
checkpoints is undetectable" would send a future round after the wrong field entirely.

**Ruling: the comment correction is parked for the whole-branch review's single fix dispatch, not granted
as another exception.** — It is doc-only; the code is correct and verified; the whole-branch review
already has one fix dispatch budgeted by the skill and will touch `session.ts` regardless. Granting a
second exception two hours after spending the first is how an exception becomes a round, and the reason
the breaker exists is that this function has produced a new defect in every round that touched it. —
**Cost if wrong:** a wrong mechanism sits in a code comment until the whole-branch fix, where a reader
could chase `incomplete` instead of `allPassed`; bounded because the correct mechanism is now recorded
here, in `whole-branch-parked.md`, and in the re-review's context.

Both forwarded to the in-flight re-review **as claims to test, not conclusions**, with the explicit
instruction to contradict them if the middle table row does not reproduce through `reportFor` — I have
now built two rulings on that row and have only read the code, not run it.

**A shared lesson worth keeping, in the implementer's framing and mine.** Its discarded M-R mutant
altered the `quote` argument as well as the token, so it was not a faithful revert. My probe batch ran
against the live working tree mid-edit, so I measured its in-progress fix and believed the number. Same
failure: **measuring something adjacent to the thing you meant to measure, and believing it.** The cheap
guard is `git archive <sha>` (or at minimum `git status` before a probe batch); the expensive version is
what we both did.

---

### Task 23 — re-review 6: CHANGES REQUIRED, adjudicated and parked. The breaker stays spent.

Verdict **CHANGES REQUIRED** at `28ad7f0`. Both shipped edits are correct and the reviewer could not
break either. The verdict rests on a disclosure **this commit added** whose stated direction measurement
refutes. Gates re-run by the reviewer and independently by me: typecheck 0, 29 files / 351 passed,
coverage 0 with 0 `problem:` lines and `untaught concepts: 0`, **six invariants unmoved** (0/8/5/5/5/8)
standalone and prepended, no banned syntax outside comments.

**Mutants: M-R, M-S and M-T each die under both instruments and each discriminates** — M-R kills exactly
the 6 H-family rows, M-S exactly the 5 A-family rows, M-T exactly one (`carried-sq-keeps-backslash`).
M-R verified a faithful single-token revert by `diff`. **But 7 of 16 promoted rows survive reverting both
edits** — all 5 controls plus 2 unrelated. And the count was **16 rows / 5 controls, not the 18 / 7 the
report claimed.**

**The sixth review of this function found real defects, exactly as its 5-for-5 base rate predicted.** My
ruling to gate rather than skip was correct; had I skipped it, four measured fail-opens and two wrong
parked directions would have gone into the branch review unflagged.

**Four findings I re-measured myself at `28ad7f0`** (clean `git archive`, per my own rule):

```
DIFFER F-A arith-across-newline   bash=["real-id"] counter=[]  <- FAIL-OPEN
AGREE  F-A control-same-line      bash=["real-id"] counter=["real-id"]
DIFFER F-C subscript-shift        bash=["real-id"] counter=[]  <- FAIL-OPEN
DIFFER F-C assign-subscript       bash=["real-id"] counter=[]  <- FAIL-OPEN
DIFFER F-C substring-shift        bash=["real-id"] counter=[]  <- FAIL-OPEN
DIFFER F-B ansic-delimiter        bash=["real-id"] counter=[]  <- FAIL-OPEN
019 baseline 8; inject 'x="a' -> 0; inject 'cat <<NOPE' -> 0  (both also 0 at assert.sh's position)
```

**Adjudication — every finding parked, none dispatched. Ruling: the exception is spent and stays spent.**
— A second exception granted the same day the first was spent is not an exception, it is round 7 under
another name, and the breaker exists because this function has produced a new defect in every round that
touched it. Six rounds, eight defects, and round 6 itself shipped a disclosure with the wrong direction
while closing two regressions. Nothing found reaches the bank today; every item is now recorded with a
measurement rather than a recollection. The whole-branch review has one fix dispatch budgeted by the
skill, and that is the right vehicle — it is the pass that can also do P18, which is what actually stops
this recurrence. — **Cost if wrong:** four fail-open shapes and two wrong disclosure directions sit in the
tree for two more tasks; bounded because none is reachable, all are written down, and Task 24/25 do not
touch `session.ts`.

New parked entries, all measured:

- **P24 — now the top item on the parked list, and it needs no lexer knowledge.** One injected line takes
  019 from 8 to **0**, and at `expectedTotal === 0` `incomplete` can never fire
  (`session.ts:569`, `:591`), so **any nonempty all-passing prefix reports `allPassed: true`.** The
  "nothing arrived" case is safe via `verdict.ts:81`'s `length > 0` guard; **the dangerous case is a
  passing prefix**, which is exactly what a truncated grader produces. My earlier table looked at the safe
  row. I also found something the reviewer did not: **`session.ts:579-584` already `console.warn`s
  "countCheckpoints under-counted this grader"** on over-arrival, so every instance announces itself to a
  log nobody reads. My recommendation is two parts and beats guarding zero alone: (1) refuse to create a
  session at count 0; (2) promote that warning to a **report field** so the UI can flag the result as
  unreliable **without** failing the student — preserving the deliberate `:571-578` decision not to fail a
  correct run over a bad count.
- **P25 — `arith` resets across the newline: silent FAIL-OPEN, and I had the direction backwards.**
  `x=$((` / `1 << 2 ))` / `ck` → bash 1, counter 0; same expression on one line agrees. I parked this as
  fail-closed in P20 and round 6 disclosed it as fail-closed. **Both wrong.** Closest thing on the list to
  reachable: `$(( ))`/`(( ))` appear 6× in the counted text **including `assert.sh`**, which is prepended
  to every grader.
- **P26 — the arithmetic class is CURRENT syntax, not deprecated.** `${a[i << 1]}`, `a[1 << 1]=x`,
  `${s: 1 << 1}` are all silent fail-opens. The disclosure frames the class as "`$[ ]`, deprecated since
  bash 2", which is a false disclosure of the same N5/R7/N9 kind — the seventh on this task.
- **P27 — a THIRD `closingQuote` call site, already wrong.** `heredocDelimiter` (`session.ts:190`) computes
  `escapes` a third way; bash *does* ANSI-C-dequote a delimiter, so `cat <<$'EOF'` is a silent fail-open
  (measured). This is the direct answer to the question I put to the reviewer, and the third measured
  instance of the drift **P18** removes by construction. **P18 is no longer optional in my judgement:**
  three sites computing one predicate three ways, in a function with eight defects in six rounds, is a
  structural defect, not a style preference.

Also parked: **P22** (my overstated `expectedTotal` mechanism, propagated into four places — doc-only),
**P23** (F2's precedence rests on a control-flow property with a named re-open trigger), and the reviewer's
F-E/F-F/F-G/F-H (row-count overstatement 18→16, two weak controls, F6's under-specified mutant edit, F2's
wrong justification) plus F-I (fail-closed: unterminated quote in a delimiter word; `\` on an opener line).

**Task 23: complete.**

## Task 24 — dispatch

BASE = `28ad7f0` (recorded before dispatch; tree clean, 351 tests green).
Implementer dispatched on **Opus**, agent `task-24-impl`.

Model ruling: Opus, not a cheaper tier. Reason — Task 24 is the user's actual
learning surface (the whole app exists to be this screen), it installs six new
dependencies from scratch, mandate 6 is a React effect-dependency defect that
requires reading the reconnect lifecycle rather than transcribing a code block,
and mandates 4/5/10.5 require measured judgment against the brief's own code.
Cost if wrong: a more expensive implementer than needed on a 1179-line brief.

Requirements: `task-24-brief.md` (1179 lines) as the source of exact values;
`task-24-mandates.md` (638 lines) as corrections that **override** the brief on
conflict. Report: `task-24-report.md`.

Interfaces carried into the dispatch that the brief cannot know:
- the six deps (`react`, `react-dom`, `@testing-library/react`, `jsdom`,
  `tailwindcss`, `@xterm/xterm`) are genuinely absent from both `node_modules`
  and `package.json` — verified this session; `vite` is present. Installing them
  is Task 24's scope; no earlier task owns them.
- `GradeReport` fields are `passed`, `total`, `expectedTotal`, `incomplete`,
  `allPassed`, `rebooted`, `regressionCount` — and there is **no `phase`**
  (mandate 9).
- mandate 10.5 governs how truncation and count-suspicion reach the screen.
- Task 23 closed on `src/server/session.ts` after six rounds; that file,
  `src/engine/grading/`, `content/`, `objectives.yaml` and `content/lib/assert.sh`
  are out of bounds for this task.

Parked findings pointed at in the dispatch area: P24 (the zero-count amplifier)
is the reason mandate 10.5 exists; the implementer is told not to add a
`countSuspect` field because P24 owns that decision at the whole-branch review.

Three questions the report must answer: whether any mandate is wrong when
measured (three of my Task 23 mandates were), what on this screen could tell the
user they passed when they did not, and which change is most likely to be the
first defect found in review.

## Task 23 — post-closure addendum. The round-6 reviewer resent its result; two items were new.

Task 23 stays **complete**. Nothing below reopens it. Read the full review at
`task-23-rereview-6.md`; I read §3a, F-D and F-J off disk rather than take the
resend at face value.

**1. My correction was itself wrong, in the opposite direction. Second
mis-stated mechanism I built a ruling on.**

I had written *"the false pass requires a PARTIAL collapse"* — meaning
`allPassed`'s `length > 0` guard is the backstop against a total collapse of
`expectedTotal`. Measured through `reportFor` at `28ad7f0`: real 8 / counter
**0** / 1 arrival passing → `incomplete false`, `allPassed` **TRUE**. So the
guard is not about the count at all; it guards against **zero arrivals**, a
property of the *run*. The count collapse and the grader's truncation are
independent events and my three rows conflated them. A collapse to 0 is the
**widest** hole, not the safe one — it disarms `incomplete` for every nonzero
arrival count.

The correct condition, replacing both of my wrong versions:
**`arrivals >= expectedTotal` AND `arrivals >= 1` AND every arrival passed AND
`arrivals < real total`.**

And the original sentence was wrong more narrowly than I said: *"died on its
first command"* names the one arrival count `allPassed` **does** catch. Died on
its second is the false pass. Measured end-to-end on a real F-A collapse
(eight-`ck` grader, `limit=$((` / `1 << 2 ))`, counter 2): after `ck one` →
caught; after `ck two` → FALSE PASS; before emitting → caught. A collapse to 2
catches the 1-arrival death; a collapse to 0 would not.

`Ruling: fold the corrected condition into P22 in place and mark the earlier
correction as superseded rather than deleting it — why: two opposite wrong
mechanisms in the same paragraph is the exact history a future reader needs, and
a clean paragraph would let round 7 rediscover it — cost if wrong: a longer
parked entry.` Done: P22 now carries the block-quoted condition and the
instruction to fix wording from **that**, not from the paragraph above it.

**Consequence for Task 24, checked before letting the dispatch stand.** Mandate
10.5(b) fires the count-suspicion warning on `total > expectedTotal`. At a
collapse to 0 with 1-2 passing arrivals, `status.size > expectedTotal` is true —
so the warning fires on exactly the inverted case, and `session.ts:579`'s
existing `console.warn` confirms it does. The case it misses is
`arrivals == expectedTotal`, a counter under-counting by precisely the truncation
amount; but every heredoc fail-open measured in this function **zeroes**
`expectedTotal` rather than deflating it (P24's table), so that case is not
reachable from the measured class. **Mandate 10.5 covers the whole of it and
needs no change — the Task 24 dispatch stands as sent.** Recorded in P22 so the
whole-branch review cannot reason from the wrong mechanism and call the warning
redundant.

**2. F-J — new finding, and it corrects where I told the reviewer to look.**

I reported P22's wrong sentence had propagated into the F1 code comment in
`src/server/session.ts`. Measured: it had not. `session.ts:286-292` is accurate
and the `28ad7f0` commit message is clean. The one copy in the tree is the
H-family header comment **`28ad7f0` added** to
`test/server/checkpoint-oracle.ts:530-532`, whose final clause is false per the
above. Sixth occurrence of the N5/R7/N9 false-disclosure class, and the file is
the one a future lexer author reads to learn the failure modes — whose own rule
is "where a shape has two faces, pin both."

`Ruling: park as P28, do not dispatch — why: Task 23 is closed and its one
breaker exception is spent; a false comment in a test-support module cannot
produce a wrong truth-claim to a student, so it does not clear the bar that
bought the exception, and opening a round for a sentence is round 7 under another
name — cost if wrong: a future lexer author reads a wrong failure-mode note for
one review cycle.` P28 carries the replacement text so the whole-branch fix
dispatch applies it mechanically, and corrects P22's own file list (one of its
four entries was wrong).

**Standing observation.** Three of my own stated mechanisms on this task have now
been measured wrong by someone I dispatched — the `}`-as-comment claim, the N14
numbers, and this one twice over. Each was reasoned from code I had read and each
was refuted in one measurement. The rule that keeps earning: state the mechanism,
then have someone run it.

## Task 24 — implementer report received, review dispatched

**Status: DONE_WITH_CONCERNS.** Commit **`7dbaaf4`** on `phase-0-1`, 15 files, +3512/−44,
staged by name, `git status --porcelain` empty — verified by me. Tests **379/31**
claimed (baseline 351/29), typecheck 0, `build:web` 0, nothing left listening.
Report at `task-24-report.md` (718 lines).

**Headline, and it is the project's defect class exactly.** The implementer wrote
a comment reading *"Deliberately no `@vitest-environment jsdom` here"* — and the
comment **switched the file to jsdom**, because vitest regex-scans the source and
does not care that the surrounding sentence is a denial. Mandate 8's entire stated
benefit was silently defeated by the comment claiming it. Caught only by an
assertion it added beyond the brief (`expect(typeof globalThis.window)
.toBe('undefined')`), which failed with `expected 'object' to be 'undefined'`.
Fixed, assertion kept. A thing reporting one state while being in another, caught
by measurement rather than reasoning — exactly the class that produced eight
`countCheckpoints` defects.

**Mandate 9's premise was mine and it was wrong. Verified the refusal myself.**
I wrote that `GradeReportView.phase` doesn't exist. `/grade` **does** return
`phase` — `src/server/app.ts:287-291` spreads `reportFor` and adds `phase`/`rung`;
I read it at `7dbaaf4` and confirmed. The implementer kept `phase` off
`GradeReportView` and added `GradeResponse extends GradeReportView { phase; rung }`
plus `FinishResponse`. Correct resolution: the type `reportFor` returns has no
`phase`; the endpoint's response body does. **Fourth of my own mandates refuted by
measurement on this project.** Mandate 3 and 10.4(b) were CONFIRMED with no change
needed — also the right answer, and also measured rather than assumed.

**Ruling on the DONE_WITH_CONCERNS status.** The skill says address correctness
concerns before review. Concern 1 is a correctness concern: `App.tsx` has no test
because `createApi()` at module scope makes it un-fakeable, leaving five
mandate-required behaviours unmeasured — the key-handler gate, `doFinish`'s
`setError(null)`, the concept fetch, the timer stopping at finish, and its own
`setReport(undefined)` false-pass fix.

`Ruling: carry concern 1 into the review as directed target 1 rather than dispatch
a pre-review fix round — why: the five behaviours are precisely named and
tsc-clean, so what I need is a reviewer's judgment on which are load-bearing, not
a reflexive coverage demand; pre-empting that spends a fix round on scope the
reviewer might narrow, and the fix budget is 5 — cost if wrong: one extra round if
the reviewer finds all five need tests, which is the same cost as doing it now.`
Concerns 2-7 are observations (no browser on this host, bundle size, terminal dies
on reset per the brief's own design ruling, `report.regressions` ids unrendered)
and are noted, not blocking.

**Review dispatched on Opus**, agent `task-24-review`. Model ruling: most capable
tier. Reason — 156668-byte diff, an entire new subsystem, six new dependencies,
and the false-pass surface is in it. A cheaper reviewer on this diff is the wrong
economy on the one screen the user ever sees. Instructions in
`task-24-review-context.md`; package `review-28ad7f0..7dbaaf4.diff`.

Seven ranked directed targets, most-likely-finding first: (1) the five unmeasured
`App.tsx` behaviours, each to be ruled correct-or-not individually; (2) verify the
jsdom-comment fix bites by mutating it back, then hunt the sibling class — prose
that changes behaviour, config asserted in comments rather than code; (3) the
mandate-9 type split against every consumer, since a response type claiming a
field the server omits is a compiler-blessed `undefined`; (4) the **unmandated**
changes, as the highest-risk category because nobody specified them — two claimed
false-pass fixes, `verdictFor`, the re-keyed `DOT`, `persistenceUntested` — plus
whether any of them changes what a student sees on a **correct** run, since a false
fail teaches the wrong lesson as surely as a false pass; (5) `vite.config.ts`
importing a value from `src/server/config.ts`; (6) mandate 10.5(b)'s two tests,
neither of which may be a crash test; (7) the six new deps and the
`@vitejs/plugin-react@^5.2.0` pin, confirming no `--legacy-peer-deps`.

The context file carries the corrected `incomplete` mechanism from P22 verbatim, so
the reviewer cannot reason from either of my two wrong versions.

## Task 24 — review verdict, and fix round 1 dispatched

Review at `task-24-review.md` (329 lines), on Opus, range `28ad7f0..7dbaaf4`.

**Spec compliance: APPROVED.** Every mandate (1-9, 10.1-10.5) and every brief step
implemented with the specified values, component names, copy strings, and all 16
prescribed test names verbatim. Both disclosed deviations defensible. Gates
re-run, not cited.

**Task quality: CHANGES REQUIRED.** One load-bearing false fail, one
mutation-proven test gap.

**The finding that matters, and where it came from.** F1: `App.tsx:41` derives
`finished` from `rating !== null`, but `app.ts:315` returns `rating: null` for
guided. So mandate 7's entire guard is **inert in the one mode a beginner uses
first** — no confirmation box, Grade/Reset/F2/F4/F8 stay live, the clock runs on
until the rail says "over budget", and a second F4 hits the 409 whose
`setReport(undefined)` wipes the earned "5 / 5 passed" off the screen. Direction
**false fail**, load-bearing, measured with two probe tests. The scenario: a
beginner solves a guided lab in four minutes, reads the concept cards, and is told
they went over a ten-minute budget.

**Note where F1 lived: in the exact five behaviours the implementer disclosed as
unmeasured.** My ruling last turn was to carry that concern into the review as a
directed target rather than pre-empt it with a fix round. That ruling paid — the
reviewer read all five, found items 2/3/5 correct and items 1/4 broken *in guided
only*, which a blanket "add coverage" dispatch would have produced more slowly and
less precisely. But the lesson runs the other way too, and I am recording it: the
untested surface was where the defect was, first time asked.

**The disclosed blocker was not real, and that is the reusable finding.**
`vi.mock('../../src/web/api.ts', …)` **hoists above** `App.tsx`'s module-scope
`createApi()` and the fake reaches `App`. The real blockers were two jsdom stubs —
`matchMedia` (xterm) and `WebSocket`. The reviewer wrote the working recipe into
`task-24-review.md:301-318` with two gotchas: `TaskPicker`'s Start button is
disabled for one render tick after the task list arrives, and the mode buttons'
accessible name includes the blurb so match `/^Guided /`. This is about to be the
pattern every later UI test in the project copies.

F2: mutant M8 swaps the emerald `All checkpoints passed.` for the rose
`Not all checkpoints passed.` and **all 28 web tests still pass**, because both
positive assertions are `getByText(/all checkpoints passed/i)` and the fail copy
satisfies that regex as a substring. Negative assertions are fine, so the gap is
one-directional — in the only direction that tells a student who solved the lab
that they did not. Two-line fix.

F3: `TerminalPane.tsx` has no test at all; mandate 6's `statusRef` fix is correct
but unmeasured, and it is precisely a latent-caller bug.

**Rulings.**

`Ruling: derive finished from phase === 'graded', not from a mode === 'guided'
special case — why: finished is a property of the session's phase, rating is
mode-dependent by design, so keying the guard to phase makes it mode-independent
and the next mode added cannot silently reopen this hole — cost if wrong: one more
field read in the finish handler.`

`Ruling: require tests for App items 1, 4 and 5 plus one TerminalPane test, over
the reviewer's "recommended, not blocking" — why: F1 is a load-bearing defect that
existed precisely because items 1 and 4 were unmeasured, so treating the same
surface as optional a second time is choosing to be surprised again; the blocker
that justified skipping them is disproved and a working recipe is in hand, which
makes this cheap now and expensive later — cost if wrong: an hour of test-writing
on code that was already correct.`

`Ruling: park F4 for the whole-branch review alongside P24 — why: when verdictFor
returns null the rail says "This is not a score" yet Finish stays enabled and
derives a rating from report.allPassed (false for a truncated run), but disabling
Finish there would trap the student in a session with no way to close it, no
mandate asked for it, Phase 0/1 does not schedule off the rating yet, and the real
fix is a countSuspect-aware finish path whose field mandate 10.5(b) explicitly
parks — cost if wrong: one early rating shaped by a timed-out grader in a phase
that does not read ratings.` Agrees with the reviewer's own recommendation.

**No mandate was found wrong this round** beyond mandate 9, already corrected. The
reviewer checked the mandate-9 type split field-by-field against all nine consumers
and confirmed no type claims a field the server omits. `persistenceUntested` was
proven unreachable from `grader.ts:82-116`, so none of the unmandated changes can
fire on a correct run. 18 of the reviewer's 20 mutants died. Step-16 handoff ruled
good enough for Task 25 to act on.

**Fix round 1 of 5 dispatched** — resumed the same implementer (`task-24-impl`),
per the skill's rounds-1-3 rule. Brief at `task-24-fix-1.md`. Required: F1, F2,
tests for App items 1/4/5, one `TerminalPane` test. Parked: F4. It must re-run M8
and the F1 probe and report both as measured. One question asked: did the App-test
recipe work as written, or is there a third blocker.

## Task 24 — fix round 1 returned DONE; scoped re-review dispatched

Commit **`d0ff66b`** (base `7dbaaf4`), 5 files staged by name, `git status --porcelain`
empty, nothing listening — verified by me. Tests **386/33, 0 skipped** (was
379/31), typecheck 0, `build:web` 0, still exactly one `as` cast
(`src/web/api.ts:201`), no banned syntax.

All six required items reported landed: F1 (`finished` is now state set from
`setFinished(done.phase === 'graded')`, key handler and deps read `finished`,
`doReset` reads the phase back from the reset response, rating box keyed to
`finished` with a guided arm explaining why there is no rating), F2 (both positive
assertions anchored plus a negative on the rose copy), App items 1/4/5, and F3
(three `TerminalPane` tests, not one — construction count, a staleness control so
the ref must stay *current* rather than merely stable, and a size-change control so
an empty dep array cannot satisfy the other two).

**The measurement quality is the notable part.** M8 now dies with 3 failures where
it previously gave zero. The F1 probe kills all three guided tests — and the
implementer noticed that all three die at the *same early assertion*, which proves
less than three separate deaths, so it isolated two narrower mutants on its own
initiative: the timer gate alone prints `expected '10:01 / 10:00' to be
'00:04 / 10:00'` — the user-visible defect, on a lab graded 5/5 — and the key gate
alone gives `expected 2 to be 1`, a second `finish()` getting through. That is the
right instinct and it is the one I would have asked for.

**One unrequested change, and its argument is good.** It narrowed
`SessionView.phase` and `GradeResponse.phase` from `string` to the server's
`SessionPhase` via a type-only re-export, because under `string` the mutation
`=== 'gradedd'` compiles clean and the guard silently never fires — **the same
never-fires shape as the defect being fixed**. Flagged to the re-review as the item
to check hardest, since unrequested changes remain the highest-risk category here.

**The recipe worked essentially verbatim**, and the implementer added three notes
for whoever copies it — the pattern every later UI test in this project will follow.
The one worth repeating: `const shapeCheck: ReturnType<typeof createApi> = fake`,
because **`vi.mock`'s factory is not checked against the module it replaces**. Also:
build expected WebSocket URLs from `window.location` rather than pinning a literal
(jsdom's host is `localhost:3000`, and its first assertion failed on exactly that),
have the fake echo the requested mode back so a test asking for guided cannot be
handed a practice session, and jsdom's `HTMLCanvasElement getContext()` "Not
implemented" line on any file mounting `TerminalPane` is harmless — silencing it
needs the native `canvas` package, a bad trade.

**Its own closing line, recorded because it is the lesson of this round:** round 1's
disclosure that `App.tsx` was untestable "was a conclusion from reading rather than
trying, and the cost was exact — the one part of the diff I called unmeasurable is
the one that shipped a load-bearing defect, in the mode a beginner uses first."

**Scoped re-review dispatched on Sonnet**, agent `task-24-rereview1`. Model ruling:
mid tier, not Opus. Reason — 30469-byte fix diff against a named finding list, and
the work is reproducing specific stated mutants rather than open-ended judgment;
the skill puts scoped re-reviews of small fix diffs at cheap-to-mid. Instructions
in `task-24-rereview-1-context.md`; package `review-7dbaaf4..d0ff66b.diff`.

Its central instruction: not "does this read correctly" but **"does the new test
actually fail when the code is wrong"** — because a test added to close a finding
that passes either way converts an open defect into a certified one, which is worse
than the finding.

## Task 24: complete

Re-review of fix round 1 (`7dbaaf4..d0ff66b`, Sonnet): **APPROVED, no new findings.**
Real repo untouched throughout, HEAD stayed `d0ff66b`, all mutation work done and
cleaned up in `/tmp/t24r1`.

All six required items landed **and every test bites, measured**: F1's probe kills
all three guided tests; M8 now fails 3 where it previously failed 0; the key-gate
isolation gives `expected 2 to be 1`; the timer-gate isolation gives
`expected '10:01 / 10:00' to be '00:04 / 10:00'`; putting `onStatus` back in
`TerminalPane`'s deps opens 3 sockets where 1 is expected. Both F1 isolations
reproduced verbatim with the exact claimed messages.

**The reviewer closed a gap in the implementer's own evidence, and this is the part
worth keeping.** For App item 5 the report cited M8 as proof — but M8 trips an
*earlier* assertion in the same test, not the stale-tally logic itself. So the cited
evidence did not actually exercise the mechanism it claimed to. The reviewer mutated
the `setReport(undefined)` line directly and confirmed the test dies on its own
mechanism (`expected <div>... to be null`), establishing the item is independently
load-bearing rather than incidentally covered. Not a defect — a citation that proved
something adjacent to the claim. **That is the same shape as my own moving-tree error
on Task 23 and the round-6 implementer's discarded two-change mutant: measuring
something next to the thing you meant to measure and believing the number.** Third
occurrence on this branch, now caught by a reviewer unprompted.

**The unrequested `SessionPhase` narrowing is sound**, verified rather than accepted:
erasure is compiler-enforced (`verbatimModuleSyntax: true` plus `import type` /
`export type`, not merely tree-shaking), the `'gradedd'` typo gives **TS2367** under
the narrowed type and compiles clean under `string` — both reproduced — it constrains
exactly 2 call sites, both already using valid literals, and the bundle-purity greps
are still 0.

Gates: typecheck 0; vitest **386/33, 0 skipped, 0 todo**; `build:web` 0
(743.72 kB / 206.29 kB gzip, normal hash variance from the report's 745.34/206.34 —
the reviewer noticed and dismissed it correctly). Whole-repo grep: no `enum`,
`namespace`, decorators, parameter properties or non-null `!`; exactly one cast in the
web layer (`api.ts:201`); no `as unknown as` anywhere.

Out-of-scope confirmed untouched: F4, `session.ts`, `src/engine/grading/`, `content/`,
`objectives.yaml`, `content/lib/assert.sh`, Step 16's fifteen checks. The diff's file
list is exactly the 5 files claimed and no `countSuspect` field exists anywhere in
`src/server/`.

Both verdicts recorded: **spec compliance APPROVED** (task review), **task quality
APPROVED** (re-review, after one fix round). Fix budget used: 1 of 5.

Carried forward to the whole-branch review: **F4** (Finish stays enabled on a run the
rail refused to score, then derives a rating from `report.allPassed`) — parked with
**P24**, since the real fix is a `countSuspect`-aware finish path.

## Task 25 — dispatch. The last task; nothing forwards past it.

BASE = **`d0ff66b`** (recorded before dispatch; tree clean, 386/33 green).
Implementer dispatched on **Opus**, agent `task-25-impl`.

Model ruling: Opus, not a mid tier despite this being largely documentation.
`Ruling: pay the top tier for Task 25 — why: mandate 11's `rhcsa lint` is a gate
whose entire job is reporting whether the content bank is okay, which is precisely
the project's recurring defect class (a tool reporting success when it did not do
what was asked, eight silent countCheckpoints defects over six rounds); a lint that
passes because its regex matched nothing is worse than no lint, and it is the last
code written before the whole-branch review, with mandate 8 requiring re-measurement
of each row rather than transcription — cost if wrong: a more expensive implementer
than needed on a 516-line brief.`

Requirements: `task-25-brief.md` (516 lines) plus `task-25-mandates.md` (882 lines,
12 mandates and addenda) as overriding corrections. Report: `task-25-report.md`.

Interfaces carried into the dispatch that the briefs cannot know, all post-dating
them: Task 24's `src/web/`, `test/web/`, `npm run build:web`, the six new deps and the
`@vitejs/plugin-react@^5.2.0` pin (do not "fix" it); the **386/33/0-skipped** baseline;
`GradeResponse extends GradeReportView { phase; rung }`, `FinishResponse`, and the
type-only `SessionPhase` re-export; and that the Lab screen derives `finished` from
`phase === 'graded'` rather than `rating`, because `/finish` returns `rating: null` in
guided mode — a measured false fail, now fixed.

**Task 24's fifteen manual checks were handed to Task 25 explicitly**, with the
instruction to fold them into its checklist rather than write a parallel one, because
a second list is how a check gets lost. Pointer given to the `## Step 16` section of
`task-24-report.md`, including that check 15 is the foreign-origin refusal check in a
real browser and that checks 12-13 (persistence) and 9-11 (masking) are the ones
flagged as most likely to rot unnoticed.

Rulings carried: every VM-dependent step is blocked on the user's own ISO download and
must be written, marked NOT RUN with the reason, and neither invented nor quietly
dropped — a blocker is not to be softened into a caveat. Parked items named as
out of bounds so the last implementer cannot absorb them by accident: **P28** (the
false comment at `test/server/checkpoint-oracle.ts:530-532`) and **P24** (no
`countSuspect` field). Mandate 1 restated: do not create the `phase-1` tag, step 9 is
the user's.

Three questions the report must answer: whether any mandate is wrong when measured
(four of mine have been refuted across this project, each refusal preventing a
defect); **whether `rhcsa lint` could report a clean bank that is not clean, shown by
a mutation — bad content in, non-zero exit out**; and what a new reader of the README
gets wrong on their first attempt, written for someone whose whole plan is to learn
from this app instead of a book, on a machine where the VM does not exist yet.

## Task 25 — implementer report received, review dispatched

**Status: DONE_WITH_CONCERNS.** Two commits: **`e50cd3e`** ("feat(cli): add rhcsa
lint, the content gate that needs no VM") and **`ccdba26`** ("docs: the Phase 1 exit
criterion, as a blank form and an e2e test"). Tree clean; `git tag -l` **empty** —
mandate 1 respected, I checked. Tests **408/35, 0 skipped** (from 386/33, +22 in 2
files); typecheck 0, `build:web` 0, `lint:content` 0 with empty stderr.

The concern is the honest one: **Phase 1's exit criterion is not met**, because every
VM step is blocked on the ISO, and the artifacts say so in their own text rather than
in a report someone has to go find. RUN: steps 1, 5, 6 (file), 7, 9 (commit only).
NOT RUN: step 2 (written, VM-gated, never executed), steps 3, 4, 8 (no VM), step 9's
tag (mandate 1, the user's).

**Two mandates measured wrong. Both refusals look right and both are being verified.**

*Mandate 7 was wrong in a way that lands on the happy path.* I claimed values
containing spaces survive intact; for **unquoted** values they do not. Under dash,
the value word-splits, the shell tries to execute the path tail, the variable is left
**empty**, execution continues, and it **exits 0** — while
`node --env-file-if-exists` reads the same line correctly. So an unquoted VMX path in
`.env.local` yields a working server and a `test:vm` that fails for an
unrelated-looking reason. **This is not an edge case:** `vmrun.exe` lives at
`/mnt/c/Program Files (x86)/...` and the user's own VM path has two spaces, so every
user hits this line. It promotes mandate 9 item 3 from a tidiness note to a
load-bearing warning, and the README now names which loader breaks.

*Mandate 9 item 7 is refused, with a better defect offered in its place.*
`r1-probe.sh:187` does classify exit 124 explicitly into `unreachable`/`dropped`;
`unknown` is only the final `else` at `:221`, so my note was wrong. The real defect is
that the `*)` arm at `:258` prints **"R1 CONFIRMED AS A PROBLEM"** for `unknown` too —
a false fail against the user's own network, and R1 (WSL2 → VMnet8) is still
unverified, so that string is what the user reads on their first attempt. Recorded
rather than fixed. Three citation drifts corrected at point of use; mandate 8's
`ladder.ts` cite corrected `:75/:76` → `:82/:83`.

**Mandate 7's measurement was refused** (the implementer declined to change
`config.ts`, which the mandate itself forbade). Mandate 3 reported "done but
superseded — zero live pipe-then-status sites", added anyway for the reader's own
edits. Mandate 6's card floors measured 1811/1766 against the mandate's 1814/1773,
attributed to trimming.

**The lint's own answer to "can it lie": proven by mutation, not asserted.**
Unmutated copy exit 0 → four plants (undeclared id, duplicate header, variable id,
non-kebab id) each exit 1 with a named problem → restored copy exit 0. Committed
**negative** tests prove `ck $x` in a heredoc body, in a comment and in a quoted
string are *not* flagged — which is what reusing the probe buys over a sixth regex.
Stated limit: it checks ids *agree*, not that a grader is correct. Only `validate`
does that, **and `validate` has never run against a guest in this project's history.**

`Ruling: proceed to review on DONE_WITH_CONCERNS rather than address the concerns
first — why: all three concerns (the e2e test has never executed and its
checkpointTotal/rating are predictions from reading content; masking and persistence
are checklist items rather than tests; validate has never met a guest) are consequences
of the ISO blocker and not defects the implementer could close here, and the
implementer chose to state them rather than count them as coverage, which is the
behaviour I want — cost if wrong: the reviewer finds one of the three is actually
fixable without a VM, which costs one fix round.`

**Review dispatched on Opus**, agent `task-25-review`, package
`review-d0ff66b..ccdba26.diff` (84421 bytes, 2 commits). Model ruling: top tier for
the last task — the diff contains the two artifacts a human actually relies on (the
README, for someone whose whole plan is to learn from this app instead of a book, on a
machine where the VM does not exist yet; and the exit-criterion record), plus a new
gate whose entire output is a claim that something is fine.

Five ranked targets. (1) **The lint, hardest:** reproduce all four plants, then attack
what the plants do not cover — **is "nothing to check" distinguishable from "all
clear"?** A glob matching zero files exits 0 and looks identical to a clean bank; plant
a fault in the *last* task in iteration order, not the first; and note `checkpointIds`
had **zero production callers** before now, so this is its first real use. (2) Verify
both mandate refusals independently, reaching for `dash` deliberately on the first.
(3) The artifacts' honesty as a correctness property — NOT-RUN banner verbatim,
nothing invented, no NOT-RUN step phrased as done, and nothing anywhere implying the
exit criterion was met. (4) The e2e test as a **prediction**: not "will it pass" but
**can it pass for the wrong reason** once someone adjusts guessed values until they go
green. (5) All fifteen handed-over checks traceable in one list, and mandate 6's two
floors mutated to confirm they bite — including whether "close enough, must be trim"
is hiding a real drift in 1811/1766 vs 1814/1773.

Named a third direction for this task beyond false pass and false fail: a **false
green on the bank itself**, which is how a bad grader reaches a student in the first
place. And named the three shapes that have each cost this branch real time — a tool
reporting success it did not earn, a **citation that proves something adjacent to its
claim** (three occurrences now), and a **disclosure whose wording is wrong**.

## Task 25 — review returned. Both verdicts CHANGES REQUIRED.

Reviewer `task-25-review`, opus, range `d0ff66b..ccdba26` (2 commits, 84421 B). Full review at
`task-25-review.md` (386 lines).

- **Spec compliance: CHANGES REQUIRED.** One explicit instruction unmet: the fifteen handed-over checks
  were to be folded in without losing one, and check 1 has no home in the checklist that claims to hold
  it (F4). All other brief/mandate values and copy strings landed, verbatim.
- **Task quality: CHANGES REQUIRED.** "The new gate can report a clean bank that is not clean, by two
  independent routes (F1, F2). Both one-line fixes." Reviewer's own closing framing: *"The work is good;
  it is stopped on three one-liners, not a rewrite."*

### The two silent-green routes

**F1 — "nothing to check" is not distinguishable from "all clear."** `lintContent` filters
`graders = files.filter((f) => f.endsWith('/grade.sh'))` with no `graders.length === 0` guard. An
existing content root with zero `grade.sh` files exits **0**; it says `graders checked: 0` in
human-readable stdout, but the exit code a CI step reads is green. A nonexistent root correctly exits 1
via ENOENT, so it is the moved-or-emptied case that bites.

I predicted this one verbatim in the review context — *"A lint whose glob matches zero files exits 0 and
looks identical to a clean bank… If it is not, that is the finding of this review."* Worth recording
that the prediction was cheap and the finding was real: the attack was named before the code existed to
carry it, because it is the same shape as the eight `countCheckpoints` defects.

**F2 — the golden inventory drops the field it compares on, and the field is the project's whole
subject.** `HeaderRecord` stores `{ kind, ids }` and `declaredIds` does
`parseExpectations(...).map((d) => d.id)`, discarding the `@pre`/`@post`/`@both` suffix. Six shipped
headers carry `@post`. Measured: `home-from-lv@post` → `home-from-lv` and `fs-home-size@post` →
`fs-home-size@pre` yields `rhcsa lint` exit 0, empty stderr, and an inventory **byte-identical to the
committed fixture** — while `expectedStatus()` does read the phase, so the runtime verdict changes.
Found independently by the reviewer, not by me.

This is the more serious of the two. `@pre` vs `@post` is verdict A vs verdict B — "works now" vs
"survives a reboot" — the single behaviour this app exists to teach and the thing the exam punishes
people for missing. A silent inversion of an anti-solution's persistence semantics is a false green on
the exact axis the project is built around.

Both routes are the same shape, and it is worth naming as a class: **the gate compared successfully
because it never looked at the thing.** One is a filter that can match nothing; the other is a
comparison that drops a field. I put that sentence in the fix brief and asked for a third instance.

### F4 — the spec-compliance half, and it is my instruction that was missed

Thirteen of fifteen handed-over checks survived. Check 1 (chapter numbers and the `supporting` badge in
the picker) has no home, and check 8 was halved — its "derived, not self-reported" explanation half was
dropped. Both lost fragments are the only coverage of `TaskPicker.tsx:63-65` and `App.tsx:281`, neither
of which has a test.

Note for the record: checks 9-11 (masking) and 12-13 (persistence), the two groups Task 24 flagged as
most likely to rot unnoticed, both survived **and got more rigorous**. The two lost were the two nobody
flagged. Flagging a check appears to protect it; the corollary is that an unflagged check is the one at
risk, which is an argument for the single-list instruction rather than against it.

### Everything else came back clean

- **Both mandate refusals verified correct and neither is itself wrong.** Mandate 7's unquoted-value
  chain reproduced under dash — word-split, attempted execution of the path tail, variable left empty,
  execution continues, exit 0, while `node --env-file-if-exists` reads the same line correctly. Mandate
  9 item 7's line numbers all confirmed, including that the real defect is the `*)` arm at `:258`.
  That is four of my mandates refuted by implementer measurement on this project, all four preventing a
  defect.
- **The lint is a real gate.** All four committed plants reproduced, plus four of the reviewer's own. It
  checks every grader including a plant in the *last* task in iteration order. Mandate 11's reuse is
  genuine and `checkpointIds` behaves as the lint assumes — its first production use. All three
  committed negative shapes (heredoc body, comment, quoted string) verified, plus six more, with **no
  false fail found**.
- **Artifact honesty confirmed as a correctness property.** NOT-RUN banner and mandate 2's sentence
  byte-verbatim; nothing invented; no NOT-RUN step written in language that reads as done; no document
  stating or implying Phase 1's exit criterion was met; mandate 3's zero live pipe-then-status sites
  confirmed; step 5's coverage block byte-identical to a live run the reviewer executed.
- **Both mandate-6 floors bite** under mutation to `''` and to one rendered card. The 1811/1766 vs
  1814/1773 gap is confirmed trimming, not drift — checked rather than waved through.
- Gates: **408 passed / 35 files / 0 skipped**, `lint:content` exit 0 with empty stderr, `git tag -l`
  empty (mandate 1 holds), `git status --porcelain` empty before and after, all mutation in `/tmp`
  copies.

### Findings F1-F10; F1, F2, F4 load-bearing

`Ruling: require F1, F2, F4, F5 and F6 in fix round 1 and refuse F3, F9 and F10 — why: F1 and F2 are the
two routes to a false green on the content bank and F4 is an unmet instruction of mine, so all three are
non-negotiable; F5 (Array.isArray([]) is true on an empty finish result) and F6 (five rows reading as
"covered by a passing test" for a test that has never executed) are a line each and are instances of the
two classes that have cost this branch the most — an assertion that passes on nothing, and a disclosure
whose wording is wrong; F3, F9 and F10 the reviewer ruled need nothing and I agree — cost if wrong: one
extra round on items that were a line each.`

`Ruling: leave F3 alone — why: the lint's command-prefix blindness (! ck, if ck, while ck, LC_ALL=C ck,
time ck, eval 'ck …') is matched exactly by the counter's blindness, so the lint's view agrees with the
runtime's rather than diverging from it; no grader in the bank uses any of them (measured); it is already
parked as the command-prefix divergence and documented in the lint's docstring — cost if wrong: a future
grader written with a command prefix has its ids uncounted by both tools equally, which is the
pre-existing parked condition and not a new one.`

`Ruling: take F7 and F8 in the same pass but only if each is genuinely one line — why: both are the
citation-drift class (a tally attributed to check 7 that belongs to check 9; a reported margin of 577
where the measured value is 669), which has bitten this branch three times, and correcting a wrong number
where a reader will stand is cheaper now than after the artifact is relied on — cost if wrong: two
sentences of scope in a round that is already open.`

Fix round 1 dispatched to `task-25-impl` (resumed, per the rounds-1-3 rule).
Brief: `task-25-fix-1.md`. Base `ccdba26`.

### Whole-branch prep, done while fix round 1 runs

Wrote `whole-branch-review-context.md`. Range will be `6791d4d` (`master`) `..` final HEAD — **57+ commits,
188 files, ~24 300 insertions**, which is too large to review linearly, so the context directs the reviewer
by seam rather than by file and tells it explicitly not to read the diff front to back.

Structure: target 1 is the **joint P24 + P29 fix** (the server-side false pass at expected count 0 and the
client-side Finish-on-an-unscored-run, one root seen from two ends) with the question of whether a
**partial** deflation of the expected count is reachable — because if it is, the count-0 refusal is a
partial fix wearing a complete one's clothes and P22's mechanism is wrong a third time. Target 2 is the four
**cross-task invariants** no task-shaped review could see: objective ids as permanent scheduling keys, the
`@pre`/`@post` phase chain, the disclosure ladder's server-side enforcement, and `FakeTransport` divergence
from the real transports. Targets 3-5 are first-contact artifacts, the two named defect classes swept
branch-wide, and the doc-only corrections plus P18/P21.

Also parked, so the whole-branch review reads one list rather than several: **P29** (Task 24's F4, given a
number and filed as P24's sibling with the shape of the joint fix written out), **P30** (Task 25's F9), and
an addendum to **P19** recording that the Task 25 review re-found it as F3 with three more shapes and with
the better parking argument — the lint is blind to those shapes *identically* to the counter, so the two
tools agree rather than diverge, which is what makes it parkable rather than urgent.

### P5 upgraded from `CARRIED` to `MEASURED`, and I found it by checking my own claim before shipping it

I had written into target 2(a) that the objective-id referential graph was unreviewed end to end. Before
handing that to a reviewer I checked it, and **it was overstated** — three of the four edges are guarded in
`checkCoverage` (`src/engine/content/bank.ts:174-197`), and `objectives-golden.test.ts` locks the full
`id -> { text, chapters }` map of both taxonomies against a fixture, written after three silent mutations
passed the structural tests. Corrected the target to say so.

The check paid for itself: the **fourth edge is genuinely missing**. The concept loop at `:192-197` reads
only `prerequisites`; a concept card's own `objectives:` list is validated nowhere, so a card can name an
objective id that exists in no taxonomy and coverage stays silent.

What raises it above tidiness is the sibling test. `test/content/concept.test.ts:42` rejects an omitted
`objectives` key with the comment *"a card with no objectives is unreachable from the disclosure ladder"*,
and `:50` rejects an explicit empty list as a distinct case. The project already holds that an unreachable
card is a defect worth two dedicated tests — and a card naming a **typo'd or renamed** objective id is
unreachable in exactly that way while looking entirely valid. The two guarded cases are the ones a human
notices; the unguarded one is what a rename produces silently. Fix is a loop mirroring `:181-183`, emitting
a problem only — a card must **not** feed `coveredObjectives`, since coverage is a property of
exam-objective tasks per spec 6.4.

`Ruling: keep P5 parked for the single whole-branch fix dispatch rather than opening a round now, but
promote it in the ranking from low to a named candidate for that dispatch — why: it is a durable silent
failure on a permanent scheduling key, and it is a loop mirroring one that already exists eleven lines
above it, so it is among the cheapest load-bearing items on the list; but no content in the bank currently
trips it (the ids all resolve), so it is a latent hole rather than a live wrong answer — cost if wrong: a
future concept card with a mistyped objective id is silently unreachable from the disclosure ladder, which
is the failure two existing tests were written to prevent for adjacent causes.`

**Method note worth keeping.** This is the third time on this branch that verifying my own confident
sentence before dispatching it changed the sentence — and the class I have been warning reviewers about
(*a disclosure whose wording is wrong is worse than no disclosure*) is the one I keep committing. The
practice that catches it is cheap and mechanical: **before a claim about the code goes into a dispatch,
read the code.** Not the report about the code, and not my own earlier note about it.

### Task 25 fix round 1 returned — `fe4b051`, all seven items, accepted

413 passed / 35 files / **0 skipped** (was 408). typecheck, `build:web`, `lint:content` all clean, empty
stderr. Six files staged by name, no tag, tree clean.

F1 (zero-grader guard + `--allow-empty`), F2 (`@phase` in the inventory), F4 (checks 1 and 8 restored),
F5 (`toHaveLength(5)` + pinned id), F6 (`†` footnote on never-executed rows), F7, F8 all landed. Both
mutations now fail, measured: F1's guard deleted kills **exactly one** test — the new one, so nothing
depended on the old behaviour; F2's `@post`→`@pre` edit still exits 0 (the header is legal, which is why
the *fixture* must be the thing that notices) and the inventory now **differs on exactly one row**, where
before the fix both were bare ids and matched byte for byte. Source restored sha256-identically after each.

Two things done better than asked, worth recording as practice rather than praise:

- **F2 as a rename (`ids` → `declared`), not a widening.** The compiler then flagged every site comparing
  these against bare emitted ids, instead of leaving the implementer to find them by reading. On a project
  with `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and no casts, making the type system do the
  search is the correct instinct and it generalises.
- **Asserting the recovered F4 fragments are *inside* their items**, not merely present in the file —
  because adjacent-but-not-inside was F4's actual failure mode. A test that would have passed on the
  broken state is the thing this branch keeps producing; this one would not have.

Traceability **15 of 15**, counted mechanically: the mapping table parsed, `9-11` and `12-13` expanded,
every "The run" item number resolved against a real numbered item and every named section against a real
heading, 15 distinct numbers with none missing or duplicated. That is what "not from memory" meant.

### The third silent-green channel — found, disclosed, not fixed, call handed to me. Fix round 2 dispatched.

The `expect-fail` half of the lint iterates whatever the walk finds under `/antisolutions/` and **has no
expectation of how many anti-solutions a task should have**, so zero is indistinguishable from
all-present-and-correct. Measured by the implementer: deleting a task's `antisolutions/` → **exit 0** (18
rows vs 21); misspelling it `antisolutons` → **exit 0**; renaming one anti-solution off `.sh` → **exit 0**
(20 rows). A missing `grade.sh` *is* caught, but only through a one-directional interlock — the orphaned
anti-solutions complain `no sibling grade.sh, so its "# expect-fail:" ids cannot be checked`.

It declined to fix on scope ("Nothing beyond the above… No new features") and on the ground that the fix
would duplicate what `loadBank` knows, and left the call to me. That sequence — measure, disclose, do not
scope-creep, hand up the decision — is exactly right and is the opposite of the failure this branch has
been fighting.

**I checked its objection and it does not hold, and checking changed the argument for the better.** The
floors already exist: `src/engine/validate/harness.ts:82` and `:85` push
`needs at least ${MIN_SOLUTIONS} solutions` and `needs at least ${MIN_ANTISOLUTIONS} anti-solution`. So the
project already ruled that a missing-or-thin anti-solution set is a content defect; nobody has to
re-litigate it. But `harness.ts` is `npm run validate`, which needs a guest and **has never run against one
in this project's history** — while `rhcsa lint` exists for exactly one stated reason, in its own commit
message `e50cd3e`: *"the content gate that needs no VM."*

So the two floors that matter are enforced only where they never execute, and the gate that runs on every
commit omits them. That is not duplication; it is **porting a floor from the gate that never runs to the
gate that always runs**, and importing the two constants rather than restating the numbers is mandate 11's
reuse principle — the same one that made this implementer reuse `checkpointIds` instead of writing a sixth
regex.

Also corrected the implementer's supporting evidence, in the direction that strengthens it:
`docs/r1-findings.md:267` is **not** a record that the misspelling already happened. It is a
**troubleshooting row** whose diagnosis is *"the directory name is misspelled; `readdir` failures are
swallowed"* and whose documented remedy is *"check the spelling of `solutions/` and `antisolutions/`"* — by
hand, by a human. A documented failure mode whose remedy is human vigilance is the definition of a gap a
gate should close. Told it to use the corrected version.

`Ruling: fix the third channel in round 2 rather than park it — why: it is F1's twin in the other half of
the same command, and the brief explicitly refused "the golden fixture would catch it" as sufficient for
F1, so accepting that same argument for the twin would be incoherent; the floors already exist as named
constants, so the fix is an import and four loops rather than a new policy; and I verified all four rules
pass against the committed bank unchanged — cost if wrong: four rules in a gate that no current content
trips, which is a floor rather than a change.`

`Ruling: derive the expectation from the bank's task list, not from a filesystem walk — why: this is the
single lesson common to F1, F2 and the third channel — a walk cannot notice what it did not find, and a
comparison cannot notice a field it dropped, so the set of things to check must come from something that
knows what should exist; loadBank knows the tasks — cost if wrong: the lint gains a dependency on the bank
loader it already imports.`

`Ruling: no second escape hatch — why: one --allow-empty on the whole command is a gate with a documented
override, two is a gate with a habit — cost if wrong: a future author with a legitimately anti-solution-less
task has to make that decision visibly instead of silently, which is the point.`

Verified before dispatching, so the four rules are not built on a guess: five tasks, every one with a
`grade.sh`, anti-solution counts **5 / 3 / 3 / 3 / 2** (16 `.sh` files total), and **zero** non-`.sh` files
anywhere under an `antisolutions/`. `measured`.

Fix round 2 dispatched to `task-25-impl` (resumed; rounds 1-3 rule). Brief `task-25-fix-2.md`, base
`fe4b051`. Also asked for its judgement on whether rule 1 guards the `grade.sh` direction independently or
whether that still rests on orphans being present to complain — a gate whose two halves each depend on the
other half's content is a gate with one shared point of failure.

### Task 25 fix round 2 returned — `7880164`. Six guards where I asked for four, and the extra one is the catch of the round.

**423 passed / 35 files / 0 skipped** (413 after round 1, 408 before). typecheck, `build:web`,
`lint:content` all clean with empty stderr. Three files staged by name — `src/cli/lint.ts`,
`src/engine/validate/harness.ts` (two exports only), `test/cli/lint.test.ts`. No content file touched. No
tag. Tree clean.

Rules 1-4 as briefed, all derived from `bank.tasks`, each measured exiting **1** with a named problem where
`fe4b051` exited **0**. Two details worth keeping:

- **Rule 2 and 3 reuse the harness's own wording** (`needs at least 1 anti-solution, found 0`) rather than
  inventing a second phrasing for the same rule — so a reader who has seen the message from `npm run
  validate` recognises it from the lint. That is the right consequence of importing the constants instead
  of restating them.
- **Rule 3's previous state was exit 0 with a byte-identical inventory, because solutions carry no
  headers.** So for that rule the golden-fixture defence was not merely insufficient — it was
  **unavailable**. That retroactively settles the argument I refused in round 1 on principle, and it is
  better evidence than the principle was. I have flagged it to the re-reviewer as a claim that is
  *convenient for the implementer* and therefore deserves more scrutiny than one that costs it something.

Three unrequested additions, all measured: **4′** the `.sh` rule on `solutions/` too (justified because
`006` is the one task with three solutions, so renaming one there leaves exactly `MIN_SOLUTIONS` and no
floor fires); **rule 5** `grade.sh` required of every bank task; **rule 6** graders reconciled back against
the bank.

**Rule 6 is the catch of this round and it is the recursion of my own instruction.** I told it to derive
expectations from the bank rather than from a filesystem walk. It observed that **`bank.tasks` is itself
built from a walk for `task.yaml`** — so deleting a task's `task.yaml` made the task vanish from the bank
and the lint agreed with a bank that had silently shrunk: exit 0 with an identical inventory at `fe4b051`.
The same defect one level up, in the very mechanism I proposed as the fix. That is worth stating plainly:
my ruling was right in direction and incomplete in depth, and the implementer found the gap by taking the
ruling seriously rather than by working around it.

Its handling of the load failure is the part I want the re-reviewer to check hardest: a bank that will not
load is now reported as a problem naming that the floors were skipped, **while the header checks still run
and still print `graders checked: 5`**. The stated principle — *"could not check" must not read as
"clean"* — is exactly F1's lesson, and a partial run that prints a reassuring count is the shape this whole
task has been about. Right principle; the implementation of it is what needs eyes.

**Six guards suppressed one at a time in a `/tmp` copy: kill sets of 2, 2, 2, 1, 1, 1 across nine distinct
tests.** So no rule is asserted by a test that passes either way — subject to the re-reviewer confirming the
nine are genuinely distinct, since a shared kill would mean two guards rest on one assertion.

### The interlock question I asked was worth asking — the answer was a live hole

I asked whether rule 1 guarded the `grade.sh` direction independently or whether that still rested on
orphans being present to complain. Answer: **not independently.** Rule 1 fires on the anti-solutions being
*absent*; the orphan message fires on them being *present*; the two covered the space only jointly. So
deleting `014`'s `grade.sh` **and** its `antisolutions/` together gave exit **0**, 17 rows at `fe4b051` —
both halves of the interlock gone, both silent. `grade.sh` is now derived from the bank directly, and the
test asserts stderr does **not** contain `no sibling grade.sh`, proving the problem came from the bank
rather than from the interlock.

Recording the general lesson because it generalises past this lint: **two guards that cover a space only
jointly are one guard with a shared single point of failure.** Each looked adequate in isolation and the
pair had a hole exactly where their preconditions were both violated. That is worth checking for wherever
this project has a pair of checks described as complementary.

### Fourth channel found, parked as P32, with the line stated

`# unprobed-invariant:` is optional, so absent and misspelled are indistinguishable — measured,
`# unproved-invariant:` gives exit 0 and demotes `var-intact` from a declared invariant to an
informational note.

Parked. But since I refused the "the golden fixture would catch it" defence twice on this very task,
parking P32 on something adjacent to it required stating the distinction rather than leaving it as
inconsistency, and P32 records it: for F1 the fixture is a **different command**; for rule 3 the fixture was
**unavailable** (no headers on solutions, byte-identical inventory); for P32 the fixture is **available and
effective**, measured, **and the field has no consumer**. Both legs must hold — if a second command starts
reading that header, or the inventory stops covering it, P32 becomes live and should be fixed on sight.

`Ruling: park P32 on "no consumer plus a working detector", explicitly not on "some other gate probably
catches it" — why: the two legs are independently verifiable and both were verified, whereas the defence I
refused twice rests on neither; stating the distinction is what keeps the refusals coherent — cost if
wrong: a mistyped invariant header goes uncounted in a field no consumer reads today.`

Asked the implementer for the truncated `setup.sh` near-miss in full rather than guessing at it: whether
`setup.sh`'s absence makes the bank fail to load (covered by round 2's own load-failure behaviour, and
closed) or whether the read is swallowed the way `loadTaskScripts` swallows the `antisolutions/` readdir
failure (a live seventh gap, and I will fix it in this task rather than park it). Told it not to re-measure
for this — the text, or a `reasoned` answer, is enough for me to decide whether the measurement is worth a
round.

### Scoped re-review of rounds 1 AND 2 dispatched

`review-ccdba26..7880164.diff`, 2 commits, 62 710 bytes. Reviewer `task-25-rereview1`, **opus** —
`Ruling: opus for a fix-diff re-review rather than the cheaper tier the skill suggests for small fix diffs
— why: this is not a small fix diff (thirteen guards, ten new tests, three unrequested rules) and it is the
last task gate on the branch, over a function whose eight historical defects were every one of them silent
— cost if wrong: one review seat at a higher tier than a line count alone would justify.`

Thirteen guards to verify bite, plus one interaction I flagged as **my own instruction's blind spot**:
`--allow-empty` was introduced in round 1 for the single narrow purpose of bypassing F1's zero-grader
guard, and round 2 then added six guards behind it. **Does the flag now suppress any of them?** If it
short-circuits before the derived rules run, an escape hatch scoped to "this root has no graders" silently
disables every floor on the bank — and my round-2 refusal of a *second* flag ("one flag is a gate with a
documented override, two is a gate with a habit") only holds if the one flag stayed narrow. Nobody has
tested that, including me.

### The `setup.sh` near-miss — my question offered two branches and both were wrong

I asked whether `setup.sh`'s absence makes the bank fail to load (covered by round 2's load-failure guard,
therefore closed) or whether the read is swallowed the way `loadTaskScripts` swallows the `antisolutions/`
readdir failure (a live gap). The implementer rejected both and named a **third state**, correctly:

- **The bank loads fine without it.** `measured`, and the proof is already in the round-2 measurement:
  deleting `014`'s `setup.sh` gives `rhcsa lint` exit **0 with zero problems**, and round 2's own guard
  raises a problem whenever `loadBank` rejects — so exit 0 with an empty problem list *is* the proof
  `loadBank` resolved. Nothing in `loadTask` or `loadBank` reads `setup.sh`; the only `src/` hits are a
  comment in `lint.ts` and a fixture filename.
- **The read is not swallowed either.** `src/engine/validate/harness.ts:41` is a bare
  `readFile(join(task.dir, 'setup.sh'), 'utf8')` with no `.catch`. The contrast is eleven lines down in the
  same function: `collect` uses `readdir(dir).catch(() => [])`, and **that `.catch(() => [])` is the entire
  swallow**. `setup.sh` has no equivalent, so ENOENT propagates.

So: **the static gate says clean, and the failure surfaces as a rejection at first use.** Late, not silent.
It also split its own labels honestly — the rejection is read from source; that the rejection reaches the
operator as a failed `validate` and a 500 from session create is **reasoned** from the call path and not
executed, since `validate` cannot run without a guest. I told it not to go run anything to upgrade the
label; the honest label was the useful part.

Worth recording as method: **when a question offers two branches, the answer may be neither, and an
implementer that says so is doing the job.** My two branches encoded an assumption — that the failure had to
be either caught by the new guard or swallowed like its neighbour — and the assumption was false. That is
the third time on this branch a confident framing of mine was narrower than the code.

`Ruling: close the setup.sh gap in fix round 3 rather than park it — why: the deciding argument is the one
the implementer raised against its own conclusion, that docs/exit-criterion.md points a reader at
lint:content as the check to run before a VM exists, and that is exactly where this user stands today — the
ISO is not downloaded, so lint:content is the only gate they can run at all, and a green result there on a
task that cannot start is a wrong truth-claim to the person relying on it when they have nothing else; it is
the third direction, a false green on the bank, which is what this whole task turned out to be about — cost
if wrong: one line in an existing loop, no new import, firing on nothing today since all five tasks ship a
setup.sh (measured).`

`Ruling: overrule the implementer's architectural objection, but record that it is correct — why: it argued
that "which files must a task have" is a loadTask question rather than a grader-header-lint question, and it
is right; but round 2 already crossed that boundary deliberately and with my endorsement in rule 5
(grade.sh required of every bank task) and rule 6 (task.yaml reconciliation), so setup.sh is consistent with
where the lint already stands rather than a third stretch of scope — cost if wrong: three file-existence
rules live in the lint that would read better in the loader, which is a refactor and not a defect.`

**Note for whoever next touches `loadTask`:** rules 5, 6 and the new `setup.sh` rule are all "which files
must a task have", and the loader is their better long-term home. They live in `src/cli/lint.ts` because the
lint is the only gate that runs without a VM. Moving them into `loadTask` would be an improvement; leaving
them where they are is not a defect. This note exists so the argument does not have to be rediscovered.

### Round 3 deliberately deferred rather than dispatched now

`Ruling: hold fix round 3 until the re-review reports, instead of dispatching it in parallel — why: the
re-review is measuring against 7880164 and its brief requires the tree to match that sha with
git status --porcelain empty, so a commit landing underneath it would break exactly that check — and
measuring a tree another agent was editing is a mistake already made once on this branch; batching the
setup.sh rule with whatever the re-review finds also costs one round instead of two — cost if wrong: the
setup.sh fix waits one review cycle on a rule that fires on nothing today.`

Implementer told to stand by, with the reason, so it does not commit into a live measurement.


### Task 25 — scoped re-review of fix rounds 1+2 returned: CHANGES REQUIRED

Reviewer `task-25-rereview1`, opus, range `ccdba26..7880164`, brief `task-25-rereview-1-context.md`, full
review at `task-25-rereview-1.md`. Working tree clean at `7880164`, `git tag -l` empty, all `/tmp` copies
removed.

**The diff itself held up unusually well.** All thirteen guards landed and **all thirteen bite** — each was
suppressed and its test watched to die, rather than read for plausibility.

- Round 1: F1 killed **exactly one** test, as the implementer claimed, so nothing depended on the old
  zero-grader behaviour. F2's suppression killed 3. F4 verified structurally. F5 is VM-gated so it was read
  as a prediction, and `5` is derivable from committed content. F6 and F7 landed. F8's **669 reproduced**
  (3669 assembled, 577 the naive sum).
- Round 2: rules 1, 2, 3, 4, 4′, 5, 6 and the bank-did-not-load guard all bite. **Kill sets 2, 2, 2, 1, 1, 1
  across nine distinct tests, no shared kill.** Rules 2/3 and 4/4′ share one parameterised code site each,
  but deleting either half of the `dirs` array is independently caught, so the sharing is not a shared point
  of failure.
- **All three unrequested rules: keep.** 4′ closes a hole live for one task in five; 5 closes the
  double-deletion hole; 6's `task.yaml` measurement holds.
- **All three phases survive as distinct rows.** `@pre`/`@post`/`@both` round-trip distinctly, and
  `expectedStatus` yields three distinct verdict pairs — pre (fail, pass), post (pass, fail), both
  (fail, fail). No collapse, which was the F2-again risk I asked about.
- **Fifteen checks: 15 of 15**, recounted mechanically. Every recovered fragment is *inside* its item, not
  merely present. No second stale cross-reference.
- Double-deletion hole closed. Restore sha256-verified byte-identical across all seven files. Zero casts
  introduced. Gates: typecheck 0; vitest **423 / 35 files / 0 skipped**; `build:web` 0; `lint:content` 0 with
  empty stderr. P32 correctly left unfixed.

**Two of my own numbers were wrong and the reviewer corrected both.** F6 was **four** rows, not five — my
original finding over-counted, and `ccdba26` had exactly four. And the implementer's round-2 rule 3 claim —
that the golden-fixture defence was *unavailable* rather than merely insufficient, because solutions carry no
headers and the inventory was byte-identical — survived the extra scrutiny I aimed at it precisely because it
was convenient for the implementer's case. It was true.

**The blocker landed in the section I flagged as my own blind spot, in a shape I did not guess.** I asked
whether `--allow-empty` suppresses the six new rules. It does not — ten mutations, exit 1 either way. But:

- **NEW-1, Medium, false green on the bank, load-bearing.** `checkFixtureFloors` sits behind
  `if (graders.length > 0)`, so **at zero graders every bank-derived rule is unreachable** — and
  `--allow-empty` is exactly the flag that makes zero graders a non-error. Measured: a bank still declaring
  **five tasks**, with all `grade.sh` and all `antisolutions/` gone, under `--allow-empty` → **exit 0, empty
  stderr, `no problems in 0 grader(s)`**. Rule 5 alone would have fired five times. The escape hatch did grow
  a blast radius, just not by suppressing the rules — by never reaching them, which is worse because it is
  invisible in the flag's own implementation.
- **NEW-2.** The comment defending that short-circuit asserts *"a root the walk found no graders in has no
  task to iterate"* — measurably false, and it infers a bank property from a walk result, which is the exact
  class rules 1-6 exist to close, restated in a comment that defends the code from being fixed. Two named
  defect classes in one line.
- **NEW-3, Low-Medium, not blocking.** A walk does remain under rule 6.

**Method note worth keeping.** I flagged `--allow-empty` in the brief as *"my own instruction's blind spot
and I want it checked rather than assumed,"* and it produced the round's only blocking finding. Naming a
suspected weakness in my own instruction, as a target, has now paid on this branch twice. It costs one
paragraph in a brief.

`Ruling: NEW-1 and NEW-2 both go into round 3 as required, not just NEW-1 — why: NEW-2 is not a tidiness
item, it is a false claim in the comment that exists to stop the next author fixing NEW-1, so shipping the
code fix while leaving the comment leaves the trap armed for the next reader — cost if wrong: a few lines of
comment churn.`

`Ruling: the setup.sh rule, already ruled in last round, rides in round 3 rather than waiting — why: the
implementer established it goes into the existing bank.tasks loop in checkFixtureFloors alongside rule 5 with
no new import and the same proof shape, and it inherits NEW-1's fix for free once the floors leave the
short-circuit, so splitting it into a fourth round buys nothing — cost if wrong: one more round on a task
already at three of five.`

`Ruling: park NEW-3 as P33 rather than fix it in round 3 — why: unlike F1 and rules 1-6 there is no
in-command source of truth being ignored, because bank.tasks is itself a walk; the honest fix is a committed
expected-task-id manifest, a new artifact with its own drift story rather than a guard, and inventing one
inside a fix round is how a gate acquires a second gate to maintain; the golden fixture does discriminate the
state today, and the exposure is an entire task directory vanishing, which is far louder than the misspelled
subdirectory that motivated rule 1 — cost if wrong: deleting or never committing a whole task goes uncaught
by the gate that runs on every commit.`

`Ruling: park the coverage --strict observation as P34 rather than treat it as a Task 25 item — why: it is
not a defect in this diff, but it invalidates a form of reasoning ("coverage --strict would catch that") that
has been used informally on this branch, and a gate that is red on the shipped tree is a gate nobody runs —
cost if wrong: the whole-branch review re-derives it.`

`Ruling: scanFixtureDir's untested unreadable arm is requested as cheap-if-cheap rather than required — why:
it fails closed, so it is not a false green in any direction, and forcing it would mean either a permissions
fixture on a host where sudo cannot authenticate or a mock that proves nothing — cost if wrong: one arm of
one function stays unexercised in a function whose other arms are now heavily tested.`

**Whole-branch parked list: P1-P32 → P1-P34.** P33 (a walk remains under rule 6, with the manifest decision
handed to the whole-branch reviewer) and P34 (`coverage --strict` red on the shipped bank, 58 uncovered
objectives, so it is nobody's backstop) both written up in `whole-branch-parked.md`.

### Task 25 — fix round 3 of 5 dispatched

Brief `task-25-fix-3.md`. Resumed `task-25-impl` (rounds 1-3 resume the same implementer; it was standing by
with an empty tree confirmed at `7880164`). Base `7880164`. Four items: NEW-1 (required, the blocker), NEW-2
(required), the `setup.sh` rule (required, already ruled in), and `scanFixtureDir`'s `unreadable` arm
(cheap-if-cheap). NEW-3 parked as P33 with the reasoning written out so it does not read as the
fixture-defence I refused twice. Every fix to be proven by mutation exiting non-zero with a **named problem**,
not by a changed row count — and the `--allow-empty` axis is now live for every proof, since that is where
this round's finding came from.

Closing question asked: NEW-1 is a fifth instance of this task's recurring sentence in a new grammatical
position — *the gate could not look, because it never ran.* Are there other checks in this lint, or beside
it, sitting behind a precondition computed from the very thing they exist to validate? That shape has not
been swept for.

### Correction to my own review briefs, applied to `whole-branch-review-context.md`

I have been telling reviewers, across several dispatches on this branch, that **exactly one `as` cast exists
repo-wide, at `src/web/api.ts:201`**. That is false, and six task reviews accepted the framing. `api.ts:201`
is the only cast anyone ever *ruled* on; it is not the only cast that *exists*. Measured on HEAD: **13 in
`src/`** across six files — **8 in `src/engine/content/task.ts`**, one each in `engine/vm/config.ts`,
`engine/content/objectives.ts`, `engine/content/concept.ts`, `engine/grading/verdict.ts` and `web/api.ts`,
plus a larger number in `test/`. The surviving true part: **no `as unknown as` anywhere.**

A claim of mine functioned as a blanket exemption for thirteen type assertions. Rather than just delete the
sentence I promoted it to **target 6** of the whole-branch review: the casts cluster at **deserialization
boundaries** (`js-yaml` → `unknown`, `process.env`, `res.json()`), where a cast is idiomatic, so the question
is not "delete them" but **whether each is guarded by a check that makes it true**. `task.ts:96` shows the
right shape — `SCOPES.includes(raw.scope as string) ? (raw.scope as TaskScope) : 'exam-objective'`, assertion
inside a membership test with a real fallback. A bare one at a YAML boundary is this branch's defect class
arriving by a new road: **the type system reported agreement because it was told not to look** — a
`task.yaml` with `weight: banana` becoming a `TaskWeight` by assertion is a bank the loader certified and the
content lint cannot see. The reviewer is told not to take my count on trust but to measure it and report what
it gets, and to say which of the 13 are guarded, which are bare, and whether any bare one is reachable from a
content file a user could plausibly write.

**Third time on this branch that a confident framing of mine was narrower than the code** (after the
`setup.sh` two-branch question and the objective-id graph), and the first where the framing actively
suppressed review coverage rather than merely being wrong in a note. The established practice already covers
it and I did not apply it here: before a claim about the code goes into a dispatch, read the code — not the
report about the code, and not my own earlier note about it.

### Correction to the correction: all 13 casts are guarded. Target 6 rewritten around what the reading found instead

Having corrected my "exactly one cast repo-wide" claim, I then repeated the same mistake one level down: I
rewrote target 6 to send the whole-branch reviewer hunting for **unguarded** casts at deserialization
boundaries, on the assumption that thirteen casts nobody reviewed would contain at least one bare assertion.
Then I applied my own established practice and read all thirteen. **Every one is guarded by a predicate
immediately above it**, with a real fallback or a throw:

- `task.ts:54`, `concept.ts:36` — `stringArray` checks `Array.isArray` plus every element `typeof string`.
- `task.ts:96,97,101,102,107,108,110` — assertion inside a `SCOPES`/`WEIGHTS`/`TRANSPORTS` membership test,
  with a warning and a documented fallback.
- `objectives.ts:70` — gated on `bad` (non-integer or outside 1-28), then throws `ContentError`.
- `verdict.ts:29` — `STATUSES.includes(v.status)` two lines above. **The one I most expected to be bare**,
  because it is on the grading path. It is not.
- `config.ts:54` — line 40 throws unless the value is in `KINDS`.
- `api.ts:201` — the ruled `fetch` boundary.

So the original ruling's *spirit* was right — casts here are disciplined — while its *letter* was wrong, and
"exactly one" was a lazy shorthand for "one that needed a ruling." Two wrong versions of this claim reached
dispatches. I left the whole story in the brief rather than silently replacing it with the answer, because a
reviewer who spent the pass hunting a cast finding would have been following my error, not the code.

**The reading produced a real finding one level up, and it is this branch's defect class in a new medium.**
The project has two idioms for checking a string against a union, and only one fails the build when the union
grows. Safe, exhaustive by construction: `config.ts:22` `KINDS: Record<TransportKind, true>` and
`app.ts:31` `MODES: Record<SessionMode, true>` — and `config.ts:20-21` even carries a comment explaining why.
Unsafe, a stale list still compiles: **`verdict.ts:17` `STATUSES: readonly string[]`** against
`CheckpointStatus`, and **`task.ts:10,11,12`** `SCOPES`/`WEIGHTS`/`TRANSPORTS` against
`TaskScope`/`TaskWeight`/`TaskTransport`. All four lists match their unions **today** — I checked each — so
nothing is broken now. The defect is that nothing keeps them matching.

`verdict.ts:17` is the sharp one. Add a fourth `CheckpointStatus` — plausibly `'error'`, to distinguish a
grader that crashed from a check that failed — and the build stays green, `STATUSES` stays stale,
`asCheckpoint` returns `undefined` at line 27, and `parseVerdict` files the line under `noise`. **A checkpoint
silently disappears from the verdict.** That is *the gate reported agreement because it never looked at the
thing*, arriving through the type system rather than through a walk, and it lands directly beside **P24** (an
expected count that collapses reports a pass). Whether the two compose into a false pass is now an explicit
question for the whole-branch reviewer, and it is the reason this is target 6 rather than P35.

`task.ts:10,11` are milder but not cosmetic: `scope` drives `coveredObjectives` in `bank.ts:170-210`, so a new
scope defaulting to `'exam-objective'` quietly changes coverage accounting, and `weight` feeds scoring.
`task.ts:12` deliberately mirrors `TaskTransport` (`'ssh' | 'vmrun'`) rather than `TransportKind` (which also
has `'fake'`) — that narrowing is intentional, and the brief says so, so nobody "fixes" it against the wrong
union.

`Ruling: target 6 becomes the four membership lists rather than the casts, and the fix is a candidate for the
single fix dispatch — why: the safe idiom already exists in-repo at two sites with a comment explaining it, so
this is four lines adopting a documented project pattern rather than a design decision, making it the cheapest
item on the target list to close — cost if wrong: four lines of churn in files the fix dispatch is already
touching.`

**Method, stated plainly because I have now paid for it three times on this task alone.** The practice I
wrote down — *before a claim about the code goes into a dispatch, read the code, not the report about the
code, and not my own earlier note about it* — I applied to targets 2(a), 2(c) and 2(d) and it changed the
dispatch each time. I then failed to apply it to my own cast claim twice in a row, and both failures were of
the same kind: I trusted a remembered summary of the code over the code. The remembered summary is the most
dangerous input I handle, because it arrives feeling like knowledge rather than like a claim.

### Task 25 — fix round 3 of 5 returned: complete. Commit `45344bd`

One commit atop `7880164`, two files (`src/cli/lint.ts`, `test/cli/lint.test.ts`), 218 insertions / 21
deletions, staged by name. `git status --porcelain` and `git tag -l` both empty. Gates: typecheck 0; vitest
**431 / 35 files / 0 skipped** (from 423, **+8**); `build:web` 0; `lint:content` 0 with empty stderr. The
committed bank passes unchanged — `content/` → exit 0, `no problems in 5 grader(s)`, 21 scripts with headers.
No content file or out-of-scope source touched.

All four items landed, and each guard bites by suppression: the `setup.sh` rule killed 3 tests, the
`unreadable` arm killed 1, and putting the floors back behind the grader count killed 3.

1. **NEW-1 fixed.** `loadBank` and `checkFixtureFloors` now run unconditionally; only the bank-did-not-load
   *message* remains behind the grader count.
2. **NEW-2 fixed** — and fixed in the better way: the false claim is replaced with what is true (the count is
   a walk result, `bank.tasks` is the independent record, so the count is itself one of the things the floors
   check), **with the wrong version recorded as wrong rather than deleted.** That is the right treatment for
   the wrong-disclosure class — a reader who remembers the old reasoning learns it was wrong instead of
   finding it silently absent.
3. **`setup.sh` rule added** beside rule 5, via an `isFile` helper that `stat`s rather than `access`es **so a
   directory named `setup.sh` does not pass**. Mutation-proved on both axes of `--allow-empty` and at zero
   graders as well as five. The `stat`-not-`access` detail was not asked for and is the kind of care this task
   has produced repeatedly.
4. **`unreadable` arm tested, and genuinely cheap** — a regular *file* named `antisolutions` makes `readdir`
   fail **ENOTDIR, not ENOENT**, so no permissions fixture and no `sudo`. The test also pins the message as
   distinct from the absent-directory one, which is what stops rule 1 and this arm collapsing into each other.

**The re-measured NEW-1 case** (five declared tasks, no `grade.sh`, no `antisolutions/`): at `45344bd` with
`--allow-empty` → **exit 1, 10 problems** (rule 5 ×5, rule 1 ×5); without the flag → exit 1, 11. At
`7880164` the same root with the flag was exit 0 / 0 problems — and, the detail that settles the diagnosis,
*without* the flag it exited 1 on the empty-root guard alone **with rule 5 still never firing**. So the defect
was the placement, not the flag. `--allow-empty` still exits 0 on a genuinely empty root; round 1's test for
that is unchanged and green.

**The sweep answered the closing question, and it produced two residuals.** Swept: every conditional standing
between an input and a check in `src/cli/lint.ts`, all three commands in `src/cli/index.ts`, and
`src/engine/validate/harness.ts`. Everything else fell into three benign shapes — four places that compute
from the input and then *report* rather than skip (`graders.length === 0`; `checkVerdict`'s
`checkpoints.length === 0`; `emitted === undefined`; `validate`'s `tasks.length === 0`, which exits 1
**before** `loadVmConfig`, measured, so it needs no guest); `inventoryGate` running unconditionally in
`validateTask`; and `if (baseline)` / `if (result.verdictB)` in `runFixture` failing closed, because the parse
error is pushed as a failure first and the `else if` turns a suspicious missing verdict B into a failure.
`coverage --strict` was the best candidate anywhere — `gaps` filters lists drawn from the bank it validates —
but the loader floors it: `objectives: []` gives `objectives must list at least one objective` and exits 1
before `checkCoverage` is reached.

The two residuals:

- **The bank-load message still behind `graders.length > 0`**, disclosed and explicitly *not* defended, which
  is the right posture. Measured cost: `--allow-empty` + zero graders + **no anti-solutions either** + an
  unloadable bank → **exit 0, 0 problems**. With anti-solutions present it is exit 1 either way (16 orphan
  rows); without the flag, exit 1. It survives because removing it breaks `--allow-empty` on a bare directory.
- **`runFixture`'s `if (fixture.script.trim() !== '')`** — a precondition computed from the fixture it
  validates, the exact shape I asked the sweep to look for. The implementer reasons it fails closed for a
  solution but is a **live silent green for an anti-solution**. Its report truncated mid-sentence; I have
  asked for the tail verbatim plus whether it is measured or reasoned, and I am holding the ruling until it
  arrives rather than ruling on a sketch. Note `harness.ts` is `npm run validate`, which has never executed
  against a guest, so this bears on severity, not on correctness.

Review package written to `review-7880164..45344bd.diff` (1 commit, 20 405 bytes).

### P35 ruled and parked before the round-3 re-review was dispatched, with the implementer's framing widened

The sweep's one unclosed item was `runFixture`'s `if (fixture.script.trim() !== '')` at
`src/engine/validate/harness.ts:199` — a precondition computed from the fixture it validates, which is
exactly the shape I asked the sweep to hunt. The implementer reasoned it fails closed for a solution but is a
live silent green for an anti-solution. Its report truncated mid-sentence, so I asked for the tail — and then
read `runFixture` and a real anti-solution myself rather than wait, which is the practice I had just failed
twice.

**The mechanism is real and the named guard is the wrong culprit.** An anti-solution exists to prove the
grader *detects a specific wrong answer*; `runFixture` never establishes that applying the anti-solution
changed the machine, so any anti-solution leaving the machine at the unsolved baseline passes, because at
baseline the goal checkpoints fail — which is what the anti-solution declared. Three reachable shapes:

1. whitespace-only script — `trim()` skips `exec`. The shape the sweep found.
2. **a script with only a shebang, comments and `set -euo pipefail`** — non-empty, so **the `trim()` guard
   never fires**, `exec` runs, bash exits 0 having done nothing, machine at baseline. Same outcome, and it
   *bypasses* the guard the sweep identified. A realistic authoring accident.
3. a command that succeeds but is a no-op on this machine.

So removing the `trim()` short-circuit would not close it. The fix is a **baseline comparison** — require the
anti-solution's verdict to differ from the baseline verdict.

**The committed content already names this hazard and claims a fix that is insufficient.**
`content/tasks/storage/014-grow-home-lv/antisolutions/03-wrong-lv.sh` says it declares exactly the
`# baseline-fail:` ids on purpose, and that *"is only safe because harness.ts now checks this fixture's own
exit code (mandate 2): if lvextend here silently failed for lack of free space, the machine would be
indistinguishable from the baseline and this fixture would report ok while probing nothing."* The author
reached this class independently and **wrote the failure sentence almost verbatim**, then concluded the
exit-code check closes it. It closes shape 1's cousin — a fixture that *errors* — and neither shape 2 nor 3.
That is the wrong-disclosure class in committed content, and it also proves the exposure is live on the
shipped bank rather than hypothetical, since that fixture's declared set is identical to the baseline set by
design.

Noted for the whole-branch reviewer: a **static** signal exists — "this anti-solution declares exactly the
grade script's `# baseline-fail:` set" needs no guest and could live in `rhcsa lint` — but it fires on
`03-wrong-lv.sh`, which is committed, deliberate and defended in writing, so it cannot simply be added as a
rule without becoming a false fail on the bank.

`Ruling: park as P35 for the whole-branch review rather than open Task 25 round 4 — why: it lives in
harness.ts, outside this task's scope (touched for two exports only) and in the gate that has never run
against a guest, and the fix is a behavioural change to the validate harness rather than a lint guard;
spending round 4 of 5 on an unreachable gate would burn the task's remaining budget on the wrong file — cost
if wrong: an inert anti-solution stays certified until validate first runs, which is precisely when someone
starts trusting it.`

Parked list **P1-P34 → P1-P35**; `whole-branch-review-context.md` synced (count and the parked file's line
count, both of which were stale).

### Task 25 — scoped re-review of fix round 3 dispatched

Reviewer `task-25-rereview2`, **opus**, range `7880164..45344bd`, brief
`task-25-rereview-2-context.md`, package `review-7880164..45344bd.diff`.

Model choice, stated because the diff does not justify it on size: 20 KB and two files reads as mid-tier
work, but **all three previous rounds on this task hid a silent-green channel that only an adversarial pass
found**, and a false APPROVED here ships a broken content gate into the branch's final review. Paying opus
once on the last task gate is cheaper than discovering a fourth channel in the whole-branch pass, where the
fix budget is a single dispatch.

Four items to verify by suppression, plus three things the brief asks for that the round did not:

- **How narrow the disclosed residual actually is** — the bank-load message still behind
  `graders.length > 0`, costing exit 0 / 0 problems at `--allow-empty` + zero graders + no anti-solutions +
  unloadable bank. The question I most want answered: **is there a formulation that keeps `--allow-empty`
  working on a bare directory while still reporting an unloadable bank?** The implementer said removing the
  guard breaks the former, which is true and is not the only option — distinguishing "no bank file at all"
  from "a bank file that failed to load" may separate the two cases cleanly. If it does and it is small, this
  residual should not survive the branch.
- **Whether `loadBank` running unconditionally introduced a new failure mode**, since it now executes against
  roots where it never previously ran. A gate that crashes instead of reporting is not a false green, but it
  is a regression and it is in scope.
- **Three sweep claims spot-checked**, reviewer's choice, with two nominated: `validate`'s
  `tasks.length === 0` exiting before `loadVmConfig` (if wrong, the sweep needed a guest to be conclusive and
  did not have one), and the `coverage --strict` claim (reasoning about a gate that is already red on the
  shipped bank is easy to do carelessly).

Also asked to confirm the NEW-2 comment is **true in every claim** rather than merely different — the round
that was supposed to close the wrong-disclosure class here must not close it with another wrong disclosure —
and to confirm `harness.ts` does **not** appear in this diff.

### P35 corrected: the implementer retracted its own finding, I retracted half of mine, and the surviving half is stronger for it

The implementer came back having read the code rather than finish its own sentence, and **retracted the
`runFixture` `.trim()` finding.** Verified independently by me before accepting: `expectations.ts:41-45`
throws `must declare a "# expect-fail:" header…` when no header matches, and `harness.ts:165` calls
`parseExpectations` **thirty-four lines above** the guard at `:199`, returning `ok: false` at `:167`. So a
whitespace-only anti-solution is red **before the guard is consulted**, and the guard is reachable only for the
`kind: 'none'` baseline fixture whose script is `''` by construction — where skipping is correct. **Right
shape, no bite, nothing to fix at `:199`.** Recorded as retracted with its mechanism rather than deleted, the
same treatment the implementer gave the wrong NEW-2 comment.

**That killed shape 1 of my three, so half my widening was wrong too.** What survived is the half we reached
**independently** — the culprit is the absence of any baseline comparison, not the guard — and independent
arrival at the same mechanism is the strongest evidence either of us produced on this item.

The implementer's own observation sharpened it beyond where I had it: since the `# expect-fail:` header **is
itself a comment**, a comment-only body is not a contrived state but the **natural form of a half-written
anti-solution**, because every anti-solution in the bank is written header-and-paragraph-first. More likely,
not less.

**I also narrowed my own "live on the shipped bank" claim**, which the implementer's measurement corrected:
statically there is **no comment-only instance** — the thinnest three anti-solutions carry exactly one real
command each (`014/01-forgot-growfs.sh`, `014/03-wrong-lv.sh`, `017/02-faked-the-end-state.sh`). What the bank
actually has is `03-wrong-lv.sh` as a **no-op-command candidate flagged by its own author**, whose header
asserts the exit-code check makes it safe — a check that catches a fixture that *errors*, not one that succeeds
having changed nothing.

**One disagreement with the implementer's conclusion, and it is the most valuable thing to come out of the
exchange.** It wrote that the closing check "also needs a guest, so it is a `harness.ts` feature." True for the
no-op-command shape. **False for the comment-only shape:** strip comments, blank lines and `set -e…` from the
body, and if nothing remains the fixture does nothing — pure content inspection, no verdict, no guest. That is
a `rhcsa lint` rule, it fires on none of the sixteen anti-solutions in the bank, and it is now **the cheapest
concrete fix on the parked list.** Recommended to the whole-branch review.

`Ruling: do not reopen 45344bd to add the comment-only static rule, despite it being in Task 25's territory —
why: it was identified after the commit was already in scoped re-review, and adding an unrequested rule to a
committed and re-reviewed round is precisely how this task acquired three of its four silent-green channels;
the whole-branch fix dispatch is the right vehicle and it is four lines there too — cost if wrong: one cheap
rule waits for one more gate.`

**P36 added** from the implementer's residual answer, and the reachability split is what settles it: the
`--allow-empty` flag is reachable from **no npm script, no `docs/` page, no README line and no CI file** —
only `USAGE` and tests — so `npm run lint:content` cannot reach the state. But the *root* state is highly
reachable: `task.yaml` written first with a YAML error, no `grade.sh` and no `antisolutions/` yet is **the
flag's own advertised use case landing on its blind spot**. What bounds it is that `rhcsa coverage` and
`rhcsa validate` both catch the same root and exit 1, `validate` from `loadBank` **before `loadVmConfig`**, so
no guest is involved. A hole in this command's coverage that two neighbouring commands already cover.

`Ruling: park as P36 rather than reopen 45344bd — why: unreachable from every scripted path, caught by two
neighbours without a guest, and disclosed rather than defended so nothing is hidden — cost if wrong: a
half-authored bank reads as clean to anyone who types --allow-empty and does not then run coverage or
validate.`

The one question that could still reopen it is with the round-3 re-reviewer: **is there a formulation that
keeps `--allow-empty` working on a bare directory while still reporting an unloadable bank** — distinguishing
"no bank file at all" from "a bank file that failed to load," rather than removing the guard. Yes-and-small
buys a round 4 for that one thing; otherwise Task 25's implementer is done.

Parked list **P1-P35 → P1-P36**; `whole-branch-review-context.md` synced. The re-review brief's out-of-scope
description of P35 was checked against the correction and still reads true, so the running reviewer was not
disturbed.

**Method note, and this one is about a good outcome rather than an error.** Three of the four sharpest items
on this task came from asking the implementer a closing question and then *arguing with the answer* rather than
filing it: the third silent-green channel, the fourth, and now P35's real mechanism. In this last case the
implementer corrected me, I corrected it back on a narrower point, and the item that resulted is better than
either of our first versions. The pattern worth keeping is not "ask a closing question" but **treat the
implementer's answer as a claim to check, exactly as its report is treated** — including when the answer is a
retraction that makes my own finding look better than it was.

### P36's fix formulated, and both new lint rules routed to the single whole-branch dispatch rather than a Task 25 round 4

The implementer answered the `--allow-empty` question `reasoned` (from the code, not measured), and the answer
is actionable: **`--allow-empty`'s real assertion is "no task is authored here," which is a question about
named paths rather than about counts.** `objectives.yaml` existing, or any `task.yaml` under `<root>/tasks`,
is answerable with the `isFile`/walk vocabulary already in `src/cli/lint.ts`; either being present means the
root **is** a bank, at which point a load failure is a problem the flag must not suppress. The aggregated
`ContentError` never needs inspecting.

**It also named the trap, and this is the part worth preserving verbatim rather than paraphrasing.** Phrase
the condition as *"the walk found no `task.yaml`"* and it is **NEW-1's shape again, one artifact along** — a
precondition computed from a walk of the thing being validated. Phrase it as *"this named file is absent"* and
it is a filesystem fact about a fixed path, which is safe. The two read almost identically in English and are
not the same check. Written into P36 as a **requirement on the phrasing**, plus a test pinning the
malformed-`task.yaml`-with-no-`grade.sh` root at exit 1 under the flag.

`Ruling: fix P36 and P35's shape-A rule together in the single whole-branch fix dispatch rather than opening
Task 25 round 4 — why: both are rules in src/cli/lint.ts using the same isFile/walk vocabulary, so one
dispatch on one file with one review is strictly cheaper than a round 4 plus a whole-branch dispatch that will
touch that file anyway; and the escalation rule puts rounds 4-5 on a fresh implementer one tier up, which
would discard the accumulated context on this exact file to redo work the later dispatch already covers — cost
if wrong: two cheap lint rules land one gate later than they could have, with the half-authored-bank state
reading clean to anyone who types --allow-empty in the interim.`

So both are now **fix candidates for the single dispatch**, not findings to adjudicate: (1) an anti-solution
whose body is only comments, blank lines and `set -e…` does nothing — report it, pure text, no guest, fires on
nothing in the bank today; (2) gate the bank-load message on a named-path check rather than the grader count.

**One in-flight item deliberately left uncorrected.** `task-25-report.md`'s round-3 paragraph still says the
closing check "needs a guest, so it is a `harness.ts` feature," which is now half wrong — true of the
no-op-command shape, false of the comment-only one. The implementer flagged it and **declined to edit it while
the re-reviewer may be measuring against that file**, which is exactly the failure I named earlier on this
branch. Correct call. To be fixed after the re-review lands, and fixed by **splitting the two shapes rather
than deleting the sentence** — the NEW-2 treatment, which has held up best on this task.

**Credit where the findings came from.** Three of the four sharpest items on Task 25 came out of the closing
questions and the arguments that followed them, not out of the briefs: the third silent-green channel, the
fourth, and P35's real mechanism plus this formulation. The retraction is the one worth naming — it killed a
finding that flattered the implementer's own sweep, on its own initiative, after reading code it had already
reasoned about. The generalisable practice is not "ask a closing question" but **treat the answer as a claim to
check, including when it is a retraction that makes my own finding look better than it was.**

### Whole-branch brief housekeeping while Task 25's round-3 re-review runs — and one measured correction to target 1

Verifications done at `45344bd` before the final dispatch, in keeping with the standing practice *read the
code, not the report about the code, and not my own earlier note about it*:

- Plan Global Constraints reproduced in the brief: checked against the plan verbatim. Faithful (condensed).
- `package.json` scripts: shipped block matches the plan's Task 25 JSON exactly **except** one addition,
  `"lint:content": "node src/cli/index.ts lint"`, which is my own mandate 11 and is ruled in the ledger.
  Added to the brief's out-of-scope list so the reviewer does not spend a pass reporting a plan deviation
  that is a ruling. The `lint` command's *behaviour* stays in scope.
- The plan's external-blocker table says the ISO blocks **"Task 25 entirely"**, yet Task 25 is complete.
  Ruled and written into target 3 rather than left for the reviewer to trip over.
- P24 was measured at `28ad7f0` and `session.ts` took six more rounds afterwards, so I re-read the two
  load-bearing lines: `session.ts:569` `const incomplete = status.size < expectedTotal` and `:591`
  `allPassed: allPassed(v) && !incomplete` are unchanged in substance, and `verdict.ts:81`'s
  `checkpoints.length > 0` is still the only zero-guard. **P24 is live at HEAD.**
- Parked file line count 953 → 992 in the brief. 37 `## P` headings for 36 items: `P14` appears twice, the
  first labelled `(original entry, superseded)`. Intentional, labelled, left alone.
- P31 spot-checked at 431 tests (it was measured at 423 and 8 tests landed since): the five `rejects` in
  `test/vm/` are `select`, `config` and `SshTransport`'s own `/no IP/` — a transport rejecting *itself*, not
  a consumer handling a rejecting `exec`. P31 stands as written.

**The correction, and it is to the top item on the branch.** P29's parked text says the rail withholds while
Finish "stays enabled, deriving a rating from `report.allPassed`" — two surfaces disagreeing in the same
instant. Traced at HEAD, that is wrong in both directions:

- The rail is **better** than the note says. `Rail.tsx:93` derives
  `countSuspect = report.total > report.expectedTotal` and `verdictFor` (`:64`) returns `null` on it, so in
  P24's exact shape (`expectedTotal === 0`, checkpoints arriving) the visible verdict is already withheld and
  the amber box at `:170` fires. Half of P24's recommended item 2 is already built, client-side.
- The rating path is **worse**. `App.tsx:186` takes `done.rating` from the server; the server derives it at
  `app.ts:316-323` with `passed: report.allPassed` and **no countSuspect equivalent anywhere**. So the same
  report the screen refuses to score produces a rating that calls it a pass — and the rating is what
  persists into FSRS scheduling against a permanent objective id.

Restated: it is not two surfaces disagreeing, it is **the transient surface being right and the durable one
being wrong.** That is a sharper defect than the parked note describes and it changes the minimum fix from
"promote the warn into a field" to "make `deriveRating` withhold on the condition the rail already withholds
on" — plus its neighbours `anyPassed` and `hadRegression`, which come off the same suspect report.

New measured fact, mine: `grep -rn countSuspect src/ test/` → **five hits, all five in `Rail.tsx`, none in
`test/`.** The only guard standing between P24 and a student today is an untested client-side derivation.

`Ruling: rewrite target 1's P29 paragraph and its check-list rather than leave the parked note to speak for
itself — why: the note would have sent the most capable model to build a fix for a disagreement that is half
already fixed, while the half that reaches FSRS went unnamed; and an untested guard on the false-pass path is
worth a test whether or not the guard moves — cost if wrong: one rewritten section in a brief, against the
alternative of a single budgeted fix dispatch spending itself on the wrong half of the top item.`

Note P24's own recommended item 2 text is now partly stale for the same reason. Left in place in the parked
file deliberately — the brief carries the correction and says so, which is the treatment I endorsed on NEW-2:
record the wrong version as wrong rather than delete it.

**Precision correction to the entry immediately above, made before dispatching.** I wrote that P29 "is wrong
in both directions". That overstates it and is itself the citation-adjacent class. P29's substance is
**right**: the rating is derived from `report.allPassed`, and for a truncated run that is a false fail on a
lab the student may have solved. What is wrong is only its **locus** — it says "have Finish read that field",
and Finish derives nothing (`Rail.tsx:262-263` just calls `props.onFinish`; `App.tsx:186` takes `done.rating`
from the server). Both the brief and P29's parked entry now say locus rather than substance.

The sharper statement, which is what the brief now carries: **P24 and P29 are not two defects sharing a root,
they are one unguarded line — `app.ts:318` — reached from two directions.** Truncated run → `incomplete` true
→ `allPassed` false → a hard-shaped rating on a possibly-solved lab (false fail). Collapsed count →
`expectedTotal === 0` → `incomplete` false → `allPassed` true → a pass rating on a grader that died early
(false pass). One line, both directions, and the standing "do not reduce this to disabling Finish"
instruction is therefore a correctness point rather than a UX preference.

## Task 25 — round-3 re-review verdict: CHANGES REQUIRED. One load-bearing finding, and it re-opens the round-3 blocker.

`task-25-rereview2` (opus), range `7880164..45344bd`, report at `task-25-rereview-2.md` (21 964 bytes).
Method verified: all mutation in `/tmp/t25rr2` from `git archive 45344bd`, both files sha256-verified against
baseline after every mutation, repo `git status --porcelain` empty before and after, `HEAD` `45344bd`,
`git tag -l` empty.

**Gates all measured green:** typecheck 0; **431 passed / 35 files / 0 failed / 0 skipped** (+8, and the skip
count independently confirmed by grepping the log for `skip`/`todo` — no matches); `build:web` 0;
`lint:content` exit 0, **stderr 0 bytes**, `no problems in 5 grader(s)`, `graders checked: 5`,
`scripts with headers: 21`. Diff scope confirmed exactly two files; **`harness.ts` does not appear.** P32
confirmed not fixed (`lint.ts:130` still returns an empty `ParsedHeader` on an absent header).

**All four items landed and all four bite.** Highlights worth keeping:

- **Item 1 (NEW-1):** the fix holds. Mutation F — removing `if (graders.length > 0)` outright — kills exactly
  2 tests, round 1's and round 3's exit-0-under-the-flag tests, both on `expect(err).toBe('')`. So the
  implementer's stated reason for keeping the guard was **honest**, and the new exit-0 test is live rather
  than one that can never fail.
- **Item 3 (`setup.sh`):** Mutation B kills exactly 3, and two of them fail on `expect(r.code).toBe(1)` with
  `expected +0 to be 1` — meaning the rule is the *sole* reason those roots exit 1, the strongest form of
  kill. And the unrequested `stat`-not-`access` detail got its own single-property mutant: B2 rewrites
  `isFile` to exactly `access` semantics and kills **exactly 1** test, the directory-named-`setup.sh` one.
  A detail nobody asked for, correct, and it would not have survived silently.
- **Item 4 (`unreadable`):** the message distinction was checked **in both directions** with the arm left in
  place and only the string swapped, so each mutant changes one thing. Unreadable→absent kills 1;
  absent→unreadable kills **3**. Neither arm can adopt the other's message without a test dying. Also
  established that `EACCES` never reaches `scanFixtureDir` at all (`shellScripts` throws first), so
  **ENOTDIR is effectively the only practical route into that arm** — which makes the no-sudo fixture the
  right choice rather than a shortcut.
- **Sweep spot-checks, all three confirmed.** `validate` does exit 1 on `tasks.length === 0` before
  `loadVmConfig` — measured without a guest, stdout empty so line 270's `transport:` never printed, and
  since `.env.local` is absent a wrong ordering would have thrown on config rather than touched a VM. **So
  the sweep did not need a guest to be conclusive.** `coverage --strict` is floored **three times over**, not
  once; the implementer's stated reasoning covers one of the three, which the re-reviewer correctly called a
  completeness note rather than a finding. `inventoryGate` runs unconditionally at `harness.ts:305`. And on
  P35 the re-reviewer endorsed my widening without re-deriving it.

### NEW-3 — medium, false green on the bank, **load-bearing**. The finding.

The comment defending the surviving short-circuit says *"when `--allow-empty` says an unauthored root is
expected, an unloadable bank is that assertion being true rather than a defect."* **False twice.**
`--allow-empty` asserts *zero graders*, not an unauthored root — its own message at `lint.ts:459-460` says
"an empty **bank**". So the sentence infers a property of the **content** from a failure of the **loader**,
which is structurally the same inference error as the comment it replaced (bank property from walk result).
**The wrong-disclosure class, in the round that was supposed to close it.**

The consequence, which the comment never states, is worse than the wording. Measured: the stripped bank (5
`task.yaml`, 0 graders, 0 antisolutions) is exit 1 / 10 problems — but **add one broken `objectives.yaml`, or
delete `concepts/`, or make `tasks` a regular file, and it is exit 0 with 0 problems and empty stderr.** So
**NEW-1's exact channel is still open for any bank that fails to load**, reachable from a single YAML typo.
NEW-1 is closed only for banks that load.

**And the formulation I asked for exists, is two lines, and was implemented and measured by the re-reviewer:**
`if (graders.length > 0 || (await isFile(join(root, 'objectives.yaml'))))`. It reuses the `isFile` helper
*this very round added*. Measured: all three exit-0 holes become exit 1 with the parse error reported; the
bare directory, round 1's `emptyRoot()` and the bank-loads-zero-tasks case all **stay exit 0**; the stripped
bank stays exit 1/10; the committed bank stays exit 0; full suite **431 pass / 0 fail**. The weaker candidate
`files.length > 0` does **not** work — `emptyRoot()` contains a `setup.sh`.

**The convergence worth recording:** the P36 addendum required the phrasing *"this named file is absent"*
(a filesystem fact about a fixed path) over *"the walk found no `task.yaml`"* (NEW-1's shape one artifact
along), on the grounds that the two read identically in English and are not the same check. The re-reviewer,
working independently and by measurement, implemented **exactly the safe phrasing**. Two agents converged on
the precise distinction I had named as the trap.

### NEW-4 — low, not load-bearing. One clause.

*"the only input every rule in `checkFixtureFloors` reads"* is true only under the common-input reading;
`graders` is a second input, the `grade.sh` rule reads it (`lint.ts:346`) and the orphan rule **iterates** it
(`lint.ts:406`). "the one input every rule has in common" says it.

### Ruling: round 4, and it consolidates P36 and P35 shape A.

`Ruling: open Task 25 fix round 4 with a fresh implementer one tier up (opus), scoped to src/cli/lint.ts and
test/cli/lint.test.ts, carrying NEW-3, NEW-4 **and** P35 shape A — and treat P36 as superseded by NEW-3
rather than carried — why: NEW-3 is load-bearing and re-opens round 3's own blocker, so a round 4 is
mandatory regardless; my earlier venue ruling sent P36 and P35-A to the whole-branch dispatch on the stated
premise "rather than opening a round 4", and that premise no longer holds; all three items are rules in one
file sharing the isFile/walk vocabulary, so one dispatch plus one scoped re-review is cheaper than splitting
them across a mandatory round 4 and a whole-branch dispatch that would then touch the same file twice; and
the single whole-branch fix dispatch has exactly one budget which target 1 (P24+P29, now known to be larger
than parked) needs in full — cost if wrong: round 4 of 5 is spent, leaving one round of headroom, and three
items in one diff is more surface for a round 5 than one item would have been.`

`Ruling: exclude two adjacent items from round 4 — P35's shape-B static signal ("declares exactly the grade
script's # baseline-fail: set") and the correction to 03-wrong-lv.sh's overstated header — why: the shape-B
signal fires on a committed, deliberate, defended fixture, so as an error it is a false fail on the shipped
bank, and adding a warning tier to accommodate it introduces a new concept into this command inside a fix
round; and 03-wrong-lv.sh is a content file, so editing it in the same diff as a new content rule creates the
appearance (and the risk) of a rule tuned to its own fixture — cost if wrong: a committed header keeps
claiming the exit-code check closes a class it does not close, until the whole-branch dispatch corrects it.`

P36's parked entry and its venue ruling are now **superseded** — left in place with the supersession noted,
per the same treatment I endorsed on NEW-2: record the wrong version as wrong rather than delete it.

Round 4 dispatched to a fresh opus implementer (`task-25-fix-4`) with brief `task-25-fix-4.md`. Its closing
question is the narrower version of round 3's sweep: **is there anywhere else in `src/cli/lint.ts` where a
named-path fact and a walk result are used interchangeably?**

### Two deferred items, recorded so they are not lost

1. **`task-25-impl`'s report clause is still wrong and its fix is now blocked on round 4.** The `## Fix
   round 3` section of `task-25-report.md` says the closing check "needs a guest, so it is a `harness.ts`
   feature." That is half wrong: it holds for P35 shape B and not for shape A, which is statically closable
   with no guest — and round 4 is now implementing exactly that rule, which proves the point. The implementer
   agreed to fix it **by splitting the two shapes rather than by deleting the sentence.** `Ruling: hold that
   edit until round 4's implementer has finished appending its own section — why: both would be writing
   task-25-report.md concurrently, and a lost or interleaved append to the task's own record is a worse
   outcome than a stale clause that the parked file and round 4's brief both already contradict in writing —
   cost if wrong: the stale clause survives a few hours longer in a report nothing reads as authority.`
2. **The whole-branch brief's counters will need one more sync after round 4.** Range end, commit count, file
   count, insertion/deletion counts and the test count (currently `45344bd`, 60 commits, 188 files, 24 979
   insertions, 146 deletions, 431 tests) all move when round 4 commits. Do not update them until round 4's
   re-review approves, or they will be wrong twice.

### Three details from the re-reviewer's return message, sharper than what I first ledgered

The truncated summary message added nothing that contradicts the report (read in full at 21 964 bytes, which
is the authority), but three specifics are stronger than my entry above and are worth keeping:

1. **Round 1's exit-0 test is unchanged in the strongest available sense.** My brief asked only that it be
   confirmed genuinely unchanged, since weakening it was the cheapest way to make the NEW-1 fix look clean.
   Measured: the whole `describe` block is **byte-identical across the range**, sha256 `3ed21346…` on both
   sides, 62 lines, **no hunk in range** — and it calls `run()` directly, **bypassing the modified `lint()`
   helper**, so it could not have been weakened indirectly through the helper either. That closes the concern
   completely rather than probably.
2. **Mutation A's three kills were attributed per-assertion, not per-test.** #1 tripped on `r.code` (`+0` vs
   `1`, NEW-1's exact exit-0), #2 on `countProblems(...grade.sh) → 0` **with the earlier `r.code` assertion
   still passing**, #3 on the `setup.sh` message. That is the citation-adjacency discipline applied without
   being asked: this branch has five occurrences of a mutant credited to the wrong assertion, including one
   that tripped an *earlier* assertion in the same test.
3. **The "did `loadBank` running unconditionally create a new failure mode or crash path" question is
   answered, with the mechanism.** No, and for four stated reasons: a bare `catch (e)`; `loadBank`'s contract
   folds everything into one `ContentError`; `checkFixtureFloors`' placement outside the `try` is unchanged
   from before the commit; and both its filesystem helpers swallow. Behaviour confirmed on the two roots that
   matter — bank-loads-with-zero-tasks stays exit 0, and graders-plus-unloadable-bank is exit 1 while still
   printing `graders checked: 5` / `scripts with headers: 21`, with and without the flag. **So the fix removed
   a false green without introducing a crash-instead-of-report regression**, which was the specific edge I
   asked about rather than the one the finding came from.

No action follows from the message — round 4 was already dispatched with NEW-3, NEW-4 and P35 shape A before
it arrived, and its scope is unchanged by these details. Did not request the truncated remainder: the report
file is complete and is the artifact of record.

**P5 re-verified at `45344bd` and it is firmer than `CARRIED` low suggests.** Checked all three places a
`concept.objectives` id could be validated: `bank.ts:181` iterates `task.objectives` only;
`concept.ts:70-71` parses the concept's own list and requires it **non-empty** but never compares its entries
to `bank.objectives.byId`; and `src/cli/lint.ts` has **no reference to `.objectives` whatsoever**. `measured`.
So a concept card naming a typo'd or renamed objective id passes the loader, the lint and the coverage pass
while being exactly as unreachable from the disclosure ladder as the card with no objectives that
`test/content/concept.test.ts:42` explicitly rejects. Brief's target 2(a) tightened accordingly — the two
escape hatches I had left open for the reviewer ("maybe the loader or the lint checks it") are now closed by
measurement, so agreement costs them nothing and a genuine counter-example is what I asked for instead.

### Task 25 — round-4 re-review brief written ahead of the report (2026-08-31)

Wrote `task-25-rereview-3-context.md` while `task-25-fix-4` (opus, 7 min in) was still running, rather than
serially after its report lands. Nothing in the brief depends on what round 4 actually did — it depends on
what round 4 was *asked* to do, which is fixed. Only the sha and the review-package path get filled at
dispatch.

Three things went into it that are not in the fix brief, each because it is a reviewer-side question the
implementer cannot be asked to answer about itself:

1. **A regression direction nobody has requested a measurement for.** The item-1 fix is a *widening* of
   `if (graders.length > 0)`. Every measurement on record — mine, the re-reviewer's, the brief's eight-row
   table — tests that the widened guard now *catches* three roots it used to miss, plus that three exit-0
   cases are preserved. None asks whether the new arm prints a message on a root where `objectives.yaml`
   exists and the bank loads fine. That is the **false fail on a good root** direction, and the whole eight-row
   table is blind to it because every row either has zero graders or is already exit 1. Added as an explicit
   question the reviewer must answer.
2. **The seven stripper edge cases for item 3.** The fix brief states the rule and requires it fire on none of
   the sixteen committed anti-solutions; it does not enumerate what "nothing remains" must mean. Listed seven
   probes — whitespace-only line, trailing comment after a real command (`ls  # note`, must NOT fire), the
   `set -e` / `set -eu` / `set -o pipefail` variants, a `#!` shebang, a `#` inside a quoted string, CRLF — and
   named the directions: too aggressive is a false fail on legitimate content, too lax is the missed no-op.
   Item 3 is the only item on this task carrying real risk in *both* directions.
3. **The replacement comment gets read as adversarially as the one it replaces.** Item 1 *is* an instance of
   the wrong-disclosure class (≥11 on this branch), so the brief names the specific failure mode: a round that
   fixes a false comment by writing a second false comment has made things worse, and it would be the **third
   consecutive round** to do so. Two required properties: it must state the residual that remains, and it must
   keep the "this used to say X, which was wrong" treatment rather than silently deleting the wrong version.

Also carried forward from the fix brief as reviewer-side findings if violated: `objectives.yaml` phrased as a
walk instead of a named path, `files.length > 0` substituted, `harness.ts` in the diff, the shape-B signal
added, `03-wrong-lv.sh` touched. And the instruction to distinguish "this round did not do what it claimed"
from "here is a further thing I noticed" — **only the first justifies spending round 5**, which is the last.


### Correction + sharpening: target 6's membership lists, and the `as`-cast census (2026-08-31, measured at `45344bd`)

Verified target 6 before it goes into the final dispatch. Two outcomes: **my cast census was wrong for the
third time**, and **target 6 is a stronger finding than I had written**, for a reason I had not found.

#### The cast census, corrected

I have claimed twice that `src/` holds **thirteen** `as` casts, "every one guarded by a predicate immediately
above it, and that record is worth keeping." Both numbers are wrong, and the characterization is wrong. The
real figure is **16 cast expressions across 14 lines in 6 files**, in five distinct classes:

| class | count | sites |
|---|---|---|
| sound, guarded by an elementwise check that tests exactly what the cast asserts | 3 | `concept.ts:36`, `task.ts:54`, `objectives.ts:70` |
| **guarded by a stale-able list** — sound today, nothing links the list to the union | **4** | `task.ts:96`, `task.ts:101`, `task.ts:108`, `verdict.ts:29` |
| benign coercion to `string` to satisfy `readonly string[].includes(unknown)` — asserts no narrowing | 6 | `task.ts:96,97,101,102,107,110` |
| sound, cast only because `Object.hasOwn` is not a type predicate | 1 | `config.ts:54` (validated at `:39-43`, which throws) |
| catch-block error-shape assertion, followed by defensive `code ?? 1` / null checks | 1 | `vmrun.ts:49` |
| unguarded by design, documented | 1 | `api.ts:201` |

So "every one guarded by a predicate immediately above" was **false**: `vmrun.ts:49` and `api.ts:201` are not,
and the six `as string` coercions are not narrowing assertions at all. This error is live in
`task-25-fix-4.md`'s style section. **It does not change what round 4 must do** — it sits in an advisory
sentence whose actual instruction ("avoid `as` casts") remains correct — so I am not interrupting a running
implementer to correct a parenthetical. It must not reach the whole-branch brief, which is where I am fixing it.

That is three consecutive wrong statements about this one number. The pattern is that I keep reporting a count
from a regex I chose without checking what the regex included: the first counted comment prose, the second
assumed a uniform guard shape I never inspected. **Counting is not measuring.**

#### Target 6, sharpened — the finding is a violated in-repo convention, not a style preference

The codebase **already has the safe idiom, twice, each with a comment explaining exactly why it exists**:

```ts
// src/engine/vm/config.ts:20-22
// Exhaustive by construction: adding a TransportKind fails to typecheck until
// it is listed here, so this list cannot drift out of sync with that type.
const KINDS: Record<TransportKind, true> = { ssh: true, vmrun: true, fake: true }
```

and `src/server/app.ts:29-31`, whose comment **explicitly cites the first as its precedent** ("the same way
config.ts's KINDS is"). `app.ts:38-40` is the template predicate, and it is the shape that makes the cast
unnecessary rather than merely safe:

```ts
function isSessionMode(v: unknown): v is SessionMode {
  return typeof v === 'string' && Object.hasOwn(MODES, v)
}
```

So this is not "introduce a better pattern." It is: **an established, documented, twice-applied convention in
this codebase, with four sites violating it.** That is a far easier finding to land and much less likely to be
redesigned by an implementer than a bare style note.

#### Six lists, three exposure levels — and the reason "fix the four" is not the whole instruction

| idiom | drift on a *removed*/renamed member | drift on an *added* member | sites |
|---|---|---|---|
| `Record<Union, true>` | compile error | compile error | `config.ts:22`, `app.ts:31` |
| `readonly Union[]` | compile error | **silent, list short** | `ladder.ts:33` (`readonly Rung[]`), `expectations.ts:10` (`readonly ExpectPhase[]`) |
| `readonly string[]` | **silent, and the cast it guards becomes a lie** | **silent** | `task.ts:10,11,12`, `verdict.ts:17` |

The four to fix are the bottom row — they have no compile-time link to their union at all, and each guards a
cast four to sixteen lines below its own union declaration in the same file. But **the middle row must be named
in the brief too**, or the next author fixes four sites, sees the class closed, and leaves two behind that fail
in one direction. `RUNGS` is consumed at `app.ts:255` to build the full rung list served to the client, so a
silently short list there means disclosure content the student can never reach.

`Record<Union, true>` is the wrong mechanical fix for the middle row — both are ordered arrays and `RUNGS`'
order is load-bearing at `app.ts:255`. Deriving the array from a record, or adding an exhaustiveness
assertion, is the shape there. Flagging this so an implementer does not convert them into records and break
ordering.

#### The direction that makes the bottom row worth fixing rather than tidying

For the four, two independent failure directions, and the second is the one my earlier note missed:

- **Union gains a member, list not updated** → valid content rejected. A **false fail on the bank**, silent.
- **Union loses or renames a member, list keeps the old string** → `includes` passes, and the cast then asserts
  a type the value does not have. An invalid value enters typed code as if valid, with no compile error and no
  runtime error at the boundary. For `verdict.ts:29` that means a checkpoint status outside
  `CheckpointStatus` reaching `allPassed`, which is the grading path — **a false pass**, the worst direction on
  this project.

`Ruling: target 6 keeps all six lists, fixes the four, and names the two — the finding is "a documented in-repo
convention has four violators", cited to config.ts:22 and app.ts:31, with app.ts:38 as the template. Why: an
implementer handed a violated local convention with a working template does transcription; one handed a style
preference redesigns. Cost if wrong: the two typed lists get converted to records and RUNGS' ordering breaks at
app.ts:255 — caught by the re-review, since the brief names the ordering as load-bearing.`

`Ruling: TaskTransport ('ssh'|'vmrun') and TransportKind ('ssh'|'vmrun'|'fake') stay separate — the content
schema deliberately excludes 'fake', which is a test transport. The brief must say so, because the two lists
sit 4 lines apart in files that both mention transports and "unify them" is the obvious wrong move. Cost if
wrong: a bank could declare transport: fake and load, putting a task that never touches a VM into a graded
session.`

### NEW whole-branch finding, found by answering my own target-1 question: the app tells the user their rating is recorded, and nothing records it (2026-08-31, `MEASURED` at `45344bd`)

Added to the whole-branch brief as **target 2 invariant (e)**, and to target 5 as a fix-dispatch item.

I had added a check bullet to target 1 asking "what happens to a rating once written?" — intending it as
severity input for P29 (a truncated run derives a false-fail rating at `app.ts:318`). Tracing it answered a
different and better question.

**Measured, three independent ways:**
- `grep -rniE "fsrs|scheduler|schedule" src/` matches **exactly one file**, `src/web/App.tsx`, and only inside
  display strings. There is no scheduler in this codebase.
- `src/server/` contains **no** `writeFile`, `appendFile`, `mkdir`, `createWriteStream`, sqlite or database
  call. Zero disk writes.
- Sessions live in `#byId = new Map<string, SessionRecord>()` at `session.ts:611`. In-memory only.

The rating's entire lifecycle: derived `app.ts:316` → returned in JSON `app.ts:326` → React state
`App.tsx:186` → rendered as text. Nothing else. A reload loses it; a restart loses everything.

**This is correct and deliberate.** The plan's Architecture paragraph: *"only user history would go in SQLite
(deferred to Phase 2)."* And `docs/exit-criterion.md:226-229` states the limit exactly right — *"FSRS is
implemented and rated but nothing schedules from it yet"*, *"the ratings recorded above are not yet stored
anywhere."*

**The UI contradicts the doc, and the doc is right:**

| site | text | true? |
|---|---|---|
| `Rail.tsx:240` | "This attempt is finished and **its rating is recorded**." | No. Nothing records it. |
| `App.tsx:279` | "**Scheduler** rating: `<rating>`" | No scheduler exists. |
| `App.tsx:291` | "would change the report this attempt **was recorded against**" | Defensible — the report is held in the in-memory session for its lifetime. Left to the reviewer; I lean fine. |

**Why this one matters more than its size suggests.** It is the wrong-disclosure class (≥11 occurrences on
this branch) landing in **user-facing copy for the first time** — every prior instance was a code comment read
by the next author. This one is read by the person studying for a $400 exam, and it tells them their attempt
history is being kept when it is not. For an app whose whole stated purpose is to replace the book and track
what still needs practice, "your rating is recorded" invites reliance on a study record that does not exist and
vanishes at the next restart, with nothing in the interface ever contradicting it.

It is also the cleanest possible justification for target 2 existing at all: **Task 25 wrote the doc that gets
it right, an earlier task wrote the copy that gets it wrong, and neither reviewer saw both files.** No
task-scoped gate could have caught it. Verified not already parked (no match for "is recorded" / "scheduler
rating" / "not persisted" in `whole-branch-parked.md`), so it is genuinely new at review round 26.

`Ruling: the fix is copy-only — correct the strings to match Phase 1 reality ("rated, not yet stored; Phase 2
schedules from this"). Not persistence. Why: the plan defers user history to Phase 2 by name, and building a
store inside a copy fix is exactly the scope creep the single fix dispatch cannot absorb. Cost if wrong: the
user studies for another week without a retained record — which is already true today and is disclosed in
exit-criterion.md, so the ruling costs nothing that is not already the status quo.`

**Severity note against P29, which was the original question.** The same trace lowers P29's severity: since no
rating is persisted and no scheduler consumes one, a false-fail rating under truncation does **not** corrupt a
permanent FSRS scheduling key. Its blast radius is one line of displayed text in one finished attempt. P29 is
still a real defect at `app.ts:318` and still worth the joint fix with P24, but the "objective ids are
permanent scheduling keys, so a wrong write cannot be cleaned up" framing does **not** apply to it — that
framing belongs to invariant (a), which is about ids, not ratings. Corrected in the brief rather than left to
inflate target 1.


### Task 25 — fix round 4 returned; round-4 re-review dispatched (2026-08-31)

`task-25-fix-4` (opus, fresh implementer one tier up) went **idle without its completion notification
reaching me**. Caught it via `ListAgents` reconciliation rather than by waiting — the skill's "chase any that
finished without reporting" step earned its keep. Verified state directly instead of trusting a report I never
received: commit **`4312359`**, one commit on `45344bd`, exactly `src/cli/lint.ts` (+118/-8) and
`test/cli/lint.test.ts` (+77/-5), tree clean, `git tag -l` empty. All three constraints held.

Gates as reported: typecheck 0; **433 passed / 35 files / 0 failed / 0 skipped** (was 431, +2 — one test per
code item, none for item 2 which is comment-only); `build:web` 0; `lint:content` exit 0, stderr 0 bytes,
`no problems in 5 grader(s)`, `graders checked: 5`, `scripts with headers: 21`.

Four mutants claimed: M1 (revert the `|| isFile` clause) kills 1 on `expect(r.code).toBe(1)`; M2 (guard removed
outright) kills 2 on `expect(err).toBe('')` — reproducing the re-reviewer's Mutation F exactly, which is the
anti-weakening check; M3 (item-3 rule unreachable) kills 1; M4 (the `SHELL_OPTION_LINE` skip clause dropped)
kills 1, isolating the one non-obvious clause. All to be independently verified.

**Three things in this report are worth more than the fixes.**

1. **Round 4 declined to claim a kill count for item 2 and said why:** *"There is no mutant of it and no test
   that could hold it, which is precisely why the wrong wording survived a round — the only gate on a comment
   is a reader."* That is the correct answer and the first time on this branch an implementer has named the
   absence of a gate rather than manufacturing evidence of one. The re-review brief hands item 2 to the
   reviewer as read-only work for exactly this reason.
2. **The false comment had propagated into a second file.** Round 4 reports `test/cli/lint.test.ts:585` (now
   `:650`) carried the false sentence **verbatim** — *"at zero graders an unloadable bank is the flag's
   assertion being true"* — and that after the fix it describes behaviour the code no longer has. If true, the
   wrong-disclosure class did not merely recur, it **replicated**, and four review rounds read past the copy.
   Flagged in the re-review brief as the single highest-value check, settleable with
   `git show 45344bd:test/cli/lint.test.ts`.
3. **The closing question produced a real answer with a measured divergence** — see the new parked item below.

Generated the review package (`review-45344bd..4312359.diff`, 18 628 bytes) and dispatched
**`task-25-rereview3`** (opus) with `task-25-rereview-3-context.md`. That brief was written *before* the report
landed, then extended with a second half — "What round 4 actually claims" — carrying the moved line anchors
(`:569` guard, `:312` `isFile`, `:222` `changesNothing`, `:213` `SHELL_OPTION_LINE`, `:670` application), the
four mutants as a table to reproduce, the four-row residual table, and the two unrequested-but-in-scope items
to judge rather than assume wrong.

`Ruling: held the queued instruction to task-25-impl (fix the stale "needs a guest, so it is a harness.ts
feature" clause in its round-3 section) until the re-review finishes. Why: task-25-report.md is a live input to
a running review, and a concurrent write into a file being read is a worse failure than a few minutes' delay —
this branch has already produced one confident wrong answer from measuring a tree another agent was editing.
Cost if wrong: nothing; the clause is stale prose in a report nobody acts on, and the delay is bounded by one
review.`

### P37 (new, `CARRIED` — pending `task-25-rereview3`'s independent verification): the content gate asks a named-path question and accepts a walk's answer, and the two disagree about symlinks

Round 4's answer to its closing question, which was: *now that you have the named-path-vs-walk distinction in
hand, is it used interchangeably anywhere else in `src/cli/lint.ts`?* It swept every filesystem-derived fact in
the file in both roles — as the question asked and as the answer supplied — and found **one** site.

**`!graders.has(join(task.dir, 'grade.sh'))` at `lint.ts:375`.** The *question* is a named-path fact — is there
a readable `grade.sh` at this exact path — and the *answer* comes from the walk. Claimed divergence, both ends
measured by round 4: `shellScripts` filters on `entry.isFile()`, which does **not** follow symlinks; `isFile`
uses `stat`, which does. So on a bank copy with `014-grow-home-lv/grade.sh` replaced by a symlink to a real
script: `graders checked: 4`, exit 1, 4 problems (`014-grow-home-lv is in the bank but has no grade.sh` plus
three `no sibling grade.sh`). The same substitution on `setup.sh` — which *is* checked by named path — gives
exit 0, 0 problems. And `loadTaskScripts` reads both with `readFile`, which follows symlinks, so **`isFile`'s
answer is the one that matches the runtime** and the walk's is the one that does not.

**Round 4's argument for why it is not a defect, which is the sharpest reasoning any implementer has produced
on this task and which I am endorsing pending verification:** NEW-1's shape is a walk supplying the
**expectation**. Here the expectation comes from `bank.tasks` and the walk supplies only the **observation** —
the same architecture as the `setup.sh` rule beside it, which is endorsed. A walk that under-reports an
observation against an independent expectation makes the rule fire when it should not: a **false fail**, loud.
A walk that supplies the expectation makes the rule not fire at all: a false green, silent. **Direction, not
structure, is what separates them.**

That sentence is a genuine addition to this branch's vocabulary. Every prior formulation of the named-path/walk
distinction was structural — *where does the precondition come from*. This one says the structure alone does not
decide it; you also have to ask which way it fails. It retroactively explains why the `setup.sh` rule and the
`grade.sh` rule can share a shape and only one of them be a problem.

`Ruling: P37 is parked for the whole-branch review, not fixed in Task 25. Why: it fails closed in every case
constructed so far, nothing in the committed bank symlinks a grader, and Task 25's gate is whether items 1-3
landed — a question answered with a measured divergence is the question working, not a failure. Cost if wrong:
a future bank that symlinks a grade.sh gets a spurious exit 1 on the content gate, which is loud, attributable
and cannot reach a student as a false pass.`


### Task 25 — three round-4 claims settled by the controller, independently of the running re-review

Measured at `4312359` while `task-25-rereview3` was in flight, so the verdict can be
adjudicated against facts rather than against the report's own account of itself.

1. **Round 4's removed-lines claim holds.** `awk` over the review diff, restricted to the
   `test/cli/lint.test.ts` hunk, returns exactly four removed lines — the four false comment
   lines and nothing else. This settles two separate reviewer checks at once: the two exit-0
   tests (round 1's `describe('rhcsa lint fails when there is nothing to check')` and round 3's
   `still exits 0 under --allow-empty on a root with no bank at all`) cannot have been weakened,
   because nothing was removed from them; and the twin false comment was genuinely a comment
   replacement, not a test edit wearing one. Forwarded to the re-review as a claim to verify,
   and separately verified here.

2. **The Part-A regression direction is answered: no false fail is possible.** This is the one
   direction on item 1 that no round measured and no table covered. The widened guard at
   `lint.ts:569` sits *inside the `catch`* — the surrounding block dispatches on
   `e instanceof ContentError`. A root whose `objectives.yaml` exists and whose bank loads
   cleanly never reaches line 569 at all, so widening the condition cannot make the command
   print on a healthy root. The widening is reachable only on the load-failure path, which is
   the only path it was meant to affect.
   `Ruling: item 1 carries no false-fail risk — the guard is catch-local, so its condition is
   evaluated only after the loader has already failed — why: read directly at lint.ts:569 in
   its enclosing catch, not inferred from the diff or from round 4's tables — cost if wrong:
   a lint that fails on a healthy authored bank, which is a loud failure the first `npm run
   lint` would surface, not a silent one.`

3. **The residual is stated, and stated well.** `lint.ts:540-549` names it explicitly — zero
   graders *and* no regular file at `objectives.yaml` still suppresses the message — and goes
   further than required: it distinguishes a deleted `objectives.yaml` from a directory or
   broken symlink at that path, and notes that a present-but-unreadable file *does* report
   because `stat` succeeds. Both prior wrong versions of the comment are preserved in place
   with the reason each is wrong, which is the practice this branch adopted for the
   wrong-disclosure class. The shorter twin in the test file implies the residual via its
   "whenever `objectives.yaml` is there" clause rather than stating it; that is acceptable
   because the full statement lives at the code site, and the twin's job is to pin the
   grader-present half.
   `Ruling: the test-file twin need not restate the residual — why: the residual belongs to
   the guard, and duplicating it is how the first wrong disclosure came to exist in two files
   — cost if wrong: a reader of the test alone under-estimates the residual, mitigated by the
   twin naming the guard it mirrors.`

Consequence for round 5: of the re-review's report contract, the regression question, the
twin-comment check and the two exit-0 checks are now settled independently. A round-5 request
resting on any of those three needs to disagree with a measurement, not merely with round 4.

### Task 25 — fix round 4 re-review: **APPROVED** (`task-25-rereview-3.md`, opus, 4312359)

The first round on this task whose report the reviewer could not break on the numbers: every mutant,
every table row, every count and every quotation reproduced. It also confirmed round 4's headline
claim — the false disclosure had propagated into `test/cli/lint.test.ts`, the check the brief called
the highest-value one in the review.

Four findings, **none justifying round 5**, so the fix loop closes at round 4 without tripping the
breaker at 5.

- **FINDING 1 → parked as P38.** `lint.ts:519` says "The rules ran unconditionally above and nothing
  here can suppress them." The floors call is at `:575`, *outside* the `try`/`catch` and gated on
  `bank !== undefined`; inside the `catch` `bank` is `undefined`, so on the only path that reaches
  this sentence the rules did **not** run. The intent is true (the condition governs only whether a
  line is pushed, and the floors are not gated on `graders` — round 3's fix) but the indicative past
  tense asserts something false in that branch, and it invites exactly the inference that produced
  NEW-3. Mitigated twice by the same comment, both times correctly. Low, one word to fix.
- **FINDING 2 → parked as P39.** `SHELL_OPTION_LINE = /^set\s+[-+]/` at `:211` is start-anchored
  only, so `:225` discards the whole line — `set -euo pipefail; sudo lvextend -L 12G /dev/rhel/home`
  is reported as `nothing here but comments and shell options`. A **false fail on content**: a
  fixture that does real work, rejected. Not load-bearing (no committed fixture uses that style; the
  rule fires on none of the sixteen), but this is item 3's flagged risk direction actually
  materialising, and the constant's own comment is adjacent to the cause.
- **FINDING 3 — informational, ruled correct.** Two roots move exit 0 → exit 1 that the eight-row
  table does not cover: `objectives.yaml` present with `tasks/` not yet created, and with `concepts/`
  missing. `Ruling: both are correct behaviour, not regressions — why: they are the semantic the
  comment states (the manifest is present, so a loader failure earns a line) and the same class as
  the already-approved row 5; and the root --allow-empty genuinely documents itself for, with no
  objectives.yaml at all, still exits 0 in every form tested — cost if wrong: a lint that fails on a
  root mid-authoring, loud on the first run, not silent.`
- **FINDING 4 — wording only.** Round 4's report said the test file repeated the false sentence
  "verbatim". The false *proposition* propagated; the sentences differ. Its quotation of the test
  file is exact and its falsity judgment correct, and the report places both versions side by side,
  so nothing is concealed. Substance stands.

Two citation slips in the re-review itself, both immaterial and both in the family this branch keeps
re-encountering: it cited the floors call at `:573` (actually `:575`) and I had earlier recorded
`SHELL_OPTION_LINE` at `:213` (actually `:211`). Each structural claim verified at the corrected
line, so neither changes a verdict — recorded because "the number was two off but the claim was
right" is how a citation that proves something adjacent to its claim gets waved through.

`Ruling: close the fix loop at round 4 and mark Task 25 complete rather than spending round 5 on P38
and P39 — why: both are Low, neither is load-bearing, and both are one-line edits in a file the
whole-branch fix dispatch already opens for target-6 and P35 work, so spending the last round buys
two edits that arrive anyway one dispatch later — cost if wrong: P39's false fail reaches a future
fixture author who writes set-plus-command on one line, who sees a loud wrong rejection with the rule
named in the message.`

**Task 25: complete.** HEAD `4312359`; tree clean; whole branch now 61 commits, 188 files,
25 148 insertions, 146 deletions.

P38 and P39 appended to `whole-branch-parked.md`, which now runs P1-P39.

## Whole-branch review dispatched — the last gate

All twenty-five tasks are complete. Range `6791d4d` (`master`) `..4312359` — **61 commits, 188 files,
25 148 insertions, 146 deletions**. Suite at HEAD measured directly: **433 tests / 35 files, all passing,
0 skipped** (confirms round 4's +2). Tree clean, `git tag -l` still empty, so mandate 1 holds — the
`phase-1` tag remains the user's to create.

Diff package: `review-6791d4d..4312359.diff`, 28 887 lines / 1 186 376 bytes.

Reviewer `whole-branch-review`, **opus** — the most capable available model, per the skill's rule that the
final whole-branch review does not take the session default by omission but is chosen explicitly.

Brief synced to HEAD before dispatch, five edits:
- Range end, commit count and insertions updated; the 433/35/0 suite line added to the gates section with
  the note that a different number means the tree moved or one of us is wrong.
- A provenance paragraph added at the top explaining why most citations say `45344bd`: the last commit
  touches only `src/cli/lint.ts` and `test/cli/lint.test.ts`, so nothing in targets 1, 2, 4, 5 or 6 moved —
  but a `src/cli/lint.ts` claim carrying that sha must be re-measured, because that file did move.
- Parked file 1131 → 1205 lines, P1-P37 → **P1-P39**, with P39 flagged as the one parked item whose
  direction is the loud kind.
- Target 5 gained P38 and P39 as fix-dispatch items, with P39 first and the instruction that taking the
  regex fix requires fixing the constant's comment in the same edit.
- **Four round-4 questions marked settled so the reviewer does not re-derive them**: the guard is a
  named-path check; it carries no false-fail risk because it is catch-local; only four comment lines were
  removed from the test file; P35 shape A shipped and fires on none of the sixteen. Disagreeing with any of
  those now requires disagreeing with a measurement and naming the command.
- The diff-package entry now carries its real size and the instruction to prefer reading files at HEAD,
  since 25 148 insertions against 146 deletions means for almost every file the diff *is* the file.

`Ruling: sync the brief's counters at Task 25's approval rather than at each fix round — why: five of the
six counters moved on every round, and a brief that is authoritative about a stale number teaches its
reader to distrust its numbers generally, which is the one thing this brief cannot afford given the cast
count was wrong three times — cost if wrong: a reviewer who started before the sync would have measured
against 431/60/24 979 and reported a discrepancy that was mine, not the code's.`

Also sent `task-25-impl` the held correction to its own report: the `## Fix round 3` clause saying the
closing check "needs a guest, so it is a `harness.ts` feature" is now half wrong, because round 4 shipped
shape A statically in `lint.ts`. Instructed to **split the two shapes rather than delete the sentence** —
shape A is decidable from the script text and now lives in `lint.ts:211/:222/:670`; shape B needs a guest,
stays in `harness.ts`, and is still unimplemented (`harness.ts:206` treats a non-zero fixture exit as an
error; `:199` skips an empty script outright). Report-file edit only, no code, no commits.

Next: the review's verdict, then at most one fix dispatch and one scoped re-review, then
`superpowers:finishing-a-development-branch`.

**`task-25-impl`'s report correction is applied** (`task-25-report.md:791-812`, verified by reading, not by
its word — it went idle without reporting). It split the collapsed claim rather than deleting it, kept the
original sentence visible as the version a returning reader would remember, and attributed each half
correctly: shape A decidable from script text and now shipped at `lint.ts:211/:222/:670`; shape B needing a
guest, staying in `harness.ts`, still unimplemented with `:206` and `:199` cited. It also went one step
past the instruction and narrowed its own earlier "live on the shipped bank" wording, naming the thinnest
three committed fixtures as carrying exactly one real command each. That is the same overstatement I had
separately recorded as too strong, corrected at the source by its author. Pending item closed.

## Whole-branch review returned: **CHANGES REQUIRED** (`whole-branch-review.md`, opus, 39 319 bytes)

Fifteen ranked findings, **two S1**, tree left clean, nothing committed — it respected the read-and-measure
contract. Gates passed at 433/35/0. It is the strongest review on this branch: it labelled every conclusion
`MEASURED` or reasoned, recorded its own mid-review errors in an appendix, and listed what it did not measure.

**The two S1s are one problem seen twice.**

1. **Partial deflation of `expectedTotal` is reachable and trips no guard.** P22's claim that every heredoc
   fail-open zeroes the count rather than deflating it is **false**, and this is the third time P22's
   mechanism has been wrong in the same direction — under-estimating the fail-open's reach. Method: a single
   injected `cat <<NOPE` swept across every insertion point in `019-httpd-alt-port/grade.sh` yields counts of
   **0,1,2,3,4,5,6,7 and 8** depending on position; zeroing holds only when the swallowing line precedes the
   first `ck_*`. Driven through the real `reportFor`, a deflated count reads clean on **every** existing
   signal: `incomplete` false, mandate 10.5's `console.warn` silent, `countSuspect` false, `verdictFor`
   returns `'pass'`. **A grader that died three checkpoints into eight reports a clean pass, on screen and in
   the rating.** The collapse-to-0 case P24 documents is the only member of the class that trips anything.
   So the parked joint fix — refuse at count 0, promote the warn, have the rating read it — is *necessary and
   insufficient*: it closes the collapse and does not touch the deflation.
2. **`deriveRating` consults no suspicion signal** (`app.ts:316-323`), confirmed as the brief traced it, and
   the brief's own correction confirmed: nothing persists a rating, blast radius is one line of displayed
   text. Still a wrong truth-claim; still in the joint fix; **nobody should "fix" it by building persistence.**

The sufficient shape it derived, which I accept: stop trusting `expectedTotal` as a lone witness and
cross-check it against the grader's **declared header set** (`# baseline-fail:` + `# unprobed-invariant:`) —
an independent source of truth that already exists, that `rhcsa lint` already computes, and that a deflated
lexer count disagrees with. Its safety constraint is equally important: **withhold the verdict and the
rating, never withhold the exit** — a refusal at grade time must leave the session closable.

**Two corrections to my own brief, both measured, both accepted, both re-verified by me independently.**

- The `countSuspect` claim was **false**. I wrote that the only guard between P24 and a student was an
  *untested* client-side derivation and that the fix dispatch must add a test for it. I verified the
  reviewer's refutation myself in a `/tmp` copy of `4312359`: mutating `Rail.tsx:93` to
  `const countSuspect = false` gives **2 failed | 18 passed**, killing the count-mismatch test and the
  declared-count-of-zero test — the latter being literally P24's shape. I inferred absence of coverage from
  absence of an *identifier*; a test driving a component through props never names an internal variable.
  This is defect class (b) committed by me **in the sentence that dispatches remediation work**, which is
  the worst place for it: it would have spent fix budget writing a test that exists while the two things
  with genuinely no coverage got none. Corrected in the brief in place, with the wrong version preserved.
- **Target 6's ranking was inverted and one table cell wrong.** Removal from `CheckpointStatus` is *not*
  silent — `TS2367` at `grader.ts:113` and `harness.ts:140`, plus two named tests. The silent removal site
  is `task.ts`, which I called "milder": tsc's only error is in a test fixture, and once the developer fixes
  the literal the compiler points at, the build is green with a dead string still in `SCOPES`. So my sharp
  row is double-guarded and my mild row is the silent one. What survives is the **addition** direction on
  `verdict.ts` — silent at tsc 0 / 433 passing — and that is the half that composes with deflation into a
  false pass. Corrected in place.

`Ruling: the "one fix dispatch" budget is spent as one fix ROUND containing two sequential dispatches, not
one — why: the S1 pair plus the membership lists is interlocking design work that needs opus and needs to be
reasoned about as a single mechanism (the reviewer's own words: "the two findings are one finding seen from
the type system and from the lexer"), while nine of the remaining findings are transcription-grade copy,
comment and one-liner edits that would be done sloppily in the same breath as a design change and do not
need opus; they cannot run in parallel because both touch Rail.tsx and verdict.ts, so they run in sequence
and get ONE scoped re-review over the combined range — cost if wrong: one extra dispatch's tokens and one
extra commit boundary, against the alternative of a 13-item single diff in which the S1 fix is the item most
likely to be rushed.`

`Ruling: P18 (extract a shared lexBash) stays out, as the reviewer ranked it — why: it is the strongest
structural item on the list and the right fix for P19, but rewriting the lexer that the deflation finding is
*about*, in the same round that fixes the deflation, means the fix and the refactor cannot be reviewed apart
— cost if wrong: three hand-rolled lexers with one known divergent twin persist into Phase 2, which the
reviewer names as the first item of the next round rather than a residual to forget.`

`Ruling: F14 (deleting a whole task directory leaves lint at exit 0) is parked, not fixed — why: closing it
needs either a manifest or a task-count floor, and which one is a design decision about whether the bank has
an authoritative index, not a one-liner; the third instance of "the filter matched nothing and passed" is
worth a design pass, not a patch — cost if wrong: a whole deleted task stays invisible to lint until Phase 2
notices, in the false-green direction on the bank rather than on a student.`

BASE for the fix round: **`4312359`**.

## Fix round 1, dispatch A — BLOCKED on expired credentials, partial work preserved

`fix-a` (opus) died mid-work with: *"API Error: The SSO session associated with this
profile has expired. To refresh this SSO session run aws sso login with the
corresponding profile."* This is a host credential failure, not a plan or code failure.

**Landed before it died — 3 of 5 findings, verified present in `git log`:**

| sha | finding | subject |
|---|---|---|
| `1f6afb4` | F1 (S1) | grading: cross-check the checkpoint count against the grader's own headers |
| `4198603` | F3 (S2) | lint: fail on a checkpoint id no header anywhere in the task names |
| `7e9b7c1` | F4 (S2) | server: refuse to serve a bank whose references do not resolve |

Combined: 15 files, +968/-102. New files `src/server/config.ts` and
`test/server/config.test.ts`. Both of A's rulings are implied by the commit subjects —
F3 chose *error* over reconcile, F4 chose *refuse to serve* over log-loudly — but A never
wrote `fix-a-report.md`, so its stated reasons are lost. The re-review must derive them
from the diff rather than take them on trust.

**F6 was complete but uncommitted.** I read both diffs in full before deciding. Both
files were finished work, not a half-edit: every `as string` coercion and every `as` cast
gone, a narrowing predicate per union, the `Object.keys(...)` message idiom so a new
member appears in the error text for free, and **both documented traps honoured** —
`TRANSPORTS` keyed by `TaskTransport` with the reason written at the site (a `TRANSPORTS`
exhaustive against `TransportKind` would accept `transport: fake`, a false pass by
construction), and `verdict.ts`'s comment stating the *unc*omposed direction correctly (a
rejected line is filed as noise, `expectedTotal` exceeds arrivals, `incomplete` fires → a
false **fail**).

Ruling: commit it, as `3670925`. — Uncommitted work in a git-ignored-adjacent tree is one
`git clean -fdx` from gone, and this tree's workspace is git-ignored scratch that the
skill explicitly warns `git clean` destroys; a commit on a feature branch is trivially
revertable while a lost diff is not. The commit message states its own boundary: it does
**not** cover `RUNGS`/`PHASES`, which need an exhaustiveness assertion beside the ordered
array rather than this conversion, because `RUNGS`' order is load-bearing at
`src/server/app.ts:255`. — If wrong, the cost is one commit to revert and an accurate
attribution note; the alternative risked silently losing correct work and re-spending
opus budget to rewrite it.

**F2 is genuinely NOT done.** Verified by reading, not inferred from A's silence —
`src/server/app.ts:356` still passes `passed: report.allPassed` into `deriveRating` with
no suspicion signal consulted. This is one of the review's two S1 findings and it stays
open.

Tree state at `3670925`: `npm run typecheck` clean, `npx vitest run` **455 tests / 35
files / 0 skipped**, up from the 433 baseline. Working tree clean, 0 modified files.

**Delegation appears to be down host-wide**, not just for `fix-a`: a haiku `cred-check`
probe and a second probe both went idle without returning a word. Two independent
dispatches producing nothing is weak but real corroboration that the credential failure
is at the host boundary rather than inside one agent.

Ruling: stop dispatching and surface this to the user rather than working around it. —
The remaining sequence is F2, then dispatch B, then a scoped re-review, then
`finishing-a-development-branch`. F2 and B are implementation work I could in principle
do inline, but **the re-review cannot be**: the skill forbids self-approval, and a
whole-branch fix round reviewed by its own author is exactly the defect class this branch
has spent five rounds cataloguing — a gate reporting agreement because it never looked at
the thing with independent eyes. Doing F2 and B inline to "save time" would buy an
unreviewable diff. — If wrong, the cost is idle wall-clock until the user runs
`aws sso login`; if I had guessed the other way, the cost is a branch that finishes
without a real review gate, which is the whole point of the process.

### CORRECTION — F2 was done all along; my "verified NOT done" was false

The entry above says, twice and emphatically, that F2 was not done and that I had
established this *by reading rather than by inferring*. **That is wrong.** The wrong
version is left standing above because a reader who remembers it needs to find the
correction where the claim was.

F2 is done. `src/server/app.ts:353`:

```ts
let rating: Rating | null = null
if (s.mode !== 'guided' && !reportSuspect(report)) {
  rating = deriveRating({
    rungUsed: s.rung,
    passed: report.allPassed,      // :356 — the argument, not the gate
    ...
```

Committed in `1f6afb4`, bundled with F1, which is the right place for it: `reportSuspect`
and its consumer are one mechanism, and F1's own comment at `session.ts:629` says
"`deriveRating` is its caller." Tested at `test/server/app.test.ts:692`, *"withholds the
rating on a deflated count while still letting the session close"*, which asserts both of
the brief's non-negotiable constraints at once — `rating` is null and the exit still
answers 200.

**How I got it wrong.** I read `app.ts:354-361` — the `deriveRating({...})` call — saw
`passed: report.allPassed` unchanged from the review's quotation, and concluded no
suspicion signal was consulted. The guard is at `:353`, one line above the range I read.
Every fact I stated was true: `:356` really does say `passed: report.allPassed`, and it
really is unchanged. It just does not mean what I said it meant, because the argument was
never where the guard was going to be.

This is two of this branch's own named defect classes, committed by me:

- **(a) a check that reports a result about a thing it never looked at.** I read the call
  and reported on the gate. The unifying sentence of this entire review — *the gate
  reported agreement because it never looked at the thing* — describes my own assessment.
- **(c) a citation that proves something adjacent to its claim.** `:356` is real, quoted
  verbatim, and load-bearing for a conclusion it does not support. This is the third time
  on this branch that a two-line citation error changed a verdict, and the first time the
  error was in the direction of *inventing* open work rather than waving it through.

Direction of harm: this one was a **false fail**, the loud kind. Cost had it stood: a
dispatch spent re-implementing a guard that exists, whose most likely outcome is a second
withholding path racing the first, plus a false blocker reported to the user. Cheap
because it was loud. The quiet direction would have been reporting F2 closed when it was
open, and nothing in my method would have caught that either — the method was the defect,
not the luck.

Ruling: read the enclosing block, not the cited line, before reporting a guard absent. —
A guard is a control-flow fact and a line number is not; three of this branch's citation
errors were within two lines of correct and two of them inverted a verdict. — If wrong,
the cost is a few extra lines read per check.

**Dispatch A therefore completed 5 of 5 findings**, not 3 of 5: F1, F2, F3, F4 in its own
three commits, F6 finished but uncommitted and now committed as `3670925`. What it did not
do is write `fix-a-report.md`, so its two rulings (F3 error-vs-reconcile, F4
refuse-vs-log) survive only as commit subjects and code comments. The re-review derives
them from the diff; nothing takes them on trust.

The credential failure was real and it killed A before it could report, but it did not
cost the work. Delegation is back: `cred-check` returned `OK` and `ALIVE` — those probes
had run all along and only their notifications were lost, the same
finished-without-reporting pattern that has now hit four times this session.

## Fix round 1, dispatch B — COMPLETE

`fix-b` (sonnet) returned COMPLETE with one commit, `6e99c3e`, 14 files, staged by name.
All nine findings plus the five-item doc batch. Gates: typecheck 0; **462 tests / 35 files
/ 0 skipped**, all passing (455 + 7 new); `build:web` 0; `lint:content` 0 problems, 3
notes unchanged. It reproduced the 455 baseline with its own clean run before starting,
which is the check dispatch A never got to report.

Combined range `4312359..6e99c3e`: 5 commits, 25 files, +1393/-165. Working tree clean.

Three of its decisions are better than what the brief asked for, and are worth recording
as such because each one declined to assert something it could not measure:

- **P26**: the brief (via the parked note) said five current contexts fail the same way.
  It verified four, fixed the wording, and **refused to repeat the number five**. It also
  declined to add three new pinned oracle entries on the grounds that new coverage is not
  a wording fix — correct, and the restraint is the right call in a round whose whole
  subject is claims outrunning their evidence.
- **P27**: no prior disclosure existed anywhere in the repo (it grepped; zero hits), so
  rather than "correct" a sentence that did not exist it measured the defect itself
  (`heredocDelimiter`'s third `closingQuote` site misses ANSI-C dequoting, so
  `cat <<$'EOF'` is a silent fail-open), added a pinned entry, and left production code
  alone as P18 territory.
- **P22**: it reports that my named locus for the false sentence — `task-23-report.md` —
  **does not contain the sentence at all**, and that the real occurrences are in the three
  scratch files my own note rules git-ignored and no-edit.

Ruling on that last one: accept it as a citation slip on my pointer, not a disagreement on
the ruling. — The substantive P22 correction was already carried by F11, the sentence's
real homes are files ruled unedited, and the reviewer can confirm F11 closed it. — If
wrong, the cost is one false sentence surviving in a git-ignored scratch file that no
build reads.

That is the **fourth** citation error on this branch and the third of the four is mine.
The pattern is stable enough to name: every one of them cited a real artifact at a
location within a few lines or one filename of correct, and the error was never in the
observation but in what the observation was offered as evidence *for*.

### Verified before dispatching the re-review: F4 × F9 compose safely

Two findings from different dispatches, neither reviewed against the other, compose into a
boot question nobody specified: F4 made the serving path refuse on a coverage failure, and
F9 then made a typo'd **concept** objective id into a coverage failure. If that landed in
the wrong bucket the server would refuse to start and Phase 1's exit criterion would be
unreachable.

`MEASURED` on the shipped bank: `checkCoverage` returns `problems: []`,
`untaughtConcepts: []`, `uncoveredObjectives:` **58**. `src/server/config.ts:92`'s
`refuseToServe` gates on `problems` **only**; `:84` logs the other two as counts and says
in a comment why they are not errors. So the server boots, the 58 are P34's known Phase-2
content threshold rather than a regression, and a dangling concept objective id refuses to
serve — which is precisely what `:79` defines `problems` to mean. The composition is
correct and correctly reasoned. Recorded here so the re-review need not re-derive it, and
flagged to it for confirmation rather than trust.

## Final scoped re-review — CHANGES REQUIRED, six items, none design work

`final-rereview` (opus) returned CHANGES REQUIRED over `4312359..6e99c3e` and wrote
`final-rereview.md` (20,017 bytes, 279 lines). Its own framing is worth preserving: *"Not
because anything is broken."* All thirteen findings and the doc batch are addressed, all
four gates green (**462 tests / 35 files / 0 skipped**, typecheck 0, build:web 0,
lint:content 0 problems / 3 notes), and **both S1 findings are closed by guards the
reviewer broke and watched fail** — mutation-verified, not read.

It worked entirely in `/tmp/rr` from `git archive 6e99c3e`, reverted mutants against a
pristine copy, and confirmed the shared tree untouched. Verified independently: tree clean,
HEAD `6e99c3e`, `git tag -l` empty.

The strongest thing in it is the F1 verification, which is the measurement this branch
never had: a full insertion-point sweep of `cat <<NOPE` through the real grade script, the
new guard firing at **36 of 36** deflating positions after the first `ck_*` and correctly
**not** firing at the 4 positions after the last one. That is both directions measured on
the finding the whole branch was about.

It also derived dispatch A's two lost rulings from the diff and judged both right, finding
that F3 shipped a **hybrid neither offered option stated**: an emitted id named by no
header anywhere in the task is an error, while one named only by a sibling anti-solution's
`# expect-fail:` stays a note. Pure-error would have made the three shipped notes errors —
a false fail on the shipped bank, the exact shape F12 was told not to create. That is a
better answer than the brief contained.

### Its six items, and my verification of the replacement values before anyone transcribes them

Items 2, 4 and 5 replace false numbers with new numbers, which is the one shape where a
careless fix manufactures a fresh instance of the defect it is fixing. So I measured them
myself rather than transcribing:

| item | claim | my measurement | verdict |
|---|---|---|---|
| 2 | 5 tasks, 68 objectives, 58 uncovered (not "25 tasks / 58 objectives") | tasks **5**, concepts **10**, objectives **68**, uncovered **58** | **exact** |
| 4 | a size comparison fails **2 of 5** graders, not "every grader" | 014 e5/d3 fail, 017 e5/d4 fail, 019 e8/d8, 028 e5/d5, 006 e8/d8 → **2 of 5** | **exact** |

Ruling on item 5 (`session.ts:544`'s stale "exit 1, 9 problems", re-measured by the
reviewer as 15): **drop the count and keep "exit 1"** rather than substituting 15. — The
number went stale *within a single round*, because F3 changed lint's rules in the same
round that quoted it; a citation that must be re-measured every time lint's rules change is
a maintenance trap that will go stale again, and the load-bearing content is the direction
(lint catches partial deflation, loudly) not the magnitude. — If wrong, the cost is a
slightly less vivid comment.

Ruling: the reviewer's own item-5 measurement is **not** transcribed on my authority either.
The implementer re-measures or omits. — Same reasoning; I did not reproduce the heredoc
injection myself and will not pass along a number I did not measure. — Cost if wrong: nil,
since the fallback is omission.

### My own fifth citation slip on this branch, fourth of the five mine

My whole-branch and dispatch briefs both located the reference grader at
`content/tasks/system/019-httpd-alt-port/grade.sh`. It is
`content/tasks/selinux/019-httpd-alt-port/grade.sh` (`MEASURED`). The reviewer used the
correct path silently and its sweep reproduced, so the slip cost nothing — but it is the
same shape as the other four: a real artifact, named one path component wrong, offered as
the locus of a measurement. Recorded because "the sweep reproduced anyway" is exactly how
this class survives.

### Ruling: exceed the one-fix-dispatch budget by one dispatch

The skill budgets ONE fix dispatch after the whole-branch review, then one scoped
re-review, then finishing. I already split that one into two sequential dispatches by
ruling. This is a third.

Ruling: dispatch it. — The budget exists to stop polish loops, and five of these six items
are not polish: item 1 is a **loud false fail** that will reject a valid anti-solution the
user writes in Phase 2, and items 2, 4 and 5 are three fresh instances of *this branch's
defining defect class*, introduced by the fix round itself. Finishing a branch whose last
act was to add three new citations that prove something adjacent to their claims would
defeat the point of the five rounds that preceded it. Item 3 is the second half of F6 that
the brief explicitly asked for in as many words ("Name this asymmetry in a comment") and
that silently did not happen, leaving the diff reading as though the class were closed.
Nothing here is a guess: the reviewer supplied the exact fix for all six, and I have
independently verified the two numeric ones. — If wrong, the cost is one sonnet dispatch of
roughly ten lines plus two tests, and one cheap scoped re-review of that diff. If I had
ruled the other way, the cost is a shipped false fail plus three false sentences in the
files most likely to be read next.

The re-review after it is mandatory and cannot be me: I have now read the fix values, named
them, and ruled on them, so I am the least independent reader available.

## Fix round 2 (`fix-c`) — DONE, all six items, gates verified by me

`fix-c` (sonnet) returned DONE with one commit, `3b26a65`, 7 files staged by name:
`src/cli/lint.ts`, `src/engine/disclosure/ladder.ts`, `src/engine/validate/expectations.ts`,
`src/server/config.ts`, `src/server/session.ts`, `test/cli/lint.test.ts`,
`test/web/app.test.tsx`.

**Gates re-run by me at `3b26a65`, not taken from the report** — `$?` read per command,
never through a pipeline:

| gate | result |
|---|---|
| `npm run typecheck` | exit **0** |
| `npx vitest run` | **35 files / 464 tests / 0 skipped**, exit **0** |
| `npm run build:web` | exit **0** |
| `npm run lint:content` | exit **0**, "no problems in 5 grader(s)", **3 notes** |

Skip count checked directly: `grep -cE 'skipped|todo'` over captured stdout is **0**, and
`Tests 464 passed (464)` means total equals passed. The 3 notes are the same three ids in
the same two tasks. 464 = 462 + 2.

What distinguishes this dispatch: it **re-measured every number rather than transcribing
it**, which is precisely what the brief asked for and what the two rounds before it did not
do. It re-derived `config.ts`'s 5/10/68/58 from `rhcsa coverage`, re-derived the 2-of-5
containment result from `rhcsa lint`'s own inventory rather than from my table, and
re-reproduced the deflation exit code in its own `/tmp` copy rather than accepting either
the stale 9 or the reviewer's 15. For item 3 it verified *which assertion trips* by adding
a sixth `Rung` to the union and reading tsc's actual error (`TS2741` at
`_rungsExhaustive`), then reverted and confirmed the revert with `git diff --stat`. Item 6
it verified by mutation and checked the kill was **attributable** — the new test failed
while the other five in the file stayed green.

### The sixth instance of the defect class, and the fifth of six is mine

`fix-c` flags that commit `3670925`'s message — mine — asserts that `RUNGS` **and**
`PHASES` are "ordered arrays whose order is load-bearing at `server/app.ts`". Verified
independently: **false for `PHASES`.** Its only consumer anywhere is `isPhase`'s
`PHASES.some((p) => p === v)`, pure membership, order-irrelevant, and
`grep -rn "PHASES\|ExpectPhase" src/ test/` returns no other consumer at all. Only `RUNGS`'
order is load-bearing, at `src/server/app.ts:279` — which is also **not** `:255`, the line I
cited in the brief, the commit message and this ledger.

So a single sentence of mine carried two errors of the same family: a property true of one
array attributed to both, and a real call site named 24 lines off. The conclusion it
supported — keep both as ordered arrays, add assertions beside them rather than converting
— is still right, and right for `PHASES` too, just for a different reason (nothing needs its
order, and consistency with `RUNGS` is a weaker but sufficient warrant).

`fix-c` did the correct thing with it: wrote an accurate per-array comment at
`expectations.ts:13-17` stating that `PHASES`' order carries no meaning and that it stays an
array for consistency rather than from an ordering need, and **declined to repeat my
claim**. A dispatch contradicting its own brief with a measurement is the behaviour every
brief on this branch asked for and the first time one has actually exercised it against me.

Ruling: do **not** rewrite `3670925`'s commit message. — Amending it means rewriting branch
history, which invalidates every sha cited across `final-rereview.md`, both dispatch briefs,
the whole-branch review and ~9000 lines of this ledger; the false sentence lives in a commit
message no build reads, while the authoritative statement now lives in a code comment beside
the code, which is where a reader looks. — If wrong, the cost is one wrong sentence in
`git log` against a correct one in the source.

Running tally of this class on this branch: **six instances, five mine.** Every one cited a
real artifact, within a couple of lines or one path component or one array of correct, and
in every case the error was not the observation but what the observation was offered as
evidence for. The two that mattered inverted a verdict; the other four cost nothing but
would have if trusted.

## Re-review of `fix-c` — APPROVED, zero findings. The branch is clean.

`rereview-c` (sonnet) returned **APPROVED** over `6e99c3e..3b26a65` with **no findings of
its own**, and wrote `rereview-c.md`. Its closing sentence is the one that matters: *"Every
sentence this commit touches was re-measured independently (not transcribed from either the
dispatch or fix-c's report) and reproduced exactly as claimed."*

It worked in `/tmp/rereview-c-tree` from `git archive`, diffed every mutant revert
byte-identical against `git show 3b26a65:<path>`, and confirmed the shared tree untouched
before and after. Independently verified by me: tree clean, HEAD `3b26a65`, `git tag -l`
**empty**.

What it measured rather than accepted:

- **Item 1** by direct regex execution, not only through the suite: the `&&` form and the
  `||` form both no longer match, the bare `;` form no longer matches, and a genuine no-op
  (`set -euo pipefail` alone) **still** matches. So the loud false fail is closed without
  opening a false pass on the bank. It counted the anti-solution files itself —
  `find content/tasks -iname '*.sh' -path '*antisolutions*'` → **16**, matching the claim
  rather than inheriting it.
- **Item 2** by mutation, reading tsc's real output: `TS2741` at `ladder.ts:43`
  (`_rungsExhaustive`) and at `expectations.ts:18` (`_phasesExhaustive`). Confirmed `RUNGS`
  was not converted and its element order is unchanged, and confirmed the order-dependent
  consumer at `app.ts:279` by grep — the line I had twice cited as `:255`.
- **Items 3 and 4** re-derived from `rhcsa coverage` and from lint's own inventory, with the
  full per-grader emitted/declared breakdown printed out. 5/10/68/58 and 2-of-5 both
  reproduce.
- **Item 5** by reproducing the deflation from scratch in its own copy: exit **1**, 15
  problems — which independently corroborates `final-rereview.md`'s re-measurement and
  vindicates the ruling to drop the count rather than substitute it, since the retained word
  "exit 1" is the half that reproduces.
- **Item 6** by mutation with attribution checked: 1 failed / 5 passed, the new test the
  only casualty.

It also independently confirmed the sixth citation error rather than deferring to `fix-c`'s
report — `grep -rln "ExpectPhase" src/ test/` returns only `expectations.ts`, so no consumer
exists that could depend on `PHASES`' order — and judged the replacement comment **TRUE**.

Gates in the isolated copy, matching my own measurement at the shared tree: typecheck 0;
**35 files / 464 tests / 0 skipped**; `build:web` 0; `lint:content` 0, "no problems in 5
grader(s)", **3 notes**.

### Branch status: all 25 tasks complete, whole-branch review closed, two fix rounds closed

The `4312359..3b26a65` arc is: whole-branch review (15 findings, 2×S1) → dispatch A (F1-F4,
F6) → dispatch B (F5, F7-F13 + doc batch) → final re-review (6 new items) → `fix-c` → this
approval. Both S1 findings are closed by mutation-verified guards. Nothing is parked that
was ruled in scope.

Next: `superpowers:finishing-a-development-branch`.

**Two things are the user's and must not be done for them:** creating the `phase-1` tag
(deliberately theirs; `git tag -l` is empty and stays empty), and any merge or push, which
is a side effect outside this worktree and one of the four conditions that stops the loop.
