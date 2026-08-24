import { useCallback } from 'react'
import { uploadImage } from '../service/uploadApi'

// ═══════════════════════════════════════════════════════════════════════════
//  ตัวอัปโหลดรูปที่ส่งให้ BlockNote
//
//  ⚠️ มีไฟล์นี้เพราะ layer: component ห้ามเรียก service ตรง ๆ (บังคับด้วย
//     eslint-plugin-boundaries) — ชั้นที่คุยกับ HTTP ได้คือ hooks เท่านั้น
//     ตอนแรกเขียนเป็น import ตรงใน PageEditor แล้ว gate ฟ้อง ซึ่งถูกแล้ว
//
//  useCallback เพื่อให้ reference คงที่ — BlockNote รับฟังก์ชันนี้ตอนสร้าง
//  editor ถ้า identity เปลี่ยนทุก render จะสร้าง editor ใหม่ทั้งตัว
// ═══════════════════════════════════════════════════════════════════════════
export function useUploadImage(): (file: File) => Promise<string> {
  return useCallback((file: File) => uploadImage(file), [])
}
