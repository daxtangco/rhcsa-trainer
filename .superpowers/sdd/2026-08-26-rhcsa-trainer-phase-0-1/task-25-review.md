# Task 25 review — README, exit criterion, `rhcsa lint`

BASE `d0ff66b` → HEAD `ccdba26`, branch `phase-0-1`. Every conclusion below is labelled
`measured` or `reasoned`. All mutation work was done in `/tmp` copies built with
`git archive ccdba26 | tar -x -C /tmp/<dir>` and `node_modules` symlinked back; the real
tree was clean before and after (`measured`: `git status --porcelain` empty, `git tag -l`
empty, HEAD still `ccdba26`).

## Verdicts

- **Spec compliance: CHANGES REQUIRED** — one explicit instruction was not met. The
  fifteen handed-over checks were to be folded in *without losing one*; check 1 has no
  home in the checklist that claims to hold it, and check 8's second half was dropped
  (F4). Everything else the brief and the twelve mandates specify landed, with the
  required copy strings verbatim.
- **Task quality: CHANGES REQUIRED** — the new gate can report a clean bank that is not
  clean, by two independent routes (F1, F2). Both are one-line fixes. Nothing else in
  the diff is wrong; the parts that were hardest to get right were got right.

The work is good. It is stopped on three one-liners, not on a rewrite.

## Gates — run, not cited

| Gate | Result | Note |
|---|---|---|
| `npm run typecheck` | exit 0 | `measured` |
| `npx vitest run` | **408 passed / 35 files / 0 skipped**, exit 0 | `measured`; grepped the log for skip/todo, zero hits. Baseline was 386/33 |
| `npm run build:web` | exit 0 | `measured`, backgrounded; the 745.34 kB / 206.34 kB gzip warning is the accepted one |
| `npm run lint:content` | exit 0, **stderr empty** | `measured` |

The claim of 408/35/0 is exact. A skipped test is not a passing test and there are none.

`measured`, whole repo (`src`, `test`, `scripts`, `*.ts`/`*.tsx`): zero `enum`, zero
`namespace`, zero decorators, zero parameter properties, zero non-null `!`. `as` casts
exist at `src/engine/content/task.ts:96,101,108`, `src/engine/grading/verdict.ts:29`,
`src/web/api.ts:201` and in `test/content/concept.test.ts` — all pre-existing, none in
this diff. The only `as` in the three new files is the word inside a comment at
`test/vm/e2e-exit-criterion.vm.test.ts:49` explaining why the file does *not* cast.

`measured`: `test/server/checkpoint-oracle.ts` does not appear in the diff at all (0
occurrences of the filename). P28's false comment was left alone, as ruled.

## Target 1 — `rhcsa lint` as a gate that must be able to fail

**Disposition: the gate is real and fails on everything it claims to catch, but it has
two silent-green channels — one of them the predicted one.**

All four required plants reproduced independently in a `/tmp` copy (`measured`). Each
exits 1 with a named problem; the unmutated copy and the restored copy exit 0:

| Plant | Result |
|---|---|
| undeclared emitted id | exit 1, named |
| duplicated `# baseline-fail:` header | exit 1, named (`parseExpectations` throws `ContentError`) |
| variable id (`ck "$x"`) | exit 1, named via `nonLiteralIds` |
| non-kebab id | exit 1, named via `KEBAB_ID` |

Four more of my own, all exit 1 (`measured`): interpolated suffix, header deleted
entirely, non-kebab id inside `# unprobed-invariant:`, and an emitted id renamed out from
under its declaration.

**Does it check every task, or stop at the first?** Every task. Plant in the *last*
grader in iteration order → exit 1. Five faults across five different graders → **five**
problems reported, not one (`measured`).

One near-miss worth recording, because it is the failure shape this branch keeps hitting.
My first plant used `sed -i 's/^ck fs-home-size/…/'` and produced exit 0 — which looks
like a defect and is not. The bank emits ids through *indented* `ck_pass`/`ck_fail`, so
the pattern matched nothing and the "clean" exit proved something adjacent to my claim. I
caught it with an md5 before/after, redid it as
`s/(ck_(pass|fail)) fs-home-size/\1 fs-home-sizex/g`, and got exit 1 with 4 problems. A
mutation that does not land is not evidence.

