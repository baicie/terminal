/**
 * Applies the WebKit double-echo fix to the @baicie/xterm bundles.
 *
 * Root cause: the fork's `_inputEvent` short-circuits on `isWebKitBased` and
 * calls `triggerDataEvent` unconditionally. On WKWebView (Tauri on macOS) the
 * preceding keydown has already sent the same character (and deliberately does
 * not preventDefault so IME/dead keys keep working), so every keystroke is
 * written to the PTY twice - typing `a` renders `aa`. WebKit can deliver more
 * than one keydown before the corresponding input events, so the marker is a
 * bounded FIFO instead of a single payload. Option-as-Meta is the exception:
 * its keydown sends an ESC-prefixed sequence, so WebKit's default text action
 * must be prevented or a layout character (for example `ƒ`) is sent as well.
 *
 * Upstream xterm.js guards this with `ev.composed && this._keyDownSeen`. The
 * fork bypasses that guard, so we restore an equivalent (and stricter) guard by
 * remembering the payloads the keydown path already emitted.
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
    name: 'initialize the keydown payload queue',
    from: `\t\tthis._keyDownHandled = false;\n\t\tthis._keyDownSeen = false;\n\t\tthis._keyPressHandled = false;\n`,
    to: `\t\tthis._keyDownHandled = false;\n\t\tthis._keyDownSeen = false;\n\t\tthis._keyPressHandled = false;\n\t\tthis._keyDownSentData = [];\n`,
  },
  {
    name: 'record the payload emitted by the keydown path',
    from: `\t\tthis.coreService.triggerDataEvent(result.key, !wasModifierOnly);\n\t\tif (!this.optionsService.rawOptions.screenReaderMode && isWebKitBased) {`,
    to: `\t\tthis.coreService.triggerDataEvent(result.key, !wasModifierOnly);\n\t\tif (result.key && !/[\\x00-\\x1f\\x7f]/.test(result.key)) {\n\t\t\tthis._keyDownSentData.push({ data: result.key, at: performance.now() });\n\t\t\tif (this._keyDownSentData.length > 32) this._keyDownSentData.shift();\n\t\t}\n\t\tif (!this.optionsService.rawOptions.screenReaderMode && isWebKitBased) {`,
  },
  {
    name: 'keep dead keys and active composition on the native path',
    from: `\t\tconst shouldIgnoreComposition = this.browser.isMac && this.options.macOptionIsMeta && event.altKey;`,
    to: `\t\tconst isOptionDeadKey = this.browser.isMac && this.options.macOptionIsMeta && event.altKey && event.key === "Dead";\n\t\tif (isOptionDeadKey) {\n\t\t\tthis._keyDownHandled = true;\n\t\t\treturn true;\n\t\t}\n\t\tconst wasComposing = event.isComposing || this._compositionHelper.isComposing;\n\t\tconst shouldIgnoreComposition = this.browser.isMac && this.options.macOptionIsMeta && event.altKey && event.key !== "Process" && event.keyCode !== 229 && !wasComposing;`,
  },
  {
    name: 'prevent WebKit default text for Option-as-Meta',
    from: `\t\tif (result.type === KeyboardResultType.SELECT_ALL) this.selectAll();\n\t\tif (this._isThirdLevelShift(this.browser, event)) return true;`,
    to: `\t\tif (result.type === KeyboardResultType.SELECT_ALL) this.selectAll();\n\t\tif (this._isThirdLevelShift(this.browser, event)) return true;\n\t\tconst shouldPreventWebKitOptionText = isWebKitBased && this.browser.isMac && this.options.macOptionIsMeta && event.altKey && event.key !== "Dead" && event.key !== "Process" && event.keyCode !== 229 && !event.isComposing && !wasComposing && Boolean(result.key);\n\t\tif (shouldPreventWebKitOptionText) {\n\t\t\tevent.preventDefault();\n\t\t\tevent.stopPropagation();\n\t\t}`,
  },
  {
    name: 'clear keydown markers when IME composition starts',
    from: `\t\tthis._register(addDisposableListener(this.textarea, "compositionstart", () => {\n\t\t\tthis._syncTextArea();`,
    to: `\t\tthis._register(addDisposableListener(this.textarea, "compositionstart", () => {\n\t\t\tthis._keyDownSentData.length = 0;\n\t\t\tthis._syncTextArea();`,
  },
  {
    name: 'clear keydown markers before paste',
    from: `\t\tconst pasteHandlerWrapper = (event) => handlePasteEvent(event, this.textarea, this.coreService, this.optionsService);`,
    to: `\t\tconst pasteHandlerWrapper = (event) => {\n\t\t\tthis._keyDownSentData.length = 0;\n\t\t\thandlePasteEvent(event, this.textarea, this.coreService, this.optionsService);\n\t\t};`,
  },
  {
    name: 'record the payload emitted by the keypress path',
    from: `\t\tthis.coreService.triggerDataEvent(key, true);\n\t\tthis._keyPressHandled = true;\n`,
    to: `\t\tthis.coreService.triggerDataEvent(key, true);\n\t\tif (!/[\\x00-\\x1f\\x7f]/.test(key)) {\n\t\t\tthis._keyDownSentData.push({ data: key, at: performance.now() });\n\t\t\tif (this._keyDownSentData.length > 32) this._keyDownSentData.shift();\n\t\t}\n\t\tthis._keyPressHandled = true;\n`,
  },
  {
    name: 'clear markers on non-text input events',
    from: `\t_inputEvent(ev) {\n\t\tconsole.debug("[WebKit] _inputEvent called, userAgent:", navigator.userAgent, "isWebKitBased:", isWebKitBased, "data:", ev.data, "inputType:", ev.inputType);`,
    to: `\t_inputEvent(ev) {\n\t\tif (isWebKitBased && ev.inputType !== "insertText") this._keyDownSentData.length = 0;\n\t\tif (isWebKitBased && ev.inputType === "insertText") {\n\t\t\tconst now = performance.now();\n\t\t\tthis._keyDownSentData = this._keyDownSentData.filter((entry) => now - entry.at < 1000);\n\t\t}\n\t\tconsole.debug("[WebKit] _inputEvent called, userAgent:", navigator.userAgent, "isWebKitBased:", isWebKitBased, "data:", ev.data, "inputType:", ev.inputType);`,
  },
  {
    name: 'skip duplicated WebKit input events from the FIFO',
    from: `\t\t\tif (isWebKitBased) {\n\t\t\t\tconsole.debug("[WebKit] _inputEvent processing WebKit input:", ev.data, "_keyDownSeen:", this._keyDownSeen);\n\t\t\t\tthis._unprocessedDeadKey = false;\n\t\t\t\tthis.coreService.triggerDataEvent(ev.data, true);\n\t\t\t\treturn true;\n\t\t\t}`,
    to: `\t\t\tif (isWebKitBased) {\n\t\t\t\tconst duplicateIndex = this._keyDownSentData.findIndex((entry) => entry.data === ev.data);\n\t\t\t\tif (duplicateIndex !== -1) {\n\t\t\t\t\tthis._keyDownSentData.splice(duplicateIndex, 1);\n\t\t\t\t\tconsole.debug("[WebKit] _inputEvent skipped duplicate (keydown already sent), data:", ev.data);\n\t\t\t\t\treturn true;\n\t\t\t\t}\n\t\t\t\tconsole.debug("[WebKit] _inputEvent processing WebKit input:", ev.data, "_keyDownSeen:", this._keyDownSeen);\n\t\t\t\tthis._unprocessedDeadKey = false;\n\t\t\t\tthis.coreService.triggerDataEvent(ev.data, true);\n\t\t\t\treturn true;\n\t\t\t}`,
  },
]

const sensitiveInputDebugStatements = [
  'console.debug("[WebKit] _keyDown called, userAgent:", navigator.userAgent, "isWebKitBased:", isWebKitBased, "key:", event.key);',
  'console.debug("[WebKit] A-Z HACK skipped for non-WebKit, key:", event.key);',
  'console.debug("[Input] _keyDown triggerDataEvent, key:", result.key, "wasModifierOnly:", wasModifierOnly, "isWebKitBased:", isWebKitBased);',
  'console.debug("[WebKit] keydown allow default, key:", event.key);',
  'console.debug("[Input] _keyUp triggerDataEvent, key:", result.key, "wasModifierOnly:", wasModifierOnly);',
  'console.debug("[Input] _keyPress triggerDataEvent, key:", key, "isWebKitBased:", isWebKitBased, "_keyDownHandled:", this._keyDownHandled);',
  'console.debug("[WebKit] _inputEvent called, userAgent:", navigator.userAgent, "isWebKitBased:", isWebKitBased, "data:", ev.data, "inputType:", ev.inputType);',
  'console.debug("[WebKit] _inputEvent skipped duplicate (keydown already sent), data:", ev.data);',
  'console.debug("[WebKit] _inputEvent processing WebKit input:", ev.data, "_keyDownSeen:", this._keyDownSeen);',
  'console.debug("[Input] _inputEvent skip (composed + keyDown seen), data:", ev.data, "composed:", ev.composed, "_keyDownSeen:", this._keyDownSeen);',
  'console.debug("[Input] _inputEvent non-WebKit triggerDataEvent, data:", ev.data, "composed:", ev.composed, "_keyDownSeen:", this._keyDownSeen);',
  'console.debug("[Input] _inputEvent returning false, data:", ev.data, "inputType:", ev.inputType, "screenReaderMode:", this.optionsService.rawOptions.screenReaderMode);',
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
  for (const statement of sensitiveInputDebugStatements) {
    const occurrences = source.split(statement).length - 1
    if (occurrences !== 1) {
      throw new Error(
        `${file}: expected 1 sensitive input debug statement, found ${occurrences}: ${statement}`,
      )
    }
    const statementIndex = source.indexOf(statement)
    const lineStart = source.lastIndexOf('\n', statementIndex) + 1
    const lineEnd = source.indexOf('\n', statementIndex) + 1
    if (!/^[\t ]*$/.test(source.slice(lineStart, statementIndex))) {
      throw new Error(`${file}: debug statement is not alone on its line`)
    }
    source = source.slice(0, lineStart) + source.slice(lineEnd)
  }
  writeFileSync(path, source)
  console.log(`patched ${file}`)
}
