/**
 * Turns one extracted exercise body into the ordered steps guided mode walks the
 * student through.
 *
 * Spec section 9.1 defines guided mode as: *"Sourced from the 180 guided exercise
 * instances across both editions. The app shows a command, **the user types it**
 * (typing, not clicking — muscle memory is the point), and each step is verified
 * before advancing."* That sentence is the whole contract of this file. It needs
 * three things out of a body that `pdftotext -layout` produced: the steps, in
 * order; the command each step tells the student to type; and a way to tell
 * whether what they typed was it.
 *
 * **What the source actually looks like, and why none of this is a parser.** The
 * two editions hard-wrap their numbered lists at different indents and different
 * column widths, break tokens across lines with a hyphen, sprinkle page-break
 * form feeds mid-list, and lose every scrap of typography — the book's monospace
 * run around a command is, in the extracted text, indistinguishable from the
 * English around it. So a step's command cannot be *read*; it can only be
 * *guessed from the imperative phrasing*, and this file says so at every point
 * where that matters. The step's prose is the authoritative artifact and is always
 * what the student is shown; a command candidate is an affordance on top of it.
 */

/**
 * A step start: a small integer, a period, and text. Indentation is captured
 * rather than bounded because the two editions disagree about it — RHCSA 9 writes
 * `` 1. `` at column 1 and `10.` at column 0, RHCSA 10 writes `1.` at column 8
 * and `10.` at column 7 — and the continuation rule below needs the step's own
 * indent anyway.
 */
const STEP_START = /^([ \t]*)(\d{1,2})\.[ \t]+(\S.*)$/

/**
 * Pearson's e-book link text, which `pdftotext` renders as a line of its own
 * wherever the print edition had a code listing. It is never content.
 *
 * Measured 2026-09-13 across the 180 exercise instances: 90 occurrences, every one
 * of them a line by itself and none embedded in a longer line, which is why
 * filtering whole lines is sufficient and no substring replacement is needed.
 * Before the filter it was absorbed as a continuation line and read as part of a
 * step: *"Type file etc.tar and read the information … This should look like the
 * following: Click here to view code image"*.
 */
const CODE_IMAGE_LINK = 'Click here to view code image'

export interface GuidedStep {
  /** 1-based, contiguous, and equal to the number printed in the book. */
  n: number
  /** The step's prose, hard wraps undone. Authoritative: this is what the student reads. */
  text: string
  /**
   * Command candidates extracted from `text`, in the order they appear, deduped.
   *
   * A **hint, not a specification** — see `commandCandidates`. An empty list does
   * not mean the step has no command; it means none was recognisable, which for a
   * quarter of the corpus's steps is simply true because the step is prose
   * (*"Open a root shell."*, *"Which command schedules a cron job for user
   * lisa?"*). A guided session gates advancement on typing only when this list is
   * non-empty; see `typedStepMatches`.
   */
  commands: string[]
}

/**
 * Undoes the source's hard wrapping within a paragraph, keeping paragraph breaks.
 *
 * **The hyphen rule is measured, not assumed.** A fragment ending in `-` is
 * joined to the next with no space at all. Across the 180 exercise instances this
 * function appends a continuation fragment to an existing one 1984 times, of which
 * 29 follow a fragment ending in a hyphen; all 29 were read individually
 * (2026-09-13) and every one is a token broken across the line, never a trailing
 * argument: `dnf config-` + `manager`, `firewall-cmd --add-` + `service`, `--` +
 * `permanent`, `tail -` + `n 20`, `a 1-` + `GiB partition`, `mariadb-` + `105`,
 * `cp /etc/[a-` + `c]*`, and one ordinary hyphenated English word, `re-` +
 * `create`. Joining those with a space produces `firewall-cmd --add- service`,
 * which is a command the student would type wrong.
 *
 * Nothing in the corpus is broken by the rule today. A future extraction where a
 * step legitimately ends its line on a bare `-v` would be, and the mitigation is
 * that `test/guided/steps.test.ts` pins the rule both ways round, so the
 * behaviour is at least visible when the corpus changes under it.
 */
function joinWrapped(lines: string[]): string {
  const paragraphs: string[] = []
  let current = ''

  for (const line of lines) {
    if (line.trim() === '') {
      if (current !== '') paragraphs.push(current)
      current = ''
      continue
    }
    const fragment = line.trim()
    if (current === '') {
      current = fragment
    } else if (current.endsWith('-')) {
      current += fragment
    } else {
      current += ` ${fragment}`
    }
  }
  if (current !== '') paragraphs.push(current)

  return paragraphs.join('\n\n')
}

