# Whole-branch review — Phase 0 + Phase 1 of the RHCSA Lab Trainer. The last gate.

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`. Range **`6791d4d`** (`master`) **..
`4312359`** — **61 commits, 188 files, 25 148 insertions, 146 deletions**. Tree clean, `git tag -l` empty.
Suite at HEAD: **433 tests / 35 files, all passing, none skipped.**

A note on the citations below, because you will see an earlier sha in them. Most of this brief was
measured at **`45344bd`**, and everything measured there still holds at `4312359`: the last commit is
Task 25's final fix round and it touches exactly two files, `src/cli/lint.ts` and
`test/cli/lint.test.ts`. Nothing in targets 1, 2, 4, 5 or 6 lives in either. Where a claim below says
`MEASURED at 45344bd`, treat the sha as provenance, not as a caveat — but if a claim about
`src/cli/lint.ts` itself carries that sha, re-measure it at HEAD, because that file did move.

Note the deletion count: 146 against 25 148 insertions means this branch is almost entirely new code, so
there is very little "did this change break an existing caller" surface and correspondingly more "is this
new thing right in the first place" surface. Spend your attention accordingly.

**Nothing reviews this after you.** Twenty-five tasks each had their own two-verdict review; those
caught what a task-shaped view can catch. You are here for what it cannot: the seams between tasks, the
invariants no single task owns, and the parked list that twenty-five reviews deliberately deferred to
you. After you there is one fix dispatch, one scoped re-review, and then the branch is finished.

## What this branch is, in two paragraphs, because it changes what counts as a defect

The user is preparing for the Red Hat RHCSA (EX200) exam and has told us plainly what this app is for:
*"im creating this app to prevent from reading any other references like a book to do everthing hands on
and learn from it."* The app is not a quiz over material learned elsewhere — it **is** the learning
surface. A student does labs in a real RHEL 9 VM, a bash grader inspects the resulting **end state**, and
the app tells them whether they solved it. Concept cards teach the concept in place of the book.

So the load-bearing failure on this branch is never a crash. It is **a wrong truth-claim to the student**:
telling them they solved a lab they did not (a **false pass**, which sends an unprepared person into a
$400 exam), telling them they failed one they solved (a **false fail**, which teaches the wrong lesson
just as firmly), or — the third direction, added late and now proven twice — a **false green on the
content bank itself**, where a static gate reports clean content that is broken. That third one is how a
bad grader reaches a student in the first place. Classify every finding by direction. There is no
harmless miscall here.

## Your inputs, in the order to read them

1. **`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/whole-branch-parked.md`** (1205 lines) —
   **read this first and read all of it.** Thirty-nine parked items, P1-P39 (P36 superseded by Task 25's
   NEW-3; P37 added from Task 25 round 4 and carrying the sharpest single sentence on the branch — *direction,
   not structure, is what separates them* — which you should read before target 6 and before any ruling on the
   named-path/walk family; **P38 and P39 came from Task 25's final re-review and are the two newest items —
   both one-line edits in `src/cli/lint.ts`, and P39 is a measured false fail on content, so it is the one
   parked item whose direction is the loud kind**), each labelled `MEASURED`,
   `CARRIED`, `CLOSED` or `ENDORSED`, most with a `Ruling:` line stating why it was deferred and what it
   costs if the ruling was wrong. This is your agenda, not background. It is also the highest-value
   document on the branch, because it is where twenty-five review cycles put the things they proved but
   chose not to fix.
2. **`docs/superpowers/specs/2026-08-26-rhcsa-lab-trainer-design.md`** — the spec. The plan argues from
   it; conflicts resolve against it.
3. **`docs/superpowers/plans/2026-08-26-rhcsa-trainer-phase-0-1.md`** — the 25-task plan and its Global
   Constraints, reproduced below.
4. **The diff package**, path given in the dispatch — **28 887 lines, 1.19 MB. Do not read it front to
   back**; a single linear read of it would consume most of your context and buy less than 2 000 lines read
   where the seams are. The targets below say where. Prefer reading files at HEAD over reading their hunks:
   this branch is 25 148 insertions against 146 deletions, so for almost every file the "diff" is the file,
   and the file is easier to reason about. Use the package for the commit list, the stat summary, and the
   handful of places where what changed matters more than what exists.

## Global Constraints — verbatim from the plan. Your attention lens.

- **Node >= 22.23.2.** `node file.ts` executes TypeScript directly — no build step, no `tsx`/`ts-node`.
- **Erasable syntax only.** **Never** `enum`, `namespace`, parameter properties, or decorators.
  `erasableSyntaxOnly: true` makes violations fail typecheck.
- **Relative imports carry the `.ts` extension.** **ESM only** — no `require`.
- **`sudo` cannot authenticate in this environment — there is no TTY.** Never a step that needs root on
  the WSL host. Guest-side root is *arranged*, not free: both transports connect as `student` and
  `/etc/sudoers.d/rhcsa-trainer` grants passwordless `sudo`, so guest-side scripts call `sudo`
  explicitly and non-interactively. **A guest-side script that assumes it is already root is a bug.**
- **Target exam version is RHEL 9.** No RHEL 10 content in these phases.
- **SELinux stays `enforcing` in the VM.** Never disabled or permissived to make a task pass.
- **Graders are read-only and their exit code is ignored.** A grader that repairs state, or aborts on
  first failure, is a defect. **Graders never read shell history** — grade end state, not commands.
- **`vmrun.exe` is `/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe`** — note the space,
  always quoted.
- **Do not read or copy anything from `/home/daxtangco/sechelp-tools`** — unrelated project, `.env`
  secrets.

Project-local and equally binding: **no non-null `!`**, and **`as` casts strongly discouraged**.
I have now stated the cast count wrong **three times** in briefs on this branch, so treat every number in this
paragraph as something to re-measure rather than cite. The history, because the shape of the error is itself
worth knowing: first *"exactly one cast survives repo-wide, at `src/web/api.ts:201`"* — false, that is the only
cast anyone ever *ruled* on, not the only one that exists. Then *"13 in `src/`, every one guarded by a predicate
immediately above it"* — also false, in both halves. The regex behind the first count matched comment prose; the
second assumed a uniform guard shape I had not inspected. **Counting is not measuring.**

Measured at `45344bd`, and this is the version target 6 is built on: **16 cast expressions across 14 lines in
6 files**, in five classes — 3 sound (guarded by an elementwise check testing exactly what the cast asserts:
`concept.ts:36`, `task.ts:54`, `objectives.ts:70`); **4 guarded by a stale-able list** (`task.ts:96`, `:101`,
`:108`, `verdict.ts:29` — target 6's subject); 6 benign coercions to `string` that assert no narrowing at all,
present only to satisfy `readonly string[].includes(unknown)` (`task.ts:96,97,101,102,107,110`); 1 sound, cast
only because `Object.hasOwn` is not a type predicate (`config.ts:54`, validated at `:39-43` which throws); 1
catch-block error-shape assertion followed by defensive null checks (`vmrun.ts:49`); and 1 unguarded by design
and documented (`api.ts:201`). So **two are not guarded by any predicate** and six are not narrowing
assertions. **No `as unknown as` anywhere** is the one part of the original claim that has held every time.
`noUncheckedIndexedAccess` and `verbatimModuleSyntax` both on.
**Nothing in this project needs the user's Red Hat credentials** — flag any step that asks for them or
any file that would hold them. **The guest password must never appear as a command argument** (the `-gp`
argv exposure at `src/engine/vm/vmrun.ts:108` is a documented known limit, not a finding).

## Target 1 — P24 + P29 together. The top item on the branch, and the one thing the fix dispatch must not leave alone.

Read P24 and P29 in the parked file as one item; they are one root seen from two ends.

**P24, server side, measured:** a grader's expected checkpoint count can collapse to **0**, and a report
with expected total 0 plus one passing arrival comes back as **a pass**. `allPassed` guards only against
*zero arrivals* (`checkpoints.length > 0` at `src/engine/grading/verdict.ts:80-81`) — it does not guard
against a collapsed *expected* count, and those are independent events. The amplifier is what makes this
the top item: **one injected line inside `content/lib/assert.sh` takes lab 019's expected count from 8 to
0 for every grader in the bank**, because every grader sources it. Measured injections that each produce
0: `echo ${a[1 << 1]}`, `cat <<EOF'`, `echo $[1 << 2]`, `echo ${s: 1 << 2}`.

