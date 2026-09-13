# Attempt recording and the stale-state guard

Phase 2, first bullet: *SQLite schema, attempt recording, stale-state guard.*
Design reference: §5.5 (stale-state guard), §9.2 (scheduling and derived
ratings), §12 (data model), §15 (technology).

Files: `src/engine/store/schema.ts`, `src/engine/store/attempts.ts`,
`src/engine/store/vm-state.ts`.
Tests: `test/store/attempts.test.ts`, `test/store/schema.test.ts`,
`test/store/vm-state.test.ts`, `test/store/attempt-recording.test.ts`,
`test/server/stale-state.test.ts`.

## Storage decision: `node:sqlite`

§15 names **`better-sqlite3`**. That is a third-party native module, and this
project has a standing constraint of no new dependency and no build step. So the
choice was between Node's own `node:sqlite` and an append-only JSONL log. The
deciding worry was that `node:sqlite` is experimental on Node 22 and might need
a runtime flag — which would mean editing every `node src/…ts` script in
`package.json`, a real cost. That was tested rather than assumed.

### What was tested, on Node v22.23.2

| Command | Result |
|---|---|
| `node -e "require('node:sqlite')"` | exit 0; `ExperimentalWarning: SQLite is an experimental feature` on stderr |
| `node --input-type=module -e "import('node:sqlite')…"` | exports `DatabaseSync`, `StatementSync`, `backup`, `constants` |
| `node --experimental-sqlite -e …` | identical — the flag is accepted and does nothing |
| `DatabaseSync` on a real file: create table, insert, select | works |
| Same, under `vitest run` | works, in-memory and on disk |
| `node src/engine/store/attempts.ts` (type-stripping, no flags) | works |
| `ls node_modules/@types/node/sqlite.d.ts` | present (`@types/node` 22.20.1) — typed with no new dependency |
| `select sqlite_version()` | 3.51.3, so `STRICT`, `WITHOUT ROWID` and generated columns are all available |

**The flag cost does not exist.** `node:sqlite` was unflagged in Node 22.13; this
repo's `engines` field already requires `>=22.18.0`, so every Node this project
supports has it. Nothing in `package.json` changed.

### Why SQLite won over JSONL

- **§12 is a relational schema, and most of it is not a log.** `objective_state`
  (FSRS parameters, `due_at`), `concept_state` and `vm_state` are one mutable row
  per key. An append-only log models those as "replay everything and keep the
  last", which is a projection to hand-maintain and to keep consistent with the
  log on every read.
- **Phase 3's reads are queries.** The FSRS scheduler asks for objectives due
  before *T*; §9.4's readiness report asks for per-objective pass rate, mean time
  against budget and persistence-failure rate. On JSONL each is a full scan plus
  in-memory grouping — re-implementing a query engine, one aggregate at a time.
- **The guard can live in the schema.** This is the argument that actually
  settled it, and it is spelled out below: `CHECK` constraints, a generated
  column and a view make "drifted data cannot be read as clean" a property of
  the file rather than a rule every future caller has to remember. A JSONL writer
  can write any line it likes.
- **Atomicity for free.** An attempt and its objective rows go in one
  transaction, so no reader can see an attempt whose objectives are half there.

### What it costs, stated plainly

- One `ExperimentalWarning` on stderr per process. It is cosmetic and already
  appears in `npm test` output.
- The API is experimental. Mitigation is that the surface used is tiny —
  `DatabaseSync`, `prepare`, `run`, `get`, `all`, `exec`, `close` — and is
  unchanged in the stable Node 24 version. Everything touching it is behind
  `AttemptStore`.
- No migration tooling. `PRAGMA user_version` is stamped at **2**, and a file
  written by a newer build is **refused** rather than read with the wrong column
  meanings. There is still nothing to migrate: every statement in `DDL` is
  `CREATE … IF NOT EXISTS`, and version 2's only change is *adding* §12's five
  remaining tables, so opening a version 1 file creates them and leaves
  `attempts` untouched. `test/store/schema.test.ts` measures that by taking a
  database back to 1, dropping the five and reopening it. The next change that is
  not additive — a renamed or retyped column, a `CHECK` widened over existing
  rows — is where this stops being enough.

## The schema

`attempts` (STRICT) holds, per attempt: `task_id`, `mode`, `started_at`,
`finished_at`, `recorded_at`, `rung_used`, `verdict_a`, `verdict_b`,
`verdict_final` (JSON, per §12), the checkpoint counts, `regression_count`,
`rebooted` / `reboot_error`, the three drift flags, `rating`, and a nullable
`predicted_outcome` for §10.2's calibration click. `duration_s` and `clean` are
generated columns.