/** Form feeds and the e-book link line, neither of which is content. */
function usableLines(text: string): string[] {
  return text
    .replace(/\f/g, '')
    .split('\n')
    .filter((line) => line.trim() !== CODE_IMAGE_LINK)
}

/**
 * Pearson's sidebar labels, which `pdftotext` renders as a short line of their
 * own. Needed only by `titleContinuation` below, to tell one apart from a wrapped
 * title.
 *
 * Measured 2026-09-13 as standalone lines across the 180 exercise instances:
 * `Tip` 48, `Note` 25, `Exam Tip` 4, `Warning` 4, `NOTE` 1. `Caution` is listed
 * because the book uses it elsewhere; it happens not to occur inside an exercise
 * body today, and listing it costs nothing.
 */
const SIDEBAR_LABELS = new Set(['Note', 'NOTE', 'Tip', 'Exam Tip', 'Caution', 'Warning'])

/**
 * The longest a wrapped title fragment is allowed to be. The 13 real ones run from
 * `Line` (4) to `Public/Private Keys` (19); the shortest *preamble* first line in
 * the corpus that the other tests here do not already exclude is 65 characters
 * (`Exercise 14-3`'s *"To apply the procedure in this exercise, you need an unused
 * disk"*). 30 sits in that gap with room on both sides.
 */
const MAX_TITLE_CONTINUATION = 30

/**
 * The rest of the title, when the heading wrapped onto a second line.
 *
 * **Why this exists.** RHCSA 10 sets its body text in a narrower measure than
 * RHCSA 9, so long exercise titles wrap, and `pdftotext -layout` gives the
 * wrapped part back as an ordinary line. Without this, `Exercise 15-2` is titled
 * *"Creating the Volume Group and Logical"* and its preamble opens *"Volumes In
 * Exercise 15-1, you created a physical volume…"* — a truncated title and a
 * corrupted first sentence, both on screen, in the mode whose whole job is to be
 * the book.
 *
 * **Why it is a heuristic and how far it was checked.** A wrapped title and a
 * short preamble line are the same thing to the extractor, so this asks four
 * questions of the line after the heading: it must be non-blank (a blank line ends
 * the heading), not a numbered step, at most `MAX_TITLE_CONTINUATION` characters,
 * not end in sentence punctuation, and not be a `SIDEBAR_LABELS` member.
 *
 * Measured 2026-09-13 over all 238 items. Without the `SIDEBAR_LABELS` test the
 * rule fires 14 times; with it, 13, and every one of the 13 is an RHCSA 10
 * exercise, which is what the narrower measure predicts and is itself evidence the
 * rule is finding the real phenomenon rather than a coincidence of line lengths.
 * All 13 are correct, and each can be checked against a second source, because
 * RHCSA 9 prints the same exercise with the title untruncated: `Managing Network
 * Connections with` + `nmcli`, `Working from Several Terminal Windows` +
 * `Simultaneously`, `Setting a Context Label on a Nondefault` + `Apache
 * DocumentRoot`, and ten more. After the repair, 78 of the 84 cross-edition
 * exercise slots have identical titles in both books, against 65 before it.
 *
 * The 14th firing is what `SIDEBAR_LABELS` exists for: `Exercise 3-3`'s heading is
 * followed by a `Note` box, and without the exclusion its title became *"Working
 * with Files Note"*. With the exclusion the rule has no false positives anywhere
 * in the corpus, and it fires on 0 of the 58 lab instances, which have no titles
 * to wrap.
 *
 * The fragment is joined with a space, not by `joinWrapped`'s hyphen rule: no
 * title in the corpus wraps mid-token. A future one that does would render with a
 * stray space, which is a cosmetic defect in a title rather than a wrong command,
 * so the simpler join is the right trade here.
 */
export function titleContinuation(text: string): string | undefined {
  const line = usableLines(text)[1]
  if (line === undefined) return undefined
  const fragment = line.trim()
  if (fragment === '') return undefined
  if (STEP_START.test(line)) return undefined
  if (fragment.length > MAX_TITLE_CONTINUATION) return undefined
  if (/[.,:;?!]$/.test(fragment)) return undefined
  if (SIDEBAR_LABELS.has(fragment)) return undefined
  return fragment
}

