import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as pageApi from '../service/pageApi'
import type { CreatePageInput, PageNode } from '../types'

export const pageKeys = {
  tree: ['pages', 'tree'] as const,
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pageKeys.tree }),
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
