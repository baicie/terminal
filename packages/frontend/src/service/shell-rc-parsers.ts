import type { ParsedShellRC, ShellAlias, ShellFunction } from './shell-rc'

type Shell = ParsedShellRC['shell']

const quotedAlias = (line: string, shell: Shell): ShellAlias | null => {
  const match =
    line.match(/^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)=['](.*)[']$/) ||
    line.match(/^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)=["](.*)["]$/)
  return match ? { name: match[1], value: match[2], shell } : null
}

export function parseBashAliases(content: string): ShellAlias[] {
  return content.split('\n').flatMap(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return []
    const alias = quotedAlias(trimmed, 'bash')
    return alias ? [alias] : []
  })
}

export function parseZshAliases(content: string): ShellAlias[] {
  return content.split('\n').flatMap(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return []
    const alias = quotedAlias(trimmed, 'zsh')
    return alias ? [alias] : []
  })
}

export function parseFishAliases(content: string): ShellAlias[] {
  return content.split('\n').flatMap(line => {
    const match = line
      .trim()
      .match(/^alias\s+([a-zA-Z_][a-zA-Z0-9_-]*)\s+(.+)$/)
    return match
      ? [{ name: match[1], value: match[2], shell: 'fish' as const }]
      : []
  })
}

export function parsePowerShellAliases(content: string): ShellAlias[] {
  return content.split('\n').flatMap(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//'))
      return []
    const match = trimmed.match(
      /^(?:Set-Alias|New-Alias|Set-Alias)\s+(?:-Name\s+)?([a-zA-Z_][a-zA-Z0-9_-]*)\s+(?:-Value\s+)?([^\s]+)/i,
    )
    return match
      ? [{ name: match[1], value: match[2], shell: 'powershell' as const }]
      : []
  })
}

function parseBraceFunctions(
  content: string,
  shell: Shell,
  matcher: RegExp,
): ShellFunction[] {
  const lines = content.split('\n')
  const functions: ShellFunction[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(matcher)
    if (!match) continue
    const body: string[] = []
    let braces = 0
    let started = false
    for (let j = i; j < Math.min(i + 20, lines.length); j++) {
      for (const char of lines[j]) {
        if (char === '{') {
          braces++
          started = true
        }
        if (char === '}') braces--
      }
      body.push(lines[j])
      if (started && braces === 0) break
    }
    functions.push({
      name: match[1] ?? match[2],
      body: body.join('\n').slice(0, 200),
      shell,
    })
  }
  return functions
}

export function parseBashFunctions(content: string): ShellFunction[] {
  return parseBraceFunctions(
    content,
    'bash',
    /^function\s+([a-zA-Z_][a-zA-Z0-9_-]*)\s*\{|^([a-zA-Z_][a-zA-Z0-9_-]*)\s*\(\)\s*\{/,
  ).map(item => ({
    ...item,
    name: item.name,
  }))
}

export function parseZshFunctions(content: string): ShellFunction[] {
  return parseBashFunctions(content).map(item => ({
    ...item,
    shell: 'zsh' as const,
  }))
}

export function parseFishFunctions(content: string): ShellFunction[] {
  const lines = content.split('\n')
  const functions: ShellFunction[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(/^function\s+([a-zA-Z_][a-zA-Z0-9_-]*)/)
    if (!match) continue
    const body: string[] = []
    let endFound = false
    for (let j = i; j < Math.min(i + 20, lines.length); j++) {
      body.push(lines[j])
      if (lines[j].trim() === 'end') {
        endFound = true
        break
      }
    }
    if (endFound)
      functions.push({
        name: match[1],
        body: body.join('\n').slice(0, 200),
        shell: 'fish',
      })
  }
  return functions
}

export function parsePowerShellFunctions(content: string): ShellFunction[] {
  return parseBraceFunctions(
    content,
    'powershell',
    /^function\s+([a-zA-Z][a-zA-Z0-9]*-[a-zA-Z][a-zA-Z0-9]*)/i,
  )
}

export function parseRCContent(content: string, shell: Shell): ParsedShellRC {
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
