import type { SSHKeyRecord } from '@/service/database'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface KeyFormValues {
  formName: string
  formKeyType: string
  formPrivateKey: string
  formPublicKey: string
  formCertificate: string
  formPassphrase: string
}

export interface UseKeyFormReturn {
  formName: string
  formKeyType: string
  formPrivateKey: string
  formPublicKey: string
  formCertificate: string
  formPassphrase: string
  handleSelectKey: (key: SSHKeyRecord) => void
  handleNewKey: () => void
  handleSave: (
    isNewKey: boolean,
    selectedKey: SSHKeyRecord | null,
    formValues: KeyFormValues,
  ) => Omit<SSHKeyRecord, 'created_at' | 'updated_at'> | null
  handleDelete: (keyToDelete: SSHKeyRecord | null) => string | null
  handleImportFromFile: (
    field: 'private' | 'public' | 'certificate',
  ) => Promise<void>
  handleUseGeneratedKey: (result: {
    private_key: string
    public_key: string
    key_type: string
    fingerprint: string
  }) => void
  handleFormChange: (field: string, value: string) => void
}

export function useKeyForm(): UseKeyFormReturn {
  const [formName, setFormName] = useState('')
  const [formKeyType, setFormKeyType] = useState<string>('key')
  const [formPrivateKey, setFormPrivateKey] = useState('')
  const [formPublicKey, setFormPublicKey] = useState('')
  const [formCertificate, setFormCertificate] = useState('')
  const [formPassphrase, setFormPassphrase] = useState('')

  // Refs so pure functions can call setters without needing them as parameters
  const settersRef = useRef({
    setFormName,
    setFormKeyType,
    setFormPrivateKey,
    setFormPublicKey,
    setFormCertificate,
    setFormPassphrase,
  })

  // Keep refs in sync when setters change
  useEffect(() => {
    settersRef.current = {
      setFormName,
      setFormKeyType,
      setFormPrivateKey,
      setFormPublicKey,
      setFormCertificate,
      setFormPassphrase,
    }
  }, [])

  const handleSelectKey = useCallback((key: SSHKeyRecord) => {
    setFormName(key.name)
    setFormKeyType(key.key_type || 'key')
    setFormPrivateKey(key.private_key || '')
    setFormPublicKey(key.public_key || '')
    setFormCertificate(key.certificate || '')
    setFormPassphrase(key.passphrase || '')
  }, [])

  const handleNewKey = useCallback(() => {
    setFormName('')
    setFormKeyType('key')
    setFormPrivateKey('')
    setFormPublicKey('')
    setFormCertificate('')
    setFormPassphrase('')
  }, [])

  const handleSave = useCallback(
    (
      isNewKey: boolean,
      selectedKey: SSHKeyRecord | null,
      formValues: KeyFormValues,
    ): Omit<SSHKeyRecord, 'created_at' | 'updated_at'> | null => {
      if (!formValues.formName.trim()) return null

      if (isNewKey) {
        return {
          id: crypto.randomUUID(),
          name: formValues.formName,
          key_type: formValues.formKeyType,
          private_key: formValues.formPrivateKey || null,
          public_key: formValues.formPublicKey || null,
          certificate: formValues.formCertificate || null,
          passphrase: formValues.formPassphrase || null,
          is_encrypted: formValues.formPrivateKey ? 0 : 0,
        }
      } else if (selectedKey) {
        return {
          id: selectedKey.id,
          name: formValues.formName,
          key_type: formValues.formKeyType,
          private_key: formValues.formPrivateKey || null,
          public_key: formValues.formPublicKey || null,
          certificate: formValues.formCertificate || null,
          passphrase: formValues.formPassphrase || null,
          is_encrypted: formValues.formPrivateKey ? 1 : 0,
        }
      }
      return null
    },
    [],
  )

  const handleDelete = useCallback(
    (keyToDelete: SSHKeyRecord | null): string | null => {
      return keyToDelete?.id ?? null
    },
    [],
  )

  const handleImportFromFile = useCallback(
    async (field: 'private' | 'public' | 'certificate') => {
      try {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.pem,.key,.pub,.crt,.cert'
        input.onchange = async e => {
          const file = (e.target as HTMLInputElement).files?.[0]
          if (file) {
            const text = await file.text()
            const setters = settersRef.current
            if (field === 'private') {
              setters.setFormPrivateKey(text)
            } else if (field === 'public') {
              setters.setFormPublicKey(text)
            } else {
              setters.setFormCertificate(text)
            }
          }
        }
        input.click()
      } catch (error) {
        console.error('Failed to import file:', error)
      }
    },
    [],
  )

  const handleUseGeneratedKey = useCallback(
    (result: {
      private_key: string
      public_key: string
      key_type: string
      fingerprint: string
    }) => {
      const setters = settersRef.current
      setters.setFormName(`Generated ${result.key_type} Key`)
      setters.setFormKeyType('key')
      setters.setFormPrivateKey(result.private_key)
      setters.setFormPublicKey(result.public_key)
      setters.setFormCertificate('')
      setters.setFormPassphrase('')
    },
    [],
  )

  const handleFormChange = useCallback((field: string, value: string) => {
    const setters = settersRef.current
    switch (field) {
      case 'name':
        setters.setFormName(value)
        break
      case 'keyType':
        setters.setFormKeyType(value)
        break
      case 'privateKey':
        setters.setFormPrivateKey(value)
        break
      case 'publicKey':
        setters.setFormPublicKey(value)
        break
      case 'certificate':
        setters.setFormCertificate(value)
        break
      case 'passphrase':
        setters.setFormPassphrase(value)
        break
    }
  }, [])

  return {
    formName,
    formKeyType,
    formPrivateKey,
    formPublicKey,
    formCertificate,
    formPassphrase,
    handleSelectKey,
    handleNewKey,
    handleSave,
    handleDelete,
    handleImportFromFile,
    handleUseGeneratedKey,
    handleFormChange,
  }
}
