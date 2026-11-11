import type { Host, Tab } from '@/types'

/**
 * What the pane calls the thing it is connected to.
 *
 * Own module because it is the only logic in the header that is not layout: the
 * header file sits at its size limit and this function is a pure `Tab → string`
 * mapping that is worth reading on its own.
 */
export function getSessionTarget(
  props: { tab: Tab, host?: Host },
  t: (key: string) => string,
): string {
  if (props.tab.type === 'serial') {
    const port =
      props.tab.serialConfig?.port?.split(/[/\\]/).pop() ?? props.tab.label
    return `${port} · ${props.tab.serialConfig?.baudRate ?? '?'} bps`
  }
  if (props.tab.type === 'local') return t('sidebar.localTerminal')
  if (props.host) {
    return `${props.host.username}@${props.host.hostname}:${props.host.port}`
  }
  return props.tab.label
}