**Mandate 11 — reuse, not a sixth regex.** Honoured (`measured`). `lint.ts` imports and
calls the real `checkpointIds`, and `nonLiteralIds` does something better than restating
bash: it rewrites the candidate to a sentinel literal and re-runs the real extractor,
borrowing the scanner's lexical knowledge instead of duplicating it. `checkpointIds`'
first production use behaves as the lint assumes: `assert.sh` → `[]`, the 014 grader → 5
ids, matching what `countCheckpoints(scripts.grade)` hands the runtime at
`src/server/app.ts:164`.

**The three committed negative shapes** — `ck $x` in a heredoc body, in a comment, and
inside a quoted string — each verified independently against a differential harness that
also runs the same snippet through real bash with `content/lib/assert.sh` prepended
(`measured`). Six further shapes tried in search of a fourth false fail: **none found**.
A false fail here blocks a correct lab, and I could not produce one.

The report's stated limit — it checks that ids *agree*, not that a grader is *correct* —
is accurate and correctly scoped.

### Can the lint report a clean bank that is not clean?

**Yes, two ways.**

**F1 — "nothing to check" is not distinguishable from "all clear" by exit code.**
`lintContent` filters `graders = files.filter((f) => f.endsWith('/grade.sh'))` and has no
`graders.length === 0` guard. An existing content root with zero `grade.sh` files exits
**0** (`measured`). It is distinguishable in the human-readable stdout — `graders checked:
0` and `no problems in 0 grader(s)` — but not to the thing that gates: a CI step, a
pre-commit hook, or `npm run lint:content` in a wrapper reads the exit code and sees
green. A *nonexistent* root correctly exits 1 (ENOENT), so only the empty-or-moved case
bites. Partially mitigated by `content-headers-golden.test.ts`'s
`expect(inventory.length).toBeGreaterThan(20)`, which runs in `npm test` against the real
bank — but that is a different command, and the gate's own contract should not depend on
another gate. Fix: fail when `graders.length === 0` unless an explicit `--allow-empty`.

**F2 — the golden fixture is blind to `@phase` suffixes.** `HeaderRecord` stores
`{ kind, ids }` and `declaredIds` does `parseExpectations(...).map((d) => d.id)`, which
**discards the `@pre`/`@post`/`@both` suffix**; the ids are then sorted. Six shipped
headers carry `@post`. `measured`: changing `home-from-lv@post` → `home-from-lv` and
`fs-home-size@post` → `fs-home-size@pre` — which inverts an anti-solution's persistence
semantics, the single behaviour this project exists to teach — yields `rhcsa lint` exit 0,
empty stderr, and an inventory **byte-identical to the committed fixture**. The drift
detector cannot see the edit. `expectedStatus()` reads the phase, so the runtime's verdict
changes while every static check stays green. Fix: carry the phase into the inventory
(`id@phase`, or a parallel `phases` field).

**F3 — inherited blind spot, not load-bearing.** `CK_ID_WORD` copies `CK_CALL`'s
punctuation anchor set, so `! ck "$x"`, `if ck "$x"`, `while ck "$x"`, `LC_ALL=C ck`,
`time ck` and `eval 'ck …'` are invisible to the lint (`measured`). This is the already
parked `command-prefix-before-ck-negation` divergence in
`test/server/checkpoint-oracle.ts`, and it is *consistent*: the counter is blind to the
same shapes, so the lint's view matches the runtime's. No grader in the bank uses any of
them (`measured`). Documented in the lint's docstring. Inherited by design.

## Target 2 — the two refusals

**Disposition: both refusals are correct. Neither is itself wrong.**

**Mandate 7 — "values containing spaces survive intact" is false for unquoted values.**
The implementer is right, and I reproduced the whole chain under `/bin/sh` → dash
(`measured`): an unquoted value containing a space word-splits, dash tries to execute the
path tail, stderr shows `not found`, **the variable is left empty**, execution
**continues**, and the script **exits 0**. `node --env-file-if-exists` reads the identical
line correctly. Quoting fixes it under both loaders. Also measured: `RHCSA_SSH_KEY=`
exports as `''`, and a missing `.env.local` still reaches the command. This is the
user-facing half of the task and it is on the happy path — `vmrun.exe` lives under
`/mnt/c/Program Files (x86)/…` and the user's VM path has a space too.

