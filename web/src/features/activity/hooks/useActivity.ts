import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as activityApi from '../service/activityApi'
import type { ActivityQuery } from '../types'

export const activityKeys = {
  feed: (query: ActivityQuery) => ['activity', 'feed', query] as const,
  notes: (pageId: string) => ['activity', 'notes', pageId] as const,
}

export function useActivity(query: ActivityQuery = {}) {
  return useQuery({
    queryKey: activityKeys.feed(query),
    queryFn: ({ signal }) => activityApi.fetchActivity(query, signal),
  })
}

export function useNotes(pageId: string | undefined) {
  return useQuery({
    queryKey: activityKeys.notes(pageId ?? ''),
    queryFn: ({ signal }) => activityApi.fetchNotes(pageId!, signal),
    enabled: pageId !== undefined,
  })
}

export function useAddNote(pageId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: string) => activityApi.addNote(pageId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: activityKeys.notes(pageId) })
      // การเขียนบันทึกสร้างแถวในฟีดด้วย — ต้อง refetch ทั้งสองอย่าง
      void queryClient.invalidateQueries({ queryKey: ['activity', 'feed'] })
    },
  })
}

// ═══════════════════════════════════════════════════════════════════════════
//  ไม่มี hook สำหรับ "ย้อนกลับ" ที่นี่โดยเจตนา
//
//  การย้อนสถานะคือการแก้หน้า ซึ่งเป็นงานของ features/pages (useUpdatePage)
//  ชั้น page/ เป็นคนต่อสองอย่างเข้าด้วยกัน — ตรงกับที่ทั้งโปรเจกต์ทำอยู่:
//  feature ไม่เรียก mutation ของ feature อื่นเอง
//
//  ⚠️ และย้อนได้เฉพาะ "สถานะ" เท่านั้น ไม่ใช่ทุกเหตุการณ์:
//     · ย้อนการลบ = กู้คืน ซึ่งกู้ทั้ง subtree แบบไม่มีเงื่อนไข รวมลูกที่ถูกลบ
//       ไปก่อนหน้านั้นแล้ว — ย้อนอีกทีไม่ได้ (RestoreSubtreeAsync)
//     · ย้อนการย้าย ต้องรู้ rank เดิมในหมู่พี่น้อง ซึ่งประวัติไม่ได้เก็บ
//     · ย้อนการเขียนบันทึก = ลบบันทึก ซึ่งขัดกับที่ตั้งใจให้ append-only
//
//     ปุ่มย้อนกลับที่ทำงานถูกบ้างผิดบ้างแย่กว่าปุ่มที่โผล่เฉพาะตอนย้อนได้จริง
// ═══════════════════════════════════════════════════════════════════════════
