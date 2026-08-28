/// <reference types="vite/client" />

import type { AppStore } from './store/app'

declare global {
  interface ImportMetaEnv {
    readonly VITE_TERMINAL_SMOKE_BUILD?: '1'
  }

  interface Window {
    __APP_STORE__?: AppStore
    __localDirHandle?: FileSystemDirectoryHandle
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
    __resetErrorBoundary__?: () => void
  }
}