The README **names which loader breaks**, and does it in the `### Environment` section
directly beneath the eleven-row variable table — where a reader setting these values is
standing, not in a footnote (`measured`). The blank-key blockquote is verbatim.

**Mandate 9 item 7 — refused, correctly.** `measured`, exact lines:
`scripts/r1-probe.sh:187` is `elif [[ $tcp_rc -eq 124 ]]; then`, classifying the 5-second
TCP timeout explicitly into `unreachable`/`dropped`. `tcp_outcome=unknown` occurs only
once, at `:221`, in the final `else`. The summary `case` is at `:236` with arms at 237
(`open`), 243 (`refused`), 251 (`unreachable`) and **258** (`*)`), and `:259` prints
`say "R1 CONFIRMED AS A PROBLEM…"`. So 124 is never swept into `unknown`, and the real
defect is the one the implementer names: the catch-all arm reports a *confirmed* problem
for an outcome the probe could not classify. R1 is still unverified, so that string is
what the user reads on first contact — a false fail against their own network. Recorded in
both `docs/r1-findings.md` and `docs/exit-criterion.md`'s known limits
(`exit-criterion.md:226-233`), with the classification's soundness stated alongside.

## Target 3 — honesty of the artifacts

**Disposition: honest. The RUN / NOT-RUN split is accurate and complete, verbatim copy is
verbatim, nothing is invented, and no document claims the exit criterion was met.**

`measured`, by whitespace-normalised substring match against the mandate text:

- The **NOT-RUN banner** (`exit-criterion.md:6-11`) is byte-verbatim, including the
  instruction to distrust the file if it is found already filled in — which is the right
  disclosure, because it tells the next reader what a violation would look like.
- **Mandate 2's replacement sentence** is byte-verbatim.
- Mandate 7's blank-key warning is verbatim; mandate 10's F7 rule is verbatim modulo the
  README's `**bold**` and line wrapping; mandate 12's `read -rsp` form is present
  (`exit-criterion.md:169`) with its accompanying sentence.
- Four independent NOT-RUN markers, one per deferred section (lines 6, 51, 84, 129), plus
  `exit-criterion.md:234-235` ("Nothing in Task 25's checklist above has been run") and
  `:254-255` naming exactly what *is* green now and adding "They are not the exit
  criterion."
- Nothing is filled in. No dates, no tallies, no plausible-looking numbers. The blank
  form is blank.

**The split checked against the diff** (`measured`): steps 1, 5, 6, 7 and 9-commit RAN;
steps 2, 3, 4, 8 and 9's tag NOT RUN. Step 5 genuinely ran — `docs/coverage-phase-1.md`'s
fenced block is byte-identical to a live `npm run --silent coverage` I executed myself.
The e2e test never ran: zero occurrences in the vitest log, correctly gated by the
`*.vm.test.ts` exclusion in `vitest.config.ts` unless `RHCSA_VM=1`. No NOT-RUN step is
written in language that reads as done; every one leads with its status.

**No document in this diff states or implies Phase 1's exit criterion was met.** The
blocker is stated as a blocker — the ISO is not downloaded, it needs the user's own Red
Hat account — and is never softened into a caveat. Nothing asks for Red Hat credentials
and no file would hold them. The guest password never appears as a command argument; the
`read -rsp` form is used and the doc explicitly warns against pasting it or putting it in
`.env.local`.

**Mandate 3 — genuinely zero live pipe-then-status sites** (`measured`). The only
`| tail` in either file is inside the comment at `exit-criterion.md:152-156` that explains
why the idiom is wrong. The two live `echo "exit=$?"` at `:165` and `:171` follow plain
redirected commands (`npm run validate … > log 2>&1`), not pipelines; `tail` comes *after*
the status is printed; and `set -o pipefail` is set at `:157` for anything the reader adds.
The doc teaches the correct idiom and says why.

## Target 4 — the e2e test read as a prediction

**Disposition: it cannot pass for the wrong reason on the assertions that matter, because
most of its predicted values are derivable from committed content and the guest-dependent
ones are mutually redundant. One assertion is satisfied by an empty result.**

Derivable, with sources (`measured`):

