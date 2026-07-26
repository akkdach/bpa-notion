import { useState, type FormEvent } from 'react'
import { Loader2, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Member, WorkspaceRole } from '../types'
import { ASSIGNABLE_ROLES, ROLE_LABELS } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  ส่วน "สมาชิก" ของหน้าตั้งค่า — presentational
//
//  ไม่มีการเชิญทางอีเมล: พิมพ์อีเมลของคนที่สมัครไว้แล้วเท่านั้น
//  (ระบบไม่มี SMTP โดยเจตนา — ดู PLAN.md)
// ═══════════════════════════════════════════════════════════════════════════

interface MemberSettingsProps {
  members: Member[]
  currentUserId: string
  isLoading: boolean
  error: Error | null
  canManage: boolean
  isBusy: boolean
  onAdd: (input: { email: string; role: WorkspaceRole }) => Promise<void>
  onChangeRole: (userId: string, role: WorkspaceRole) => Promise<void>
  onRemove: (userId: string) => Promise<void>
}

export function MemberSettings({
  members, currentUserId, isLoading, error, canManage, isBusy,
  onAdd, onChangeRole, onRemove,
}: MemberSettingsProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('member')
  const [addError, setAddError] = useState<string | null>(null)

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    setAddError(null)

    try {
      await onAdd({ email: email.trim(), role })
      setEmail('')
    } catch (cause) {
      setAddError(cause instanceof Error ? cause.message : 'เพิ่มสมาชิกไม่สำเร็จ')
    }
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">สมาชิก</h2>
        <p className="text-sm text-muted-foreground">
          เพิ่มได้เฉพาะคนที่สมัครบัญชีไว้แล้ว ระบบไม่ส่งอีเมลเชิญ
        </p>
      </header>

      {canManage && (
        <form onSubmit={(event) => void handleAdd(event)} className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="member-email">อีเมล</Label>
              <Input
                id="member-email"
                // ⚠️ type="text" ไม่ใช่ "email" — เบราว์เซอร์ validate อีเมลที่มี
                //    อักษรไทยไม่ผ่าน ทั้งที่ระบบรองรับ (users.email เป็น citext
                //    ไม่ได้จำกัดชุดอักขระ)
                //
                //    อาการเวลาพลาด: กด "เพิ่ม" แล้วไม่เกิดอะไรขึ้นเลย ไม่มี error
                //    ให้เห็น เพราะ onSubmit ไม่เคยถูกเรียก — เบราว์เซอร์บล็อกก่อน
                //    (ฟอร์ม login/สมัครใน features/auth เจอเรื่องนี้มาก่อนแล้ว)
                type="text"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="somchai@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-role">สิทธิ์</Label>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button id="member-role" type="button" variant="outline" className="w-32 justify-start" />}
                >
                  {ROLE_LABELS[role]}
                </DropdownMenuTrigger>
                {/* ⚠️ base-ui ใช้ onClick ไม่ใช่ onSelect — เขียน onSelect แล้ว
                    TypeScript ไม่ฟ้องแต่เมนูจะกดไม่ติด */}
                <DropdownMenuContent>
                  {ASSIGNABLE_ROLES.map((value) => (
                    <DropdownMenuItem key={value} onClick={() => setRole(value)}>
                      {ROLE_LABELS[value]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <Button type="submit" disabled={isBusy || email.trim().length === 0} className="gap-2">
              <UserPlus className="size-4" aria-hidden />
              เพิ่ม
            </Button>
          </div>

          {addError !== null && <p className="text-sm text-destructive">{addError}</p>}
        </form>
      )}

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : error !== null ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {members.map((member) => {
            const isSelf = member.userId === currentUserId
            const isOwner = member.role === 'owner'

            return (
              <li key={member.userId} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.name}
                    {isSelf && <span className="ml-2 text-xs text-muted-foreground">(คุณ)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>

                {/* เจ้าของเปลี่ยนสิทธิ์ตัวเองไม่ได้ ไม่งั้น workspace จะไม่มีเจ้าของ */}
                {canManage && !isOwner ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="sm" className="w-28 justify-start" />}
                      aria-label={`เปลี่ยนสิทธิ์ของ ${member.name}`}
                    >
                      {ROLE_LABELS[member.role]}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {ASSIGNABLE_ROLES.map((value) => (
                        <DropdownMenuItem
                          key={value}
                          onClick={() => void onChangeRole(member.userId, value)}
                        >
                          {ROLE_LABELS[value]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span className="w-28 px-3 text-sm text-muted-foreground">
                    {ROLE_LABELS[member.role]}
                  </span>
                )}

                {canManage && !isOwner && !isSelf && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`ถอด ${member.name} ออกจาก workspace`}
                    disabled={isBusy}
                    onClick={() => void onRemove(member.userId)}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
