/**
 * Terminal Session Types
 * 会话相关类型定义
 */

import type { Host } from '@/types'

/** 会话信息 */
export interface SessionInfo {
  id: string
  session_type: 'local' | 'ssh'
  is_alive: boolean
  created_at: number
}

/** Shell 输出数据 */
export interface ShellOutput {
  session_id: string
  data: string
  is_stderr: boolean
}

/** 连接结果 */
export interface ConnectionResult {
  success: boolean
  message: string
  sessionId?: string
}

/** 本地会话创建选项 */
export interface LocalSessionOptions {
  cols?: number
  rows?: number
  hostInfo?: {
    id?: string
    name: string
    hostname?: string
    username?: string
  }
}

/** SSH 会话创建选项 (密码认证) */
export interface SshPasswordOptions {
  host: Host
  cols?: number
  rows?: number
}

/** SSH 会话创建选项 (密钥认证) */
export interface SshKeyOptions {
  host: Host
  cols?: number
  rows?: number
}

/** SSH 会话创建选项 (证书认证) */
export interface SshCertOptions {
  host: Host
  cols?: number
  rows?: number
}

/** SSH 会话创建选项 (Agent 认证) */
export interface SshAgentOptions {
  host: Host
  cols?: number
  rows?: number
}

/** Jump Host 配置 */
export interface JumpHostConfig {
  host: string
  port: number
  username: string
  authType: 'password' | 'key' | 'agent' | 'cert'
  password?: string
  privateKey?: string
  /** SSH 证书（OpenSSH 格式 base64 字符串） */
  certificate?: string
  /** 目标主机的认证类型（agent / password / key / cert），为空则沿用主机的 authType */
  targetAuthType?: 'password' | 'key' | 'agent' | 'cert'
}

/** SSH 会话创建选项 (跳板机) */
export interface SshJumpOptions {
  targetHost: Host
  jumpHost: JumpHostConfig
  cols?: number
  rows?: number
}

/** 会话状态 */
export type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

/** Tab 类型 */
export type TabType = 'local' | 'remote' | 'serial'
