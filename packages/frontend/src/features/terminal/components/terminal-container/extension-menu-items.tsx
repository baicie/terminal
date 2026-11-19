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
 * ## Why it subscribes rather than reading once
 *
 * The items are read from the registry during render, which is correct on its own. But
 * a menu that is already mounted has no reason to re-render when an extension
 * activates, and the only thing that settles the question is a measurement: the most
 * direct fix for the observed failure was to notify every activation, so this component
 * reacts however the extension was enabled. See the comment on the subscription below.
 */

import { Puzzle } from 'lucide-react'
import { useEffect, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import {
  getExtensionRegistry,
  subscribeExtensionActivations,
} from '@/features/extensions/use-extension-runtime'

export function ExtensionMenuItems() {
  const { t } = useTranslation()
  /*
   * Re-render when an extension is enabled or disabled.
   *
   * The items below are read from the registry during render. Measured on a real
   * WebView run: `menusFor()` returned the entry, the probe agreed the extension was
   * active, and the menu offered only Copy / Paste / Select All / Clear / Find / Zoom —
   * the snippet workflow was unreachable through the surface it registers for. Nothing
   * re-rendered this component after the activation, so subscribing to the registry's
   * change notification is what makes the entry appear without a remount.
   */
  const [, rerender] = useReducer((value: number) => value + 1, 0)
  useEffect(() => subscribeExtensionActivations(rerender), [])
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

