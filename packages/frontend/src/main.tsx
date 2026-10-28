import ReactDOM from 'react-dom/client'
import { startTerminalApp } from './terminal-bootstrap-start'
import './index.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)
const disposeTerminalApp = startTerminalApp(root)

if (import.meta.hot) {
  import.meta.hot.dispose(disposeTerminalApp)
}
