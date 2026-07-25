/** โหนดใน sidebar — ตรงกับ PageNodeDto ฝั่ง API */
export interface PageNode {
  id: string
  parentId: string | null
  title: string
  icon?: string
  rank: string
  depth: number
  hasChildren: boolean
  updatedAt: string
  deletedAt?: string
}

/** ตรงกับ PageDto ฝั่ง API */
export interface Page {
  id: string
  parentId: string | null
  ancestorIds: string[]
  depth: number
  rank: string
  kind: 'page' | 'database' | 'db_row'
  title: string
  icon?: string
  coverUrl?: string
  accessRootId: string
  myRole: 'viewer' | 'commenter' | 'editor' | 'full'
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface CreatePageInput {
  parentId: string | null
  title?: string
  afterPageId?: string
}
