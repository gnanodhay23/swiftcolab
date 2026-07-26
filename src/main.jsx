import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Initialize API service with stored token
import { api } from './services/api.js'
const storedToken = localStorage.getItem('accessToken')
if (storedToken) {
  api.setAccessToken(storedToken)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
