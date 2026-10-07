// frontend/src/pages/landing/LandingPage.tsx
// ==================================================================
// Zero Plus - Landing Page (الصفحة الرئيسية "/")
// Hero • أرقام المشكلة • المميزات • محرك الفحص • رحلة العميل • CTA
// ==================================================================

import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Layers,
  Fingerprint,
  Network,
  LockKeyhole,
  Zap,
  FileText,
  Check,
  Ban,
  Globe,
  Server,
  Shield,
} from 'lucide-react'

import { useAuthStore, selectIsAuthenticated } from '../../store/authStore'
import LandingLayout from './LandingLayout'
import { GradientText, SectionHeading, cardClass } from './LandingShared'

// ==================================================================
// Data (المحتوى منفصل عن الـ JSX عشان التعديل يبقى سهل)
// ==================================================================

// أرقام المشكلة (من تقرير المشروع)
const STATS = [
  { value: '47.1M', label: 'هجوم DDoS رصدته Cloudflare خلال 2025' },
  { value: '+121%', label: 'زيادة في عدد الهجمات عن العام السابق' },
  { value: '31.4 Tbps', label: 'أكبر هجوم مسجل في تاريخ الإنترنت (ديسمبر 2025)' },
  { value: '~90%', label: 'من الزوار الشرعيين يمرّون بفحص خفيف وسريع' },
]

// المميزات الأساسية
const FEATURES = [
  {
    icon: Layers,
    title: 'فحص متدرّج (Tiered Detection)',
    desc: 'الجهاز الجديد يُعامَل ببساطة، وصاحب التاريخ السيئ يُفحص بعمق أكبر. الفحص الثقيل يُصرف فقط على من يستحقه.',
  },
  {
    icon: Fingerprint,
    title: 'نظام سمعة من 1 إلى 10',
    desc: 'سمعة تراكمية لكل جهاز مبنية على أحداث سيئة فعلية فقط، فيحصل الجهاز الجديد على فرصة عادلة.',
  },
  {
    icon: Zap,
    title: 'تحقق صامت بدون CAPTCHA',
    desc: 'اختبار JS Challenge يعمل داخل المتصفح دون إزعاج الزائر الحقيقي، ويشتد تدريجياً مع ارتفاع الشك.',
  },
  {
    icon: Network,
    title: 'مناعة جماعية (Federated Threat Memory)',
    desc: 'أول عميل يتعرض لهجوم يُحصّن باقي العملاء فوراً، عبر مشاركة بصمة الجهاز المهاجم فقط دون أي بيانات حساسة.',
  },
  {
    icon: LockKeyhole,
    title: 'عزل بيانات صارم (Tenant Isolation)',
    desc: 'كل شركة في بيئة بيانات منفصلة بمفاتيح تشفير خاصة بها. اختراق عميل واحد لا يمتد لأي عميل آخر.',
  },
  {
    icon: FileText,
    title: 'تقارير بلغة بشرية',
    desc: 'ملخص نصي مفهوم لكل حدث أمني، بدل أرقام وجداول خام فقط، مع إشعارات فورية عند أي طارئ.',
  },
]

// أقسام محرك الفحص التسعة (ترتيبها فعلي، فالترقيم هنا معبّر)
const PIPELINE = [
  { name: 'Intake Classifier', role: 'يفرز الطلب: جهاز جديد أم له ملف سابق؟' },
  { name: 'Baseline Verifier', role: 'اختبار JS Challenge صامت للزوار الجدد' },
  { name: 'IP Reputation Scanner', role: 'يكشف الطلبات القادمة من Data Centers' },
  { name: 'Similarity Matcher', role: 'يقارن IP + بصمة الجهاز + الموقع بالسجل' },
  { name: 'Deep Comparison Engine', role: 'مقارنة أعمق عند وجود تطابق أولي' },
  { name: 'Fingerprint Authenticator', role: 'فحص TLS/JA3/JA4 للأجهزة المشبوهة فقط' },
  { name: 'Traffic Orchestrator', role: 'يوزّع الطلبات الآمنة على السيرفرات' },
  { name: 'Adaptive Dashboard Engine', role: 'واجهة تتكيّف مع أسلوب كل مستخدم' },
  { name: 'Isolation & Immunity Manager', role: 'عزل البيانات ونشر المناعة الجماعية' },
]

