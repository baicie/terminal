/**
 * useCommandCompletion Hook
 *
 * Provides command completion utilities for the terminal:
 * - Extract current word at cursor position
 * - Prefix matching against command history
 * - Path autocompletion (file/directory)
 * - Shell subcommand completion (git, docker, npm, etc.)
 * - Position calculation helpers
 */

import type { Terminal as XTerminal } from '@baicie/xterm'
import { invoke } from '@tauri-apps/api/core'
import type { RCCompletionItem } from '../service/shell-rc'

export interface CursorPosition {
  x: number
  y: number
}

// ---------------------------------------------------------------------------
// Known shell subcommands
// ---------------------------------------------------------------------------

type SubcommandMap = Record<string, string[]>

const SHELL_SUBCOMMANDS: SubcommandMap = {
  git: [
    'status', 'add', 'commit', 'push', 'pull', 'fetch', 'branch', 'checkout',
    'clone', 'init', 'diff', 'log', 'show', 'stash', 'tag', 'merge', 'rebase',
    'reset', 'restore', 'switch', 'worktree', 'bisect', 'grep', 'blame',
  ],
  docker: [
    'run', 'ps', 'pull', 'push', 'images', 'build', 'start', 'stop', 'restart',
    'rm', 'rmi', 'exec', 'logs', 'inspect', 'network', 'volume', '-compose',
    'container', 'image', 'system', 'stats', 'top', 'attach', 'commit', 'cp',
    'create', 'diff', 'export', 'import', 'kill', 'pause', 'port', 'rename',
    'unpause', 'update', 'wait',
  ],
  npm: [
    'install', 'uninstall', 'update', 'init', 'test', 'start', 'run',
    'build', 'dev', 'clean', 'cache', 'publish', 'pack', 'info', 'ls',
    'outdated', 'audit', 'doctor', 'version', 'config', 'link', 'login',
    'logout', 'whoami', 'adduser', 'deprecate', 'dist-tag', 'explore',
    'help', 'search', 'view', 'whoami',
  ],
  pnpm: [
    'add', 'install', 'remove', 'update', 'upgrade', 'remove', 'import',
    'init', 'list', 'outdated', 'prune', 'publish', 'rebuild', 'remove',
    'store', 'test', 'root', 'bin', 'exec', 'dlx', 'patch', 'patch-remove',
  ],
  yarn: [
    'add', 'install', 'remove', 'upgrade', 'up', 'bin', 'cache', 'check',
    'clean', 'config', 'create', 'dedupe', 'dlx', 'exec', 'global', 'help',
    'import', 'info', 'init', 'link', 'node', 'npm', 'outdated', 'owner',
    'pack', 'patches', 'pod', 'prune', 'publish', 'remove', 'run', 'search',
    'stage', 'start', 'team', 'test', 'unlink', 'upgrade', 'up', 'version',
    'versions', 'why', 'workspace', 'workspaces',
  ],
  kubectl: [
    'get', 'describe', 'create', 'apply', 'delete', 'edit', 'label',
    'annotate', 'scale', 'rollout', 'logs', 'exec', 'port-forward',
    'cp', 'top', 'autoscale', 'drain', 'cordon', 'uncordon',
    'taint', 'explain', 'diff', 'replace', 'patch', 'set',
    'expose', 'run', 'attach', 'debug', 'alpha', 'beta', 'api-resources',
    'api-versions', 'cluster-info', 'config', 'completion', 'ctx', 'kustomize',
  ],
  cargo: [
    'build', 'check', 'test', 'run', 'bench', 'doc', 'publish', 'update',
    'clean', 'fmt', 'clippy', 'fix', 'generate-lockfile', 'metadata', 'pkgid',
    'tree', 'add', 'remove', 'update', 'install', 'uninstall', 'search',
    'login', 'logout', 'owner', 'yank', 'search', 'package',
  ],
  go: [
    'run', 'build', 'test', 'get', 'mod', 'fmt', 'vet', 'install', 'clean',
    'doc', 'bug', 'env', 'fmt', 'generate', 'get', 'help', 'install', 'list',
    'mod', 'run', 'test', 'tool', 'version', 'vet', 'work',
  ],
  python: [
    'install', 'uninstall', 'freeze', 'list', 'show', 'check', 'config',
    'debugpy', 'pip', 'python', 'pyvenv',
  ],
  pip: [
    'install', 'uninstall', 'freeze', 'list', 'show', 'check', 'search',
    'install', 'download', 'cache', 'index', 'wheel',
  ],
  bun: [
    'install', 'add', 'remove', 'update', 'upgrade', 'build', 'dev', 'start',
    'test', 'create', 'run', 'exec', 'x', 'pm', 'outdated', 'link', 'unlink',
    'login', 'logout', 'publish',
  ],
  ssh: [
    '-v', '-vv', '-vvv', '-L', '-R', '-D', '-N', '-f', '-g', '-o',
  ],
  sudo: [
    '-u', '-s', '-i', '-n', '-l', '-k', '-e',
  ],
  make: [
    '-f', '-n', '-j', '-k', '-s', '-B', '-C', '-I', '-W',
  ],
  tmux: [
    'new', 'kill', 'ls', 'detach', 'attach', 'send-keys', 'split',
    'select', 'resize', 'swap', 'rename', 'kill-server',
  ],
  systemctl: [
    'start', 'stop', 'restart', 'reload', 'status', 'enable', 'disable',
    'daemon-reload', 'is-active', 'is-enabled', 'mask', 'unmask',
  ],
  ls: [
    '-a', '-l', '-h', '-R', '-t', '-S', '-r', '-d', '-1',
  ],
  grep: [
    '-r', '-i', '-v', '-n', '-l', '-c', '-w', '-o', '-A', '-B', '-E',
  ],
  find: [
    '-name', '-type', '-path', '-regex', '-mtime', '-size', '-exec',
    '-delete', '-print', '-depth', '-maxdepth', '-mindepth',
  ],
  chmod: [
    '+x', '-x', '777', '755', '644', '600', '400', '700',
  ],
  chown: [
    '-R', '-v',
  ],
  ps: [
    'aux', '-e', '-f', '-u',
  ],
  kill: [
    '-9', '-15', '-l', '-s',
  ],
}

