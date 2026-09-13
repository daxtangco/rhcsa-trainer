import { ContentError } from '../content/errors.ts'
import { headingTitle, type CorpusItem, type Edition } from '../corpus/items.ts'
import type { Corpus } from '../corpus/corpus.ts'
import type { Objective, ObjectiveSet } from '../content/objectives.ts'
import type { TaskSpec } from '../content/task.ts'
import {
  parseGuidedSteps,
  parsePreamble,
  titleContinuation,
  type GuidedStep,
} from './steps.ts'

/**
 * Which guided walkthroughs a study session presents, given an objective or a
 * task.
 *
 * ## What "guided" means here, and the sentence that decided it
 *
 * Guided mode is **not** a rung of the disclosure ladder and not a gentler
 * `practice`. `disclosure/ladder.ts` already says why it cannot be one — *"guided
 * mode is deliberately not a LadderMode: it is full disclosure by construction
 * (spec section 7), so representing a ladder there is meaningless"* — but that
 * settles only what guided is not. Three sentences of the spec settle what it is,
 * and each one decides a different part of this module:
 *
 * 1. **Where the material comes from.** Section 2's corpus role table assigns
 *    end-of-chapter *labs* to graded task prompts and *exercises* to guided
 *    walkthroughs. So this module reads **exercises only**, and both
 *    `test/guided/select.test.ts` and `test/guided/corpus-real.test.ts` assert a
 *    lab is never selected. That is also why `Corpus` indexes
 *    `exerciseIdsByChapter` and not labs by chapter: the two kinds are not
 *    interchangeable content of different lengths, they are inputs to two
 *    different features.
 *
 *    The check is load-bearing, not defensive. Measured 2026-09-13: 52 of the 58
 *    lab instances parse into numbered steps, because a lab body *is* a numbered
 *    list — of **requirements to be graded**, not commands to type: *"Modify your
 *    shell environment so that on every subshell that is started…"*, *"Describe
 *    two ways to show line 5 from /etc/passwd"*. Nothing downstream of the `kind`
 *    check could tell those from an exercise's keystrokes, so without it guided
 *    mode would hand the student 30 more walkthroughs whose steps cannot be typed
 *    and whose answers are the point of the graded lab days later.
 * 2. **What the student does.** Section 9.1: *"The app shows a command, the user
 *    types it (typing, not clicking — muscle memory is the point), and each step
 *    is verified before advancing."* So a guided item is an **ordered step list**,
 *    not a body of prose with a solution attached, and `steps.ts` — not this file
 *    — carries the consequences of that.
 * 3. **When it happens.** Section 9.1 again: guided is first contact with an
 *    objective, and the graded lab for the same material comes days later through
 *    `drill`. That is why nothing here consults `LadderState`, `MAX_RUNG` or a
 *    scheduler: at first contact there is nothing withheld and nothing due.
 *
 * The practical difference from `practice`, in one line: in `practice` the student
 * is asked to produce an end state and may climb a hint ladder toward the answer;
 * in `guided` the answer is on screen from the first keystroke and the only thing
 * asked of them is that they type it themselves.
 *
 * ## Selection keys on the objective's chapters, not the task's
 *
 * An objective in `content/objectives.yaml` names `chapters: [n, …]`; a corpus
 * exercise id names exactly one chapter. That is the whole join, and it is the
 * only one available — nothing in either corpus file mentions an objective id.
 *
 * A `TaskSpec` also has a `chapter`, and using *that* would be wrong. Measured
 * against the bank on 2026-09-13: `troubleshooting/028-restore-remote-access`
 * declares `chapter: 26`, the containers chapter, while its four objectives
 * (`net.services.status`, `net.firewall.settings`, `net.services.autostart`,
 * `systemd.services.enable`) map to chapters 8, 23 and 11. Keying on
 * `task.chapter` would have offered that student the nine container exercises of
 * chapter 26 to prepare for a task about services and firewalling; keying on the
 * objectives offers the seven exercises of chapters 8, 11 and 23. So
 * `guidedForTask` resolves the task's objective ids and unions *their* chapters,
 * and `task.chapter` is not read anywhere in this file.
 */

/** RHCSA 9 is primary (spec section 2). Overridable, because RHCSA 10 is the newer exam. */
const DEFAULT_PRIMARY: Edition = 'r9'

export interface GuidedOptions {
  /**
   * The edition whose wording the student is shown when a slot exists in both.
   * Defaults to `r9`.
   */
  primary?: Edition
}

