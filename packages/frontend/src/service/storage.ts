// Storage service - wraps Tauri commands for storage backend operations

import { invoke } from '@tauri-apps/api/core'

export interface StorageResult {
  success: boolean
  message: string
  timestamp: number
}

export interface StorageItem {
  name: string
  path: string
  is_directory: boolean
  size?: number
  modified?: number
}

export interface StorageError {
  type: string
  message: string
}

export type StorageBackendType = 'webdav' | 's3' | 'custom'

/**
 * Initialize storage backend with configuration
 */
export async function storageInit(
  backendType: StorageBackendType,
  endpoint: string,
  options?: {
    username?: string
    password?: string
    apiKey?: string
    basePath?: string
    bucket?: string
    region?: string
  },
): Promise<boolean> {
  return await invoke<boolean>('storage_init', {
    backendType,
    endpoint,
    username: options?.username ?? null,
    password: options?.password ?? null,
    apiKey: options?.apiKey ?? null,
    basePath: options?.basePath ?? null,
    bucket: options?.bucket ?? null,
    region: options?.region ?? null,
  })
}

/**
 * Check storage connection health
 */
export async function storageHealthCheck(): Promise<boolean> {
  return await invoke<boolean>('storage_health_check')
}

/**
 * Upload data to storage
 */
export async function storageUpload(
  path: string,
  data: string,
): Promise<StorageResult> {
  return await invoke<StorageResult>('storage_upload', { path, data })
}

export type StorageDownloadResult =
  | { status: 'ok'; data: string }
  | { status: 'notFound' }
  | { status: 'error'; error: string }

function describeStorageError(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const { type, message } = error as { type?: unknown; message?: unknown }
    if (typeof message === 'string' && message)
      return typeof type === 'string' ? `${type}: ${message}` : message
    if (typeof type === 'string') return type
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * Download data from storage. Three states instead of a bare `null`: a missing
 * backup and a failed read (network, auth, unconfigured backend) are reported
 * separately so a broken read is never shown as "no backup on the server".
 * The backend reports a missing object as a download failure carrying the HTTP
 * status, so only a 404 there counts as "not found".
 */
export async function storageDownload(
  path: string,
): Promise<StorageDownloadResult> {
  try {
    const result = await invoke<string>('storage_download', { path })
    if (!result) return { status: 'notFound' }
    return { status: 'ok', data: result }
  } catch (error) {
    const message = describeStorageError(error)
    if (/\b404\b/.test(message)) return { status: 'notFound' }
    return { status: 'error', error: message }
  }
}

/**
 * List storage items
 */
export async function storageList(path: string): Promise<StorageItem[]> {
  return await invoke<StorageItem[]>('storage_list', { path })
}

/**
 * Delete storage item
 */
export async function storageDelete(path: string): Promise<StorageResult> {
  return await invoke<StorageResult>('storage_delete', { path })
}
