// ======================================================
// ZERO PLUS GATEWAY — Server
// ملف تشغيل السيرفر
// ======================================================
//
// المسؤوليات:
// 1. استدعاء buildApp() من app.ts
// 2. تشغيل السيرفر على الـ host والـ port من الـ config
// 3. طباعة معلومات واضحة عند التشغيل
// 4. التعامل مع أخطاء الإقلاع
// 5. دعم Graceful Shutdown (موجود أصلًا في app.ts)
//
// ======================================================

import { buildApp } from './app';
import { config } from './config';
import { getRedis } from './services/redis.client';

/**
 * بيشغل الـ Gateway
 */
export async function startServer(): Promise<void> {
  try {
    // 1. نتأكد إن Redis شغال قبل ما نفتح البورت
    console.log('[Server] جاري الاتصال بـ Redis...');
    const redis = getRedis();
    await redis.ping();
    console.log('[Server] Redis متصل بنجاح');

    // 2. نبني الـ App
    console.log('[Server] جاري بناء التطبيق...');
    const app = await buildApp();

    // 3. نشغل السيرفر
    const address = await app.listen({
      port: config.server.port,
      host: config.server.host,
    });

    // 4. طباعة معلومات التشغيل
    printBanner(address);

  } catch (err) {
    console.error('[Server] فشل في تشغيل الـ Gateway:');
    console.error(err);
    process.exit(1);
  }
}

/**
 * طباعة بانر جميل عند التشغيل
 */
function printBanner(address: string): void {
  const line = '─'.repeat(60);

  console.log('\n' + line);
  console.log('  ZERO PLUS GATEWAY');
  console.log('  Adaptive Traffic Security Gateway');
  console.log(line);
  console.log(`  Environment   : ${config.server.nodeEnv}`);
  console.log(`  Listening on  : ${address}`);
  console.log(`  Redis         : ${config.redis.url}`);
  console.log(`  Backend URL   : ${config.backend.url}`);
  console.log(`  AI Service    : ${config.ai.url} ${config.ai.enabled ? '(enabled)' : '(disabled)'}`);
  console.log(`  Clearance TTL : ${config.clearance.ttlSeconds}s`);
  console.log(line);
  console.log('  Health check  : GET /health');
  console.log('  Ready check   : GET /ready');
  if (config.server.isDev) {
    console.log('  Info          : GET /_info');
  }
  console.log(line);
  console.log('  Status: RUNNING  |  Pipeline: SKELETON MODE');
  console.log(line + '\n');
}

export default startServer;