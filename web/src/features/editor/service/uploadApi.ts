import { apiClient, unwrap, type ApiEnvelope } from '@/lib/apiClient'

// ═══════════════════════════════════════════════════════════════════════════
//  อัปโหลดรูปให้ image block ของ BlockNote
//
//  ส่งไฟล์เป็น body ตรง ๆ พร้อม Content-Type ของรูป (ไม่ใช่ multipart) —
//  ฝั่ง API อ่านด้วย express.raw แบบเดียวกับ Yjs update และตรวจ magic bytes
//  ก่อนเขียนดิสก์ URL ที่ได้กลับมาเป็น path สัมพัทธ์ same-origin จึงใช้ได้
//  ทุก host ที่ proxy /api ให้
// ═══════════════════════════════════════════════════════════════════════════

export async function uploadImage(file: File): Promise<string> {
  const response = await apiClient.post<ApiEnvelope<{ url: string }>>('/files', file, {
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  })
  return unwrap(response.data).url
}
