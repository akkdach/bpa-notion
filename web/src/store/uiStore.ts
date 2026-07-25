import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ═══════════════════════════════════════════════════════════════════════════
//  UI state เท่านั้น
//
//  ⚠️ ห้ามเอา server data หรือ document content มาไว้ที่นี่
//     server data อยู่ใน React Query, document อยู่ใน Y.Doc
//     ถ้าเอามาไว้ที่นี่จะได้ source of truth ที่สาม ซึ่งจะขัดกับอีกสองตัวแน่นอน
// ═══════════════════════════════════════════════════════════════════════════

type Theme = 'light' | 'dark' | 'system'

interface UiState {
  sidebarWidth: number
  sidebarCollapsed: boolean
  /** id ของ page ในแผนผังที่กางอยู่ */
  expandedPageIds: string[]
  theme: Theme

  setSidebarWidth: (width: number) => void
  toggleSidebar: () => void
  togglePageExpanded: (pageId: string) => void
  setTheme: (theme: Theme) => void
}

const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 480

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarWidth: 260,
      sidebarCollapsed: false,
      expandedPageIds: [],
      theme: 'system',

      setSidebarWidth: (width) =>
        set({
          sidebarWidth: Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH),
        }),

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      togglePageExpanded: (pageId) =>
        set((s) => ({
          expandedPageIds: s.expandedPageIds.includes(pageId)
            ? s.expandedPageIds.filter((id) => id !== pageId)
            : [...s.expandedPageIds, pageId],
        })),

      setTheme: (theme) => set({ theme }),
    }),
    { name: 'pm-ui' },
  ),
)
