/**
 * Safe, isolated small volumes for ENOSPC tests.
 *
 * The test must never fill the shared runner root. macOS gets a disposable
 * HFS+ disk image; Linux gets a size-capped tmpfs mount that needs root
 * (passwordless sudo on CI). When neither is available the caller must report
 * a skip, never a pass.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, statfsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function freeBytes(directory) {
  const stats = statfsSync(directory)
  return Number(stats.bavail) * Number(stats.bsize)
}

export function createSmallVolume(sizeMb = 64) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'terminal-enospc-'))
  const mountDir = path.join(base, 'mnt')
  mkdirSync(mountDir)
  const discard = () => rmSync(base, { recursive: true, force: true })

  if (process.platform === 'darwin') {
    const image = path.join(base, 'volume.dmg')
    try {
      execFileSync('hdiutil', [
        'create', '-size', `${sizeMb}m`, '-fs', 'HFS+', '-volname', 'TerminalENOSPC',
        '-quiet', image,
      ], { stdio: 'ignore' })
      execFileSync('hdiutil', [
        'attach', '-nobrowse', '-quiet', '-mountpoint', mountDir, image,
      ], { stdio: 'ignore' })
    } catch (error) {
      discard()
      return { unavailable: 'hdiutil could not create a disposable volume: ' + error.message }
    }
    return {
      kind: 'hdiutil',
      mountDir,
      capacityBytes: freeBytes(mountDir),
      cleanup() {
        try {
          execFileSync('hdiutil', ['detach', '-quiet', mountDir], { stdio: 'ignore' })
        } catch {
          // Best effort: the image is disposable and lives in a temp dir.
        }
        discard()
      },
    }
  }

  if (process.platform === 'linux') {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
    const privileged = (command, args) => (isRoot
      ? execFileSync(command, args, { stdio: 'ignore' })
      : execFileSync('sudo', ['-n', command, ...args], { stdio: 'ignore' }))
    try {
      if (!isRoot) execFileSync('sudo', ['-n', 'true'], { stdio: 'ignore' })
      privileged('mount', ['-t', 'tmpfs', '-o', `size=${sizeMb}m`, 'tmpfs', mountDir])
    } catch (error) {
      discard()
      return { unavailable: 'no mount privilege for a size-capped tmpfs: ' + error.message }
    }
    return {
      kind: 'tmpfs',
      mountDir,
      capacityBytes: freeBytes(mountDir),
      cleanup() {
        try {
          privileged('umount', [mountDir])
        } catch {
          // Best effort.
        }
        discard()
      },
    }
  }

  discard()
  return { unavailable: 'no safe small-volume primitive on ' + process.platform }
}
