import { useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'

interface RouteTransitionProps {
  children: React.ReactNode
  className?: string
}

/**
 * 轻量路由切换过渡：纯 CSS 位移，避免依赖 framer-motion。
 *
 * key 直接取自当前 pathname，在同一次渲染里换掉容器：更新必须同步发生。
 * 之前用 useEffect 把 pathname 写进 state，导航后的第一帧仍用旧 key 渲染
 * 新页面，effect 再把 key 改掉，于是同一个页面被卸载重挂一次——表现为
 * 切路由时页面闪一下再出现，懒加载路由还会多走一次 Suspense fallback。
 *
 * 容器带 bg-background：非 /terminal 路由背后始终挂着终端层，透明背景会让
 * 终端内容从页面中间透出来（Vault 等未使用 ViewContainer 的页面最明显）。
 * 动画只做位移、不做透明度，否则淡入过程同样会透出背后的终端。
 */
export const RouteTransition: React.FC<RouteTransitionProps> = ({
  children,
  className,
}) => {
  const { pathname } = useLocation()

  return (
    // The opaque layer must not move: a transform on it exposes the terminal
    // layer behind for the duration of the animation. Only the inner content
    // slides, over this background.
    <div
      key={pathname}
      className={cn('route-transition-layer size-full bg-background', className)}
    >
      <div className="route-transition-enter size-full">{children}</div>
    </div>
  )
}
