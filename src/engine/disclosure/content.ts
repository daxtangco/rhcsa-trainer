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

const HEREDOC_START = /^<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * A command name, after stripping any leading path. Anything else is a fragment
 * of shell syntax or an argument, and putting it in front of the student as
 * something to read the man page for is worse than omitting it.
 */
const COMMAND_SHAPE = /^[A-Za-z_][A-Za-z0-9_.+-]*$/

/**
 * What the splitter is allowed to look at, plus the heredoc the line opens.
 *
 * A quoted run keeps its quotes and loses its contents, because its contents
 * are arguments. `sudo sed -i 's|^Listen 80$|Listen 82|' …` used to be split on
 * the `|`s *inside* the expression, and the first word of one of the resulting
 * pseudo-segments was `Listen` — an httpd directive handed to the student as
 * something to read the man page for, under a heading promising that arguments
 * are omitted. `''` cannot match `COMMAND_SHAPE`, so a stripped run now stops
 * the walk instead of feeding it.
 *
 * `<<` opens a heredoc only where it is really a heredoc: not inside a quoted
 * run, not after a `#`, and not part of a `<<<` herestring. Matched against the
 * whole line, all three silently discarded every remaining line of the solution
 * (`grep -q x <<<WORD` rendered a two-command sketch for a ten-command task).
 */
function scanLine(line: string): { code: string; heredoc?: string } {
  let code = ''
  let heredoc: string | undefined
  let i = 0

  while (i < line.length) {
    const ch = line.charAt(i)

    if (ch === "'" || ch === '"') {
      code += ch + ch
      const close = line.indexOf(ch, i + 1)
      // An unclosed quote runs to end of line. Fail closed: under-disclose
      // rather than guess where the author meant it to end.
      if (close === -1) break
      i = close + 1
      continue
    }

    // A `#` starts a comment only at the start of a word, so `${x#/}` survives.
    if (ch === '#' && (i === 0 || /[ \t]/.test(line.charAt(i - 1)))) break

    if (line.startsWith('<<<', i)) {
      // A herestring feeds one word to stdin. It opens nothing.
      //
      // Measured redundant today: the *anchoring* on HEREDOC_START is already
      // what refuses `<<<`, because the character after `<<` is `<` and not
      // `['"]?[A-Za-z_]`. Delete this branch and the herestring test still
      // passes, so that test pins the anchoring rather than this branch. It is
      // kept for the case where the anchor is ever loosened, not for its output:
      // on the contrived `<<<WORD cmd` this branch emits `WORD` where falling
      // through to `<<` would emit nothing, because `<WORD` is not a command
      // shape. No bank solution starts a line with a herestring.
      code += ' '
      i += 3
      continue
    }

    if (line.startsWith('<<', i)) {
      const m = HEREDOC_START.exec(line.slice(i))
      if (heredoc === undefined && m?.[2] !== undefined) heredoc = m[2]
      code += ' '
      i += 2
      continue
    }

    code += ch
    i += 1
  }

  return { code, heredoc }
}

/**
 * The commands a solution runs, in order, once each, stripped of arguments.
 *
 * This is rung 4 of the disclosure ladder. It is derived from the solution
 * rather than authored per task on purpose: a hand-written sketch drifts out of
 * date the moment the solution changes, and nobody notices because no test
 * covers prose.
 *
 * **This is a hint, not a spec.** It is a line-by-line heuristic, not a shell
 * parser. `scanLine` strips quoted runs first, so the argument text inside them
 * cannot reach the command position — but "no argument can ever leak" is more
 * than this can promise, and claiming it once hid a real leak. What survives, on
 * purpose, because fixing it needs a real parser and rung 4 is not worth one:
 *
 * - `for u in alice bob` emits the loop variable `u`, and a `case` block emits
 *   one word per pattern label (`a)` yields `a`). Harmless noise in a hint.
 * - an **unquoted** delimiter still leaks one word: `sed -i s\|a\|b\| /etc/hosts`
 *   emits `hosts`. Left alone deliberately — every solution in the bank quotes
 *   its `sed` expressions, and quoting them is the authoring convention.
 * - three shapes emit nothing rather than too much, which rung 5 covers: a first
 *   word that is a variable expansion (`$EDITOR /etc/fstab` → `[]`), a leading
 *   redirect (`> /etc/motd echo hi` → `[]`), and a command substitution inside
 *   double quotes, which goes with the quoted run it sits in. That last one is
 *   live: `nmcli … "$(cat /etc/rhcsa-conn)"` in troubleshooting/028's first
 *   solution no longer contributes `cat`. Losing an incidental `cat` is the
 *   price of not handing over `Listen` and `DocumentRoot`.
 * - a **wrapped** command sketches as the wrapper alone: `sudo sh -c "systemctl
 *   restart httpd"` emits `sh`, because the real command sits inside the quoted
 *   run that `scanLine` empties. Measured unreachable today — no solution,
 *   antisolution or setup script in the bank uses `sh -c` or `bash -c` — so this
 *   is a disclosure rather than a bug to fix, and the authoring convention below
 *   is what keeps it that way.
 *
 * The authoring convention that follows: a task's **first** solution should be
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

    const scanned = scanLine(line)
    if (scanned.heredoc !== undefined) heredoc = scanned.heredoc

    // Split on everything that can introduce a new command, so a pipeline and
    // a command substitution both contribute. A `sed` expression that uses `|`
    // as its delimiter is quoted, and `scanLine` has already emptied it, so
    // there is nothing left inside it to split on or to emit.
    for (const seg of scanned.code.split(/\$\(|\)|`|\|\||&&|[|;]/)) {
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
      // The ladder decides when the *hint endpoint* assembles these cards, not
      // whether the student can read one: `GET /api/concepts/:id` serves the
      // same bodies ungated, by design (see MAX_RUNG). This rung is the
      // convenience of getting exactly the task's cards in one response.
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
