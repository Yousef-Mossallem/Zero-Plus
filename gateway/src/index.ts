// ======================================================
// ZERO PLUS GATEWAY — Entry Point
// نقطة الدخول الرئيسية
// ======================================================
//
// هذا هو الملف اللي بيتنفذ لما تكتب:
//   npm run dev
//   أو
//   node dist/index.js
//
// المسؤوليات:
// 1. تحميل الـ config بدري (عشان الـ validation يشتغل)
// 2. استدعاء startServer()
// 3. التعامل مع أي Uncaught Exceptions / Unhandled Rejections
//
// ======================================================

import { config } from './config';          // مهم: يتحمل الأول عشان الـ validation
import { startServer } from './server';

// ======================================================
// Global Error Handlers
// ======================================================

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:');
  console.error(err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

// ======================================================
// Start
// ======================================================

console.log('[Gateway] Starting Zero Plus Gateway...');
console.log(`[Gateway] Node ${process.version} | PID ${process.pid}`);

startServer().catch((err) => {
  console.error('[Gateway] Failed to start:');
  console.error(err);
  process.exit(1);
});