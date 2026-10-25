// ======================================================
// ZERO PLUS GATEWAY — Server
// تشغيل السيرفر + تهيئة Redis + مزامنة الحظر
// ======================================================

import { buildApp } from './app'
import { config } from './config'
import { getRedis } from './services/redis.client'
import {
  syncAllBansFromBackend,
  getLastSyncServerTime,
} from './detection/ban.manager'

const BAN_SYNC_INTERVAL_MS = 60_000

/**
 * تشغيل الـ Gateway
 */
/**
 * تشغيل الـ Gateway
 */
export async function startServer(): Promise<void> {
  try {
    console.log('[Server] Connecting to Redis...')
    const redis = getRedis()
    await redis.ping()
    console.log('[Server] Redis OK')

    // مزامنة الحظر من الباك ← Redis (IP + device)
    try {
      console.log('[Server] Syncing bans from Backend...')
      const { written, serverTime } = await syncAllBansFromBackend()
      console.log(
        `[Server] Ban sync done — written=${written} serverTime=${serverTime}`,
      )
    } catch (err) {
      console.warn(
        '[Server] Ban sync failed (Gateway will still start):',
        (err as Error).message,
      )
    }

    console.log('[Server] Building app...')
    const app = await buildApp()

    // 1️⃣ نقوم بتعريف المتغير الخاص بالتايمر أولاً
    let timer: NodeJS.Timeout

    // 2️⃣ نضع الـ Hook هنا (قبل الـ listen) لحل المشكلة تماماً
    app.addHook('onClose', async () => {
      if (timer) clearInterval(timer)
    })

    // 3️⃣ تشغيل السيرفر والاستماع للطلبات
    const address = await app.listen({
      port: config.server.port,
      host: config.server.host,
    })
    
    printBanner(address)
    
    // 4️⃣ تشغيل المزامنة الدورية بعد نجاح تشغيل السيرفر
    timer = setInterval(() => {
      void (async () => {
        try {
          const since = await getLastSyncServerTime()
          const { written } = await syncAllBansFromBackend(
            since ? { updatedSince: since } : undefined,
          )
          if (written > 0) {
            app.log.info({ written }, 'ban sync incremental')
          }
        } catch (err) {
          app.log.warn({ err }, 'ban sync interval failed')
        }
      })()
    }, BAN_SYNC_INTERVAL_MS)

  } catch (err) {
    console.error('[Server] Failed to start Gateway:')
    console.error(err)
    process.exit(1)
  }
}


function printBanner(address: string): void {
  const line = '─'.repeat(60)
  console.log('\n' + line)
  console.log('  ZERO PLUS GATEWAY')
  console.log('  Adaptive Traffic Security Gateway')
  console.log(line)
  console.log(`  Environment   : ${config.server.nodeEnv}`)
  console.log(`  Listening on  : ${address}`)
  console.log(`  Redis         : ${config.redis.url}`)
  console.log(`  Backend URL   : ${config.backend.url}`)
  console.log(
    `  AI Service    : ${config.ai.url} ${config.ai.enabled ? '(enabled)' : '(disabled)'}`,
  )
  console.log(`  Clearance TTL : ${config.clearance.ttlSeconds}s`)
  console.log(line)
  console.log('  Health        : GET /health')
  console.log('  Ready         : GET /ready')
  if (config.server.isDev) {
    console.log('  Debug FP      : GET /debug/fingerprint')
  }
  console.log(line)
  console.log('  Status: RUNNING')
  console.log(line + '\n')
}

export default startServer