import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { RUNGS, TOP_RUNG, type LadderMode, type Rating } from '../disclosure/ladder.ts'

/**
 * The history database: user history only, never content (spec section 12). The
 * whole task and concept bank can be renumbered or regenerated without a
 * migration, because nothing here has a foreign key into it — `task_id` and
 * `objective_id` are recorded as text, not as references.
 *
 * **Why `node:sqlite` and not `better-sqlite3`.** Spec section 15 names
 * `better-sqlite3`, which is a third-party native module; the project's standing
 * constraint is no build step and no new dependency. Node 22.23.2 ships
 * `node:sqlite` unflagged — measured, see `docs/attempt-store.md` — so the spec's
 * *storage engine* survives while its *driver* changes. The cost is one
 * `ExperimentalWarning` on stderr per process.
 */

/**
 * Structurally identical to `server/session.ts`'s `SessionMode`, and defined the
 * same way from the same `LadderMode`, so `app.ts` hands its `s.mode` straight in
 * with no conversion and no cast. It is restated here rather than imported
 * because the engine must not depend on the server: the store is the lower layer.
 */
export type AttemptMode = 'guided' | LadderMode

/** Section 10.2's pre-grade click. Captured by a later Phase 2 bullet; nullable until then. */
export type PredictedOutcome = 'pass' | 'unsure' | 'fail'

/**
 * Where an objective sits in FSRS's own state machine. These four are FSRS's
 * states, not this project's invention, and `objective_state.state` stores one of
 * them.
 *
 * **This is a column FSRS will read, not a scheduler.** Phase 3 writes the
 * scheduler; nothing in this build assigns a value here. So the four names below
 * are taken from FSRS's published design and are *not* verified against a running
 * implementation — there is none to run yet. If Phase 3's FSRS disagrees about
 * the set, the `CHECK` generated from this union is where it says so at the first
 * write, which is the loud failure and the reason the constraint is generated
 * rather than absent.
 */
export type FsrsCardState = 'new' | 'learning' | 'review' | 'relearning'

/**
 * Section 13's role assignment for the eight practice exams: R9-A is the
 * diagnostic baseline, R9-B/R9-C/R10-A/R10-B are mid-program checkpoints, R10-C
 * is reserve, and R9-D/R10-D are the two sealed holdouts. The role is what makes
 * an exam result mean something — section 14.3 rests entirely on the holdouts
 * being distinguishable from the exams that were mined for tasks — so it is a
 * constrained column rather than free text.
 *
 * The exam's *source* (`r9-A`) is free text in the same table, for the opposite
 * reason: that is a content id, and content ids stay renumberable.
 */
export type ExamRole = 'diagnostic' | 'checkpoint' | 'reserve' | 'holdout'

/**
 * These records exist to build the `CHECK` lists below, and that is the whole
 * point of them. A `CHECK (mode IN ('guided', ...))` written out by hand is
 * a copy of a TypeScript union that no compiler compares against it, so adding a
 * fifth mode would typecheck everywhere and then throw
 * `CHECK constraint failed` at the moment a student finished an attempt — losing
 * the attempt, which is the one thing this module exists to not do. Generated
 * from the union, a new member reaches the constraint automatically.
 *
 * Every enum column in the file is built this way, including the two that no code
 * writes yet: a table whose writer arrives in a later phase is exactly the table
 * whose hand-copied list nobody would think to update.
 */
const MODES: Record<AttemptMode, true> = { guided: true, practice: true, drill: true, exam: true }
const RATINGS: Record<Rating, true> = { again: true, hard: true, good: true, easy: true }
const OUTCOMES: Record<PredictedOutcome, true> = { pass: true, unsure: true, fail: true }
const FSRS_STATES: Record<FsrsCardState, true> = {
  new: true,
  learning: true,
  review: true,
  relearning: true,
}
const EXAM_ROLES: Record<ExamRole, true> = {
  diagnostic: true,
  checkpoint: true,
  reserve: true,
  holdout: true,
}

