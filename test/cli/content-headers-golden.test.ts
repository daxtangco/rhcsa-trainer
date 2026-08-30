import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { lintContent } from '../../src/cli/lint.ts'

// Locks the full header inventory of the content bank — every `.sh` carrying a
// `# baseline-fail:`, `# expect-fail:` or `# unprobed-invariant:` header, with its
// declared ids and the checkpoint ids the script emits — against a committed
// fixture.
//
// Why this exists. Five separate throwaway extractors were written across the
// Task 22-24 reviews to answer "which checkpoint ids does this grader emit, and
// do the headers agree", and every one of them matched a word where it should
// have matched a call. All five failed loudly, so all five were caught, but each
// was written inline, run once and thrown away — which resets the odds for the
// sixth reviewer. `rhcsa lint` is the one correct extractor; this file is what
// stops it drifting.
//
// A drift check needs two commits and a committed checker has only one, so the
// drift check is this fixture. The effect is that any future edit to a header, or
// any rename of a `ck` id, must arrive with a fixture diff a reviewer can read
// line by line against the grader. That is the check three reviewers rebuilt by
// hand, made permanent.
//
// `emitted` is locked as well as the headers, deliberately. An invariant id that
// no header names — `var-intact`, `sshd-intact` — can be renamed today without
// changing anything else observable, because the declared-vs-emitted check has
// nothing to compare it against. Locking it here closes that.
//
// TO REGENERATE after a deliberate change, from the repo root:
//
//   node --experimental-strip-types -e "
//   import { writeFile } from 'node:fs/promises';
//   const { lintContent } = await import('./src/cli/lint.ts');
//   const { inventory } = await lintContent('content');
//   await writeFile('test/fixtures/content-headers.golden.json',
//     JSON.stringify(inventory, null, 2) + '\n', 'utf8');"
//
// Always regenerate; never hand-edit the fixture. Hand-transcribing it would
// reintroduce exactly the copying risk this test exists to close — which is not
// hypothetical here, since miscopying an id list is precisely how the five
// extractors above went wrong.

const CONTENT = fileURLToPath(new URL('../../content/', import.meta.url))
const FIXTURE = fileURLToPath(new URL('../fixtures/content-headers.golden.json', import.meta.url))

describe('content header inventory golden fixture', () => {
  it('matches test/fixtures/content-headers.golden.json exactly', async () => {
    const { inventory } = await lintContent(CONTENT)
    const golden: unknown = JSON.parse(await readFile(FIXTURE, 'utf8'))

    // Anti-vacuity. `toEqual([], [])` would pass if the walk silently found no
    // scripts — a wrong `--content` root, a readdir that returned nothing — and
    // that is the failure mode this whole file is guarding against.
    expect(inventory.length).toBeGreaterThan(20)
    expect(inventory.some((e) => e.headers.some((h) => h.kind === 'baseline-fail'))).toBe(true)
    expect(inventory.some((e) => e.headers.some((h) => h.kind === 'expect-fail'))).toBe(true)
    expect(inventory.some((e) => e.headers.some((h) => h.kind === 'unprobed-invariant'))).toBe(true)

    expect(
      inventory,
      'content/ has drifted from test/fixtures/content-headers.golden.json. If the change was ' +
        'deliberate, regenerate the fixture (see the header of this file) and read the diff row by row.',
    ).toEqual(golden)
  })

  it('reports no problems on the shipped bank', async () => {
    // The gate itself. A lint that only ever runs green on content nobody
    // changed is not evidence of anything, which is why lint.test.ts plants
    // defects — but this half has to hold too, or the gate is unusable.
    const { problems } = await lintContent(CONTENT)
    expect(problems).toEqual([])
  })
})
