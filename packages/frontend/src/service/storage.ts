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

/**
 * Download data from storage. Returns null if the file does not exist or is empty.
 */
export async function storageDownload(path: string): Promise<string | null> {
  try {
    const result = await invoke<string>('storage_download', { path })
    return result || null
  } catch {
    return null
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