/** One edition's rendering of an exercise: what the student reads and types. */
export interface GuidedText {
  edition: Edition
  /**
   * The exercise's own title, from its heading line: *"Creating a Physical
   * Volume"*, with a wrapped second line rejoined (see `titleContinuation`).
   *
   * **Per edition, not per slot, because the two books do not agree.** Measured
   * 2026-09-13 across the 84 cross-edition exercise slots: 78 titles are identical
   * once the RHCSA 10 layout wrap is repaired; 1 is a genuine retitling
   * (`Exercise 14-3`, *"Creating GPT Partitions with gdisk"* in RHCSA 9,
   * *"Creating GPT Partitions"* in RHCSA 10); 4 are chapter 13, where RHCSA 10
   * renumbered the exercises, so `Exercise 13-1` is *"Using Live Log Monitoring
   * and logger"* in one book and *"Discovering journalctl"* in the other; and 1 is
   * a corpus defect described under `alternate`. Showing the alternate's own title
   * is what makes those six visible to the student instead of mislabelled.
   */
  title: string
  /**
   * Prose between the heading and step 1, usually a precondition. Empty for most
   * exercises — measured 2026-09-13, 37 of 180 instances have one. Carried rather
   * than dropped because *"you need a hard disk that has free (unpartitioned) disk
   * space"* is not optional context: a student who skips it runs step 1 against
   * the wrong device.
   */
  preamble: string
  /** The steps, in book order. Never empty: see `guidedItem`. */
  steps: GuidedStep[]
}

export interface GuidedItem {
  /** The corpus slot id, e.g. `Exercise 15-2`. Stable across editions — the section 14.4 pairing key. */
  id: string
  /** The chapter both editions agree the exercise belongs to. */
  chapter: number
  /** Every edition containing this slot, primary first. From `signal.json`. */
  editions: Edition[]
  /**
   * `editions.length > 1`: the exercise survived a revision of the book. Spec
   * section 14.4.1: *"Content in both editions is durable core RHCSA material;
   * content in one is version-specific."*
   *
   * **Exposed as a flag, not folded into a weight, and that is deliberate.** The
   * same paragraph says the signal is *"used to seed `weight`"*, and a helper
   * mapping `crossEdition → weight` would be one line. It would also be
   * measurably wrong for this bank: the two `editions: [r9]` container tasks are
   * authored `weight: high` (`containers/030-container-web-service`) and
   * `weight: medium` (`containers/031-build-and-inspect-image`) by a human who
   * knew the exam, so "one edition therefore low" would have contradicted both.
   * The signal is real and the inference from it is a judgement call, so this
   * module publishes the signal and leaves the call to the caller.
   */
  crossEdition: boolean
  /** The edition being walked through: `primary` when present, otherwise the only one there is. */
  shown: GuidedText
  /**
   * The other edition's rendering, when the slot is cross-edition.
   *
   * Spec section 14.4.2: *"The other edition's exercise becomes an additional
   * `solutions/` file… Second paths become authoritative transcriptions rather than
   * inventions"*, and section 2's role table gives the 180 guided exercise
   * instances both jobs at once — *"Guided-mode walkthroughs **and** `solutions/`
   * sources"*. Carrying the alternate here is what makes the second job reachable
   * from the guided path.
   *
   * It is a sibling field rather than a merge because the two are not
   * variants of one text — the step counts differ, the numbering differs, and in
   * chapter 13 the exercises were renumbered outright. Interleaving them would
   * produce a walkthrough neither book prints and no exam matches. Shown side by
   * side, they teach the student which parts of the procedure are the exam and
   * which are the edition.
   *
   * **One known bad alternate, which is a corpus defect and not this module's to
   * hide.** RHCSA 10's `Exercise 18-2` body was sliced by the extractor from a
   * prose cross-reference — the chapter says *"(see Exercise 18-2 for the exact
   * procedure…)"* and that line won the longest-body dedupe — so the instance
   * carries the chapter's root-password-reset prose, titled *"for the exact
   * procedure for how to do that.) After mounting"*. It parses into 7 real steps
   * of real RHCSA work, so it is not garbage; it is misattributed. It is left in
   * rather than filtered, because every filter that removes it also removes
   * legitimate titles — a lowercase-initial test would drop `Exercise 2-5`,
   * *"vim Practice"*, in both editions. `test/corpus/corpus-real.test.ts` pins the
   * count of suspect titles at exactly 1 so the defect stays visible and a fix to
   * `scripts/extract-corpus.ts` shows up as a failing count rather than as
   * nothing. RHCSA 9's `Exercise 18-2` is intact, so with the default
   * `primary: 'r9'` the student is shown the good one and this is only the
   * alternate.
   */
  alternate?: GuidedText
}

