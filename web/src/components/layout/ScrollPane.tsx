import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ═══════════════════════════════════════════════════════════════════════════
//  ScrollPane — พื้นที่เลื่อนที่วาดแถบเลื่อนเอง
//
//  ⚠️ ทำไมไม่ใช้ scrollbar ของเบราว์เซอร์
//
//     ลองมาแล้วสองรอบและผู้ใช้ยังมองไม่เห็น: แถบของ OS ถูกควบคุมด้วยการตั้งค่า
//     ของ Windows ("ซ่อนแถบเลื่อนอัตโนมัติ" เปิดเป็นค่าเริ่มต้น) ทำให้มันเป็น
//     overlay ที่โผล่เฉพาะตอนกำลังเลื่อนแล้วจางหายไป — สั่งจาก CSS ให้ค้างไว้
//     ไม่ได้ และ `::-webkit-scrollbar` ก็ถูกเมินเมื่อประกาศ scrollbar-width
//
//     แถบที่วาดเองเป็น element จริงในหน้า จึงแสดงเหมือนกันทุกเครื่องทุกการตั้งค่า
//     และตรวจสอบได้ด้วยภาพหน้าจอ (ภาพจาก DevTools/Playwright ไม่เก็บแถบของ OS)
//
//  แถบซ่อนตัวเองเมื่อเนื้อหาสั้นกว่ากรอบ — ไม่มีอะไรให้เลื่อนก็ไม่ต้องมีแถบ
// ═══════════════════════════════════════════════════════════════════════════

const MIN_THUMB_PX = 32

interface ScrollPaneProps {
  children: ReactNode
  /** className ของกล่องนอก — ใช้จัดขนาด/ตำแหน่ง (แถบเลื่อนวางทับกล่องนี้) */
  className?: string
  /** className ของกล่องที่เลื่อนจริงข้างใน */
  viewportClassName?: string
}

export function ScrollPane({ children, className, viewportClassName }: ScrollPaneProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startScrollTop: number } | null>(null)
  const [thumb, setThumb] = useState({ top: 0, height: 0, visible: false })

  const measure = useCallback(() => {
    const el = viewportRef.current
    if (!el) return

    const { scrollTop, scrollHeight, clientHeight } = el
    const overflow = scrollHeight - clientHeight

    if (overflow <= 1) {
      setThumb((prev) => (prev.visible ? { ...prev, visible: false } : prev))
      return
    }

    const height = Math.max(MIN_THUMB_PX, (clientHeight / scrollHeight) * clientHeight)
    const top = (scrollTop / overflow) * (clientHeight - height)
    setThumb({ top, height, visible: true })
  }, [])

  // ─── ติดตามทั้งการเลื่อน การเปลี่ยนขนาด และเนื้อหาที่งอกทีหลัง ───────────
  // เนื้อหามาจาก editor ที่ render แบบ async — วัดครั้งเดียวตอน mount ไม่พอ
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    measure()
    el.addEventListener('scroll', measure, { passive: true })

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(el)
    if (el.firstElementChild) resizeObserver.observe(el.firstElementChild)

    const mutationObserver = new MutationObserver(measure)
    mutationObserver.observe(el, { childList: true, subtree: true, characterData: true })

    return () => {
      el.removeEventListener('scroll', measure)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [measure])

  // ─── ลากหัวจับ ───────────────────────────────────────────────────────────
  // ฟังที่ window ไม่ใช่ที่ตัวหัวจับ เพื่อให้ลากเลยขอบแล้วยังคุมได้อยู่
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const el = viewportRef.current
      const drag = dragRef.current
      if (!el || !drag) return

      const { scrollHeight, clientHeight } = el
      const thumbHeight = Math.max(MIN_THUMB_PX, (clientHeight / scrollHeight) * clientHeight)
      const travel = clientHeight - thumbHeight
      if (travel <= 0) return

      const ratio = (scrollHeight - clientHeight) / travel
      el.scrollTop = drag.startScrollTop + (event.clientY - drag.startY) * ratio
    }

    const onUp = () => {
      if (dragRef.current === null) return
      dragRef.current = null
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  return (
    <div className={cn('relative min-h-0', className)}>
      {/* pr-3 กันเนื้อหาลอดไปอยู่ใต้แถบ · ซ่อนแถบของ OS เพื่อไม่ให้มีสองแถบ */}
      <div
        ref={viewportRef}
        className={cn('h-full overflow-y-auto overflow-x-hidden pr-3 no-native-scrollbar', viewportClassName)}
      >
        {children}
      </div>

      {/* ⚠️ ห้ามใส่ aria-hidden ที่รางข้างล่าง — มันซ่อนหัวจับที่กดได้ข้างในไปด้วย
          ทั้งจาก screen reader และจากเทสที่ค้นด้วย role */}
      {thumb.visible && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-3 rounded-full bg-muted/60">
          <button
            type="button"
            aria-label="ลากเพื่อเลื่อนหน้า"
            className={cn(
              'pointer-events-auto absolute right-0.5 w-2 rounded-full',
              'bg-muted-foreground/70 hover:bg-muted-foreground active:bg-foreground',
              'cursor-grab active:cursor-grabbing',
            )}
            style={{ top: thumb.top, height: thumb.height }}
            onPointerDown={(event) => {
              event.preventDefault()
              dragRef.current = {
                startY: event.clientY,
                startScrollTop: viewportRef.current?.scrollTop ?? 0,
              }
              document.body.style.userSelect = 'none'
            }}
          />
        </div>
      )}
    </div>
  )
}