| Assertion | Derivable from |
|---|---|
| `checkpointTotal === 5`, `expectedTotal === 5` | `checkpointIds` on the real `grade.sh` → 5 ids |
| `prompt` matches `/12/` | `task.yaml:2` title and `:23-24` prompt ("at least 12 GiB") |
| `nudge.rung === 2`, `cards.rung === 3` | `session.ts:620` starts at `rung: 1`; `advanceRung` increments; `MAX_RUNG.practice = 5` so both are reachable |
| `'Extend existing logical volumes'` | `objectives.yaml:136`, the `text` of `storage.lvm.resize`, which is `task.yaml:7`'s objective |
| both card titles | `task.yaml:8-10` `requires_concepts` lists exactly those two concepts; titles measured from their frontmatter |
| `/xfs_growfs/` in rung 3 | present in both card bodies |
| `\n---\n` | `content.ts:253` joins with `'\n\n---\n\n'` |
| `cardBody.length > 3000` | measured 3669 |
| `done.phase === 'graded'` | `SessionPhase = 'active' \| 'graded'`; the comment "there is no 'done'" is correct |
| `done.rating === 'hard'` | `ladder.ts:83` `if (i.rungUsed === 3) return 'hard'`, reached because `:79` `hadRegression` is false, `:80` rung 3 < 4, `:81`/`:82` `passed` true. **The test's citation of `:83` is exact** — checked, because a citation that is off by a line is how a wrong claim survives review |

Guesses, and honest ones: `run.code === 0` (the solution fixture applies on a real guest),
`rebooted === true`, `regressionCount === 0`, `passed === 5`, `total === 5`,
`allPassed === true`. These are predictions about a guest that has never existed. They
fail *closed* — a wrong value goes red — and they are redundant with each other:
`expectedTotal` is derived statically from the same script, so faking a green would mean
editing `passed`, `total`, `incomplete` and `allPassed` together. That is the right shape
for a prediction. `incomplete === false` is the only exercise the truncation guard ever
gets against a real grader run anywhere in the suite, which is worth keeping exactly as
written.

All report field names exist: `passed`, `total`, `expectedTotal`, `incomplete`,
`allPassed`, `rebooted`, `rebootError?`, `regressionCount`, `checkpoints?` on
`GradeReport` (`src/server/session.ts:511-531`) (`measured`). So no
`expect(undefined).toBeUndefined()` passes vacuously — `report.rebootError` and
`report.error` are real optional/absent fields, not typos.

**F5 — one assertion an empty result satisfies.**
`expect(Array.isArray(finalReport.checkpoints)).toBe(true)` is true for `[]`. That line is
the only thing checking that finishing unmasks the checkpoint names, and an empty reveal
passes it. This is precisely the defect class mandate 6 was written to remove — an
assertion satisfied by content that was never assembled — recurring in the same file,
in the one assertion mandate 6 did not name. Fix: assert `.length === 5` and pin one id.

**Nothing can hang unbounded** (`measured`). `E2E_TIMEOUT = 300_000` on the `it`,
`120_000` on `beforeAll`. Below that, every exec is bounded twice: `ssh.ts:46`
`timeoutMs ?? 120_000` passed to `execFile`, and `ssh.ts:145` `ConnectTimeout=10` in the
argv. `waitForSsh` is 30 attempts × 2 s. `chooseTransport` bounds its own probe
(`select.ts:35-56`). A timed-out child reports `code: 124`, as this project's convention
expects.

**F9** falls out of that: `waitForSsh`'s docstring calls 30 × 2 s "a minute of slack", but
with `ConnectTimeout=10` under dropped packets — the unverified R1 case — the loop costs
up to ~360 s, so `beforeAll`'s 120 s cap fires first and the operator gets a bare vitest
hook timeout instead of the diagnostic message the function wrote at line 39. Bounded,
never unbounded; just a worse first-contact message than intended.

**No listening socket needed** (`measured`). The test builds the app with `createApp` and
drives it with `app.request()`, a full in-process round-trip through Hono's router. No
`serve`, no `@hono/node-server` import, no port. Nothing was left listening.

## Target 5 — the fifteen checks, and mandate 6's floors

**Disposition: thirteen of fifteen survived intact and are traceable; check 1 was lost and
check 8 was halved, inside a table that claims otherwise. Mandate 6 landed and both
floors bite.**

Compared row by row against `## Step 16` of `task-24-report.md` (`measured`):

