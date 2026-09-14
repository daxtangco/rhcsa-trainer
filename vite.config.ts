import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// The same constant the server puts in the terminal's WebSocket origin
// allowlist. Imported rather than re-typed: spelling 5173 here and in
// config.ts is two places to change, and forgetting the second one presents as
// a terminal that never connects in dev - which looks like the `ws: true` proxy
// mistake and sends you to debug the wrong file. `config.ts` is deliberately
// side-effect free and imports nothing, so pulling it in here starts no server.
import { VITE_DEV_PORT } from './src/server/config.ts'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: VITE_DEV_PORT,
    // The attempt store is a SQLite database under `.rhcsa/`, and every session
    // start writes `vm_state` to it. Vite watches the project root, a `.db-wal`
    // write is a file change like any other, and the change is not importable - so
    // Vite's fallback is a **full page reload**. The result was a lab that could not
    // be started at all: press Start, the server reverts the guest, the WAL moves,
    // the browser reloads mid-request, and the student is handed the picker again
    // with no error anywhere. The session had been created; nothing was left to show
    // it. Ignoring the directory is the whole fix, and it belongs here rather than in
    // `.gitignore` (which Vite does not read) or in the store (whose job is not to
    // hide from a bundler).
    watch: { ignored: ['**/.rhcsa/**'] },
    proxy: {
      '/api': 'http://localhost:5175',
      // ws: true is the part people forget, and without it the terminal
      // silently never connects in dev.
      '/ws': { target: 'ws://localhost:5175', ws: true },
    },
  },
})
