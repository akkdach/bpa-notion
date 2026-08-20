import { useRef, useState } from 'react'
import { SmilePlus } from 'lucide-react'
import { cn } from '@/lib/utils'

// ═══════════════════════════════════════════════════════════════════════════
//  PageIconButton — ไอคอนหน้า (emoji) + popover เลือก/พิมพ์/ลบ
//
//  presentational ล้วน: รับ icon ปัจจุบัน + onChange — ตัวต่อ mutation คือ PageView
//
//  จงใจไม่ใช้ emoji-picker library — ชุดยอดนิยม + ช่องพิมพ์เอง (Win+. เปิด
//  emoji keyboard ของ OS ได้) ครอบคลุมการใช้จริงโดยไม่แบก dependency เพิ่ม
// ═══════════════════════════════════════════════════════════════════════════

const COMMON_EMOJIS = [
  '📁', '🗂️', '📋', '📝', '📖', '📓', '📊', '📈',
  '⚙️', '🔧', '🛠️', '💡', '🚀', '🔥', '⭐', '✅',
  '🎯', '🧪', '🐛', '🔒', '🌐', '📦', '🖼️', '📅',
  '☕', '🚗', '📍', '💬', '🤖', '🏭', '🧭', '🧯',
] as const

interface PageIconButtonProps {
  /**
   * ⚠️ null กับ undefined แปลว่า "ไม่มีไอคอน" เหมือนกัน — API ส่ง `icon: null`
   *    (ดู PageDto ฝั่ง server) ส่วนชนิดฝั่งเว็บเขียนเป็น optional ไว้
   *    เช็คด้วย `!== undefined` เฉย ๆ จึงพลาด null แล้วได้ปุ่มเปล่ามองไม่เห็น
   */
  icon: string | null | undefined
  canEdit: boolean
  /** null = เอาไอคอนออก (ตรงกับสัญญา PATCH: null ล้างค่า) */
  onChange: (icon: string | null) => void
}

export function PageIconButton({ icon, canEdit, onChange }: PageIconButtonProps) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // รวม null/undefined/สตริงว่าง ให้เหลือค่าเดียวก่อนตัดสินใจ render
  const current = icon !== null && icon !== undefined && icon.length > 0 ? icon : null

  // ไม่มีไอคอนและแก้ไม่ได้ — ไม่ต้องแสดงอะไรเลย ไม่กินที่
  if (current === null && !canEdit) return null

  const pick = (value: string | null) => {
    onChange(value)
    setCustom('')
    setOpen(false)
  }

  return (
    <div className="relative">
      {current !== null ? (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'rounded-lg p-1 text-5xl leading-none',
            canEdit && 'hover:bg-accent',
          )}
          aria-label="เปลี่ยนไอคอนหน้า"
          title={canEdit ? 'คลิกเพื่อเปลี่ยนไอคอน' : undefined}
        >
          {current}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm',
            'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <SmilePlus className="size-4" aria-hidden />
          เพิ่มไอคอน
        </button>
      )}

      {open && (
        <>
          {/* backdrop — คลิกที่ไหนก็ได้เพื่อปิด */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />

          <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border bg-popover p-3 shadow-md">
            <div className="grid grid-cols-8 gap-0.5">
              {COMMON_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => pick(emoji)}
                  className="rounded p-1 text-xl hover:bg-accent"
                  aria-label={`เลือก ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <form
              className="mt-2 flex gap-1.5"
              onSubmit={(event) => {
                event.preventDefault()
                const value = custom.trim()
                if (value.length > 0) pick(value)
              }}
            >
              <input
                ref={inputRef}
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                placeholder="พิมพ์/วาง emoji เอง (Win + .)"
                maxLength={16}
                className={cn(
                  'h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-sm',
                  'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                )}
              />
              <button
                type="submit"
                disabled={custom.trim().length === 0}
                className="h-8 rounded-md border px-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                ใช้
              </button>
            </form>

            {current !== null && (
              <button
                type="button"
                onClick={() => pick(null)}
                className="mt-2 w-full rounded-md px-2 py-1 text-left text-sm text-destructive hover:bg-accent"
              >
                เอาไอคอนออก
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
