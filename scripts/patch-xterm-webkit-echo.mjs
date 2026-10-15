/**
 * Applies the WebKit double-echo fix to the @baicie/xterm bundles.
 *
 * Root cause: the fork's `_inputEvent` short-circuits on `isWebKitBased` and
 * calls `triggerDataEvent` unconditionally. On WKWebView (Tauri on macOS) the
 * preceding keydown has already sent the same character (and deliberately does
 * not preventDefault so IME/dead keys keep working), so every keystroke is
 * written to the PTY twice - typing `a` renders `aa`.
 *
 * Upstream xterm.js guards this with `ev.composed && this._keyDownSeen`. The
 * fork bypasses that guard, so we restore an equivalent (and stricter) guard by
 * remembering the payload the keydown path already emitted.
 *
 * Usage: node scripts/patch-xterm-webkit-echo.mjs <packageRoot>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const replacements = [
  {
    name: 'keep Escape inside an active IME composition',
    from: `\t\tif (this._isComposing || this._isSendingComposition) {\n\t\t\tif (ev.keyCode === 20 || ev.keyCode === 229) return false;`,
    to: `\t\tif (this._isComposing || this._isSendingComposition) {\n\t\t\tif (ev.keyCode === 27) return false;\n\t\t\tif (ev.keyCode === 20 || ev.keyCode === 229) return false;`,
  },
  {
    name: 'reset the keydown payload marker',
    from: `\t\tthis._keyDownHandled = false;\n\t\tthis._keyDownSeen = true;\n`,
    to: `\t\tthis._keyDownHandled = false;\n\t\tthis._keyDownSeen = true;\n\t\tthis._keyDownSentData = null;\n`,
  },
  {
    name: 'record the payload emitted by the keydown path',
    from: `\t\tthis.coreService.triggerDataEvent(result.key, !wasModifierOnly);\n\t\tif (!this.optionsService.rawOptions.screenReaderMode && isWebKitBased) {`,
    to: `\t\tthis.coreService.triggerDataEvent(result.key, !wasModifierOnly);\n\t\tthis._keyDownSentData = result.key;\n\t\tif (!this.optionsService.rawOptions.screenReaderMode && isWebKitBased) {`,
  },
  {
    name: 'clear the marker on keyup',
    from: `\t_keyUp(ev) {\n\t\tthis._keyDownSeen = false;\n`,
    to: `\t_keyUp(ev) {\n\t\tthis._keyDownSeen = false;\n\t\tthis._keyDownSentData = null;\n`,
  },
  {
    name: 'record the payload emitted by the keypress path',
    from: `\t\tthis.coreService.triggerDataEvent(key, true);\n\t\tthis._keyPressHandled = true;\n`,
    to: `\t\tthis.coreService.triggerDataEvent(key, true);\n\t\tthis._keyDownSentData = key;\n\t\tthis._keyPressHandled = true;\n`,
  },
  {
    name: 'skip the duplicated WebKit input event',
    from: `\t\t\tif (isWebKitBased) {\n\t\t\t\tconsole.debug("[WebKit] _inputEvent processing WebKit input:", ev.data, "_keyDownSeen:", this._keyDownSeen);\n\t\t\t\tthis._unprocessedDeadKey = false;\n\t\t\t\tthis.coreService.triggerDataEvent(ev.data, true);\n\t\t\t\treturn true;\n\t\t\t}`,
    to: `\t\t\tif (isWebKitBased) {\n\t\t\t\tif (this._keyDownSentData === ev.data) {\n\t\t\t\t\tthis._keyDownSentData = null;\n\t\t\t\t\tconsole.debug("[WebKit] _inputEvent skipped duplicate (keydown already sent), data:", ev.data);\n\t\t\t\t\treturn true;\n\t\t\t\t}\n\t\t\t\tthis._keyDownSentData = null;\n\t\t\t\tconsole.debug("[WebKit] _inputEvent processing WebKit input:", ev.data, "_keyDownSeen:", this._keyDownSeen);\n\t\t\t\tthis._unprocessedDeadKey = false;\n\t\t\t\tthis.coreService.triggerDataEvent(ev.data, true);\n\t\t\t\treturn true;\n\t\t\t}`,
  },
]

const packageRoot = process.argv[2]
if (!packageRoot) {
  console.error('usage: node scripts/patch-xterm-webkit-echo.mjs <packageRoot>')
  process.exit(1)
}

for (const file of ['lib/xterm.js', 'lib/xterm.mjs']) {
  const path = join(packageRoot, file)
  let source = readFileSync(path, 'utf8')
  for (const { name, from, to } of replacements) {
    const occurrences = source.split(from).length - 1
    if (occurrences !== 1) {
      throw new Error(
        `${file}: expected 1 occurrence of "${name}", found ${occurrences}`,
      )
    }
    source = source.replace(from, to)
  }
  writeFileSync(path, source)
  console.log(`patched ${file}`)
}
