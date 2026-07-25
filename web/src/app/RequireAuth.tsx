import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/features/auth'

/**
 * กันไม่ให้เข้าหน้าที่ต้อง login
 *
 * ⚠️ ต้องรอ AuthProvider กู้ session จาก localStorage ให้เสร็จก่อน
 *    ถ้าไม่รอ ผู้ใช้ที่ login อยู่แล้วจะเห็นหน้า login แวบหนึ่งทุกครั้งที่กด
 *    refresh แล้วเด้งกลับ ซึ่งดูเหมือนแอปมีบั๊ก
 *
 * แยกไฟล์จาก routes.tsx เพราะ react-refresh ทำงานได้เฉพาะกับไฟล์ที่ export
 * แต่ component ล้วน ๆ
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    )
  }

  return user === null ? <Navigate to="/login" replace /> : <>{children}</>
}
