// frontend/src/pages/landing/AboutPage.tsx
// ==================================================================
// Zero Plus - About Page (عن المشروع "/about")
// الرؤية • المشكلة • المبادئ • الفصل بين القرار والشرح • التقنيات
// ==================================================================

import { Link } from 'react-router-dom'
import { Eye, Target, Scale, Scan, Users, EyeOff, Cpu, MessageSquareText } from 'lucide-react'

import LandingLayout from './LandingLayout'
import { GradientText, PageHero, SectionHeading, cardClass } from './LandingShared'

// ==================================================================
// Data
// ==================================================================

// المبادئ التي يقوم عليها التصميم
const PRINCIPLES = [
  {
    icon: EyeOff,
    title: 'منطق واضح بدل الصندوق الأسود',
    desc: 'قرار السماح أو الحجب يمر بأقسام معروفة، كل قسم له دور واحد. تقدر تفهم لماذا اتُّخذ أي قرار وتراجعه.',
  },
  {
    icon: Scale,
    title: 'فرصة عادلة لكل جهاز جديد',
    desc: 'لا نسجّل جهازاً إلا عند وقوع حدث سيء فعلي (Lazy Registration). الجهاز الجديد بريء حتى يثبت العكس.',
  },
  {
    icon: Scan,
    title: 'فحص ثقيل لمن يستحقه فقط',
    desc: 'الفحص الأعمق (مثل TLS/JA3/JA4) يُصرف على نسبة صغيرة مشبوهة، فنوفّر الموارد ونقلل التأخير (Latency).',
  },
  {
    icon: Users,
    title: 'خصوصية لا تُساوَم',
    desc: 'بيانات كل شركة تبقى داخل بيئتها المعزولة. المشترك الوحيد هو بصمة التهديد المجرّدة من أي هوية.',
  },
]

// التقنيات المستخدمة في المشروع (مجمّعة حسب الطبقة)
const STACK = [
  { layer: 'Frontend', items: 'React, TypeScript, Vite, Tailwind CSS, Zustand, Recharts' },
  { layer: 'Backend', items: 'Node.js, Express, TypeScript, Socket.io, Zod' },
  { layer: 'Infrastructure', items: 'Docker, Nginx, PostgreSQL, Redis' },
  { layer: 'IoT Simulation', items: 'ESP32 + MicroPython لمحاكاة أجهزة شرعية ومهاجمة' },
]

// ==================================================================
// Component
// ==================================================================

