// ═══════════════════════════════════════════════════════════════════════════
//  เวลาแบบ "5 นาทีที่แล้ว"
//
//  อยู่ใน lib เพราะทั้ง features/pages (เปลี่ยนแปลงล่าสุด) และ features/activity
//  (ฟีดกิจกรรม) ต้องใช้ ถ้าปล่อยให้ต่างคนต่างมี ข้อความเวลาในสองหน้าจะเพี้ยนจากกัน
//  ตอนใครสักคนแก้ที่เดียว
//
//  ใช้ Intl.RelativeTimeFormat แทน date-fns เพราะคุมถ้อยคำไทยได้เองและไม่เพิ่ม
//  ขนาด bundle (bundle เป็นหนี้ที่รู้ตัวอยู่แล้ว — ดู README)
// ═══════════════════════════════════════════════════════════════════════════
const relative = new Intl.RelativeTimeFormat('th-TH', { numeric: 'auto' })

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
]

export function formatRelative(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000

  // เวลาในอนาคตเกิดได้จาก clock skew ระหว่างเซิร์ฟเวอร์กับเครื่องผู้ใช้
  // "อีก 3 วินาที" อ่านแล้วสับสน จึงบีบให้เป็น "เมื่อสักครู่"
  if (seconds > -45 && seconds < 45) return 'เมื่อสักครู่'

  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit)
    }
  }

  return 'เมื่อสักครู่'
}