/**
 * Builds one edition's `GuidedText`. Returns `undefined` when the item parses to
 * zero steps.
 *
 * Zero steps means the extractor's dedupe kept a table-of-contents line instead of
 * the body — a one-line "item" with a title and no list. `parseCorpusItems` cannot
 * catch that (the line has a title, like every real exercise heading), so this is
 * where it surfaces. Measured 2026-09-13: 0 of the corpus's 180 exercise instances
 * are in that state, and `test/guided/corpus-real.test.ts` pins that at 0 so a
 * regeneration that reintroduces one fails the suite rather than shipping a guided
 * item with nothing to type.
 */
function guidedText(item: CorpusItem): GuidedText | undefined {
  const steps = parseGuidedSteps(item.text)
  if (steps.length === 0) return undefined
  const continuation = titleContinuation(item.text)
  const title = headingTitle(item.id, item.text)
  return {
    edition: item.edition,
    title: continuation === undefined ? title : `${title} ${continuation}`,
    preamble: parsePreamble(item.text),
    steps,
  }
}

/**
 * The guided walkthrough for one corpus slot, or `undefined` when the slot cannot
 * be walked through.
 *
 * `undefined` — rather than a throw — for four distinct cases, all of which mean
 * "this is not guided material" rather than "the corpus is broken":
 *
 * - the id is not in the corpus at all;
 * - it is a **lab**, which is graded-task material (see this file's header);
 * - no instance of it parses into steps;
 * - `signal.json` has no entry for it, which `loadCorpus` has already made
 *   impossible for a loaded `Corpus` and is re-checked here rather than asserted,
 *   because a caller can hand-build a `Corpus` in a test.
 *
 * Selection over a chapter's worth of ids must be able to skip an unusable slot
 * and still offer the rest; a throw would take the whole objective down with it.
 * The one case that *is* loud is the empty result at the objective level, below.
 */
export function guidedItem(
  corpus: Corpus,
  id: string,
  opts: GuidedOptions = {},
): GuidedItem | undefined {
  const primary = opts.primary ?? DEFAULT_PRIMARY
  const instances = corpus.byId.get(id)
  const first = instances?.[0]
  if (instances === undefined || first === undefined || first.kind !== 'exercise') return undefined

  const editions = corpus.editionsById.get(id)
  if (editions === undefined || editions.length === 0) return undefined

  // `byId`'s lists are primary-first by `EDITION_ORDER`, which is reading order,
  // not this call's `primary`. So pick by edition rather than by position: with
  // `primary: 'r10'` the first entry of a paired slot is the *alternate*.
  const preferred = instances.find((i) => i.edition === primary)
  const others = instances.filter((i) => i !== preferred)

  const shown = preferred === undefined ? undefined : guidedText(preferred)
  const alternates = others.map(guidedText).filter((t): t is GuidedText => t !== undefined)

  // A slot whose primary instance has no parseable steps still has something to
  // teach if the other edition does, so the alternate is promoted rather than the
  // item dropped. This does not fire against today's corpus (all 180 instances
  // parse), and exists because the guided path must degrade to less material and
  // never to a blank screen.
  const chosen = shown ?? alternates[0]
  if (chosen === undefined) return undefined
  const rest = shown === undefined ? alternates.slice(1) : alternates

  const item: GuidedItem = {
    id,
    chapter: first.chapter,
    editions,
    crossEdition: editions.length > 1,
    shown: chosen,
  }
  // Exactly one alternate today, since there are two editions; written as
  // "the first, if any" so a third edition degrades to dropping one rather than
  // to a type error.
  const alternate = rest[0]
  if (alternate !== undefined) item.alternate = alternate
  return item
}

/**
 * Ordering within an objective, and the reason it is not just numeric.
 *
 * Three groups, in this order:
 *
 * 1. **cross-edition** — in both books, so section 14.4.1's durable core;
 * 2. **primary-only** — in the exam edition the student is sitting;
 * 3. **other-edition-only** — real material, but for the other exam version.
 *
 * A student who works the list top-down therefore meets the material that is most
 * likely to be on their exam first, and the edition-specific tail last. Within a
 * group, numeric id order, which is the order the book prints them in — a chapter
 * builds: `Exercise 15-1` creates the volume group that `Exercise 15-2` extends,
 * so presenting 15-2 first would ask the student to extend something that does not
 * exist yet.
 *
 * Measured 2026-09-13 over the real corpus: of 96 exercise slots, 84 are
 * cross-edition, 11 are RHCSA 9 only (`Exercise 2-8`, `Exercise 15-5`, and all
 * nine of chapter 26's, which is the containers chapter RHCSA 10 rebuilt) and 1 is
 * RHCSA 10 only (`Exercise 9-4`, *"Managing Flatpak Applications"*). So with the
 * default `primary: 'r9'` group 1 holds seven eighths of the corpus and group 3
 * holds exactly one item.
 */
