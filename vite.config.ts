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
    proxy: {
      '/api': 'http://localhost:5175',
      // ws: true is the part people forget, and without it the terminal
      // silently never connects in dev.
      '/ws': { target: 'ws://localhost:5175', ws: true },
    },
  },
})
