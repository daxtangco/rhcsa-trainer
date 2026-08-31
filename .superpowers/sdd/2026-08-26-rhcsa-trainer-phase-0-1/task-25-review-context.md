# Task 25 review — the last task. README, exit criterion, `rhcsa lint`. Both verdicts required.

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, BASE **`d0ff66b`**, HEAD **`ccdba26`** —
2 commits (`e50cd3e` the lint, `ccdba26` the exit criterion), 84421 bytes of diff. Tree clean, and
`git tag -l` is empty, which mandate 1 requires.

**Nothing forwards past this task.** After you, the whole branch goes to a final review. Anything you
let through here is either caught by that review or ships.

The two artifacts a human will actually rely on are in this diff: the **README**, written for someone
whose entire plan is to learn RHCSA from this app instead of a book, on a machine where the VM does not
exist yet; and **`docs/exit-criterion.md`**, which records whether Phase 1's goal was met. Getting those
wrong is not a style problem — it is the difference between a user who can start and one who cannot.

## Your three inputs

1. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-25-brief.md` (516 lines) — the
   requirements, with the exact values, paths, command names, copy strings and test cases.
2. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-25-mandates.md` (882 lines) — twelve
   mandates plus addenda. **Where these conflict with the brief, these win.** Note that mandate 4's
   four edits were already applied before dispatch and must not be redone, and mandate 8 explicitly
   tells the implementer to **re-measure before acting on any row** rather than trust it.
3. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-d0ff66b..ccdba26.diff` — commit list,
   stat summary and full `-U10` diff. **Read this rather than running `git diff`.**

The implementer's account is `task-25-report.md`. It is a **claim to test**, not evidence.

## Two verdicts, both required

- **Spec compliance** — does it do what the brief and the mandates require, with the exact values and
  copy they specify?
- **Task quality** — is it correct, tested, and free of the defect classes below?

A report missing either verdict is not accepted.

## Global Constraints — copied verbatim from the plan; these are your attention lens

- **Node >= 22.23.2.** `node file.ts` executes TypeScript directly — no build step, no `tsx`/`ts-node`.
- **Erasable syntax only.** **Never** `enum`, `namespace`, parameter properties, or decorators.
  `erasableSyntaxOnly: true` makes violations fail typecheck.
- **Relative imports carry the `.ts` extension.** **ESM only** — no `require`.
- **`sudo` cannot authenticate in this environment — there is no TTY.** Never a step that needs root on
  the WSL host. Guest-side root is *arranged*, not free: both transports connect as `student` and
  `/etc/sudoers.d/rhcsa-trainer` grants passwordless `sudo`, so guest-side scripts call `sudo`
  explicitly and non-interactively. A guest script assuming it is already root is a bug.
- **Target exam version is RHEL 9.** No RHEL 10 content in these phases.
- **SELinux stays `enforcing` in the VM.** Never disabled or permissived to make a task pass.
- **Graders are read-only and their exit code is ignored.** A grader that repairs state, or aborts on
  first failure, is a defect. **Graders never read shell history** — grade end state, not commands.
- **`vmrun.exe` is `/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe`** — note the space,
  always quoted.
- **Do not read or copy anything from `/home/daxtangco/sechelp-tools`** — unrelated project, `.env`
  secrets.

Project-local and equally binding: **no non-null `!`**, **no `as` casts** (mandate 5 removes four),
`noUncheckedIndexedAccess` and `verbatimModuleSyntax` both on. **Nothing in this project needs the
user's Red Hat credentials** — flag any step that asks for them or any file that would hold them. **The
guest password must never appear as a command argument** (mandate 12).

## Target 1 — `rhcsa lint` is a gate, and a gate that cannot fail is worse than no gate. Hardest target.

**The recurring defect class in this project is a tool reporting success when it did not do what was
asked.** `countCheckpoints` took eight defects across six review rounds; every one was silent, and five
consecutive reviews of it each found a real defect the whole suite passed over. `rhcsa lint` is now the
newest member of that family: its entire output is a claim about whether the content bank is okay.

The implementer says it cannot lie, and says so by mutation: unmutated copy exits 0 → four plants
(undeclared id, duplicate header, variable id, non-kebab id) each exit 1 with a named problem →
restored copy exits 0. **Reproduce all four plants.** Then attack the class the plants do not cover:

- **Does it actually read the bank?** A lint whose glob matches zero files exits 0 and looks identical
  to a clean bank. Point it at an empty directory, or delete the content it scans in a `/tmp` copy, and
  see whether "nothing to check" is distinguishable from "all clear". If it is not, that is the finding
  of this review.
- **Does it check every task, or stop at the first?** Plant a fault in the *last* task in iteration
  order, not the first.
- Mandate 11 required it to **reuse the existing extractor rather than write a sixth regex**, and the
  report says it reuses `checkpointIds`. Confirm that — and note that `checkpointIds` has had **zero
  production callers** until now, so this is its first real use. Does it behave as the lint assumes?
- The committed **negative** tests claim `ck $x` inside a heredoc body, inside a comment, and inside a
  quoted string are correctly **not** flagged — that is what the probe buys over a regex. Verify each,
  and try to find a fourth shape where it flags something it should not (a false fail on good content
  blocks a correct lab from shipping).

The honest limit the report states — it checks that ids *agree*, not that a grader is *correct* — is
correct and in scope to confirm, not to fault.

## Target 2 — two mandates were measured wrong. Verify both refusals independently.

Four of my mandates across this project have been refuted by implementers' measurements and every
refusal prevented a defect, so I want these checked rather than praised.

- **Mandate 7's claim that "values containing spaces survive intact" is false for *unquoted* values.**
  The report says dash word-splits, tries to execute the path tail, leaves the variable **empty**,
  continues, and **exits 0** — while `node --env-file-if-exists` reads the same line correctly. The
  consequence: an unquoted VMX path in `.env.local` gives a working server and a `test:vm` that fails
  for an unrelated-looking reason. **This is the user-facing half of this task** — the `vmrun.exe` path
  has a space in it and so does the user's VM path, so this trap is on the happy path, not the edge.
  Reproduce it under `/bin/sh` → dash. Confirm the README names **which loader breaks**, and confirm it
  does so where a reader will be standing when it bites, not in a footnote.
- **Mandate 9 item 7 is refused.** The report says `r1-probe.sh:187` classifies exit 124 explicitly
  into `unreachable`/`dropped` and `unknown` is only the final `else` at `:221`, so my note was wrong —
  but that the *real* defect is the `*)` arm at `:258` printing "R1 CONFIRMED AS A PROBLEM" for
  `unknown` too. Verify both halves. A probe that reports a confirmed problem when it does not know is
  a false fail against the user's own network, and R1 (WSL2 → VMnet8 reachability) is still
  **unverified**, so this string is what the user will read when they first try.

Say explicitly whether either refusal is itself wrong.

## Target 3 — the honesty of the artifacts. This is a correctness property here, not tone.

Phase 1's exit criterion is **not met** and cannot be: the user has not downloaded the RHEL 9 binary
DVD ISO, which needs their own Red Hat account at developers.redhat.com. My ruling to the implementer
was that VM-dependent steps must be written, marked **NOT RUN** with the reason, and neither invented
nor quietly dropped — **a blocker is not to be softened into a caveat.**

- Confirm `docs/exit-criterion.md` carries the NOT-RUN banner and mandate 2's replacement sentence
  **verbatim**, and that it **invents nothing** — no filled-in results, no plausible-looking numbers.
- The report claims steps 1, 5, 6, 7 and 9-commit RAN, and steps 2, 3, 4, 8 and 9's tag are NOT RUN.
  **Check that split against the diff**, and check that no NOT-RUN step is described in language that
  reads as done.
- Does any document anywhere in this diff state or imply that Phase 1's exit criterion was met?
- Mandate 3 was reported "done but superseded — zero live pipe-then-status sites." Confirm there are
  genuinely zero, because `echo "exit=$?"` after a pipeline reports `tail`'s status, not `npm`'s, and
  a doc that teaches the wrong idiom teaches it to the one reader who will copy it.

## Target 4 — the e2e test has never executed, so it is a prediction. Read it as one.

The implementer's own first concern: the e2e test should be expected to need a round of fixes on first
contact, and its `checkpointTotal` and `rating` values are **predictions from reading content**, not
observations. It also names an sshd wait as likely wrong.

Your question is narrower than "will it pass": **when it finally runs against a real guest, can it pass
for the wrong reason?** A test whose expected values were guessed, and which someone later adjusts until
it goes green, certifies whatever the code happens to do. Check whether each predicted value is
*derivable* from committed content — if it is, say from where; if it is a guess, say that it is one and
whether the test would notice. Also check nothing in it can hang unbounded (`124` means timed out in
this project) and that it needs no listening socket: Hono's `app.request()` is a full round-trip through
the router.

## Target 5 — the fifteen manual checks, and mandate 6's floors

- Task 24 handed Task 25 fifteen manual browser/VM checks, documented in the `## Step 16` section of
  `task-24-report.md`, each with what it proves. My instruction was to **fold them into Task 25's
  checklist rather than write a parallel one, because a second list is how a check gets lost.** Confirm
  all fifteen are present and traceable, that check 15 is the foreign-origin refusal check in a real
  browser, and that checks 12-13 (persistence) and 9-11 (masking) survived — the Task 24 report flagged
  those as the ones most likely to rot unnoticed. The implementer's own concern is that masking and
  persistence are *checklist items, not tests*; it says it would rather state that than count them as
  coverage. Rule on whether the artifacts state it clearly enough that a future reader cannot mistake a
  checklist item for a passing test.
- **Mandate 6** existed because two assertions passed on content that was never assembled:
  `expect(nudgeBody).not.toMatch(/lvextend|xfs_growfs/)` passes on `''`, and
  `expect(cardBody.length).toBeGreaterThan(1500)` passes when only one card rendered. Confirm both
  floors landed and both **bite** — mutate the assembly to return `''` and to render one card. The
  report measured cards at **1811/1766** against the mandate's 1814/1773 and attributes the difference
  to trimming; confirm that, since "close enough, must be trim" is exactly how a real drift gets
  waved through.

