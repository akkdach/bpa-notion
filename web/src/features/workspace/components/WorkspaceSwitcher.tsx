import { useState, type FormEvent } from 'react'
import { Check, ChevronsUpDown, LogOut, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { WorkspaceSummary } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  WorkspaceSwitcher — presentational
//  รับข้อมูลและ callback เข้ามาทั้งหมด ไม่ยิง API เอง
// ═══════════════════════════════════════════════════════════════════════════

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceSummary[]
  current: WorkspaceSummary | null
  userName: string
  onSelect: (workspaceId: string) => void
  onCreate: (name: string) => Promise<void>
  onLogout: () => void
}

export function WorkspaceSwitcher({
  workspaces, current, userName, onSelect, onCreate, onLogout,
}: WorkspaceSwitcherProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setIsBusy(true)

    try {
      await onCreate(name.trim())
      setName('')
      setIsCreating(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'สร้างไม่สำเร็จ')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        {/* ⚠️ base-nova ใช้ @base-ui/react ซึ่งใช้ prop `render` ไม่ใช่ `asChild`
            แบบ Radix — ตัวอย่าง shadcn ส่วนใหญ่บนเน็ตเป็นแบบ Radix จึงใช้ไม่ได้ตรง ๆ */}
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" className="h-auto w-full justify-between gap-2 px-2 py-2" />
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="text-base leading-none">
              {current?.icon ?? '📁'}
            </span>
            <span className="min-w-0 text-left">
              <span className="block truncate text-sm font-medium">
                {current?.name ?? 'เลือก workspace'}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{userName}</span>
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </DropdownMenuTrigger>

        {/* ⚠️ @base-ui/react ใช้ onClick ไม่ใช่ onSelect แบบ Radix
            และ TypeScript ไม่ฟ้องเมื่อเขียน onSelect เพราะมันเป็น DOM event ที่
            มีอยู่จริงบน div — ผลคือเมนูกดได้แต่ไม่เกิดอะไรขึ้นเลย
            เทสในเบราว์เซอร์เท่านั้นที่จับเรื่องนี้ได้ */}
        <DropdownMenuContent align="start" className="w-64">
          {workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              onClick={() => onSelect(workspace.id)}
              className="gap-2"
            >
              <span aria-hidden>{workspace.icon ?? '📁'}</span>
              <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
              <Check
                className={cn(
                  'size-4 shrink-0',
                  workspace.id === current?.id ? 'opacity-100' : 'opacity-0',
                )}
                aria-hidden
              />
            </DropdownMenuItem>
          ))}

          {workspaces.length > 0 && <DropdownMenuSeparator />}

          <DropdownMenuItem onClick={() => setIsCreating(true)} className="gap-2">
            <Plus className="size-4" aria-hidden />
            สร้าง workspace ใหม่
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={onLogout} className="gap-2">
            <LogOut className="size-4" aria-hidden />
            ออกจากระบบ
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent>
          <form onSubmit={(event) => void handleCreate(event)}>
            <DialogHeader>
              <DialogTitle>สร้าง workspace ใหม่</DialogTitle>
              <DialogDescription>
                ตั้งชื่อเป็นภาษาไทยได้ ระบบจะสร้างชื่อสำหรับ URL ให้เอง
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-4">
              <Label htmlFor="workspace-name">ชื่อ</Label>
              <Input
                id="workspace-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น ทีมพัฒนา"
                autoFocus
                required
              />
              {error !== null && <p className="text-sm text-destructive">{error}</p>}
            </div>

            <DialogFooter>
              <Button type="submit" disabled={isBusy || name.trim().length === 0}>
                สร้าง
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