export const MODE_VALUES = Object.keys(MODES) as AttemptMode[]
export const RATING_VALUES = Object.keys(RATINGS) as Rating[]
export const OUTCOME_VALUES = Object.keys(OUTCOMES) as PredictedOutcome[]
export const FSRS_STATE_VALUES = Object.keys(FSRS_STATES) as FsrsCardState[]
export const EXAM_ROLE_VALUES = Object.keys(EXAM_ROLES) as ExamRole[]

/** The one `objective_state` row a never-reviewed objective starts life as. */
export const NEW_CARD_STATE: FsrsCardState = 'new'

/** `'a', 'b'` for a SQL `IN` list. The keys are TypeScript literals, so no escaping is possible. */
function sqlList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ')
}

const MIN_RUNG = RUNGS[0]

/**
 * The stale-state guard, in DDL.
 *
 * Section 5.5 states it as a refusal at grade time — grading task X while task
 * Y's setup is live. The guard has two halves, and they refuse at opposite ends
 * of a grading run.
 *
 * **Before the grader runs.** `vm_state` records which task's `setup.sh` is
 * applied to the guest. `store/vm-state.ts` compares that against the task about
 * to be graded and `server/app.ts` turns a mismatch into a refusal carrying the
 * offer to reset, without running `grade.sh` at all. This is section 5.5 read
 * literally, and it is the half that stops a student receiving pages of
 * inexplicable failures on correct work.
 *
 * **After it has run.** That first half cannot be the whole guard, because the
 * three ways a grading run turns out to have been measured against a drifted
 * guest are only visible *afterwards*: the report was suspect, the run was
 * incomplete, or the checkpoint count disagrees with what the task declares.
 * Section 9.2's ratings are computed from exactly those runs, and Phase 3's FSRS
 * scheduler consumes the ratings. So the guard also has to live where the
 * scheduler reads, not only where the grader starts.
 *
 * That second half is expressed three ways, deliberately redundant:
 *
 * - **`clean` is a generated column.** No writer can set it. An attempt carrying
 *   any drift signal *is* unclean by arithmetic, not by a caller remembering to
 *   say so.
 * - **A `CHECK` forbids a rating on an unclean attempt.** A rating is the only
 *   field a scheduler actually eats. `app.ts` already withholds it via
 *   `reportSuspect`; this makes the database refuse the row rather than trust
 *   that it did.
 * - **The `clean_attempts` view.** Every scheduler-shaped read goes through it,
 *   and `AttemptStore` exposes no drifted variant of those reads — see
 *   `cleanAttemptsForObjective`.
 *
 * A failed reboot is deliberately *not* drift. The guest not coming back is a
 * result about the student's work (section 5.4 rule 5), and `finalVerdict`
 * already downgrades every pass it produced; treating it as unusable data would
 * discard the most instructive attempts in the system. It is recorded in
 * `reboot_error` so a later reader can still tell the two apart.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS attempts (
  id                   INTEGER PRIMARY KEY,
  task_id              TEXT    NOT NULL,
  mode                 TEXT    NOT NULL CHECK (mode IN (${sqlList(MODE_VALUES)})),
  started_at           INTEGER NOT NULL,
  finished_at          INTEGER NOT NULL,
  recorded_at          INTEGER NOT NULL,
  rung_used            INTEGER NOT NULL CHECK (rung_used BETWEEN ${MIN_RUNG} AND ${TOP_RUNG}),

  verdict_a            TEXT    NOT NULL,
  verdict_b            TEXT,
  verdict_final        TEXT    NOT NULL,

  checkpoints_passed   INTEGER NOT NULL,
  checkpoints_seen     INTEGER NOT NULL,
  checkpoints_expected INTEGER NOT NULL,
  regression_count     INTEGER NOT NULL,
  rebooted             INTEGER NOT NULL CHECK (rebooted IN (0, 1)),
  reboot_error         TEXT,

  report_suspect       INTEGER NOT NULL CHECK (report_suspect IN (0, 1)),
  incomplete           INTEGER NOT NULL CHECK (incomplete IN (0, 1)),
  count_disputed       INTEGER NOT NULL CHECK (count_disputed IN (0, 1)),

  rating               TEXT    CHECK (rating IS NULL OR rating IN (${sqlList(RATING_VALUES)})),
  predicted_outcome    TEXT    CHECK (
                         predicted_outcome IS NULL
                         OR predicted_outcome IN (${sqlList(OUTCOME_VALUES)})
                       ),

  duration_s           INTEGER GENERATED ALWAYS AS
                         ((finished_at - started_at + 500) / 1000) VIRTUAL,
  clean                INTEGER GENERATED ALWAYS AS (
                         report_suspect = 0
                         AND incomplete = 0
                         AND count_disputed = 0
                         AND checkpoints_seen = checkpoints_expected
                       ) VIRTUAL,

  CHECK (finished_at >= started_at),
  CHECK (
    rating IS NULL
    OR (report_suspect = 0
        AND incomplete = 0
        AND count_disputed = 0
        AND checkpoints_seen = checkpoints_expected)
  )
) STRICT;

CREATE INDEX IF NOT EXISTS attempts_by_task  ON attempts (task_id, finished_at);
CREATE INDEX IF NOT EXISTS attempts_by_clean ON attempts (clean, finished_at);

-- Section 9.2: FSRS schedules objectives, not tasks. A row per (attempt,
-- objective) is what lets the scheduler read its own unit without scanning and
-- re-splitting a JSON array on every pass.
CREATE TABLE IF NOT EXISTS attempt_objectives (
  attempt_id   INTEGER NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  objective_id TEXT    NOT NULL,
  PRIMARY KEY (attempt_id, objective_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS attempt_objectives_by_objective
  ON attempt_objectives (objective_id, attempt_id);

CREATE VIEW IF NOT EXISTS clean_attempts AS SELECT * FROM attempts WHERE clean = 1;

-- Section 12's five remaining tables.
--
-- None of them carries an index, which is a cardinality argument rather than an
-- oversight: attempts grows one row per attempt and is the only table in the file
-- that grows without bound, which is why it is the only one with indexes.
-- objective_state is one row per objective (section 9.4 counts 22), concept_state one
-- per concept in the bank, exam_sessions one per sitting of the eight available
-- exams, triage_sessions one per 90-second drill. Scanning a table that size beats
-- walking an index over it, and an index that is never the cheaper plan is decoration
-- every write pays for.
--
-- Four of the five have no writer in this build; vm_state has store/vm-state.ts. They
-- land together because the schema is one artifact - one version bump, and one place
-- applying the generated-CHECK rule above, rather than five bumps that each have to
-- re-derive it. Nothing reads or writes objective_state, concept_state,
-- triage_sessions or exam_sessions yet and no test pretends otherwise; what is tested
-- is that every constraint below rejects the row it exists to reject.

-- Section 9.2 schedules objectives, so this is the row FSRS reads and writes. One
-- mutable row per objective, which makes it the one table in the file that is not a
-- log: an append-only history of card states would answer "what is the schedule
-- now" with "replay everything and keep the last".
--
-- state, stability, difficulty, reps, lapses and last_reviewed_at are what section
-- 12's "FSRS params" is spelled as here, and the alternative considered was one JSON
-- blob. Named columns won on three grounds. due_at is a predicate - every objective
-- due before T - and a JSON field cannot be compared without extracting it on every
-- row. STRICT types each column, so a scheduler that puts text where a number goes
-- fails at the write rather than at a read weeks later. And the invariants at the
-- foot of the table can only be written about columns.
--
-- What is not here: FSRS's global weight vector. Those weights are one set per user
-- rather than one per objective, and section 12 lists no table for them; persisting
-- a tuned set is a new table and a version bump, not a column here.
--
-- The field list is FSRS's published card, and it is unverified in the way that
-- matters: no FSRS implementation exists in this build to check it against, because
-- the scheduler is Phase 3. If Phase 3 wants a field this table lacks, that is a
-- version bump - the cost of guessing slightly wrong is one migration, and the cost
-- of a JSON blob was a column nobody could constrain.
CREATE TABLE IF NOT EXISTS objective_state (
  objective_id     TEXT    PRIMARY KEY,
  state            TEXT    NOT NULL CHECK (state IN (${sqlList(FSRS_STATE_VALUES)})),

  -- Nullable, and null means "FSRS has not assigned one yet" rather than zero: a
  -- stability of 0 days and a difficulty of 0 both read as real values, so using
  -- them as the unset marker would make a never-reviewed objective indistinguishable
  -- from a catastrophically hard one.
  --
  -- The bounds are the scales FSRS documents - stability is an interval in days,
  -- difficulty runs 1 to 10. Neither bound is verified against an implementation
  -- here, for the reason above, and both are asserted anyway: a number outside its
  -- own scale is one no reader can interpret, and this table is derived state that
  -- can be rebuilt from clean_attempts, so a loud refusal costs a recomputation
  -- rather than history.
  stability        REAL    CHECK (stability IS NULL OR stability > 0),
  difficulty       REAL    CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 10),

  reps             INTEGER NOT NULL CHECK (reps >= 0),
  lapses           INTEGER NOT NULL CHECK (lapses >= 0),
  last_reviewed_at INTEGER,
  -- When the scheduler should next select this objective. Not null even for a
  -- never-reviewed objective: section 9.2 selects a due objective, so "never
  -- studied" has to be expressible as "due now" rather than as a null that every
  -- comparison silently drops.
  due_at           INTEGER NOT NULL,

  -- A lapse is a review that came back "again", so lapses cannot outnumber reviews.
  CHECK (lapses <= reps),
  -- Both directions of "a rep is a review": zero reviews and a review timestamp
  -- cannot coexist, and neither can a review with no timestamp.
  CHECK ((last_reviewed_at IS NULL) = (reps = 0)),
  -- This build's definition of the first state, imposed here so a scheduler cannot
  -- half-record a review: the new state means never reviewed. The literal is
  -- interpolated from NEW_CARD_STATE, so renaming the union member reaches it.
  CHECK ((state = '${NEW_CARD_STATE}') = (reps = 0))
) STRICT, WITHOUT ROWID;

-- Sections 6.2 and 9.4: the coverage safety net, which is the only real advantage a
-- linear book had. One mutable row per concept the student has met.
--
-- demonstrated_cold reads section 6.2's claim - "you have never been taught, and
-- never demonstrated, autofs" - with the student as the subject of both verbs, and
-- "cold" as section 9.2's cold, meaning rung 1. So: the student has passed a task
-- requiring this concept without opening the ladder. Section 7.2's other kind of
-- demonstration, where the app executes an anti-solution to show a concept breaking,
-- is a different fact about a different actor; section 12 gives it no column, it is
-- not recorded here, and this comment is the only place that says so.
CREATE TABLE IF NOT EXISTS concept_state (
  concept_id        TEXT    PRIMARY KEY,
  -- The row exists because the concept was shown, so this is never null. First
  -- contact is rung 3, GET /api/concepts/:id, or a post-attempt teaching block
  -- (section 7.1) - the writing bullet decides which, and all three are a showing.
  first_shown_at    INTEGER NOT NULL,
  -- Section 9.2: a concept needed at rung 3 more than once raises the scheduling
  -- priority of tasks that require it. This is the count "more than once" reads.
  times_needed      INTEGER NOT NULL DEFAULT 0 CHECK (times_needed >= 0),
  last_needed_at    INTEGER,
  demonstrated_cold INTEGER NOT NULL DEFAULT 0 CHECK (demonstrated_cold IN (0, 1)),

  CHECK ((last_needed_at IS NULL) = (times_needed = 0)),
  -- Needing a concept at rung 3 shows its card, so a concept cannot have been needed
  -- before it was first shown. The same shape as attempts' finished_at >= started_at:
  -- an ordering the writer cannot get backwards.
  CHECK (last_needed_at IS NULL OR last_needed_at >= first_shown_at)
) STRICT, WITHOUT ROWID;

-- Section 10.1's time triage drill, which does not touch the guest. Append-only, one
-- row per completed drill, written at the end the way an attempt is: the drill is 90
-- seconds of paper work, so there is no partial state for anything to read.
--
-- The JSON columns are checked with json_valid(x) AND json_type(x) = 'array' rather
-- than with either half alone, and both halves are load-bearing. Measured on SQLite
-- 3.51.3: json_type on malformed text raises "malformed JSON" instead of failing the
-- constraint - the row is still rejected, but with an error that reads like a bug in
-- the database rather than a bad row - while json_array_length of an object returns
-- 0, so without the json_type half two non-arrays would compare equal and satisfy
-- the length checks at the foot of the table.
CREATE TABLE IF NOT EXISTS triage_sessions (
  id             INTEGER PRIMARY KEY,
  started_at     INTEGER NOT NULL,
  finished_at    INTEGER NOT NULL,
  task_ids       TEXT    NOT NULL CHECK (json_valid(task_ids) AND json_type(task_ids) = 'array'),
  user_order     TEXT    NOT NULL CHECK (json_valid(user_order) AND json_type(user_order) = 'array'),
  user_estimates TEXT    NOT NULL CHECK (
                           json_valid(user_estimates) AND json_type(user_estimates) = 'array'
                         ),
  -- Scored three ways (section 10.1). The shape of that scoring belongs to the bullet
  -- that computes it; that it is JSON at all belongs here.
  scores         TEXT    NOT NULL CHECK (json_valid(scores)),

  CHECK (finished_at >= started_at),
  -- An ordering that does not cover the set, or an estimate list with a hole in it,
  -- cannot be scored against that set: every one of section 10.1's three scores is a
  -- per-task comparison. Length is as far as SQL can check that. Whether user_order
  -- is a permutation of task_ids is the writer's business.
  CHECK (json_array_length(user_order) = json_array_length(task_ids)),
  CHECK (json_array_length(user_estimates) = json_array_length(task_ids))
) STRICT;

-- Section 9.3's mock exams, one row per sitting.
--
-- Unlike a triage drill, the row is written at the start: an exam is 150 minutes on a
-- single timer, so a sitting has to survive a server restart in the middle.
-- finished_at and report are therefore nullable - null means still running, or
-- abandoned - and the pair of checks at the foot is what keeps "abandoned" from being
-- read as "scored".
CREATE TABLE IF NOT EXISTS exam_sessions (
  id          INTEGER PRIMARY KEY,
  -- The source exam, e.g. r9-A. Text with no foreign key, for the same reason
  -- attempts.task_id is: the corpus is on disk and stays renumberable.
  source      TEXT    NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN (${sqlList(EXAM_ROLE_VALUES)})),
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  -- The task set and how it was composed (section 9.3). The shape is the composer's.
  composition TEXT    NOT NULL CHECK (json_valid(composition)),
  report      TEXT    CHECK (report IS NULL OR json_valid(report)),

  CHECK (finished_at IS NULL OR finished_at >= started_at),
  -- A report on an exam that never ended is the shape section 14.3 must never see:
  -- the two sealed holdouts are the readiness claim's only external check, and a
  -- half-sitting scored as a sitting is how that check gets quietly weakened.
  CHECK (report IS NULL OR finished_at IS NOT NULL)
) STRICT;

-- Section 5.5, the half of the guard that refuses before the grader runs. Written and
-- read by store/vm-state.ts.
--
-- One row, enforced by CHECK (id = 1). The guard asks one question - what is on the
-- guest right now - and section 12 names the columns in the singular. A log would
-- answer that question with "the last row", which is a projection to maintain and to
-- keep consistent with the log, and nothing in section 12 reads a history of setup
-- applications.
--
-- Both nulls together mean the guest's state is unknown, not that it is clean. A
-- revert followed by setup.sh is two operations on a machine whose whole purpose is
-- being broken, and either can fail or be interrupted; vm-state.ts writes the null
-- pair before the revert and the task only after setup.sh exits 0, so every
-- interleaving in between reads as unknown rather than as the previous task. The
-- guard refuses on unknown, because a half-applied setup is exactly the machine
-- section 5.5 exists to keep out of the grader.
--
-- The snapshot is recorded and deliberately not compared: section 5.5's refusal is
-- about task identity, and section 4.3's snapshot ladder is not built yet, so
-- comparing snapshots would be a guess about a design that does not exist.
CREATE TABLE IF NOT EXISTS vm_state (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  current_task     TEXT,
  current_snapshot TEXT,
  applied_at       INTEGER NOT NULL,

  -- A task's setup cannot be applied on top of a snapshot nobody recorded: the two
  -- unknowns are one state, so they move together.
  CHECK ((current_task IS NULL) = (current_snapshot IS NULL))
) STRICT;
`

/**
 * Bumped whenever `DDL` changes shape. `PRAGMA user_version` is the only
 * migration machinery here on purpose, and the version's job is to *refuse* a file
 * written by a newer build rather than silently read it with the wrong column
 * meanings. That job is unchanged by the bump to 2 — `openHistoryDb` compares and
 * throws below, and a test pins it.
 *
 * **2 opens a 1 without a migration, and that is a property of what changed rather
 * than of any machinery here.** Version 2 adds five tables (section 12's
 * `objective_state`, `concept_state`, `triage_sessions`, `exam_sessions`,
 * `vm_state`) and alters no column of `attempts` or `attempt_objectives`. Every
 * statement in `DDL` is `CREATE … IF NOT EXISTS`, so running it against a version 1
 * file adds the new tables and leaves the history untouched. `test/store/schema.test.ts`
 * measures exactly that, by taking a database back to 1, dropping the five and
 * reopening it.
 *
 * The next change that is *not* additive — a renamed or retyped column, a widened
 * `CHECK` on existing rows — is where this stops being enough and real migration
 * steps have to appear. Nothing here pretends to be ready for that.
 */