That measurement was taken at `28ad7f0`, and `session.ts` then went through six more review rounds — so I
re-checked the two load-bearing lines at `45344bd` before writing this: `const incomplete = status.size <
expectedTotal` and `allPassed: allPassed(v) && !incomplete` are still there, unchanged in substance, at
`src/server/session.ts:569` and `:591`, with `verdict.ts:81`'s `checkpoints.length > 0` still the only
zero-guard. **P24 is live at HEAD, not merely live when it was found.** Confirm that yourself — it is the
one claim in this brief whose staleness would move the whole agenda.

**P29 — right about the direction and the mechanism, wrong about where the code lives, and that changes the
fix.** I traced this at `45344bd` rather than trusting the note. P29's substance holds: the rating *is*
derived from `report.allPassed`, and for a truncated run that is a **false fail** on a lab the student may
have solved. But it locates the defect at the Finish button, and **Finish derives nothing** — so the picture
is both better and worse than the note reads.

Better: the rail **already withholds** in P24's measured shape. `Rail.tsx:93` derives
`countSuspect = report.total > report.expectedTotal` locally, and `verdictFor` (`:64`) returns `null` the
moment it is set. At `expectedTotal === 0` with any checkpoints arriving, `total > 0` holds, so the visible
verdict is withheld and the amber box at `:170` fires. Half of P24's recommended item 2 is, in effect,
already built — client-side and derived rather than as a server field, which is why the standing ruling not
to report "no `countSuspect` field" as a gap still stands.

Worse, and this is the actual live defect: **`deriveRating` does not consult it.** `src/server/app.ts:316-323`
passes `passed: report.allPassed` straight into `deriveRating`, and `report.allPassed` is
`allPassed(v) && !incomplete` — which at `expectedTotal === 0` is `true` for any all-passing prefix. Finish
is enabled whenever a report exists (`Rail.tsx:263`). So on one run: the screen refuses to score it, and the
rating derived from the same report calls it a pass. The surface that withholds is the one the student reads
and forgets; **the surface that asserts is the one that persists into FSRS scheduling.** That is not two
surfaces disagreeing in the same instant — it is the transient one being right and the durable one being
wrong.

**So P24 and P29 are not two defects sharing a root. They are one unguarded line, `app.ts:318`, reached from
two directions:** a truncated run (`incomplete` true → `allPassed` false → a `hard`-shaped rating on a lab
that may have been solved, a **false fail**) and a collapsed count (`expectedTotal === 0` → `incomplete`
false → `allPassed` true → a pass rating on a grader that died a third of the way down, a **false pass**). A
fix at that line and its two neighbours addresses both directions. A fix at the Finish button addresses
neither — which is the concrete reason the "do not reduce this to disabling Finish" instruction below is a
correctness point rather than a UX preference.

**CORRECTED after the whole-branch review, which caught this and was right.** I wrote here that
`grep -rn countSuspect src/ test/` returns five hits, all in `Rail.tsx`, none in `test/`, and concluded that
"the only guard currently standing between P24 and a student is an **untested** client-side derivation" and
that "that guard needs a test whether or not it moves."

**The grep is accurate; the conclusion drawn from it is false.** The guard is behaviourally covered from two
directions. `MEASURED` twice — once by the reviewer, once by me, independently, in a `/tmp` copy of
`4312359`: mutating `Rail.tsx:93` to `const countSuspect = false` gives **2 failed | 18 passed** on
`test/web/rail.test.tsx`, killing `warns when more checkpoints arrived than the script declares, and does
not fail the run` and `warns on a declared count of zero even though the report says everything passed` —
the second of which is literally P24's measured shape. Dropping `|| countSuspect` from `verdictFor` at
`:64` kills the same two.