/**
 * The prose between an exercise's heading and its first numbered step.
 *
 * Often the step list's precondition — *"To do this exercise, you need a hard disk
 * that has free (unpartitioned) disk space available"* — so it is carried on the
 * guided item rather than dropped: a student who starts typing step 1 without it
 * runs the exercise against the wrong device.
 *
 * Measured 2026-09-13: 37 of the 180 exercise instances have one (19 in RHCSA 9,
 * 18 in RHCSA 10). The other 143 go straight from the heading to step 1. Before
 * `titleContinuation` was subtracted the count was 47, and all 10 of the
 * difference were exercises whose entire "preamble" was the wrapped remainder of
 * their own title.
 */
export function parsePreamble(text: string): string {
  const lines = usableLines(text)
  const body: string[] = []
  let expect = 1
  // A wrapped title belongs to the title, so the line it occupies is skipped
  // rather than read as the preamble's opening words.
  const skip = titleContinuation(text) === undefined ? 0 : 1

  for (const [i, line] of lines.entries()) {
    // The heading line is the item's title, not preamble; `parseCorpusItems`
    // guarantees the body starts with it.
    if (i <= skip) continue
    const m = STEP_START.exec(line)
    if (m && Number(m[2]) === expect) break
    body.push(line)
  }

  return joinWrapped(body)
}

/**
 * The exercise's numbered steps, in order.
 *
 * Two rules do all the work, and both exist because a body's *end* is unreliable:
 * `findItems` slices until the next heading or 120 lines, so a body routinely
 * carries the chapter prose, code listings and `Example N-M` blocks that followed
 * the exercise in print.
 *
 * 1. **Contiguous numbering from 1.** A `N.` line is a step only when `N` is
 *    exactly the next number expected. This is what ends the list, and it ends it
 *    on the one thing that reliably marks the end: RHCSA 9's `Exercise 6-1` body
 *    runs on into the chapter's `sudo` section, which contains its own two-item
 *    numbered list — a `1.` where a `7.` was expected, so the list stops there
 *    rather than gaining two steps about `visudo` that the exercise never
 *    mentioned.
 * 2. **A continuation line is more indented than its step's number.** Both
 *    editions indent wrapped step text past the number (RHCSA 9: number at 0-1,
 *    text at 4; RHCSA 10: number at 7-8, text at 10-11), and a blank line or a
 *    line at or left of the number ends the step. This is what keeps the
 *    `Example 15-2` heading and the `[root@server1 ~]#` transcript that follows
 *    the last step out of that step's text: both sit at column 0-3, left of the
 *    number in RHCSA 10 and at it in RHCSA 9.
 *
 *    The indent half of that rule carries real weight and not just the blank-line
 *    half. Measured 2026-09-13 over the 180 exercise instances: 247 step endings
 *    are decided by a blank line and **21 by the indent test on a non-blank
 *    line**, and those 21 are the chapter resuming immediately under the last step
 *    — *"Editing Files with vim"*, *"Summary"*, *"End-of-Chapter Lab"*, a `Tip`
 *    box. Without the indent test each of those 21 steps would end with a section
 *    heading and the paragraph after it glued onto its prose.
 *
 * Measured 2026-09-14 over all 180 exercise instances: every one yields at least
 * one step, 1405 steps in total, from 1 to 16 per exercise with a median of 8. The
 * per-edition split is 95 RHCSA 9 instances and 85 RHCSA 10 instances, matching
 * spec section 2's stated 180.
 */
export function parseGuidedSteps(text: string): GuidedStep[] {
  const lines = usableLines(text)

  const collected: Array<{ n: number; lines: string[] }> = []
  let expect = 1
  let current: { n: number; lines: string[] } | undefined
  let currentIndent = 0

  for (const line of lines) {
    const m = STEP_START.exec(line)
    if (m && Number(m[2]) === expect) {
      if (current) collected.push(current)
      currentIndent = (m[1] ?? '').length
      current = { n: expect, lines: [m[3] ?? ''] }
      expect += 1
      continue
    }

    if (current === undefined) continue

    const indent = line.length - line.trimStart().length
    if (line.trim() === '' || indent <= currentIndent) {
      collected.push(current)
      current = undefined
      continue
    }
    current.lines.push(line)
  }
  if (current) collected.push(current)

  return collected.map((step) => {
    const text = joinWrapped(step.lines)
    return { n: step.n, text, commands: commandCandidates(text) }
  })
}

/**
 * The imperatives the two editions use to tell the student to type something.
 * Global and case-insensitive: one step often issues two commands (*"Type exit to
 * go back to a root shell, and next use su - laura to switch identity"*).
 */
