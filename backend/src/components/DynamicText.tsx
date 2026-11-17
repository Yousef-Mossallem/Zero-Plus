// frontend/src/components/DynamicText.tsx
// الاستخدام: <DynamicText text={notification.message} />
// للحقول الديناميكية الجاية من الباك بس (مش نصوص الـ i18n الثابتة).

import { useAutoTranslate } from '../hooks/useAutoTranslate'

interface DynamicTextProps {
  text: string | null | undefined
  className?: string
}

export default function DynamicText({ text, className }: DynamicTextProps) {
  const translated = useAutoTranslate(text)
  return (
    <span className={className} dir="auto">
      {translated}
    </span>
  )
}
