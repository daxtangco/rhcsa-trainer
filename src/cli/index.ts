import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkCoverage, loadBank, type Bank } from '../engine/content/bank.ts'
import { ContentError } from '../engine/content/errors.ts'
import { loadTaskScripts } from '../engine/validate/harness.ts'
import { validateBank } from '../engine/validate/run.ts'
import { loadVmConfig } from '../engine/vm/config.ts'
import { chooseTransport } from '../engine/vm/select.ts'
import { VmController } from '../engine/vm/vmrun.ts'
import { lintContent } from './lint.ts'

export interface CliIo {
  out: (line: string) => void
  err: (line: string) => void
}

const USAGE = `usage: rhcsa <command> [options]

commands:
  coverage              report content coverage gaps
  lint                  static checks on grader headers and checkpoint ids (no VM)
  validate [task-id]    run every fixture of every task against the lab VM

options:
  --content <dir>       content root (default: ./content)
  --strict              coverage: exit non-zero while gaps remain
  --allow-empty         lint: accept a content root with no grade.sh
  --snapshot <name>     validate: snapshot to reset to (default: clean)`

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
      // ''.startsWith('--') is false, so an empty value would otherwise slip
      // past this guard and loadBank('') would resolve against the process
      // cwd — never a content root anyone meant.
      if (value === undefined || value === '' || value.startsWith('--')) return undefined
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

/**
 * `lint` takes `--content` and `--allow-empty`, and nothing else. Same discipline
 * as the other two parsers, and `--strict` is deliberately not accepted: every
 * problem this command reports is already an error, so a flag that turned some of
 * them into errors would imply the rest were optional.
 *
 * `--allow-empty` is the opposite kind of flag and is why it is accepted: without
 * it a content root with no `grade.sh` would exit 0, and "nothing to check" read
 * as "all clear" is the failure this whole command exists to prevent. The flag
 * makes the one legitimate empty case state itself.
 */
function parseLintArgs(argv: string[]): { root: string; allowEmpty: boolean } | undefined {
  let root = 'content'
  let allowEmpty = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--content') {
      const value = argv[i + 1]
      if (value === undefined || value === '' || value.startsWith('--')) return undefined
      root = value
      i++
    } else if (arg === '--allow-empty') {
      allowEmpty = true
    } else {
      return undefined
    }
  }

  return { root, allowEmpty }
}

async function lint(argv: string[], io: CliIo): Promise<number> {
  const options = parseLintArgs(argv)
  if (options === undefined) {
    io.err(USAGE)
    return 2
  }

  let result: Awaited<ReturnType<typeof lintContent>>
  try {
    result = await lintContent(options.root, { allowEmpty: options.allowEmpty })
  } catch (e) {
    // A missing or unreadable content root is a usage-shaped failure, not a
    // crash: `lint` is the one command that runs on a fresh checkout, so its
    // error for "there is no content here" has to be readable.
    io.err(e instanceof Error ? e.message : String(e))
    return 1
  }

  io.out(`content root: ${options.root}`)
  io.out(`graders checked: ${result.gradersChecked}`)
  io.out(`scripts with headers: ${result.inventory.length}`)

  // The inventory is printed, not just computed. A drift check needs two commits
  // and a committed checker has only one, so the drift check is
  // test/cli/content-headers-golden.test.ts locking this structure against a
  // fixture — and printing it is what lets a reader confirm the fixture by eye.
  for (const entry of result.inventory) {
    io.out(`\n${entry.file}`)
    for (const h of entry.headers) io.out(`  ${h.kind}: ${h.declared.join(', ')}`)
    if (entry.emitted.length > 0) io.out(`  emits: ${entry.emitted.join(', ')}`)
  }

  if (result.notes.length > 0) io.out('')
  for (const n of result.notes) io.out(`note: ${n}`)

  if (result.problems.length > 0) {
    for (const p of result.problems) io.err(`problem: ${p}`)
    io.err(`\n${result.problems.length} problem(s)`)
    return 1
  }

  io.out(`\nno problems in ${result.gradersChecked} grader(s)`)
  return 0
}

interface ValidateOptions {
  root: string
  snapshot: string
  taskIds: string[]
}

/**
 * Same discipline as `parseCoverageArgs`: an explicit list of what `validate`
 * accepts, and anything else — an unknown `--flag`, a value-flag with no
 * following value, an empty or flag-shaped value — is a usage error rather
 * than a silently wrong default. Bare positionals are collected as task ids
 * instead of being rejected, which is the one shape difference from coverage.
 */
function parseValidateArgs(argv: string[]): ValidateOptions | undefined {
  let root = 'content'
  let snapshot = 'clean'
  const taskIds: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--content' || arg === '--snapshot') {
      const value = argv[i + 1]
      if (value === undefined || value === '' || value.startsWith('--')) return undefined
      if (arg === '--content') root = value
      else snapshot = value
      i++
    } else if (arg?.startsWith('--')) {
      return undefined
    } else if (arg !== undefined) {
      taskIds.push(arg)
    }
  }

  return { root, snapshot, taskIds }
}

async function validate(argv: string[], io: CliIo): Promise<number> {
  const options = parseValidateArgs(argv)
  if (options === undefined) {
    io.err(USAGE)
    return 2
  }
  const { root, snapshot, taskIds } = options

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

  const tasks = taskIds.length === 0 ? bank.tasks : []
  for (const id of taskIds) {
    const t = bank.tasksById.get(id)
    if (!t) {
      io.err(`unknown task: ${id}`)
      return 1
    }
    tasks.push(t)
  }

  if (tasks.length === 0) {
    io.err(`no tasks found under ${root}/tasks`)
    return 1
  }

  const cfg = loadVmConfig(process.env)
  const controller = new VmController(cfg)
  // A task can require the vmrun transport; honour the strictest requirement
  // across the set rather than probing per task.
  const require = tasks.some((t) => t.transport === 'vmrun') ? 'vmrun' : undefined
  const transport = await chooseTransport(cfg, require ? { require } : {})
  io.out(`transport: ${transport.kind}`)

  const assertLib = await readFile(join(root, 'lib', 'assert.sh'), 'utf8')

  const summary = await validateBank({
    tasks,
    assertLib,
    deps: {
      transport,
      // Every fixture starts from the same known machine. This is the whole
      // reason the clean snapshot is captured live.
      reset: () => controller.revert(snapshot),
      reboot: () => controller.reboot(),
    },
    loadScripts: loadTaskScripts,
    onTask: (id) => io.out(`\n${id}`),
  })

  for (const r of summary.results) {
    io.out(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.kind}/${r.name}`)
    for (const f of r.failures) io.out(`         ${f}`)
  }

  io.out(
    `\n${summary.results.length - summary.failed.length}/${summary.results.length} fixtures ok`,
  )
  return summary.failed.length === 0 ? 0 : 1
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv

  switch (command) {
    case 'coverage':
      return await coverage(rest, io)
    case 'lint':
      return await lint(rest, io)
    case 'validate':
      return await validate(rest, io)
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
