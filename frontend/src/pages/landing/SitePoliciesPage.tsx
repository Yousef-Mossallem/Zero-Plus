// frontend/src/pages/landing/SitePoliciesPage.tsx
// ==================================================================
// Zero Plus - Public Policies Page (السياسات "/legal")
// تبويبات: Privacy Policy • Terms of Service • Security & Data Isolation
//
// ملحوظات:
// - اسم الملف SitePoliciesPage عشان ميتعارضش مع PoliciesPage بتاع الـ
//   Dashboard (المعلّق في AppRouter على مسار /policies).
// - النصوص صياغة مبدئية مبنية على تصميم المشروع، ويُفضّل مراجعتها
//   قانونياً قبل الإطلاق الفعلي.
// - التبويب النشط بيتحكم فيه الرابط: /legal?tab=privacy|terms|security
// ==================================================================

import { useSearchParams } from 'react-router-dom'
import { ShieldCheck, FileText, LockKeyhole } from 'lucide-react'

import LandingLayout from './LandingLayout'
import { GradientText, PageHero, cardClass } from './LandingShared'

// ==================================================================
// Types
// ==================================================================

// قسم داخل السياسة: عنوان + فقرة اختيارية + نقاط اختيارية
interface PolicySection {
  heading: string
  body?: string
  points?: string[]
}

interface Policy {
  id: 'privacy' | 'terms' | 'security'
  label: string
  icon: React.ComponentType<{ className?: string }>
  intro: string
  sections: PolicySection[]
}

// ==================================================================
// Content (محتوى السياسات)
// ==================================================================

const POLICIES: Policy[] = [
  // ----------------------------------------------------------------
  // Privacy Policy
  // ----------------------------------------------------------------
  {
    id: 'privacy',
    label: 'Privacy Policy',
    icon: ShieldCheck,
    intro:
      'توضح هذه السياسة ما البيانات التي يجمعها Zero Plus، ولماذا، وكيف نحميها.',
    sections: [
      {
        heading: 'البيانات التي نجمعها',
        points: [
          'بيانات الحساب: الاسم، البريد الإلكتروني، اسم الـ Organization، ودور المستخدم.',
          'بيانات الخوادم المحمية: الـ Domain وعنوان الـ Origin Server والـ Port.',
          'بيانات الطلبات المارّة عبر الـ Gateway: عنوان IP، بصمة الجهاز، بصمة التشفير TLS/JA3/JA4، والموقع الجغرافي التقريبي، مع القرار الذي اتُّخذ.',
        ],
      },
      {
        heading: 'كيف نستخدم البيانات',
        points: [
          'اتخاذ قرار السماح أو الحجب أو الفحص الإضافي لكل طلب.',
          'عرض الأحداث والتقارير والتنبيهات داخل لوحة التحكم الخاصة بمنظمتك.',
          'تحسين دقة الكشف وتقليل الإيجابيات الكاذبة (False Positives).',
        ],
      },
      {
        heading: 'التسجيل الكسول (Lazy Registration)',
        body: 'لا نُنشئ سجلاً دائماً لأي جهاز إلا عند وقوع حدث سيء فعلي منه. الزائر الذي لا يسبب مشكلة لا يُحفظ له ملف سمعة.',
      },
      {
        heading: 'خدمات الطرف الثالث',
        body: 'نستخدم Gemini API لصياغة نصوص التقارير والإشعارات فقط، أي لتحويل بيانات حدث وقع بالفعل (مثل نوع الهجوم ودرجة الخطورة وعنوان IP) إلى لغة مفهومة. لا يشارك Gemini في أي قرار أمني.',
      },
      {
        heading: 'حقوقك',
        body: 'يمكنك طلب الاطلاع على بيانات منظمتك أو تعديلها أو حذفها بالتواصل معنا عبر صفحة تواصل معنا أو البريد example@example.com.',
      },
    ],
  },

  // ----------------------------------------------------------------
  // Terms of Service
  // ----------------------------------------------------------------
  {
    id: 'terms',
    label: 'Terms of Service',
    icon: FileText,
    intro: 'باستخدامك Zero Plus فإنك توافق على الشروط التالية.',
    sections: [
      {
        heading: 'وصف الخدمة',
        body: 'Zero Plus خدمة (SaaS) تعمل كـ Reverse Proxy بين زوار موقعك وسيرفرك الحقيقي، وتفحص الطلبات وتقرر السماح بها أو حجبها أو إخضاعها لتحقق إضافي. نحن من يشغّل البنية التحتية، ولا تحتاج لتثبيت أي برنامج.',
      },
      {
        heading: 'مسؤوليات العميل',
        points: [
          'إدخال بيانات صحيحة للحساب والسيرفرات، والحفاظ على سرية بيانات الدخول.',
          'تغيير إعدادات DNS كما نحددها ليمر الـ Traffic عبر Zero Plus.',
          'منع الوصول المباشر إلى الـ Origin Server من خارج Zero Plus، فبدون ذلك يمكن تجاوز الحماية.',
          'المسؤولية عن المستخدمين الذين تضيفهم إلى منظمتك وصلاحياتهم.',
        ],
      },
      {
        heading: 'الاستخدام المقبول',
        points: [
          'يُمنع استخدام الخدمة لحماية مواقع أو خدمات غير قانونية.',
          'يُمنع محاولة اختراق الخدمة أو الالتفاف على حدودها أو الوصول إلى بيانات عميل آخر.',
          'يُمنع استخدام مختبر المحاكاة (Simulation Lab) ضد أي سيرفر لا تملكه.',
        ],
      },
      {
        heading: 'حدود الخدمة',
        body: 'نبذل أقصى جهد لضمان استمرارية الحماية ودقتها، لكن لا يمكن ضمان صد كل هجوم بنسبة 100%، وقد يُحجب زائر شرعي بالخطأ في حالات نادرة. توفّر لوحة التحكم أدوات لمراجعة هذه الحالات.',
      },
      {
        heading: 'إيقاف الحساب والتعديلات',
        body: 'يحق لنا تعليق الحساب عند مخالفة هذه الشروط، ويحق لك إنهاء استخدامك في أي وقت. قد نعدّل هذه الشروط من وقت لآخر، وسنُعلمك بالتغييرات الجوهرية قبل سريانها.',
      },
    ],
  },

  // ----------------------------------------------------------------
  // Security & Data Isolation
  // ----------------------------------------------------------------
  {
    id: 'security',
    label: 'Security & Data Isolation',
    icon: LockKeyhole,
    intro: 'كيف نحمي بيانات كل عميل، وما الذي يُشارَك وما الذي لا يغادر بيئتك أبداً.',
    sections: [
      {
        heading: 'عزل البيانات بين العملاء (Tenant Isolation)',
        points: [
          'لكل عميل بيئة بيانات منفصلة منطقياً لا تتقاطع مع أي عميل آخر.',
          'مفاتيح تشفير مستقلة لكل عميل، فالوصول غير المصرح به لبيانات شركة لا يمنح وصولاً لشركة أخرى.',
          'سجل السمعة والقائمة السوداء الخاصة بكل شركة تبقى محلية داخل بيئتها.',
        ],
      },
      {
        heading: 'المناعة الجماعية (Federated Threat Memory)',
        body: 'عند تأكد حدث سيء، نستخلص بصمة الجهاز المهاجم فقط (مثل بصمة TLS/JA3/JA4 ونوعه) مجرّدة من أي هوية، ونضيفها لذاكرة تهديدات مشتركة، فيصبح باقي العملاء محصّنين قبل أن يتعرضوا للهجوم نفسه.',
      },
      {
        heading: 'ما الذي يُشارَك وما الذي لا يُشارَك',
        points: [
          'يُشارَك: بصمة التهديد المجرّدة، وهي بيانات غير حساسة لا تحمل أي معرّف للشركة.',
          'لا يُشارَك أبداً: بيانات المستخدمين، تفاصيل السيرفرات، السجلات الكاملة، معلومات الحساب.',
        ],
      },
      {
        heading: 'القرار الأمني مستقل عن الخدمات الخارجية',
        body: 'قرارات السماح والحجب تُتخذ بالكامل داخل محرك Zero Plus. الخدمات الخارجية (مثل Gemini) تُستخدم لصياغة النصوص بعد اتخاذ القرار، فلا يتوقف أي قرار حساس على استجابة طرف ثالث.',
      },
      {
        heading: 'الإبلاغ عن ثغرة أمنية',
        body: 'إذا اكتشفت ثغرة في Zero Plus، راسلنا على security@example.com بالتفاصيل، ونعدك بمراجعتها بجدية والرد عليك.',
      },
    ],
  },
]

