/// <reference types="vite/client" />

import type { AppStore } from './store/app'

declare global {
  interface Window {
    __APP_STORE__?: AppStore
    __localDirHandle?: FileSystemDirectoryHandle
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
  }
}
