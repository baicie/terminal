import { beforeEach, expect, it } from 'vitest'
import { MAX_NOTIFICATIONS, useNotificationStore } from './notification'

beforeEach(() => {
  useNotificationStore.getState().clearAll()
})

it('caps the notification list so a noisy session cannot grow it forever', () => {
  const total = MAX_NOTIFICATIONS + 25
  for (let index = 0; index < total; index++)
    useNotificationStore.getState().addNotification({
      type: 'info',
      title: `notification-${index}`,
      persistent: false,
    })

  const { notifications } = useNotificationStore.getState()
  expect(notifications).toHaveLength(MAX_NOTIFICATIONS)
  expect(notifications[0].title).toBe(`notification-${total - 1}`)
  expect(notifications.some(item => item.title === 'notification-0')).toBe(
    false,
  )
})
