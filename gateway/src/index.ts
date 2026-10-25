// ======================================================
// ZERO PLUS GATEWAY — Entry Point
// npm run dev  |  node dist/index.js
// ======================================================

import { config } from './config'
import { startServer } from './server'

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:')
  console.error(err)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise)
  console.error('Reason:', reason)
  process.exit(1)
})

console.log('[Gateway] Starting Zero Plus Gateway...')
console.log(`[Gateway] Node ${process.version} | PID ${process.pid}`)
console.log(`[Gateway] env=${config.server.nodeEnv}`)

startServer().catch((err) => {
  console.error('[Gateway] Failed to start:')
  console.error(err)
  process.exit(1)
})