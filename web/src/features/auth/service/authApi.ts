import { apiClient, unwrap, type ApiEnvelope } from '@/lib/apiClient'
import type { AuthSession, LoginInput, RegisterInput } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  ชั้น HTTP ของ auth — ไม่มี state ไม่มี React
// ═══════════════════════════════════════════════════════════════════════════

export async function register(input: RegisterInput): Promise<AuthSession> {
  const { data } = await apiClient.post<ApiEnvelope<AuthSession>>('/auth/register', input)
  return unwrap(data)
}

export async function login(input: LoginInput): Promise<AuthSession> {
  const { data } = await apiClient.post<ApiEnvelope<AuthSession>>('/auth/login', input)
  return unwrap(data)
}

/** ข้อมูลผู้ใช้ปัจจุบัน — ช่อง token ใน response จะว่าง endpoint นี้ไม่ออก token ใหม่ */
export async function fetchMe(signal?: AbortSignal): Promise<AuthSession> {
  const { data } = await apiClient.get<ApiEnvelope<AuthSession>>('/auth/me', {
    ...(signal ? { signal } : {}),
  })
  return unwrap(data)
}

export async function logout(refreshToken: string): Promise<void> {
  await apiClient.post('/auth/logout', { refreshToken })
}
