import { useEffect, useSyncExternalStore } from 'react'
import { useUiStore } from '@/store/uiStore'

// ═══════════════════════════════════════════════════════════════════════════
//  ธีม — เลือกไว้ใน uiStore แล้วเอามาแปะเป็นคลาส .dark บน <html>
//
//  index.css ประกาศ `@custom-variant dark (&:is(.dark *))` ไว้แล้ว ทุก utility
//  ที่ขึ้นต้นด้วย dark: จึงทำงานทันทีที่คลาสนี้ติด — ไม่ต้องแก้ CSS เพิ่มเลย
//
//  ⚠️ ไม่ใช้ next-themes ทั้งที่มันอยู่ใน package.json — มันมากับ sonner.tsx ที่
//     shadcn generate ให้ และไม่เคยมี ThemeProvider ของมันในแอปนี้เลย
//     useTheme() ของมันจึงคืน 'system' ค้างตลอด การมี provider สองตัวที่จำธีม
//     คนละที่คือทางลัดไปสู่สถานะที่ไม่ตรงกัน — เลือก uiStore ตัวเดียวเพราะมัน
//     persist อยู่แล้วและเป็นที่อยู่ของ UI state ตามกฎในไฟล์นั้น
// ═══════════════════════════════════════════════════════════════════════════

export type ResolvedTheme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * ธีมของระบบปฏิบัติการ ณ ขณะนี้
 *
 * ใช้ useSyncExternalStore เพราะค่านี้เปลี่ยนได้จากนอก React (ผู้ใช้สลับโหมด
 * ของ OS ระหว่างที่แอปเปิดอยู่) — subscribe ตรง ๆ ได้ค่าที่ถูกเสมอโดยไม่ต้อง
 * setState ใน effect
 */
function useSystemTheme(): ResolvedTheme {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(DARK_QUERY)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'),
    // ค่าตอน server render — โปรเจกต์นี้เป็น SPA ล้วน แต่ใส่ไว้ให้ครบ signature
    () => 'light',
  )
}

/** ธีมที่แสดงผลจริง หลังแปลง 'system' เป็นค่าที่ชี้ขาดแล้ว */
export function useResolvedTheme(): ResolvedTheme {
  const theme = useUiStore((s) => s.theme)
  const system = useSystemTheme()

  return theme === 'system' ? system : theme
}

/**
 * แปะคลาสธีมลง <html> — เรียกครั้งเดียวที่ราก
 */
export function useApplyTheme(): void {
  const resolved = useResolvedTheme()

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')

    // บอกเบราว์เซอร์ด้วย เพื่อให้ scrollbar / form control ที่ระบบวาดเองเข้าธีม
    root.style.colorScheme = resolved
  }, [resolved])
}
