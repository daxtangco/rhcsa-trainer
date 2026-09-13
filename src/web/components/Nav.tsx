import { SCREENS, type ScreenId } from '../nav.ts'

export interface NavProps {
  screen: ScreenId
  onNavigate: (screen: ScreenId) => void
}

/**
 * Section 11's six screens, in section 11's order.
 *
 * Two of them are Phase 3 and are listed anyway, marked. Hiding them would leave a
 * four-item bar that reads as the whole design; listing them unmarked would make a
 * student click twice before finding out. The marker is on the button, so the
 * answer arrives before the click.
 *
 * The shortcut is printed beside the label, the way `Rail` prints `Hint (F2)` —
 * `nav.ts` picked keys that collide with nothing, and the price of that is that
 * they are arbitrary and have to be visible. Screens with no shortcut print none
 * rather than a placeholder.
 */
export function Nav({ screen, onNavigate }: NavProps) {
  return (
    <nav
      aria-label="screens"
      className="flex shrink-0 items-stretch gap-1 border-b border-zinc-800 bg-zinc-950 px-2"
    >
      {SCREENS.map((s) => {
        const here = s.id === screen
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onNavigate(s.id)}
            aria-current={here ? 'page' : undefined}
            className={`border-b-2 px-3 py-2 text-sm ${
              here
                ? 'border-emerald-500 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {s.label}
            {s.key === null ? null : (
              <span className="ml-1.5 text-xs text-zinc-600">{s.key}</span>
            )}
            {s.built ? null : (
              <span className="ml-1.5 text-xs uppercase tracking-wide text-zinc-600">phase 3</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