const IMPERATIVE = /\b(?:type|run|use|enter)\s+/gi

/**
 * Words that end a command because they are English, not shell.
 *
 * The list is closed and short on purpose. It contains only words that are never
 * a command name and never an argument in this corpus: clause openers (`to`,
 * `and`, `that`, `when`), the nouns the book uses when it talks *about* typing
 * (`command`, `option`, `password`, `user`), and comparatives (`following`,
 * `same`, `above`). The four imperatives of `IMPERATIVE` are deliberately **not**
 * here: `run` and `use` are subcommands (`podman run`, `dnf list`), and the
 * clause words that precede a second imperative — *"and then type"*, *"and use"*,
 * *". Type"* — already stop the first extraction before it reaches the verb.
 */
const CLAUSE_WORDS = new Set([
  'to',
  'and',
  'that',
  'which',
  'when',
  'if',
  'as',
  'for',
  'in',
  'from',
  'so',
  'then',
  'again',
  'this',
  'these',
  'those',
  'the',
  'a',
  'an',
  'see',
  'notice',
  'verify',
  'read',
  'with',
  'but',
  'or',
  'at',
  'on',
  'of',
  'it',
  'you',
  'your',
  'command',
  'commands',
  'option',
  'options',
  'instead',
  'while',
  'after',
  'before',
  'because',
  'until',
  'following',
  'same',
  'similar',
  'above',
  'below',
  'contents',
  'user',
  'users',
])

/**
 * A first token that could be a command name or a path to one. Lowercase-leading:
 * a capitalised word is prose (*"Press Enter to accept"* must not yield `Enter`).
 */
const COMMAND_HEAD = /^[a-z0-9_/.:+-][A-Za-z0-9_/.+=-]*$/

/**
 * Best-effort commands a step tells the student to type.
 *
 * **This is a hint, not a specification, and the honest description of its
 * accuracy is below.** The extracted corpus has no typography: `Type pvcreate
 * /dev/sdd1 to mark the new partition` is one undifferentiated string, so where
 * the command ends can only be guessed from the English around it. The guess is:
 * start after an imperative, drop an article, and take words until one of them is
 * a `CLAUSE_WORDS` member, opens a parenthetical, or ends a sentence.
 *
 * Measured 2026-09-14 against the real corpus: of the 1405 parsed steps, 1058
 * (75.3%) yield at least one candidate, 1271 candidates in total.
 *
 * A hand audit of a deterministic 43-step sample — every 33rd step of the corpus,
 * starting at index 17, which crosses both editions and 40 different exercises —
 * classified each step, not each candidate. The audit was done on 2026-09-13,
 * against the corpus as it stood before `r10 Exercise 18-2` was regenerated, and it
 * is left as measured: that entry's first step is at flattened index 1014, so 31 of
 * the 43 sampled steps are before it and identical, while the other 12 now land one
 * position later. The rates below are a measurement of this function, which did not
 * change; re-running the recipe today resamples twelve of its steps.
 *
 * - **30 exact.** Every candidate is verbatim what the book asks for, including
 *   the multi-candidate steps (*"use cd /data/sales and use touch emptyfile … Type
 *   groups to figure out why"* yields all three) and the awkward ones (`:w`,
 *   `./ex192`, `echo password | passwd --stdin betty; echo password | passwd
 *   --stdin amy`).
 * - **10 correctly empty.** The step genuinely has no command line to type:
 *   *"Open a root shell on server2."*, *"Which command enables you to schedule a
 *   cron job for user lisa?"*, *"Press G to go to the last line in the file."*
 * - **3 carrying a false positive.** Prose that survives the filters, all the same
 *   shape — a later imperative in the sentence governs English rather than a
 *   command: *"You need to type the root password on the console"* → `root
 *   password`; *"Run the script using hello as its argument"* → `script using
 *   hello`; *"you can type 1M, 1 MiB or 1MiB"* → three size literals. One of the
 *   three also produced a correct candidate alongside the junk.
 * - **0 truncated and 0 missed** in this sample. Both categories exist in the
 *   corpus at large: an imperative the list does not scan (*"start top"*) yields
 *   nothing.
 *
 * So: roughly three steps in four get a candidate, and roughly one step in
 * fourteen gets one that is wrong. That ratio is why `typedStepMatches` is
 * advisory and why `GuidedStep.text` is the artifact the UI must show. A false
 * candidate costs the student a rejected keystroke on a step whose prose is
 * visible above it; a *hidden* step or a *rewritten* command would cost them the
 * exercise.
 */
