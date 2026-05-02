/// <reference types="vite/client" />

import type { AppStore } from './store/app'

declare global {
  interface Window {
    __APP_STORE__?: AppStore
    __localDirHandle?: FileSystemDirectoryHandle
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
    __resetErrorBoundary__?: () => void
  }
}

// Declare @baicie/xterm module - it re-exports @xterm/xterm types
// This resolves the module resolution issue where @baicie/xterm's typings
// incorrectly declare themselves as @xterm/xterm
declare module '@baicie/xterm' {
  export * from '@xterm/xterm'
  export { Terminal } from '@xterm/xterm'
}