function groupRank(item: GuidedItem, primary: Edition): number {
  if (item.crossEdition) return 0
  return item.editions.includes(primary) ? 1 : 2
}

function orderGuided(items: GuidedItem[], primary: Edition): GuidedItem[] {
  return [...items].sort(
    (a, b) =>
      groupRank(a, primary) - groupRank(b, primary) ||
      a.id.localeCompare(b.id, 'en', { numeric: true }),
  )
}

/**
 * Every guided walkthrough for an objective, in presentation order.
 *
 * Every exercise of every chapter the objective names is a candidate, and there is
 * no finer filter available: the corpus carries no objective ids, and inventing a
 * keyword match between an objective's `text` and an exercise's title would be a
 * heuristic that silently drops material — the failure mode the whole corpus layer
 * is built to refuse. Over-offering is recoverable by a student who reads a title
 * and skips; under-offering is invisible to them. Measured 2026-09-13, the 68
 * objectives resolve to between 1 and 9 guided items each, median 4, which is a
 * chapter's worth and small enough to read.
 *
 * `chapters` is unioned rather than indexed at `[0]` because the schema is a list
 * (`content/objectives.ts` validates *"integers 1-28, at least one"*). Measured:
 * all 68 objectives name exactly **one** chapter today, so the union is currently
 * always a single chapter and the `seen` guard below never fires against the real
 * bank. The loop is written for the list anyway — the schema is what the next
 * author will write against, and an objective spanning chapters 14 and 15 is a
 * legitimate thing for them to write.
 *
 * An empty array is a real answer for an objective whose chapters the book teaches
 * without exercises, so it is returned rather than thrown. Measured 2026-09-13:
 * this does not happen — all 68 objectives resolve to at least one guided item,
 * and `test/guided/corpus-real.test.ts` asserts the gap count is 0, which is the
 * assertion that would catch a regeneration that lost a chapter. It is close to
 * happening: chapters 1, 27 and 28 have no exercises in either edition, so an
 * objective added for any of them would land in that empty case.
 */
export function guidedForObjective(
  corpus: Corpus,
  objective: Objective,
  opts: GuidedOptions = {},
): GuidedItem[] {
  const primary = opts.primary ?? DEFAULT_PRIMARY
  const items: GuidedItem[] = []
  const seen = new Set<string>()

  for (const chapter of objective.chapters) {
    for (const id of corpus.exerciseIdsByChapter.get(chapter) ?? []) {
      // Two chapters of one objective cannot share an exercise id (the id names
      // its chapter), but `chapters` may itself repeat a number, and the guard is
      // cheaper than trusting that it does not.
      if (seen.has(id)) continue
      seen.add(id)
      const item = guidedItem(corpus, id, opts)
      if (item !== undefined) items.push(item)
    }
  }

  return orderGuided(items, primary)
}

/**
 * Every guided walkthrough that prepares a student for one graded task.
 *
 * The task's objective ids are resolved through `objectiveSet` and their chapters
 * unioned; see this file's header for why `task.chapter` is not consulted.
 *
 * An unknown objective id **throws**, aggregating every unknown id in the task
 * rather than reporting the first. It is the one loud failure in this module, and
 * the asymmetry with `guidedItem`'s `undefined` is the point: a missing corpus
 * slot means the book did not print an exercise, whereas an objective id no
 * taxonomy defines means the task file is wrong. `checkCoverage` already reports
 * it as *"maps to unknown objective"*, so a bank reaching this code has skipped
 * `npm run validate`; silently returning the guided items for the ids that *did*
 * resolve would hide that behind a plausible-looking, short list.
 */
export function guidedForTask(
  corpus: Corpus,
  task: TaskSpec,
  objectiveSet: ObjectiveSet,
  opts: GuidedOptions = {},
): GuidedItem[] {
  const primary = opts.primary ?? DEFAULT_PRIMARY
  const problems: string[] = []
  const chapters: number[] = []

  for (const id of task.objectives) {
    const objective = objectiveSet.byId.get(id)
    if (objective === undefined) {
      problems.push(`maps to unknown objective: ${id}`)
      continue
    }
    chapters.push(...objective.chapters)
  }

  if (problems.length > 0) throw new ContentError(task.id, problems)

  // Reuses the objective path rather than duplicating the chapter walk, by
  // building the union as one synthetic objective. `id` and `text` are the task's
  // so that anything logging this value names the real source.
  return guidedForObjective(
    corpus,
    { id: task.id, text: task.title, chapters },
    { ...opts, primary },
  )
}
