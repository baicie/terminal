import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'

interface RouteTransitionProps {
  children: React.ReactNode
  className?: string
}

/**
 * 轻量路由切换过渡：纯 CSS opacity + 微位移，避免依赖 framer-motion。
 * 注意：不复用 children（不切换 key），仅在 pathname 变化时给容器加一次入场动画。
 */
export const RouteTransition: React.FC<RouteTransitionProps> = ({
  children,
  className,
}) => {
  const location = useLocation()
  const [animKey, setAnimKey] = useState(location.pathname)
  const prevPathRef = useRef(location.pathname)

  useEffect(() => {
    // 仅 pathname 变化时触发，忽略 search/hash 改动（如 ?tab=...）
    if (location.pathname !== prevPathRef.current) {
      prevPathRef.current = location.pathname
      setAnimKey(location.pathname)
    }
  }, [location.pathname])

  return (
    <div
      key={animKey}
      className={cn('route-transition-enter h-full w-full', className)}
    >
      {children}
    </div>
  )
}