| Task 24 check | Task 25 home | Survived? |
|---|---|---|
| 2 start → prompt above a live shell | "The run" item 1 | yes |
| 3 `df -h /home` full 8 GiB | "The run" item 2 | yes |
| 4 F2 → rung-2 nudge, no commands | item 3 + e2e `:155-158` | yes, strengthened — the e2e asserts the objective, both titles, and the absence of commands |
| 5 F2 again → both cards in full | items 3-4 + e2e `:174-177` | yes, strengthened |
| 6 solve it in the terminal | item 5 | yes |
| 7 F4 → reboot wait, then 5/5 named | item 6 + e2e | yes |
| 9-11 exam-mode masking | "Second manual scenario" items 1-3 | yes — `which ones is not shown in this mode`, "no names anywhere" flagged as the *assertion* against the tally's *prediction*, `rung 2 is the maximum in exam mode`, F8 unmasks |
| 12-13 persistence message | "Second manual scenario" item 4 | yes, strengthened — the wording is quoted, "record the wording verbatim, including what it says about which checkpoint" is added, and it says a plain failure here is a defect and not a wording preference |
| 14 reset | "Fourth: reset" | yes — all seven sub-conditions present, including the rung not rolling back and why |
| 15 foreign-origin refusal | "Third" | yes — real browser, `python3 -m http.server 8123`, the exact `new WebSocket(…)` line, console text recorded verbatim, "a successful connection is a stop-the-line finding", and the reason it must stay manual |
| 1 picker: chapter numbers + SELinux tagged `supporting` | mapped to "The run" item 1 | **no** |
| 8 F8 → rating **with the "derived, not self-reported" explanation** | mapped to "The run" item 7 | **half** |

Checks 12-13 and 9-11 — the two groups Task 24 flagged as most likely to rot — both
survived, and both got *more* rigorous, not less. That was the important half and it holds.

**F4 — the two that did not.** `exit-criterion.md:105` says "This is the single checklist;
there is no parallel one. **Every check has a home above.**" That sentence is false:

- Check 1 is mapped to "The run" item 1, which reads *"Started the lab. The prompt was on
  screen the whole time: yes / no"*. It says nothing about the picker, nothing about
  chapter numbers, and nothing about the SELinux task's `supporting` badge. Item 1 is
  check 2's home; check 1 has none.
- Check 8's home, item 7, is *"Pressed F8. Rating:"* — the rating survives, the
  "derived, not self-reported" explanation does not.

Both dropped fragments live in the one place with **zero automated coverage**
(`measured`): the badge is rendered at `src/web/components/TaskPicker.tsx:63-65` and no
test anywhere references `supporting`; the explanation copy is at `src/web/App.tsx:281`,
and Task 24's own report states `App.tsx` has no test. `test/web/app.test.tsx` carries
`chapter: 14` as fixture data only and asserts nothing about it. So the mapping table
retired the checks that were the *only* coverage of those two renderings, and it did so
while asserting that it had not. This is the "second list is how a check gets lost"
failure arriving through a mapping row that points at a line not containing the check —
the citation-proves-something-adjacent shape, in the artifact whose whole job is
bookkeeping. Fix: two lines added to "The run".

**Can a future reader mistake a checklist item for a passing test?** No — the artifacts
say it clearly enough (`reasoned`, on measured evidence). Four independent NOT-RUN
banners, the distrust instruction, `:234-235`, `:254-255` naming what is green now and
adding "They are not the exit criterion", the intro at `:13-19` separating what the e2e
proves ("evidence the cards were *shown*") from what only the human can answer, and the
"Covered by" column marking which rows have an automated arm. The implementer's own
concern — that masking and persistence are checklist items and not tests, and that it
would rather say so than count them as coverage — is the correct call and is honoured.

**F6** is the one soft spot: five rows say "and asserted by the e2e test" in a column
headed "Covered by", and nothing in that table says the assertion has never executed. A
reader can derive it from step 2 of "What has to happen" and from the green-now list that
pointedly excludes `test:vm`, but the table itself over-credits. One clause fixes it.

**F7**, cosmetic: `:122-125` says "Checks 1, 7 and 8 carry predictions" and attributes the
`3 / 5` tally to that group. Task 24 attributes the `3 / 5` prediction to check **9**.
Check 7's 5/5 is a prediction too, so the list is not wrong, only the tally's owner —
and check 9's prediction status is stated correctly in its own section.

