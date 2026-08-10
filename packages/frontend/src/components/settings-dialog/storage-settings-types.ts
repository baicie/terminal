export type StorageSettings = {
  dataStorageMode: 'local' | 'service'
  syncServiceType: 'webdav' | 's3' | 'custom'
  syncServiceEndpoint: string
  syncServiceUsername?: string
  syncServiceToken?: string
  syncServiceBucket?: string
  syncServiceRegion?: string
}

export type UpdateStorageSetting = <K extends keyof StorageSettings>(
  key: K,
  value: StorageSettings[K],
) => void
