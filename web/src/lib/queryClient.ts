import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './apiClient'

// ═══════════════════════════════════════════════════════════════════════════
//  TanStack Query
//
//  จุดที่ SignalR จะมาเรียก invalidateQueries ตอน Phase 4 เมื่อมี row เปลี่ยน
//  จาก client อื่น — นี่คือเหตุผลหลักที่เลือกใช้ React Query แทน fetch เอง
// ═══════════════════════════════════════════════════════════════════════════
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,

      // ไม่ต้อง refetch ตอนสลับแท็บ — realtime update มาทาง SignalR อยู่แล้ว
      refetchOnWindowFocus: false,

      retry: (failureCount, error) => {
        // 4xx = คำขอเราผิด retry ไปก็ผิดเหมือนเดิม
        // ยกเว้น 408 (timeout) และ 429 (rate limit) ที่ retry มีความหมาย
        if (error instanceof ApiError) {
          const retryable = error.status === 408 || error.status === 429
          if (error.status >= 400 && error.status < 500 && !retryable) return false
        }
        return failureCount < 2
      },
    },
    mutations: {
      // mutation ไม่ retry อัตโนมัติ — ซ้ำโดยไม่ได้ตั้งใจอันตรายกว่าล้มเหลว
      retry: false,
    },
  },
})