### Mandate 6 — both floors bite

`measured`, by mutating the assembly in a `/tmp` copy:

- Card bodies are **1811** and **1766**; `cardBody.length` is **3669**, a 669 margin over
  the 3000 floor.
- One card alone → 1864: **clears** the old 1500 floor, **fails** the new 3000 floor and
  both `##` heading assertions and the separator. Second card alone → 1798: clears 1500,
  and `/physical volume/i` is **false** on it.
- Empty assembly → the old `not.toMatch(/lvextend|xfs_growfs/)` **passes**;
  `toContain('Extend existing logical volumes')` **fails**. Same for a rung-1 body
  substituted for rung 2.

Both original defects are now detected in both directions.

**The 1811/1766 vs 1814/1773 gap is trimming, confirmed — not drift** (`measured`, and I
checked it rather than accepting it, because "close enough, must be trim" is how a real
drift gets waved through). Raw bytes after the frontmatter's closing `---` are exactly
**1814** and **1773**, the mandate's numbers. gray-matter's `.content` gives 1812/1767,
and `.trim()` gives **1811/1766**, the report's numbers. The 3- and 7-character deltas are
precisely the leading and trailing whitespace the loader removes. The mandate counted raw
post-frontmatter bytes; the implementer counted the trimmed body the loader actually
serves. Both are right about different things and the content has not moved.

**F8**, cosmetic: the report says "~577 chars of margin remain" above the 3000 floor.
577 is `1811 + 1766 - 3000`; the measured margin on the assembled body is **669**, because
the two `##` heading lines and the `\n\n---\n\n` separator are also in it. An
understatement, harmless.

**F10**, spec deviation, cosmetic: `docs/coverage-phase-1.md` wraps the coverage output in
a fence with a "regenerate with `npm run --silent coverage` and paste the output back"
note, rather than brief Step 5's direct-redirect form. The content is a byte-exact live
run (`measured`), and the fenced form is more useful in a markdown doc.

## Findings

| # | Severity | Direction | One-line failure scenario | Load-bearing |
|---|---|---|---|---|
| F1 | Medium | false green on the bank | Content root is moved or renamed; `rhcsa lint` finds zero graders, exits 0, and CI reads the bank as clean | **yes** |
| F2 | Medium | false green on the bank | A `@post` is edited to `@pre`, inverting an anti-solution's persistence semantics; lint exits 0 and the golden inventory is byte-identical | **yes** |
| F3 | Low | false green (missed non-literal id) | A future grader writes `! ck "$x"`; the lint does not flag it — but the counter is blind to the same shape, so lint and runtime agree | no |
| F4 | Medium | wrong truth-claim in the artifact; a manual check lost | The `supporting` badge stops rendering; nothing tests it and the checklist that claims to hold its check does not | **yes** |
| F5 | Low | false pass on the reveal path | Finishing returns `checkpoints: []`; `Array.isArray([])` is true and the e2e certifies the unmask | no — VM-gated, has never run |
| F6 | Low | reader over-credits coverage | Five rows read as "covered by a passing test" when that test has never executed | no |
| F7 | Cosmetic | — | The `3 / 5` tally prediction is attributed to check 7 instead of check 9 | no |
| F8 | Cosmetic | understatement | Reported margin 577 vs measured 669 | no |
| F9 | Low | misleading first-contact failure | Under dropped packets, `beforeAll` times out at 120 s instead of printing the diagnostic the function wrote | no |
| F10 | Cosmetic | — | Coverage doc uses a fenced block instead of a direct redirect; content is a byte-exact live run | no |

"Load-bearing" means it can produce a wrong truth-claim to the user or a wrong green on
the content bank, on the project as it exists today. F1, F2 and F4 qualify; F5 does not,
only because the test it lives in is gated off and has never run.

## To clear both verdicts

1. **F1** — fail when `graders.length === 0`.
2. **F2** — carry the `@phase` suffix into the golden inventory.
3. **F4** — add the picker check (chapter numbers, `supporting` badge) and the
   explanation half of check 8 to "The run".

F5 and F6 are worth taking in the same pass; they are a line each. F3, F7, F8, F9 and F10
need nothing.
