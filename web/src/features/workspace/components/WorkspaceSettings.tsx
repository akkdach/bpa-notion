import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { WorkspaceDetail } from '../types'
import { ROLE_LABELS } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  ส่วน "workspace" ของหน้าตั้งค่า — presentational
// ═══════════════════════════════════════════════════════════════════════════

interface WorkspaceSettingsProps {
  workspace: WorkspaceDetail | undefined
  isLoading: boolean
  error: Error | null
  canEdit: boolean
  isSaving: boolean
  onSave: (input: { name: string; icon?: string }) => Promise<void>
}

export function WorkspaceSettings({
  workspace, isLoading, error, canEdit, isSaving, onSave,
}: WorkspaceSettingsProps) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    )
  }

  if (error !== null) return <p className="text-sm text-destructive">{error.message}</p>
  if (workspace === undefined) return null

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">workspace</h2>
        <p className="text-sm text-muted-foreground">
          สิทธิ์ของคุณที่นี่: {ROLE_LABELS[workspace.myRole]} · สมาชิก {workspace.memberCount} คน
        </p>
      </header>

      {/* ─────────────────────────────────────────────────────────────────
          key = workspace.id ทำให้ React ทิ้ง state เก่าแล้วสร้างฟอร์มใหม่
          เมื่อสลับ workspace

          ⚠️ ทางที่ผิดคือใช้ useEffect ยัดค่าลง state เมื่อ props เปลี่ยน —
             react-hooks/set-state-in-effect ฟ้อง และมันแย่จริง: react-query
             คืน object ใหม่ทุกครั้งที่ refetch พื้นหลัง ถ้า sync ด้วย effect
             สิ่งที่ผู้ใช้กำลังพิมพ์ค้างอยู่จะถูกเขียนทับกลางคัน
          ───────────────────────────────────────────────────────────────── */}
      <WorkspaceForm
        key={workspace.id}
        initialName={workspace.name}
        initialIcon={workspace.icon ?? ''}
        slug={workspace.slug}
        canEdit={canEdit}
        isSaving={isSaving}
        onSave={onSave}
      />
    </section>
  )
}

interface WorkspaceFormProps {
  initialName: string
  initialIcon: string
  slug: string
  canEdit: boolean
  isSaving: boolean
  onSave: (input: { name: string; icon?: string }) => Promise<void>
}

function WorkspaceForm({
  initialName, initialIcon, slug, canEdit, isSaving, onSave,
}: WorkspaceFormProps) {
  const [name, setName] = useState(initialName)
  const [icon, setIcon] = useState(initialIcon)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaveError(null)
    setSaved(false)

    try {
      const trimmedIcon = icon.trim()
      await onSave({ name: name.trim(), ...(trimmedIcon ? { icon: trimmedIcon } : {}) })
      setSaved(true)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ')
    }
  }

  return (
      <form onSubmit={(event) => void handleSubmit(event)} className="max-w-md space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ws-name">ชื่อ</Label>
          <Input
            id="ws-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false) }}
            disabled={!canEdit}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ws-icon">ไอคอน</Label>
          <Input
            id="ws-icon"
            value={icon}
            onChange={(e) => { setIcon(e.target.value); setSaved(false) }}
            disabled={!canEdit}
            placeholder="เช่น 🏢"
            className="w-24"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ws-slug">ชื่อสำหรับ URL</Label>
          {/* slug เปลี่ยนไม่ได้ — โชว์ไว้เพราะต้องใช้ตอนตั้งค่า MCP */}
          <Input id="ws-slug" value={slug} readOnly disabled className="font-mono" />
          <p className="text-xs text-muted-foreground">เปลี่ยนไม่ได้หลังสร้างแล้ว</p>
        </div>

        {saveError !== null && <p className="text-sm text-destructive">{saveError}</p>}

        {canEdit ? (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isSaving || name.trim().length === 0}>
              บันทึก
            </Button>
            {saved && <span className="text-sm text-muted-foreground">บันทึกแล้ว</span>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            ต้องเป็นเจ้าของหรือผู้ดูแลจึงจะแก้ไขได้
          </p>
        )}
      </form>
  )
}
