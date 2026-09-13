import { useEffect, useState } from 'react'
import { createApi } from './api.ts'
import { Nav } from './components/Nav.tsx'
import { screenForKey, type ScreenId } from './nav.ts'
import { Concepts } from './screens/Concepts.tsx'
import { Dashboard } from './screens/Dashboard.tsx'
import { Lab } from './screens/Lab.tsx'
import { Learn } from './screens/Learn.tsx'
import { NotBuilt } from './screens/NotBuilt.tsx'

// One client for the whole app, created at module scope so `vi.mock` on the api
// module can replace it before any screen renders. Each screen takes it as a prop
// rather than calling `createApi()` itself: one instance, one thing to mock.
const api = createApi()

/**
 * The shell: the nav bar of spec section 11 and the screen under it.
 *
 * **The Lab opens first.** Not the Dashboard, even though it is listed first — in
 * this build most of the Dashboard is a statement of what Phase 3 will compute, and
 * opening on a screen that mostly says "not yet" would misrepresent an app whose
 * Phase 1 exit criterion was a real graded lab. It also means the terminal always
 * mounts while it is visible, which matters below.
 *
 * **The Lab stays mounted when you leave it, and the other screens do not.** The
 * lab holds a WebSocket whose far end is the guest-side `ssh -tt`; unmounting it to
 * glance at the Dashboard would kill the shell, the scrollback and any command left
 * running mid-attempt. So the lab is hidden rather than removed, and `Lab` takes an
 * `active` prop because a hidden screen must not answer the keyboard. The other
 * three hold nothing but fetched JSON, and mounting them on demand is what keeps
 * the app from firing three requests at startup that the student may never look at.
 */
export function App() {
  const [screen, setScreen] = useState<ScreenId>('lab')

  // Navigation keys. `screenForKey` returns `undefined` for everything else,
  // including F2, F4 and F8 - the lab's own shortcuts pass through untouched, and
  // `preventDefault` is called only for a key this handler actually claims.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const next = screenForKey(e.key)
      if (next === undefined) return
      e.preventDefault()
      setScreen(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-screen flex-col bg-zinc-950">
      <Nav screen={screen} onNavigate={setScreen} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className={screen === 'lab' ? 'h-full' : 'hidden'}>
          <Lab api={api} active={screen === 'lab'} />
        </div>
        {screen === 'dashboard' ? <Dashboard api={api} onNavigate={setScreen} /> : null}
        {screen === 'learn' ? <Learn api={api} /> : null}
        {screen === 'concepts' ? <Concepts api={api} /> : null}
        {screen === 'track' || screen === 'exams' ? <NotBuilt screen={screen} /> : null}
      </div>
    </div>
  )
}
