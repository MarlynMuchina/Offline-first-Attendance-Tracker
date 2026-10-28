import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './amplifyConfig.js'
import App from './App.jsx'
import { applyTheme, getTheme } from './lib/theme.js'

applyTheme(getTheme())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)