/**
 * Menu entries active extensions placed at `terminal.context`.
 *
 * ## The gap this closes
 *
 * `context.menus.register({ location: 'terminal.context', … })` stored a contribution
 * that **nothing rendered**. The snippet dock registered "capture selection" there, and
 * the only way to reach it was the command palette — with the dock open and text
 * selected, a user had nothing to click. The dock's whole workflow was unreachable
 * through the surface it was designed for.
 *
 * Read on open rather than subscribed: a menu is built fresh each time it appears, and
 * a subscription would re-render the terminal tree every time an extension activates.
 */

import { Puzzle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { getExtensionRegistry } from '@/features/extensions/use-extension-runtime'

export function ExtensionMenuItems() {
  const { t } = useTranslation()
  const items = (() => {
    try {
      const registry = getExtensionRegistry()
      const commands = new Map(registry.commands().map(command => [command.id, command]))
      return registry.menusFor('terminal.context').flatMap(menu => {
        const command = commands.get(menu.commandId)
        return command ? [{ ...menu, title: t(menu.titleKey), run: command.run }] : []
      })
    } catch {
      // No registry yet (a test render, or an early frame): render nothing rather than
      // throwing inside a context menu.
      return []
    }
  })()

  if (items.length === 0) return null
  return (
    <>
      <ContextMenuSeparator />
      {items.map(item => (
        <ContextMenuItem
          key={`${item.extensionId}:${item.commandId}`}
          onSelect={() => void item.run()}
        >
          <Puzzle />
          {item.title}
        </ContextMenuItem>
      ))}
    </>
  )
}