const SUBCOMMAND_COMMANDS = new Set(Object.keys(SHELL_SUBCOMMANDS))

// ---------------------------------------------------------------------------
// Completion types
// ---------------------------------------------------------------------------

export type CompletionType = 'history' | 'subcommand' | 'path' | 'snippet' | 'alias' | 'function'

export interface CompletionItem {
  /** The full completion text */
  text: string
  /** Human-readable label shown in the overlay */
  label: string
  /** Category for display */
  type: CompletionType
}

// ---------------------------------------------------------------------------
// Word extraction
// ---------------------------------------------------------------------------

/**
 * Extract the current word (prefix) from the input line at cursor position.
 * The word is defined as continuous non-whitespace characters ending at cursor.
 */
export function extractCurrentWord(input: string, cursorPos: number): string {
  let start = cursorPos
  while (start > 0 && input[start - 1] !== ' ' && input[start - 1] !== '\t') {
    start--
  }
  return input.slice(start, cursorPos)
}

/**
 * Get the start position of the current word in the input line.
 */
export function getWordStart(input: string, cursorPos: number): number {
  let start = cursorPos
  while (start > 0 && input[start - 1] !== ' ' && input[start - 1] !== '\t') {
    start--
  }
  return start
}

// ---------------------------------------------------------------------------
// Word classification
// ---------------------------------------------------------------------------

/**
 * Classify the current word to determine what kind of completion to offer.
 */
export function classifyWord(word: string): 'path' | 'subcommand' | 'history' {
  // Path: starts with / (absolute), ./ or ../ (relative), or ~/ (home)
  if (word.startsWith('/') || word.startsWith('./') || word.startsWith('../') || word.startsWith('~/')) {
    return 'path'
  }

  // Subcommand: word has no spaces and is a known command
  if (!word.includes(' ') && SUBCOMMAND_COMMANDS.has(word)) {
    return 'subcommand'
  }

  return 'history'
}

// ---------------------------------------------------------------------------
// History matching
// ---------------------------------------------------------------------------

/**
 * Find matching commands from history using prefix matching.
 * Returns commands that start with the given prefix (case-insensitive).
 */
