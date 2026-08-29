import { invoke } from '@tauri-apps/api/core'
import type { RCCompletionItem } from '../service/shell-rc'
import {
  SHELL_SUBCOMMANDS,
  SUBCOMMAND_COMMANDS,
} from './command-completion-data'
import type { CompletionItem, CompletionType } from './command-completion-types'

export function extractCurrentWord(input: string, cursorPos: number): string {
  let start = cursorPos
  while (start > 0 && input[start - 1] !== ' ' && input[start - 1] !== '\t') {
    start--
  }
  return input.slice(start, cursorPos)
}

export function getWordStart(input: string, cursorPos: number): number {
  let start = cursorPos
  while (start > 0 && input[start - 1] !== ' ' && input[start - 1] !== '\t') {
    start--
  }
  return start
}

export function classifyWord(word: string): 'path' | 'subcommand' | 'history' {
  if (
    word.startsWith('/') ||
    word.startsWith('./') ||
    word.startsWith('../') ||
    word.startsWith('~/')
  ) {
    return 'path'
  }
  if (!word.includes(' ') && SUBCOMMAND_COMMANDS.has(word)) {
    return 'subcommand'
  }
  return 'history'
}

export function findHistoryMatches(
  history: string[],
  prefix: string,
): CompletionItem[] {
  if (!prefix) return []
  const lowerPrefix = prefix.toLowerCase()
  return history
    .filter(command => command.toLowerCase().startsWith(lowerPrefix))
    .slice(0, 20)
    .map(command => ({
      text: command,
      label: command.length > 60 ? `${command.slice(0, 57)}...` : command,
      type: 'history' as CompletionType,
    }))
}

function splitPath(path: string): { dir: string; base: string } {
  const normalized = path.replace(/\/+/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return { dir: '/', base: normalized }
  return {
    dir: normalized.slice(0, lastSlash) || '/',
    base: normalized.slice(lastSlash + 1),
  }
}

export async function findPathMatches(
  pathPrefix: string,
): Promise<CompletionItem[]> {
  if (!pathPrefix) return []
  const { dir, base } = splitPath(pathPrefix)

  try {
    const entries = await invoke<Array<{ name: string; isDirectory: boolean }>>(
      'plugin:fs|read_dir',
      { path: dir },
    )
    const lowerBase = base.toLowerCase()
    return entries
      .filter(entry => entry.name.toLowerCase().startsWith(lowerBase))
      .slice(0, 15)
      .map(entry => {
        const full = pathPrefix.endsWith('/')
          ? pathPrefix + entry.name
          : dir === '/'
            ? '/' + entry.name
            : dir + '/' + entry.name
        const text = entry.isDirectory ? `${full}/` : full
        return {
          text,
          label: entry.name + (entry.isDirectory ? '/' : ''),
          type: 'path' as CompletionType,
        }
      })
  } catch {
    return []
  }
}

export function findSubcommandMatches(command: string): CompletionItem[] {
  const subcommands = SHELL_SUBCOMMANDS[command]
  if (!subcommands) return []
  return subcommands.map(subcommand => ({
    text: subcommand,
    label: subcommand,
    type: 'subcommand' as CompletionType,
  }))
}

export function findAliasMatches(
  aliasItems: RCCompletionItem[],
  prefix: string,
): CompletionItem[] {
  const lower = prefix.toLowerCase()
  return aliasItems
    .filter(
      item =>
        item.name.toLowerCase().startsWith(lower) && item.type === 'alias',
    )
    .slice(0, 20)
    .map(item => ({
      text: item.name,
      label: item.name,
      type: 'alias' as CompletionType,
    }))
}

export function findFunctionMatches(
  functionItems: RCCompletionItem[],
  prefix: string,
): CompletionItem[] {
  const lower = prefix.toLowerCase()
  return functionItems
    .filter(
      item =>
        item.name.toLowerCase().startsWith(lower) && item.type === 'function',
    )
    .slice(0, 20)
    .map(item => ({
      text: item.name,
      label: item.name,
      type: 'function' as CompletionType,
    }))
}

export async function findAllMatches(
  word: string,
  history: string[],
  rcItems?: RCCompletionItem[],
): Promise<CompletionItem[]> {
  if (!word) return []
  const isPath =
    word.startsWith('/') ||
    word.startsWith('./') ||
    word.startsWith('../') ||
    word.startsWith('~/')
  const historyItems = findHistoryMatches(history, word)
  const items = [...historyItems]

  if (!word.includes(' ') && SUBCOMMAND_COMMANDS.has(word)) {
    items.push(...findSubcommandMatches(word))
  }
  if (rcItems?.length) {
    items.push(
      ...findAliasMatches(rcItems, word),
      ...findFunctionMatches(rcItems, word),
    )
  }
  if (isPath) {
    const pathItems = await findPathMatches(word)
    const historyTexts = new Set(
      historyItems.map(item => item.text.toLowerCase()),
    )
    items.push(
      ...pathItems.filter(item => !historyTexts.has(item.text.toLowerCase())),
    )
  }

  const seen = new Set<string>()
  return items.filter(item => {
    const key = item.text.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function mergeCompletionItems(
  ...sources: Array<CompletionItem[]>
): CompletionItem[] {
  const seen = new Set<string>()
  const result: CompletionItem[] = []
  for (const source of sources) {
    for (const item of source) {
      const key = `${item.type}:${item.text.toLowerCase()}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push(item)
      }
    }
  }
  return result
}
