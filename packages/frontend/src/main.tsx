import ReactDOM from 'react-dom/client'
import {
  bootstrapTerminalApp,
  reportTerminalSmokeBootstrapFailure,
} from './terminal-bootstrap'
import './index.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)
void bootstrapTerminalApp(root).catch(error => {
  console.error('Failed to bootstrap terminal application:', error)
  void reportTerminalSmokeBootstrapFailure(error).catch(reportError => {
    console.error('Failed to report terminal smoke bootstrap error:', reportError)
  })
})
