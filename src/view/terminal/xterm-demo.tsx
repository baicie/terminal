import { useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

// ===== 性能测试工具 =====
function perf(name: string, fn: () => void) {
  const start = performance.now()
  fn()
  const ms = performance.now() - start
  if (ms > 5) {
    console.warn(`[perf] ${name}: ${ms.toFixed(2)}ms`)
  }
}

// ===== 测试选项 =====
const TESTS = {
  PLUGINS: 'plugins',
  BATCH_WRITE: 'batch-write',
  BACKEND: 'backend',
} as const
type TestKey = (typeof TESTS)[keyof typeof TESTS]

interface TestConfig {
  label: string
  desc: string
  /** 返回 false 表示不加载此插件 */
  pluginFilter?: (name: string) => boolean
  /** 字符写入方式 */
  writeMode: 'char' | 'batch10' | 'batch100'
  /** 是否加载 WebGL addon */
  webgl: boolean
  /** 是否走 Tauri invoke (需要传入 writeFn) */
  useInvoke?: (data: string, writeFn: (d: string) => void) => void
  writeFn?: (data: string) => void
}

const TEST_CONFIGS: Record<TestKey, TestConfig> = {
  [TESTS.PLUGINS]: {
    label: '基础（无插件）',
    desc: 'Terminal 无任何 addon，纯字符回显',
    writeMode: 'char',
    webgl: false,
  },
  [TESTS.BATCH_WRITE]: {
    label: '批量写入',
    desc: '10字符一批写入 vs 每字符写入',
    writeMode: 'batch10',
    webgl: false,
  },
  [TESTS.BACKEND]: {
    label: 'Tauri invoke',
    desc: '每字符触发 invoke (模拟 local_write)，测试 IPC 开销',
    writeMode: 'char',
    webgl: false,
    useInvoke: (_data, writeFn) => writeFn(_data),
    writeFn: data => {
      const { invoke } = require('@tauri-apps/api/core')
      // @ts-ignore
      invoke('local_write', { sessionId: 'test', data }).catch(() => {})
    },
  },
}

// ===== 可选 addon =====
const AVAILABLE_PLUGINS = [
  { name: 'SearchAddon', pkg: () => import('@xterm/addon-search') },
  { name: 'WebLinksAddon', pkg: () => import('@xterm/addon-web-links') },
  { name: 'Unicode11Addon', pkg: () => import('@xterm/addon-unicode11') },
  { name: 'WebglAddon', pkg: () => import('@xterm/addon-webgl') },
  { name: 'LigaturesAddon', pkg: () => import('@xterm/addon-ligatures') },
]

const XtermDemo: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  // 当前测试配置
  const [activeTest, setActiveTest] = useState<TestKey>(TESTS.PLUGINS)
  // 插件开关
  const [pluginEnabled, setPluginEnabled] = useState<Record<string, boolean>>(
    () => ({
      SearchAddon: false,
      WebLinksAddon: false,
      Unicode11Addon: false,
      WebglAddon: false,
      LigaturesAddon: false,
    }),
  )
  // 加载状态
  const [loaded, setLoaded] = useState(false)
  const loadedPluginsRef = useRef<Record<string, unknown>>({})

  // ===== 动态加载 addon =====
  const loadPlugins = async (term: Terminal) => {
    for (const p of AVAILABLE_PLUGINS) {
      if (pluginEnabled[p.name] && !loadedPluginsRef.current[p.name]) {
        try {
          const mod = await p.pkg()
          const Ctor = Object.values(mod)[0] as new () => object
          if (Ctor) {
            const addon = new Ctor()
            if (p.name === 'WebglAddon') {
              ;(
                addon as { onContextLoss?: (e: unknown) => void }
              ).onContextLoss?.(() =>
                (addon as { dispose?: () => void }).dispose?.(),
              )
            }
            term.loadAddon(addon as Parameters<typeof term.loadAddon>[0])
            loadedPluginsRef.current[p.name] = addon
          }
        } catch (e) {
          console.warn(`Failed to load ${p.name}:`, e)
        }
      } else if (!pluginEnabled[p.name] && loadedPluginsRef.current[p.name]) {
        try {
          ;(
            loadedPluginsRef.current[p.name] as { dispose?: () => void }
          ).dispose?.()
        } catch {}
        delete loadedPluginsRef.current[p.name]
      }
    }
  }

  // ===== 初始化 / 重载终端 =====
  const init = async () => {
    if (termRef.current) {
      termRef.current.dispose()
      termRef.current = null
      setLoaded(false)
    }
    if (!containerRef.current) return

    const cfg = TEST_CONFIGS[activeTest]

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
      allowProposedApi: true,
    })

    termRef.current = term

    // 动态加载插件（热切换插件时不重建终端）
    await loadPlugins(term)

    term.open(containerRef.current)
    setTimeout(() => {
      term.focus()
    }, 50)

    term.write(`\r\n\x1b[36m[TEST: ${cfg.label}]\x1b[0m ${cfg.desc}\r\n`)

    // 字符缓冲（用于 batch 模式）
    let buf = ''

    term.onData(data => {
      const t0 = performance.now()

      // ENTER — 打印并 flush
      if (data === '\r') {
        console.log(
          `[Enter] buffer: "${buf}", took ${(performance.now() - t0).toFixed(2)}ms`,
        )
        buf = ''
        term.write('\r\n')
        term.write('$ ')
        return
      }
      // BACKSPACE
      if (data === '\x7f') {
        buf = buf.slice(0, -1)
        term.write('\b \b')
        return
      }
      // CTRL+C
      if (data === '\x03') {
        console.log(`[Ctrl+C] buffer was: "${buf}"`)
        buf = ''
        term.write('^C')
        return
      }
      // 其他可见字符
      if (data.length === 1 && data >= ' ') {
        buf += data

        // ---- 写入策略 ----
        if (activeTest === TESTS.BATCH_WRITE) {
          // 攒满 10 个字符或 50ms 超时才写
          if (buf.length >= 10) {
            perf('batch-write-10', () => term.write(buf))
            buf = ''
          }
        } else if (activeTest === TESTS.BACKEND) {
          // 模拟 Tauri invoke 开销
          const { invoke } = require('@tauri-apps/api/core') as {
            invoke: (
              cmd: string,
              args: Record<string, unknown>,
            ) => Promise<unknown>
          }
          perf('invoke', () => {
            // @ts-ignore
            invoke('local_write', { sessionId: 'test', data }).catch(() => {})
          })
          // 仍然写 xterm（模拟 PTY echo）
          perf('term-write-char', () => term.write(data))
        } else {
          perf('term-write-char', () => term.write(data))
        }
      }
    })

    setLoaded(true)
  }

  // 插件切换后热更新
  const handlePluginToggle = async (name: string) => {
    setPluginEnabled(prev => ({ ...prev, [name]: !prev[name] }))
    if (termRef.current) {
      await loadPlugins(termRef.current)
    }
  }

  // ===== 渲染 UI =====
  return (
    <div style={{ padding: '24px', fontFamily: 'monospace' }}>
      <h2 style={{ color: '#d4d4d4', marginBottom: '16px' }}>
        Xterm.js 性能测试 Demo
      </h2>

      {/* 测试选择 */}
      <div
        style={{
          marginBottom: '16px',
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        {(Object.values(TESTS) as TestKey[]).map(k => (
          <button
            key={k}
            onClick={() => setActiveTest(k)}
            style={{
              padding: '6px 12px',
              background: activeTest === k ? '#0e639c' : '#333',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {TEST_CONFIGS[k].label}
          </button>
        ))}
      </div>

      {/* 插件开关（仅 PLUGINS 测试时显示） */}
      {activeTest === TESTS.PLUGINS && (
        <div
          style={{
            marginBottom: '16px',
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          {AVAILABLE_PLUGINS.map(p => (
            <label
              key={p.name}
              style={{
                color: '#aaa',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={pluginEnabled[p.name]}
                onChange={() => handlePluginToggle(p.name)}
              />
              {p.name.replace('Addon', '')}
            </label>
          ))}
          <button
            onClick={init}
            style={{
              padding: '6px 12px',
              background: '#333',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            重启终端
          </button>
        </div>
      )}

      {/* 重启按钮（其他测试） */}
      {activeTest !== TESTS.PLUGINS && (
        <div style={{ marginBottom: '16px' }}>
          <button
            onClick={init}
            style={{
              padding: '6px 12px',
              background: '#333',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            重启终端
          </button>
        </div>
      )}

      {/* 终端容器 */}
      <div
        ref={containerRef}
        style={{
          border: '1px solid #333',
          borderRadius: '4px',
          overflow: 'hidden',
          minHeight: '300px',
        }}
      />

      {!loaded && (
        <p style={{ color: '#888', marginTop: '8px' }}>终端加载中...</p>
      )}

      {/* 说明 */}
      <div style={{ marginTop: '24px', color: '#888', fontSize: '12px' }}>
        <p>
          <strong style={{ color: '#ccc' }}>测试说明：</strong>
        </p>
        <ul style={{ paddingLeft: '20px' }}>
          <li>
            <strong>基础（无插件）</strong>：纯 Terminal，无任何
            addon，字符逐个写入
          </li>
          <li>
            <strong>批量写入</strong>：攒满 10 字符才写入，观察批量 vs
            逐字符的性能差异
          </li>
          <li>
            <strong>Tauri invoke</strong>：模拟每字符触发一次{' '}
            <code>invoke("local_write")</code>，观察 IPC 开销
          </li>
          <li>
            <strong>插件开关</strong>：逐个开启 Search/WebGL/Ligatures 等
            addon，观察哪个导致卡顿
          </li>
          <li>
            打开浏览器 DevTools → Console，观察 <code>[perf]</code>{' '}
            警告（&gt;5ms）和 <code>[Enter]</code> 日志
          </li>
          <li>
            如果所有测试都流畅，问题在 <code>terminal-container.tsx</code>{' '}
            的其他逻辑（后端 PTY、事件监听、MobX 等）
          </li>
        </ul>
      </div>
    </div>
  )
}

export default XtermDemo
