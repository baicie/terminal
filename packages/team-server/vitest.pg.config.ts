import path from 'node:path'
import { defineConfig } from 'vitest/config'

// The client sync E2E drives the real front-end store against this server, so the
// front-end tree owns '@' here (no server source imports it) and the client's
// Tauri packages resolve from the front-end install.
const FRONTEND_ROOT = path.resolve(__dirname, '../frontend')

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/pg/*.pg-spec.ts'],
    globalSetup: ['./src/__tests__/pg/pg-global-setup.ts'],
    setupFiles: ['reflect-metadata'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
    // The client store persists to a real SQLite database; node:sqlite is behind
    // a flag on the Node versions this workspace supports.
    execArgv: ['--experimental-sqlite'],
  },
  resolve: {
    alias: {
      '@': path.resolve(FRONTEND_ROOT, './src'),
      '@tauri-apps': path.resolve(FRONTEND_ROOT, './node_modules/@tauri-apps'),
    },
  },
})
