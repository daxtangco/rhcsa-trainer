import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ContentError } from '../content/errors.ts'
import {
  EDITION_ORDER,
  parseCorpusItems,
  parseSignal,
  type CorpusItem,
  type CorpusKind,
  type Edition,
} from './items.ts'

/**
 * Loads all five files of `corpus/` as one validated whole.
 *
 * The analogue of `content/bank.ts` for the extracted book corpus, and shaped
 * like it deliberately: every problem from every file is collected and thrown
 * once, so a bad regeneration is fixed in one edit rather than one run per file.
 *
 * What this adds over parsing the four item files independently is the
 * **cross-check against `signal.json`**. That file is written by the same
 * extractor run as the item files, from the same in-memory list, so the three
 * *must* agree; if they do not, the corpus on disk is a mix of two runs. Guided
 * mode reads the signal to decide which exercises are durable core material
 * (section 14.4.1), so a stale signal would silently mis-rank every guided item —
 * exactly the class of quiet degradation this loader exists to prevent.
 */

/**
 * Which file holds which (edition, kind). A nested record keyed by both unions,
 * rather than a list of triples, so adding an edition or a kind fails to compile
 * here instead of loading three quarters of a corpus.
 */
const ITEM_FILES: Record<Edition, Record<CorpusKind, string>> = {
  r9: { lab: join('r9', 'labs.json'), exercise: join('r9', 'exercises.json') },
  r10: { lab: join('r10', 'labs.json'), exercise: join('r10', 'exercises.json') },
}

export const SIGNAL_FILE = 'signal.json'

export interface Corpus {
  root: string
  /** Every instance from both editions: 238 today. Sorted by id, then RHCSA 9 before RHCSA 10. */
  items: CorpusItem[]
  /**
   * Slot id to its instances, primary edition first. A two-entry list is one of
   * the 112 cross-edition pairs of section 14.4.
   */
  byId: Map<string, CorpusItem[]>
  /**
   * `signal.json`, primary edition first, cross-checked against `items`. Section
   * 14.4.1's weight signal: two editions means durable core RHCSA material.
   */
  editionsById: Map<string, Edition[]>
  /**
   * Chapter to the exercise slot ids taught in it, numerically ordered. The index
   * guided selection reads: spec section 2 assigns end-of-chapter *labs* to graded
   * task prompts and *exercises* to guided walkthroughs, and an objective names
   * chapters (`content/objectives.yaml`), never exercise ids.
   */
  exerciseIdsByChapter: Map<number, string[]>
}

