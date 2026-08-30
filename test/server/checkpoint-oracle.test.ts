import { describe, expect, it } from 'vitest'
import {
  measureOracle,
  ORACLE_CASES,
  ORACLE_DIVERGENCES,
  type OracleRow,
} from './checkpoint-oracle.ts'

/**
 * The gate for `countCheckpoints`, with real bash as the reference. See
 * `checkpoint-oracle.ts` for what the table is, why every case in it has to be
 * single-path, and why both lists compare id sets rather than two counts.
 *
 * These take longer than a unit test because each case is a bash process. That
 * is the price of the only check on this function that cannot be fooled by
 * reasoning about shell syntax, and this function has been wrong six times.
 */
describe('countCheckpoints against real bash', () => {
  it('agrees with bash on every shape in the table', async () => {
    const rows = await measureOracle()

    // Anti-vacuity: if the harness silently stopped producing ids - bash absent,
    // assert.sh moved, stdout swallowed - most rows would collapse to 0/0 and a
    // count comparison would pass on the cases that expect nothing. Assert the
    // oracle is alive before asserting it agrees.
    expect(rows).toHaveLength(ORACLE_CASES.length)
    const totalBashIds = rows.reduce((n, r) => n + r.bash, 0)
    expect(totalBashIds).toBeGreaterThan(60)
    const anchor = rows.find((r) => r.name === 'pin-separator-semicolon')
    expect(anchor?.bashIds).toEqual(['gamma'])

    // The gate compares **id sets**, not the two counts. `bash === counter` is
    // satisfied by a compensating pair - one phantom id gained while one real id
    // is lost - and no field on `GradeReport` can see that either, because
    // `expectedTotal` is a number. A case may name the ids it declares when they
    // deliberately differ from bash's (exactly one does, and says why), but the
    // count comparison below is unconditional, so an override cannot excuse a
    // miscount.
    const disagreed = rows.filter((r) => {
      const expected = byName.get(r.name)?.counterIds ?? r.bashIds
      return !sameIds(r.counterIds, expected) || r.bash !== r.counter
    })
    expect(describeRows(disagreed)).toEqual([])
  }, 60_000)

  it('still disagrees with bash exactly where it is documented to, and no worse', async () => {
    // Pinned rather than omitted: a divergence left out of the table above is a
    // divergence nobody sees again. If one of these starts agreeing, this test
    // fails and the entry should be promoted into ORACLE_CASES.
    const rows = await measureOracle(ORACLE_DIVERGENCES)

    // Pinned as id sets on both sides, not as two numbers. The old form compared
    // cardinalities, so a divergence could change *which* id it loses - the thing
    // that decides whether a real checkpoint or a phantom one is at stake -
    // without the pin noticing.
    expect(rows.map((r) => ({ name: r.name, bashIds: r.bashIds, counterIds: r.counterIds }))).toEqual(
      ORACLE_DIVERGENCES.map((d) => ({
        name: d.name,
        bashIds: [...d.bashIds].sort(),
        counterIds: [...d.counterIds].sort(),
      })),
    )

    // Anti-vacuity: an empty list would satisfy every assertion in this loop.
    expect(ORACLE_DIVERGENCES.length).toBeGreaterThan(0)

    for (const row of rows) {
      const d = ORACLE_DIVERGENCES.find((x) => x.name === row.name)
      // A divergence that has started agreeing is not a divergence. It belongs in
      // ORACLE_CASES, where it proves the agreement instead of pinning the bug -
      // two entries were promoted that way this round, and renumbering them in
      // place would have been a test asserting the bug is still there.
      expect(sameIds(row.bashIds, row.counterIds)).toBe(false)

      // Derived from what was just **measured**, not from the numbers the author
      // wrote beside it. Sourcing it from the entry's own fields checked the entry
      // against itself; this checks it against bash.
      const measured =
        row.counter === row.bash ? 'both' : row.counter > row.bash ? 'over' : 'under'
      expect(d?.direction).toBe(measured)
    }
  }, 30_000)
})

const byName = new Map(ORACLE_CASES.map((c) => [c.name, c]))

/** Set equality over two already-sorted id lists. */
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/** Readable failure output: the shape's name beside both id sets. */
function describeRows(rows: OracleRow[]): string[] {
  return rows.map(
    (r) => `${r.name}: bash ${r.bash} (${r.bashIds.join(',')}), counter ${r.counter} (${r.counterIds.join(',')})`,
  )
}
