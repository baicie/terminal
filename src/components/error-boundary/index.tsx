import * as React from 'react'
import type { ErrorInfo as ReactErrorInfo } from 'react'
import { AlertTriangle, Home, RefreshCcw } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/app'

export interface ErrorInfo {
  componentStack?: string
}

// 支持通过 window.__resetErrorBoundary__ 从外部触发重置（如 service 层 catch 后）
function setupGlobalReset(boundary: ErrorBoundaryInstance | null) {
  window.__resetErrorBoundary__ = () => boundary?.reset()
}

interface ErrorBoundaryProps {
  /** 包裹的子元素（作为路由 errorElement 时可不传） */
  children?: React.ReactNode
  /** 错误展示的 key 前缀，默认 'error' */
  prefix?: string
  /** 是否显示组件堆栈，默认 true */
  showStack?: boolean
  /** 触发重置后导航到的路径，默认 '/hosts' */
  fallbackPath?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

type ErrorBoundaryInstance = React.Component<ErrorBoundaryProps, ErrorBoundaryState> & {
  reset: () => void
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(
    error: Error,
    errorInfo: ReactErrorInfo,
  ): ErrorBoundaryState {
    return {
      hasError: true,
      error,
      errorInfo: {
        componentStack: errorInfo.componentStack ?? undefined,
      },
    }
  }

  componentDidMount() {
    setupGlobalReset(this)
  }

  componentWillUnmount() {
    setupGlobalReset(null)
  }

  reset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          prefix={this.props.prefix}
          showStack={this.props.showStack}
          fallbackPath={this.props.fallbackPath}
          onReset={this.reset}
        />
      )
    }
    return this.props.children
  }
}

// --- ErrorFallback sub-component ---

interface ErrorFallbackProps {
  error: Error | null
  errorInfo: ErrorInfo | null
  prefix?: string
  showStack?: boolean
  fallbackPath?: string
  onReset: () => void
}

const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  errorInfo,
  prefix = 'error',
  showStack = true,
  fallbackPath = '/hosts',
  onReset,
}) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const theme = useAppStore(s => s.theme)
  const hasStack = showStack && errorInfo?.componentStack

  const handleGoHome = useCallback(() => {
    onReset()
    navigate(fallbackPath)
  }, [onReset, navigate, fallbackPath])

  const handleRetry = useCallback(() => {
    onReset()
  }, [onReset])

  return (
    <div
      className="h-full flex flex-col items-center justify-center px-6 py-12 bg-background fade-in"
      role="alert"
      aria-live="assertive"
    >
      {/* Icon */}
      <div className="mb-6">
        <div
          className={
            theme === 'dark'
              ? 'bg-red-500/10 rounded-full p-4'
              : 'bg-red-50 rounded-full p-4'
          }
        >
          <AlertTriangle
            className="size-10 text-destructive"
            strokeWidth={1.5}
          />
        </div>
      </div>

      {/* Title */}
      <h2
        className="text-xl font-semibold text-foreground mb-2 text-center slide-in-from-bottom fade-in"
        style={{ animationDelay: '50ms' }}
      >
        {t(`${prefix}.title`, { defaultValue: t('common.errorOccurred') })}
      </h2>

      {/* Message */}
      <p
        className="text-sm text-muted-foreground max-w-lg text-center mb-4 slide-in-from-bottom fade-in"
        style={{ animationDelay: '100ms' }}
      >
        {error?.message
          ? t(`${prefix}.message`, { message: error.message })
          : t(`${prefix}.message`, { message: '' })}
      </p>

      {/* Component stack trace */}
      {hasStack && (
        <div
          className="w-full max-w-2xl mb-6 slide-in-from-bottom fade-in"
          style={{ animationDelay: '150ms' }}
        >
          <div
            className={
              theme === 'dark'
                ? 'bg-black/60 rounded-lg p-4 overflow-auto max-h-48 text-xs font-mono text-red-400'
                : 'bg-gray-100 rounded-lg p-4 overflow-auto max-h-48 text-xs font-mono text-red-600'
            }
          >
            <pre className="whitespace-pre-wrap break-all">{errorInfo?.componentStack}</pre>
          </div>
        </div>
      )}

      {/* Actions */}
      <div
        className="flex items-center gap-3 slide-in-from-bottom fade-in"
        style={{ animationDelay: '200ms' }}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={handleRetry}
          className="gap-1.5"
        >
          <RefreshCcw className="size-3.5" data-icon="inline-start" />
          {t(`${prefix}.retry`, { defaultValue: t('common.retry') })}
        </Button>
        <Button variant="default" size="sm" onClick={handleGoHome} className="gap-1.5">
          <Home className="size-3.5" data-icon="inline-start" />
          {t(`${prefix}.goHome`, { defaultValue: t('common.goHome') })}
        </Button>
      </div>
    </div>
  )
}

export { ErrorBoundary }
export default ErrorBoundary
