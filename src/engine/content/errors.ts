/**
 * Aggregating content error. Reports every problem found in a file at once
 * rather than failing on the first, because content authoring is a loop and
 * one-error-per-run makes that loop slow.
 *
 * Note the explicit field declarations: parameter properties are not erasable
 * syntax and would break `node file.ts` (see Global Constraints).
 */
export class ContentError extends Error {
  readonly where: string
  readonly problems: string[]

  constructor(where: string, problems: string[]) {
    super(`${where}: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`)
    this.name = 'ContentError'
    this.where = where
    this.problems = problems
  }
}