export default function AboutPage() {
  return (
    <LandingLayout>
      {/* ============================================================ */}
      {/* Hero                                                         */}
      {/* ============================================================ */}

      <PageHero
        title={
          <>
            نعيد تنظيم الحماية <GradientText>بطريقة أذكى</GradientText>
          </>
        }
        description="Zero Plus مشروع يهدف لجعل الحماية من هجمات DDoS متاحة وواضحة للشركات الصغيرة والمتوسطة، بدون تكلفة المؤسسات الكبرى وبدون إزعاج الزوار."
      />

      {/* ============================================================ */}
      {/* Vision & Mission                                             */}
      {/* ============================================================ */}

      <section className="mx-auto grid max-w-5xl gap-5 px-6 py-8 md:grid-cols-2">
        <div className={`${cardClass} p-7`}>
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <Eye className="h-5 w-5" />
          </div>
          <h2 className="mb-3 text-xl font-bold text-white">رؤيتنا</h2>
          <p className="leading-relaxed text-slate-400">
            أن تستمر كل خدمة على الإنترنت في العمل حتى وقت الهجوم، وأن يصل
            الزائر الحقيقي إلى الموقع بسلاسة كأن شيئاً لم يحدث.
          </p>
        </div>

        <div className={`${cardClass} p-7`}>
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <Target className="h-5 w-5" />
          </div>
          <h2 className="mb-3 text-xl font-bold text-white">رسالتنا</h2>
          <p className="leading-relaxed text-slate-400">
            تقديم حماية متدرّجة وذكية: نثق بمن يستحق الثقة، ونفحص بعمق من يثير
            الشك، ونشارك المناعة بين العملاء دون المساس بخصوصية أحد.
          </p>
        </div>
      </section>

      {/* ============================================================ */}
      {/* Problem                                                      */}
      {/* ============================================================ */}

      <section className="mx-auto max-w-4xl px-6 py-16">
        <SectionHeading title="لماذا بنينا Zero Plus؟" />

        <div className={`${cardClass} space-y-5 p-8 leading-loose text-slate-300`}>
          <p>
            هجمات DDoS لم تعد ظاهرة هامشية. فقد رصدت Cloudflare نحو 47.1 مليون
            هجوم خلال 2025، بزيادة 121% عن العام السابق، وسُجّل في ديسمبر 2025
            أكبر هجوم في التاريخ بقوة 31.4 تيرابت في الثانية.
          </p>
          <p>
            الأخطر أن هذه الهجمات لم تعد تعتمد على حواسيب مخترقة فقط، بل على
            أجهزة إنترنت الأشياء (IoT) مثل التلفاز الذكي والكاميرات والراوترات
            غير الآمنة، وهي أجهزة موجودة في منازل عادية ويملكها أشخاص لا يعلمون
            أنها تُستغل.
          </p>
          <p>
            أمام الشركات الصغيرة خياران: حلول عالمية مكلفة، أو أنظمة تعتمد على
            CAPTCHA تزعج المستخدمين وتحجب أحياناً زواراً حقيقيين بالخطأ. Zero
            Plus طريق ثالث: حماية تفحص بحسب السمعة، فتبقى سريعة وخفيفة على
            الزائر الحقيقي.
          </p>
        </div>
      </section>

      {/* ============================================================ */}
      {/* Principles                                                   */}
      {/* ============================================================ */}

      <section className="mx-auto max-w-6xl px-6 py-16">
        <SectionHeading title="المبادئ التي نبني عليها" />
        <div className="grid gap-5 md:grid-cols-2">
          {PRINCIPLES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className={`${cardClass} flex gap-4 p-6`}>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="mb-1.5 font-semibold text-white">{title}</h3>
                <p className="text-sm leading-relaxed text-slate-400">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ============================================================ */}
      {/* Decision Engine vs Gemini                                    */}
      {/* ============================================================ */}

      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionHeading
          title="من يقرر، ومن يشرح؟"
          description="فصل واضح بين اتخاذ القرار الأمني وبين صياغته بلغة مفهومة، حتى لا يعتمد أي قرار حساس على خدمة خارجية."
        />
        <div className="grid gap-5 md:grid-cols-2">
          <div className={`${cardClass} border-cyan-500/30 p-7`}>
            <div className="mb-4 flex items-center gap-3">
              <Cpu className="h-5 w-5 text-cyan-400" />
              <h3 className="font-semibold text-white">Zero Plus AI Engine</h3>
            </div>
            <p className="text-sm leading-relaxed text-slate-400">
              محرك القرار مبني ومملوك للمشروع بالكامل. يقرر السماح أو الحجب أو
              الفحص الإضافي لكل طلب، اعتماداً على بيانات الطلب نفسه (IP، بصمة
              الجهاز، السمعة، TLS)، ويعمل دون أي خدمة سحابية خارجية.
            </p>
          </div>

          <div className={`${cardClass} p-7`}>
            <div className="mb-4 flex items-center gap-3">
              <MessageSquareText className="h-5 w-5 text-slate-400" />
              <h3 className="font-semibold text-white">Gemini API</h3>
            </div>
            <p className="text-sm leading-relaxed text-slate-400">
              لا يتخذ أي قرار أمني. دوره يبدأ بعد اتخاذ القرار، لتحويل بيانات
              الحدث إلى جملة أو فقرة مفهومة تظهر في صفحة التقارير ونص الإشعار.
            </p>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* Tech Stack                                                   */}
      {/* ============================================================ */}

      <section className="mx-auto max-w-4xl px-6 py-16">
        <SectionHeading title="التقنيات المستخدمة" />
        <div className={`${cardClass} divide-y divide-white/6`}>
          {STACK.map((s) => (
            <div
              key={s.layer}
              className="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-center sm:gap-6"
            >
              <span className="w-40 shrink-0 font-semibold text-cyan-300" dir="ltr">
                {s.layer}
              </span>
              <span className="text-sm text-slate-400">{s.items}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ============================================================ */}
      {/* CTA                                                          */}
      {/* ============================================================ */}

      <section className="mx-auto max-w-3xl px-6 pt-8 text-center">
        <p className="text-slate-400">عندك سؤال عن المشروع أو تريد تجربة الحماية؟</p>
        <Link
          to="/contact"
          className="mt-5 inline-block rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 hover:brightness-110"
        >
          تواصل معنا
        </Link>
      </section>
    </LandingLayout>
  )
}
