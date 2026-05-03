/**
 * Shell RC Parser Service
 *
 * Parses shell RC files (.bashrc, .zshrc) and remote shell configurations
 * to extract aliases and functions for command completion.
 *
 * Architecture:
 * - Local sessions: reads RC files directly via Tauri fs plugin
 * - SSH sessions: executes shell commands via `session_exec` to parse RC files
 *
 * Supported shells: bash, zsh, fish, PowerShell
 */

import { invoke } from '@tauri-apps/api/core'

export interface ShellAlias {
  name: string
  value: string
  shell: 'bash' | 'zsh' | 'fish' | 'powershell'
}

export interface ShellFunction {
  name: string
  body: string
  shell: 'bash' | 'zsh' | 'fish' | 'powershell'
}

export interface ParsedShellRC {
  aliases: ShellAlias[]
  functions: ShellFunction[]
  shell: 'bash' | 'zsh' | 'fish' | 'powershell'
}

interface ExecResult {
  stdout: string
  stderr: string
  exit_code: number
}

// ---------------------------------------------------------------------------
// RC file paths by shell
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Alias extraction (pure JS - works for bash/zsh format)
// ---------------------------------------------------------------------------

function parseBashAliases(content: string): ShellAlias[] {
  const aliases: ShellAlias[] = []
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue

    // Match: alias name='value'  or  alias name="value"
    const singleMatch = trimmed.match(/^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)=['](.*)[']$/)
    const doubleMatch = trimmed.match(/^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)=["](.*)["]$/)

    if (singleMatch) {
      aliases.push({ name: singleMatch[1], value: singleMatch[2], shell: 'bash' })
    } else if (doubleMatch) {
      aliases.push({ name: doubleMatch[1], value: doubleMatch[2], shell: 'bash' })
    }
  }

  return aliases
}

function parseZshAliases(content: string): ShellAlias[] {
  const aliases: ShellAlias[] = []
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) continue

    // Zsh also supports alias name='value' with single quotes
    const singleMatch = trimmed.match(/^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)=['](.*)[']$/)
    const doubleMatch = trimmed.match(/^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)=["](.*)["]$/)

    if (singleMatch) {
      aliases.push({ name: singleMatch[1], value: singleMatch[2], shell: 'zsh' })
    } else if (doubleMatch) {
      aliases.push({ name: doubleMatch[1], value: doubleMatch[2], shell: 'zsh' })
    }
  }

  return aliases
}

function parseFishAliases(content: string): ShellAlias[] {
  const aliases: ShellAlias[] = []
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) continue

    // fish: alias name value
    const match = trimmed.match(/^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)\s+(.+)$/)
    if (match) {
      aliases.push({ name: match[1], value: match[2], shell: 'fish' })
    }
  }

  return aliases
}

function parsePowerShellAliases(content: string): ShellAlias[] {
  const aliases: ShellAlias[] = []
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue

    // PowerShell: Set-Alias -Name foo -Value bar  or  New-Alias -Name foo -Value bar
    const setAliasMatch = trimmed.match(
      /^(?:Set-Alias|New-Alias|Set-Alias)\s+(?:-Name\s+)?([a-zA-Z_][a-zA-Z0-9_-]*)\s+(?:-Value\s+)?([^\s]+)/i
    )
    if (setAliasMatch) {
      aliases.push({ name: setAliasMatch[1], value: setAliasMatch[2], shell: 'powershell' })
    }
  }

  return aliases
}

// ---------------------------------------------------------------------------
// Function extraction (pure JS - bash/zsh format)
// ---------------------------------------------------------------------------

