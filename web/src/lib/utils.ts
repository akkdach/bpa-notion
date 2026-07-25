import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * รวม class name แล้วให้ตัวหลังชนะตัวหน้าเมื่อชนกัน
 * (`cn('p-2', 'p-4')` → `'p-4'` ไม่ใช่ `'p-2 p-4'`)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
