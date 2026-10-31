import ReactDOM from 'react-dom/client'
import { traceStage } from './service/database/startup-trace'
import { startTerminalApp } from './terminal-bootstrap-start'
import './index.css'

// First stage of the startup timeline: reaching this line proves the WebView
// loaded the frontend at all. A readiness timeout that reports this stage and
// nothing else is a load problem, not a slow shell.
traceStage('frontend-boot', 'main.tsx evaluated')

const root = ReactDOM.createRoot(document.getElementById('root')!)
const disposeTerminalApp = startTerminalApp(root)

if (import.meta.hot) {
  import.meta.hot.dispose(disposeTerminalApp)
}
