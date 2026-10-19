// frontend/src/services/apiError.ts
// ==================================================================
// Zero Plus - API Error Parser
// الباك بيرجع الأخطاء بأشكال مختلفة حسب الموديول:
//   - events:   { success:false, message, details: <zod .format()> }
//   - policies/servers/reputation: { success:false, code, message, errors:[{field,message}] }
//   - organizations: { success:false, message, errors:[zod issues] }
// الدالة دي بتوحّدهم في شكل واحد تستخدمه أي صفحة.
// ==================================================================

export interface ParsedApiError {
  message: string
  code?: string
  status?: number
  /** أخطاء مرتبطة بحقول معينة (للعرض تحت الـ input) */
  fieldErrors: Record<string, string>
}

type Json = Record<string, unknown>

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null
}

/** zod .format() → { field: firstMessage } */
function flattenZodFormat(details: Json): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(details)) {
    if (key === '_errors' || !isObject(value)) continue
    const errs = value['_errors']
    if (Array.isArray(errs) && typeof errs[0] === 'string') out[key] = errs[0]
  }
  return out
}

export function parseApiError(
  error: unknown,
  fallback = 'حدث خطأ غير متوقع، حاول مرة أخرى',
): ParsedApiError {
  const result: ParsedApiError = { message: fallback, fieldErrors: {} }

  if (!isObject(error)) return result

  const response = error['response']

  // مفيش response = السيرفر مش واصل (شبكة / timeout)
  if (!isObject(response)) {
    const code = error['code']
    result.message =
      code === 'ECONNABORTED'
        ? 'انتهت مهلة الطلب، السيرفر تأخر في الرد'
        : 'تعذر الاتصال بالسيرفر، تأكد من الاتصال وحاول مرة أخرى'
    return result
  }

  if (typeof response['status'] === 'number') result.status = response['status']

  const data = response['data']
  if (!isObject(data)) return result

  if (typeof data['message'] === 'string' && data['message']) {
    result.message = data['message']
  }
  if (typeof data['code'] === 'string') result.code = data['code']

  // errors: [{ field, message }] أو zod issues [{ path:[], message }]
  const errors = data['errors']
  if (Array.isArray(errors)) {
    for (const item of errors) {
      if (!isObject(item) || typeof item['message'] !== 'string') continue
      const field =
        typeof item['field'] === 'string'
          ? item['field']
          : Array.isArray(item['path'])
            ? item['path'].map(String).join('.')
            : ''
      if (field && !result.fieldErrors[field]) result.fieldErrors[field] = item['message']
    }
  }

  // details: zod .format()
  const details = data['details']
  if (isObject(details)) {
    Object.assign(result.fieldErrors, flattenZodFormat(details))
  }

  // لو في أخطاء حقول، نضيف أول واحدة للرسالة عشان تبقى مفيدة في التوست
  const first = Object.values(result.fieldErrors)[0]
  if (first && result.status === 400) result.message = `${result.message}: ${first}`

  return result
}
