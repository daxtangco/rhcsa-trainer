import { describe, expect, it } from 'vitest'
import { ApiError, createApi } from '../../src/web/api.ts'

// This file carries no environment docblock, so it stays in the Node
// environment: `Response` and `fetch` are then Node 22's real ones rather than
// jsdom's re-implementations, and since the client under test is a thin wrapper
// over the fetch spec, testing it against a stand-in would test the stand-in.
//
// Do not name that docblock directive in prose anywhere in this file. Vitest
// regex-scans the source for it and does not care that the sentence around it is
// a denial: an earlier draft of this very comment said "deliberately no
// <directive> jsdom here" and thereby switched the file to jsdom. Measured - the
// first assertion below is what caught it.

function fakeFetch(handler: (url: string, init?: RequestInit) => [number, unknown]) {
  const seen: Array<{ url: string; init?: RequestInit }> = []
  // Annotated rather than cast. `typeof fetch` infers `input` and `init` for us,
  // so the double cast through `unknown` that the brief proposed was never
  // needed - measured under this tsconfig, not assumed. Spelled out in words
  // rather than in code so the project's cast census grep stays honest.
  const impl: typeof fetch = async (input, init) => {
    const url = String(input)
    seen.push({ url, init })
    const [status, body] = handler(url, init)
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { impl, seen }
}

describe('createApi', () => {
  it('runs in the Node environment, not jsdom', () => {
    // Pinned rather than confirmed once by hand. A later `environment: 'jsdom'`
    // in vitest.config.ts would otherwise move this file silently, and the
    // `Response` these tests build would stop being the one the browser client
    // will actually meet.
    expect(typeof globalThis.window).toBe('undefined')
  })

  it('lists tasks', async () => {
    const { impl } = fakeFetch(() => [200, { tasks: [{ id: 'storage/014-grow-home-lv' }] }])
    const api = createApi(impl)
    expect(await api.tasks()).toEqual([{ id: 'storage/014-grow-home-lv' }])
  })

  it('starts a session with a JSON body', async () => {
    const { impl, seen } = fakeFetch(() => [201, { id: 's1', rung: 1 }])
    const api = createApi(impl)
    const s = await api.start('storage/014-grow-home-lv', 'practice')

    expect(s.id).toBe('s1')
    expect(seen[0]?.url).toBe('/api/sessions')
    expect(seen[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
      taskId: 'storage/014-grow-home-lv',
      mode: 'practice',
    })
  })

  it('splits a task id across path segments without encoding the slash', async () => {
    // encodeURIComponent would turn the slash into %2F and the route would 404.
    const { impl, seen } = fakeFetch(() => [200, { id: 'x' }])
    await createApi(impl).task('storage/014-grow-home-lv')
    expect(seen[0]?.url).toBe('/api/tasks/storage/014-grow-home-lv')
  })

  it('throws ApiError carrying the status and the server message', async () => {
    const { impl } = fakeFetch(() => [409, { error: 'rung 2 is the maximum in exam mode' }])
    const api = createApi(impl)
    await expect(api.hint('s1')).rejects.toThrow(/maximum in exam mode/)
    await expect(api.hint('s1')).rejects.toBeInstanceOf(ApiError)
  })

  it('reports a non-JSON failure without pretending it parsed', async () => {
    const impl: typeof fetch = async () => new Response('<html>502</html>', { status: 502 })
    await expect(createApi(impl).tasks()).rejects.toThrow(/502/)
  })

  it('keeps a non-string error field out of the message', async () => {
    // The server always sends `{ error: string }`, but a proxy or a future route
    // could send `{ error: { code: 1 } }`. The guarded read must fall back to the
    // status line rather than rendering "[object Object]" in the rail.
    const { impl } = fakeFetch(() => [500, { error: { code: 1 } }])
    await expect(createApi(impl).grade('s1')).rejects.toThrow(/500/)
    await expect(createApi(impl).grade('s1')).rejects.not.toThrow(/object Object/)
  })

  it('carries the status on ApiError so the caller can tell 409 from 500', async () => {
    const { impl } = fakeFetch(() => [409, { error: 'session s1 is already finished' }])
    const err: unknown = await createApi(impl).finish('s1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err instanceof ApiError ? err.status : undefined).toBe(409)
  })
})