## Gates — run them, do not cite the report

`npm run typecheck`, `npx vitest run`, `npm run build:web`, `npm run lint:content`. Baseline is
**386 tests / 33 files**; the claim is **408 / 35 / 0 skipped** and `lint:content` exit 0 with **empty
stderr**. Confirm the test count *and* the skip count — a skipped test is not a passing test. Grep the
**whole repo**, not just the diff, for `enum`, `namespace`, decorators, parameter properties, non-null
`!` and `as` casts. Confirm `git tag -l` is still empty. Confirm `git status --porcelain` is empty
before and after: **do not mutate the repo.** All mutation work goes in a `/tmp` copy —
`git archive ccdba26 | tar -x -C /tmp/<dir>` with `node_modules` symlinked back.

## Out of scope — do not report these

- **`src/server/session.ts`, `src/engine/grading/`, `content/lib/assert.sh`, `content/`,
  `objectives.yaml`** except where a mandate explicitly directed a change. Task 23 closed on
  `session.ts` after six review rounds and one spent breaker exception.
- Everything in `whole-branch-parked.md` — the final review carries it. Specifically **P24** (one
  injected line takes a real grader's expected count from 8 to 0), **P28** (the false comment at
  `test/server/checkpoint-oracle.ts:530-532` — the implementer was told **not** to fix it; confirm it
  did not), **P18**, **P22**, **P25**, **P26**, **P27**, **P4** (`waitForGuest` returns before boot
  completes), and Task 24's **F4**. Do not re-derive them, and do not report the absence of a
  `countSuspect` field as a gap — that field is parked by ruling.
- **No `phase-1` tag** — mandate 1 makes step 9's tag the user's, not the implementer's. Its absence is
  correct.
- `shellcheck` is **not installed**; six tasks have confirmed it. Not a finding.
- `npm run validate` and `npm run test:vm` cannot run without a VM; not findings. The report notes
  `validate` has never run against a guest in this project's history — that is true, known, and
  ISO-blocked.
- Bundle size (744 kB / 206 kB gzipped, deliberate for a localhost single-user app), the terminal dying
  on `/reset` and needing a reload, and `report.regressions` ids going unrendered. All accepted.

## Prohibitions

No VM operations of any kind — no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies
10 GB), no snapshots, no start/stop/revert on any VM including the user's unrelated Ubuntu one. No
`sudo`: it cannot authenticate here, there is no TTY. Do not run `ssh-keygen` or write into
`/home/daxtangco/.ssh/`. Do not create, read or modify `.env.local` — git-ignored, and it may already
hold the user's real VM password. Do not read anything under `/home/daxtangco/sechelp-tools`. Do not
dispatch subagents. Do not leave a dev server or any listening process running.

## Environment

The Bash tool runs **zsh**, not bash: unquoted `$var` does not word-split, `grep --include='*.ts'`
needs quoting, plain `grep -n "a\|b"` errors under ugrep (use `grep -nE`), and a failed glob is an error
rather than an empty expansion. `ls` is aliased to **eza** — use `/bin/ls`. **npm scripts run under
`/bin/sh` → dash**, which is the whole subject of target 2's first half — reach for `dash` deliberately
when you test it. Beware nested heredocs: a bare `EOF` line inside a fenced code block will terminate an
outer heredoc early; this has bitten this project twice. Node **v22.23.2**, vitest **3.2.7**, TypeScript
**5.8**. `124` means timed out. Run `npm run build:web` with `run_in_background`.

## The bar

Label every conclusion `measured` or `reasoned`, and prefer sabotage to inspection. Direction matters
and there is no harmless miscall: a **false pass** tells the user they solved a lab they did not; a
**false fail** tells a user who solved it that they did not. For this task add a third — a **false
green on the bank itself**, where `rhcsa lint` reports clean content that is broken, which is how a bad
grader reaches a student in the first place.

Three shapes have each cost this branch real time, so look for them by name: a tool reporting success
it did not earn; a **citation that proves something adjacent to its claim** (this has now happened three
times here — a moving working tree, a two-change mutant, and a mutant that tripped an earlier assertion
in the same test); and a **disclosure whose wording is wrong**, which is worse than no disclosure
because the next author writes something unsafe on its authority.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-25-review.md`.

Return **only**: the **spec-compliance verdict** and the **task-quality verdict**, separately
(APPROVED / CHANGES REQUIRED); the five targets above with one line of disposition each; whether the
lint can report a clean bank that is not clean, and specifically whether "nothing to check" is
distinguishable from "all clear"; whether either refused mandate is itself wrong; whether the RUN /
NOT-RUN split is honest and complete; whether all fifteen handed-over checks survived; whether the
gates passed with the observed test and skip counts; and each finding with severity, direction, a
one-line failure scenario, and whether it is **load-bearing** — meaning it can produce a wrong
truth-claim to the user, or a wrong green on the content bank, on the project as it exists.
