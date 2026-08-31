# Task 25 controller mandates

Read `task-25-brief.md` first — it is your requirements. This file overrides it
where the two disagree, and adds work the brief does not name. Every item below
was measured against the tree at the current HEAD, not inferred from the plan.

Task 25 is the last task of Phase 1. Its deliverable is not code that makes a
test pass: it is an honest record of whether the exit criterion has been met.
That makes the integrity of what you write more important here than anywhere
else in the run. Three of the mandates below exist only to stop you writing
down something that has not happened.

---

## Mandate 1 — Do not create the `phase-1` tag. Step 9 is the user's, not yours.

Step 9 (`task-25-brief.md:499`) ends with:

```bash
git tag -a phase-1 -m "Phase 1: five tasks, ten cards, graded end to end with the reboot check"
```

**Do not run this command.** Do not create the tag under any other name or
message either.

The tag message asserts "graded end to end with the reboot check." That has not
happened and cannot happen on this machine right now: the RHEL 9 binary DVD ISO
is not downloaded, so the VM does not exist, so Steps 3, 4 and 8 cannot run.
An annotated tag is a durable, named claim about the state of the tree. Creating
one whose message asserts an unperformed verification is the exact defect this
whole project is built to detect — the tool reporting success for work it did
not do — committed by the tool itself, in the artifact that future readers will
trust most.

Instead: complete Steps 1, 2, 5, 6, 7 in full, commit them (Step 9's `git add`
and `git commit` at `task-25-brief.md:477` are fine and you should run them),
and end your report with a section headed **"Left for the user"** listing, in
order:

1. Download the RHEL 9 binary DVD ISO and run `scripts/provision.sh` (Task 19).
2. Step 3 — `npm run test:vm`.
3. Step 4 — both `npm run validate` runs.
4. Step 8 — the manual run, filling in `docs/exit-criterion.md`.
5. Step 9's `git tag -a phase-1 …`, **after** step 8 above, because only then is
   the message true.

Step 10's five acceptance conditions: you can satisfy conditions 1 and 5-minus-the-tag
locally. Conditions 2, 3 and 4 (`task-25-brief.md:508` and neighbours) are
VM-gated — report them as not-run, by name, with the reason. Do not mark Step 10
complete.

**Ruling:** the controller decided this rather than stopping the loop, because a
local annotated tag is deletable and therefore not the kind of irreversible
side effect that stops execution. Cost if wrong: the user creates one tag by
hand, having read a report that told them exactly which command to run and why
it was withheld.

---

## Mandate 2 — `docs/exit-criterion.md` ships with a NOT-RUN banner, and you invent nothing in it.

Step 6's template (`task-25-brief.md`, the `## The run` block) is a form with
blank fields: `- Date:`, `- Transport reported at startup:`, seven numbered
`yes / no` items, `Commands used:`, `Result: __ / 5`, `Rating:`, and the free
prose answer under "The question the whole project turns on."

**Write the template with every one of those fields left blank, exactly as the
brief shows them.** Do not put today's date in `Date:`. Do not answer any
`yes / no`. Do not write plausible commands into `Commands used:`. Do not write
`5 / 5` into `Result:`. Do not answer "Was there any moment in that run where
you wanted to open the book?" — you were not in the run, and there was no run.

An LLM filling in a form template with realistic-looking values is the single
most likely way this task produces a lie, and it is a lie that would survive
into the project's permanent record as evidence the exit criterion was met.

Add this banner immediately below the blockquoted criterion at the top of the
file, before the "Two halves." paragraph:

```markdown
> **Status: NOT YET RUN.** The manual half below is a blank form. Nothing in it
> has been filled in, because the VM does not exist yet — the RHEL 9 DVD ISO is
> not downloaded. Phase 1's exit criterion is therefore **not met** as of this
> commit. When you run it, fill the form in yourself; if you find it already
> filled in, something wrote answers it did not earn and you should distrust
> the file.
```

The last sentence is deliberate. It makes the file self-defending against the
failure mode this mandate prohibits.

One correction to the template's own prose while you are there. It says:

> It also asserts the rung-2 nudge does not contain `lvextend` and that the
> concept cards are longer than 1500 characters, which is the closest a test can
> get to "the card is what taught it".

After Mandate 6 that description is out of date, and it overclaims besides.
Replace the sentence with:

> It also checks that the rung-2 nudge names the objective and both card titles
> without naming a single command, and that rung 3 renders both cards in full.
> That is evidence the cards were *shown*, and it is the closest a test can get.
> Whether they *taught* is question 4 below, and only you can answer it.

---

## Mandate 3 — `echo "exit=$?"` after a pipeline reports `tail`'s status, not `npm`'s.

Step 4 (`task-25-brief.md:255-270`) tells the operator to run:

```bash
npm run validate -- \
  storage/014-grow-home-lv \
  … 2>&1 | tail -40
echo "exit=$?"
```

and then (line 272) to confirm `exit=0` **both times** as the acceptance signal.

`$?` after a pipeline is the exit status of the **last** command in it. That is
`tail -40`, which succeeds essentially unconditionally — it exits 0 after
printing whatever it was given, including the tail of a failure log. So
`exit=0` will print whether validate passed or failed every fixture. The
brief's own primary acceptance check for Step 4 cannot fail.

This is the recurring defect class of this project, in the brief that certifies
the project. Fix it.

Add `set -o pipefail` as the first line of the Step 4 code block, immediately
after `cd /home/daxtangco/rhcsa-trainer`:

```bash
cd /home/daxtangco/rhcsa-trainer
# Without this, `$?` below reports tail's status and always says 0.
set -o pipefail
```

