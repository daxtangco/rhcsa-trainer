import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface CorpusItem {
  id: string
  kind: 'lab' | 'exercise'
  chapter: number
  edition: string
  text: string
}

/** `Lab 15.1` / `Lab  15.1` — layout extraction leaves variable spacing. */
const LAB_RE = /^\s*(Lab) +(\d+)\.(\d+)\b/
/** `Exercise 15-2` */
const EX_RE = /^\s*(Exercise) +(\d+)-(\d+)\b/
/** TOC in both editions, and RHCSA 10's body: `Chapter 15.` / `Chapter 15 Title`. */
const CHAPTER_RE = /^\s*Chapter +(\d+)[.\s]/
/**
 * RHCSA 9's body: form feed, bare `Chapter 15`, blank line, then the title on
 * its own line. `\s` already covers the form feed, so `^\s*` needs nothing
 * extra. Measured to be safe: the ~87 bare `Chapter N` lines that are not
 * genuine chapter openings all sit past every real Lab/Exercise heading (in
 * the Appendix A answer-key section), so matching this pattern cannot
 * truncate a real item body early.
 */
const CHAPTER_BARE_RE = /^\s*Chapter +(\d+)\s*$/

/** Cap a body so a missed heading cannot swallow half a chapter. */
const MAX_BODY_LINES = 120

// Measured baseline (2026-08-30, against the source PDFs via pdftotext -layout):
// r9 = 30 labs / 95 exercises, r10 = 28 labs / 85 exercises,
// 28 shared labs + 84 shared exercises = 112 cross-edition items.
// Reproduced exactly on 2026-09-14 on a different poppler build, which is what
// makes these figures a property of the books and the slicing rules rather than of
// one machine: that run changed three of 360 entries and no count at all.
// (A naive `grep | sort -u` count over the raw text inflates this: pdftotext
// -layout leaves a page-break form feed on some heading lines and not others,
// so the same logical id can appear as two distinct byte strings unless the
// canonicalized capture-group id, as findItems builds it, is used to dedupe.)
// A future change to the heading/terminator regexes should land near these
// figures; a swing of ten or more means the slicing logic broke.

/** The first step of a numbered procedure: ` 1. Restart your server…`. */
const FIRST_STEP_RE = /^\s*1\.\s/
/**
 * How far into a body to look for that first step. Measured, not guessed: the
 * deepest real one in either book is `r10 Exercise 14-3`, whose step 1 sits on
 * body line 12 behind eleven lines of "you will need a spare disk" preamble.
 */
const STEP_SCAN_LINES = 14

function heading(line: string): { kind: 'lab' | 'exercise'; id: string; chapter: number } | undefined {
  const lab = LAB_RE.exec(line)
  if (lab) {
    return { kind: 'lab', id: `Lab ${lab[2]}.${lab[3]}`, chapter: Number(lab[2]) }
  }
  const ex = EX_RE.exec(line)
  if (ex) {
    return { kind: 'exercise', id: `Exercise ${ex[2]}-${ex[3]}`, chapter: Number(ex[2]) }
  }
  return undefined
}

/**
 * Does this slice open a numbered procedure? Only asked of exercises.
 *
 * Labs are exempt because for them the rule can only lose. All 58 lab slices in
 * the shipped corpus are already sliced correctly, so there is nothing for it to
 * win — and 5 of them (`Lab 1.1` in both editions among them) are written as
 * prose or bullets with no numbered step at all, while the Appendix A answer key
 * that competes with each lab for the same id is a numbered list. Applying it
 * there would demote the assignment in favour of its own solution.
 */
function opensAProcedure(item: CorpusItem): boolean {
  if (item.kind !== 'exercise') return false
  // From line 1: the heading line itself is never a step, and skipping it keeps
  // the window the same 14 lines that were measured against the corpus.
  return item.text
    .split('\n')
    .slice(1, STEP_SCAN_LINES + 1)
    .some((line) => FIRST_STEP_RE.test(line))
}

/**
 * Rank two slices of the same id against each other: does `candidate` beat
 * `incumbent`?
 *
 * Longest body is the base rule, because every id appears at least twice — once
 * in the table of contents, once at the real heading — and a contents entry is
 * one line.
 *
 * Longest body **alone** is not enough. `pdftotext -layout` hard-wraps prose, so
 * a paragraph reading *"(see\nExercise 18-2 for the exact procedure for how to do
 * that.)"* leaves a line that begins exactly like a heading, and the slice taken
 * from it then runs to the end of the chapter — comfortably longer than the real
 * exercise. That is how `r10 Exercise 18-2` came to be stored as a sentence
 * fragment plus three unrelated sections.
 *
 * The discriminator is the one the books themselves use: an *Exercise* is a
 * numbered walkthrough, so its real body has a `1.` step near the top and a
 * cross-reference sentence does not. Measured against the shipped corpus
 * (2026-09-13): 179 of the 180 exercise slices carry that step within
 * `STEP_SCAN_LINES`, and the single one that does not is this defect.
 *
 * Two things this deliberately is **not**:
 *
 * - **Not a filter.** A slice with no step is demoted, never dropped, so an id
 *   whose only slice is a contents entry still produces an item. Nothing here can
 *   move the 238-instance / 126-slot counts by losing an id.
 * - **Not a test on the title.** The two obvious title filters both destroy real
 *   content: rejecting a lowercase initial would drop `Exercise 2-5`, *"vim
 *   Practice"*, from both editions, and rejecting punctuation would drop
 *   `Exercise 13-4`, *"Changing rsyslog.conf Rules"*. This rule reads the body
 *   instead, and neither of those exercises is affected by it.
 */
