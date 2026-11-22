/**
 * 浮层（对话框/菜单/下拉）的**可见性与可交互性不能由 CSS 动画承担**。
 *
 * ## 缺陷
 *
 * 这些组件的入场类曾经是 `animate-in fade-in-0 zoom-in-95`：
 *
 * - `fade-in-0` 把 `--tw-enter-opacity` 设为 0，opacity 完全交给 `enter` keyframes
 *   推回 1；
 * - Radix 的 `usePresence` 依据 `animationName !== 'none'` 判断「有退场动画」，
 *   并等待 `animationend` 才卸载节点。
 *
 * 在无焦点或离屏的真实 WebView 里，CSS 动画的时间轴不推进。实测（WKWebView，
 * `e2e-03` 的 mkdir / delete 步骤）：
 *
 *     animation: "enter"  animationPlayState: "running"  opacity: "0"
 *
 * 对话框因此在 DOM 里、可聚焦、`elementFromPoint` 命中的是它自己的按钮，而用户
 * **看不到也点不到**。更糟的是关闭时 `animationstart` 已把节点推进
 * `unmountSuspended`，`animationend` 永不到达 —— 全屏 overlay（`z-[210]`）留在
 * 界面上，整个应用看起来死掉。
 *
 * ## 这条测试守什么
 *
 * 断言的是**结构**而不是像素：这几个组件的类字符串里不得出现入场/退场动画类。
 * 之所以能做到，是因为修法就是「不要用动画决定可见性」——如果将来有人为了观感
 * 把它们加回来，这条测试会红，并指向这段说明。
 *
 * 它不替代真实 GUI 验证（动画是否真的推进只有在真实 WebView 里才能观察），它只
 * 保证那条验证不会因为类名被悄悄改回而失效。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const UI_DIR = import.meta.dirname

/** 决定可见性/挂载的动画类。`transition-*` 不在此列：它不阻塞卸载。 */
const GATED_ANIMATION =
  /\b(?:data-\[state=(?:open|closed)\]:)?(?:animate-in|animate-out|fade-in-0|fade-out-0|zoom-in-95|zoom-out-95)\b/

/*
 * `data-[side=…]:slide-in-from-*` is deliberately NOT in the pattern above.
 *
 * Those only set the `--tw-enter-translate-*` variables; they produce no animation on
 * their own (`animation-name` comes solely from `animate-in`). Removing them would
 * change nothing about whether a node mounts or unmounts, so they are not part of the
 * defect this file guards. They are also how Radix menus get their direction-aware
 * motion once someone re-enables animation deliberately.
 */

const OVERLAY_COMPONENTS = [
  'dialog.tsx',
  'alert-dialog.tsx',
  'dropdown-menu.tsx',
  'context-menu.tsx',
  'select.tsx',
]

describe('overlays do not gate visibility on CSS animations', () => {
  for (const file of OVERLAY_COMPONENTS) {
    it(`${file} has no entrance/exit animation class in its markup`, () => {
      const source = readFileSync(path.join(UI_DIR, file), 'utf8')
      /*
       * Only the class strings count. The explanatory comments in these files
       * deliberately quote the old class names, and a check that flagged those would
       * force the explanation to be deleted — which is the opposite of what is wanted.
       */
      /*
       * Only *single-quoted string literals* are inspected. A line-based filter cannot
       * separate prose from class lists — the explanatory comments quote the old class
       * names on purpose, and JSX comment bodies have no leading marker. A quoted
       * literal on a line that also contains `className` or is an entry of one is
       * unambiguous.
       */
      const classStrings = Array.from(source.matchAll(/'([^'\n]*)'/g))
        .map(match => match[1])
        /*
         * Every class list in these files is a long space-separated string; prose is
         * not. Requiring several space-separated tokens keeps the comments out without
         * also filtering the class lists themselves — the first version of this filter
         * matched so little that the assertion passed on the *broken* code, which is
         * the shape this repository has recorded before ("a guard nobody runs").
         */
        .filter(literal => literal.split(' ').filter(Boolean).length >= 3)
        .join('\n')
      // A test that inspects nothing passes for the wrong reason. Fail loudly instead.
      expect(classStrings.length, `${file}: no class list found to inspect`).toBeGreaterThan(80)
      const match = classStrings.match(GATED_ANIMATION)
      expect(
        match?.[0] ?? null,
        `${file} still gates visibility on "${match?.[0]}" — an animation that does ` +
          'not advance leaves the overlay invisible and, on close, never unmounts',
      ).toBeNull()
    })
  }
})