`set -o pipefail` is POSIX-2024 and is supported by both `bash` and `zsh`, so it
holds whichever shell the user pastes into. Do not use `${PIPESTATUS[0]}`
instead: it is bash-only and indexes differently in zsh, and the user's shell
here is zsh.

Then audit the rest of the brief for the same shape before you transcribe it.
Any `… | tail -N` or `… | head -N` followed by a status check has the same bug.
Fix each one the same way, and say in your report how many you found.

---

## Mandate 4 — Step 4's fixture counts are wrong at four sites. Use 26 / 6 / 32.

Two separate defects here. The second one is mine, and it invalidates the first
one's arithmetic, so read the whole mandate before you change anything.

### 4a. The comment double-counts the tasks.

`task-25-brief.md:258`:

```bash
# the four SSH tasks plus the storage one: <N> fixtures, 45-60 minutes
```

The command beneath it (lines 259-263) lists exactly four tasks:
`storage/014-grow-home-lv`, `users/006-team-provisioning`,
`selinux/019-httpd-alt-port`, `systemd/017-boot-time-service`.
`storage/014-grow-home-lv` **is** one of those four — its `task.yaml` declares
`transport: ssh` — so "the four SSH tasks plus the storage one" describes five
tasks where the command runs four.

### 4b. Every fixture number in Step 4 is stale, including the one I first wrote here.

The brief's numbers, and my own first draft of this mandate, both assumed six
fixtures per task (2 solutions + 3 antisolutions + 1 `none` baseline). Task 22
shipped `selinux/019-httpd-alt-port` with **five** antisolutions, not three, so
that task has **eight** fixtures. Measured on the tree at commit `85bf671`:

| task | solutions | antisolutions | `none` | fixtures | transport |
|---|---|---|---|---|---|
| `selinux/019-httpd-alt-port` | 2 | 5 | 1 | **8** | ssh |
| `storage/014-grow-home-lv` | 2 | 3 | 1 | 6 | ssh |
| `systemd/017-boot-time-service` | 2 | 3 | 1 | 6 | ssh |
| `users/006-team-provisioning` | 3 | 2 | 1 | 6 | ssh |
| `troubleshooting/028-restore-remote-access` | 2 | 3 | 1 | 6 | vmrun |

So the SSH run is **26** fixtures, the vmrun run is **6**, and the project total
is **32**. Not 24, not 30.

