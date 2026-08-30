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
// (A naive `grep | sort -u` count over the raw text inflates this: pdftotext
// -layout leaves a page-break form feed on some heading lines and not others,
// so the same logical id can appear as two distinct byte strings unless the
// canonicalized capture-group id, as findItems builds it, is used to dedupe.)
// A future change to the heading/terminator regexes should land near these
// figures; a swing of ten or more means the slicing logic broke.

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
 * Slice labs and exercises out of `pdftotext -layout` output.
 *
 * Every id appears at least twice — once in the table of contents, once at the
 * real heading — so the longest body wins. A contents entry is one line and
 * always loses.
 */
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
    if (!existing || item.text.length > existing.text.length) best.set(start.id, item)
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
  // pdftotext is the rootless poppler wrapper in ~/.local/bin.
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
