import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/uiStore'

// ═══════════════════════════════════════════════════════════════════════════
//  ส่วน "การแสดงผล" ของหน้าตั้งค่า
//
//  อ่าน/เขียน uiStore ตรง ๆ ได้ (feature-components → store อนุญาต) เพราะธีม
//  เป็น UI state ล้วน ๆ ไม่ใช่ข้อมูลจากเซิร์ฟเวอร์ — ไม่มีอะไรให้ยิง API
// ═══════════════════════════════════════════════════════════════════════════

const OPTIONS = [
  { value: 'light', label: 'สว่าง', icon: Sun },
  { value: 'dark', label: 'มืด', icon: Moon },
  { value: 'system', label: 'ตามระบบ', icon: Monitor },
] as const

export function AppearanceSettings() {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">การแสดงผล</h2>
        <p className="text-sm text-muted-foreground">
          ตั้งค่านี้เก็บไว้ในเบราว์เซอร์นี้เท่านั้น ไม่ตามไปเครื่องอื่น
        </p>
      </header>

      <div className="space-y-3">
        <p className="text-sm font-medium">ธีม</p>

        {/* radiogroup ไม่ใช่กลุ่มปุ่ม — screen reader ต้องรู้ว่าเลือกได้อันเดียว
            และลูกศรซ้าย/ขวาต้องเลื่อนตัวเลือกได้ตามที่ผู้ใช้คีย์บอร์ดคาดหวัง */}
        <div role="radiogroup" aria-label="ธีม" className="grid max-w-md grid-cols-3 gap-3">
          {OPTIONS.map(({ value, label, icon: Icon }) => {
            const isActive = theme === value

            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => setTheme(value)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition-colors',
                  'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive ? 'border-primary bg-accent' : 'border-border',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
