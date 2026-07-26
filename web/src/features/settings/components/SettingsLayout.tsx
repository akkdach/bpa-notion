import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

// ═══════════════════════════════════════════════════════════════════════════
//  โครงหน้าตั้งค่า — presentational ล้วน
//  รับรายการหมวดกับตัวเนื้อหาเข้ามา ไม่รู้จักว่าแต่ละหมวดคืออะไร
// ═══════════════════════════════════════════════════════════════════════════

export interface SettingsSection {
  id: string
  label: string
  icon: ReactNode
  /** ซ่อนหมวดที่ผู้ใช้ไม่มีสิทธิ์ แทนที่จะโชว์แล้วให้กดไม่ได้ */
  hidden?: boolean
}

interface SettingsLayoutProps {
  sections: SettingsSection[]
  activeId: string
  onSelect: (id: string) => void
  onClose: () => void
  children: ReactNode
}

export function SettingsLayout({
  sections, activeId, onSelect, onClose, children,
}: SettingsLayoutProps) {
  const visible = sections.filter((section) => section.hidden !== true)

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
          <ArrowLeft className="size-4" aria-hidden />
          กลับ
        </Button>
        <h1 className="text-sm font-semibold">ตั้งค่า</h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* บนจอแคบแถบนำทางเลื่อนแนวนอนอยู่ด้านบน ไม่ใช่คอลัมน์ซ้ายที่กินพื้นที่ */}
        <nav
          aria-label="หมวดการตั้งค่า"
          className="shrink-0 overflow-x-auto border-b p-2 md:w-56 md:overflow-visible md:border-b-0 md:border-r md:p-3"
        >
          <ul className="flex gap-1 md:flex-col">
            {visible.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  aria-current={section.id === activeId ? 'page' : undefined}
                  onClick={() => onSelect(section.id)}
                  className={cn(
                    'flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors',
                    'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    section.id === activeId
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {section.icon}
                  {section.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">{children}</div>
        </ScrollArea>
      </div>
    </div>
  )
}
