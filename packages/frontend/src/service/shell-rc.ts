/** Shell RC parser and completion service. */
import { invoke } from '@tauri-apps/api/core'
import {
  parseRCContent,
  parseBashAliases,
  parseBashFunctions,
  parseFishAliases,
  parseFishFunctions,
  parsePowerShellAliases,
  parsePowerShellFunctions,
  parseZshAliases,
  parseZshFunctions,
} from './shell-rc-parsers'

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

async function execShellCommand(
  sessionId: string,
  command: string,
  timeoutMs = 5000,
): Promise<ExecResult> {
  return invoke<ExecResult>('session_exec', { sessionId, command, timeoutMs })
}

async function parseRemoteAliases(
  sessionId: string,
  shell: ParsedShellRC['shell'],
): Promise<ShellAlias[]> {
  try {
    const command =
      shell === 'powershell'
        ? 'Get-Alias 2>$null | Where-Object { $_.Name -match "^[a-zA-Z]" } | Select-Object -First 100 | ForEach-Object { "alias $($_.Name)=$($_.Value)" }'
        : shell === 'fish'
          ? 'alias 2>/dev/null | head -100'
          : 'alias 2>/dev/null | grep -E "^alias [a-zA-Z_]" | head -100'
    const result = await execShellCommand(sessionId, command)
    if (result.exit_code !== 0) return []
    const aliases: ShellAlias[] = []
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || (shell !== 'fish' && !trimmed.startsWith('alias ')))
        continue
      if (shell === 'fish') {
        const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s+(.+)$/)
        if (match) aliases.push({ name: match[1], value: match[2], shell })
        continue
      }
      if (shell === 'powershell') {
        const match = trimmed.match(/^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)=(.+)$/)
        if (match) aliases.push({ name: match[1], value: match[2], shell })
        continue
      }
      const singleMatch = trimmed.match(
        /^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)=['](.*)[']$/,
      )
      const doubleMatch = trimmed.match(
        /^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)=["](.*)["]$/,
      )
      const match = singleMatch || doubleMatch
      if (match) aliases.push({ name: match[1], value: match[2], shell })
    }
    return aliases
  } catch {
    return []
  }
}

export interface ParseRCOptions {
  sessionId: string
  sessionType: 'local' | 'ssh'
  shell?: string
}

export async function parseShellRC(
  options: ParseRCOptions,
): Promise<ParsedShellRC> {
  const { sessionId, sessionType, shell = 'bash' } = options
  if (sessionType === 'ssh') return parseRemoteRC(sessionId, shell)
  const home = await getHomeDir()
  const rcPath = expandPath(shell === 'zsh' ? '~/.zshrc' : '~/.bashrc', home)
  try {
    return parseRCContent(
      await readTextFile(rcPath),
      shell as ParsedShellRC['shell'],
    )
  } catch {
    return parseRemoteRC(sessionId, shell)
  }
}

async function parseRemoteRC(
  sessionId: string,
  shell: string,
): Promise<ParsedShellRC> {
  const normalized = shell as ParsedShellRC['shell']
  let aliases: ShellAlias[] = []
  if (normalized === 'bash' || normalized === 'zsh') {
    aliases = await parseRemoteAliases(sessionId, 'zsh')
    if (aliases.length === 0)
      aliases = await parseRemoteAliases(sessionId, 'bash')
  } else if (normalized === 'fish' || normalized === 'powershell') {
    aliases = await parseRemoteAliases(sessionId, normalized)
  }
  return { aliases, functions: [], shell: normalized }
}

export interface RCCompletionItem {
  name: string
  label: string
  type: 'alias' | 'function'
  detail: string
}

export function toCompletionItems(parsed: ParsedShellRC): RCCompletionItem[] {
  return [
    ...parsed.aliases.map(alias => ({
      name: alias.name,
      label: alias.name,
      type: 'alias' as const,
      detail:
        alias.value.length > 40
          ? alias.value.slice(0, 37) + '...'
          : alias.value,
    })),
    ...parsed.functions.map(func => ({
      name: func.name,
      label: func.name,
      type: 'function' as const,
      detail:
        func.body.length > 40 ? func.body.slice(0, 37) + '...' : func.body,
    })),
  ]
}

export function matchRCItems(
  items: RCCompletionItem[],
  prefix: string,
): RCCompletionItem[] {
  if (!prefix) return items.slice(0, 20)
  const lower = prefix.toLowerCase()
  return items
    .filter(item => item.name.toLowerCase().startsWith(lower))
    .slice(0, 20)
}

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

export {
  parseBashAliases,
  parseBashFunctions,
  parseFishAliases,
  parseFishFunctions,
  parsePowerShellAliases,
  parsePowerShellFunctions,
  parseZshAliases,
  parseZshFunctions,
  parseRCContent,
}