**Re-measured at `ab32303` (after Tasks 23 and 24's briefs were written): the
table above is unchanged.** Tasks 23 and 24 add no content, so 8/6/6/6/6 still
holds, and 8+6+6+6 = 26 ssh plus 6 vmrun = 32. Reproduce the table yourself
anyway before you transcribe the numbers — count `solutions/*.sh` and
`antisolutions/*.sh` per task directory and add one for the `none` baseline. If
your count differs from mine, **your count wins** and you say so in your report.
Two of my counts in this project have already been wrong.

### The four sites to change — **already applied. Do not redo them.**

I applied all four to `task-25-brief.md` myself rather than making you find them,
and the line numbers below have shifted as a result. Step 4 now reads
**26 fixtures / `26/26 fixtures ok` / thirty-two / 6/6**, and Step 12's item 3
reads **26/26 then 6/6**. Verify by reading, not by editing.

Kept for the record, and because the *reason* still binds you: this mandate said
"reproduce the table yourself, and if your count differs from mine your count
wins." I did reproduce it, got **22 and 5**, and was **wrong** — I counted the
files under `solutions/` and `antisolutions/` and forgot the synthetic `no-action`
baseline every task gets at `src/engine/validate/harness.ts:67`. The
`fixture-inventory` gate is a second trap in the other direction: it enters the
results **only when it fails** (`harness.ts:308`), so a healthy bank contributes
none and adding one per task overshoots. The rule is `1 + solutions +
antisolutions` per task → 8/6/6/6/6 → 26 ssh + 6 vmrun = **32**. Both traps are
now written into the brief beside the numbers, so the next reader who recounts
from the file tree does not "correct" a correct figure.

1. ~~Line 253 — "thirty fixtures" → thirty-two.~~ Applied.
2. ~~Line 258 — the ssh-run comment → 26 fixtures.~~ Applied, as
   `# the four ssh tasks: 26 fixtures, 45-60 minutes`.
3. ~~Line 272 — `24/24` → `26/26`, "Thirty fixtures" → Thirty-two.~~ Applied.
   The `6/6` was correct and is unchanged.
4. ~~Line 508 — `24/24 then 6/6` → `26/26 then 6/6`.~~ Applied.

**One thing here was not on the list and is now fixed too:** Step 4's commands
used `npm run validate … 2>&1 | tail -40` followed by `echo "exit=$?"`, which
reports **`tail`'s** status, so a failing validate run printed `exit=0`. They now
redirect to a log, check the status, then tail. This is the same bug mandate 4's
line 145 warns about generally — it was live in the step whose whole purpose is
catching broken content.

Line 425's `# one task, 6 fixtures` for `storage/014-grow-home-lv` is correct.
Leave it.

Left alone, 4a sends an operator who counts the tasks looking for a fifth SSH
task that does not exist — or worse, adding
`troubleshooting/028-restore-remote-access` to the SSH run, where it fails for
want of `vmrun`. And 4b is worse than a miscount: `docs/exit-criterion.md` and
the Step 4 acceptance check both tell the operator to expect a specific total, so
a real, entirely successful `26/26` run reads as a failure against a brief that
promised 24. The operator's correct move at that point is to distrust the run.

---

## Mandate 5 — Eliminate all four `as Record<string, unknown>` casts in the e2e test.

Measured inventory in Step 2's test source, by brief line:

| Line | Cast |
|---|---|
| 132 | `return JSON.parse(text) as Record<string, unknown>` |
| 176 | `String((nudge.content as Record<string, unknown>).body)` |
| 183 | `String((cards.content as Record<string, unknown>).body)` |
| 213 | `const finalReport = done.report as Record<string, unknown>` |

Four sites, not five. The project's standing constraint is no `as` casts, with a
small parked set carried to the final review; do not add four more, least of all
in a file whose entire purpose is to detect things not being what they claim.

Every one of them is replaceable with a type predicate and two guards, at no
cost and with strictly better failure messages. Define these three helpers local
to the test file (do not import from `src/web/api.ts` — a web module has no
business being pulled into a VM test for a predicate):

```ts
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Narrows with a message that names what was being read, which a cast cannot. */
function obj(v: unknown, what: string): Record<string, unknown> {
  if (!isRecord(v)) throw new Error(`${what}: expected an object, got ${JSON.stringify(v)}`)
  return v
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new Error(`${what}: expected a string, got ${JSON.stringify(v)}`)
  return v
}
```

`isRecord` is a user-defined type guard, so `obj` returns the narrowed type with
zero casts. Then:

- line 132 → `const parsed: unknown = JSON.parse(text); return obj(parsed, \`${method} ${path} response\`)`
- line 176 → `const nudgeBody = str(obj(nudge.content, 'rung 2 content').body, 'rung 2 body')`
- line 183 → `const cardBody = str(obj(cards.content, 'rung 3 content').body, 'rung 3 body')`
- line 213 → `const finalReport = obj(done.report, 'final grade report')`

Note what this buys beyond constraint compliance. Under the cast, a rung-2
response whose `content` came back `undefined` yields `String(undefined)` —
the literal seven-character string `"undefined"` — and the test proceeds to
assert things about it. With `obj`, it throws at the point of the lie, naming
the field. That is the difference the whole grader contract is built on, applied
to the test that certifies the grader contract.

---

## Mandate 6 — The rung-2 and rung-3 assertions both pass on content that was never assembled.

This is the substantive defect in Step 2, and it is worth more than the rest of
this file combined, because the two assertions it concerns are the brief's only
evidence for the half of the exit criterion that says *"having learned the
concept from a concept card rather than a book."*

### 6a. `expect(nudgeBody).not.toMatch(/lvextend|xfs_growfs/)` passes on `''`.

A negative assertion is satisfied by the absence of everything, including the
absence of any content at all. If `rungContent` returned an empty body, if
`ctx.concepts` arrived empty, if `ctx.objectives` arrived empty, or if the hint
endpoint returned a rung-1 prompt when asked for rung 2 — every one of those
passes this assertion, and several of them are exactly what a wiring mistake
between Task 21's content and Task 23's loader would produce.

Measured, so you know what the correct content is. Task 23's `rungContent`
(`task-23-brief.md:284-295`) synthesizes rung 2 from objective texts and concept
card *titles* — there is no `nudge:` field in `task.yaml`, and none is needed;
do not add one. For `storage/014-grow-home-lv` the inputs are:

- objective `storage.lvm.resize`, text `"Extend existing logical volumes"`
  (`content/objectives.yaml:135-136`)
- card titles `Physical volumes, volume groups, logical volumes` and
  `XFS grows but never shrinks` (the `title:` frontmatter of the two files in
  `content/concepts/storage/`)

None of those strings contains `lvextend` or `xfs_growfs`, so the existing
negative assertion does hold on real content — it is true, just nearly
vacuous. Keep it, and put a floor under it:

```ts
// A not.toMatch is satisfied by an empty string. Prove the nudge was actually
// assembled from THIS task's objective and cards before trusting its absences.
expect(nudgeBody).toContain('Extend existing logical volumes')
expect(nudgeBody).toContain('Physical volumes, volume groups, logical volumes')
expect(nudgeBody).toContain('XFS grows but never shrinks')
expect(nudgeBody).not.toMatch(/lvextend|xfs_growfs/)
```

Now the negative assertion means something: the body demonstrably contains this
task's objective and both of its card titles, and *given that*, contains no
command name. That is the claim the exit-criterion doc makes on its behalf.

### 6b. `expect(cardBody.length).toBeGreaterThan(1500)` passes when only one card rendered.

Measured card body lengths, frontmatter excluded:

| Card | Body chars |
|---|---|
| `content/concepts/storage/lvm-abstraction-stack.md` | 1814 |
| `content/concepts/storage/why-xfs-cannot-shrink.md` | 1773 |

Either card **on its own** clears 1500 with three hundred characters to spare.
So the threshold does not test what the brief says it tests. `requires_concepts`
lists two cards; rung 3 joins them with `\n\n---\n\n`
(`task-23-brief.md:302`); a bug that dropped one — a `find` where a `filter`
belonged, a loader returning the first match — leaves this assertion green.

The existing `/physical volume/i` check does not close it either: that string
occurs in `lvm-abstraction-stack.md` only, so it pins the first card and says
nothing about the second.

Add a heading assertion per card and a separator assertion:

```ts
// 1814 + 1773 chars of body, so >1500 is cleared by EITHER card alone.
// Pin both headings: dropping one card must fail this test.
expect(cardBody).toContain('## Physical volumes, volume groups, logical volumes')
expect(cardBody).toContain('## XFS grows but never shrinks')
expect(cardBody).toContain('\n---\n')
expect(cardBody.length).toBeGreaterThan(3000)
```

Raise the threshold from 1500 to 3000 as shown: 3587 chars of combined body means
3000 passes today with real margin, while 1500 is below the level a single card
reaches and therefore cannot detect the failure it was written to detect.

`## ` prefixes are correct — `rungContent` case 3 emits `## ${c.title}` per card.

Keep the `/xfs_growfs/` assertion on rung 3 if the brief has one: measured, that
string appears twice in `lvm-abstraction-stack.md` and once in
`why-xfs-cannot-shrink.md`, so it holds.

---

## Mandate 7 — Warn about blank keys in `.env.local`; do not fix `config.ts` here.

Step 1's new script sources the whole file:

```json
"test:vm": "[ -f .env.local ] && { set -a; . ./.env.local; set +a; }; RHCSA_VM=1 vitest run .vm.test.ts",
```

Measured under `/bin/sh` → `dash`, which is what npm runs scripts with: this
shape works. Values containing spaces survive intact, comment and blank lines
are harmless, and a missing `.env.local` still reaches `vitest` (the `[ -f … ]`
test yields rc=1 but is not the last command, so the script's own status is
vitest's). Transcribe it as written.

The sharp edge is downstream. Unlike `provision.sh:52`, which filters
`=[[:space:]]*$` lines out before sourcing precisely so that blank assignments
never reach the environment, `set -a; . ./.env.local` **exports** them. And
`src/engine/vm/config.ts:35-55` defaults with `??`:

```ts
sshUser: env.RHCSA_SSH_USER ?? 'student',
sshKey: env.RHCSA_SSH_KEY ?? join(homedir(), '.ssh', 'rhcsa_lab'),
vmrun: env.RHCSA_VMRUN ?? DEFAULT_VMRUN,
```

`??` falls back on `undefined` and `null` only. An exported empty string is
neither, so `RHCSA_SSH_KEY=` in `.env.local` produces `sshKey: ''` and an
`ssh -i ''` that fails with an error naming nothing the user recognises — not
the documented default. Same for `RHCSA_VMRUN=`, which becomes a spawn of `""`.
Bash's `${VAR:-default}`, which `provision.sh` uses for the same keys, treats
empty as unset; `??` does not. The template `provision.sh` heredocs out ships
these keys as commented blanks (`#RHCSA_SSH_KEY=`) and invites the user to
uncomment and edit, so uncommenting without filling in is the expected accident,
not an exotic one.

Two things, and only these two:

1. In the README's environment-variable table (Step 7), add one line beneath it:

   > Leave a key out of `.env.local` rather than setting it blank. `npm run test:vm`
   > exports every line it finds, and an exported empty value overrides the default
   > shown above instead of falling back to it.

2. In your report, under a heading **"Forwarded to the final review"**, record:
   *`src/engine/vm/config.ts:35-55` should treat an empty-string env var as
   unset (a `val()` helper returning `undefined` for `''`, applied to
   `RHCSA_SSH_USER`, `RHCSA_SSH_KEY`, `RHCSA_VMRUN`), so `??` behaves like
   `provision.sh`'s `${VAR:-default}`. Reachable via `npm run test:vm`'s
   `set -a` sourcing, introduced in Task 25.*

**Do not edit `config.ts`.** It belongs to a closed task, it is outside Task 25's
file list, and the final whole-branch review is already sweeping that file for
its `as` cast at line 54 — one diff there beats two.

Two neighbours are **not** affected. Both `READ` at the cited lines in shipped
code, re-checked at `ab32303`:

- `ip: env.RHCSA_VM_IP` — `src/engine/vm/ssh.ts:131` is `if (!cfg.ip)` and `:176`
  is `if (!this.#cfg.ip) return false`. A falsy check catches `''` as well as
  `undefined`, so the empty-string hole does not reach here.
- `RHCSA_TRANSPORT=''` — `src/engine/vm/config.ts:40` is
  `if (forced !== undefined && !Object.hasOwn(KINDS, forced))`. An empty string is
  not `undefined` and is not a `KINDS` key, so it throws, and `:42`'s message
  names the variable and lists the accepted values.

I am not telling you these are closed to review — if you read either differently,
say so with the line you read. What I am telling you is narrower: **neither is a
reason to edit `config.ts` or `ssh.ts` in this task.** Both files belong to closed
tasks and both are already in the final review's sweep. A separate matter already
parked for that review, so you do not need to raise it: `KINDS` conflates "a valid
`TransportKind`" with "a valid `RHCSA_TRANSPORT` value", which is why
`src/engine/vm/select.ts:80` needs a comment explaining that `fake` is accepted.

---

## Mandate 8 — Checked, with the strength of each check named. Re-measure before you act on any row.

**Read this preamble before the table.** An earlier draft of this mandate said
"measured correct — do not change these, and do not let a reviewer reopen them."
Both halves of that were wrong and I am withdrawing them.

The second half was wrong on authority: you have none over the reviewer, and the
one time this project told a reviewer a row was already correct, the reviewer
skipped it and the row was a bug (Task 22's F1). A row nobody is allowed to
reopen is a row nobody checks.

The first half was wrong on fact. "Every row was checked against the tree" was
false when I wrote it: five rows cited line numbers in `task-23-brief.md`, which
is a *brief* — Task 23's code did not exist yet, so those rows were read against
a description of code rather than code. Task 23 has since shipped as `ab32303`,
so I have re-run every row against the real tree. **Four citations had drifted**
and are corrected below. That is the point: the rows were right, the pointers
were not, and a pointer is what you will actually follow.

Each row now names where the check lands and how strong it is:
`MEASURED` = a command was run in the session that wrote this line, and the
command is shown or trivially reproducible; `READ` = real shipped code was read
at the cited location. There is no `RECALLED` row left in this table.

If your reading disagrees with a row, **say so in your report with the command
you ran, and follow your own measurement.** Mine is a starting point, not a
ceiling. Do not silently edit a row's subject without saying you did.

| Brief claim | Status |
|---|---|
| `checkpointTotal === 5` and `passed === 5` | Correct — `MEASURED`. `content/tasks/storage/014-grow-home-lv/grade.sh` emits exactly 5 distinct ids: `fs-home-size`, `home-from-lv`, `lv-home-size`, `persist-config`, `var-intact`. Extracted with a `ck`/`ck_pass`/`ck_fail`/`ck_skip`-aware grep, `sort -u`, count 5. |
| Task 24's "3 / 5 passed" banner text | Correct — `MEASURED`, **line number corrected**. `# baseline-fail: lv-home-size, fs-home-size` is at **`grade.sh:10`**, not `:14`; it declares 2 goals, so 3 pass untouched. |
| `phase === 'graded'` | Correct — `READ`, **citation corrected to real code**. `export type SessionPhase = 'active' \| 'graded'` at **`src/server/session.ts:12`** (was cited as `task-23-brief.md:542`). Those are the only two. |
| `rating === 'hard'` | Correct — `READ`, **line number corrected**. `deriveRating`'s `if (i.rungUsed === 3) return 'hard'` is at **`src/engine/disclosure/ladder.ts:76`**, not `:66`. Note the line above it, `:75`, is `if (!i.passed) return 'hard'` — reached only when `passed` is false, which it is not here, so the `rungUsed === 3` branch is genuinely the one taken. |
| "five tasks, ten cards" | Correct — `MEASURED`, and no longer a prediction. Was "4 tasks + 8 cards in Task 22's brief"; Task 22 has shipped. The tree now holds **5** task directories under `content/tasks/*/*/` and **10** `.md` cards under `content/concepts/` (they live in per-area subdirectories, so a `content/concepts/*.md` glob finds none — use `find`). |
| 30 fixtures = 24 + 6 | **WRONG — this row was itself the defect.** `selinux/019-httpd-alt-port` has 5 antisolutions, so 8 fixtures. The real split is 26 + 6 = 32. See mandate 4b, whose table I have re-measured at `ab32303` and which is unchanged. |
| README env table lists `RHCSA_CONTENT`, `RHCSA_SNAPSHOT`, `RHCSA_PORT` as server-only | Correct — `MEASURED`, **citation corrected to real code**. A grep for all three across `src/` and `scripts/` returns only `src/server/index.ts` — `:28` `PORT`, `:29` `CONTENT`, `:30` `SNAPSHOT`, plus `:23` inside `readPort`'s validation. (Was cited as `task-23-brief.md:1658-1660`.) |
| `buildApp()` monkey-patching `controller.reboot` **after** `createLabRuntime` | Correct, and not a bug — `READ`, **citation corrected to real code**. `createLabRuntime` stores `reboot: () => opts.controller.reboot()` at **`src/server/lab.ts:31`** (was `task-23-brief.md:746`) — the property is read at call time, so patch order does not matter. Add a one-line comment saying so, because the next reader will have the same doubt. |
| `test:vm`'s `set -a` sourcing under dash | Correct — `MEASURED`. See Mandate 7. |
| `nudgeBody` not matching `/lvextend\|xfs_growfs/` | True on real content, but vacuous as written — see Mandate 6a. |
| `/physical volume/i` on rung 3 | True — `MEASURED`. `grep -ic 'physical volume' content/concepts/storage/lvm-abstraction-stack.md` → **3**. Note the card is under `storage/`, not at the top of `content/concepts/`. |

Also checked and **not** a defect, recorded here because it looks like one:
`content/tasks/storage/014-grow-home-lv/task.yaml` is **27 lines** with **0**
occurrences of `nudge` (`MEASURED`). That is correct — rung 2 is synthesized from
the objective text plus the card titles, per Mandate 6a. Do not add the field,
and do not "fix" the loader to look for it. If you conclude otherwise, argue it
in your report rather than editing quietly.

---

## Mandate 9 — Absorb the forwarded items. This is the last task; nothing forwards past it.

Nine items were parked by earlier tasks with Task 25 or the README named as their
destination. Each needs a home in a file you are writing. Where an item is a rule
for future authors it goes in the README's "Adding content" section; where it is
a statement about what this build does not do it goes in
`docs/exit-criterion.md`'s "Known limits at this point" list.

**Into the README's "Adding content" rules:**

1. `# unprobed-invariant: <id>` — a grader may declare a checkpoint it emits but
   knowingly does not probe, and such a checkpoint must be absent from
   `# baseline-fail:`. Live example to cite:
   `content/tasks/storage/014-grow-home-lv/grade.sh:82`,
   `# unprobed-invariant: var-intact` — **line 82, not 86; I re-measured it at
   `ab32303` and the earlier pointer had drifted.** Verify the line before you
   cite it in the README, because a README citing the wrong line is worse than
   one citing none. The union of probed and unprobed ids is
   not yet enforced against emitted ids outside `rhcsa validate` — say so.
2. **A task's first solution should be straight-line commands.** Rung 4's command
   sketch takes the sorted-first solution file, so `01-*.sh` is what the student
   sees rendered. `commandSketch` extracts leading words, and control-flow
   constructs (`for u in …`, `case` labels) surface as noise words. Keeping
   `01-` linear keeps the sketch clean; put the clever variant in `02-`.
   Cite `solutions/01-lvextend-then-growfs.sh` as the model.
3. **Quote any `.env.local` value containing a space** — and note that the
   general reminder at `scripts/provision.sh:34` sits directly above the
   `RHCSA_VMRUN` line, so a reader can mistake it for VMRUN-specific advice when
   it is a house rule that also covers `RHCSA_SSH_KEY` and `RHCSA_ISO`.
4. Mandate 7's blank-key warning.

**Into "Known limits at this point":**

5. The exam duration and passing score in `src/engine/exam/limits.ts` (150
   minutes, 210/300) are **UNCONFIRMED against Red Hat's published policy** and
   are marked as such in the source. Nothing gates on them yet.
6. The RHEL 9 versus RHEL 10 taxonomy decision is open. Both objective files
   ship (`content/objectives.yaml`, `content/objectives-rhel10.yaml`) and tasks
   carry `editions:`, but which edition drives bulk Phase 2 authoring is not
   decided. Say that the decision is open, not that it is made.
7. `scripts/r1-probe.sh`'s catch-all `*)` arm reports `unknown` for an exit
   status of 124, which project-wide means "timed out" — so a WSL2 → VMnet8
   probe that times out is indistinguishable from one that failed for an
   unclassified reason. R1 remains INCONCLUSIVE; the guest half was never run.
8. Task 24's Step 16 checks 4-6 and 9-13 (service masking, and the persistence
   message on the reboot verdict) were deferred and have no automated coverage.
   They are a second manual scenario, not part of the exit-criterion run above.
   Add them to `docs/exit-criterion.md` as a short **"Second manual scenario,
   not yet run"** section — blank, under the same NOT-RUN discipline as
   Mandate 2.
9. `docs/coverage-phase-1.md` is generated by `npm run coverage` (Step 5), which
   reads only the content bank and needs no VM — so **run it for real** and commit
   its true output. This is the one artifact in Task 25 that is genuinely
   verifiable here. Do not hand-write it, and do not fabricate a row.

If any of these nine cannot be placed because the file it belongs in does not
have a section for it, create the section. Do not drop the item, and do not
forward it — there is nowhere left to forward to.

---

## Mandate 10 (addendum, from the Task 21 review — F5 and F7)

Two items the Task 21 review forwarded with Task 25 named as the destination.
Both belong in `docs/r1-findings.md`, which Task 21's Step 12 table already
cross-references, and which Task 25 is the first task to be in a position to
write to.

**F5 — the `needs at least 2 solutions` troubleshooting row has no reader.**
Task 21 mandate 8 asked for a row explaining the failure a misspelled or missing
`solutions/` directory produces. It was written into `task-21-report.md` only —
a workspace artifact that nobody diagnosing a real failure will open, and that
Tasks 22-24 never read. Move it into `docs/r1-findings.md` as part of a
short **"Validate failures and what they mean"** section. Take the row's text
from `task-21-report.md`; do not reinvent it.

**F7 — the emitted-checkpoint-ids grep matches comment prose.** Task 21 Step 11
extracts the ids a grader emits with:

```
grep -oE 'ck_(pass|fail|skip) [a-z0-9-]+'
```

which matches a comment as readily as a call. Task 21's implementer had to reword
two `grade.sh` comments to avoid a collision. This is harmless for the
declared-but-never-emitted direction the check actually uses (`comm -13` —
spurious extra tokens only inflate the emitted set), but it means the project now
silently forbids writing `ck_pass <word>` in a grader comment, and nothing states
that anywhere.

State it, in the README's "Adding content" rules alongside Mandate 9's items:

> Do not write `ck_pass`, `ck_fail` or `ck_skip` followed by a word in a grader
> comment. The id-extraction check in `docs/r1-findings.md` matches comment text
> as readily as code, so prose that looks like a call inflates the emitted set.

And record in `docs/r1-findings.md` that the grep must learn to skip comment
lines before anything derives a *total* from it — for a count, unlike for a
set-difference, a wrong number is worse than no number.

Neither item needs a VM.

---

## Mandate 11 — Commit the checkpoint-header checker. It is a `rhcsa lint` subcommand with tests, not a script.

This mandate is new and it adds a code deliverable to what is otherwise a docs
task. It exists because of a finding from Task 22's verification, and it is the
one item in this task I would not drop under time pressure.

### Why

Five separate throwaway extractors in this project have over- or under-counted
checkpoint ids, and **every one matched a word where it should have matched a
call.** Three were the Task 22 implementer's, two were mine. All five failed
loudly, which is why they were caught — but the verifier's closing caveat was
about method, not luck: each was written inline, run once, and thrown away, so
the sixth reviewer writes a sixth regex and the odds reset. Task 22's verifier
and I agreed the fix is **one correct extractor, committed and tested.**

**A runtime check already exists and is not the gap.** `checkEmittedIds`
(`src/engine/validate/harness.ts:105-117`, called at `:242` and `:252`) compares
declared ids against emitted ids — but only inside `npm run validate`, **which
needs a VM**. Every check the reviewers kept rebuilding was the *static*,
VM-free one over script text. On a machine with no ISO — which is this machine,
and will be anyone's machine on a fresh checkout — the runtime check cannot run
at all, so the static one is the only gate that exists. Build that.

### Shape: a subcommand, because it must be tested

`src/cli/index.ts` already has the seam. `run(argv, io)` dispatches on
`argv[0]` (`:219-231`), `CliIo` is `{ out, err }` (`:12-15`), the module is inert
on import thanks to the `import.meta.url === pathToFileURL(...)` guard
(`:236-237`), and `test/cli/coverage.test.ts` already drives a subcommand with a
fake `io` and asserts the exit code. Follow that file's structure.

Add a third case, `lint`, and give it a `USAGE` line (`:17-26`) in the same
style:

```
  lint                  static checks on grader headers and checkpoint ids (no VM)
```

Add to Step 1's `scripts` block — **this changes Step 1, so make the edit there,
not in a second place:**

```json
    "lint:content": "node src/cli/index.ts lint",
```

No `--env-file-if-exists` on it, for the reason Step 1 already gives for
`coverage`: it reads the content bank and nothing else, and giving it VM config
would imply it needs a VM. Add it to the README's command table (Step 7) beside
`npm run coverage`, described as the check that runs without a hypervisor.

### What it checks — three things, and nothing else

1. **Declared but never emitted**, both header kinds. For every `grade.sh`,
   the ids in `# baseline-fail:` must all appear as emitted ids; for every
   `antisolutions/*.sh`, the same for `# expect-fail:`. Reuse
   `parseExpectations` (`src/engine/validate/expectations.ts:32`) — it already
   takes script text plus a header name, already defaults sensibly, and already
   reports a **duplicated** header as a problem, which a hand-rolled regex in a
   review would not.
2. **Emitted but undeclared is NOT an error** — do not add that check. A grader
   legitimately emits invariant checkpoints that must pass at baseline and are
   therefore absent from `# baseline-fail:` by design, and
   `# unprobed-invariant:` (mandate 9 item 1) is the declaration for the
   knowingly-unprobed ones. Report undeclared-and-not-unprobed ids as
   **informational output**, not a failure. Getting this backwards would fail
   every task in the bank.
3. **Header inventory, as a golden file.** A drift check needs two commits and a
   committed script has only one, so the drift check becomes: print a
   deterministic inventory — every `.sh` under `content/` carrying a header, with
   its header kind and its ids, sorted — and lock it against a committed fixture.

### The golden half: copy the precedent exactly

`test/content/objectives-golden.test.ts` is the model and it is already right.
Copy its three properties, not just its idea:

- A committed fixture under `test/fixtures/` (name it
  `content-headers.golden.json`), locking the full structure.
- A **`TO REGENERATE`** comment block in the test giving the exact command, so
  the next author regenerates instead of hand-patching.
- The rule stated in the test's own comment: **always regenerate, never
  hand-edit a fixture** — hand-transcribing reintroduces the copying risk the
  fixture exists to close.

Say in that comment what the fixture buys, in the objectives test's voice: any
future edit to a `# baseline-fail:`, `# expect-fail:` or `# unprobed-invariant:`
header must arrive with a fixture diff a reviewer can read line by line. That is
the check three reviewers rebuilt by hand, made permanent.

### Reuse the extractor. Do not write a sixth regex.

The emitted-id extractor already exists and is **already exported**:
`countCheckpoints` in `src/server/session.ts`, built on the `CK_CALL`,
`HEREDOC_START` and `CK_BEFORE_QUOTE` patterns and a single-pass `scanLine` walk.
Import it. `content/lib/assert.sh` yields **zero** ids under it, so prepending
assertLib is harmless — `storage/014` counts 5 and `selinux/019` counts 8 either
way, and those six invariants have been re-measured at every commit of Task 23.

If exporting from `src/server/` into a CLI command reads wrong to you — a server
module is an odd home for a content-parsing scanner — moving it to
`src/engine/content/` and re-exporting is an improvement, and you may make it.
Say which you chose and why. **Do not write a sixth regex, and do not fork the
scanner**: `src/engine/disclosure/content.ts` already has a deliberate twin for
hint sketches, and the difference between them (a quoted id must survive in the
counter and must not survive in the sketcher) is documented in both. A third copy
would be the one nobody maintains.

### The hole this mandate used to describe is CLOSED — do not reintroduce it

**This section said the opposite until now, and acting on the old text would have
shipped a linter that fails every conforming grader.** It described `CK_CALL` as
anchored to line start, so that `true; ck after-semi "d" $?` and
`grep -q x file | ck piped "d" $?` yielded no ids — and then instructed you to
have `lint` **report the non-line-start form as a problem**.

That form is now **counted correctly**, and it is the form
`content/lib/assert.sh:60` documents as *the* usage:

```
# Usage:  some_condition; ck my-id "what was checked" $? "what to look at"
```

**Ruling: `lint` must not flag the separator form. — Because Task 23's fix round 1
closed it (`test -f /etc/fstab; ck gamma` → 1, `true && ck delta` → 1, `… | ck x`
→ 1, all measured, with the six invariants unmoved), so flagging it would fail
every grader that follows the library's own documented idiom, and the whole point
of the lint is to be trustworthy enough that a failure means something. — Cost if
wrong: a shape goes uncounted that the lint could have caught, which the
`incomplete` guard and the over-arrival warning in `reportFor` both still backstop
at runtime.**

The paragraph you are replacing also told you "do not widen the regex yourself,
that trade is the Task 23 reviewer's call." That call has been made, several times
over: the counter has been through **four** fix rounds and five fail-open or
fail-closed defects, and it now also handles heredoc bodies, quoted runs, escaped
quotes, comments after separators, arithmetic `<<`, and a `ck` after `then`/`do`/
`else`/`{`/`(`/`)`. Read the docstrings in `session.ts` for the current truth —
they are maintained deliberately and two fix rounds were spent making them
accurate — and treat any statement about that function in *this* document as
history.

**How to verify what it does, rather than reasoning about the regex.** Round 4
added a differential test helper that runs a snippet through real `bash` with
`content/lib/assert.sh` prepended and compares the ids bash actually emits against
`countCheckpoints`. `ck` is pure bash string manipulation plus `echo`, so this
needs no VM and no root. Reuse that helper for any shape you are unsure about. It
exists because three rounds of deriving expectations by reading the pattern is
exactly how five defects got through; do not go back to that method.

### Gates for this mandate

`lint` must run to completion **with no VM and no `.env.local`**, exit 0 on the
current bank, and exit non-zero when you plant a bad header in a `/tmp` copy of
`content/`. Prove both in your report with real output, and prove the second by
planting each of these three, one at a time:

1. an id in `# baseline-fail:` that the grader never emits;
2. a duplicated header line;
3. **a `ck` whose id is a variable** — `ck "$id" "d" $?` or `ck ${name}` — which
   `countCheckpoints` cannot see by design, since `session.ts` records that "Task
   22's authoring rule is what makes it possible: every id is a literal, never a
   variable." A variable id is invisible to the counter and therefore fail-open,
   which is exactly what a static lint is for.

**Item 3 replaced an earlier one that is no longer a defect:** it used to be "a
`ck` call written in the non-line-start form," which Task 23 fixed and
`assert.sh:60` documents as the usage. Planting it now would prove the linter
*wrong*, not working. See the ruling in the section above.

A fourth plant is worth adding if it is cheap: an id that breaks the lowercase-kebab
authoring convention (`ck LV_Size`). `session.ts` deliberately accepts `_` and
uppercase in its id class and says why — a counter that cannot see an id fails
open, so it is the wide half — and it names this lint as the loud half that should
reject them. If you add it, say so; if you judge it out of scope for this task,
say that instead.

A checker nobody has seen fail is a checker nobody has tested.

`test/cli/lint.test.ts` gets fixtures for each of the three, driven through
`run(['lint', '--content', <tmpdir>], fakeIo)` the way `coverage.test.ts` does.
Do not test it by shelling out.

---

## Mandate 12 — Step 4 tells the user to type the guest password into their shell history. Use the form this project already documents.

`task-25-brief.md:267`, inside Step 4's second validate run:

```bash
export RHCSA_GUEST_PASSWORD='<the student account password>'
```

A user follows that literally: they replace the placeholder with the real password and
press return. It is now in `~/.zsh_history` in plaintext, on the interactive shell this
project's own environment notes identify as zsh, and it stays there long after the lab is
over. Nothing later in the brief tells them to remove it.

**This project already has the right spelling and Step 4 is not using it.**
`docs/vm-build-checklist.md:245`:

```bash
read -rsp 'student password: ' RHCSA_GUEST_PASSWORD && export RHCSA_GUEST_PASSWORD
```

`read -rs` does not echo the typing and does not put the value in history — only the
`read` command itself lands there. `provision.sh:45`'s comment confirms the single-run
export is a deliberately supported path, so the *approach* is right; only the spelling in
Step 4 is wrong.

Replace `task-25-brief.md:267` with the `read -rsp` line, and add one sentence beneath the
code block:

> The `read -rsp` form keeps the password out of your shell history. Do not paste the
> password into the command line, and do not add it to `.env.local` unless you want it on
> disk — `scripts/provision.sh` writes that key blank on purpose.

Then check the rest of what you write for the same shape. **Any place you instruct the user
to type a secret as a command argument is this defect**, including anything you add to the
README in Step 7 or to `docs/exit-criterion.md` in Step 6.

**Do not change how the code reads the variable.** `src/engine/vm/config.ts:53` takes
`env.RHCSA_GUEST_PASSWORD` and that is correct.

**And do not try to fix the `-gp` argv exposure.** `src/engine/vm/vmrun.ts:108` is
`['-gu', cfg.sshUser, '-gp', cfg.guestPassword ?? '']`, so during a `vmrun` validate run
the password is visible in `ps` output to any local user. `scripts/provision.sh:64` already
carries a comment acknowledging exactly this. It is pre-existing, it belongs to a closed
task, `vmrun` offers no file-based alternative for guest auth, and the threat model here is
a single-user laptop. **Record it as a ninth bullet in `docs/exit-criterion.md`'s "Known
limits at this point"** — one line, saying the guest password appears in the process list
during a vmrun validate run and that this is a local-only, single-user tool. Do not edit
`vmrun.ts`.

You are not inventing that section. `task-25-brief.md:344` already specifies it with eight
bullets, and `MEASURED`: none of the eight mentions the password. Add a ninth, and do not
rewrite the other eight. Its natural neighbour is the existing bullet about `028` being
graded through `rhcsa validate` rather than the Lab screen — that is the same `vmrun` path
this limit applies to.

The distinction matters and is the whole point of this mandate: history is **durable** and
survives the run by months, while argv is **transient** and visible only while the command
executes. One is worth a brief edit, the other is worth a documented limit.

### Mandate 11, addendum — the lint owns the strict half of the checkpoint-id grammar

Task 23's fix rounds established a deliberate asymmetry you must not "fix":
`countCheckpoints` in `src/server/session.ts` is **permissive** about checkpoint ids
(`[A-Za-z0-9_][A-Za-z0-9_-]*`), while the project's authoring convention is **lowercase
kebab**. That is not an inconsistency. A counter that misses an id fails **open** — it
under-declares `expectedTotal`, a truncated grader run reads as complete, and the student is
told they passed a checkpoint that never ran. A validator that rejects an id fails **closed**
— a loud authoring error at lint time. So the counter is wide on purpose and enforcement
lives here.

Add a fourth check to `rhcsa lint`: **every `ck` id must match `^[a-z0-9][a-z0-9-]*$`**, and a
violation is an **error**, not informational. That is the opposite disposition from the
emitted-but-undeclared check, which stays informational — and the reason for the difference is
worth writing into the code: an undeclared id is often a legitimate authoring choice mid-edit,
whereas a non-conforming id is always a mistake, and it is a mistake that silently degrades
the truncation guard rather than announcing itself.

Test it with the collision that motivated the rule: a grader containing both `ck my` and
`ck my_id` must lint as an **error** on `my_id` while `countCheckpoints` returns **2** for the
same input. Those two assertions together are the whole point — permissive counting, strict
authoring — and a test that checks only one of them documents half a design.

`MEASURED` as of Task 23's fix round: zero ids in the shipped bank contain `_` or an uppercase
letter, so this check passes on all five graders today and costs you nothing to add. Do not
use that as a reason to skip it — a check that is green on arrival is exactly the check that
stays green.
