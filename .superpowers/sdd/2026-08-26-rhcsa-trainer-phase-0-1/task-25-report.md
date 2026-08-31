# Task 25 report — Phase 1 exit criterion, README, coverage snapshot, `rhcsa lint`

**Status: DONE_WITH_CONCERNS.** Everything buildable here is built, committed and
green. The concern is not in my work: Phase 1's exit criterion is **not met**,
because every VM-dependent step is blocked on an ISO the user has to download.
The artifacts say so in their own text rather than implying otherwise.

**Commits** (branch `phase-0-1`, on top of `d0ff66b`):

- `e50cd3e` — `feat(cli): add rhcsa lint, the content gate that needs no VM`
- `ccdba26` — `docs: the Phase 1 exit criterion, as a blank form and an e2e test`

`git status --porcelain` is empty. **No `phase-1` tag was created** (`git tag
--list` is empty) — mandate 1.

**Tests: 408 passed / 35 files / 0 skipped** (baseline was 386 / 33 / 0; my two
new files add 22 tests). `npm run typecheck` exit 0. `npm run build:web` exit 0.
`npm run lint:content` exit 0 on the shipped bank, empty stderr.

---

## The three questions

### 1. Did any mandate turn out to be wrong?

Five things measured out differently. Two are substantive.

**Mandate 7's central measurement claim is wrong, and the way it is wrong is a
trap.** It says of the `test:vm` sourcing fragment: *"Measured under `/bin/sh` →
`dash` … Values containing spaces survive intact."* Measured, `/bin/sh` = dash:

| `.env.local` line | `node --env-file-if-exists` | `. ./.env.local` under dash |
|---|---|---|
| `RHCSA_VMX=/mnt/c/Program Files/VM/lab.vmx` | `/mnt/c/Program Files/VM/lab.vmx` | **empty**, plus `./.env.local: Files/VM/lab.vmx: not found` on stderr |
| `RHCSA_VMX="/mnt/c/Program Files/VM/lab.vmx"` | same | `/mnt/c/Program Files/VM/lab.vmx` |

Spaces survive **only when quoted**. Unquoted, dash word-splits, tries to
*execute* the tail of the path, sets the variable to nothing, **continues to the
next line, and the script still exits 0.** So the same `.env.local` gives a
working `npm run dev:server` and `npm run validate` (node parses it correctly) and
a `test:vm` that fails for a reason with no visible connection to the space. The
mandate's instruction — transcribe the fragment as written — I followed; the
fragment is fine. What was wrong was the reassurance, and it mattered, because
mandate 9 item 3 asked for the quoting rule as a tidiness note when it is
actually load-bearing. The README paragraph says which loader breaks and how.

Confirmed unchanged: blank assignments **are** exported by that fragment
(`RHCSA_SSH_KEY=` exports as the empty string), a missing `.env.local` still
reaches vitest, and comments and blank lines are harmless.

**Mandate 9 item 7 describes behaviour the script does not have.** It says
`scripts/r1-probe.sh`'s catch-all `*)` arm reports `unknown` for exit status 124,
*"so a WSL2 → VMnet8 probe that times out is indistinguishable from one that
failed for an unclassified reason."* Measured:

- `:187` — `elif [[ $tcp_rc -eq 124 ]]` handles 124 **explicitly**, resolving it
  to `unreachable` (when ICMP showed nothing claiming the address) or `dropped`.
- `:221` — `tcp_outcome=unknown` is set **only** by the final `else`, reached when
  the status is neither 0 nor 124 and stderr matches none of the known messages.
  That branch prints `rc=$tcp_rc`, so the number is visible.
- `:258` — the `*)` case arm prints "R1 CONFIRMED AS A PROBLEM".

A timing-out probe is classified, not swept into `unknown`. **Refused as
written.** There is a real defect nearby, smaller and differently shaped: `*)`
catches `unknown` *as well as* `dropped`, so a failure the script could not
classify prints the confirmed-firewall headline. I recorded that instead, in
`docs/r1-findings.md` under "Reading `scripts/r1-probe.sh`'s verdict", and kept
the part of item 7 that is true — R1 remains INCONCLUSIVE because the guest half
was never run — in the known limits.

The other three are citation drift; conclusions unaffected, but a README or test
comment citing a wrong line is worse than one citing none, so all were corrected
at the point of use:

- **Mandate 8's `rating === 'hard'` row** puts `if (i.rungUsed === 3) return
  'hard'` at `ladder.ts:76` and `if (!i.passed) return 'hard'` at `:75`. They are
  at **`:83`** and **`:82`**; `:76` is `export function deriveRating`. Off by 7.
  The row's reasoning holds — the arms at `:79`-`:82` do not fire with
  `hadRegression` false, rung 3, `passed` true — so the test asserts `'hard'` and
  cites `:83`.
- **Mandate 7's `config.ts:35-55`**: the `??` defaults are at `:49`, `:51`, `:52`.
  The substance (an exported empty string beats the default, because `??` only
  falls back on `undefined`/`null`) is correct and reproduced.
- **Mandate 9 item 8** calls Task 24's Step 16 checks "4-6 and 9-13" the service
  masking group. The real table has 4-6 as nudge/cards/solve — all covered by the
  e2e test and the exit-criterion run — with 9-11 exam masking and 12-13
  persistence. Folded all fifteen with an explicit mapping table so the
  miscount cannot drop one.

**Mandate 3 is superseded rather than wrong.** I audited both task-25 files for a
`… | tail -N` followed by a status check: **zero live sites.** Brief lines 264 and
270 both redirect (`> /tmp/…log 2>&1`) and do not pipe, because mandate 4's
addendum had already replaced the pipe form. Every remaining `| tail` (brief:278,
mandates:115/145/223) is prose describing the fixed bug. I added `set -o pipefail`
anyway, as directed, with a comment saying it is there for what the reader adds
next — which is now its only job.

### 2. Could `rhcsa lint` report a clean bank that is not clean?

Not silently. Live run, each plant made into a `/tmp` copy of the real
`content/`, restored between plants:

```
0. unmutated copy of the real bank:                       exit=0
1. baseline-fail names an id never emitted:               exit=1
   problem: …/grade.sh: baseline-fail names no-such-checkpoint, which the grader never emits
2. duplicated header line:                                exit=1
   problem: …/grade.sh: more than one "# baseline-fail:" header found
3. ck with a variable id (counter is blind to it):        exit=1
   problem: …/grade.sh: checkpoint id "\"$id\"" is not a literal. countCheckpoints
            cannot see it, so expectedTotal lands low and a truncated run reads as complete.
4. ck with a non-kebab id:                                exit=1
   problem: …/grade.sh: checkpoint id "LV_Size" is not lowercase kebab-case
            (/^[a-z0-9][a-z0-9-]*$/). countCheckpoints accepts it and miscounts it;
            this check is the loud half.
