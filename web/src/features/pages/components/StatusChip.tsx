import { cn } from '@/lib/utils'
import { statusGlyph, statusLabel, statusTone } from '../statusModel'
import type { PageStatus } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  StatusChip — presentational
//
//  `pages.status` มีอยู่ในฐานข้อมูลตั้งแต่ migration AddPageStatus และ MCP
//  (Claude Code) เขียนมันมาตลอด แต่ฝั่งเว็บไม่เคยแสดงเลย — งานที่ AI ทำไว้
//  จึงมองไม่เห็นจากหน้าจอ component นี้คือทางที่มันโผล่มาให้เจ้าของเห็น
//
//  ข้อความ/สัญลักษณ์/สี และลำดับการวนอยู่ใน ../statusModel.ts
// ═══════════════════════════════════════════════════════════════════════════

interface StatusChipProps {
  status: PageStatus | undefined
  /** ไม่ส่ง = แสดงอย่างเดียว กดไม่ได้ (เช่นในถังขยะ หรือเมื่อไม่มีสิทธิ์แก้) */
  onCycle?: () => void
  /** แสดง chip จาง ๆ ไว้ให้กดแม้หน้านั้นยังไม่ใช่งาน — ใช้ใน sidebar ตอน hover */
  showWhenUnset?: boolean
  className?: string
}

export function StatusChip({ status, onCycle, showWhenUnset, className }: StatusChipProps) {
  if (status === undefined && !showWhenUnset) return null

  const label = statusLabel(status)
  const glyph = statusGlyph(status)
  const tone = statusTone(status)

  if (onCycle === undefined) {
    return (
      <span
        className={cn('shrink-0 text-xs leading-none', tone, className)}
        title={label}
        aria-label={label}
      >
        {glyph}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        // อยู่ในแถวที่กดแล้วเปิดหน้า — ห้ามให้ click ไหลขึ้นไป
        event.stopPropagation()
        onCycle()
      }}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded text-xs leading-none',
        'hover:bg-accent',
        tone,
        className,
      )}
      // สถานะปัจจุบันต้องอ่านออกด้วยเสียง ไม่ใช่สื่อด้วย emoji เพียว ๆ
      aria-label={status === undefined ? label : `สถานะ: ${label} — กดเพื่อเปลี่ยน`}
      title={status === undefined ? label : `${label} — กดเพื่อเปลี่ยน`}
    >
      {glyph}
    </button>
  )
}
