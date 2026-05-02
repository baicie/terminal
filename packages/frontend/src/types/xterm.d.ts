// Type declaration for @baicie/xterm which re-exports @xterm/xterm types
// This resolves the module resolution issue where @baicie/xterm's typings
// incorrectly declare themselves as @xterm/xterm
declare module '@baicie/xterm' {
  export * from '@xterm/xterm'
  export { Terminal } from '@xterm/xterm'
}
