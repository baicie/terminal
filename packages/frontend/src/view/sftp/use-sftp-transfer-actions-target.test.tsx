// R01 的生产接线：**真实的下载入口**有没有把服务器身份传下去。
//
// ## 为什么这条测试必须存在
//
// R01 的核心不变量（同路径并发不得互相认证）只有在传输**带着目标身份**时才有意义。
// 单测可以证明「给了 target 就判得对」，但它证明不了「真实 UI 会给 target」——
// 本仓已经吃过两次这个亏：
//
//   - Phase 10.1 的 DEFECT-1：损坏引用的守卫存在、有单测，真实入口在它之前返回；
//   - Phase 10.2 的 B2/B3：导入链在入口层成立，在效果层断链。
//
// 所以这里驱动的是 `useSftpTransferActions` 这个真实 hook，断言它交给
// `downloadFile` / `uploadPaths` 的参数里**确实有**连接坐标，且坐标来自传入的 host。
//
// 它不验证判断逻辑（那是 `sftp-transfer-target.test.ts` 的事），只验证**传到了**。
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn(async () => undefined),
  uploadPaths: vi.fn(async () => undefined),
  e2eSaveFile: vi.fn(async () => '/tmp/landing.bin'),
  e2eOpenFiles: vi.fn(async () => ['/tmp/pick.bin']),
}))

vi.mock('@/service/sftp-transfer', () => ({
  downloadFile: mocks.downloadFile,
  uploadPaths: mocks.uploadPaths,
}))

vi.mock('./hooks/e2e-file-picker', () => ({
  e2eOpenFiles: mocks.e2eOpenFiles,
  e2eSaveFile: mocks.e2eSaveFile,
  FILE_PICKER_MARKER: 'terminal-e2e-file-picker',
}))

/*
 * The production branch of the picker is `@tauri-apps/plugin-dialog`, which needs a Tauri
 * runtime. jsdom has none, so `invoke` throws inside it — measured as
 * `Cannot read properties of undefined (reading 'invoke')`. Stubbing the plugin is the
 * only way the hook can run here at all; which branch it takes is a build-time constant
 * this suite deliberately does not try to control.
 */
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => ['/tmp/pick.bin']),
  save: vi.fn(async () => '/tmp/landing.bin'),
}))

import { useSftpTransferActions } from './use-sftp-transfer-actions'

const file = {
  name: 'report.pdf',
  path: '/srv/reports/report.pdf',
  size: 2048,
  is_directory: false,
} as never

beforeEach(() => {
  vi.clearAllMocks()
  // The hook picks its picker at call time from the build flag; the E2E branch is mocked
  // in `vitest.config`'s environment? No — the flag is a build-time constant. This suite
  // therefore stubs the module and relies on the production branch being unreachable in
  // jsdom, which is why only the arguments are asserted, not which picker ran.
})

describe('the real transfer entry points carry the server identity', () => {
  it('a download is handed a target built from the host the dock is bound to', async () => {
    const { result } = renderHook(() =>
      useSftpTransferActions({
        sessionId: 'ssh-1',
        remotePath: '/srv/reports',
        connection: {
          hostname: 'deploy.example.com',
          port: 2222,
          username: 'deploy',
        },
      }),
    )

    // The picker is E2E-gated; calling the action directly is the closest the unit layer
    // can get to the click. What matters is the arguments the product passes on.
    await result.current.onDownload(file)

    expect(mocks.downloadFile).toHaveBeenCalledTimes(1)
    const calls = mocks.downloadFile.mock.calls as unknown as Array<
      [
        {
          target?: {
            hostname: string
            port: number
            username: string
            remotePath: string
            localPath?: string
          }
        },
      ]
    >
    /*
     * `localPath` is part of the identity since RC12: two downloads of different remote
     * files onto one local destination overwrite each other, and without the local half
     * their keys differ so neither check can see the other. Asserting the whole object
     * (`toEqual`, not `toMatchObject`) is what keeps that field from disappearing in a
     * future refactor.
     */
    expect(calls[0][0].target).toEqual({
      hostname: 'deploy.example.com',
      port: 2222,
      username: 'deploy',
      // The per-file path, not the directory the pane is showing.
      remotePath: '/srv/reports/report.pdf',
      // Where the bytes land on this machine — the second destination.
      localPath: '/tmp/landing.bin',
    })
  })

  it('an upload stamps each file with its own remote path', async () => {
    const { result } = renderHook(() =>
      useSftpTransferActions({
        sessionId: 'ssh-1',
        remotePath: '/srv/inbox',
        connection: { hostname: 'h.example.com', port: 22, username: 'u' },
      }),
    )

    await result.current.onUpload()

    expect(mocks.uploadPaths).toHaveBeenCalledTimes(1)
    const calls = mocks.uploadPaths.mock.calls as unknown as Array<
      [{ connection?: { hostname: string; port: number; username: string } }]
    >
    // `uploadPaths` fans out to one `uploadFile` per local file, so the coordinates travel
    // as a single connection and each file's own remote path completes the target inside
    // that fan-out (`sftp-transfer.ts`).
    expect(calls[0][0].connection).toEqual({
      hostname: 'h.example.com',
      port: 22,
      username: 'u',
    })
  })

  it('a host without coordinates passes no target, not a fabricated one', async () => {
    // A local-only pane, or a host whose identity is not known yet. Fabricating
    // `localhost:0:''` would make two unrelated targets collide under one key.
    const { result } = renderHook(() =>
      useSftpTransferActions({
        sessionId: 'ssh-1',
        remotePath: '/srv/x',
        connection: null,
      }),
    )
    await result.current.onDownload(file)

    // `mock.calls[0][0]` is typed as `[]` because the mock's parameter list is inferred as
    // empty; the runtime call has the real arguments.
    const calls = mocks.downloadFile.mock.calls as unknown as Array<
      [{ target?: unknown }]
    >
    expect(calls[0][0].target).toBeUndefined()
  })
})
