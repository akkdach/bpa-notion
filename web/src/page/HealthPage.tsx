import { HealthPanel, useHealth } from '@/features/health'

// ═══════════════════════════════════════════════════════════════════════════
//  route composition เท่านั้น — ต่อ hook เข้ากับ component ไม่มี logic เอง
// ═══════════════════════════════════════════════════════════════════════════
export function HealthPage() {
  const { data, isLoading, error } = useHealth()

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <HealthPanel data={data} isLoading={isLoading} error={error} />
    </main>
  )
}