/** Numeric id collation, so `Exercise 9-1` precedes `Exercise 10-1`. Matches the extractor's own sort. */
function byNumericId(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Reads and parses one file, returning `undefined` and recording problems on any
 * failure. A `ContentError`'s problems are re-prefixed with its `where` so they
 * stay attributable once merged into the aggregate; anything else (a missing
 * file, a `JSON.parse` syntax error) becomes one problem naming the file, so no
 * raw error escapes `loadCorpus`. This is `bank.ts`'s `describeFailure`, inlined
 * because there are five known files here rather than a directory walk.
 */
async function loadJsonFile<T>(
  path: string,
  parse: (raw: unknown, where: string) => T,
  problems: string[],
): Promise<T | undefined> {
  try {
    return parse(JSON.parse(await readFile(path, 'utf8')), path)
  } catch (error) {
    if (error instanceof ContentError) {
      problems.push(...error.problems.map((p) => `${error.where}: ${p}`))
    } else {
      problems.push(`${path}: ${errorMessage(error)}`)
    }
    return undefined
  }
}

/**
 * Compares the editions each slot really appears in against what `signal.json`
 * claims, in both directions. Both directions matter and neither is redundant: a
 * missing entry means the signal is from an older, smaller run, and an extra
 * entry means it is from a newer or larger one, and only one of the two is
 * visible from either side alone.
 */
function checkSignal(
  items: CorpusItem[],
  signal: Map<string, Edition[]>,
  signalPath: string,
  problems: string[],
): void {
  const derived = new Map<string, Edition[]>()
  for (const item of items) {
    const list = derived.get(item.id) ?? []
    list.push(item.edition)
    derived.set(item.id, list)
  }

  for (const [id, editions] of derived) {
    const claimed = signal.get(id)
    if (claimed === undefined) {
      problems.push(`${signalPath}: no entry for ${id}, which ${editions.join(' and ')} contains`)
      continue
    }
    const want = [...editions].sort((a, b) => EDITION_ORDER[a] - EDITION_ORDER[b]).join(',')
    if (claimed.join(',') !== want) {
      problems.push(
        `${signalPath}: ${id} is recorded as [${claimed.join(', ')}] but the item files contain it in [${want.split(',').join(', ')}]`,
      )
    }
  }

  for (const id of signal.keys()) {
    if (!derived.has(id)) {
      problems.push(`${signalPath}: records ${id}, which no edition's item file contains`)
    }
  }
}

/**
 * Load `corpus/`. `root` is the directory holding `r9/`, `r10/` and
 * `signal.json`; it is passed in rather than resolved from `import.meta.url`
 * because the CLI, the server and the tests each know their own layout, matching
 * `loadBank(root)`.
 *
 * Throws one `ContentError` naming `root` and carrying every problem found. It
 * never returns a partial corpus: a caller that got a `Corpus` back has all four
 * item files and a signal that agrees with them.
 */
export async function loadCorpus(root: string): Promise<Corpus> {
  const problems: string[] = []

  // `Object.keys` on a record typed by the union is the codebase's existing way
  // of walking one (see `store/schema.ts`'s `MODE_VALUES`); the cast restores
  // what `keys` widens away.
  const editions = Object.keys(ITEM_FILES) as Edition[]
  const requests: Array<Promise<CorpusItem[] | undefined>> = []
  for (const edition of editions) {
    const kinds = Object.keys(ITEM_FILES[edition]) as CorpusKind[]
    for (const kind of kinds) {
      const path = join(root, ITEM_FILES[edition][kind])
      requests.push(
        loadJsonFile(path, (raw, where) => parseCorpusItems(raw, where, { edition, kind }), problems),
      )
    }
  }

  const signalPath = join(root, SIGNAL_FILE)
  const signalRequest = loadJsonFile(signalPath, parseSignal, problems)

  const loaded = await Promise.all(requests)
  const signal = await signalRequest

  const items = loaded.flatMap((list) => list ?? [])
  items.sort((a, b) => byNumericId(a.id, b.id) || EDITION_ORDER[a.edition] - EDITION_ORDER[b.edition])

  // Only worth comparing when every file parsed: against a partial `items` the
  // cross-check would report one "no entry for" line per item of the file that
  // failed, burying the real error under a few hundred consequences of it.
  if (signal !== undefined && loaded.every((list) => list !== undefined)) {
    checkSignal(items, signal, signalPath, problems)
  }

  if (problems.length > 0 || signal === undefined) {
    throw new ContentError(root, problems)
  }

  const byId = new Map<string, CorpusItem[]>()
  for (const item of items) {
    const list = byId.get(item.id) ?? []
    list.push(item)
    byId.set(item.id, list)
  }

  const exerciseIdsByChapter = new Map<number, string[]>()
  for (const [id, instances] of byId) {
    // Every instance of a slot shares the kind and the chapter — both are derived
    // from the id, and `parseCorpusItems` has already refused a file where they
    // disagree with it — so the first instance answers for the slot.
    const first = instances[0]
    if (first === undefined || first.kind !== 'exercise') continue
    const list = exerciseIdsByChapter.get(first.chapter) ?? []
    list.push(id)
    exerciseIdsByChapter.set(first.chapter, list)
  }
  // Already in numeric order, because `byId` was built by walking the sorted
  // `items`. Sorted again anyway so this index states its own ordering rather
  // than inheriting it from a loop twenty lines up.
  for (const list of exerciseIdsByChapter.values()) list.sort(byNumericId)

  return { root, items, byId, editionsById: signal, exerciseIdsByChapter }
}
