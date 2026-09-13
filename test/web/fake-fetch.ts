/**
 * A `fetch` the screen tests can hand to the real `createApi`.
 *
 * Not collected by Vitest (the include glob is `*.test.ts(x)`), and shared rather
 * than copied into four files because every one of them needs the same three
 * lines. The choice it encodes is worth stating: the screens are driven through
 * the **real** API client with `fetch` faked, not through a hand-written fake
 * client. `test/web/app.test.tsx` mocks the module because it is exercising the
 * lab's handler wiring and does not care about URLs; a screen test does care —
 * `/api/guided/task/storage/014-grow-home-lv` must keep its slash, and a fake
 * client cannot get that wrong on the screen's behalf.
 *
 * The counterpart is `test/web/api.test.ts`, which owns the same idea for the
 * client itself and deliberately runs in Node so its `Response` is Node's. These
 * tests run in jsdom because they render components, so the `Response` here is
 * jsdom's; both files only ever put JSON through it.
 */
export interface FakeFetch {
  impl: typeof fetch
  /** Every URL asked for, in order. */
  seen: string[]
}

export function fakeFetch(handler: (url: string) => [number, unknown]): FakeFetch {
  const seen: string[] = []
  // Annotated rather than cast, the same way `api.test.ts` does it: `typeof fetch`
  // infers the parameters, so no cast is needed to satisfy the signature.
  const impl: typeof fetch = async (input) => {
    const url = String(input)
    seen.push(url)
    const [status, body] = handler(url)
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { impl, seen }
}

/**
 * A handler from a path-to-body table. An unlisted path answers 404 with the
 * server's error shape rather than 200 with `undefined`: a test that mistypes a
 * route should fail saying the route was not there, not by rendering a screen full
 * of blanks.
 */
export function routes(table: Record<string, unknown>): (url: string) => [number, unknown] {
  return (url) => {
    if (url in table) return [200, table[url]]
    return [404, { error: `no fake route for ${url}` }]
  }
}