export function findHistoryMatches(history: string[], prefix: string): CompletionItem[] {
  if (!prefix) return []
  const lowerPrefix = prefix.toLowerCase()
  return history
    .filter(cmd => cmd.toLowerCase().startsWith(lowerPrefix))
    .slice(0, 20)
    .map(cmd => ({
      text: cmd,
      label: cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd,
      type: 'history' as CompletionType,
    }))
}

// ---------------------------------------------------------------------------
// Path completion (via Tauri fs)
// ---------------------------------------------------------------------------

/**
 * Extract the directory part and basename from a partial path.
 * e.g. "/home/user/doc" -> dir="/home/user", base="doc"
 */
function splitPath(path: string): { dir: string; base: string } {
  // Normalize multiple slashes
  const normalized = path.replace(/\/+/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) {
    return { dir: '/', base: normalized }
  }
  return { dir: normalized.slice(0, lastSlash) || '/', base: normalized.slice(lastSlash + 1) }
}

/**
 * Complete a partial file/directory path.
 * Lists the target directory and returns entries matching the basename prefix.
 */
export async function findPathMatches(pathPrefix: string): Promise<CompletionItem[]> {
  if (!pathPrefix) return []
  const { dir, base } = splitPath(pathPrefix)

  try {
    const entries = await invoke<Array<{ name: string; isDirectory: boolean }>>('plugin:fs|read_dir', {
      path: dir,
    })

    const lowerBase = base.toLowerCase()
    return entries
      .filter(e => e.name.toLowerCase().startsWith(lowerBase))
      .slice(0, 15)
      .map(e => {
        const full = pathPrefix.endsWith('/')
          ? pathPrefix + e.name
          : dir === '/'
            ? '/' + e.name
            : dir + '/' + e.name
        const withSlash = e.isDirectory ? full + '/' : full
        return {
          text: withSlash,
          label: e.name + (e.isDirectory ? '/' : ''),
          type: 'path' as CompletionType,
        }
      })
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Subcommand completion
// ---------------------------------------------------------------------------

/**
 * Find matching subcommands for a known command.
 */
export function findSubcommandMatches(command: string): CompletionItem[] {
  const subs = SHELL_SUBCOMMANDS[command]
  if (!subs) return []
  return subs.map(sub => ({
    text: sub,
    label: sub,
    type: 'subcommand' as CompletionType,
  }))
}

// ---------------------------------------------------------------------------
// Alias / Function completion
// ---------------------------------------------------------------------------

/**
 * Find matching aliases from a list of parsed RC alias items.
 */
export function findAliasMatches(aliasItems: RCCompletionItem[], prefix: string): CompletionItem[] {
  const lower = prefix.toLowerCase()
  return aliasItems
    .filter(a => a.name.toLowerCase().startsWith(lower) && a.type === 'alias')
    .slice(0, 20)
    .map(a => ({
      text: a.name,
      label: a.name,
      type: 'alias' as CompletionType,
    }))
}

/**
 * Find matching functions from a list of parsed RC function items.
 */
export function findFunctionMatches(funcItems: RCCompletionItem[], prefix: string): CompletionItem[] {
  const lower = prefix.toLowerCase()
  return funcItems
    .filter(f => f.name.toLowerCase().startsWith(lower) && f.type === 'function')
    .slice(0, 20)
    .map(f => ({
      text: f.name,
      label: f.name,
      type: 'function' as CompletionType,
    }))
}

// ---------------------------------------------------------------------------
// Unified completion (all types)
// ---------------------------------------------------------------------------

/**
 * Get all completion items for a given word, searching across all sources.
 * Paths are fetched asynchronously. RC items come from parsed shell RC files.
 */
export async function findAllMatches(
  word: string,
  history: string[],
  rcItems?: RCCompletionItem[],
): Promise<CompletionItem[]> {
  if (!word) return []

  // Determine which types to include based on word shape
  const isPath = word.startsWith('/') || word.startsWith('./') || word.startsWith('../') || word.startsWith('~/')

  const items: CompletionItem[] = []

  // Always include history matches
  const historyItems = findHistoryMatches(history, word)
  items.push(...historyItems)

  // Subcommand completion: user typed a known command name
  if (!word.includes(' ') && SUBCOMMAND_COMMANDS.has(word)) {
    const subItems = findSubcommandMatches(word)
    items.push(...subItems)
  }

  // Alias / Function completion from parsed shell RC files
  if (rcItems && rcItems.length > 0) {
    const aliasItems = findAliasMatches(rcItems, word)
    const funcItems = findFunctionMatches(rcItems, word)
    items.push(...aliasItems, ...funcItems)
  }

  // Path completion
  if (isPath && word.length >= 1) {
    const pathItems = await findPathMatches(word)
    // Deduplicate path completions against history items
    const historyTexts = new Set(historyItems.map(h => h.text.toLowerCase()))
    items.push(...pathItems.filter(p => !historyTexts.has(p.text.toLowerCase())))
  }

  // Deduplicate by text
  const seen = new Set<string>()
  return items.filter(item => {
    const key = item.text.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Merge multiple completion lists into a single deduplicated list,
 * prioritizing by preferred type order.
 */
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

// ---------------------------------------------------------------------------
// Cursor position
// ---------------------------------------------------------------------------

/**
 * Get cursor screen position for overlay positioning.
 * Returns pixel coordinates where the completion overlay should appear.
 */
export function getCursorScreenPosition(
  term: XTerminal | null,
): CursorPosition | null {
  if (!term?.element) return null

  try {
    const buffer = term.buffer.active
    const cursorY = buffer.cursorY
    const cursorX = buffer.cursorX

    // Approximate cell dimensions based on typical terminal settings
    const cellWidth = 9
    const cellHeight = 18

    const terminalElement = term.element as HTMLElement
    const rect = terminalElement.getBoundingClientRect()

    const scrollTop = buffer.viewportY
    const actualY = cursorY - scrollTop

    const x = Math.round(rect.left + cursorX * cellWidth)
    const y = Math.round(rect.top + (actualY + 1) * cellHeight)

    return { x, y }
  } catch {
    const rect = term.element?.getBoundingClientRect()
    return {
      x: Math.round((rect?.left ?? 0) + 10),
      y: Math.round((rect?.bottom ?? 0)),
    }
  }
}

// ---------------------------------------------------------------------------
// Apply completion to terminal
// ---------------------------------------------------------------------------

/**
 * Apply a completion to the terminal input.
 * Replaces the current word with the selected completion.
 */
export function applyCompletion(
  term: XTerminal | null,
  currentLine: string,
  cursorPos: number,
  completion: string,
): string {
  if (!term) return currentLine

  const wordStart = getWordStart(currentLine, cursorPos)
  const beforeWord = currentLine.slice(0, wordStart)
  const afterCursor = currentLine.slice(cursorPos)
  const newLine = beforeWord + completion + afterCursor

  term.write('\x1b[H')
  term.write('\x1b[0K')
  term.write(newLine)

  return newLine
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Navigate to next/previous completion item.
 */
export function getNextCompletionIndex(
  current: number,
  total: number,
  shiftKey: boolean,
): number {
  if (total === 0) return 0
  if (shiftKey) {
    return (current - 1 + total) % total
  }
  return (current + 1) % total
}

// ---------------------------------------------------------------------------
// Completion type label
// ---------------------------------------------------------------------------

export function getCompletionTypeLabel(type: CompletionType): string {
  switch (type) {
    case 'history': return 'history'
    case 'subcommand': return 'subcmd'
    case 'path': return 'path'
    case 'snippet': return 'snippet'
    case 'alias': return 'alias'
    case 'function': return 'fn'
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface UseCommandCompletionOptions {
  term: XTerminal | null
  rcItems?: RCCompletionItem[]
}

export interface UseCommandCompletionResult {
  findMatches: (input: string, cursorPos: number, history: string[]) => Promise<CompletionItem[]>
  getPosition: () => CursorPosition | null
  applyCompletion: (currentLine: string, cursorPos: number, completion: string) => string
  classifyWord: (word: string) => 'path' | 'subcommand' | 'history'
}

export function useCommandCompletion(
  options: UseCommandCompletionOptions,
): UseCommandCompletionResult {
  const { term, rcItems = [] } = options

  return {
    findMatches: async (input: string, cursorPos: number, history: string[]) => {
      const word = extractCurrentWord(input, cursorPos)
      return findAllMatches(word, history, rcItems)
    },
    getPosition: () => getCursorScreenPosition(term),
    applyCompletion: (currentLine: string, cursorPos: number, completion: string) =>
      applyCompletion(term, currentLine, cursorPos, completion),
    classifyWord: (word: string) => classifyWord(word),
  }
}