`attempt_objectives` is one row per (attempt, objective), because §9.2 schedules
**objectives, not tasks** — that is the unit FSRS will read, and it should not
have to re-split a JSON array on every pass.

Every `CHECK` enum list (`mode`, `rating`, `predicted_outcome`) and the
`rung_used` range are generated from the TypeScript unions in `schema.ts`. A
hand-written `IN (…)` list is a copy of a union that no compiler compares against
it, and the failure mode is losing a student's attempt to
`CHECK constraint failed` the moment a fifth mode is added.

No `user_id`, and no foreign key into content: `task_id` and `objective_id` are
text, so the bank can be renumbered or regenerated without a migration (§12).

### §12's other five tables

| Table | Grain | Columns |
|---|---|---|
| `objective_state` | one mutable row per objective | `objective_id` PK, `state`, `stability`, `difficulty`, `reps`, `lapses`, `last_reviewed_at`, `due_at` |
| `concept_state` | one mutable row per concept met | `concept_id` PK, `first_shown_at`, `times_needed`, `last_needed_at`, `demonstrated_cold` |
| `triage_sessions` | append-only, one per §10.1 drill | `id`, `started_at`, `finished_at`, `task_ids`, `user_order`, `user_estimates`, `scores` |
| `exam_sessions` | one per sitting, written at the start | `id`, `source`, `role`, `started_at`, `finished_at`, `composition`, `report` |
| `vm_state` | exactly one row, `CHECK (id = 1)` | `current_task`, `current_snapshot`, `applied_at` |

**Only `vm_state` has a writer in this build.** The other four land now because
the schema is one artifact: one version bump, and one place applying the
generated-`CHECK` rule, rather than four later bumps that each have to re-derive
it. Nothing reads or writes them yet and no test pretends otherwise — what is
tested is that every constraint rejects the row it exists to reject.

This is a claim about *these five* tables, not about the schema. `attempts` and
`attempt_objectives` have had writers since this document was written, and
`attempts.predicted_outcome` acquired one afterwards — see the amended bullet
under "What this does not do".

**No indexes on any of the five**, which is a cardinality argument. `attempts`
is the only table here that grows without bound, which is why it is the only one
with indexes: `objective_state` is one row per published objective, which is **68**
today (`rhcsa coverage`, not §9.4 — §9.4's "14/22" is an illustrative sentence
about a readiness report, and reading it as the taxonomy size understates this
table threefold); `concept_state` one per concept met, 40 cards existing;
`exam_sessions` one per sitting of eight exams; `triage_sessions` one per
90-second drill. Scanning a table that size beats walking an index over it,
and an index that is never the cheaper plan is decoration every write pays for.

`role` and `state` are generated `CHECK` lists like `mode` and `rating` — from
`ExamRole` and `FsrsCardState`. `exam_sessions.source` (`r9-A`) is deliberately
free text: it is a content id, and content ids stay renumberable.

#### "FSRS params" is spelled as named columns, not a JSON blob

§12 says *FSRS params* and leaves the representation open. This build uses seven
named columns — `state`, `stability`, `difficulty`, `reps`, `lapses`,
`last_reviewed_at`, `due_at` — for three reasons:

- `due_at` is a **query predicate** (every objective due before *T*), and a JSON
  field cannot be compared without extracting it on every row.
- `STRICT` types each column, so a scheduler that writes text where a number goes
  fails at the write rather than at a read weeks later.
- The cross-column invariants can only be written about columns:
  `lapses <= reps`, `(last_reviewed_at IS NULL) = (reps = 0)`, and
  `(state = 'new') = (reps = 0)` — where the literal is interpolated from
  `NEW_CARD_STATE`, so renaming the union member reaches the constraint.

`stability` and `difficulty` are nullable, and null means *FSRS has not assigned
one yet* rather than zero: a stability of 0 days and a difficulty of 0 both read
as real values. The bounds (`stability > 0`, `difficulty BETWEEN 1 AND 10`) are
the scales FSRS documents.

**This field list is unverified in the way that matters.** There is no FSRS
implementation in this build to check it against — the scheduler is Phase 3 — so
the four `FsrsCardState` names and the two bounds come from FSRS's published
design and nothing here has run them. That is an accepted cost: this table is
derived state that can be rebuilt from `clean_attempts`, so being slightly wrong
costs one version bump and a recomputation. FSRS's **global weight vector** is
deliberately absent: those are one set per user, not one per objective, and §12
lists no table for them.