// رحلة العميل من التسجيل حتى الحماية الفعلية
const STEPS = [
  { title: 'أنشئ حسابك', desc: 'يتكوّن Organization ومعه مستخدم Admin.' },
  { title: 'أضف السيرفر', desc: 'أدخل الـ Domain وعنوان الـ Origin Server والـ Port.' },
  { title: 'غيّر إعدادات DNS', desc: 'نعطيك السجلات المطلوبة ليشير الدومين إلى Zero Plus.' },
  { title: 'نتحقق من الإعداد', desc: 'نتأكد من وصول الـ Gateway والـ Origin معاً.' },
  { title: 'الحماية تعمل', desc: 'كل Traffic يمر عبر Zero Plus قبل وصوله لسيرفرك.' },
]

// أمثلة توضيحية لقرارات المحرك في كارت الـ Hero (ثابتة، للتوضيح فقط)
const DEMO_ROWS = [
  { label: 'زائر جديد · JS Challenge ناجح', allowed: true },
  { label: 'جهاز بسمعة 2 · فحص خفيف', allowed: true },
  { label: 'IP من Data Center · بصمة JA3 مشبوهة', allowed: false },
  { label: 'بصمة معروفة من المناعة الجماعية', allowed: false },
]

// ==================================================================
// Component
// ==================================================================

