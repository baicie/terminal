// @baicie/xterm ships the patched runtime but declares the upstream module name.
declare module '@baicie/xterm' {
  export * from '@xterm/xterm'
  export { Terminal } from '@xterm/xterm'
}
