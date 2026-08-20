import { type ReactNode } from 'react'
import { motion } from 'motion/react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { ScrollPane } from './ScrollPane'

// ═══════════════════════════════════════════════════════════════════════════
//  AppShell — โครงหน้าจอ ไม่รู้จัก domain อะไรเลย
//
//  ⚠️ รับสถานะ sidebar เข้ามาทาง props ไม่อ่านจาก store เอง
//
//     เวอร์ชันแรกอ่าน useUiStore ตรง ๆ แล้ว eslint-plugin-boundaries ฟ้อง
//     ว่า layer "layout" ห้าม import "store" ซึ่งถูกแล้ว: component ใน
//     components/ ต้องรับข้อมูลผ่าน props เพื่อให้เอาไปวางใน storybook หรือ
//     ใช้ซ้ำในบริบทอื่นได้ ตัวที่ต่อกับ store คือชั้น page/
// ═══════════════════════════════════════════════════════════════════════════

interface AppShellProps {
  sidebarHeader: ReactNode
  sidebarBody: ReactNode
  /** ท้ายแถบด้านข้าง — อยู่นอกพื้นที่เลื่อน จึงติดอยู่กับที่เมื่อรายการหน้ายาว */
  sidebarFooter?: ReactNode
  children: ReactNode
  sidebarWidth: number
  collapsed: boolean
  onToggleSidebar: () => void
}

export function AppShell({
  sidebarHeader, sidebarBody, sidebarFooter, children,
  sidebarWidth, collapsed, onToggleSidebar,
}: AppShellProps) {
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <motion.aside
        animate={{ width: collapsed ? 0 : sidebarWidth }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="shrink-0 overflow-hidden border-r bg-card"
      >
        <div style={{ width: sidebarWidth }} className="flex h-full flex-col">
          <div className="p-2">{sidebarHeader}</div>
          <Separator />
          {/* ใช้ ScrollPane เหมือนพื้นที่เนื้อหา — รายการหน้ายาวเกินจอแล้ว
              ผู้ใช้ต้องเห็นว่าเลื่อนได้ ไม่ใช่แถบที่จางหายเองแบบของเดิม */}
          <ScrollPane className="flex-1">
            <nav className="p-2" aria-label="หน้าทั้งหมด">
              {sidebarBody}
            </nav>
          </ScrollPane>

          {sidebarFooter !== undefined && (
            <>
              <Separator />
              <div className="p-2">{sidebarFooter}</div>
            </>
          )}
        </div>
      </motion.aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-2">
          <button
            type="button"
            onClick={onToggleSidebar}
            className={cn(
              'flex size-7 items-center justify-center rounded-md',
              'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
            aria-label={collapsed ? 'เปิดแถบด้านข้าง' : 'ปิดแถบด้านข้าง'}
          >
            {collapsed
              ? <PanelLeftOpen className="size-4" aria-hidden />
              : <PanelLeftClose className="size-4" aria-hidden />}
          </button>
        </header>

        {/* ScrollPane วาดแถบเลื่อนเอง — แถบของ OS ถูกซ่อนตามการตั้งค่า Windows
            ได้ ซึ่งทำให้ผู้ใช้หาที่ลากไม่เจอ (ดูเหตุผลเต็มในไฟล์นั้น) */}
        <main className="flex min-h-0 flex-1 flex-col">
          <ScrollPane className="flex-1">{children}</ScrollPane>
        </main>
      </div>
    </div>
  )
}