export default function LandingPage() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated)

  // زر الدعوة الرئيسي: لو مسجل دخول يروح للوحة، غير كده يسجّل حساب
  const ctaTo = isAuthenticated ? '/dashboard' : '/signup'
  const ctaLabel = isAuthenticated ? 'اذهب إلى لوحة التحكم' : 'ابدأ الحماية الآن'

  return (
    <LandingLayout>
      {/* ============================================================ */}
      {/* Hero                                                         */}
      {/* ============================================================ */}

      <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-20 pt-16 lg:grid-cols-2 lg:pt-24">
        {/* النص الرئيسي */}
        <div className="space-y-7">
          <h1 className="text-4xl font-bold leading-[1.25] tracking-tight text-white sm:text-5xl xl:text-6xl">
            احمِ موقعك من هجمات DDoS
            <span className="mt-2 block">
              <GradientText>بحارس يفحص كل زائر بحسب سمعته</GradientText>
            </span>
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-slate-400">
            Zero Plus طبقة وسيطة (Reverse Proxy) بين الزوار وسيرفرك الحقيقي. لا
            تعامل الجميع بنفس القسوة: تبني ذاكرة عن الأجهزة التي رأتها، وتقرر
            بسرعة من يمرّ مباشرة ومن يستحق فحصاً أعمق.
          </p>

          <div className="flex flex-wrap gap-3">
            <Link
              to={ctaTo}
              className="group flex items-center gap-2 rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:brightness-110"
            >
              {ctaLabel}
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            </Link>
            <Link
              to="/about"
              className="rounded-xl border border-white/10 bg-white/3 px-7 py-3.5 text-sm font-medium text-slate-200 hover:border-white/20 hover:bg-white/5"
            >
              تعرّف على المشروع
            </Link>
          </div>
        </div>

        {/* كارت توضيحي: قرارات المحرك على طلبات مختلفة */}
        <div className={`${cardClass} relative overflow-hidden p-6 shadow-2xl shadow-black/40`}>
          <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/60 to-transparent" />

          <div className="mb-5 flex items-center justify-between">
            <h2 className="font-semibold text-white">قرارات المحرك (مثال توضيحي)</h2>
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Protection Active
            </span>
          </div>

          <ul className="space-y-3">
            {DEMO_ROWS.map((row) => (
              <li
                key={row.label}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/2 px-4 py-3 text-sm"
              >
                <span className="text-slate-300">{row.label}</span>
                {/* شارة القرار: سماح (أخضر) أو حظر (أحمر) */}
                <span
                  className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${
                    row.allowed
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-rose-500/10 text-rose-400'
                  }`}
                >
                  {row.allowed ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                  {row.allowed ? 'Allow' : 'Block'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ============================================================ */}
      {/* Stats: لماذا المشكلة حقيقية                                    */}
      {/* ============================================================ */}

      <section className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading
          title="المشكلة تكبر كل عام"
          description="أي جهاز ذكي رخيص وغير آمن في أي منزل قد يصبح سلاحاً في يد طرف ثالث دون علم صاحبه. والحلول التقليدية إما مكلفة جداً أو تزعج الزوار بـ CAPTCHA."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className={`${cardClass} p-6`}>
              <p className="text-3xl font-bold text-white" dir="ltr">
                {s.value}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ============================================================ */}
      {/* Features                                                     */}
      {/* ============================================================ */}

      <section className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading
          title="ماذا يقدّم Zero Plus؟"
          description="حماية أذكى وأوفر في الموارد، بمنطق واضح وقابل للشرح بدل الصندوق الأسود."
        />
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className={`${cardClass} p-6 hover:border-cyan-500/30`}
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mb-2 font-semibold text-white">{title}</h3>
              <p className="text-sm leading-relaxed text-slate-400">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ============================================================ */}
      {/* Pipeline: الأقسام التسعة                                       */}
      {/* ============================================================ */}

      <section className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading
          title="تسعة أقسام، لكل قسم مهمة واحدة"
          description="كل طلب يمر على أقسام متتالية، وكل قسم يمرّر فقط من يستحق المرحلة الأعلى. لذلك يبقى الفحص الثقيل نادراً ومحدداً."
        />
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map((p, i) => (
            <li key={p.name} className={`${cardClass} flex gap-4 p-5`}>
              {/* الرقم هنا معبّر لأن الأقسام بترتيب تنفيذي فعلي */}
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-cyan-400 to-blue-600 text-sm font-bold text-white">
                {i + 1}
              </span>
              <div>
                <h3 className="text-sm font-semibold text-white" dir="ltr">
                  {p.name}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{p.role}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ============================================================ */}
      {/* Before / After: مسار الطلب                                     */}
      {/* ============================================================ */}

      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionHeading
          title="كيف يتغيّر مسار الطلب؟"
          description="لا تحتاج لتثبيت أي برنامج. تغيّر إعداد DNS فقط، ونحن نشغّل البنية التحتية."
        />

        {/* قبل */}
        <div className={`${cardClass} mb-4 p-5`}>
          <p className="mb-3 text-sm font-medium text-slate-400">قبل Zero Plus</p>
          <div className="flex flex-wrap items-center gap-3 text-sm" dir="ltr">
            <FlowNode icon={Globe} label="Internet" />
            <FlowArrow />
            <FlowNode icon={Server} label="Company Server" tone="rose" />
            <span className="text-xs text-rose-400">أي شخص يصل مباشرة</span>
          </div>
        </div>

        {/* بعد */}
        <div className={`${cardClass} border-cyan-500/30 p-5`}>
          <p className="mb-3 text-sm font-medium text-cyan-300">بعد Zero Plus</p>
          <div className="flex flex-wrap items-center gap-3 text-sm" dir="ltr">
            <FlowNode icon={Globe} label="Internet" />
            <FlowArrow />
            <FlowNode icon={Shield} label="Zero Plus" tone="cyan" />
            <FlowArrow />
            <FlowNode icon={Server} label="Company Server" />
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* Steps: رحلة العميل                                             */}
      {/* ============================================================ */}

      <section className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading title="من التسجيل إلى الحماية في خمس خطوات" />
        <ol className="grid gap-4 md:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className={`${cardClass} p-5`}>
              <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-full border border-cyan-500/40 text-sm font-bold text-cyan-300">
                {i + 1}
              </span>
              <h3 className="mb-1.5 text-sm font-semibold text-white">{s.title}</h3>
              <p className="text-xs leading-relaxed text-slate-400">{s.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ============================================================ */}
      {/* Final CTA                                                    */}
      {/* ============================================================ */}

      <section className="mx-auto max-w-4xl px-6 pt-16">
        <div className={`${cardClass} relative overflow-hidden px-8 py-14 text-center`}>
          <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/60 to-transparent" />
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            جاهز تحمي سيرفرك؟
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-400">
            أنشئ حسابك وأضف أول سيرفر محمي، أو تواصل معنا لو عندك أي سؤال.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to={ctaTo}
              className="rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 hover:brightness-110"
            >
              {ctaLabel}
            </Link>
            <Link
              to="/contact"
              className="rounded-xl border border-white/10 px-7 py-3.5 text-sm font-medium text-slate-200 hover:bg-white/5"
            >
              تواصل معنا
            </Link>
          </div>
        </div>
      </section>
    </LandingLayout>
  )
}

// ==================================================================
// Small Local Components (خاصة بقسم مسار الطلب)
// ==================================================================

// عقدة في مسار الطلب (أيقونة + اسم)
function FlowNode({
  icon: Icon,
  label,
  tone = 'slate',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  tone?: 'slate' | 'cyan' | 'rose'
}) {
  // ألوان ثابتة لكل tone (Tailwind لازم يشوف أسماء الكلاسات كاملة)
  const tones = {
    slate: 'border-white/10 bg-white/3 text-slate-200',
    cyan: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  }
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 ${tones[tone]}`}>
      <Icon className="h-4 w-4" />
      {label}
    </div>
  )
}

// سهم بين العقد (ثابت الاتجاه لأن مسار الطلب بالإنجليزي LTR)
function FlowArrow() {
  return <span className="text-slate-600">→</span>
}
