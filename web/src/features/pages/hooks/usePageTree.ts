import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as pageApi from '../service/pageApi'
import type { CreatePageInput, PageNode, UpdatePageInput } from '../types'

export const pageKeys = {
  tree: ['pages', 'tree'] as const,
  trash: ['pages', 'trash'] as const,
  detail: (pageId: string) => ['pages', 'detail', pageId] as const,
}

export function usePageTree() {
  return useQuery({
    queryKey: pageKeys.tree,
    queryFn: ({ signal }) => pageApi.fetchTree(signal),
  })
}

export function usePage(pageId: string | undefined) {
  return useQuery({
    queryKey: pageKeys.detail(pageId ?? ''),
    queryFn: ({ signal }) => pageApi.fetchPage(pageId!, signal),
    enabled: pageId !== undefined,
  })
}

export function useCreatePage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreatePageInput) => pageApi.createPage(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pageKeys.tree }),
  })
}

export function useDeletePage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (pageId: string) => pageApi.deletePage(pageId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pageKeys.tree })
      void queryClient.invalidateQueries({ queryKey: pageKeys.trash })
    },
  })
}

// ═══════════════════════════════════════════════════════════════════════════
//  แก้หน้า — optimistic เพราะ status chip ถูกกดรัว ๆ ได้
//
//  รอ round-trip ก่อนค่อยเปลี่ยนสีทำให้รู้สึกว่ากดไม่ติด แล้วผู้ใช้จะกดซ้ำ
//  ซึ่งวนสถานะเกินที่ต้องการ
// ═══════════════════════════════════════════════════════════════════════════
export function useUpdatePage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ pageId, input }: { pageId: string; input: UpdatePageInput }) =>
      pageApi.updatePage(pageId, input),

    onMutate: async ({ pageId, input }) => {
      await queryClient.cancelQueries({ queryKey: pageKeys.tree })
      const previous = queryClient.getQueryData<PageNode[]>(pageKeys.tree)

      queryClient.setQueryData<PageNode[]>(pageKeys.tree, (nodes) =>
        nodes?.map((node) =>
          node.id === pageId
            ? {
                ...node,
                ...(input.title !== undefined ? { title: input.title } : {}),
                // null = ล้างไอคอน → ฝั่ง cache เก็บเป็น undefined
                ...(input.icon !== undefined ? { icon: input.icon ?? undefined } : {}),
                // '' = ล้างสถานะ ต้องกลายเป็น undefined ไม่ใช่สตริงว่าง
                ...(input.status !== undefined
                  ? { status: input.status === '' ? undefined : input.status }
                  : {}),
              }
            : node,
        ),
      )

      return { previous }
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(pageKeys.tree, context.previous)
    },

    // settled ไม่ใช่ success — ต้อง refetch ทั้งตอนสำเร็จและตอนล้มเหลว
    // เพื่อให้สิ่งที่เห็นตรงกับเซิร์ฟเวอร์เสมอ
    onSettled: (_data, _error, { pageId }) => {
      void queryClient.invalidateQueries({ queryKey: pageKeys.tree })
      void queryClient.invalidateQueries({ queryKey: pageKeys.detail(pageId) })
    },
  })
}

// ═══════════════════════════════════════════════════════════════════════════
//  ถังขยะ
// ═══════════════════════════════════════════════════════════════════════════
export function useTrash() {
  return useQuery({
    queryKey: pageKeys.trash,
    queryFn: ({ signal }) => pageApi.fetchTrash(signal),
  })
}

export function useRestorePage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (pageId: string) => pageApi.restorePage(pageId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pageKeys.tree })
      void queryClient.invalidateQueries({ queryKey: pageKeys.trash })
    },
  })
}

export function usePurgePage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (pageId: string) => pageApi.purgePage(pageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pageKeys.trash }),
  })
}

// ═══════════════════════════════════════════════════════════════════════════
//  ประกอบรายการแบน ๆ ที่ API ส่งมาให้เป็นโครงต้นไม้
//
//  API ส่งมาเรียงตาม depth แล้ว rank แล้ว id อยู่แล้ว การไล่ทีละตัวจึงเจอ
//  พ่อก่อนลูกเสมอ — ไม่ต้อง sort ซ้ำ
//
//  ⚠️ ห้ามเรียงใหม่ฝั่ง client ด้วย localeCompare หรือ sort ปกติ
//     rank เป็น fractional index แบบ base62 ที่ต้องเทียบแบบ byte order
//     ฝั่งฐานข้อมูลใช้ COLLATE "C" ให้แล้ว การมาเรียงซ้ำที่นี่มีแต่จะทำให้
//     ลำดับต่างจากที่เซิร์ฟเวอร์เห็น
// ═══════════════════════════════════════════════════════════════════════════
export interface TreeNode extends PageNode {
  children: TreeNode[]
}

export function buildTree(nodes: PageNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  for (const node of nodes) {
    byId.set(node.id, { ...node, children: [] })
  }

  for (const node of nodes) {
    const built = byId.get(node.id)!
    const parent = node.parentId !== null ? byId.get(node.parentId) : undefined

    if (parent) parent.children.push(built)
    else roots.push(built)
  }

  return roots
}
