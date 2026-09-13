import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EXAM_ROLE_VALUES,
  FSRS_STATE_VALUES,
  MEMORY_DB,
  SCHEMA_VERSION,
  openHistoryDb,
} from '../../src/engine/store/schema.ts'

/**
 * Section 12's five tables that are not `attempts`.
 *
 * Every `CHECK` in the schema is tested from **both** sides here: one insert that
 * the constraint must accept and one it must reject. A constraint with only a
 * happy-path test is decoration — it would pass just as well spelled
 * `CHECK (1 = 1)` — and four of these tables have no writer in this build, so the
 * tests are the only thing standing between a mistake in the DDL and a Phase 3
 * bullet inheriting it.
 *
 * The inserts are raw SQL rather than a store API on purpose, for the same four
 * tables: there is no store API, and writing one to test the DDL would be building
 * the Phase 3 bullet by accident. `vm_state` does have one, and
 * `test/store/vm-state.test.ts` drives it through that instead.
 */

const open: DatabaseSync[] = []

function db(): DatabaseSync {
  const d = openHistoryDb({ path: MEMORY_DB })
  open.push(d)
  return d
}

afterEach(() => {
  while (open.length > 0) open.pop()?.close()
})

/** Both the accepted and the rejected case read the same way at the call site. */
function insert(d: DatabaseSync, table: string, row: Record<string, string | number | null>): void {
  const cols = Object.keys(row)
  const stmt = d.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`,
  )
  stmt.run(row)
}

const CHECK_FAILED = /CHECK constraint failed/

describe('objective_state, the row FSRS will read', () => {
  /** A card mid-review: the shape section 9.2's scheduler writes on every rating. */
  function card(over: Record<string, string | number | null> = {}) {
    return {
      objective_id: 'storage.lvm.resize',
      state: 'review',
      stability: 12.5,
      difficulty: 6.25,
      reps: 4,
      lapses: 1,
      last_reviewed_at: 1_700_000_000_000,
      due_at: 1_700_600_000_000,
      ...over,
    }
  }

  it('stores a reviewed card and reads back the floats as floats', () => {
    const d = db()
    insert(d, 'objective_state', card())
    expect(d.prepare('SELECT * FROM objective_state').get()).toEqual({
      objective_id: 'storage.lvm.resize',
      state: 'review',
      stability: 12.5,
      difficulty: 6.25,
      reps: 4,
      lapses: 1,
      last_reviewed_at: 1_700_000_000_000,
      due_at: 1_700_600_000_000,
    })
  })

  it('stores a never-reviewed objective as due with no stability or difficulty yet', () => {
    // Null rather than zero: section 9.2 selects a *due* objective, so "never
    // studied" has to be expressible, and 0 stability would read as a real value.
    const d = db()
    insert(
      d,
      'objective_state',
      card({ state: 'new', stability: null, difficulty: null, reps: 0, lapses: 0, last_reviewed_at: null }),
    )
    const row = d.prepare('SELECT * FROM objective_state').get()
    expect(row).toMatchObject({ state: 'new', stability: null, difficulty: null, reps: 0 })
  })

  it('accepts every FSRS state the union names, and nothing else', () => {
    const d = db()
    for (const state of FSRS_STATE_VALUES) {
      // 'new' is defined as never reviewed, so it is the one state with no reps.
      const reps = state === 'new' ? 0 : 2
      insert(
        d,
        'objective_state',
        card({ objective_id: `o-${state}`, state, reps, lapses: 0, last_reviewed_at: reps === 0 ? null : 1 }),
      )
    }
    expect(d.prepare('SELECT count(*) n FROM objective_state').get()).toEqual({
      n: FSRS_STATE_VALUES.length,
    })
    // The list is generated from `FsrsCardState`, so this is what a fifth state
    // added to the union without a schema bump would look like from SQLite's side.
    expect(() => insert(d, 'objective_state', card({ objective_id: 'o-x', state: 'mastered' }))).toThrow(
      CHECK_FAILED,
    )
  })

  it('refuses a stability or difficulty outside its own scale', () => {
    const d = db()
    expect(() => insert(d, 'objective_state', card({ stability: 0 }))).toThrow(CHECK_FAILED)
    expect(() => insert(d, 'objective_state', card({ stability: -3.5 }))).toThrow(CHECK_FAILED)
    expect(() => insert(d, 'objective_state', card({ difficulty: 0.5 }))).toThrow(CHECK_FAILED)
    expect(() => insert(d, 'objective_state', card({ difficulty: 10.5 }))).toThrow(CHECK_FAILED)
    // The ends of the documented 1-10 scale are inside it, not outside.
    insert(d, 'objective_state', card({ objective_id: 'o-min', difficulty: 1 }))
    insert(d, 'objective_state', card({ objective_id: 'o-max', difficulty: 10 }))
  })

  it('refuses a negative count, and more lapses than reviews', () => {
    const d = db()
    expect(() => insert(d, 'objective_state', card({ reps: -1 }))).toThrow(CHECK_FAILED)
    expect(() => insert(d, 'objective_state', card({ lapses: -1 }))).toThrow(CHECK_FAILED)
    // A lapse is a review that came back `again`; there cannot be more of those than
    // there were reviews.
    expect(() => insert(d, 'objective_state', card({ reps: 1, lapses: 2 }))).toThrow(CHECK_FAILED)
  })

  it('refuses a review count that disagrees with the review timestamp, in both directions', () => {
    const d = db()
    expect(() =>
      insert(d, 'objective_state', card({ state: 'new', reps: 0, lapses: 0, last_reviewed_at: 5 })),
    ).toThrow(CHECK_FAILED)
    expect(() => insert(d, 'objective_state', card({ reps: 4, last_reviewed_at: null }))).toThrow(
      CHECK_FAILED,
    )
  })

  it('refuses a state that disagrees with the review count, in both directions', () => {
    const d = db()
    // 'new' means never reviewed. A reviewed card that still calls itself new, or an
    // unreviewed card that calls itself something else, is a half-recorded review.
    expect(() => insert(d, 'objective_state', card({ state: 'new' }))).toThrow(CHECK_FAILED)
    expect(() =>
      insert(d, 'objective_state', card({ state: 'learning', reps: 0, lapses: 0, last_reviewed_at: null })),
    ).toThrow(CHECK_FAILED)
  })

  it('requires a due date, because an objective with no due date is one the scheduler never sees', () => {
    const d = db()
    const { due_at: _dropped, ...noDue } = card()
    expect(() => insert(d, 'objective_state', noDue)).toThrow(/NOT NULL constraint failed/)
  })

  it('refuses text where a number goes, unless the text is losslessly that number', () => {
    const d = db()
    expect(() => insert(d, 'objective_state', card({ stability: 'twelve' }))).toThrow(
      /cannot store TEXT value in REAL column/,
    )
    expect(() => insert(d, 'objective_state', card({ reps: 'four' }))).toThrow(
      /cannot store TEXT value in INTEGER column/,
    )

    // Measured on SQLite 3.51.3, and not what "STRICT" sounds like: a STRICT table
    // applies the column's affinity first and refuses only what cannot be converted
    // without loss, so the *string* '12.5' lands in a REAL column as the number.
    // Recorded here because a reader who assumed otherwise would think the two
    // assertions above prove more than they do.
    insert(d, 'objective_state', card({ objective_id: 'o-text', stability: '12.5', reps: '4' }))
    expect(d.prepare("SELECT stability, reps FROM objective_state WHERE objective_id = 'o-text'").get()).toEqual(
      { stability: 12.5, reps: 4 },
    )
  })
})

describe('concept_state, section 6.2\'s coverage safety net', () => {
  function concept(over: Record<string, string | number | null> = {}) {
    return {
      concept_id: 'lvm-extents',
      first_shown_at: 1_700_000_000_000,
      times_needed: 2,
      last_needed_at: 1_700_000_600_000,
      demonstrated_cold: 1,
      ...over,
    }
  }

  it('stores a concept that has been shown, needed twice and demonstrated cold', () => {
    const d = db()
    insert(d, 'concept_state', concept())
    expect(d.prepare('SELECT * FROM concept_state').get()).toEqual(concept())
  })

  it('defaults a freshly shown concept to never needed and never demonstrated', () => {
    const d = db()
    insert(d, 'concept_state', { concept_id: 'autofs-maps', first_shown_at: 1 })
    expect(d.prepare('SELECT * FROM concept_state').get()).toEqual({
      concept_id: 'autofs-maps',
      first_shown_at: 1,
      times_needed: 0,
      last_needed_at: null,
      demonstrated_cold: 0,
    })
  })

  it('refuses a negative need count and a demonstrated_cold that is not a flag', () => {
    const d = db()
    expect(() => insert(d, 'concept_state', concept({ times_needed: -1, last_needed_at: 1 }))).toThrow(
      CHECK_FAILED,
    )
    expect(() => insert(d, 'concept_state', concept({ demonstrated_cold: 2 }))).toThrow(CHECK_FAILED)
  })

  it('refuses a need count that disagrees with the need timestamp, in both directions', () => {
    const d = db()
    expect(() => insert(d, 'concept_state', concept({ times_needed: 0 }))).toThrow(CHECK_FAILED)
    expect(() => insert(d, 'concept_state', concept({ last_needed_at: null }))).toThrow(CHECK_FAILED)
  })

  it('refuses a concept needed before it was ever shown', () => {
    const d = db()
    // Rung 3 shows the card, so being needed is being shown; the reverse ordering is
    // a clock or a writer that has the two events backwards.
    expect(() =>
      insert(d, 'concept_state', concept({ first_shown_at: 500, last_needed_at: 499 })),
    ).toThrow(CHECK_FAILED)
    insert(d, 'concept_state', concept({ concept_id: 'same-instant', first_shown_at: 500, last_needed_at: 500 }))
  })

  it('requires the timestamp that says the concept was taught at all', () => {
    const d = db()
    expect(() => insert(d, 'concept_state', { concept_id: 'x', times_needed: 0 })).toThrow(
      /NOT NULL constraint failed/,
    )
  })
})

describe('triage_sessions, section 10.1\'s paper drill', () => {
  function drill(over: Record<string, string | number | null> = {}) {
    return {
      started_at: 1_700_000_000_000,
      finished_at: 1_700_000_090_000, // the 90 seconds section 10.1 allows
      task_ids: JSON.stringify(['storage/014-grow-home-lv', 'selinux/019-httpd-alt-port']),
      user_order: JSON.stringify([1, 0]),
      user_estimates: JSON.stringify([600, 420]),
      scores: JSON.stringify({ expected: 240, optimal: 285 }),
      ...over,
    }
  }

  it('stores one completed drill', () => {
    const d = db()
    insert(d, 'triage_sessions', drill())
    expect(d.prepare('SELECT * FROM triage_sessions').get()).toMatchObject({ id: 1, ...drill() })
  })

  it('refuses text that is not JSON in any of the four JSON columns', () => {
    const d = db()
    for (const col of ['task_ids', 'user_order', 'user_estimates', 'scores']) {
      // Measured: `json_type` alone raises "malformed JSON" here instead, which
      // rejects the row with an error that reads like a database bug. The paired
      // `json_valid` is what makes every rejection in this schema read the same.
      expect(() => insert(d, 'triage_sessions', drill({ [col]: 'not json at all' }))).toThrow(
        CHECK_FAILED,
      )
    }
  })

  it('refuses a JSON object where the schema says array', () => {
    const d = db()
    // Load-bearing rather than cosmetic: json_array_length of an object is 0, so
    // without this check two objects would satisfy the length comparisons below.
    expect(() => insert(d, 'triage_sessions', drill({ task_ids: '{"a":1}' }))).toThrow(CHECK_FAILED)
    expect(() => insert(d, 'triage_sessions', drill({ user_order: '{"a":1}' }))).toThrow(CHECK_FAILED)
    expect(() => insert(d, 'triage_sessions', drill({ user_estimates: '7' }))).toThrow(CHECK_FAILED)
  })

  it('refuses an ordering or an estimate list that does not cover the task set', () => {
    const d = db()
    expect(() => insert(d, 'triage_sessions', drill({ user_order: JSON.stringify([0]) }))).toThrow(
      CHECK_FAILED,
    )
    expect(() =>
      insert(d, 'triage_sessions', drill({ user_estimates: JSON.stringify([600, 420, 300]) })),
    ).toThrow(CHECK_FAILED)
  })

  it('refuses a drill that finished before it started', () => {
    const d = db()
    expect(() => insert(d, 'triage_sessions', drill({ finished_at: 1_699_999_999_999 }))).toThrow(
      CHECK_FAILED,
    )
  })
})

describe('exam_sessions, section 9.3\'s mock exams', () => {
  function sitting(over: Record<string, string | number | null> = {}) {
    return {
      source: 'r9-A',
      role: 'diagnostic',
      started_at: 1_700_000_000_000,
      finished_at: 1_700_009_000_000,
      composition: JSON.stringify({ tasks: ['storage/014-grow-home-lv'], budgetS: 9000 }),
      report: JSON.stringify({ passed: 11, of: 17 }),
      ...over,
    }
  }

  it('stores a finished sitting with its composition and report', () => {
    const d = db()
    insert(d, 'exam_sessions', sitting())
    expect(d.prepare('SELECT * FROM exam_sessions').get()).toMatchObject({ id: 1, ...sitting() })
  })

  it('stores a sitting that is still running, which is why the row exists from the start', () => {
    const d = db()
    // 150 minutes on one timer: the row has to survive a restart mid-exam, so
    // unfinished is a state and not an error.
    insert(d, 'exam_sessions', sitting({ finished_at: null, report: null }))
    expect(d.prepare('SELECT finished_at, report FROM exam_sessions').get()).toEqual({
      finished_at: null,
      report: null,
    })
  })

  it('accepts every role section 13 assigns, and nothing else', () => {
    const d = db()
    for (const role of EXAM_ROLE_VALUES) insert(d, 'exam_sessions', sitting({ role }))
    expect(d.prepare('SELECT count(*) n FROM exam_sessions').get()).toEqual({
      n: EXAM_ROLE_VALUES.length,
    })
    expect(() => insert(d, 'exam_sessions', sitting({ role: 'baseline' }))).toThrow(CHECK_FAILED)
  })

  it('refuses text that is not JSON in the composition or the report', () => {
    const d = db()
    expect(() => insert(d, 'exam_sessions', sitting({ composition: '<xml/>' }))).toThrow(CHECK_FAILED)
    expect(() => insert(d, 'exam_sessions', sitting({ report: '<xml/>' }))).toThrow(CHECK_FAILED)
  })

  it('refuses a report on a sitting that never ended', () => {
    const d = db()
    // Section 14.3 rests on the holdouts: a half-sitting scored as a sitting is how
    // the readiness claim's only external check gets quietly weakened.
    expect(() => insert(d, 'exam_sessions', sitting({ finished_at: null }))).toThrow(CHECK_FAILED)
  })

  it('refuses a sitting that finished before it started', () => {
    const d = db()
    expect(() => insert(d, 'exam_sessions', sitting({ finished_at: 1_699_999_999_999 }))).toThrow(
      CHECK_FAILED,
    )
  })
})

describe('vm_state, the guard the grader consults first', () => {
  it('holds one row and refuses a second', () => {
    const d = db()
    insert(d, 'vm_state', { id: 1, current_task: 'storage/014', current_snapshot: 'clean', applied_at: 5 })
    // There is one guest. A second row would be a second answer to "what is applied
    // right now", and a reader would have to pick.
    expect(() =>
      insert(d, 'vm_state', { id: 2, current_task: 'selinux/019', current_snapshot: 'clean', applied_at: 6 }),
    ).toThrow(CHECK_FAILED)
    expect(d.prepare('SELECT count(*) n FROM vm_state').get()).toEqual({ n: 1 })
  })

  it('refuses a task applied on top of a snapshot nobody recorded, and the reverse', () => {
    const d = db()
    expect(() =>
      insert(d, 'vm_state', { id: 1, current_task: 'storage/014', current_snapshot: null, applied_at: 5 }),
    ).toThrow(CHECK_FAILED)
    expect(() =>
      insert(d, 'vm_state', { id: 1, current_task: null, current_snapshot: 'clean', applied_at: 5 }),
    ).toThrow(CHECK_FAILED)
    // Both null together is the unknown state, and it is legal.
    insert(d, 'vm_state', { id: 1, current_task: null, current_snapshot: null, applied_at: 5 })
  })

  it('requires the time the state was recorded', () => {
    const d = db()
    expect(() => insert(d, 'vm_state', { id: 1, current_task: null, current_snapshot: null })).toThrow(
      /NOT NULL constraint failed/,
    )
  })
})

describe('the schema version', () => {
  it('opens a version 1 file, adds the five new tables and leaves the history alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhcsa-schema-'))
    try {
      const path = join(dir, 'history.db')
      const first = openHistoryDb({ path })
      first.exec(
        `INSERT INTO attempts (
           task_id, mode, started_at, finished_at, recorded_at, rung_used,
           verdict_a, verdict_final, checkpoints_passed, checkpoints_seen, checkpoints_expected,
           regression_count, rebooted, report_suspect, incomplete, count_disputed
         ) VALUES ('storage/014', 'practice', 0, 0, 0, 1, '{}', '{}', 1, 1, 1, 0, 0, 0, 0, 0)`,
      )
      first.close()

      // A version 1 file, built by taking a version 2 one back rather than by
      // copying the old DDL into this test: a copy would stop being version 1 the
      // moment `attempts` changed, and would then be testing nothing.
      const back = new DatabaseSync(path)
      for (const t of ['objective_state', 'concept_state', 'triage_sessions', 'exam_sessions', 'vm_state']) {
        back.exec(`DROP TABLE ${t}`)
      }
      back.exec('PRAGMA user_version = 1')
      back.close()

      const upgraded = openHistoryDb({ path })
      try {
        expect(upgraded.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
        // The five are back, because every statement in the DDL is CREATE IF NOT
        // EXISTS and version 2 adds nothing to an existing table.
        expect(upgraded.prepare('SELECT count(*) n FROM vm_state').get()).toEqual({ n: 0 })
        expect(upgraded.prepare('SELECT count(*) n FROM objective_state').get()).toEqual({ n: 0 })
        // And the attempt written by the older build is still there.
        expect(upgraded.prepare('SELECT task_id FROM attempts').all()).toEqual([
          { task_id: 'storage/014' },
        ])
      } finally {
        upgraded.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
