/** Completion helpers and the terminal command completion hook. */
import {
  classifyWord,
  extractCurrentWord,
  findAliasMatches,
  findAllMatches,
  findFunctionMatches,
  findHistoryMatches,
  findPathMatches,
  findSubcommandMatches,
  getWordStart,
  mergeCompletionItems,
} from './command-completion-matching'
import {
  applyCompletion,
  getCompletionTypeLabel,
  getCursorScreenPosition,
  getNextCompletionIndex,
} from './command-completion-terminal'
import type {
  UseCommandCompletionOptions,
  UseCommandCompletionResult,
} from './command-completion-types'

export type {
  CompletionItem,
  CompletionType,
  CursorPosition,
  UseCommandCompletionOptions,
  UseCommandCompletionResult,
} from './command-completion-types'
export {
  applyCompletion,
  classifyWord,
  extractCurrentWord,
  findAliasMatches,
  findAllMatches,
  findFunctionMatches,
  findHistoryMatches,
  findPathMatches,
  findSubcommandMatches,
  getCompletionTypeLabel,
  getCursorScreenPosition,
  getNextCompletionIndex,
  getWordStart,
  mergeCompletionItems,
}

export function useCommandCompletion(
  options: UseCommandCompletionOptions,
): UseCommandCompletionResult {
  const { term, rcItems = [] } = options
  return {
    findMatches: (input: string, cursorPos: number, history: string[]) =>
      findAllMatches(extractCurrentWord(input, cursorPos), history, rcItems),
    getPosition: () => getCursorScreenPosition(term),
    applyCompletion: (
      currentLine: string,
      cursorPos: number,
      completion: string,
    ) => applyCompletion(term, currentLine, cursorPos, completion),
    classifyWord,
  }
}
