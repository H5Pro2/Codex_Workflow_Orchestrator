import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Plugin } from 'vite'

function codexBridge(): Plugin {
  let bridge: ChildProcess | undefined

  return {
    name: 'codex-bridge',
    async configureServer(server) {
      const startBridge = () => {
        bridge = spawn(process.execPath, ['server/bridge.mjs'], {
          cwd: process.cwd(),
          stdio: 'inherit',
          windowsHide: true,
        })
      }

      try {
        const response = await fetch('http://127.0.0.1:4317/api/health')
        if (response.ok) {
          return
        }
      } catch {
        startBridge()
      }

      server.watcher.add('server/bridge.mjs')
      server.watcher.on('change', (path) => {
        if (path.endsWith('server/bridge.mjs')) {
          bridge?.kill()
          startBridge()
        }
      })
      server.httpServer?.once('close', () => bridge?.kill())
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), codexBridge()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4317',
    },
  },
})
