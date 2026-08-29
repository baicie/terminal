import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface FrontendPackageManifest {
  dependencies: Record<string, string>
}

describe('xterm core package contract', () => {
  it('pins the WKWebView keyboard-compatible core instead of upstream xterm', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as FrontendPackageManifest

    expect(manifest.dependencies['@baicie/xterm']).toBe('0.1.7')
    expect(manifest.dependencies['@xterm/xterm']).toBeUndefined()
  })

  it('keeps the patched core separate from upstream xterm addons', () => {
    const viteConfig = readFileSync(
      resolve(process.cwd(), 'vite.config.ts'),
      'utf8',
    )

    expect(viteConfig).toContain("/node_modules/@baicie/xterm/")
    expect(viteConfig).not.toContain("/node_modules/@xterm/xterm/")
    expect(viteConfig).toContain("return 'xterm-addons'")
  })
})
