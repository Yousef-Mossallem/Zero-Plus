// frontend/src/utils/notificationSound.ts
// ==================================================================
// Zero Plus - Notification Sound (Web Audio API)
// نبضة خفيفة بدون أي ملف صوت خارجي.
// المتصفحات بتمنع الصوت قبل أول تفاعل من المستخدم (Autoplay Policy)،
// فـ unlockAudio() بتستنى أول click/keypress وتفعّل الـ AudioContext.
// ==================================================================

type AudioCtor = typeof AudioContext

let ctx: AudioContext | null = null
let unlockBound = false

function getContext(): AudioContext | null {
  if (ctx) return ctx
  try {
    const Ctor: AudioCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    return ctx
  } catch {
    return null
  }
}

/** بتتنادى مرة واحدة: أول تفاعل للمستخدم بيفعّل الصوت */
export function unlockAudio(): void {
  if (unlockBound) return
  unlockBound = true

  const unlock = () => {
    const c = getContext()
    if (c && c.state === 'suspended') void c.resume().catch(() => {})
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }

  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

/** نبضة قصيرة. الإشعار الحرج (severity ≥ 4) نغمته أعلى شوية */
export function playNotificationSound(severity = 2): void {
  const c = getContext()
  if (!c) return
  // لو لسه Suspended (مفيش تفاعل) مش هنحاول نشغل بصوت: مفيش خطأ يظهر للمستخدم
  if (c.state === 'suspended') {
    void c.resume().catch(() => {})
    if (c.state === 'suspended') return
  }

  try {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'sine'
    o.frequency.value = severity >= 4 ? 660 : 520
    o.connect(g)
    g.connect(c.destination)

    const t = c.currentTime
    g.gain.setValueAtTime(0.18, t) // مستوى هادي مش مزعج
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
    o.start(t)
    o.stop(t + 0.4)
  } catch {
    /* الصوت إضافة: فشله ماينفعش يكسر التطبيق */
  }
}
