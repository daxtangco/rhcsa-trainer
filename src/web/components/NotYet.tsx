import type { ReactNode } from 'react'

export interface NotYetProps {
  /** The thing section 11 asks this screen to show. Named as the spec names it. */
  what: string
  /**
   * What would produce it, concretely enough to check: a table, a module, a phase.
   * Prose like "coming soon" is what this component exists to refuse — it tells
   * the student nothing about whether the number is missing because they have not
   * done the work or because the app cannot do the arithmetic yet.
   */
  needs: string
  children?: ReactNode
}

/**
 * A measurement this build cannot make, rendered as a statement of absence.
 *
 * Section 9.4: *"a study tool that flatters is worse than no study tool"*, and the
 * flattery this component prevents is the quiet kind. A readiness meter at 0%, an
 * empty drill queue, a weakest-objectives list with no rows — each of those is a
 * *measurement* on screen, and each is false in the same direction: it says the
 * app looked and found nothing, when the truth is that the app cannot look yet.
 * The same section's closing line is the standard being met instead: *"an
 * instrument that reports its own error bars is worth more than one that does
 * not."*
 *
 * Deliberately not styled as a warning. Amber and rose are taken, in `Rail`, by
 * things that are wrong with a graded attempt; a Phase 3 feature that is not built
 * in Phase 2 is not wrong with anything. Dashed and grey reads as an outline of
 * something not yet filled in, which is what it is.
 */
export function NotYet({ what, needs, children }: NotYetProps) {
  return (
    <section className="rounded border border-dashed border-zinc-700 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm text-zinc-300">{what}</h2>
        <span className="shrink-0 text-xs uppercase tracking-wide text-zinc-500">not computed</span>
      </div>
      <p className="mt-1 text-xs text-zinc-400">{needs}</p>
      {children}
    </section>
  )
}