I inferred absence of coverage from absence of an **identifier**, and a test that drives a component through
props and asserts on rendered output never mentions an internal variable's name. That is this brief's own
defect class (b) — a citation proving something adjacent to its claim — committed by me in the sentence that
dispatches remediation work. Left in place rather than deleted, because the wrong instruction ("write that
test") would otherwise spend fix budget on a test that already exists while the two things that genuinely
have no coverage — the partial-deflation class and `deriveRating`'s indifference to any suspicion signal —
got none.

The parked file records the shape of the joint fix — **refuse to create a session at expected count 0**,
and **promote mandate 10.5's `console.warn` into a report field marking the run unreliable**, with the rating
path reading that field instead of `allPassed`. Given the above, treat "make `deriveRating` withhold on the
same condition the rail already withholds on" as the minimum, not the whole. Your job is not to accept that
shape. Your job is to check whether it is sufficient and whether it is safe:

- Does refusing at count 0 close the whole class, or only the total collapse? P22 records the corrected
  condition for a false pass — `arrivals >= expectedTotal AND arrivals >= 1 AND every arrival passed AND
  arrivals < real total` — and records that a **partial** deflation is unreachable from the measured
  fail-open class only because every heredoc fail-open zeroes the count rather than deflating it. **Test
  that claim.** If any lexer bug can deflate 8 to 3 rather than to 0, the count-0 refusal is a partial
  fix wearing a complete one's clothes, and P22's reasoning — which has already been wrong twice in
  opposite directions — is wrong a third time.
- Does the unreliability field reach every consumer, or does one screen still read `allPassed` directly?
  `deriveRating` is the consumer I have already measured as not reading it; **find out whether it is the
  only one.** Note that `deriveRating`'s other inputs — `anyPassed: report.passed > 0` and
  `hadRegression: report.regressionCount > 0` — come off the same suspect report, so a withhold decision
  taken at the `passed` argument alone may still let a truncated run write a rating.
- **What happens to a rating once written? I asked this here, then answered it, and the answer shrinks this
  target — so take the correction rather than the original bullet.** I had written that a rating may be "a
  permanent scheduling fact" and that objective ids being permanent scheduling keys made this "the one place
  on the branch where a wrong write cannot be cleaned up." **That framing is wrong for ratings.** Measured at
  `45344bd`: no scheduler exists in `src/`, `src/server/` performs zero disk writes, sessions are an in-memory
  `Map` (`session.ts:611`), and a rating's whole life is derive → JSON → React state → rendered text. Nothing
  persists it. The permanence argument belongs to invariant **(a)**, which is about ids, not ratings.
  So P29's blast radius is **one line of displayed text in one finished attempt**, not a corrupted schedule.
  P29 remains a real defect at `app.ts:318` and still deserves the joint fix with P24 — a false fail is a
  wrong truth-claim to the student whether or not it is durable — but **do not rank it as unrecoverable, and
  do not let anyone "fix" it by building persistence.** The same trace produced a separate finding, which is
  target 2 invariant (e).
- Can the refusal trap the student? A session that cannot be created is better than a false pass, but a
  session that cannot be *closed* is the failure P29's ruling was written to avoid.

**Do not let the fix reduce to "disable Finish".**

## Target 2 — the five invariants that span tasks. No task review could see these, and they are why you are on the most capable model.

Each of these is one property enforced in several places by different tasks. A task review sees one
place. Check each end to end and say where the chain is unguarded.

**(a) Objective ids are permanent scheduling keys, and the referential graph has exactly one missing
edge.** The FSRS scheduler keys review state to objective ids, so an id is not a label — it is a database
key with no migration path, and a rename silently orphans the student's history for that objective.

I checked this myself rather than hand it to you as an open question, and most of it is genuinely guarded:
`checkCoverage` in `src/engine/content/bank.ts:174-197` validates `task.requiresConcepts` against the
concept map, `task.objectives` against `bank.objectives.byId` (`… maps to unknown objective`), and
`concept.prerequisites` against the concept map; and `test/content/objectives-golden.test.ts` locks the
full `id -> { text, chapters }` map of both taxonomies against a committed fixture, for this exact stated
reason, having been written because three silent mutations passed the structural tests.

**The missing edge is `concept.objectives`.** `bank.ts` iterates concepts only for their
`prerequisites` (`:192-197`) — a concept card's own `objectives:` list is never checked against
`bank.objectives.byId`. `measured`. That is P5, and P5 is filed `CARRIED` at low severity, which I now
think undersells it: `test/content/concept.test.ts:42` rejects an *omitted* objectives key with the
comment *"a card with no objectives is unreachable from the disclosure ladder"* — and a card whose
`objectives:` names a **typo'd or renamed** id is unreachable in precisely the same way, silently, with a
fully valid-looking card. The fix is a loop mirroring `:181-183`.

I then closed the two obvious escape hatches myself, at `45344bd`: `src/engine/content/concept.ts:70-71`
parses `concept.objectives` as a string array and **requires it non-empty**, but never compares its entries to
anything; and `src/cli/lint.ts` contains **no reference to `.objectives` at all**, so the static content gate
does not cover it either. `measured`. So P5 is not "probably unguarded" — the loader, the lint and the
coverage pass have each been checked and none of them validates it.

Your job on (a): confirm that reading (a check I missed would still close P5, and saying so is more valuable
to me than agreement), then trace
the remaining stretch I did **not** check — from objective id to whatever the scheduler actually persists,
and to the grader expectation ids. A rename caught in the content bank but not in persisted review state
is still an orphaned history.

**(b) The `@pre` / `@post` / `@both` phase — verdict A versus verdict B.** "It works now" versus "it
survives a reboot" is the single distinction this app exists to teach and the one the exam punishes people
for missing. Task 25's F2 found that the golden inventory **discarded the phase suffix**, so inverting an
anti-solution's persistence semantics passed every static check while `expectedStatus()` changed the
runtime verdict. That has been fixed. **The question for you is whether F2 was the only unguarded link.**
Trace the phase from the content header through `parseExpectations`, `expectedStatus`, the two-phase
verdict, the reboot flow, and the Lab screen. Every place the phase is parsed, compared, stored or
displayed is a place it can be dropped, and it has already been dropped once in a comparison whose whole
purpose was to detect drift.

**(c) The disclosure ladder — I checked the main path; the sweep is what is left.** Rungs 1-5, with
`MAX_RUNG` practice 5 / drill 3 / exam 2.

What I measured, so you do not spend the budget here: the cap is enforced **server-side**, in
`advanceRung` (`src/server/session.ts`, cap resolved at `:498` as
`mode === 'guided' ? TOP_RUNG : MAX_RUNG[mode]`), which **throws** at the cap; `/hint`
(`src/server/app.ts:238-259`) turns that throw into a 409 before it produces any content, and the
non-guided arm renders `rungContent(s.rung, ctx)` with the already-capped rung. The guided arm at `:254-256`
returns **every** rung plus `TOP_RUNG` — that is not a bypass, it is guided mode's defined cap being
`TOP_RUNG`. `/hint` also deliberately does **not** refuse a finished session, argued at `:230-235` on the
grounds that exam stops at 2 and drill at 3 so neither can reach solution content post-finish. `measured`,
and it reads sound to me.

So the open questions are the narrow ones. **Is `/hint` the only path that can emit rung content?** Sweep
every endpoint and every serialiser for anything that returns a `RungContent`, a solution body, a card
body, or a whole `ctx` — the session-creation response, `/grade`, `/finish`, the task list, and anything
that writes a report to disk. A second emitter that renders from a client-supplied rung, or from `TOP_RUNG`
unconditionally, defeats a cap that is otherwise correctly placed. Related and worth checking with the same
sweep: `/grade` returns `revealed: false` on purpose, so that repeatable grading cannot become an answer-key
oracle in drill and exam mode — does every other report-touching path honour that same reasoning?

And check the argument at `:230-235` rather than only the code, since a confident comment about a failure
mode is this branch's worst artifact class: it is load-bearing for the claim that post-finish `/hint` is
safe, and it rests on the mode caps holding for a session whose phase has already changed.

**(d) `FakeTransport` versus `SshTransport` versus `VmrunTransport` — and here I found something.**
Almost every test on this branch runs against the fake, so wherever the fake is *kinder* than a real
transport the suite is measuring a world the student does not live in.

`LabTransport.exec` is documented in `src/engine/vm/transport.ts:20` as **"Never throws on non-zero
exit."** Both real transports honour that literally — and both still reject, for infrastructure rather
than exit status: `ssh.ts:132` throws when there is no guest IP (deliberately placed there so every
consumer inherits it), and `vmrun.ts` rejects when staging the script on the host fails or the injected
Runner throws, which its own comment at `:279-280` states outright.

`FakeTransport.exec` (`fake.ts:25-28`) returns whatever its handler returns. A handler *could* reject —
the type permits `Promise<ExecResult>` — but **no test on this branch makes one do so.** `measured`: across
the five test files that use `FakeTransport`, there is not a single throwing or rejecting handler.

So the one failure mode the real transports have that is not an exit code is **never exercised anywhere in
433 tests.** Your questions:

- What does the engine do when `exec` rejects mid-grade? Does the grading sequence catch it, or does it
  surface as an unhandled rejection, a 500, or — worst — a report that looks like a failed lab?
- **A rejection rendered as a failed checkpoint is a false fail**, and it is the highest-probability false
  fail on the branch, because R1 (WSL2 → VMnet8 reachability) is still **unverified**. "The transport
  cannot reach the guest" is a likely first-contact state for this user, not an exotic one.
- Then sweep the rest of the divergence surface, which I did not check: return shapes, stderr handling,
  exit-code fidelity, timeouts, and argument quoting.

Note in the fake's favour, so you do not mistake its minimalism for a gap: its docstring refuses to
simulate Linux on purpose — *"a fake that pretends otherwise would let a broken grader pass its own
tests"* — and that is the right call, load-bearing for the whole grading design. The finding above is not
"the fake is too simple"; it is that one **real** failure path has no test at all.

**(e) "Its rating is recorded" — the in-app copy and the docs disagree about whether anything is stored,
and the docs are right. `MEASURED` at `45344bd`, and this one I am handing you closed rather than open.**

I traced this while answering a target-1 question ("what happens to a rating once written?") and the answer
turned out to be a finding of its own. The rating is derived at `app.ts:316`, returned in the JSON at `:326`,
put in React state at `App.tsx:186`, and **rendered as text**. That is the entire lifecycle. Measured:
`grep -rniE "fsrs|scheduler|schedule" src/` matches **one file, `src/web/App.tsx`, and only in the display
strings**; `src/server/` contains **no `writeFile`, `appendFile`, `mkdir`, `createWriteStream`, sqlite or
database call whatsoever**; sessions live in `#byId = new Map<string, SessionRecord>()` at `session.ts:611`.
Nothing persists. A reload loses it, a restart loses everything.

That is **correct and deliberate** — the plan's Architecture paragraph says so explicitly: *"only user history
would go in SQLite (deferred to Phase 2)."* And `docs/exit-criterion.md:226-229` states the limit exactly
right: *"FSRS is implemented and rated but nothing schedules from it yet"* and *"the ratings recorded above are
not yet stored anywhere."*

The UI says otherwise, in three places:

| site | text | true? |
|---|---|---|
| `Rail.tsx:240` | "This attempt is finished and **its rating is recorded**." | **No.** Nothing records it. |
| `App.tsx:279` | "**Scheduler** rating: `<rating>`" | **No scheduler exists.** |
| `App.tsx:291` | "grading again would change the report this attempt **was recorded against**" | Defensible — the report is held in the in-memory session for its lifetime. Judge it; I lean fine. |

So this is the **wrong-disclosure class (≥11 on this branch) landing in user-facing copy for the first time** —
every prior instance was a code comment read by the next author. This one is read by the person studying for a
$400 exam, and it tells them their attempt history is being kept when it is not. For an app whose stated
purpose is to replace the book and track what still needs practice, "your rating is recorded" is not a cosmetic
wording slip: it invites the user to rely on a study record that does not exist and will be gone at the next
restart, with nothing in the interface ever contradicting it.

It is also a textbook instance of **why this target exists**: Task 25 wrote the doc that gets it right, an
earlier task wrote the copy that gets it wrong, and **neither reviewer saw both files.** No task-scoped gate
could have caught it.

Your job here is narrow, since I have already measured it: confirm the three strings and the absence of
persistence independently, decide whether `App.tsx:291` is in or out, and rule on whether the fix is
**(i)** correcting the copy to match Phase 1 reality ("rated, not yet stored — Phase 2 schedules from this"),
or **(ii)** something stronger, since an honest string still leaves the user with no record. I lean (i) and
lean strongly against building persistence here — that is Phase 2's deliverable and the plan defers it by
name — but say if you disagree. **Do not let this become a Phase-2 SQLite store inside a copy fix.**

## Target 3 — the artifacts the user personally touches, on a machine where the VM does not exist yet

Phase 1's exit criterion is **not met and cannot be**: the RHEL 9 binary DVD ISO is not downloaded, and
only the user can fetch it (their own Red Hat account at developers.redhat.com). Standing ruling:
VM-dependent steps are **written, marked NOT RUN with the reason, and neither invented nor quietly
dropped**. A blocker is not to be softened into a caveat. The Task 25 review confirmed the current
artifacts honour this byte-verbatim.

One plan tension to know about rather than re-derive. The plan's external-blocker table says the ISO blocks
**"Task 25 entirely"**, yet Task 25 is marked complete. Standing ruling: the table describes *execution*,
not *authorship* — Task 25's deliverables are a VM-gated test file, two documents, a README section and two
npm scripts, all of which are writable and reviewable without a guest, and the plan's own Step 8 is the
manual half it explicitly says a test cannot assert. So the task was implemented, its VM-dependent steps
carry NOT RUN, and **Phase 1 is not claimed as exited.** `Cost if wrong: a completion marker on a task whose
only real proof has never run — which is exactly why the NOT RUN markings are checked byte-verbatim rather
than taken on trust.` If you think "complete" is the wrong word for that state, say so in one sentence; it
is a labelling question, not a fix, and the honest alternative is a distinct `authored, unexecuted` status
that this ledger has no vocabulary for.

What is left for you is the first-contact question the task reviews could only ask locally: **can a person
holding only this repo and a fresh VMware install get from nothing to a graded lab?** Read `README.md`,
`docs/exit-criterion.md`, `scripts/provision.sh`'s documented contract and the setup checklist as one
sequence, in order, as that person. Flag anything that assumes state the sequence has not yet created.
Two specifics worth checking because both have already bitten:

- **The unquoted-value trap in `.env.local`.** Measured: an unquoted value containing a space is
  word-split by dash, the shell tries to execute the path tail, the variable is left **empty**, execution
  continues, and it **exits 0** — while `node --env-file-if-exists` reads the same line correctly. This
  is on the happy path, not the edge: `vmrun.exe` lives under `/mnt/c/Program Files (x86)/…` and the
  user's own VM path contains two spaces. Confirm the README names **which loader breaks**, and names it
  where the reader will be standing when it bites.
- **`scripts/r1-probe.sh`'s `*)` arm at `:258` prints "R1 CONFIRMED AS A PROBLEM" for the `unknown`
  classification too** — a false fail against the user's own network. R1 (WSL2 → VMnet8 reachability) is
  still **unverified**, so this string is plausibly the first output the user ever sees from this project.
  It is parked (P8, P30); rule on whether the fix dispatch should take it.

Also: the exam limits in `src/engine/exam/limits.ts` (150 min, 210/300) are marked **UNCONFIRMED**. Check
the marking is honest and visible wherever those numbers are shown to the student — a confidently
displayed wrong passing score is a wrong truth-claim like any other.

## Target 4 — the two named defect classes, swept across the whole branch rather than one diff

These are not style notes. Each has cost this branch multiple review rounds, and each is invisible to the
test suite by construction.

**(a) A tool reporting success when it did not do what was asked.** `countCheckpoints` took **eight**
defects across six review rounds; every one was silent, and five consecutive reviews of it each found a
real defect the full suite passed over. Task 25's `rhcsa lint` joined the family immediately with two
more: a filter that could match nothing and exit 0, and a comparison that dropped the field it existed to
compare. Both are one sentence: **the gate reported agreement because it never looked at the thing.**
Sweep the branch for that sentence. Every gate, guard, validator, golden fixture and drift detector on
this branch is a candidate: what does it compare, and what does it silently not compare?

**(b) A disclosure whose wording is wrong.** Six occurrences on Task 23 alone. This is *worse than no
disclosure*, because the next author writes something unsafe on its authority — that is not a theory here,
it is the measured history: my own wrong mechanism was corrected, the correction was wrong in the opposite
direction, and the wrong version shipped into committed source as a comment (P28) before anyone caught it.
So when you check a disclosure, docstring, comment or parked note on this branch, **check what it claims,
not merely that it exists**. A confident sentence about a failure direction is exactly the artifact this
branch has been worst at.

A third, for your own output as much as the code's: **a citation that proves something adjacent to its
claim.** Three occurrences here — a measurement taken against a moving working tree, a mutant that changed
two things at once, and a mutant that tripped an *earlier* assertion in the same test and was credited to
the later one. Label every conclusion `measured` or `reasoned`, and when you cite a mutant, cite what it
proves and nothing more.

## Target 5 — what the single fix dispatch must carry: the doc-only corrections, P35's remainder, and P18

Most of these are already decided; you are checking the list is complete and the replacement text is right,
not re-deriving them.

**Added after the list was first written:** target 2's invariant **(e)** — the three UI strings claiming a
rating is "recorded" by a "scheduler" when nothing persists — belongs here too. It is a copy fix in two files
(`Rail.tsx:240`, `App.tsx:279`, and `App.tsx:291` if you rule it in), it is the cheapest correct-a-wrong-claim
on the branch, and it is the only one in this whole category that the **user** reads rather than the next
author. Rank it accordingly.

**Two items that were on this list are no longer.** An earlier draft of this brief routed P36 and P35 shape A
here, on the stated premise that a Task 25 round 4 was not worth opening for two cheap lint rules. Task 25's
round-3 re-review then found a load-bearing defect (NEW-3: the comment defending the surviving short-circuit
was false, and the residual re-opened round 3's own blocker for any bank that fails to load). That made a
round 4 mandatory, the premise collapsed, and both items went into it — same file, same `isFile`/walk
vocabulary, one review instead of two. **Do not carry P36; it is superseded and closed in round 4.** Check
round 4's diff as part of your range, and if its `objectives.yaml` guard is phrased as a **walk** rather than
as a **named-path** check, that is a finding — the whole argument for it turns on that distinction.

**Four things about round 4 are already settled; do not re-derive them.** A dedicated opus re-review
reproduced every mutant, table row, count and quotation in round 4's report, and I separately measured
two of them myself. (1) The guard at `lint.ts:569` is a **named-path** check
(`isFile(join(root, 'objectives.yaml'))`), not a walk. (2) It carries **no false-fail risk**: the guard is
*catch-local*, so a root whose bank loads cleanly never evaluates it — the widening is reachable only after
the loader has already failed. This was the one direction no round had measured. (3) The only lines removed
from `test/cli/lint.test.ts` in that commit are four comment lines, so neither exit-0 test was weakened.
(4) P35 **shape A shipped** and fires on none of the sixteen committed anti-solutions. What round 4 left
behind is P38 and P39 below — read those instead of re-opening the four above. If you do disagree with one
of them, you must disagree with a measurement, and say which command you ran.

What remains of P35 is genuinely still yours, and it is two questions rather than a ready fix:

- **Shape B — a command that succeeds but is a no-op on this machine.** Only closable at runtime, by requiring
  the anti-solution's verdict A to differ from the baseline's verdict A. That is a `harness.ts` change, in the
  gate that **has never executed** (it is `npm run validate`, ISO-blocked). Rule on whether it belongs in this
  dispatch or in Phase 2. Weigh that it is latent today and becomes load-bearing the first day `validate`
  runs — which is also the first day anyone trusts it.
- **`content/tasks/storage/014-grow-home-lv/antisolutions/03-wrong-lv.sh`'s header overstates its own
  protection**, and this is the wrong-disclosure class sitting in committed content. Its author reached this
  defect class independently, wrote the failure sentence almost verbatim, then concluded the exit-code check
  closes it. It does not: the exit-code check catches a fixture that *errors*, not one that exits 0 having done
  nothing, and not one whose command succeeds vacuously. It was deliberately kept out of round 4 so that a new
  content rule and an edit to its own candidate fixture would not land in one diff. Rule on it. Note the
  related static signal — "this anti-solution declares exactly the grade script's `# baseline-fail:` set" —
  fires on this same committed, deliberate, defended fixture, so **as an error it is a false fail on the
  shipped bank**; as a warning, or paired with the runtime check, it is defensible, but `rhcsa lint` has no
  warning tier today and inventing one is a design decision, not a fix.

The rest are decided doc-only corrections plus two structural rulings:

- **P28** — the false comment at `test/server/checkpoint-oracle.ts:530-532`. Replacement text is written
  out in the parked file; it is a three-line mechanical edit.
- **P22** — the same wrong mechanism in the round-5 and round-6 sections of `task-23-report.md`. Note the
  correction to P22's own file list: `src/server/session.ts:286-292` and the `28ad7f0` commit message are
  both **accurate** — do not "fix" them. Three surviving scratch copies are git-ignored and need no edit.
- **P20, P25, P26, P27** — disclosure texts with **measured wrong directions**. P25: `arith` resets
  across the newline and it is a silent **fail-open**, not fail-closed as both my note and round 6's
  disclosure said. P26: the arithmetic-context class is **current** syntax, not deprecated-only — five
  current contexts fail the same way. P27: a third `closingQuote` call site, already wrong. Verify each
  replacement sentence states the direction correctly, because these are precisely class (b).
- **P18 — extract a shared `lexBash`.** The strongest *structural* item on the list, measured twice, with
  three drift sites named. It is also the only real fix for P19's command-prefix blindness. Rule on
  whether one fix dispatch can carry it safely; if it cannot, say so plainly and say what it costs to
  leave three hand-rolled lexers in a project whose core gate is a lexer.
- **P21 — the property test over the oracle**, endorsed with a **non-optional condition** (the generator
  itself must be validated, or the test proves the oracle agrees with a generator nobody checked). If the
  fix dispatch adds it, the condition is not optional.
- **P38 and P39 — the two newest items, both added after Task 25's final re-review approved.** Both are
  one-line edits in `src/cli/lint.ts`, the same file P35's remainder and target 6 already open, which is
  why they were not worth a round 5 of their own. P38 is a comment at `:519` asserting "the rules ran
  unconditionally above" on the one path where they did not (the floors call is at `:575`, outside the
  `catch`, gated on `bank !== undefined`) — class (b), and the third consecutive round to leave an
  inaccurate sentence in a comment it rewrote. **P39 is different in kind and you should read it first:
  it is a measured false fail on content.** `SHELL_OPTION_LINE = /^set\s+[-+]/` at `:211` is start-anchored
  only, so `:225` discards the entire line — an anti-solution whose body is
  `set -euo pipefail; sudo lvextend -L 12G /dev/rhel/home` is rejected as "nothing here but comments and
  shell options", with the rule named in the message, telling its author the opposite of the truth. It is
  the only parked item whose direction is the loud kind. If you take the regex fix, the constant's own
  comment must change in the same edit: the sentence "the whole line is what matches" is what let the
  defect through authoring.

## Target 6 — a documented in-repo convention with four violators. `MEASURED` at `45344bd`, after my own cast claim turned out wrong three times

**Read the history of this target before the target itself, because it is a worked example of the thing this
whole review is for.** For most of Phase 1 I told reviewers there was **exactly one** `as` cast repo-wide, at
`src/web/api.ts:201`. Six task reviews accepted the framing. False — that is the only cast anyone ever *ruled*
on. So I rewrote this target to send you hunting for unguarded casts, and told you there were **13, every one
guarded by a predicate immediately above it.** Also false, in both halves. The third measurement, which is the
one this target rests on: **16 cast expressions across 14 lines in 6 files**, and the classes matter more than
the number —

- **Sound, guarded by a check that tests exactly what the cast asserts (3):** `task.ts:54` and `concept.ts:36`
  (`stringArray` checks `Array.isArray` plus every element `typeof string`, pushes a problem, returns `[]`);
  `objectives.ts:70` (gated on `bad`, which rejects non-integers and anything outside 1-28).
- **Guarded by a stale-able list (4)** — `task.ts:96`, `:101`, `:108`, `verdict.ts:29`. **This is the target.**
- **Not narrowing assertions at all (6):** `task.ts:96,97,101,102,107,110`'s `raw.X as string` exist only to
  satisfy `readonly string[].includes(unknown)`. I previously counted these as "guarded casts." They assert
  nothing, and they would disappear entirely under the fix below.
- **Sound, cast only because `Object.hasOwn` is not a type predicate (1):** `config.ts:54`, validated at
  `:39-43`, which throws.
- **Not guarded by any predicate (2):** `vmrun.ts:49`, a catch-block error-shape assertion followed by
  defensive `code ?? 1` and null checks — acceptable in this idiom but not "guarded"; and `api.ts:201`, the
  ruled `fetch` boundary, unguardable without a schema validator, which is why it was ruled.

So my "every one is guarded" was wrong about two sites and meaningless about six. **There is still no
standalone cast finding and you should not spend the pass hunting one** — but do not take that from me on
authority, because I have now been wrong about it three times in a row and the failure was the same each time:
I reported a count from a regex without checking what the regex included. **Counting is not measuring.** I am
leaving all three wrong versions in rather than replacing them with the answer, because each reached a dispatch.

**What the reading found is one level up, and it is not a style preference — it is a convention this codebase
already documents, twice, being violated in four places.**

```ts
// src/engine/vm/config.ts:20-22
// Exhaustive by construction: adding a TransportKind fails to typecheck until
// it is listed here, so this list cannot drift out of sync with that type.
const KINDS: Record<TransportKind, true> = { ssh: true, vmrun: true, fake: true }
```

`src/server/app.ts:29-31` (`MODES: Record<SessionMode, true>`) carries the same comment and **explicitly cites
the first as its precedent** ("the same way config.ts's KINDS is"). And `app.ts:38-40` is the template, which
matters because it does not merely make the cast safe — it removes the need for one:

```ts
function isSessionMode(v: unknown): v is SessionMode {
  return typeof v === 'string' && Object.hasOwn(MODES, v)
}
```

A real type predicate narrows, so the four casts and the six `as string` coercions all go away together.

### Six lists, three exposure levels. Fix the bottom row; **name the middle one.**

| idiom | *removed* or renamed member | *added* member | sites |
|---|---|---|---|
| `Record<Union, true>` | compile error | compile error | `config.ts:22`, `app.ts:31` |
| `readonly Union[]` | compile error | **silent, list short** | `ladder.ts:33` (`readonly Rung[]`), `expectations.ts:10` (`readonly ExpectPhase[]`) |
| `readonly string[]` | **silent at `task.ts` — the cast it guards becomes a lie. NOT silent at `verdict.ts`: TS2367 at two `src/` sites plus two named tests. See the correction below.** | **silent** | `task.ts:10,11,12`, `verdict.ts:17` |

Today every list matches its union exactly — I checked all six, so nothing is broken right now. The defect is
that **nothing keeps four of them matching**, and each of those four guards a cast four to sixteen lines below
its own union declaration *in the same file*.

The middle row must be named in whatever finding you write, or the next author fixes four sites, believes the
class is closed, and leaves two that still fail in one direction. `RUNGS` is consumed at `app.ts:255` to build
the full rung list served to the client, so a silently short list there means **disclosure content the student
can never reach.** But `Record<Union, true>` is the *wrong* mechanical fix for those two: both are ordered
arrays and `RUNGS`' order is load-bearing at `app.ts:255`. Deriving the array from a record, or adding an
exhaustiveness assertion, is the shape there — flagged so nobody converts them and breaks ordering.

### Two failure directions for the bottom four, and the second is the one worth the finding

- **Union gains a member, list not updated** → valid content rejected. A silent **false fail on the bank**.
- **Union loses or renames a member, list keeps the old string** → `includes` passes, and the cast then asserts
  a type the value does not have. An invalid value enters typed code as valid, with no compile error and no
  runtime error at the boundary.

**CORRECTED after the whole-branch review: the ranking in the next two paragraphs is inverted, and the
table's "removed or renamed" cell is wrong for `verdict.ts`.** `MEASURED` by the reviewer, one mutant each:
removing `'skip'` from `CheckpointStatus` with `STATUSES` left stale is **not** silent — it raises `TS2367`
at two `src/` sites, `grader.ts:113` and `harness.ts:140`, and a developer who deletes both as dead then
trips two precisely-named tests (`counts a pass-to-skip transition as a regression`, `does not let a skip
silently satisfy a declared failure`). The genuinely silent removal site is **`task.ts`**, the one called
"milder" below: tsc's single error is in a *test fixture*, not in `src/`, and once the developer fixes the
literal the compiler points at, the build goes green with `SCOPES` still holding a string no longer in the
union, and the cast at `:96` asserting a type the value does not inhabit.

So: the site this brief called sharpest is the best-defended one, and the site it called milder is the
silent one. What remains true and load-bearing about `verdict.ts` is the **addition** direction, described
next — that one is silent, `MEASURED` at tsc 0 / suite 433/433, and it is the half that composes with the
deflation hole into a false pass. Read the paragraph below for the addition direction only; disregard its
"in both directions" and its claim about removal.

Adding a fourth
`CheckpointStatus` — the obvious future one being `'error'`, to distinguish a grader that crashed from a check
that failed — leaves the build green, `STATUSES` stale, `asCheckpoint` returning `undefined` at line 27, and
`parseVerdict` filing the line under `noise`: **a checkpoint silently disappears from the verdict rather than
being reported.** Going the other way, a status removed from the union but left in `STATUSES` puts an
out-of-union value straight into `allPassed`, on the grading path. That is *the gate reported agreement because
it never looked at the thing*, arriving through the type system instead of through a walk. It also lands next to
**P24**, where a collapsed expected count reports a pass — so **work out whether a dropped checkpoint and P24
compose into a false pass.** That pairing is why this target is here rather than parked.

`task.ts:10,11` are milder but not cosmetic: `scope` drives `coveredObjectives` in `bank.ts:170-210`
(`if (task.scope === 'exam-objective')`), so a new scope defaulting to `'exam-objective'` quietly changes
coverage accounting; `weight` feeds scoring. **`task.ts:12` is a trap:** it deliberately mirrors `TaskTransport`
(`'ssh' | 'vmrun'`) and **not** `TransportKind`, which also has `'fake'`. The content schema excludes the test
transport on purpose. Do not "fix" it into exhaustiveness against the wrong union — a bank that could declare
`transport: fake` and load would put a task that never touches a VM into a graded session.

Three things to report: whether you agree the four should adopt the idiom the project already documents;
whether the `verdict.ts` case composes with P24; and whether you agree the two `readonly Union[]` lists need a
different fix rather than the same one. If you think this belongs in the single fix dispatch, say so — the
pattern, the comment justifying it, and a working predicate are all already in-repo, which makes it the
cheapest finding on this list to close.

Do not treat the `test/` casts as findings; test doubles asserting into shapes is expected, and the one real
concern there — `vi.mock`'s factory not being type-checked against the module it replaces — is already
recorded as a known limit.

## Gates — run them, do not cite any report

`npm run typecheck`, `npx vitest run`, `npm run build:web`, `npm run lint:content`. Expect **433 tests /
35 files / 0 skipped** — confirm the test count *and* the skip count, because a skipped test is not a
passing test. (I ran the suite at HEAD `4312359` and got exactly that, so a different number means either
the tree moved under you or one of us is wrong; say which you got either way.) Grep the **whole repo** for `enum`, `namespace`, decorators, parameter properties, non-null
`!` and `as` casts. **Do not take my count on trust — measure it, and tell me what you get**, because the
count I cited for most of this branch was wrong **three times**, most recently in an earlier draft of this
very file (see target 6, which lists all three wrong versions and why they were wrong). Also report how you
counted: two of my three errors came from a regex whose matches I never inspected — one was matching the word
"as" in comment prose. Confirm there is no `as unknown as` anywhere.
Confirm `git tag -l` is still **empty** — the `phase-1` tag is the user's to create, and its absence is
correct, not a gap.

No standalone cast finding is expected — target 6 explains why, and what the reading found instead. But that
conclusion is mine and my record on it is 0 for 3, so it is the one "settled" claim in this brief you should
re-derive rather than accept.

`git status --porcelain` must be empty before and after. **Do not mutate the working tree.** All mutation
work goes in a `/tmp` copy: `git archive <sha> | tar -x -C /tmp/<dir>` with `node_modules` symlinked
back, so the real `git status` stays clean. This is not a formality — a measurement was once taken against
a working tree another agent was editing, and it produced a confident wrong answer.

## Out of scope — do not report these

- **`shellcheck` is not installed.** Seven tasks have now confirmed it. Not a finding.
- **`npm run validate` and `npm run test:vm` cannot run** — no guest, ISO-blocked. `validate` has never
  run against a guest in this project's history. True, known, not a finding.
- **The absence of a `phase-1` tag** — the user's, by standing ruling.
- **Bundle size** (744 kB / 206 kB gzipped) — deliberate for a localhost single-user app.
- **The terminal dying on `/reset` and needing a reload** — the brief's own design ruling.
- **`report.regressions` ids going unrendered** — accepted.
- **The `-gp` argv exposure at `src/engine/vm/vmrun.ts:108`** — documented known limit.
- **The RHEL 9 vs RHEL 10 taxonomy decision** and `systemd.units.create`'s placement within it — an open
  product decision for the user, not a code defect.
- Everything in the parked file's own "Residuals that are documented on purpose" and "Not findings"
  sections. Read them so you do not spend a pass rediscovering them.
- **`package.json`'s scripts block having one entry the plan's verbatim block does not.** I checked it
  myself: the shipped block matches the plan's Task 25 JSON exactly except for `"lint:content": "node
  src/cli/index.ts lint"`, added by my own mandate and ruled in the ledger (`a rhcsa lint subcommand with
  vitest tests, not a script in scripts/`). One addition, correctly placed, everything else byte-identical.
  Not a finding. **The `lint` command's *behaviour* is very much in scope** — see targets 4 and 5.

## Prohibitions

No VM operations of any kind — no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies
10 GB), no snapshots, no start/stop/revert on any VM including the user's unrelated Ubuntu and Windows 11
ones. No `sudo`: it cannot authenticate here, there is no TTY. Do not run `ssh-keygen` or write anything
into `/home/daxtangco/.ssh/`. Do not create, read or modify `.env.local` — git-ignored, and it may already
hold the user's real VM password. Do not read anything under `/home/daxtangco/sechelp-tools`. Do not
apply the Windows Firewall fallbacks or edit the Virtual Network Editor; the scripts only *print* that
advice and that is deliberate. Do not dispatch subagents. Do not leave a dev server or any listening
process running — Hono's `app.request()` is a full round-trip through the router, so API tests need no
socket. Do not commit, merge, push or tag.

## Environment

The Bash tool runs **zsh**, not bash: unquoted `$var` does not word-split, `grep --include='*.ts'` needs
quoting, plain `grep -n "a\|b"` errors under ugrep (use `grep -nE`), and **a failed glob is an error
rather than an empty expansion**. `ls` is aliased to **eza** — use `/bin/ls`. **npm scripts run under
`/bin/sh` → dash**, which is the whole mechanism behind target 3's first bullet; reach for `dash`
deliberately when you test it. Beware nested heredocs: a bare `EOF` inside a fenced code block terminates
an outer heredoc early — this has bitten twice. Node **v22.23.2**, vitest **3.2.7**, TypeScript **5.8**.
`124` means timed out. Run `npm run build:web` with `run_in_background`.

Two jsdom notes so you do not mistake them for defects: jsdom prints a harmless
`HTMLCanvasElement's getContext()` "Not implemented" line on any file that mounts `TerminalPane`, and
`window.location.host` is `localhost:3000` under jsdom. One vitest note that has cost real time:
**vitest regex-scans source for `@vitest-environment`**, so merely *mentioning* the directive in a comment
activates it — even inside a sentence denying it. And `vi.mock('<path>', factory)` hoists above
module-scope calls, and **its factory is not type-checked against the module it replaces**; the project's
pattern for that is `const shapeCheck: ReturnType<typeof createApi> = fake`.

## The bar

Prefer sabotage to inspection. A finding you reasoned your way to is a hypothesis; a finding you produced
by breaking the code and watching the suite stay green is a fact. Label every conclusion.

Rank by whether a finding is **load-bearing** — meaning it can produce a wrong truth-claim to the student,
or a wrong green on the content bank, **on the project as it exists today**. A theoretical hole in code no
path reaches is worth a line, not a round. Twenty-five tasks' worth of review has already run; the way you
add value is not volume but reach: the four cross-task invariants in target 2 and the joint P24/P29 fix in
target 1 are where a defect could still be hiding that nobody has had the vantage point to see.

**One fix dispatch is budgeted after you.** So rank ruthlessly and say, for each finding, whether it
belongs in that dispatch or in a ruling that parks it with its cost stated. A list of forty
undifferentiated findings spends the one dispatch badly; a list that says "these six, in this order, and
here is why the rest can wait" spends it well.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/whole-branch-review.md`.

Return **only**: the verdict (**APPROVED** / **CHANGES REQUIRED**); one line of disposition per target
1-6; for target 1, whether the proposed joint P24/P29 fix is sufficient and whether a partial deflation of
the expected count is reachable; for target 2, one line per invariant (a)-(e) saying where its chain is
unguarded or that it is guarded end to end, and for (e) specifically whether `App.tsx:291` is in or out and
which fix option you rule for; for target 6, your own measured cast count **and how you
counted it**, whether the `verdict.ts` membership list composes with P24 into a false pass, and whether the two
`readonly Union[]` lists need a different fix from the four `readonly string[]` ones; whether the gates passed
with the observed test and skip counts; and a **ranked** finding list — severity, direction (false pass / false
fail / false green on the bank), a one-line failure scenario, load-bearing yes or no, and whether it belongs in
the single fix dispatch.

One last thing, and it is the most valuable line you can write. This brief is long, confident, and specific,
and **several of its confident specifics have already turned out wrong** — the cast count three times, P29's
locus once, P36's whole framing once. So: **name the claim in this brief you think is most likely to be wrong,
and say what you would measure to settle it.** A reviewer who finds nothing and names nothing has told me less
than one who finds nothing and names the weakest thing I said.