function beats(candidate: CorpusItem, incumbent: CorpusItem): boolean {
  const c = opensAProcedure(candidate)
  if (c !== opensAProcedure(incumbent)) return c
  return candidate.text.length > incumbent.text.length
}

/** Slice labs and exercises out of `pdftotext -layout` output. */
export function findItems(fullText: string, edition: string): CorpusItem[] {
  const lines = fullText.split('\n')

  const starts: Array<{ index: number; kind: 'lab' | 'exercise'; id: string; chapter: number }> = []
  for (const [index, line] of lines.entries()) {
    const h = heading(line)
    if (h) starts.push({ index, ...h })
  }

  const best = new Map<string, CorpusItem>()

  for (const [i, start] of starts.entries()) {
    const nextHeading = starts[i + 1]?.index ?? lines.length
    let end = Math.min(nextHeading, start.index + 1 + MAX_BODY_LINES)

    // A chapter heading also terminates a body — either edition's dotted/spaced
    // form, or RHCSA 9's bare form-feed-prefixed form.
    for (let j = start.index + 1; j < end; j++) {
      const line = lines[j] ?? ''
      if (CHAPTER_RE.test(line) || CHAPTER_BARE_RE.test(line)) {
        end = j
        break
      }
    }

    const text = lines
      .slice(start.index, end)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    const item: CorpusItem = {
      id: start.id,
      kind: start.kind,
      chapter: start.chapter,
      edition,
      text,
    }

    const existing = best.get(start.id)
    if (!existing || beats(item, existing)) best.set(start.id, item)
  }

  return [...best.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

/** Item id to the editions containing it. Two editions means durable core material. */
export function weightSignal(items: CorpusItem[]): Record<string, string[]> {
  const byId = new Map<string, Set<string>>()
  for (const item of items) {
    const set = byId.get(item.id) ?? new Set<string>()
    set.add(item.edition)
    byId.set(item.id, set)
  }
  const out: Record<string, string[]> = {}
  for (const [id, editions] of [...byId.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], 'en', { numeric: true }),
  )) {
    out[id] = [...editions].sort()
  }
  return out
}

async function extract(pdf: string): Promise<string> {
  // pdftotext is the rootless poppler wrapper in ~/.local/bin, and it is not
  // installed - it is unpacked, because this host's sudo needs an interactive
  // password. Rebuild it (it went missing once already, with a WSL distro rebuild
  // that did not carry ~/.local) with:
  //
  //   dnf download --resolve poppler-utils     # unprivileged; pulls 30 RPMs with deps
  //   for r in *.rpm; do rpm2archive "$r"; done  # rpm2archive: this host has no cpio
  //   cd ~/.local/poppler && for t in .../*.rpm.tgz; do tar xzf "$t"; done
  //
  // then a wrapper on PATH exporting LD_LIBRARY_PATH=~/.local/poppler/usr/lib64.
  // Use the poppler RHEL 9 ships (21.01.0) and not a newer one: `-layout` column
  // spacing differs between versions, which changes the artifact without changing
  // any count. That is exactly what the 2026-09-14 regeneration saw - two entries
  // differed only in intra-line whitespace, where 21.01.0 preserves column gaps a
  // newer poppler had collapsed.
  const { stdout } = await run('pdftotext', ['-layout', pdf, '-'], {
    maxBuffer: 256 * 1024 * 1024,
  })
  return stdout
}

async function main(): Promise<number> {
  const editions = [
    {
      tag: 'r9',
      pdf: '/mnt/c/Users/DaxAxisTangco/Downloads/(REFERENCE) Red Hat RHCSA 9 Cert Guide EX200.pdf',
    },
    {
      tag: 'r10',
      pdf: '/mnt/c/Users/DaxAxisTangco/Downloads/Red_Hat_RHCSA_10_Cert_Guide_EX200_ER_-_Sander_van_Vugt.pdf',
    },
  ]

  const all: CorpusItem[] = []

  for (const edition of editions) {
    const text = await extract(edition.pdf)
    const items = findItems(text, edition.tag)
    all.push(...items)

    const dir = join('corpus', edition.tag)
    await mkdir(dir, { recursive: true })

    const labs = items.filter((i) => i.kind === 'lab')
    const exercises = items.filter((i) => i.kind === 'exercise')
    await writeFile(join(dir, 'labs.json'), `${JSON.stringify(labs, null, 2)}\n`)
    await writeFile(join(dir, 'exercises.json'), `${JSON.stringify(exercises, null, 2)}\n`)

    process.stdout.write(`${edition.tag}: ${labs.length} labs, ${exercises.length} exercises\n`)
  }

  const signal = weightSignal(all)
  await writeFile('corpus/signal.json', `${JSON.stringify(signal, null, 2)}\n`)

  const both = Object.values(signal).filter((e) => e.length === 2).length
  process.stdout.write(`cross-edition items (durable core): ${both}\n`)
  return 0
}

// Only run when invoked directly, so importing this module in tests is inert.
// Built with pathToFileURL rather than a hand-built `file://` string, matching
// src/cli/index.ts.
const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exit(await main())
}