// ==================================================================
// Component
// ==================================================================

export default function SitePoliciesPage() {
  // التبويب النشط يُقرأ من الرابط (?tab=...) عشان روابط الفوتر تشتغل
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')

  // لو الـ tab مش معروف نرجع لأول تبويب
  const active = POLICIES.find((p) => p.id === tabParam) ?? POLICIES[0]

  return (
    <LandingLayout>
      <PageHero
        title={
          <>
            السياسات <GradientText>والشروط</GradientText>
          </>
        }
        description="نوضّح لك بصراحة كيف نتعامل مع بياناتك، وما الذي تتوقعه منا وما نتوقعه منك."
      />

      <section className="mx-auto max-w-4xl px-6 py-8">
        {/* ========================================================== */}
        {/* Tabs                                                       */}
        {/* ========================================================== */}

        <div
          role="tablist"
          className="mb-8 flex flex-wrap gap-2 rounded-2xl border border-white/8 bg-white/3 p-2"
        >
          {POLICIES.map(({ id, label, icon: Icon }) => {
            const isActive = id === active.id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setParams({ tab: id }, { replace: true })}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-300 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.2)]'
                    : 'text-slate-400 hover:bg-white/4 hover:text-slate-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span dir="ltr">{label}</span>
              </button>
            )
          })}
        </div>

        {/* ========================================================== */}
        {/* Active Policy Content                                      */}
        {/* ========================================================== */}

        <article className={`${cardClass} p-8`} role="tabpanel">
          <p className="mb-8 leading-relaxed text-slate-300">{active.intro}</p>

          <div className="space-y-8">
            {active.sections.map((section) => (
              <div key={section.heading}>
                <h2 className="mb-3 text-lg font-semibold text-white">
                  {section.heading}
                </h2>

                {section.body && (
                  <p className="leading-loose text-slate-400">{section.body}</p>
                )}

                {section.points && (
                  <ul className="space-y-2.5">
                    {section.points.map((point) => (
                      <li key={point} className="flex gap-3 leading-relaxed text-slate-400">
                        <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <p className="mt-10 border-t border-white/6 pt-5 text-xs text-slate-600">
            آخر تحديث: أكتوبر 2026
          </p>
        </article>
      </section>
    </LandingLayout>
  )
}
