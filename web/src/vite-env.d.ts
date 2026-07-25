/// <reference types="vite/client" />

// ═══════════════════════════════════════════════════════════════════════════
//  พิมพ์ชนิดของ env ที่แอปใช้ ให้ import.meta.env.VITE_* ไม่เป็น any
//  พิมพ์ชื่อผิดจะเป็น compile error ไม่ใช่ undefined ตอน runtime
// ═══════════════════════════════════════════════════════════════════════════
interface ImportMetaEnv {
  /** base URL ของ REST API — ปกติเป็น /api/v1 (same-origin ผ่าน nginx) */
  readonly VITE_API_BASE_URL: string
  /** URL ของ SignalR hub — ปกติเป็น /hubs/doc */
  readonly VITE_HUB_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
