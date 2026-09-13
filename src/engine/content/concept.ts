import { readFile } from 'node:fs/promises'
import matter from 'gray-matter'
import { ContentError } from './errors.ts'

export interface ConceptSpec {
  id: string
  title: string
  rhel: number
  objectives: string[]
  sources: string[]
  prerequisites: string[]
  body: string
  path: string
}

/** Dotted lowercase, e.g. storage.lvm-abstraction-stack */
const CONCEPT_ID_RE = /^[a-z0-9]+(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/

/**
 * A card shorter than this is a stub, not teaching. The spec budgets 200-300
 * words per card; 120 characters is a floor that catches empties and
 * accidental truncation without policing style.
 */
const MIN_BODY_CHARS = 120

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function stringArray(v: unknown, field: string, problems: string[]): string[] {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    problems.push(`${field} must be a list of strings`)
    return []
  }
  return v as string[]
}

function intInRange(
  v: unknown,
  field: string,
  min: number,
  max: number,
  problems: string[],
): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    problems.push(`${field} must be an integer ${min}-${max}`)
    return min
  }
  return v
}

export function parseConcept(text: string, path: string): ConceptSpec {
  const problems: string[] = []
  const parsed = matter(text)

  if (!isRecord(parsed.data)) {
    throw new ContentError(path, ['front matter must be a mapping'])
  }
  const fm = parsed.data

  const id = typeof fm.id === 'string' && CONCEPT_ID_RE.test(fm.id) ? fm.id : ''
  if (!id) problems.push('id must be dotted lowercase, e.g. storage.lvm-abstraction-stack')

  const title = typeof fm.title === 'string' && fm.title.trim() !== '' ? fm.title : ''
  if (!title) problems.push('title must be a non-empty string')

  const rhel = intInRange(fm.rhel, 'rhel', 9, 10, problems)

  const objectives = stringArray(fm.objectives, 'objectives', problems)
  if (fm.objectives === undefined || (Array.isArray(fm.objectives) && objectives.length === 0)) {
    problems.push('objectives must list at least one objective id')
  }

  const body = parsed.content.trim()
  if (body.length < MIN_BODY_CHARS) {
    problems.push(`body must be at least ${MIN_BODY_CHARS} characters of prose`)
  }

  const spec: ConceptSpec = {
    id,
    title,
    rhel,
    objectives,
    sources: stringArray(fm.sources, 'sources', problems),
    prerequisites: stringArray(fm.prerequisites, 'prerequisites', problems),
    body,
    path,
  }

  if (problems.length > 0) throw new ContentError(path, problems)
  return spec
}

export async function loadConcept(path: string): Promise<ConceptSpec> {
  return parseConcept(await readFile(path, 'utf8'), path)
}

/**
 * The concept graph (spec section 6.1). `prerequisites` is the edge list: an
 * edge runs from a card to something that must be understood before it, so
 * following edges *away* from a card walks towards the foundations, and
 * following them from the cards a task pulls in enumerates everything that task
 * silently assumes.
 *
 * Traversal is on the graph rather than on `ConceptSpec.prerequisites` for one
 * reason: a raw walk of that field can hang. Two cards naming each other is a
 * plausible authoring accident once there are forty of them, and it turns any
 * recursive walk into either an infinite loop or a stack overflow at the moment
 * a student opens the wrong card. Every walk here is bounded by a visited set,
 * so a cycle can make an *ordering* meaningless but can never hang the app —
 * and `problems` names the cycle so it gets fixed rather than tolerated.
 */
export interface ConceptGraph {
  /** Every id in the graph, sorted, so every caller iterates deterministically. */
  readonly ids: readonly string[]
  /**
   * Authoring bugs found while building the graph: an edge to an id no card
   * declares, the same prerequisite listed twice, and every prerequisite cycle.
   *
   * Carried on the graph instead of thrown, for the same reason `loadBank`
   * aggregates loader failures: one build reports every problem, so an author
   * fixing a batch of cards is not made to run the checker once per mistake.
   * The loud error is the caller's job — `checkCoverage` folds these into
   * `CoverageReport.problems`, which `rhcsa coverage` exits 1 on and
   * `refuseToServe` refuses to serve on.
   */
  readonly problems: readonly string[]
  has(id: string): boolean
  /**
   * Direct prerequisites of `id`, in the order the card declares them.
   *
   * Edges to ids no card declares are **not** in here — they were dropped while
   * building and recorded in `problems` instead. That is not the silent skip
   * this graph exists to prevent: dropping them keeps every id a traversal
   * returns resolvable in `Bank.conceptsById`, and the dropped edge is still
   * reported by name.
   */
  directPrerequisitesOf(id: string): readonly string[]
  /**
   * Everything that must be understood before `id`, transitively, in an order
   * you could study them in: every card appears after its own prerequisites,
   * and `id` itself is not included.
   *
   * The order is a post-order depth-first walk, which is a topological order
   * only when the graph is acyclic. On a graph whose `problems` name a cycle the
   * call still returns — it cannot hang — but the order through the cycle means
   * nothing, which is one more reason a cycle is a hard problem rather than a
   * warning.
   *
   * Throws on an id the graph does not know. Callers holding a `Bank` already
   * have `conceptsById` to check against, and returning `[]` for a typo'd id
   * would answer "nothing needed first" — the one wrong answer that looks
   * exactly like a correct one.
   */
  prerequisitesOf(id: string): string[]
  /**
   * Every id reachable from `roots` by following prerequisite edges, `roots`
   * included. Given the concept ids the task bank requires, this is the set of
   * cards a student can ever be shown; anything outside it is unreachable
   * content (`CoverageReport.unreachableConcepts`).
   *
   * Roots the graph does not know are skipped rather than throwing, because the
   * caller with unknown roots is `checkCoverage` walking `task.requiresConcepts`
   * — and it reports those ids itself, as `requires unknown concept`.
   */
  reachableFrom(roots: Iterable<string>): Set<string>
}