## The stale-state guard

§5.5 states the guard as a refusal at grade time. The guard has **two halves**,
refusing at opposite ends of a grading run.

### Before the grader runs

`vm_state` records which task's `setup.sh` is currently applied to the guest.
`VmStateStore.staleFor(taskId)` compares that against the task about to be
graded, and `POST /api/sessions/:id/grade` turns a mismatch into a refusal
**before any script is loaded and before `grade.sh` executes at all**. This is
§5.5 read literally, and it is the half that stops a student receiving pages of
inexplicable failures on correct work — the grader's output is itself the harm,
so reporting staleness alongside it would be too late.

The store's API is four calls, plus `close`:

- `applied(taskId, snapshot)` — this task's setup is live, on top of this
  snapshot, at `now()`.
- `unknown()` — the guest is neither the previous task's machine nor the next
  one's. Written **before** the revert, not after a failure, so that a thrown
  transport error and a process that dies mid-revert both leave an honest row
  instead of the previous task's id.
- `current()` — the row, or `undefined` if nothing was ever recorded.
- `staleFor(taskId)` — `undefined` to permit, or a `StaleState` to refuse.

`staleFor` refuses on **positive evidence only**, and the asymmetry is
deliberate: withholding a rating costs one data point, while refusing a grade
costs the student the run they just did. So a mismatched task refuses, an
explicit unknown row refuses (a half-applied setup is exactly the machine §5.5
exists to keep out of the grader), and a **missing** row *permits* — that is
absence of evidence rather than evidence of drift, and a failed bookkeeping write
must not cost a student their attempt. In the served path the row cannot be
missing anyway: `POST /api/sessions` writes it before it touches the guest.

The snapshot is recorded and **not compared**. §5.5's refusal is about task
identity, and §4.3's snapshot ladder is not built, so comparing snapshots would
be a guess about a design that does not exist.

### After it has run

That first half cannot be the whole guard, because the ways a grading run turns
out to have been measured against a drifted guest are only visible *after* the
grader has run:

1. **suspect** — `reportSuspect` in `server/session.ts` was true;
2. **incomplete** — fewer distinct checkpoint ids arrived than the grade script
   declares;
3. **count disputed** — the grader's own headers name ids its checkpoint count
   never saw, so `expectedTotal` is deflated and `incomplete` is structurally
   blind;
4. **count mismatch** — the ids that arrived disagree with the count the task
   declares, in either direction.

All four are recorded. `clean` is a **generated column** over them, so no writer
can assert it. Three layers then keep drifted attempts out of the scheduler:

- `CHECK (rating IS NULL OR …clean conditions…)` — a rating is the only field a
  scheduler eats, so the database refuses the row outright rather than trusting
  that `app.ts` withheld it.
- the `clean_attempts` view, which every scheduler-shaped read goes through;
- `AttemptStore.cleanAttemptsForObjective` has **no drifted variant**. A guard is
  worth nothing if the convenient call is the unguarded one.

Drifted attempts are still stored, and `forTask` still returns them: the student
did the work and is entitled to see it, marked. What they cannot do is count as
evidence.

**A failed reboot is deliberately not drift.** The guest not coming back is a
result about the student's work (§5.4 rule 5), and `finalVerdict` already
downgrades every pass it produced. Discarding those would throw away the most
instructive attempts in the system. `reboot_error` is recorded so a later reader
can still tell the two apart.

`attemptDrift` restates `reportSuspect`'s rule rather than importing it, because
the engine is the lower layer and must not depend on `server/`. The duplication
is pinned by a test that compares the two across the whole input matrix.

## Wiring

`AppDeps.attempts` and `AppDeps.vmState` are the two optional deps, and `POST
/api/sessions/:id/finish` is the single recording point. `/finish` is already the
one terminal transition (a second call is 409), so recording there cannot
double-write, and it is the first line at which both the report and the rating
exist. `/grade` deliberately does not record: a student may grade as often as
they like and each of those is the same attempt.

A failed write is logged and swallowed. `/finish` must never withhold the exit —
the attempt is already over and the student is owed their report — so a lost row
does not become a 500 over work that is already done.

`src/server/index.ts` opens the database at `RHCSA_DB`, default
`.rhcsa/history.db`, and hands the **same handle** to `AttemptStore` and
`VmStateStore` — two handles on one WAL file would be two writers for no reason.
`.gitignore` already covers `*.db`.

### The guest side

Both routes that touch the guest — `POST /api/sessions` and `POST
/api/sessions/:id/reset` — go through one `applySetup(task, scripts)` helper,
because the **order** of its three steps *is* the guard and a second copy is a
second chance to get it wrong:

1. `vmState.unknown()`;
2. `runtime.reset()` (revert first: running setup before the revert means the
    revert throws the setup away);
3. `runtime.exec(scripts.setup)`, and only on exit 0, `vmState.applied(task.id,
    runtime.snapshot)`.

`LabRuntime` gained a `readonly snapshot: string` for step 3, so the name
recorded is the one the runtime actually reverts to rather than a string the
caller guessed.

`vmState` is optional for the same reason `attempts` is — every test of an
unrelated route, and `test/vm/e2e-exit-criterion.vm.test.ts`, builds this deps
object — and that is a real cost worth naming: **a guard that can be left unwired
is a guard that can be forgotten.** What made it the lesser cost is that the
alternative was a required dep on a database. It is pinned instead by
`test/server/stale-state.test.ts`, which drives the guard through the routes
rather than trusting the type, including the case where no store is wired.

### What the student sees

A refused grade is **409** — the request is well formed and it is the *guest*
that has nothing to give — and never 400, because the student did nothing wrong.
The body carries the sentence and the offer together:

```json
{
  "error": "selinux/019-httpd-alt-port's setup.sh is live on the guest, so grading storage/014-grow-home-lv would measure your work against the wrong machine. Reset this session to revert the guest and reapply storage/014-grow-home-lv's setup.",
  "staleState": {
    "requestedTask": "storage/014-grow-home-lv",
    "liveTask": "selinux/019-httpd-alt-port",
    "currentSnapshot": "clean",
    "appliedAt": 1700000000000,
    "reset": "/api/sessions/<id>/reset"
  }
}
```

Both task ids are in the sentence, because "the guest is stale" with no names
sends the student looking for a mistake in their own work — which is the
confidence loss §5.5 exists to prevent. When the guest's state is unknown,
`liveTask` is `null` and the sentence says *nothing is known about the guest — the
last revert or setup.sh did not finish*; the task that **was** live is not named,
because after a half-completed revert it is no longer a fact. `staleState` is the
same information structured so a client can render Reset as a button instead of
parsing prose, and `reset` is a route that already exists, already reverts and
already reapplies *this* session's setup — so the offer is not a promise about
work nobody has written.

The session **phase** check still runs first: grading an already-finished session
is 409 for that reason instead, because telling a student to reset a session that
is over would be advice they cannot act on.

## Left for later, deliberately

- **Four tables with no writer.** `objective_state`, `concept_state`,
  `triage_sessions` and `exam_sessions` exist, are constrained and are tested
  from both sides, but nothing reads or writes them: they belong to the bullets
  that do (Phase 3's scheduler, §10.1's drill, §9.3's exams). Writing a store API
  now to justify the DDL would be building those bullets by accident, which is why
  `test/store/schema.test.ts` inserts raw SQL instead.
- ~~**`predicted_outcome` is a column with no writer.**~~ **No longer true.**
  §10.2's capture landed as `POST /api/sessions/:id/predict`, and `/finish` writes
  the value onto the same attempt row as the verdict — which was the point of the
  column being here rather than in a table of its own: a quadrant is the prediction
  against `checkpoints_passed`, and a session graded three times has three
  timestamps and one prediction, so there is nothing to join it back by.
  `GET /api/calibration` reads it. `NULL` stays the third state, meaning the
  student did not click, and `calibration.ts` counts those attempts out rather than
  guessing what they would have said.
- **The guard does not compare snapshots**, only task identity — see above.
  §4.3's snapshot ladder is where that becomes a question worth answering.
- **`vm_state` is not a lock.** It records what is applied; it does not stop a
  second session from taking the guest. Two concurrent sessions still work the way
  they always did — the second one wins the machine, and the first one's next
  grade is refused with the offer to reset. Serialising access to a single guest
  is a different design and §12 asks for neither.
- **Nothing here was run against the lab VM.** The guard's engine and server
  halves are exercised entirely through fakes; what a real `vmrun revert` plus
  `setup.sh` leaves in `vm_state` is unverified by anything in this document.
- **No aggregate reads.** Pass rates, mean times and persistence-failure rates
  (§9.4) are Phase 3's, and the indices they will want
  (`attempt_objectives_by_objective`, `attempts_by_clean`) are in place.
- **No de-duplication of attempts.** Nothing stops two identical rows if a caller
  records twice; `/finish`'s 409 is what prevents it today, and a uniqueness
  constraint on (task, started_at) would false-positive on a legitimate retry.
