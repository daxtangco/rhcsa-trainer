import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

export interface TerminalPaneProps {
  cols?: number
  rows?: number
  onStatus?: (status: 'open' | 'closed' | 'error') => void
}

/**
 * The terminal is a fixed size on purpose. The server side runs `ssh -tt` over a
 * pipe with no local PTY, so there is no way to deliver a window-size change to
 * the guest after the connection is up (see Task 23). A terminal that reflows
 * without the guest agreeing produces a display that lies about where the cursor
 * is, which is worse than one that does not reflow.
 */
export function TerminalPane({ cols = 100, rows = 30, onStatus }: TerminalPaneProps) {
  const host = useRef<HTMLDivElement | null>(null)
  const statusRef = useRef(onStatus)
  // Kept in a ref so an inline arrow from a caller does not re-create the
  // terminal and reconnect the socket on every render. With `onStatus` in the
  // dep array the first caller to write `onStatus={(s) => setStatus(s)}` gets a
  // new function identity per render, and the effect tears down the terminal,
  // closes the socket and kills the guest-side `ssh -tt` each time - presenting
  // as a pane that flickers and loses scrollback, with the cause nowhere near
  // this file.
  statusRef.current = onStatus

  useEffect(() => {
    const node = host.current
    if (node === null) return

    const term = new Terminal({
      cols,
      rows,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 14,
      theme: { background: '#09090b', foreground: '#e4e4e7' },
    })
    term.open(node)
    term.focus()

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(
      `${proto}://${window.location.host}/ws/terminal?cols=${cols}&rows=${rows}`,
    )

    ws.onopen = () => statusRef.current?.('open')
    ws.onerror = () => statusRef.current?.('error')
    ws.onclose = () => {
      statusRef.current?.('closed')
      term.write('\r\n\x1b[33m[connection closed]\x1b[0m\r\n')
    }
    // A string, never a Blob: the server calls `setEncoding('utf8')` on the ssh
    // child's stdout and stderr before subscribing, so it sends text frames and
    // StringDecoder holds back partial multi-byte sequences rather than
    // splitting a UTF-8 character across two of them.
    ws.onmessage = (ev) => term.write(String(ev.data))

    const sub = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    return () => {
      sub.dispose()
      // `onclose` writes to the terminal, and `ws.close()` fires it. Null it
      // first or the write lands on a terminal that is about to be disposed -
      // in React's strict-mode double-mount that is every unmount.
      ws.onclose = null
      ws.close()
      term.dispose()
    }
    // `cols` and `rows` only. A size change genuinely requires a new connection,
    // because the server runs `stty` once at connect time and cannot resize the
    // guest afterwards; `onStatus` must not be here, hence the ref above.
  }, [cols, rows])

  return <div ref={host} className="p-2" />
}
