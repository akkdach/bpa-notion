import axios, { type AxiosError, type AxiosInstance } from 'axios'
import { tokenStore } from './tokenStore'

// ═══════════════════════════════════════════════════════════════════════════
//  apiClient — instance เดียวของทั้งแอป
//
//  ⚠️ ไฟล์นี้กับ features/*/service/** เท่านั้นที่ import axios ได้
//     และมีแค่ features/*/service/** ที่ import ไฟล์นี้ได้
//     บังคับด้วย no-restricted-imports ใน eslint.config.js
//
//  เหตุผล: เวลา token หมดอายุ, retry, error shape เปลี่ยน — แก้ที่เดียว
//  ถ้า component เรียก axios เองได้ จะไม่มีจุดเดียวให้แก้อีกเลย
// ═══════════════════════════════════════════════════════════════════════════

/** envelope ที่ API ตอบกลับทุก endpoint — ตรงกับ Helpers/ApiResponse.cs */
export interface ApiEnvelope<T> {
  success: boolean
  data?: T
  message?: string
  code?: string
}

/**
 * error ที่ผ่าน interceptor แล้ว — มีข้อความที่แสดงต่อผู้ใช้ได้
 *
 * เขียน field แยกจาก constructor parameter เพราะ tsconfig เปิด
 * `erasableSyntaxOnly` ซึ่งไม่อนุญาต parameter property
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 30_000,
  // ส่ง cookie ไปด้วย (refresh token เป็น httpOnly cookie)
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

// ═══════════════════════════════════════════════════════════════════════════
//  Request: bearer token + workspace
//
//  ใส่ที่นี่ไม่ใช่ใน AuthProvider เพราะ service ทุกตัวต้องได้ header เหมือนกัน
//  โดยไม่ต้องรู้เรื่อง auth เลย
// ═══════════════════════════════════════════════════════════════════════════
apiClient.interceptors.request.use((config) => {
  const token = tokenStore.getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`

  // ⚠️ workspace มาจาก header ไม่ใช่จาก JWT (ดู ITenantContext ฝั่ง API)
  //    เพราะถ้าฝังใน token อายุ 24 ชม. การถอดคนออกจาก workspace จะไม่มีผล
  //    จนกว่า token หมดอายุ
  const workspaceId = tokenStore.getWorkspaceId()
  if (workspaceId) config.headers['X-Workspace-Id'] = workspaceId

  return config
})

// ═══════════════════════════════════════════════════════════════════════════
//  Response: 401 → refresh → ยิงซ้ำ
//
//  ⚠️ ต้องมี refreshPromise เดียวที่ใช้ร่วมกัน
//     หน้าเดียวยิง request ขนานกันหลายอัน (tree + page + ydoc) ถ้าแต่ละอัน
//     refresh เอง จะได้ refresh หลายรอบพร้อมกัน แล้วอันที่สองจะเจอ token ที่
//     ถูก rotate ไปแล้ว → API มองว่าเป็นการใช้ token ซ้ำ → ยกเลิกทั้ง session
//     (ดู AuthService.RefreshAsync) ผลคือผู้ใช้หลุดออกจากระบบเฉย ๆ
// ═══════════════════════════════════════════════════════════════════════════
let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  const refreshToken = tokenStore.getRefreshToken()
  if (!refreshToken) throw new ApiError('ไม่มี refresh token', 401)

  // ใช้ axios ตัวเปล่า ไม่ใช่ apiClient — ไม่งั้น 401 ตรงนี้จะวนเข้า
  // interceptor ตัวเองไม่จบ
  const response = await axios.post<ApiEnvelope<{ accessToken: string; refreshToken: string }>>(
    `${import.meta.env.VITE_API_BASE_URL}/auth/refresh`,
    { refreshToken },
    { headers: { 'Content-Type': 'application/json' } },
  )

  const data = unwrap(response.data)
  tokenStore.save(data.accessToken, data.refreshToken)
  return data.accessToken
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiEnvelope<unknown>>) => {
    const status = error.response?.status ?? 0
    const envelope = error.response?.data
    const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined

    const isRefreshable =
      status === 401 &&
      original !== undefined &&
      original._retried !== true &&
      tokenStore.getRefreshToken() !== null &&
      !original.url?.includes('/auth/')

    if (isRefreshable) {
      original._retried = true

      try {
        refreshPromise ??= refreshAccessToken().finally(() => {
          refreshPromise = null
        })

        await refreshPromise
        return await apiClient.request(original)
      } catch {
        tokenStore.clear()
        // ปล่อยให้ตกไปเป็น error ปกติข้างล่าง — AuthProvider จะเห็นแล้วพาไปหน้า login
      }
    }

    // ใช้ข้อความจาก API ก่อน เพราะเป็นภาษาไทยและอธิบายบริบทได้ตรงกว่า
    const message =
      envelope?.message ??
      (status === 0
        ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบว่า API ทำงานอยู่'
        : error.message)

    return Promise.reject(new ApiError(message, status, envelope?.code))
  },
)

/**
 * แกะ envelope ออกให้เหลือแค่ data
 * ทุกฟังก์ชันใน features/*&#47;service/ ควรผ่านตัวนี้ เพื่อไม่ให้ `.data.data`
 * กระจายอยู่ทั่วโค้ด
 */
export function unwrap<T>(envelope: ApiEnvelope<T>): T {
  if (!envelope.success || envelope.data === undefined) {
    throw new ApiError(envelope.message ?? 'คำขอไม่สำเร็จ', 200, envelope.code)
  }
  return envelope.data
}
