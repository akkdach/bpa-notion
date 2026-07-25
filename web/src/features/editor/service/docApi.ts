import { apiClient } from '@/lib/apiClient'

// ═══════════════════════════════════════════════════════════════════════════
//  ชั้น HTTP ของเนื้อหาเอกสาร — ไบนารีล้วน ไม่ใช่ JSON
// ═══════════════════════════════════════════════════════════════════════════

export interface DocumentBootstrap {
  /** frame ที่แกะแล้ว: ตัวแรกคือ snapshot (ยาว 0 ถ้ายังไม่เคย compact) */
  frames: Uint8Array[]
  headSeq: number
  role: string
  shouldCompact: boolean
}

/**
 * แกะรูปแบบ [u32 count][u32 len][bytes]…
 * ⚠️ ต้องตรงกับ DocumentService.BuildFrames ฝั่ง API เป๊ะ ๆ (little-endian)
 */
function parseFrames(buffer: ArrayBuffer): Uint8Array[] {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const count = view.getUint32(0, true)

  const frames: Uint8Array[] = []
  let offset = 4

  for (let i = 0; i < count; i++) {
    const length = view.getUint32(offset, true)
    offset += 4
    frames.push(bytes.subarray(offset, offset + length))
    offset += length
  }

  return frames
}

export async function fetchDocument(
  pageId: string,
  signal?: AbortSignal,
): Promise<DocumentBootstrap> {
  const response = await apiClient.get<ArrayBuffer>(`/pages/${pageId}/ydoc`, {
    responseType: 'arraybuffer',
    ...(signal ? { signal } : {}),
  })

  return {
    frames: parseFrames(response.data),
    headSeq: Number(response.headers['x-doc-head-seq'] ?? 0),
    role: String(response.headers['x-doc-role'] ?? 'viewer'),
    shouldCompact: response.headers['x-doc-should-compact'] === '1',
  }
}

export interface AppendResult {
  seq: number
  shouldCompact: boolean
}

export async function appendUpdate(
  pageId: string,
  update: Uint8Array,
  yClientId: number,
): Promise<AppendResult> {
  const { data } = await apiClient.post<{ data: AppendResult }>(
    `/pages/${pageId}/ydoc/update?yClientId=${yClientId}`,
    update,
    { headers: { 'Content-Type': 'application/octet-stream' } },
  )
  return data.data
}

export async function saveSnapshot(
  pageId: string,
  snapshot: Uint8Array,
  upToSeq: number,
): Promise<void> {
  await apiClient.post(
    `/pages/${pageId}/ydoc/snapshot?upToSeq=${upToSeq}`,
    snapshot,
    { headers: { 'Content-Type': 'application/octet-stream' } },
  )
}

export async function saveProjection(
  pageId: string,
  projection: { title: string; plainText: string },
): Promise<void> {
  await apiClient.post(`/pages/${pageId}/projection`, projection)
}
