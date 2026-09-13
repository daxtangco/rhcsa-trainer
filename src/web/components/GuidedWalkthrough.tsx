import { useState } from 'react'
// The one value imported from the engine into the browser bundle, and the reason
// it is safe: `steps.ts` has no imports at all and touches no Node built-in, so
// bundling it costs a few regexes. The reason it is *imported* rather than
// reimplemented matters more. `typedStepMatches` is deliberately case-sensitive
// ("`LS` is not `ls`, and a guided mode that accepted it would be teaching the
// student a habit the exam fails them for") and deliberately whitespace-
// insensitive. A second copy of that rule living in the web layer is a second
// place for someone to add a `.toLowerCase()` that nobody notices until an exam.
import { typedStepMatches } from '../../engine/guided/steps.ts'
import type { Edition, GuidedItem, GuidedStep, GuidedText } from '../api.ts'

/**
 * Keyed by the union rather than by `string`, so a third edition fails to
 * typecheck here instead of rendering the raw `r11` at the student. The same trick
 * `Rail`'s `DOT` uses, for the same reason.
 */
const EDITION_LABEL: Record<Edition, string> = { r9: 'RHCSA 9', r10: 'RHCSA 10' }

const STEP = 'rounded border p-3'

/** The book's prose, which is the authoritative artifact — see `steps.ts`. */
function StepText({ step, className }: { step: GuidedStep; className: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-6 shrink-0 text-right text-xs text-zinc-500">{step.n}.</span>
      <p className={`min-w-0 flex-1 whitespace-pre-wrap ${className}`}>{step.text}</p>
    </div>
  )
}

/**
 * The other edition's wording, read-only and behind a toggle.
 *
 * Not interleaved with the shown edition, and `select.ts` gives the reason: *"the
 * step counts differ, the numbering differs, and in chapter 13 the exercises were
 * renumbered outright. Interleaving them would produce a walkthrough neither book
 * prints and no exam matches."* It renders `alternate.title` rather than reusing
 * the shown title because for six of the 84 cross-edition slots the two books
 * genuinely disagree about the title, and one of those six is a corpus defect that
 * this is the only place a student can see.
 *
 * Nothing here is typed. This is a comparison — which parts of the procedure are
 * the exam and which are the edition — and asking the student to type the same
 * exercise twice in two spellings would train the wrong half of it.
 */
