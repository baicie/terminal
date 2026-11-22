// 认证失败按**结构**分类，而不是按文案猜。
//
// ## 缺陷
//
// Rust 曾经给两件完全不同的事同一个 kind：`authentication_failed`。
//
//   * **凭据被拒绝**：服务器评估了密码或密钥，说了「不」。重发同一份凭据只会被
//     再拒一次。
//   * **认证期的传输故障**：agent socket 连不上、agent 里没有身份、认证通道被重置、
//     认证阶段超时。凭据对不对**还不知道**，退避重连可能真的能解决。
//
// 前端只能靠 `message.includes('timed out')` 这类规则猜，同一句里既有凭据名词又有
// 传输词时必错。实测过的错误方向：`"authentication failed: password
// my-timeout-secret rejected"` 因为含 "timeout" 而走完了整套五次退避，把一份服务器
// 已经拒绝的密码重发五次。
//
// 模块自己的注释写明了正确修法：「结构性修复 —— 给『认证前传输失败』一个独立的
// kind —— 属于 Rust 的错误枚举，不属于字符串匹配」。Rust 现在发三个 kind：
//
//   * `authentication_rejected` —— 终态；
//   * `authentication_transport_failed` —— 走网络退避阶梯；
//   * `host_key_rejected` —— 终态，指向 known_hosts 而不是凭据。
//
// 这些用例钉住「结构优先」：只要 kind 在，文案怎么写都不影响结论。

import { describe, expect, it } from 'vitest'
import { classifyTerminalFailure } from './terminal-session-manager-errors'

/** The shape Rust emits across the IPC boundary. */
const sshError = (kind: string, message: string) => ({ type: kind, message })

describe('authentication failures are classified by kind', () => {
  it('a rejected credential is terminal even when the sentence sounds transient', () => {
    /*
     * The exact string that consumed the whole retry ladder under the old
     * string-matching rules: a credential noun ("password"), a transient word
     * ("timeout"), and the verdict ("rejected") in one sentence.
     */
    const failure = classifyTerminalFailure(
      sshError('authentication_rejected', 'password my-timeout-secret rejected'),
    )
    expect(failure.retryable).toBe(false)
    expect(failure.recovery).toBe('manual')
  })

  it('a transport failure during authentication retries, whatever the wording', () => {
    /*
     * The mirror image: the same words, but the kind says the credential was never
     * evaluated. A user whose VPN dropped should not be told to re-enter a password.
     */
    const failure = classifyTerminalFailure(
      sshError(
        'authentication_transport_failed',
        'authenticate SSH user timed out before its deadline',
      ),
    )
    expect(failure.retryable).toBe(true)
    expect(failure.recovery).toBe('automatic')
  })

  it('a rejected host key is terminal and never blames the credential', () => {
    const failure = classifyTerminalFailure(
      sshError('host_key_rejected', 'the server host key does not match known_hosts'),
    )
    expect(failure.retryable).toBe(false)
    expect(failure.recovery).toBe('manual')
  })

  it('the legacy kind is still understood', () => {
    // A stored error, or a build that predates the split, still reaches this
    // classifier. It stays terminal — the conservative answer.
    const failure = classifyTerminalFailure(
      sshError('authentication_failed', 'the server rejected the password'),
    )
    expect(failure.retryable).toBe(false)
  })

  it('an agent transport failure keeps retrying under the legacy kind too', () => {
    /*
     * The one heuristic that was load-bearing before the split: a local agent that
     * cannot be reached is worth retrying (a locked keychain gets unlocked). This
     * pins that the legacy path still has it, so the structural change did not
     * silently remove a capability users depend on.
     */
    const failure = classifyTerminalFailure(
      sshError('authentication_failed', 'failed to connect SSH agent: no such file'),
    )
    expect(failure.retryable).toBe(true)
  })
})
