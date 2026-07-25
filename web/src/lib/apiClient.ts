import axios, { type AxiosError, type AxiosInstance } from 'axios'

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

// ─── Phase 1: bearer token + 401 → refresh → retry ───────────────────────
// interceptor จะถูกเติมที่นี่ตอนมี AuthProvider แล้ว การวางไว้ในไฟล์นี้
// (ไม่ใช่ใน AuthProvider) ทำให้ service ทุกตัวได้ประโยชน์โดยไม่ต้องรู้เรื่อง auth

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiEnvelope<unknown>>) => {
    const status = error.response?.status ?? 0
    const envelope = error.response?.data

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
