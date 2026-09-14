/**
 * The dev server must not watch the attempt store.
 *
 * This exists because of a defect no other test in this repo could have caught,
 * and one that presented as a broken lab rather than as a broken tool. Vite
 * watches the project root; the attempt store is a SQLite database under
 * `.rhcsa/`; every session start writes `vm_state` to it. A `.db-wal` write is a
 * file change like any other, it is not importable, so Vite's fallback is a full
 * page reload — fired in the middle of the ten seconds `POST /api/sessions` spends
 * reverting the guest. The request died with the page. The student pressed Start,
 * watched it say "reverting", and got the picker back with no error anywhere,
 * while the server had in fact created the session.
 *
 * Nothing about that is visible to a unit test, a typecheck or a component test:
 * the client is correct, the server is correct, and the two are correct together
 * (measured — the same click drives to the session view under jsdom, where no file
 * watcher exists). It is a property of the dev server's configuration only, which
 * is what this file asserts.
 *
 * The store's path is read out of `src/server/index.ts` as text rather than
 * imported, because that module starts a server on import. So this is a
 * cross-file consistency check: renaming the store directory without teaching
 * Vite about it fails here rather than in a study session.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import config from '../vite.config.ts'

describe('vite dev server watch', () => {
  it('ignores the directory the attempt store lives in', async () => {
    const index = await readFile('src/server/index.ts', 'utf8')
    const declared = /RHCSA_DB \?\? '([^']+)'/.exec(index)?.[1]
    expect(declared, 'src/server/index.ts should still default RHCSA_DB').toBeDefined()

    const dir = (declared ?? '').split('/')[0]
    // A bare filename would mean the store sits in the project root, where no glob
    // can exclude it without excluding the source too. The directory is load-bearing.
    expect(dir).toMatch(/^\./)

    const ignored = config.server?.watch?.ignored
    expect(Array.isArray(ignored) ? ignored : [ignored]).toContain(`**/${dir}/**`)
  })
})
