/**
 * 列表入场动画工具：在多处 list / grid 渲染中复用。
 *
 * 设计目标：
 * - 统一动画类与延迟节奏，避免每个调用方各写 `animationDelay`
 * - 自动给前 N 项错峰延迟，超出后立即出现，避免长列表后期项目动画僵硬
 *
 * 用法：
 *   const stagger = useStagger()
 *   items.map((item, i) => (
 *     <div key={item.id} {...stagger(i)}>…</div>
 *   ))
 */

const DEFAULT_STEP_MS = 40
const DEFAULT_MAX_INDEX = 8

export type StaggerVariant = 'fade-in-bottom' | 'fade-in-right' | 'fade-in'

const VARIANT_CLASS: Record<StaggerVariant, string> = {
  'fade-in-bottom': 'slide-in-from-bottom fade-in',
  'fade-in-right': 'slide-in-from-right fade-in',
  'fade-in': 'fade-in',
}

interface StaggerOptions {
  variant?: StaggerVariant
  /** 单步增量（毫秒），默认 40ms */
  step?: number
  /** 超过此索引后不再叠加延迟 */
  maxIndex?: number
}

interface StaggerProps {
  className: string
  style?: React.CSSProperties
}

/**
 * 返回一个调用器：传入 index 得到 className/style，可直接 spread 到元素上。
 */
export function useStagger(options: StaggerOptions = {}) {
  const {
    variant = 'fade-in-bottom',
    step = DEFAULT_STEP_MS,
    maxIndex = DEFAULT_MAX_INDEX,
  } = options
  const className = VARIANT_CLASS[variant]

  return (index: number, extraClassName?: string): StaggerProps => {
    const i = Math.min(Math.max(index, 0), maxIndex)
    return {
      className: extraClassName ? `${className} ${extraClassName}` : className,
      style: { animationDelay: `${i * step}ms` },
    }
  }
}

/**
 * 直接计算单个项的动画 props（无需 hook）。
 */
export function staggerProps(
  index: number,
  options: StaggerOptions = {},
): StaggerProps {
  const {
    variant = 'fade-in-bottom',
    step = DEFAULT_STEP_MS,
    maxIndex = DEFAULT_MAX_INDEX,
  } = options
  const i = Math.min(Math.max(index, 0), maxIndex)
  return {
    className: VARIANT_CLASS[variant],
    style: { animationDelay: `${i * step}ms` },
  }
}
