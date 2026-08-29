import { useCallback, useState } from 'react'
import type { ScriptRecord } from '@/service/database'

export type ScheduleType = 'manual' | 'once' | 'interval' | 'cron'

export interface ScriptFormState {
  formName: string
  formDescription: string
  formScript: string
  formHostIds: string[]
  formScheduleType: ScheduleType
  formScheduleValue: string
  formTimeout: number
  formRetryCount: number
}

export interface UseScriptFormReturn extends ScriptFormState {
  setFormName: (value: string) => void
  setFormDescription: (value: string) => void
  setFormScript: (value: string) => void
  setFormHostIds: (value: string[]) => void
  setFormScheduleType: (value: ScheduleType) => void
  setFormScheduleValue: (value: string) => void
  setFormTimeout: (value: number) => void
  setFormRetryCount: (value: number) => void
  handleHostToggle: (hostId: string) => void
  handleFormChange: (field: string, value: string | string[] | number) => void
  resetForm: () => void
  populateForm: (script: ScriptRecord) => void
}

const initialFormState: ScriptFormState = {
  formName: '',
  formDescription: '',
  formScript: '',
  formHostIds: [],
  formScheduleType: 'manual',
  formScheduleValue: '',
  formTimeout: 60,
  formRetryCount: 0,
}

export function useScriptForm(): UseScriptFormReturn {
  const [formName, setFormName] = useState(initialFormState.formName)
  const [formDescription, setFormDescription] = useState(initialFormState.formDescription)
  const [formScript, setFormScript] = useState(initialFormState.formScript)
  const [formHostIds, setFormHostIds] = useState<string[]>(initialFormState.formHostIds)
  const [formScheduleType, setFormScheduleType] = useState<ScheduleType>(initialFormState.formScheduleType)
  const [formScheduleValue, setFormScheduleValue] = useState(initialFormState.formScheduleValue)
  const [formTimeout, setFormTimeout] = useState(initialFormState.formTimeout)
  const [formRetryCount, setFormRetryCount] = useState(initialFormState.formRetryCount)

  const handleHostToggle = useCallback((hostId: string) => {
    setFormHostIds(prev =>
      prev.includes(hostId)
        ? prev.filter(id => id !== hostId)
        : [...prev, hostId],
    )
  }, [])

  const handleFormChange = useCallback((field: string, value: string | string[] | number) => {
    switch (field) {
      case 'name':
        setFormName(value as string)
        break
      case 'description':
        setFormDescription(value as string)
        break
      case 'script':
        setFormScript(value as string)
        break
      case 'scheduleType':
        setFormScheduleType(value as ScheduleType)
        break
      case 'scheduleValue':
        setFormScheduleValue(value as string)
        break
      case 'timeout':
        setFormTimeout(value as number)
        break
      case 'retryCount':
        setFormRetryCount(value as number)
        break
    }
  }, [])

  const resetForm = useCallback(() => {
    setFormName(initialFormState.formName)
    setFormDescription(initialFormState.formDescription)
    setFormScript(initialFormState.formScript)
    setFormHostIds(initialFormState.formHostIds)
    setFormScheduleType(initialFormState.formScheduleType)
    setFormScheduleValue(initialFormState.formScheduleValue)
    setFormTimeout(initialFormState.formTimeout)
    setFormRetryCount(initialFormState.formRetryCount)
  }, [])

  const populateForm = useCallback((script: ScriptRecord) => {
    setFormName(script.name)
    setFormDescription(script.description || '')
    setFormScript(script.script)
    setFormHostIds(JSON.parse(script.host_ids || '[]'))
    setFormScheduleType(script.schedule_type as ScheduleType)
    setFormScheduleValue(script.schedule_value || '')
    setFormTimeout(script.timeout_seconds)
    setFormRetryCount(script.retry_count)
  }, [])

  return {
    formName,
    formDescription,
    formScript,
    formHostIds,
    formScheduleType,
    formScheduleValue,
    formTimeout,
    formRetryCount,
    setFormName,
    setFormDescription,
    setFormScript,
    setFormHostIds,
    setFormScheduleType,
    setFormScheduleValue,
    setFormTimeout,
    setFormRetryCount,
    handleHostToggle,
    handleFormChange,
    resetForm,
    populateForm,
  }
}
