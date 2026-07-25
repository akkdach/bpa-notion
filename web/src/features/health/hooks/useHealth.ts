import { useQuery } from '@tanstack/react-query'
import { fetchHealth } from '../service/healthApi'

// ═══════════════════════════════════════════════════════════════════════════
//  ที่เดียวที่ดึงข้อมูล — component รับผลผ่าน props/return value เท่านั้น
// ═══════════════════════════════════════════════════════════════════════════

export const healthKeys = {
  all: ['health'] as const,
}

export function useHealth() {
  return useQuery({
    queryKey: healthKeys.all,
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 15_000,
    staleTime: 0,
  })
}