function parseBashFunctions(content: string): ShellFunction[] {
  const functions: ShellFunction[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Match: function name {  or  name() {
    const funcMatch = trimmed.match(/^function\s+([a-zA-Z_][a-zA-Z0-9_-]*)\s*\{/)
    const bashMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*\(\)\s*\{/)

    let name: string | null = null
    if (funcMatch) {
      name = funcMatch[1]
    } else if (bashMatch) {
      name = bashMatch[1]
    }

    if (name) {
      // Collect function body (simple: just the next few lines until closing brace)
      const bodyLines: string[] = []
      let braceCount = 0
      let started = false
      for (let j = i; j < Math.min(i + 20, lines.length); j++) {
        const l = lines[j]
        for (const ch of l) {
          if (ch === '{') { braceCount++; started = true }
          if (ch === '}') { braceCount-- }
        }
        bodyLines.push(lines[j])
        if (started && braceCount === 0) break
      }
      functions.push({
        name,
        body: bodyLines.join('\n').slice(0, 200),
        shell: 'bash',
      })
    }
  }

  return functions
}

function parseZshFunctions(content: string): ShellFunction[] {
  // Zsh functions: function name { or name() {
  return parseBashFunctions(content).map(f => ({ ...f, shell: 'zsh' as const }))
}

function parseFishFunctions(content: string): ShellFunction[] {
  const functions: ShellFunction[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // fish: function name
    const match = trimmed.match(/^function\s+([a-zA-Z_][a-zA-Z0-9_-]*)/)
    if (match) {
      const name = match[1]
      const bodyLines: string[] = []
      let endFound = false
      for (let j = i; j < Math.min(i + 20, lines.length); j++) {
        bodyLines.push(lines[j])
        if (lines[j].trim() === 'end') {
          endFound = true
          break
        }
      }
      if (endFound) {
        functions.push({
          name,
          body: bodyLines.join('\n').slice(0, 200),
          shell: 'fish',
        })
      }
    }
  }

  return functions
}

function parsePowerShellFunctions(content: string): ShellFunction[] {
  const functions: ShellFunction[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // PowerShell: function Verb-Noun { ... }
    const match = trimmed.match(/^function\s+([a-zA-Z][a-zA-Z0-9]*-[a-zA-Z][a-zA-Z0-9]*)/i)
    if (match) {
      const name = match[1]
      const bodyLines: string[] = []
      let braceCount = 0
      let started = false
      for (let j = i; j < Math.min(i + 20, lines.length); j++) {
        const l = lines[j]
        for (const ch of l) {
          if (ch === '{') { braceCount++; started = true }
          if (ch === '}') { braceCount-- }
        }
        bodyLines.push(lines[j])
        if (started && braceCount === 0) break
      }
      functions.push({
        name,
        body: bodyLines.join('\n').slice(0, 200),
        shell: 'powershell',
      })
    }
  }

  return functions
}

// ---------------------------------------------------------------------------
// Remote execution via session_exec (for SSH sessions)
// ---------------------------------------------------------------------------

async function execShellCommand(
  sessionId: string,
  command: string,
  timeoutMs = 5000
): Promise<ExecResult> {
  return await invoke<ExecResult>('session_exec', {
    sessionId,
    command,
    timeoutMs,
  })
}

// ---------------------------------------------------------------------------
// Remote RC parsing (via shell command execution)
// ---------------------------------------------------------------------------

async function parseRemoteAliasesZsh(sessionId: string): Promise<ShellAlias[]> {
  try {
    const result = await execShellCommand(
      sessionId,
      "alias 2>/dev/null | grep -E \"^alias [a-zA-Z_]\" | head -100",
      5000
    )
    if (result.exit_code !== 0) return []

    const aliases: ShellAlias[] = []
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('alias ')) continue

      const singleMatch = trimmed.match(/^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)=['](.*)[']$/)
      const doubleMatch = trimmed.match(/^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)=["](.*)["]$/)

      if (singleMatch) {
        aliases.push({ name: singleMatch[1], value: singleMatch[2], shell: 'zsh' })
      } else if (doubleMatch) {
        aliases.push({ name: doubleMatch[1], value: doubleMatch[2], shell: 'zsh' })
      }
    }
    return aliases
  } catch {
    return []
  }
}

async function parseRemoteAliasesBash(sessionId: string): Promise<ShellAlias[]> {
  try {
    const result = await execShellCommand(
      sessionId,
      "alias 2>/dev/null | grep -E \"^alias [a-zA-Z_]\" | head -100",
      5000
    )
    if (result.exit_code !== 0) return []

    const aliases: ShellAlias[] = []
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('alias ')) continue

      const singleMatch = trimmed.match(/^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)=['](.*)[']$/)
      const doubleMatch = trimmed.match(/^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)=["](.*)["]$/)

      if (singleMatch) {
        aliases.push({ name: singleMatch[1], value: singleMatch[2], shell: 'bash' })
      } else if (doubleMatch) {
        aliases.push({ name: doubleMatch[1], value: doubleMatch[2], shell: 'bash' })
      }
    }
    return aliases
  } catch {
    return []
  }
}

async function parseRemoteAliasesFish(sessionId: string): Promise<ShellAlias[]> {
  try {
    const result = await execShellCommand(sessionId, 'alias 2>/dev/null | head -100', 5000)
    if (result.exit_code !== 0) return []

    const aliases: ShellAlias[] = []
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s+(.+)$/)
      if (match) {
        aliases.push({ name: match[1], value: match[2], shell: 'fish' })
      }
    }
    return aliases
  } catch {
    return []
  }
}

