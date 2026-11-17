// frontend/src/components/DynamicText.tsx
// ==================================================================
// كومبوننت لعرض نصوص ديناميكية مع ترجمة تلقائية
//
// الاستخدام:
//   <DynamicText text={notification.message} />
//   <DynamicText text={event.description} className="text-sm" />
//
// - بيترجم فقط لو zh / de
// - Fail-open: لو حصل خطأ بيرجع النص الأصلي
// ==================================================================

import type { ElementType } from 'react'
import { useAutoTranslate } from '../hooks/useAutoTranslate'

interface DynamicTextProps {
  text: string | null | undefined
  className?: string
  as?: ElementType
}

export function DynamicText({
  text,
  className,
  as: Component = 'span',
}: DynamicTextProps) {
  const translated = useAutoTranslate(text)

  if (!text) return null

  return (
    <Component dir="auto" className={className}>
      {translated}
    </Component>
  )
}

export default DynamicText