export function commandCandidates(stepText: string): string[] {
  const out: string[] = []

  for (const match of stepText.matchAll(IMPERATIVE)) {
    const rest = stepText.slice(match.index + match[0].length).replace(/^(?:the|a|an)\s+/i, '')
    const taken: string[] = []

    for (const token of rest.split(/\s+/)) {
      // A parenthetical is always commentary in this corpus: `dnf install -y
      // dnsmasq (you may get a message that…)`.
      if (token === '' || token.startsWith('(')) break
      const bare = token.replace(/[.,:]+$/, '')
      if (bare === '' || CLAUSE_WORDS.has(bare.toLowerCase())) break
      taken.push(bare)
      // Trailing punctuation ends the command as well as the token: the period of
      // `Type pvs.` and the colon of `enter +1G:` are sentence structure, and
      // `bare` has already dropped them.
      //
      // **A semicolon is not in that set, and the difference is measured.** It is
      // shell, not prose: 16 candidates in the corpus abut one, and 14 of them are
      // genuine sequences the book asks for in a single line — `useradd betty;
      // useradd amy`, `systemctl start chronyd; systemctl enable chronyd`,
      // `podman stop mydb; podman rm mydb`. Breaking there truncated all 14 to
      // their first command, which a student typing what the book prints would then
      // fail to match. The other 2 (`ls /; notice that…`, in both editions'
      // Exercise 24-3) are prose and now over-extend by two words, which is the
      // cheaper error.
      //
      // `!` and `?` are not stripped either, so they survive in a non-head token:
      // `echo hello! > /tmp/f` keeps its bang. They do not survive in the *head*,
      // because `COMMAND_HEAD` below has no `!` in its character class, and that
      // was left alone deliberately after measuring it. Exactly 4 steps in the
      // corpus have an imperative head containing one: both editions'
      // `Exercise 2-5` step 12 (*"Type :wq … if that does not work, use :wq!"*),
      // which already yields the correct `:wq` from its first imperative, and both
      // editions' `Exercise 2-3` step 8 (*"Type !nn, where nn is replaced by the
      // number you noted in step 7"*), where `!nn` is the book's placeholder and
      // no student can type it literally. Admitting `!` to the head would add two
      // alternate spellings of an already-covered answer and two candidates that
      // can never match, so it is not admitted.
      if (/[.,:]$/.test(token)) break
    }

    const head = taken[0]
    if (head === undefined || !COMMAND_HEAD.test(head)) continue
    const command = taken.join(' ')
    if (!out.includes(command)) out.push(command)
  }

  return out
}

/**
 * Normalises a typed line for comparison: whitespace only.
 *
 * Case is preserved because the shell preserves it — `LS` is not `ls`, and a
 * guided mode that accepted it would be teaching the student a habit the exam
 * fails them for. Runs of spaces and tabs collapse because `lvextend  -L 6G` and
 * `lvextend -L 6G` are the same command to bash, and because the corpus's own
 * candidates arrive from `joinWrapped` with single spaces.
 */
function normalizeTyped(line: string): string {
  return line.trim().replace(/[ \t]+/g, ' ')
}

/**
 * Did the student type this step's command?
 *
 * **This checks the typing, not the guest.** That is a deliberate reading of a
 * spec sentence that underdetermines it. Section 9.1 says each step is *"verified
 * before advancing"* but the corpus supplies no per-step grader, and inventing
 * one per step for 1405 steps is a bank-authoring project, not a Phase 2 bullet.
 * The two readings available were: verify guest end state per step (needs 1405
 * new graders, and section 6.5's graders inspect end state, which most individual
 * steps do not change), or verify that the student typed the command the book
 * shows. The second is chosen, because the same sentence gives the reason —
 * *"typing, not clicking — muscle memory is the point"* — and because it is the
 * reading that keeps the student's hands on the keyboard. End-state verification
 * is what the graded lab is for, days later, via drill; section 9.1 says that
 * too.
 *
 * Returns `false` for a step with no candidates: there is nothing to match, and a
 * caller must not gate advancement on this function for such a step — it advances
 * on the student's acknowledgement, with the book's prose in front of them. 347
 * of the corpus's 1405 steps are in that position, measured 2026-09-14;
 * `commandCandidates` explains why.
 */
export function typedStepMatches(step: GuidedStep, typed: string): boolean {
  const normalized = normalizeTyped(typed)
  if (normalized === '') return false
  return step.commands.some((candidate) => normalizeTyped(candidate) === normalized)
}
