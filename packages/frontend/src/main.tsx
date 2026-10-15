import ReactDOM from 'react-dom/client'
import { startTerminalApp } from './terminal-bootstrap'
import './index.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)
startTerminalApp(root)
