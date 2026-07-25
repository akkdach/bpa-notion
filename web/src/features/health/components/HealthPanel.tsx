import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, Database, Loader2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HealthStatus } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  HealthPanel — presentational
//
//  รับข้อมูลผ่าน props ไม่ fetch เอง ทำให้:
//    · เอาไปวางใน storybook / test ได้โดยไม่ต้องมีเซิร์ฟเวอร์
//    · ใช้ซ้ำที่อื่นได้
//  นี่คือความหมายของ "component-first" ในทางปฏิบัติ
// ═══════════════════════════════════════════════════════════════════════════

interface HealthPanelProps {
  data?: HealthStatus | undefined
  isLoading: boolean
  error?: Error | null
}

export function HealthPanel({ data, isLoading, error }: HealthPanelProps) {
  const isHealthy = data?.status === 'healthy'

  return (
    <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
      <header className="mb-5 flex items-center gap-3">
        <Database className="size-5 text-muted-foreground" aria-hidden />
        <div>
          <h1 className="font-semibold leading-tight">ProjectManagement</h1>
          <p className="text-sm text-muted-foreground">Phase 0 — walking skeleton</p>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden />
            กำลังตรวจสอบระบบ…
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-2 text-sm text-destructive"
          >
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error.message}</span>
          </motion.div>
        ) : data ? (
          <motion.div
            key="data"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            <StatusRow
              ok={isHealthy}
              label={isHealthy ? 'ระบบพร้อมใช้งาน' : 'ระบบไม่สมบูรณ์'}
            />

            <dl className="space-y-2 border-t pt-4 text-sm">
              <Row label="เชื่อมต่อฐานข้อมูล" value={data.database.canConnect ? 'สำเร็จ' : 'ล้มเหลว'} />
              <Row label="เวลาตอบสนอง" value={`${data.database.latencyMs} ms`} />
              {data.database.serverVersion && (
                <Row label="PostgreSQL" value={data.database.serverVersion} />
              )}
              <Row
                label="Extensions"
                value={data.database.extensions.join(', ') || '—'}
              />
              {data.database.missingExtensions.length > 0 && (
                <Row
                  label="ขาด"
                  value={data.database.missingExtensions.join(', ')}
                  tone="destructive"
                />
              )}
              {data.database.error && (
                <Row label="ข้อผิดพลาด" value={data.database.error} tone="destructive" />
              )}
            </dl>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function StatusRow({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? CheckCircle2 : XCircle

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-sm font-medium',
        ok ? 'text-success' : 'text-destructive',
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </div>
  )
}

function Row({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'destructive'
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-right font-mono text-xs',
          tone === 'destructive' && 'text-destructive',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
