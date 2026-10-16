// frontend/src/hooks/useDebounce.ts
// بيأخر تحديث القيمة لحد ما المستخدم يبطل كتابة (عشان مانبعتش request مع كل حرف)

import { useEffect, useState } from 'react'

export function useDebounce<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
