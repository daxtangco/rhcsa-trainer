// @vitest-environment jsdom
//
// Mandate 6's `statusRef`, measured. The fix is a one-line ref that reads
// correctly and does nothing observable until some later caller writes
// `onStatus={(s) => setStatus(s)}` - at which point every render tears the
// terminal down, closes the socket and kills the guest-side `ssh -tt`, presenting
// as a pane that flickers and loses scrollback with the cause nowhere near this
// component. Nothing but a construction count catches that.
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { TerminalPane } from '../../src/web/components/TerminalPane.tsx'

// xterm reads `matchMedia` while opening, and jsdom does not implement it.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }),
})

/**
 * Every socket the component has ever built, in order. `render` gives no handle
 * on it and the component deliberately keeps none, so the fake records itself.
 */
const built: FakeWS[] = []
const closedUrls: string[] = []

class FakeWS {
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
    built.push(this)
  }
  send() {}
  close() {
    closedUrls.push(this.url)
  }
}
Object.defineProperty(globalThis, 'WebSocket', { writable: true, value: FakeWS })

function clear() {
  built.length = 0
  closedUrls.length = 0
}

// Built from `window.location`, the way the component does, rather than pinning
// jsdom's default host - the point of the assertion is the size in the query
// string, not which port jsdom happens to pretend to be serving.
function wsUrl(cols: number, rows: number): string {
  return `ws://${window.location.host}/ws/terminal?cols=${cols}&rows=${rows}`
}

function only(): FakeWS {
  const s = built[0]
  if (s === undefined) throw new Error('no WebSocket was constructed')
  return s
}

describe('TerminalPane', () => {
  it('does not reconnect when the caller passes a fresh onStatus every render', () => {
    clear()
    const seen: string[] = []

    // A new function identity on every render, which is what any caller writing
    // an inline arrow produces. With `onStatus` in the effect's dep array, the
    // re-renders below open a second and third socket and kill two guest-side
    // shells on the way.
    const { rerender } = render(<TerminalPane onStatus={(s) => seen.push(s)} />)
    expect(built).toHaveLength(1)

    rerender(<TerminalPane onStatus={(s) => seen.push(s)} />)
    rerender(<TerminalPane onStatus={(s) => seen.push(`again:${s}`)} />)

    expect(built).toHaveLength(1)
    expect(closedUrls).toEqual([])
  })

  it('still reports status through the newest callback, not a frozen one', () => {
    // The ref has to stay current, not merely stable. Setting it once at mount
    // would also satisfy the count above while quietly reporting into a closure
    // from the first render.
    clear()
    const first: string[] = []
    const second: string[] = []

    const { rerender } = render(<TerminalPane onStatus={(s) => first.push(s)} />)
    rerender(<TerminalPane onStatus={(s) => second.push(s)} />)

    only().onopen?.()
    only().onerror?.()

    expect(built).toHaveLength(1)
    expect(first).toEqual([])
    expect(second).toEqual(['open', 'error'])
  })

  it('reconnects when the size changes, because the guest cannot be resized', () => {
    // The control. `cols`/`rows` are in the dep array on purpose: the server runs
    // `stty` once at connect time and cannot resize the guest afterwards, so a
    // size change genuinely needs a new connection. Without this test, emptying
    // the dep array would satisfy both tests above.
    clear()

    const { rerender } = render(<TerminalPane cols={100} rows={30} />)
    expect(built.map((s) => s.url)).toEqual([wsUrl(100, 30)])

    rerender(<TerminalPane cols={120} rows={40} />)
    expect(built.map((s) => s.url)).toEqual([wsUrl(100, 30), wsUrl(120, 40)])
    // The old socket is closed rather than left holding a shell open in the guest.
    expect(closedUrls).toEqual([wsUrl(100, 30)])
  })
})
