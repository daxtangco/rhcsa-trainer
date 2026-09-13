/**
 * The six screens of spec section 11, and the keys that reach them.
 *
 * ## Why these keys, and why not the ones the spec names
 *
 * UI rule 4 is *"keyboard-first; the terminal is never modal"*, and section 11
 * spells the Lab screen's own shortcuts `^G`, `^H`, `^R`. Those three were
 * already replaced during Phase 1 and the reason is recorded in `screens/Lab.tsx`:
 * the terminal has to deliver every control sequence the shell uses, and `^G`,
 * `^H` and `^R` are all taken (bell, backspace, reverse history search). The Lab
 * screen therefore owns **F2 hint, F4 grade, F8 finish**, and reset owns no key at
 * all on purpose.
 *
 * Navigation has to clear a harder bar than that, because it is live on every
 * screen including the one with a shell on it:
 *
 * - **Not F2, F4 or F8.** Not even with a modifier. A mis-shifted `Shift+F2` that
 *   fell through to plain F2 would spend a rung of disclosure the student did not
 *   ask for — the one action on this app that cannot be undone by pressing it
 *   again. Nav keys are disjoint from the lab keys so a slip in either direction
 *   is at worst a screen change.
 * - **No Ctrl and no Alt.** xterm.js forwards both to the guest: Ctrl is the
 *   shell's control sequences and Alt is its meta prefix (`Alt+.`, `Alt+b`).
 * - **Nothing unmodified.** xterm's keydown bubbles to `window`, so a bare letter
 *   or digit handled here would fire while the student is typing in the terminal.
 *
 * That leaves the function keys the lab does not use, and of those, the ones no
 * browser needs and `preventDefault` cannot rescue are avoided: F5 reloads, F11
 * goes fullscreen, F12 opens devtools and cannot be suppressed at all. F3, F6, F7
 * and F9 are what is left. They are arbitrary, which is why every one of them is
 * printed on its own nav button the way `Rail` prints `Hint (F2)` — a shortcut
 * nobody can see is a shortcut nobody uses.
 *
 * **Track and Exams get no key, deliberately.** They are Phase 3 (section 16), and
 * this build renders them as an honest statement of what is not built rather than
 * as an empty table. A dedicated key to a screen with nothing on it would be
 * training a reflex into a dead end; a click is the right cost for reading a
 * notice once.
 */
export type ScreenId = 'dashboard' | 'learn' | 'lab' | 'track' | 'exams' | 'concepts'

export interface ScreenDef {
  id: ScreenId
  label: string
  /**
   * The `KeyboardEvent.key` that selects this screen, or `null` for click-only.
   * `null` rather than omitted: a screen that means to have no shortcut and a
   * screen whose shortcut was forgotten should not look the same here.
   */
  key: string | null
  /**
   * False for the two screens Phase 3 builds. The nav renders them anyway —
   * section 11 names six screens and hiding two would misrepresent the design —
   * but marked, so the label itself says the screen is not built before it is
   * clicked.
   */
  built: boolean
}

/** Section 11's order, left to right, unchanged. */
export const SCREENS: ScreenDef[] = [
  { id: 'dashboard', label: 'Dashboard', key: 'F3', built: true },
  { id: 'learn', label: 'Learn', key: 'F6', built: true },
  { id: 'lab', label: 'Lab', key: 'F7', built: true },
  { id: 'track', label: 'Track', key: null, built: false },
  { id: 'exams', label: 'Exams', key: null, built: false },
  { id: 'concepts', label: 'Concepts', key: 'F9', built: true },
]

/**
 * The screen a keypress selects, or `undefined` for every other key.
 *
 * A lookup over `SCREENS` rather than a second switch statement, so the key
 * printed on a button and the key that works are one fact. Returning `undefined`
 * is what lets the caller leave the event alone: swallowing F2 here would break
 * the lab's hint from every screen, including the lab.
 */
export function screenForKey(key: string): ScreenId | undefined {
  return SCREENS.find((s) => s.key === key)?.id
}
