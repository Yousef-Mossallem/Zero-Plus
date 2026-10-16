// frontend/src/main.tsx

// ==================================================================
// Zero Plus - Application Entry Point
// نقطة الدخول الأساسية للتطبيق - React بيتشغل من هنا
// ==================================================================

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { ToastProvider } from './components/ui/Toast'

import './index.css'

// ------------------------------------------------------------------
// Mount React App
// ------------------------------------------------------------------

// بيدور على عنصر <div id="root"></div> في index.html
// وبيحط التطبيق كله جواه.

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error(
    '❌ Root element not found. Make sure index.html has <div id="root"></div>',
  )
}

createRoot(rootElement).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
)