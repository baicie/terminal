import { describe, expect, it } from 'vitest'
import { ExtensionRegistry } from './extension-registry'
import type { BuiltInExtensionManifest } from './extension-manifest'

function manifest(id = 'late'): BuiltInExtensionManifest {
  return { id, nameKey: 'extensions.late.name', version: '1.0.0', apiVersion: 1,
    entry: 'built-in:late', capabilities: ['commands.register'], platforms: ['macos'], defaultEnabled: false }
}
describe('probe3: overlapping deactivates', () => {
  it('shows whether a slow D1 continuation clobbers a later activation', async () => {
    const registry = new ExtensionRegistry({ platform: 'macos' })
    let releaseDispose: () => void = () => undefined
    const gate = new Promise<void>(r => { releaseDispose = r })
    let n = 0
    registry.register(manifest(), ctx => {
      n += 1
      ctx.commands.register({ id: `cmd-${n}`, titleKey: 't', run: async () => undefined })
      // the disposable hangs, simulating a slow teardown
      return { dispose: async () => { await gate } }
    })
    await registry.enable('late')
    const d1 = registry.deactivate('late')   // in flight, awaiting disposal
    await Promise.resolve(); await Promise.resolve()
    const d2 = registry.deactivate('late')   // second, while D1 is mid-dispose
    await d2                                   // D2 completes: status disabled
    const enabled = await registry.enable('late')  // gen 4, registers cmd-3
    console.log('after enable: status', registry.get('late')?.status, 'gen', registry.get('late')?.generation, 'commands', JSON.stringify(registry.commands().map(c=>c.id)))
    releaseDispose()
    await d1
    for (let i = 0; i < 6; i++) await Promise.resolve()
    console.log('enable returned', enabled, 'FINAL status', registry.get('late')?.status,
      'gen', registry.get('late')?.generation, 'commands', JSON.stringify(registry.commands().map(c=>c.id)))
  })
})