/**
 * Colours for the cycle-detecting walk: unvisited, on the current path, done. A
 * string union rather than an enum because `erasableSyntaxOnly` is on — Node
 * strips the types and runs this file directly, so a construct that has to emit
 * code is not available.
 */
type Mark = 'white' | 'grey' | 'black'

export function buildConceptGraph(concepts: readonly ConceptSpec[]): ConceptGraph {
  const problems: string[] = []
  const edges = new Map<string, string[]>()

  // Two passes, because prerequisites are unordered: a card may name one that
  // is loaded after it, and registering every id first is what stops that from
  // being reported as a dangling edge.
  for (const c of concepts) edges.set(c.id, [])
  for (const c of concepts) {
    const kept: string[] = []
    const seen = new Set<string>()
    for (const pid of c.prerequisites) {
      if (!edges.has(pid)) {
        problems.push(`${c.id} lists unknown prerequisite: ${pid}`)
        continue
      }
      if (seen.has(pid)) {
        // Harmless to a set-based traversal and therefore invisible, which is
        // exactly why it is worth saying: it is nearly always half of a
        // copy-paste that meant to name a second, different card.
        problems.push(`${c.id} lists prerequisite ${pid} twice`)
        continue
      }
      seen.add(pid)
      kept.push(pid)
    }
    edges.set(c.id, kept)
  }

  const ids = [...edges.keys()].sort()

  // Depth-first with three marks. A grey node encountered again is a back edge,
  // so the path from that node to here is a cycle; each back edge is reported
  // once, and sorted `ids` makes which entry point finds it deterministic.
  const marks = new Map<string, Mark>()
  const path: string[] = []
  const findCycles = (id: string): void => {
    marks.set(id, 'grey')
    path.push(id)
    for (const pid of edges.get(id) ?? []) {
      const mark = marks.get(pid) ?? 'white'
      if (mark === 'grey') {
        const from = path.indexOf(pid)
        problems.push(`prerequisite cycle: ${[...path.slice(from), pid].join(' -> ')}`)
      } else if (mark === 'white') {
        findCycles(pid)
      }
    }
    path.pop()
    marks.set(id, 'black')
  }
  for (const id of ids) {
    if ((marks.get(id) ?? 'white') === 'white') findCycles(id)
  }

  const has = (id: string): boolean => edges.has(id)

  const directPrerequisitesOf = (id: string): readonly string[] => edges.get(id) ?? []

  const prerequisitesOf = (id: string): string[] => {
    if (!edges.has(id)) throw new Error(`unknown concept id: ${id}`)
    const out: string[] = []
    // `id` seeds the visited set, so it is excluded from its own prerequisites
    // and a cycle back through it terminates.
    const seen = new Set<string>([id])
    const walk = (from: string): void => {
      for (const pid of edges.get(from) ?? []) {
        if (seen.has(pid)) continue
        seen.add(pid)
        walk(pid)
        // Pushed after its own subtree, which is what puts foundations first.
        out.push(pid)
      }
    }
    walk(id)
    return out
  }

  const reachableFrom = (roots: Iterable<string>): Set<string> => {
    const out = new Set<string>()
    const stack: string[] = []
    for (const root of roots) {
      if (edges.has(root) && !out.has(root)) {
        out.add(root)
        stack.push(root)
      }
    }
    for (;;) {
      const id = stack.pop()
      if (id === undefined) break
      for (const pid of edges.get(id) ?? []) {
        if (out.has(pid)) continue
        out.add(pid)
        stack.push(pid)
      }
    }
    return out
  }

  return { ids, problems, has, directPrerequisitesOf, prerequisitesOf, reachableFrom }
}
