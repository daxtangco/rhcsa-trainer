import type { ConceptSpec } from '../content/concept.ts'
import type { Objective } from '../content/objectives.ts'
import type { TaskSpec } from '../content/task.ts'
import type { Rung } from './ladder.ts'

export type RungKind = 'prompt' | 'nudge' | 'concepts' | 'sketch' | 'solution'

export interface RungContent {
  rung: Rung
  kind: RungKind
  title: string
  body: string
}

export interface RungContext {
  task: TaskSpec
  objectives: Objective[]
  concepts: ConceptSpec[]
  /** The text of the task's first solution. Rungs 4 and 5 are derived from it. */
  solution: string
}

/**
 * Shell words that are never the interesting command on a line.
 *
 * `test` and `time` are real commands but are never the *point* of the line
 * they introduce, and `!`, `]` and `]]` are punctuation the word splitter
 * cannot otherwise tell from a command name.
 */
const NOISE = new Set([
  'sudo',
  'set',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'if',
  'for',
  'while',
  'exit',
  'return',
  'local',
  'export',
  'in',
  'case',
  'esac',
  'until',
  'select',
  'function',
  'time',
  'test',
  '!',
  '[',
  '[[',
  ']',
  ']]',
  '{',
  '}',
  '(',
  ')',
])

const HEREDOC_START = /<<-?\s*'?"?([A-Za-z_][A-Za-z0-9_]*)'?"?/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * A command name, after stripping any leading path. Anything else is a fragment
 * of shell syntax or an argument, and putting it in front of the student as
 * something to read the man page for is worse than omitting it.
 */
const COMMAND_SHAPE = /^[A-Za-z_][A-Za-z0-9_.+-]*$/

/**
 * The commands a solution runs, in order, once each, stripped of arguments.
 *
 * This is rung 4 of the disclosure ladder. It is derived from the solution
 * rather than authored per task on purpose: a hand-written sketch drifts out of
 * date the moment the solution changes, and nobody notices because no test
 * covers prose.
 *
 * **This is a hint, not a spec.** It is a line-by-line heuristic, not a shell
 * parser, and two limits survive on purpose because fixing them needs a real
 * parser and rung 4 is not worth one:
 *
 * - `for u in alice bob` emits the loop variable `u`.
 * - a `case` pattern label emits (`a)` yields `a`).
 *
 * Both are harmless noise in a hint and neither can leak an argument. The
 * authoring convention that follows: a task's **first** solution should be
 * written as straight-line commands, because `loadTaskScripts` sorts fixture
 * names and rung 4 uses the first solution it finds.
 */
export function commandSketch(solution: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let heredoc: string | undefined

  for (const raw of solution.split('\n')) {
    const line = raw.trim()

    if (heredoc !== undefined) {
      if (line === heredoc) heredoc = undefined
      continue
    }

    if (line === '' || line.startsWith('#')) continue
    // `set -euo pipefail` is boilerplate, and none of its words is a command.
    if (/^set\s/.test(line)) continue

    const started = HEREDOC_START.exec(line)
    if (started?.[1] !== undefined) heredoc = started[1]

    // Split on everything that can introduce a new command, so a pipeline and
    // a command substitution both contribute. This also tears apart a `sed`
    // expression that uses `|` as its delimiter, which is exactly why the walk
    // below must stop at the command position rather than search past it.
    for (const seg of line.split(/\$\(|\)|`|\|\||&&|[|;]/)) {
      const words = seg.trim().split(/\s+/).filter((w) => w !== '')
      for (const w of words) {
        // Only noise and variable assignments may be skipped: `sudo`, `if` and
        // `LANG=C` genuinely precede the command. Every other word *is* the
        // command position, so stop there whether or not it looks like a
        // command name. Walking past it is how `-f /etc/fstab` used to emit
        // `fstab` as something to read the man page for.
        if (ASSIGNMENT.test(w) || NOISE.has(w)) continue
        const cmd = w.replace(/^.*\//, '')
        if (COMMAND_SHAPE.test(cmd) && !seen.has(cmd)) {
          seen.add(cmd)
          out.push(cmd)
        }
        break
      }
    }
  }

  return out
}

export function rungContent(rung: Rung, ctx: RungContext): RungContent {
  switch (rung) {
    case 1:
      return { rung, kind: 'prompt', title: 'The task', body: ctx.task.prompt.trim() }

    case 2: {
      const objectives = ctx.objectives.map((o) => `- ${o.text}`).join('\n')
      const concepts = ctx.concepts.map((c) => `- ${c.title}`).join('\n')
      return {
        rung,
        kind: 'nudge',
        title: 'What this is about',
        body:
          `This task is testing:\n${objectives}\n\n` +
          `If you are stuck, one of these is probably the piece you are missing:\n${concepts}`,
      }
    }

    case 3:
      return {
        rung,
        kind: 'concepts',
        title: 'Concept cards',
        body: ctx.concepts.map((c) => `## ${c.title}\n\n${c.body.trim()}`).join('\n\n---\n\n'),
      }

    case 4: {
      const cmds = commandSketch(ctx.solution)
      // An empty sketch would otherwise render "In roughly this order:" with
      // nothing under it, followed by "Each one has a man page" — a heading
      // promising a list that is not there.
      const body =
        cmds.length === 0
          ? 'This task has no commands to sketch: its solution is a file edit, or ' +
            'no solution fixture was found. Rung 5 has the full text.'
          : 'In roughly this order, arguments omitted:\n\n' +
            cmds.map((c) => `- \`${c}\``).join('\n') +
            '\n\nEach one has a man page. Read the one you are least sure about.'
      return { rung, kind: 'sketch', title: 'The commands you need', body }
    }

    case 5:
      return {
        rung,
        kind: 'solution',
        title: 'A full solution',
        body:
          'One correct answer. It is not the only one, and the grader accepts others.\n\n' +
          '```bash\n' +
          ctx.solution.trim() +
          '\n```',
      }
  }
}