5. restored:                                              exit=0
```

Bad content in, non-zero exit out; and back to 0 on restore, so the exit code
tracks the content rather than luck. Two design points behind that:

**It reuses the extractor, as mandate 11 required.** The non-literal check does
not pattern-match bash. It finds candidate `ck` sites, rewrites *one* occurrence
to a sentinel literal id, and re-runs the real `checkpointIds` from
`src/server/session.ts` over the whole script. If the sentinel comes back, the
site is code the counter would have read, so a non-literal id there is a genuine
fail-open miss; if not, it was a comment, a heredoc body or a quoted string. The
scanner's knowledge of bash lexing is borrowed, not restated. Committed negative
tests prove a `ck $x` in each of those three positions is **not** flagged — which
is the whole value over the sixth regex, since reporting a grader's own printed
help text as a defect is how a gate stops being trusted.

**Every test plants a real defect and asserts the plant landed first**
(`expect(after, 'the plant did not change grade.sh, so the test below proves
nothing').not.toBe(before)`). A mutation that silently failed to apply would leave
the test certifying the lint's behaviour on unmodified content, which is the exact
false-green being ruled out.

The residual honest limits, stated because they bound the claim:

- `rhcsa lint` checks that ids *agree*. It cannot check that a grader is
  **correct** — that a `ck` actually probes what its description says. Only
  `rhcsa validate` against a real guest does that, and it has never been run.
- Emitted-but-undeclared ids are **notes, not errors**, by design: a grader
  legitimately emits invariants that pass at baseline and so cannot appear in
  `# baseline-fail:`. The shipped bank emits three (`home-from-lv`,
  `persist-config`, `default-target`). Nothing enforces that probed ∪ unprobed
  accounts for every emitted id, so an id named by no header at all is legal.
  `test/fixtures/content-headers.golden.json` locks `emitted` for exactly this
  reason — otherwise `var-intact` could be renamed with nothing observable
  changing. The README states the gap.
- Both id checks are scoped to `grade.sh`. `content/lib/assert.sh` *implements*
  `ck` by forwarding `"$id"` and is correctly invisible to the counter; a
  first draft that did not scope this failed the lint on the shipped bank, which
  is how the reason got written into the code.

### 3. What does a new reader of the README get wrong on their first attempt?

The README as it stood told them something false and hid something useful.

**The false thing, now fixed.** Getting-started step 4 said `node
src/cli/index.ts coverage` *"exits non-zero and reports `content/tasks` and
`content/concepts` as missing — that is expected at this point in the project."*
That stopped being true three tasks ago. A reader following the README would run
it, get a clean exit and a real report, and correctly conclude the README is
stale — after which they stop trusting the rest of it, including the parts that
are load-bearing. It now says what actually happens: five tasks, ten concepts,
68 objectives, exit 0, most objectives uncovered because that is Phase 2.

**The hidden thing, now a section.** Steps 1-3 need an ISO behind a Red Hat
login, and everything after needs the VM it builds. A reader whose entire plan is
to learn from this app instead of a book hits step 1, discovers it is most of a
day of work, and has no idea that anything runs before that. Three things do:
`npm run coverage`, `npm run lint:content`, `npm test`. There is now a **"Before
you have a VM"** section saying so, and saying that `validate` and `test:vm`
failing on `RHCSA_VMX` is the missing VM rather than a bad install — because that
error message names a variable, not a cause, and "I set the variable and it still
fails" is the wrong next move.

Also added `npm install` as step 0. It was never mentioned anywhere.

The two I could not fix by writing better prose, and which the blank form now
carries instead: the reader will assume `docs/exit-criterion.md` describes a run
that happened, and will assume a passing `npm run test:vm` means the exit
criterion is met. It does not — it means the spine works. Whether the cards
*taught* is the one question only they can answer, and the banner tells them to
distrust the file if they ever find it pre-filled.

---

## Per-mandate disposition

| # | Mandate | Disposition |
|---|---|---|
| 1 | Do not create the `phase-1` tag | **Done.** No tag exists. `docs/exit-criterion.md` ends with the ordered list that makes the tag's message true, tagging as step 5, the user's. |
| 2 | NOT-RUN banner; invent nothing | **Done.** Banner immediately under the criterion, telling the reader to distrust the file if pre-filled. `## The run` is a completely blank form — no date, no yes/no, no `__ / 5`, no rating. The replacement sentence about rungs 2 and 3 is carried verbatim. |
| 3 | `set -o pipefail` | **Done, and superseded.** Added with a comment. Audit found **zero** live pipe-then-status sites; see question 1. |
| 4 | 26 / 6 / 32 | **Verified, not redone** (already applied). Recounted independently: 019=8, and 014/017/028/006=6 each → 26 ssh + 6 vmrun = 32. `docs/exit-criterion.md` explains `1 + solutions + antisolutions` and why the file tree says 22/5. |
| 5 | Remove all four `as Record<string, unknown>` casts | **Done.** Replaced with `isRecord` / `obj(v, what)` / `str(v, what)`, which throw naming the field. `json(res)` folded into `post()` so the message names `POST ${path}`. Zero `as` and zero `!` in the file; `erasableSyntaxOnly` clean. |
| 6 | Rung-2 and rung-3 assertion floors | **Done.** 6a: nudge must contain the objective text and both card titles before the `not.toMatch(/lvextend\|xfs_growfs/)` is trusted. 6b: both `##` headings, the `\n---\n` separator, and `length > 3000`. Measured card bodies are 1811 and 1766 (mandate said 1814/1773 — trim difference). The assembled body is **3669** chars, a **669** margin over the 3000 floor. *(Corrected in fix round 1: this row first said ~577, which is `1811 + 1766 - 3000` and wrongly leaves out the two `##` heading lines and the `\n\n---\n\n` separator, which are in the body being measured.)* |
| 7 | Blank-key README warning; do not touch `config.ts` | **Done, with its measurement refused.** Warning added verbatim beneath the env table. `config.ts` untouched. Forwarded item below. See question 1 for the spaces claim. |
| 8 | Checked rows, re-measured before acting | **Done.** All rows re-measured. `ladder.ts` line numbers corrected `:75/:76` → `:82/:83`. `lab.ts:31` patch-order row confirmed — `reboot: () => opts.controller.reboot()` reads the property at call time, so patching after `createLabRuntime` works; the reason is in a comment because the next reader will have the same doubt. |
| 9 | Absorb the nine forwarded items | **Done, two corrected.** Items 1-4 in the README's authoring rules (item 1 verified at `grade.sh:82`, not 86); 5, 6 in the known limits as written; **7 refused as written** and replaced with the measured version; **8's check numbering corrected** and all fifteen mapped; 9 generated for real. |
| 10 | F5 and F7 into `docs/r1-findings.md` + README | **Done.** F5's row moved verbatim from `task-21-report.md:220` into a new "Validate failures and what they mean" section. F7's rule added to the README verbatim, and the "must skip comment lines before anything derives a *total*" note recorded, pointing at `npm run lint:content` as the maintained replacement. |
| 11 | `rhcsa lint` as a tested subcommand, reusing the extractor | **Done.** `src/cli/lint.ts` + 20 tests + a 2-test golden fixture. Reuses `checkpointIds` via a mutation probe, not a sixth regex. See question 2. |
| 12 | `read -rsp`, and a ninth known limit | **Done.** Step 4's block uses `read -rsp 'student password: ' RHCSA_GUEST_PASSWORD && export RHCSA_GUEST_PASSWORD` with the sentence beneath it; the password never appears as a command argument anywhere I wrote. Ninth bullet added: during a `vmrun` validate run the guest password is visible in this host's process list, because `vmrun` takes it as `-gp` and offers no file-based alternative; local-only single-user tool, documented rather than fixed. |
| 11-add. | Lint owns the strict half of the id grammar | **Done.** `/^[a-z0-9][a-z0-9-]*$/`, error-level, graders only. The `ck my` / `ck my_id` test asserts **both** halves: `checkpointIds` returns two ids (permissive, fails open) and the lint errors on `my_id` only (strict, fails closed). The README explains why the two disagree on purpose. |

`src/cli/lint.ts` lives under `src/cli/` deliberately — it imports from
`src/server/session.ts`, and the CLI is the top layer, so cli→server is fine
where engine→server would be backwards. Re-homing `checkpointIds` into a shared
module would reopen a file that closed after six review rounds and buy nothing.
The reasoning is in the module docstring.

## Steps run vs NOT RUN

| Step | State |
|---|---|
| 1 — `package.json` scripts | **RUN.** All eleven scripts present. `test:vm` fragment measured under dash directly (synthetic `.env.local` in a temp dir; the real one never touched). |
| 2 — the e2e test | **WRITTEN, NOT RUN.** `test/vm/e2e-exit-criterion.vm.test.ts` is excluded unless `RHCSA_VM=1`; it needs a guest. Typechecks; collected by vitest under the gate. **Never executed against a VM.** |
| 3 — the real-VM run | **NOT RUN.** No VM exists. RHEL 9 binary DVD ISO not downloaded — needs the user's own Red Hat account. |
| 4 — the two validate runs | **NOT RUN,** same reason. Both commands written with pipefail, the 26/26 and 6/6 expectations, and the `read -rsp` password form. |
| 5 — coverage snapshot | **RUN.** `docs/coverage-phase-1.md` is real `npm run --silent coverage` output: 5 tasks, 10 concepts, 68 objectives, 58 uncovered, 0 untaught. |
| 6 — the exit-criterion record | **RUN** (the file), **NOT RUN** (the content). Blank form under a NOT-RUN banner. |
| 7 — README | **RUN,** plus one stale-claim correction and a "Before you have a VM" section. |
| 8 — the manual run | **NOT RUN.** Needs the VM and a browser; needs the user. |
| 9 — commit and tag | **Commit RUN** (two commits). **Tag deliberately NOT created** — mandate 1. |
| 10 — acceptance | 3 of 5 conditions met here (scripts, coverage snapshot, README). The two that require the VM are not, and `docs/exit-criterion.md` says which. |

Nothing was softened into a caveat and nothing was dropped: every blocked step
has a written procedure and a stated expectation, so the user runs a checklist
rather than reconstructing one.

Also not run, for stated reasons: no VM operations of any kind, no
`scripts/provision.sh`, no snapshots, no `sudo`, no `ssh-keygen`, no touching
`.env.local`, no listening process left behind, no subagents dispatched.
`shellcheck` is not installed — not reported as a finding and not added as a
dependency.

## Left for the user

In order; only the last makes the tag's message true. Also written into
`docs/exit-criterion.md` so it does not live only in this report.

1. Download the RHEL 9 binary DVD ISO from your own Red Hat Developer account and
   run `bash scripts/provision.sh`. **Nothing in this project needs your Red Hat
   credentials** — no step asks for them and no file holds them.
2. `npm run test:vm` — the automated half of the criterion.
3. The two validate runs — 26/26 ssh, then 6/6 vmrun.
4. The manual run, filled in by hand, including "was there any moment where you
   wanted to open the book?" Then the second scenario (exam masking, persistence),
   the foreign-origin check, and reset.
5. `git tag -a phase-1 -m "Phase 1: five tasks, ten cards, graded end to end with
   the reboot check"` — after step 4, because only then is that true.

## Forwarded to the final review

`src/engine/vm/config.ts:35-55` should treat an empty-string env var as unset (a
`val()` helper returning `undefined` for `''`, applied to `RHCSA_SSH_USER`,
`RHCSA_SSH_KEY`, `RHCSA_VMRUN`), so `??` behaves like `provision.sh`'s
`${VAR:-default}`. Reachable via `npm run test:vm`'s `set -a` sourcing,
introduced in Task 25. The `??` sites are at `:49`, `:51`, `:52`, not `:35-55`.
`config.ts` not edited: closed task, outside this file list, and the review is
already sweeping it for the `as` cast at `:54`.

## Concerns

1. **Phase 1's exit criterion is not met, and cannot be met on this machine.**
   This is the headline, not a footnote. Every claim about whether this app
   teaches rests on a run that has not happened. The e2e test proves the cards
   are *shown*; nothing proves they *taught*.
2. **The e2e test has never executed.** It typechecks and it is collected under
   the `RHCSA_VM=1` gate, but a VM-gated test written against a guest that has
   never existed should be expected to need a round of fixes on first contact —
   most likely in the sshd wait, and in the exact `checkpointTotal` and `rating`
   values, which are predictions from reading the content.
3. **`rating === 'hard'` is a prediction.** It follows from `deriveRating` reaching
   `ladder.ts:83` with three rungs used and everything passing. If the ladder's
   arms are reordered, this asserts the old design. It is pinned to a line number
   in a comment so the next reader can check rather than guess.
4. **The masking and persistence checks have no automated coverage and never
   will, cheaply.** They are the ones Task 24 flagged as most likely to rot
   unnoticed, because nothing fails when they break. They now sit in one
   checklist with the failure mode named ("a run that reports a plain failure
   here, with no mention of persistence, is a defect and not a wording
   preference") — but a checklist item is weaker than a test, and I want that
   said plainly rather than counted as coverage.
5. **`npm run validate` has never run against a guest in this project's
   history.** Every content correctness claim rests on graders nothing has
   executed. `rhcsa lint` narrows this — it rules out the whole class of
   header/id disagreements statically — but it cannot tell you a `ck` probes what
   its description claims.
6. **The web bundle is 745 kB, over Vite's 500 kB warning.** Not mine and not in
   scope; noting it because it is the only warning in a clean build and the next
   person will wonder whether anyone saw it.
7. **Two parked items I was told not to touch, restated so they are not lost with
   this task:** the false comment at `test/server/checkpoint-oracle.ts:530-532`
   (P28) and the absent `countSuspect` field (P24). Both untouched.

---

## Fix round 1

Commit `fe4b051` on `phase-0-1`, atop `ccdba26`. Six files, staged by name. No
tag created. Gates: `npm run typecheck` exit 0; `npx vitest run` **413 passed /
35 files / 0 skipped** (baseline for this round was 408; five new tests);
`npm run build:web` exit 0; `npm run lint:content` exit 0 with empty stderr.
`git status --porcelain` and `git tag -l` both empty at the end.

### One line per item

**F1 — an empty content root now fails.** `lintContent` grew a `graders.length
=== 0` guard and a `--allow-empty` opt-out (`src/cli/lint.ts:292`,
`src/cli/index.ts` `parseLintArgs`). Every check in `lintContent` is a loop over
`graders`, so zero graders ran zero checks and exited 0.

**F2 — the phase now reaches the inventory.** `HeaderRecord.ids` became
`HeaderRecord.declared`, holding `id@phase`. The rename rather than a widening is
deliberate: it made the compiler point at every site that used to compare these
strings against emitted ids, because a phase-suffixed string must never be
compared to a bare emitted id. `ParsedHeader` now carries both forms — `ids` for
comparison, `declared` for the fixture. The golden fixture was regenerated with
the command documented in the file's header: 81 insertions, 81 deletions, 26
`declared` fields, zero stale `"ids"`, 7 `@post` entries across 6 headers, 0
`@pre`.

**F4 — the two lost checks are back in "The run".** Task 24 check 1 (chapter
numbers and the `supporting` badge) is the new item 1; check 8's "derived, not
self-reported" half is the second bullet of item 8. Both are the *only* coverage
of their target — nothing automated references `supporting` or a chapter number,
and `App.tsx` has no test — which is stated in each item so the next person
reading it knows dropping it drops the check. The insert renumbered items 1-7 to
2-8, which broke a cross-reference in the intro that said "question 4 below"; it
now refers to the "from the cards alone" question by name, because the numbers
move.

**F5 — `Array.isArray([])` is true.** The e2e's only assertion that finishing
unmasks the checkpoint names was satisfied by an empty reveal. Now
`toHaveLength(5)` plus a pinned id (`fs-home-size`). Same defect class mandate 6
exists to remove, in the one assertion mandate 6 did not name.

**F6 — four rows carried a claim they had not earned.** "asserted by the e2e
test" under a column headed "Covered by", with nothing saying that suite is
excluded unless `RHCSA_VM=1` and has never executed. Marked `†` with a footnote:
a written assertion is not a passing one, and the e2e has to run green once
before `†` means what "Covered by" normally means.

**F7 — one line.** The `3 / 5` partial tally is check 9's prediction, not check
7's; the sentence now attributes each prediction to the check that carries it.

**F8 — one line.** The mandate-6 margin is 669 characters, not 577. The earlier
figure omitted the two `##` heading lines and the `\n\n---\n\n` separator, which
are part of the body being measured. Corrected at point of use with the reason.

### The two required mutations, measured

**F1.** Deleted the guard from a `/tmp` copy and ran the suite: exactly **one**
test died — the new "exits non-zero with a named problem on a content root
holding no grade.sh". One and not zero means the guard is load-bearing; one and
not more means no pre-existing test depended on the old behaviour. Source
restored byte-identically, sha256 verified.

**F2.** Applied the reviewer's exact content edit (a shipped
`fs-home-size@post` → `@pre`, and `home-from-lv@post`'s suffix dropped) to a
`/tmp` copy. `rhcsa lint` still exits **0**, correctly — the header is legal
either way, which is precisely why the fixture has to be the thing that notices.
The inventory now **differs**, on exactly one row and no others:

```
fixture: ["fs-home-size@post","home-from-lv@post","persist-config@both"]
mutated: ["fs-home-size@pre", "home-from-lv@both","persist-config@both"]
```

Before the fix both arrays were `["fs-home-size","home-from-lv",
"persist-config"]` and the fixture matched byte for byte. Separately, dropping
the phase again from `declaredIds` kills **three** tests including the golden
fixture test. Source restored byte-identically, sha256 verified.

### Traceability of the fifteen checks: 15 of 15

Counted mechanically rather than by eye, because eye-counting is how F4's two
went missing. I parsed the mapping table in `docs/exit-criterion.md`, expanded
the range rows (`9-11`, `12-13`) into individual check numbers, and then resolved
each row's target — every "The run" item number against the actual numbered items
in that section, and every named section against a real heading. Result: 15
distinct check numbers, 1 through 15, none missing and none duplicated; every
target resolves; 4 `†` rows and the footnote present.

Then the part that matters more, because F4's failure mode was a check that was
*mentioned* but no longer *present*: I asserted that each recovered fragment is
inside the item it claims. Item 1 contains picker, chapter, `ch15`, `ch22`,
`supporting` and `TaskPicker.tsx:63-65`; item 8 contains derived, self-reported
and `App.tsx:281`. Adjacent-but-not-inside would have passed a table check and
failed a reader.

### Is there a third silent-green channel? Yes, and it is the same sentence.

*The gate compared successfully because it never looked at the thing.* Carrying
that sentence into the `expect-fail` half of `lintContent` finds one.

The `expect-fail` gate iterates the files the directory walk happens to find
under `/antisolutions/` with a `.sh` suffix, and the lint holds **no expectation
of how many anti-solutions a task should have**. Zero is therefore
indistinguishable from all-present-and-correct. Measured, each on a `/tmp` copy:

| mutation | exit | inventory rows |
|---|---|---|
| A — one `grade.sh` deleted | **1** | — |
| B — a `grade.sh` renamed | **1** | — |
| C — a task's `antisolutions/` deleted | **0** | 18 (vs 21) |
| D — `antisolutions/` misspelled `antisolutons` | **0** | 18 |
| E — one anti-solution renamed off `.sh` | **0** | 20 |

A and B are caught, but not by a check that looks for a grader — by an
*interlock* I had not noticed when I wrote it: the orphaned anti-solutions hit
`no sibling grade.sh, so its "# expect-fail:" ids cannot be checked`. That
interlock has exactly one direction. Nothing becomes an orphan when the
anti-solutions are what went missing, so C, D and E pass clean.

D is the one that is not hypothetical: a misspelled `antisolutions` is the exact
case the F5 row in `docs/r1-findings.md` documents as having already happened
once in this project.

The golden fixture *would* catch all three — I measured D specifically and the
drift test fails (`golden test would fail: true`). But that is the same
gate-resting-on-another-gate split the brief rejected as insufficient for F1: the
lint's own exit code is what a CI step, a pre-commit hook or a wrapper script
reads, and it says clean.

**Not fixed, deliberately.** The brief says "Nothing beyond the above… No new
features", and the fix — a per-task expectation of anti-solution count — is a new
validate-only rule that would also duplicate what `loadBank` knows. Recorded here
rather than acted on, so the decision is the reviewer's.

---

## Fix round 2

Commit `7880164` on `phase-0-1`, atop `fe4b051`. Three files, staged by name:
`src/cli/lint.ts`, `src/engine/validate/harness.ts` (the two floor constants
exported, nothing else), `test/cli/lint.test.ts`. No tag created. Gates:
typecheck 0; `npx vitest run` **423 passed / 35 files / 0 skipped** (from 413;
ten new tests); `build:web` 0; `npm run lint:content` 0 with empty stderr.
`git status --porcelain` and `git tag -l` both empty.

`MIN_SOLUTIONS` and `MIN_ANTISOLUTIONS` are imported, not restated, in both the
source and the tests — the tests assert against the imported value *and* pin the
number, so a change to the floor updates one place and the pin says out loud that
it moved.

### The four rules, and each one's mutation

Every rule iterates `bank.tasks`. Nothing here reads the directory walk to decide
what to expect, because a walk cannot notice what it did not find — which is the
entire defect. All mutations were run in `/tmp` copies extracted with
`git archive <sha> | tar -x`, `node_modules` symlinked back, working tree never
touched. Each row's "before" column is the same mutation run against `fe4b051`.

| rule | mutation | at `fe4b051` | at `7880164` |
|---|---|---|---|
| 1 `antisolutions/` absent | directory removed | exit **0**, 18 rows | exit **1** |
| 1 same, misspelled | renamed `antisolutons/` | exit **0**, 18 rows | exit **1** |
| 2 anti-solution floor | both of 006's anti-solutions removed, directory kept | exit **0**, 19 rows | exit **1** |
| 3 solution floor | one of 014's two solutions removed | exit **0**, 21 rows | exit **1** |
| 4 non-`.sh` under `antisolutions/` | `03-wrong-lv.sh` → `.sh.bak` | exit **0**, 20 rows | exit **1** |

The named problem in each case:

1. `tasks/storage/014-grow-home-lv: antisolutions/ is missing. loadTaskScripts
   swallows the readdir failure, so an absent or misspelled directory name loads
   zero fixtures and reads exactly like a task with nothing to check.` The
   misspelling produces the identical message, which is the point: the
   correctly-spelled directory the loader looks for is gone either way. This is
   the row `docs/r1-findings.md:267` diagnoses as *"the directory name is
   misspelled; readdir failures are swallowed"* with a human checking spelling as
   its remedy. Your correction is right and I have used the corrected version —
   it is a documented failure mode with a diagnosis, not an incident log, and
   that is the stronger claim because it means the mechanism was understood and
   left to a human anyway.
2. `tasks/users/006-team-provisioning: needs at least 1 anti-solution, found 0`
3. `tasks/storage/014-grow-home-lv: needs at least 2 solutions, found 1`
4. `tasks/storage/014-grow-home-lv: antisolutions/03-wrong-lv.sh.bak does not end
   in .sh, so no fixture loads it. Renaming a fixture off .sh drops it from every
   run without changing a single declared expectation.`

Rules 2 and 3 reuse `harness.ts`'s own wording, so a grep that finds one finds
the other.

**Three of those five were invisible to the golden fixture too**, which I
measured rather than assumed: at `fe4b051` the printed inventory after the
solution-floor mutation, and after the solutions rename below, and after the
`task.yaml` removal below, is **byte-identical** to the unmutated inventory. So
for those the "the golden fixture would catch it" defence was not merely
insufficient, as it was for F1 — it was not available at all. Solutions carry no
headers, so they are invisible to a header inventory by construction.

### Three additions beyond the four, each measured

**4′ — the same unexpected-file rule on `solutions/`.** Not in the brief. The
measurement that justifies it: `users/006-team-provisioning` is the one task with
three solutions, so renaming one off `.sh` leaves exactly `MIN_SOLUTIONS` and no
count is out of range. Measured at `fe4b051`: exit **0**, 21 rows, inventory
byte-identical. At `7880164`: exit **1**, `solutions/03-primary-group-only.sh.
disabled does not end in .sh`. The four remaining tasks ship exactly two
solutions each, where rule 3 would have caught it — so the hole was live for one
task in five, not zero.

**5 — `grade.sh` required of every bank task, derived.** See the interlock
judgement below.

**6 — graders reconciled back against the bank.** `bank.tasks` is itself
assembled from a walk for `task.yaml`, so iterating it closes the
missing-expectation hole in one direction only. Measured at `fe4b051`: removing
`014`'s `task.yaml` gives exit **0** with a byte-identical inventory — the task
simply left the list, its grade.sh kept getting its headers checked, and its
fixtures were counted by nobody. At `7880164`: exit **1**,
`tasks/storage/014-grow-home-lv/grade.sh: no task in the bank owns this grader,
so its fixture floors were not checked (a missing or unloadable task.yaml does
this)`, and `graders checked: 5` still prints, so the header half kept working.

**A bank that will not load is a problem, not a skip.** With invalid
`objectives.yaml`, exit **1** on `the bank did not load, so the per-task fixture
floors were not checked — …`, while `graders checked: 5` and `scripts with
headers: 21` still print. That preserves the split documented on `taskDirOf` — a
YAML error must not take the script lint down with it — without letting "could
not check" read as "clean", which would have reinstated the round's own defect one
level up. There is deliberately no second escape hatch: `--allow-empty` remains
the only override on this command, and a test pins that it does not widen into a
general mute.

### No rule is asserted by a test that passes either way

Each guard was suppressed one at a time in a `/tmp` copy (its `problems.push`
rewritten to a throwaway array push, so the surrounding control flow is
untouched) and `test/cli/lint.test.ts` re-run:

| guard removed | tests that died |
|---|---|
| rule 1, missing directory | **2** (absent, misspelled) |
| rules 2 and 3, the floors | **2** (anti-solution, solution) |
| rule 4 / 4′, non-`.sh` | **2** (antisolutions, solutions) |
| rule 5, `grade.sh` | **1** |
| rule 6, reconciliation | **1** |
| bank-did-not-load | **1** |

Six guards, six non-empty kill sets, nine distinct tests. Two of the new tests
also assert a **negative**: the `.sh`-rename tests require that no `needs at
least` problem appears, because if the floor had fired they would have passed
whether rule 4 existed or not.

### The `grade.sh` interlock: it needed its own check, and now has one

**One sentence of judgement, as asked:** with rule 1 in place the `grade.sh`
direction was still *not* independently guarded — rule 1 fires on the
anti-solutions being absent, the orphan message fires on them being present, and
those two cover the space only jointly, which is a gate whose halves each rest on
the other half's files, so `grade.sh` is now required of every bank task
directly.

Measured, because the joint-coverage argument is exactly the kind that sounds
airtight and is not: at `fe4b051`, deleting `014`'s `grade.sh` **and** its
`antisolutions/` gives exit **0** with 17 rows — both halves gone, both halves
silent. At `7880164` it is exit **1** on `storage/014-grow-home-lv is in the bank
but has no grade.sh, so nothing about this task was checked`, and the test for it
asserts the stderr does **not** contain `no sibling grade.sh`, which is the
load-bearing half: it proves the problem came from the bank and not from the old
interlock.

### All four rules pass the committed bank unchanged

`npm run lint:content` exits **0** with empty stderr on `content/` exactly as it
stands, and a test states that as its own assertion rather than leaving it
implicit. Five tasks, each with `task.yaml`, `grade.sh` and `setup.sh`;
anti-solution counts **5 / 3 / 3 / 3 / 2** (16 files); solution counts **2 / 2 /
2 / 2 / 3** (11 files); zero non-`.sh` entries anywhere under a `solutions/` or
`antisolutions/`. No content file was touched in this round. These are a floor
under today's content, not a change to it.

### Is there a fourth channel? One, with a small blast radius — and one near-miss.

Carrying both sentences — *the gate reported agreement because it never looked at
the thing*, and *the two halves interlock in one direction only*.

**Found: `# unprobed-invariant:` is optional, so absent and misspelled are
indistinguishable.** That is rule 1's shape exactly, one layer down, in a header
instead of a directory. Measured: misspelling it `# unproved-invariant:` in
`014`'s grader gives exit **0** and zero problems, and `var-intact` silently
demotes from a declared unprobed invariant to an informational note. The blast
radius is genuinely small — I grepped, and **nothing outside `src/cli/lint.ts`
reads that header**, so no verdict, count or student-visible number moves. And
the golden fixture does catch this one: measured, the inventory row differs
(`differs`, not identical), because the header is part of the record. So: real
shape, no operational consequence, and it is the one case where the fixture
argument actually holds. Reporting rather than fixing, and the call is yours.

**Near-miss, and I want to be precise about why it is not in the same class:
`setup.sh` is validated nowhere.** No task loader, no lint, nothing static
requires it. Measured: deleting `014`'s `setup.sh` gives `rhcsa lint` exit **0**
and zero problems. But `loadTaskScripts` reads it with a bare `readFile` and no
`.catch`, so validate rejects and a session create returns 500 — the failure is
**late, not silent**, and it cannot pass a student on work they did not do. It
does not meet the bar this round was set against, and "which files must a task
have" is a `loadTask` question rather than a grader-header-lint question, so I
have not extended the rule to it. Flagging it because the pre-VM instructions in
`docs/exit-criterion.md` do point a reader at `lint:content` as the check to run
before a VM exists, and a green result there on a task that cannot start is
misleading even if it is not silent.

**What I checked and found closed**, so this is not a short list of guesses:

- A misspelled or absent `# baseline-fail:` or `# expect-fail:` header —
  `parseExpectations` throws when its header is absent and `declaredIds` turns
  that into a problem. Measured: stripping the `# expect-fail:` line from an
  anti-solution gives exit **1**, `must declare a "# expect-fail:" header naming
  the checkpoint ids it expects to fail`.
- The golden fixture's own vacuity — already guarded explicitly at
  `test/cli/content-headers-golden.test.ts:53-58`: more than 20 rows and at least
  one of each of the three header kinds, so `toEqual([], [])` cannot pass.
- An anti-solution nested one level deeper (`antisolutions/extra/01.sh`) — now
  reported twice, as an unexpected non-file entry by rule 4 and as an orphan by
  the sibling check.
- A grader outside the bank, and a task inside the bank with no grader — rules 6
  and 5, both measured above.
- `--allow-empty` widening into a general mute — pinned by a test from round 1,
  and it does not suppress any rule added here.
- The `notes` channel — informational by design and documented as never affecting
  the exit code; the emitted-but-undeclared note is the case that would fail every
  task in the bank if it were an error.

## Fix round 3

Commit `45344bd` on `phase-0-1`, atop `7880164`. Two files, staged by name:
`src/cli/lint.ts`, `test/cli/lint.test.ts`. No tag created. Gates: typecheck 0;
`npx vitest run` **431 passed / 35 files / 0 skipped** (from 423; eight new
tests); `build:web` 0; `npm run lint:content` 0 with empty stderr.
`git status --porcelain` and `git tag -l` both empty.

### One line per item

1. **NEW-1 — fixed.** `checkFixtureFloors` no longer sits behind
   `if (graders.length > 0)`; `loadBank` and the floors now run unconditionally,
   and only the *bank-did-not-load message* stays behind the grader count, which
   is what keeps `--allow-empty` working on a root with no bank at all.
2. **NEW-2 — fixed.** The false comment is replaced by what is true — the grader
   count is a walk result, `bank.tasks` is the independent record, so the count is
   one of the things the floors *check* rather than their precondition — and the
   wrong claim is recorded as having been wrong rather than deleted, because the
   short-circuit it defended is the obvious simplification for the next reader.
3. **`setup.sh` — added**, one rule in the existing `bank.tasks` loop beside rule
   5, using a new `isFile` helper that `stat`s rather than `access`es so a
   *directory* named `setup.sh` does not pass. Mutation-proved on both axes of
   `--allow-empty` and at zero graders as well as five.
4. **`scanFixtureDir`'s `unreadable` arm — tested, and it was genuinely cheap.**
   No permissions fixture and no `sudo`: a regular *file* named `antisolutions`
   makes `readdir` fail **ENOTDIR**, which is not ENOENT, so the arm is reached by
   ordinary file creation. The test asserts the message stays distinct from the
   absent-directory one.

### NEW-1, re-measured

The exact case from the brief — five tasks still declared, every `grade.sh`
deleted, every `antisolutions/` deleted — in `/tmp` copies extracted with
`git archive <sha> | tar -x`, `node_modules` symlinked back, working tree never
touched:

| root | flag | at `7880164` | at `45344bd` |
|---|---|---|---|
| five declared tasks, no `grade.sh`, no `antisolutions/` | `--allow-empty` | exit **0**, **0** problems, `no problems in 0 grader(s)` | exit **1**, **10** problems |
| same | none | exit **1**, **1** problem, rule 5 never fires | exit **1**, **11** problems |

The ten are rule 5 five times (`… is in the bank but has no grade.sh, so nothing
about this task was checked`) and rule 1 five times (`antisolutions/ is missing…`).
The eleventh without the flag is the empty-root guard from round 1.

The second row is the part worth keeping: at `7880164` the no-flag run already
exited 1, but on the *empty-root guard alone* — rule 5 still never fired. So the
defect was the guard's placement and not the flag, exactly as the brief called it;
`--allow-empty` only removed the last line that happened to be covering for it.

**`--allow-empty` still does what it was added for.** A root with no bank at all:
exit **0**, 0 problems. Without the flag, exit 1. Round 1's test for this is
unchanged and still green.

**The `setup.sh` rule, both axes.** One `setup.sh` deleted from the committed
bank: exit 1 with the flag and without it. The same deletion on the zero-grader
root above: exit 1 both ways (12 and 11 problems). The same root at `7880164`:
exit **0**, 0 problems.

### No rule is asserted by a test that passes either way

Guard suppression, `problems.push(` → `Array().push(` at the site so surrounding
control flow is untouched:

| suppressed | tests that died |
|---|---|
| the `setup.sh` rule | **3** — `reports a task with no setup.sh…`, `reports a setup.sh that is a directory…`, `fires the setup.sh rule at zero graders…` |
| the `unreadable` arm | **1** — `reports a fixture directory it cannot read, as distinct from one that is absent` |
| the floors put back behind `graders.length > 0` | **3** — `fires the grade.sh rule five times at zero graders, under --allow-empty`, `fires them at zero graders without the flag too…`, `fires the setup.sh rule at zero graders…` |

### Every rule still passes the committed bank unchanged

`content/` at `45344bd`: exit **0**, `no problems in 5 grader(s)`, 21 scripts with
headers, empty stderr. No content file, `objectives.yaml`,
`src/server/session.ts`, `src/engine/grading/` or `content/lib/assert.sh` was
touched.

### The sweep: are other checks preconditioned on the thing they validate?

I swept every conditional that stands between an input and a check in
`src/cli/lint.ts`, `src/cli/index.ts` (all three commands), and
`src/engine/validate/harness.ts` — the runtime half NEW-1's rules were ported
from. **One residual, and it is the deliberate one; everything else is either the
correct inversion or floored by the loader.**

**The residual, measured.** The bank-load *message* is still behind
`if (graders.length > 0)`, and that is the same shape. Its exact cost:
`--allow-empty`, zero graders, **no anti-solutions either**, and a bank that will
not load → exit **0**, 0 problems. Without the flag the same root is exit 1. With
the anti-solutions still present it is exit 1 either way — 16 orphan problems —
so reaching the hole needs every script gone *and* the flag *and* an unloadable
bank, at which point `--allow-empty`'s own assertion ("no task is authored here")
is arguably true. It survives because removing it breaks `--allow-empty` on a bare
directory, where `loadBank` throws; the split is written out at the `catch`. I am
disclosing it rather than defending it: it is one instance of the sentence still
standing, with the flag as its precondition.

**Reachability of that residual, measured.** `--allow-empty` appears in no npm
script, no doc under `docs/`, no README line and no CI file — only in `USAGE` and
in tests, so `npm run lint:content` cannot reach it and a human has to type it. The
root state it needs is a real authoring state rather than a contrived one: a
`task.yaml` written first with a YAML error, no `grade.sh` and no `antisolutions/`
yet, which is precisely the half-authored case the flag documents itself for. But
the same root is exit **1** from both neighbours, measured: `rhcsa coverage` and
`rhcsa validate` each report the five `task.yaml` parse errors and exit 1, and
`validate` does so from `loadBank` before it touches `loadVmConfig`, so no guest is
needed to catch it. Reachable, then, but not unwatched.

**Correct inversions, not instances.** Four places compute something from the
input and then *report* on it rather than skipping:
`graders.length === 0` → the round-1 guard; `checkVerdict`'s
`verdict.checkpoints.length === 0` → `grader emitted no checkpoints`;
`emitted === undefined` → `no sibling grade.sh`; and `validate`'s
`tasks.length === 0` → `no tasks found under <root>/tasks`, exit 1, reached
**before** `loadVmConfig`, so it needs no guest (measured on a root with `tasks/`
emptied). `inventoryGate` runs unconditionally in `validateTask` — the fixture
loop's results are pushed first and the gate last, and the gate does not consult
the loop.

**Floored by the loader, so the shape cannot bite.** `coverage --strict` looked
like the best candidate anywhere: `gaps = uncoveredObjectives + untaughtConcepts`,
both computed by filtering lists that come from the very bank being validated, so
a taxonomy with no objectives would report full coverage. Measured: it cannot
happen — `src/engine/content/objectives.ts:39` floors the list, and
`objectives: []` gives `objectives must list at least one objective`, exit 1
before `checkCoverage` runs. Same for `bank.concepts`: a task referencing a
concept the bank lacks is a `checkCoverage` problem, so an emptied `concepts/`
exits 1 with tasks present.

**Fails closed rather than open.** `if (baseline)` in `runFixture` skips the
verdict comparison when `parseExpectations` threw — but the throw is pushed as a
failure first, so the fixture is red, not green. `if (result.verdictB)` gates two
checks on a verdict `grade()` skipped, and the `else if` beside it turns that
absence into a failure for exactly the case where absence is suspicious (a
`reboot_check` task). `loadTaskScripts`'s bare `readFile` of `setup.sh` and
`grade.sh` rejects rather than swallowing — that is the round-2 finding, and item
3 is its static half.

**One I first reported as open, and then closed against the code. Retracted.**
`runFixture`'s `if (fixture.script.trim() !== '')` skips running a fixture whose
script is whitespace-only, and the precondition is computed from the fixture it
validates, so it has the right shape. I wrote that for an **anti-solution** this
was a live silent green. **That was wrong, and it fails closed.** An
anti-solution's `declared` list comes from `parseExpectations(fixture.script, …)`
at `src/engine/validate/harness.ts:165`, thirty-four lines *above* the `.trim()`
guard, and a missing `# expect-fail:` header makes it throw into the early return
at `:167` with `ok: false`. So the two states are mutually exclusive: a
whitespace-only anti-solution has no header and is already red before the guard is
consulted, and an anti-solution that has a header contains that comment line,
which makes `.trim() !== ''` true and runs it. The guard is unreachable in the
state that would have made it dangerous. This is a code-reading fact, not a guest
measurement.

What survives is a **different** defect, and it is not this shape: an
anti-solution whose body is only comments passes the header check, runs, changes
nothing, and is then graded on a machine identical to the `no-action` baseline —
so a declared `expect-fail` id fails because the task is unsolved rather than
because the grader caught a wrong answer, and the fixture is vacuously green. That
is rule 3's shape one level down: an anti-solution that exists but does nothing,
which a floor counting files cannot see.

**Corrected after round 4, which is what made the next sentence half wrong.** I
originally wrote that settling this needs verdict A, so it needs a guest, so it is
a `harness.ts` feature. That collapses two shapes, and only one of them behaves
that way. Splitting them rather than deleting the claim, because a reader who
remembers the collapsed version needs to know which half survived:

- **Shape A — the fixture body does nothing** (only comments, blank lines and
  shell options). **No guest.** It is decidable from the script text alone, so it
  is a `rhcsa lint` rule, and round 4 shipped it as one at `src/cli/lint.ts:211`,
  `:222` and `:670`, with a positive test and confirmation that it fires on none
  of the sixteen committed anti-solutions. My sentence, read literally, said this
  was impossible in `lint.ts`; it was not, and that is where it now lives. Note
  the reason it is *likely* rather than contrived: the `# expect-fail:` header is
  itself a comment, so a comment-only body is the natural intermediate state of a
  half-written anti-solution.
- **Shape B — the fixture ran but changed nothing.** **Needs a guest, and the
  original claim holds here.** Proving the fixture altered the machine, rather
  than that the goal checkpoints merely still fail, requires comparing its verdict
  against the unsolved baseline's, so it stays a `harness.ts` feature and is still
  unimplemented: `harness.ts:206` treats a non-zero fixture exit as an *error* and
  `:199` skips an entirely empty script, and nothing anywhere compares against the
  baseline.

Statically, and this narrows my own earlier "live on the shipped bank" wording: no
committed anti-solution is comment-only, the thinnest three carrying exactly one
real command each (`014/01-forgot-growfs.sh`, `014/03-wrong-lv.sh`,
`017/02-faked-the-end-state.sh`). `03-wrong-lv.sh` is a Shape B candidate flagged
by its own author, whose header asserts the exit-code check makes it safe — that
check catches a fixture that *errors*, not one that succeeds having changed
nothing, so the comment overstates its protection.

**Not swept, by ruling.** NEW-3 / P33 — the walk remaining under rule 6. Two
adjacent facts for its record, both measured on a root whose `tasks/` was emptied
with `objectives.yaml` and `concepts/` intact: the lint exits **0** under
`--allow-empty`, while `rhcsa validate` exits **1** with `no tasks found` and no
VM, and `coverage --strict` exits 1. So a vanished task directory is not a
branch-wide blind spot, only a lint blind spot — though `coverage --strict`'s
exit 1 is not evidence, since it is already red on the shipped bank.

## Fix round 4

**Status: complete.** Commit `4312359` on `phase-0-1`, base `45344bd`. Two files, staged by name:
`src/cli/lint.ts` (+118/-8) and `test/cli/lint.test.ts` (+77/-5). `git status --porcelain` empty,
`git tag -l` empty, nothing merged, pushed or tagged.

Method: every measurement in `/tmp/t25f4`, from `git archive 45344bd | tar -x` with `node_modules`
symlinked back. Baseline sha256 confirmed against the re-reviewer's: `2b0480f5…` for `src/cli/lint.ts`,
`20ba7db9…` for `test/cli/lint.test.ts`. After each mutation the file was restored from a pristine copy
and sha256-verified (`f47f368a…` / `3d883730…` for my versions). The shared working tree was never
measured. Fixture roots live in `/tmp/t25f4-roots`, outside both trees. Every conclusion below is
labelled `measured` or `reasoned`.

### Gates

| gate | result |
|---|---|
| `npm run typecheck` | exit 0 — `measured` |
| `npx vitest run` | **433 passed / 35 files / 0 failed / 0 skipped**, exit 0 (was 431, +2) — `measured` |
| `npm run build:web` | exit 0 — `measured` |
| `npm run lint:content` | exit 0, **stderr 0 bytes**, `no problems in 5 grader(s)`, `graders checked: 5`, `scripts with headers: 21` — `measured` |

Skip count is 0, not merely absent from the summary line: `grep -ic 'skip|todo'` over the whole vitest
log returns **0 matches**, and the summary reads `Tests 433 passed (433)` with no skipped bucket.
`measured`.

### Item 1 — NEW-3. The one-line fix, reproduced not redesigned, plus the comment rewrite.

`src/cli/lint.ts:569`:

```
-    if (graders.length > 0) {
+    if (graders.length > 0 || (await isFile(join(root, 'objectives.yaml')))) {
```

`isFile` is the round-3 helper at `lint.ts:312`; `join` was already imported. No walk was added, no walk
was substituted, `files.length > 0` was not used.

**The re-reviewer's table, reproduced end to end.** Same eight roots, both builds, `--allow-empty`
except where noted. All `measured`.

| root | today (`45344bd`) | with the fix |
|---|---|---|
| bare directory (`mkdtemp` + `tasks/`) | exit 0, 0 problems, stderr 0B | **exit 0, 0 problems, stderr 0B** — preserved |
| round 1's `emptyRoot()` (`tasks/…/setup.sh`, no bank file) | exit 0, 0 problems, stderr 0B | **exit 0, 0 problems, stderr 0B** — preserved |
| bank loads, zero tasks (valid `objectives.yaml`, empty `tasks/`, empty `concepts/`) | exit 0, 0 problems, stderr 0B | **exit 0, 0 problems, stderr 0B** — preserved |
| stripped bank **+ broken `objectives.yaml`**, 0 graders | exit **0**, 0 problems, stderr **0B** | **exit 1**, 1 problem, reported with the parse error (`missed comma between flow collection entries (2:8)`) |
| stripped bank **+ `concepts/` deleted**, 0 graders | exit **0**, 0 problems, stderr **0B** | **exit 1**, 1 problem (`cannot read directory …/concepts: ENOENT`) |
| valid `objectives.yaml`, **`tasks` is a regular file** | exit **0**, 0 problems | **exit 1**, 1 problem (`ENOTDIR: not a directory, scandir …/tasks`) |
| stripped bank (loadable): 5 `task.yaml`, 5 `setup.sh`, `concepts/`, valid `objectives.yaml`, 0 graders, 0 antisolutions | exit 1, **10** problems | exit 1, **10** problems — unchanged |
| committed bank, no flag | exit 0, `graders checked: 5`, `scripts with headers: 21` | exit 0, same — unchanged |
| full suite, fix alone with no new tests | 431 pass | **431 pass / 0 fail** |

**Round 1's and round 3's existing exit-0 tests are unchanged.** Not weakened, not touched: `git diff
45344bd..4312359 -- test/cli/lint.test.ts` has no hunk inside either. Round 1's
`describe('rhcsa lint fails when there is nothing to check')` block — `emptyRoot()` and
`it('exits 0 there when --allow-empty says the empty bank is expected')` — is byte-identical, and round
3's `it('still exits 0 under --allow-empty on a root with no bank at all')` is byte-identical. `measured`.
Both are also still **live** under my version: see Mutation M2 below.

**New test:** `reports a bank that will not load at zero graders, which is the flag's own use case` —
`strippedBank()` with `tasks/storage/014-grow-home-lv/task.yaml` overwritten with a YAML error, so the
root has a malformed `task.yaml`, no `grade.sh` and no `antisolutions/`. That is the flag's advertised
half-authored state landing on its blind spot: pinned at **exit 1 under `--allow-empty`**, asserting the
bank-did-not-load message, the **parse error text itself**, and `graders checked: 0` so the message is
attributable to the named-path check rather than to a grader being present.

Measured directly on that root before doing anything else: `45344bd` → **exit 0, stderr 0 bytes**; with
the fix → exit 1 with the parse error. `measured`.

#### Suppression

**Mutation M1 — the item-1 clause reverted**, single site, back to `if (graders.length > 0) {`.
Kills **exactly 1** test: `reports a bank that will not load at zero graders, which is the flag's own
use case`, tripping on `expect(r.code).toBe(1)` → `expected +0 to be 1`. That is the strongest available
kill — the mutant restores the exact silent exit-0 the item exists to close, and the kill is on the exit
code rather than on a message match, so it cannot be credited to an adjacent assertion. `measured`.

**Mutation M2 — the guard removed outright** (`if (true) {`), to check the *other* direction, that my
change did not quietly weaken the two exit-0 tests into tests that cannot fail. Kills **exactly 2**:
round 1's `exits 0 there when --allow-empty says the empty bank is expected` and round 3's
`still exits 0 under --allow-empty on a root with no bank at all`, both on `expect(err).toBe('')`.
`measured`. Identical to the re-reviewer's Mutation F, which is the point: the two exit-0 tests bite
exactly as hard after my change as before it.

#### The comment

The false sentence is gone. The replacement (`lint.ts:516-568`) states, in order: the condition is about
the **message** and not the rules, which ran unconditionally above; `--allow-empty` asserts **zero
graders**, quoting its own message as the evidence, and asserts nothing about `objectives.yaml`,
`concepts/` or `task.yaml`; `objectives.yaml`'s presence is what separates "nobody authored a bank here"
from "a bank is here and would not load"; the named path must not be strengthened into a walk, with the
reason (*"the walk found no `task.yaml`"* is a precondition computed from the thing being validated) and
with `files.length > 0` ruled out by `emptyRoot()`'s `setup.sh`.

**And it states the residual, which the fix narrows rather than closes.** Zero graders *and* no regular
file at `<root>/objectives.yaml` still suppresses the message, so the command still exits 0 with empty
stderr. Measured on my build, all under `--allow-empty`:

| root (stripped bank: 5 `task.yaml`, 5 `setup.sh`, `concepts/`, 0 graders) | exit | problems | stderr |
|---|---|---|---|
| `objectives.yaml` **deleted** | **0** | 0 | **0 bytes** |
| a **directory** at `objectives.yaml` | **0** | 0 | **0 bytes** |
| a **broken symlink** at `objectives.yaml` | **0** | 0 | **0 bytes** |
| `objectives.yaml` present but `chmod 000` | 1 | 1 | 250 bytes — reported (`stat` succeeds, so `isFile` is true) |

All `measured`. So the honest statement, which is what the comment now makes: the channel goes from *any*
loader failure to *the discriminator is itself the thing that is missing*. The first row is the one that
matters — an authored, grader-less bank with `objectives.yaml` deleted is still a silent exit 0. Closing
it needs an independent record that a bank was meant to exist here, and the only candidate inside this
command is a walk, which is the shape the paragraph above it rules out. `reasoned`, from the fix's own
argument.

The "this used to say X, which was wrong" treatment is kept and extended: **both** wrong versions are now
recorded as wrong, numbered, each with why, and with the note that both defended reporting nothing at zero
graders — plus the measurement against the second one (five tasks declared, every `grade.sh` deleted, one
YAML typo, exit 0 / 0 problems / stderr 0 bytes). A reader who remembers either version learns it was
wrong rather than finding it silently absent.

**One further wrong disclosure, in the file I was also allowed to touch.** The comment on
`it('does not let --allow-empty excuse a bank that will not load when graders exist')` — at
`test/cli/lint.test.ts:585` before this commit, `:650` after — repeated the false sentence verbatim — *"at zero graders an unloadable bank is
the flag's assertion being true"* — and after this fix it is not merely misleading but describes behaviour
the code no longer has. Rewritten the same way, recording the old claim as wrong and pointing at the new
test as the other half. Fixing item 1 in `lint.ts` while leaving its twin next door would have left the
next reader an authoritative false statement.

### Item 2 — NEW-4. One clause, comment only.

`lint.ts:496-500`. "the **only** input every rule in `checkFixtureFloors` reads" → "the one input every
rule … has **in common** — not the only input any of them reads: `graders` is a second one, read by the
`grade.sh` rule and iterated by the orphan reconciliation at the end." No code change.

**What dies when suppressed: nothing, and nothing can.** This is a comment. There is no mutant of it and
no test that could hold it, which is precisely why the wrong wording survived a round — the only gate on a
comment is a reader. Stating that plainly rather than claiming a kill count for it. `reasoned`.

### Item 3 — P35 shape A. A no-op anti-solution is no longer certified as a detector.

`changesNothing` at `lint.ts:222` strips blank lines, comment lines and shell-option lines
(`SHELL_OPTION_LINE = /^set\s+[-+]/` at `lint.ts:213`, which covers `set -e`, `set -euo pipefail`,
`set -o pipefail`, `set +x`) and returns true when nothing remains. Applied in the anti-solutions loop at
`lint.ts:670`, after the header checks. Pure content inspection: no guest, no verdict, no baseline run.

`SHELL_OPTION_LINE` is deliberately narrow, and the direction matters: widening what the rule *ignores*
makes it fire more often, which risks a false fail on the bank, while keeping it narrow only ever leaves a
no-op fixture unreported. `reasoned`, and stated in the comment on the constant.

**It fires on none of the sixteen committed anti-solutions.** Three independent confirmations, all
`measured`:

1. `npm run lint:content` exits 0 with **stderr 0 bytes** on the committed bank. The rule pushes one
   problem per offending file, so zero stderr is zero firings.
2. `scripts with headers: 21` — five graders plus **16** anti-solution rows in the printed inventory
   (`grep -c 'antisolutions/'` → 16). All sixteen were reached and inspected, so this is not a vacuous
   pass from the loop never running.
3. Counted independently of the code: the real-command count per anti-solution is 1 for
   `014/01-forgot-growfs.sh` (`sudo lvextend -L 12G /dev/rhel/home`), 1 for `014/03-wrong-lv.sh`
   (`sudo lvextend -r -L +4G /dev/rhel/root`) and 1 for `017/02-faked-the-end-state.sh`
   (`sudo /usr/local/bin/rhcsa-stamp`); the other thirteen carry 3 to 14. The brief's stated basis
   reproduces exactly.

Shape B was **not** added, and `content/tasks/storage/014-grow-home-lv/antisolutions/03-wrong-lv.sh` was
not touched. No content file was modified; no warning tier was introduced. Solutions are out of scope, as
ruled.

**New test:** `catches an anti-solution whose body is only comments, so it detects nothing`.
`01-forgot-growfs.sh` in a bank copy is rewritten to shebang + one comment line + `# expect-fail:
fs-home-size` + `set -euo pipefail`. The header half is load-bearing and deliberate: the header is present
and names an id the sibling grader really emits, so the missing-header throw and
`checkDeclaredAreEmitted` both have nothing to say, and the test asserts that — `not.toMatch(/must
declare a "# expect-fail:" header/)`, `not.toMatch(/expect-fail names/)`, and
`countProblems(err, /01-forgot-growfs\.sh/) === 1`, so this file contributes exactly one problem and the
kill cannot be credited to an earlier rule. It also asserts the header was genuinely *read*
(`/^ {2}expect-fail: fs-home-size@both$/m` in the inventory) rather than skipped past. Overwriting an
existing fixture rather than adding one keeps the anti-solution count at 3, so the floors are not involved
either.

#### Suppression

**Mutation M3 — the rule made unreachable** (`if (false && changesNothing(script))`). Kills **exactly 1**
test, the new one, on `expect(r.code).toBe(1)` → `expected +0 to be 1`. So this rule is the *sole* reason
that root exits 1 — the strongest form of kill, and the `countProblems(...) === 1` assertion above is what
makes that attributable rather than coincidental. `measured`.

**Mutation M4 — the shell-option skip clause dropped** (`SHELL_OPTION_LINE.test(line)` removed from the
skip list, nothing else changed). Kills **exactly 1** test, the same one, on the same exit-code assertion:
without that clause `set -euo pipefail` reads as a real command and the exact shape the item names goes
unreported. A single-property mutant, and it isolates the one clause that is not obvious. Under M4 the
committed bank still lints exit 0 / stderr 0 bytes, confirming that clause is not what keeps the rule off
the shipped content. `measured`.

### The closing question — is a named-path fact used interchangeably with a walk result anywhere else in `src/cli/lint.ts`?

**Yes, exactly one site, and it is a non-finding — but only because of a property worth writing down, not
because the two are equivalent.**

What I swept, exhaustively, is every filesystem-derived fact in the file, in both roles: as the *question*
asked and as the *answer* supplied.

Named-path facts: `isFile(join(task.dir, 'setup.sh'))` (`:391`); `isFile(join(root, 'objectives.yaml'))`
(`:569`, mine); `scanFixtureDir(join(task.dir, sub))` (`:398`) for `solutions/` and `antisolutions/`.
Walk results: `files` from `shellScripts(root)` (`:458`); `graders` as a filter of it (`:470`);
`graders.length` (`:486`, `:569`, `:686`); the anti-solutions loop's filter on `files`; `bank.tasks`,
which `loadBank` assembles from a recursive `readdir` for `task.yaml`; and the two string derivations off
walk results, `taskDirOf(grader)` (`:578`, `:584`, `:436`) and `dirname(dirname(file))` (`:639`).

**The site: `!graders.has(join(task.dir, 'grade.sh'))` at `lint.ts:375`.** The *question* is a named-path
fact — is there a readable `grade.sh` at this exact path — and the *answer* comes from the walk. Those are
not the same check, and I measured the divergence rather than assuming it: `shellScripts` filters on
`entry.isFile()`, which does **not** follow symlinks, whereas `isFile` uses `stat`, which does. So on a
copy of the committed bank with `014-grow-home-lv/grade.sh` replaced by a symlink to a real script:
`graders checked: 4`, exit 1, 4 problems — `014-grow-home-lv is in the bank but has no grade.sh` plus
three `no sibling grade.sh`. `measured`. The same substitution on `setup.sh`, which *is* checked by named
path, gives exit 0 with 0 problems. `measured`. The two rules genuinely disagree about a symlink, and
`isFile`'s answer is the one that matches the runtime, since `loadTaskScripts` reads both with `readFile`,
which follows symlinks.

**Why it is nonetheless not this round's defect, and the distinction is exactly the one item 1 turns on:**
NEW-1's shape is a walk supplying the **expectation**. Here the expectation comes from `bank.tasks` and
the walk supplies only the **observation** — the same architecture as the `setup.sh` rule beside it, which
the brief endorses. A walk that under-reports an observation against an independent expectation makes the
rule fire when it should not, which is a **false fail** and loud. A walk that supplies the expectation
makes the rule not fire at all, which is a false green and silent. Direction, not structure, is what
separates them, and this one fails closed in every case I could construct. `reasoned`, with both symlink
ends `measured`.

Two adjacent sites I checked and am recording as clean rather than leaving unstated:

- **`taskDirOf(grader)` against `new Set(bank.tasks.map(t => t.dir))`** (`:436`) is two walk results
  compared to each other, with no named-path fact in it, so it is not an instance of the interchange
  asked about. The path strings agree by construction: `task.dir` and every grader path are both composed
  with `join` from the same `root` string that `lintContent` received, with no `realpath` and no
  renormalisation on either side. (That this reconciles two walks and so cannot notice a whole task
  directory vanishing is P33, parked, and not restated here.) `reasoned` from source.
- **`emittedByTask.get(dirname(dirname(file)))`** (`:639`) derives a task directory by name from a
  walk-found path and looks it up in a map keyed by `taskDirOf`. Both sides come from the same `files`
  walk, so they agree by construction for the shape the bank uses; where they can disagree — an
  anti-solution nested one level deeper — it fails closed twice, measured on a real fixture: the `extra/`
  directory is reported as a non-`.sh` entry under `antisolutions/`, and the nested file is reported as
  `no sibling grade.sh`. Exit 1, 2 problems. `measured`.

I found **no** site where the reverse substitution happens — a walk-shaped question answered by a
named-path fact — and none where a named-path fact is used to assert the absence of something the file has
no independent expectation for. The one candidate for the latter, `graders.length === 0` at `:486`, is a
walk result reported as its own subject: the message says the walk found nothing, which is what the walk
knows.

### Not reported, per the standing ruling

P32 (confirmed still open: `lint.ts:159` returns an empty `ParsedHeader` when the header is absent), P33,
P34, P35 shape B, F3/F9/F10. `shellcheck` not raised. No VM operation of any kind, no `sudo`, no
`ssh-keygen`, no `.env.local` access, no `npm run validate`, no `npm run test:vm`, no `phase-1` tag, no
subagent, no reviewer. Nothing read under `/home/daxtangco/sechelp-tools`. Phase 1's exit criterion
remains NOT RUN and cannot be met: the RHEL 9 ISO is not downloaded.
