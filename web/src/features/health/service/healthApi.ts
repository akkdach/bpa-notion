import { apiClient, unwrap, type ApiEnvelope } from '@/lib/apiClient'
import type { HealthStatus } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  ชั้น HTTP — ที่เดียวที่ยิง request จริง ไม่มี state, ไม่มี React
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchHealth(signal?: AbortSignal): Promise<HealthStatus> {
  // health ตอบ 503 ตอนไม่สมบูรณ์ ซึ่ง axios ถือเป็น error
  // แต่ตรงนี้เราอยากได้ payload มาแสดงด้วย จึงยอมรับทั้ง 200 และ 503
  const response = await apiClient.get<ApiEnvelope<HealthStatus>>('/health', {
    // spread แบบมีเงื่อนไข เพราะ tsconfig เปิด exactOptionalPropertyTypes
    // การส่ง `signal: undefined` ตรง ๆ ไม่ผ่าน type check
    ...(signal ? { signal } : {}),
    validateStatus: (status: number) => status === 200 || status === 503,
  })

  const envelope = response.data

  // 503 มาพร้อม data เสมอ (ดู controller) จึงอ่านตรงได้ ไม่ต้องผ่าน unwrap
  // ที่จะ throw เพราะ success === false
  if (response.status === 503 && envelope.data) {
    return envelope.data
  }

  return unwrap(envelope)
}
