import { describe, expect, it } from 'vitest'
import {
  measureOracle,
  ORACLE_CASES,
  ORACLE_DIVERGENCES,
  type OracleRow,
} from './checkpoint-oracle.ts'

/**
 * The gate for `countCheckpoints`, with real bash as the reference. See
 * `checkpoint-oracle.ts` for what the table is and why every case in it has to
 * be single-path.
 *
 * These take longer than a unit test because each case is a bash process. That
 * is the price of the only check on this function that cannot be fooled by
 * reasoning about shell syntax, and this function has been wrong five times.
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

    const disagreed = rows.filter((r) => r.bash !== r.counter)
    expect(describeRows(disagreed)).toEqual([])
  }, 60_000)

  it('still disagrees with bash exactly where it is documented to, and no worse', async () => {
    // Pinned rather than omitted: a divergence left out of the table above is a
    // divergence nobody sees again. If one of these starts agreeing, this test
    // fails and the entry should be promoted into ORACLE_CASES.
    const rows = await measureOracle(ORACLE_DIVERGENCES)

    expect(
      rows.map((r) => ({ name: r.name, bash: r.bash, counter: r.counter })),
    ).toEqual(
      ORACLE_DIVERGENCES.map((d) => ({ name: d.name, bash: d.bash, counter: d.counter })),
    )

    // No entry may be added here in the fail-open direction without a measured
    // reason, which the `why` field carries. `under` means `expectedTotal` lands
    // low and a truncated grader run reads as complete, so an unexplained one is
    // a defect wearing a disclosure's clothes.
    for (const d of ORACLE_DIVERGENCES) {
      expect(d.why.length).toBeGreaterThan(80)
      expect(d.direction).toBe(d.counter > d.bash ? 'over' : 'under')
    }
  }, 30_000)
})

/** Readable failure output: the shape's name beside both counts. */
function describeRows(rows: OracleRow[]): string[] {
  return rows.map((r) => `${r.name}: bash ${r.bash} (${r.bashIds.join(',')}), counter ${r.counter}`)
}