async function parseRemoteAliasesPowerShell(sessionId: string): Promise<ShellAlias[]> {
  try {
    const result = await execShellCommand(
      sessionId,
      'Get-Alias 2>$null | Where-Object { $_.Name -match "^[a-zA-Z]" } | Select-Object -First 100 | ForEach-Object { "alias $($_.Name)=$($_.Value)" }',
      5000
    )
    if (result.exit_code !== 0) return []

    const aliases: ShellAlias[] = []
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('alias ')) continue
      const match = trimmed.match(/^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)=(.+)$/)
      if (match) {
        aliases.push({ name: match[1], value: match[2], shell: 'powershell' })
      }
    }
    return aliases
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Main parsing entry point
// ---------------------------------------------------------------------------

export interface ParseRCOptions {
  sessionId: string
  sessionType: 'local' | 'ssh'
  shell?: string
}

export async function parseShellRC(options: ParseRCOptions): Promise<ParsedShellRC> {
  const { sessionId, sessionType, shell = 'bash' } = options

  if (sessionType === 'ssh') {
    return parseRemoteRC(sessionId, shell)
  }

  // Local: parse RC files from disk (via Tauri fs)
  // For now, fall back to a common default path
  const home = await getHomeDir()
  const rcPath = expandPath(shell === 'zsh' ? '~/.zshrc' : '~/.bashrc', home)

  try {
    const content = await readTextFile(rcPath)
    return parseRCContent(content, shell as 'bash' | 'zsh')
  } catch {
    // Fall back to remote parsing for local sessions too
    return parseRemoteRC(sessionId, shell)
  }
}

async function parseRemoteRC(sessionId: string, shell: string): Promise<ParsedShellRC> {
  let aliases: ShellAlias[] = []
  const functions: ShellFunction[] = []

  if (shell === 'zsh' || shell === 'bash') {
    aliases = await parseRemoteAliasesZsh(sessionId)
    if (aliases.length === 0) {
      aliases = await parseRemoteAliasesBash(sessionId)
    }
  } else if (shell === 'fish') {
    aliases = await parseRemoteAliasesFish(sessionId)
  } else if (shell === 'powershell') {
    aliases = await parseRemoteAliasesPowerShell(sessionId)
  }

  return { aliases, functions, shell: shell as ParsedShellRC['shell'] }
}

function parseRCContent(content: string, shell: 'bash' | 'zsh' | 'fish' | 'powershell'): ParsedShellRC {
  let aliases: ShellAlias[] = []
  let functions: ShellFunction[] = []

  if (shell === 'bash') {
    aliases = parseBashAliases(content)
    functions = parseBashFunctions(content)
  } else if (shell === 'zsh') {
    aliases = parseZshAliases(content)
    functions = parseZshFunctions(content)
  } else if (shell === 'fish') {
    aliases = parseFishAliases(content)
    functions = parseFishFunctions(content)
  } else if (shell === 'powershell') {
    aliases = parsePowerShellAliases(content)
    functions = parsePowerShellFunctions(content)
  }

  return { aliases, functions, shell }
}

// ---------------------------------------------------------------------------
// Completion helpers
// ---------------------------------------------------------------------------

export interface RCCompletionItem {
  name: string
  label: string
  type: 'alias' | 'function'
  detail: string
}

export function toCompletionItems(parsed: ParsedShellRC): RCCompletionItem[] {
  const items: RCCompletionItem[] = []

  for (const alias of parsed.aliases) {
    const displayValue = alias.value.length > 40 ? alias.value.slice(0, 37) + '...' : alias.value
    items.push({
      name: alias.name,
      label: alias.name,
      type: 'alias',
      detail: displayValue,
    })
  }

  for (const func of parsed.functions) {
    const displayBody = func.body.length > 40 ? func.body.slice(0, 37) + '...' : func.body
    items.push({
      name: func.name,
      label: func.name,
      type: 'function',
      detail: displayBody,
    })
  }

  return items
}

export function matchRCItems(items: RCCompletionItem[], prefix: string): RCCompletionItem[] {
  if (!prefix) return items.slice(0, 20)
  const lower = prefix.toLowerCase()
  return items.filter(item => item.name.toLowerCase().startsWith(lower)).slice(0, 20)
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function getHomeDir(): Promise<string> {
  try {
    return await invoke<string>('plugin:fs|home_dir')
  } catch {
    return ''
  }
}

function expandPath(path: string, home: string): string {
  return path.replace(/^~\//, home + '/').replace(/^~\$/, home + '\\')
}

async function readTextFile(path: string): Promise<string> {
  try {
    return await invoke<string>('plugin:fs|read_text_file', { path })
  } catch {
    return ''
  }
}
