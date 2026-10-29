import * as React from 'react'
import type { ErrorInfo as ReactErrorInfo } from 'react'
import { AlertTriangle, Home, RefreshCcw } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  isRouteErrorResponse,
  useNavigate,
  useRouteError,
} from 'react-router-dom'
import { Button } from '@/components/ui/button'

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

type ErrorBoundaryInstance = React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> & {
  reset: () => void
}

class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
      errorInfo: null,
    }
  }

  componentDidCatch(_error: Error, errorInfo: ReactErrorInfo) {
    this.setState({
      errorInfo: { componentStack: errorInfo.componentStack ?? undefined },
    })
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
        <CaughtErrorFallback
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
  onRetry: () => void
  onGoHome: () => void
}

const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  errorInfo,
  prefix = 'error',
  showStack = true,
  onRetry,
  onGoHome,
}) => {
  const { t } = useTranslation()
  const hasStack = showStack && errorInfo?.componentStack

  return (
    <div
      className="flex min-h-full flex-col items-center justify-center gap-4 bg-background px-4 py-8 sm:px-6 sm:py-12"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex size-12 items-center justify-center rounded-md bg-destructive/10 text-destructive">
        <AlertTriangle aria-hidden="true" />
      </div>

      <h2 className="text-center text-xl font-semibold text-foreground">
        {t(`${prefix}.title`, { defaultValue: t('common.errorOccurred') })}
      </h2>

      <p className="max-w-lg break-words text-center text-sm text-muted-foreground">
        {error?.message
          ? t(`${prefix}.message`, { message: error.message })
          : t(`${prefix}.message`, { message: '' })}
      </p>

      {hasStack ? (
        <pre className="max-h-48 w-full max-w-2xl overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted p-4 font-mono text-xs text-muted-foreground">
          {errorInfo.componentStack}
        </pre>
      ) : null}

      <div className="flex w-full max-w-sm flex-col-reverse gap-2 sm:w-auto sm:max-w-none sm:flex-row">
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="w-full sm:w-auto"
        >
          <RefreshCcw data-icon="inline-start" />
          {t(`${prefix}.retry`, { defaultValue: t('common.retry') })}
        </Button>
        <Button size="sm" onClick={onGoHome} className="w-full sm:w-auto">
          <Home data-icon="inline-start" />
          {t(`${prefix}.goHome`, { defaultValue: t('common.goHome') })}
        </Button>
      </div>
    </div>
  )
}

interface CaughtErrorFallbackProps {
  error: Error | null
  errorInfo: ErrorInfo | null
  prefix?: string
  showStack?: boolean
  fallbackPath?: string
  onReset: () => void
}

function CaughtErrorFallback({
  fallbackPath = '/hosts',
  onReset,
  ...props
}: CaughtErrorFallbackProps) {
  const navigate = useNavigate()
  const handleGoHome = useCallback(() => {
    onReset()
    navigate(fallbackPath)
  }, [fallbackPath, navigate, onReset])

  return <ErrorFallback {...props} onRetry={onReset} onGoHome={handleGoHome} />
}

function normalizeRouteError(routeError: unknown): Error {
  if (routeError instanceof Error) return routeError
  if (isRouteErrorResponse(routeError)) {
    const status = `${routeError.status} ${routeError.statusText}`.trim()
    const message =
      typeof routeError.data === 'string' && routeError.data.trim()
        ? routeError.data
        : status
    return new Error(message || 'Route failed')
  }
  return new Error(
    typeof routeError === 'string' ? routeError : 'Unknown route error',
  )
}

interface RouteErrorBoundaryProps {
  fallbackPath?: string
  onRetry?: () => void
}

export function RouteErrorBoundary({
  fallbackPath = '/hosts',
  onRetry = () => window.location.reload(),
}: RouteErrorBoundaryProps) {
  const routeError = useRouteError()
  const navigate = useNavigate()
  const handleGoHome = useCallback(
    () => navigate(fallbackPath),
    [fallbackPath, navigate],
  )

  return (
    <ErrorFallback
      error={normalizeRouteError(routeError)}
      errorInfo={null}
      onRetry={onRetry}
      onGoHome={handleGoHome}
    />
  )
}

export { ErrorBoundary }
export default ErrorBoundary
