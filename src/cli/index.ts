import { pathToFileURL } from 'node:url'
import { checkCoverage, loadBank, type Bank } from '../engine/content/bank.ts'
import { ContentError } from '../engine/content/errors.ts'

export interface CliIo {
  out: (line: string) => void
  err: (line: string) => void
}

const USAGE = `usage: rhcsa <command> [options]

commands:
  coverage    report content coverage gaps

options:
  --content <dir>   content root (default: ./content)
  --strict          exit non-zero while coverage gaps remain`

interface CoverageOptions {
  root: string
  strict: boolean
}

/**
 * One pass over `coverage`'s argv with an explicit list of what it accepts.
 * Anything outside that list — an unknown `--flag`, a bare positional
 * argument, `--content` with no following value, or `--content` followed by
 * something flag-shaped — is a usage error (`undefined`), never a silently
 * ignored or silently wrong default. A typo'd `--strict` must never disable
 * strictness quietly.
 */
function parseCoverageArgs(argv: string[]): CoverageOptions | undefined {
  let root = 'content'
  let strict = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--content') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) return undefined
      root = value
      i++
    } else if (arg === '--strict') {
      strict = true
    } else {
      return undefined
    }
  }

  return { root, strict }
}

async function coverage(argv: string[], io: CliIo): Promise<number> {
  const options = parseCoverageArgs(argv)
  if (options === undefined) {
    io.err(USAGE)
    return 2
  }
  const { root, strict } = options

  let bank: Bank
  try {
    bank = await loadBank(root)
  } catch (e) {
    if (e instanceof ContentError) {
      io.err(e.message)
      return 1
    }
    throw e
  }

  const report = checkCoverage(bank)

  io.out(`content root: ${bank.root}`)
  io.out(`tasks: ${bank.tasks.length}`)
  io.out(`concepts: ${bank.concepts.length}`)
  io.out(`objectives: ${bank.objectives.objectives.length}`)
  io.out(`uncovered objectives: ${report.uncoveredObjectives.length}`)
  for (const id of report.uncoveredObjectives) io.out(`  - ${id}`)
  io.out(`untaught concepts: ${report.untaughtConcepts.length}`)
  for (const id of report.untaughtConcepts) io.out(`  - ${id}`)

  if (report.problems.length > 0) {
    for (const p of report.problems) io.err(`problem: ${p}`)
    return 1
  }

  if (strict) {
    const gaps = report.uncoveredObjectives.length + report.untaughtConcepts.length
    if (gaps > 0) {
      io.err(
        `${report.uncoveredObjectives.length} uncovered objective(s), ` +
          `${report.untaughtConcepts.length} untaught concept(s)`,
      )
      return 1
    }
  }

  return 0
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv

  switch (command) {
    case 'coverage':
      return await coverage(rest, io)
    default:
      io.err(USAGE)
      return 2
  }
}

// Only run when invoked directly, so importing this module in tests is inert.
// Built with pathToFileURL rather than a hand-built `file://` string because
// the manual form breaks on any path needing percent-encoding.
const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  const code = await run(process.argv.slice(2), {
    out: (l) => process.stdout.write(`${l}\n`),
    err: (l) => process.stderr.write(`${l}\n`),
  })
  process.exit(code)
}