export const SCHEMA_VERSION = 2

/** The path that opens a throwaway database. Tests use it; nothing else should. */
export const MEMORY_DB = ':memory:'

export interface OpenOptions {
  /** File path, or `MEMORY_DB`. Parent directories are created. */
  path: string
}

export function openHistoryDb(opts: OpenOptions): DatabaseSync {
  if (opts.path !== MEMORY_DB) mkdirSync(dirname(opts.path), { recursive: true })
  const db = new DatabaseSync(opts.path)

  // ON by default in neither SQLite nor node:sqlite, and attempt_objectives'
  // CASCADE is inert without it.
  db.exec('PRAGMA foreign_keys = ON')
  // A crash mid-write must not cost the history. Ignored for :memory:.
  if (opts.path !== MEMORY_DB) db.exec('PRAGMA journal_mode = WAL')

  const row = db.prepare('PRAGMA user_version').get()
  const found = typeof row?.user_version === 'number' ? row.user_version : 0
  if (found > SCHEMA_VERSION) {
    db.close()
    throw new Error(
      `${opts.path} was written by a newer build (schema ${found}, this build reads ${SCHEMA_VERSION});` +
        ' refusing to open it rather than misread its columns',
    )
  }

  db.exec(DDL)
  if (found !== SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  return db
}
