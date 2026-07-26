import { apiClient, unwrap, type ApiEnvelope } from '@/lib/apiClient'
import type { CreatePageInput, Page, PageNode, UpdatePageInput } from '../types'

export async function fetchTree(signal?: AbortSignal): Promise<PageNode[]> {
  const { data } = await apiClient.get<ApiEnvelope<PageNode[]>>('/pages', {
    ...(signal ? { signal } : {}),
  })
  return unwrap(data)
}

export async function fetchPage(pageId: string, signal?: AbortSignal): Promise<Page> {
  const { data } = await apiClient.get<ApiEnvelope<Page>>(`/pages/${pageId}`, {
    ...(signal ? { signal } : {}),
  })
  return unwrap(data)
}

export async function createPage(input: CreatePageInput): Promise<Page> {
  const { data } = await apiClient.post<ApiEnvelope<Page>>('/pages', input)
  return unwrap(data)
}

/**
 * แก้ชื่อ / ไอคอน / ปก / สถานะ
 *
 * ⚠️ ก่อนหน้านี้ไฟล์นี้ไม่มีฟังก์ชัน PATCH เลย ทั้งที่ API มี endpoint อยู่แล้ว
 *    ผลคือ `pages.status` เป็นคอลัมน์ที่ MCP เขียนได้ฝ่ายเดียวและเว็บมองไม่เห็น
 */
export async function updatePage(pageId: string, input: UpdatePageInput): Promise<Page> {
  const { data } = await apiClient.patch<ApiEnvelope<Page>>(`/pages/${pageId}`, input)
  return unwrap(data)
}

export async function deletePage(pageId: string): Promise<number> {
  const { data } = await apiClient.delete<ApiEnvelope<number>>(`/pages/${pageId}`)
  return unwrap(data)
}

export async function movePage(
  pageId: string,
  input: { parentId: string | null; afterPageId?: string },
): Promise<void> {
  await apiClient.post(`/pages/${pageId}/move`, input)
}

// ─── ถังขยะ ────────────────────────────────────────────────────────────────
// endpoint ทั้งสามตัวนี้มีฝั่ง API มาตั้งแต่ Phase 1 แต่ไม่เคยมี UI เรียก
// = ลบแล้วกู้คืนไม่ได้จากหน้าเว็บ ซึ่งเป็นปัญหามากขึ้นเมื่อ AI ลบหน้าได้ด้วย

export async function fetchTrash(signal?: AbortSignal): Promise<PageNode[]> {
  const { data } = await apiClient.get<ApiEnvelope<PageNode[]>>('/pages/trash', {
    ...(signal ? { signal } : {}),
  })
  return unwrap(data)
}

/** คืนจำนวนหน้าที่ถูกกู้ (ทั้ง subtree) */
export async function restorePage(pageId: string): Promise<number> {
  const { data } = await apiClient.post<ApiEnvelope<number>>(`/pages/${pageId}/restore`)
  return unwrap(data)
}

/** ลบถาวร — owner/admin เท่านั้น ย้อนกลับไม่ได้ */
export async function purgePage(pageId: string): Promise<number> {
  const { data } = await apiClient.delete<ApiEnvelope<number>>(`/pages/${pageId}/purge`)
  return unwrap(data)
}