function Alternate({ text }: { text: GuidedText }) {
  const [open, setOpen] = useState(false)
  const label = EDITION_LABEL[text.edition]
  return (
    <div className="mt-4 rounded border border-zinc-800 bg-zinc-950 p-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-xs text-sky-300 underline decoration-dotted"
      >
        {open ? `hide the ${label} wording` : `show the ${label} wording`}
      </button>
      {open ? (
        <div className="mt-2">
          <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
          <h3 className="text-zinc-200">{text.title}</h3>
          <p className="mt-1 text-xs text-zinc-500">
            {text.steps.length === 1 ? '1 step' : `${text.steps.length} steps`}, numbered as that
            book numbers them. Read it alongside; do not try to follow both at once — the two
            editions renumber and re-split their steps, so a merged sequence is one neither book
            prints.
          </p>
          {text.preamble === '' ? null : (
            <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-400">{text.preamble}</p>
          )}
          <div className="mt-2 space-y-2">
            {text.steps.map((s) => (
              <StepText key={s.n} step={s} className="text-sm text-zinc-400" />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export interface GuidedWalkthroughProps {
  item: GuidedItem
}

/**
 * One exercise, walked through the way section 9.1 defines guided mode: *"The app
 * shows a command, **the user types it** (typing, not clicking — muscle memory is
 * the point), and each step is verified before advancing."*
 *
 * Three decisions follow from that sentence and one measurement.
 *
 * **1. Every step is on screen, including the ones not reached yet.** Guided mode
 * is full disclosure by construction — the book is open in front of the student —
 * so hiding the tail would be withholding in the one mode that withholds nothing.
 * Only the current step takes input.
 *
 * **2. A step with a command is gated on typing it; a step without one is gated on
 * acknowledgement, and that is not a shortcut.** Measured in `steps.ts` against the
 * real corpus: 347 of the 1405 parsed steps yield no command candidate, because the
 * step genuinely has none — *"Open a root shell on server2."*, *"Which command
 * enables you to schedule a cron job for user lisa?"* `typedStepMatches` returns
 * `false` for all 347 by design, so gating them on typing would make a quarter of
 * the corpus an unpassable wall. Those steps get no input box at all rather than an
 * input box that can never be satisfied.
 *
 * **3. There is an escape hatch, and it is aimed at a measured defect rather than at
 * impatience.** `commandCandidates` is a heuristic over text that lost its
 * typography, and its own audit puts roughly one step in fourteen at carrying a
 * false candidate (*"Run the script using hello as its argument"* → `script using
 * hello`). On such a step the student who types what the book says is *correct* and
 * the matcher disagrees. Without a way past it the exercise ends there. So after a
 * failed attempt the prose is restated as authoritative and the student can
 * advance — a deliberate, labelled act, not a hidden fallback, and unavailable
 * before a real attempt has been made.
 *
 * **What "verified" means here, said out loud.** It verifies the typing, not the
 * guest. `typedStepMatches`'s own docblock settles why: the corpus supplies no
 * per-step grader, inventing 1405 of them is a bank-authoring project, and section
 * 9.1 hands the graded end-state check to the unguided lab that follows days later.
 * The completion note below says this to the student rather than letting them infer
 * that the machine was checked.
 */
export function GuidedWalkthrough({ item }: GuidedWalkthroughProps) {
  const steps = item.shown.steps
  const [at, setAt] = useState(0)
  const [typed, setTyped] = useState('')
  // Attempts against the *current* step only, reset on every advance. It gates the
  // escape hatch below: offering "advance anyway" before the student has typed
  // anything would turn a typing exercise into a clicking exercise.
  const [misses, setMisses] = useState(0)

  const current = steps[at]
  const done = current === undefined

  function advance() {
    setAt(at + 1)
    setTyped('')
    setMisses(0)
  }

  function submit(step: GuidedStep) {
    if (typedStepMatches(step, typed)) {
      advance()
      return
    }
    setMisses(misses + 1)
  }

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-xs uppercase tracking-wide text-zinc-500">{item.id}</span>
        {item.crossEdition ? (
          <span className="rounded border border-emerald-800 px-1.5 py-0.5 text-xs text-emerald-300">
            in both editions
          </span>
        ) : (
          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-400">
            {EDITION_LABEL[item.shown.edition]} only
          </span>
        )}
        <span className="text-xs text-zinc-500">chapter {item.chapter}</span>
      </div>

      <h2 className="mt-1 text-lg text-zinc-100">{item.shown.title}</h2>
      <div className="text-xs text-zinc-500">
        {EDITION_LABEL[item.shown.edition]} · step {Math.min(at + 1, steps.length)} of{' '}
        {steps.length}
      </div>

      {/* Carried, never dropped: the preamble is usually the precondition, and a
          student who skips *"you need a disk with unpartitioned space"* runs step 1
          against the wrong device. Most exercises have none (37 of 180), hence the
          empty-string test rather than an always-present block. */}
      {item.shown.preamble === '' ? null : (
        <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{item.shown.preamble}</p>
      )}

      <ol className="mt-4 space-y-2">
        {steps.map((step, i) => {
          const isCurrent = i === at
          const isDone = i < at
          return (
            <li
              key={step.n}
              className={
                isCurrent
                  ? `${STEP} border-emerald-800 bg-emerald-950/20`
                  : isDone
                    ? `${STEP} border-zinc-800 bg-zinc-900/30`
                    : `${STEP} border-zinc-800/60`
              }
            >
              <StepText
                step={step}
                className={
                  isCurrent ? 'text-zinc-100' : isDone ? 'text-zinc-500' : 'text-zinc-400'
                }
              />

              {isCurrent ? (
                <div className="mt-3 pl-9">
                  {step.commands.length > 0 ? (
                    <>
                      <div className="text-xs text-zinc-500">
                        {step.commands.length === 1
                          ? 'type this line:'
                          : 'type one of these lines:'}
                      </div>
                      <ul className="mt-1 space-y-1">
                        {step.commands.map((c) => (
                          <li key={c} className="font-mono text-sm text-emerald-300">
                            {c}
                          </li>
                        ))}
                      </ul>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          submit(step)
                        }}
                        className="mt-2 flex gap-2"
                      >
                        <input
                          // Not a copy button, and there will not be one. The
                          // spec's parenthesis is the requirement: typing, not
                          // clicking - muscle memory is the point.
                          aria-label={`type the command for step ${step.n}`}
                          value={typed}
                          onChange={(e) => setTyped(e.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm text-zinc-100"
                        />
                        <button
                          type="submit"
                          className="rounded bg-emerald-700 px-3 py-1 text-sm text-white"
                        >
                          Check
                        </button>
                      </form>
                      {misses > 0 ? (
                        <div className="mt-2 text-xs text-amber-300">
                          Not that line yet. Spacing does not matter; capitals do —{' '}
                          <code>LVEXTEND</code> is not <code>lvextend</code>, and the exam agrees
                          with the shell, not with you.
                        </div>
                      ) : null}
                      {misses > 0 ? (
                        <button
                          type="button"
                          onClick={advance}
                          className="mt-2 text-xs text-zinc-400 underline decoration-dotted"
                        >
                          the line above is wrong — the prose is authoritative, advance anyway
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div className="text-xs text-zinc-500">
                        No command to type in this step: the book asks you to do or notice
                        something, so there is nothing to match. Do it, then say so.
                      </div>
                      <button
                        type="button"
                        onClick={advance}
                        className="mt-2 rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-200"
                      >
                        Done, next step
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>

      {done ? (
        <div className="mt-4 rounded border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-200">
          Walkthrough complete — {steps.length === 1 ? '1 step' : `${steps.length} steps`}.
          <p className="mt-2 text-xs text-zinc-400">
            What was checked is that you typed each command the book prints. The machine was not
            graded: guided mode is first contact, and whether you can produce the end state cold is
            what the graded lab measures, days later. Scheduling that repeat is drill mode, which is
            Phase 3; until then, run the matching task on the Lab screen when it stops feeling
            fresh.
          </p>
          <button
            type="button"
            onClick={() => {
              setAt(0)
              setTyped('')
              setMisses(0)
            }}
            className="mt-2 text-xs text-sky-300 underline decoration-dotted"
          >
            walk it again from step 1
          </button>
        </div>
      ) : null}

      {item.alternate === undefined ? null : <Alternate text={item.alternate} />}
    </div>
  )
}
