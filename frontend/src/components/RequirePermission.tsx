// frontend/src/components/RequirePermission.tsx
// حارس صلاحية على مستوى الـ Route — يُستخدم جوه ProtectedRoute (اللي بيضمن إن الـ user اتحمّل).
// لو المستخدم معندوش الصلاحية بيتحوّل للداشبورد قبل ما الصفحة تتحمّل أو تعمل أي API call.

import { Navigate } from 'react-router-dom'

import { useAuthStore, selectHasPermission } from '../store/authStore'

export default function RequirePermission({
  permission,
  children,
}: {
  permission: string
  children: React.ReactNode
}) {
  const allowed = useAuthStore(selectHasPermission(permission))
  if (!allowed) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
