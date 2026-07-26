import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppShell } from '@/components/layout/AppShell'
import { useUiStore } from '@/store/uiStore'
import { useAuth } from '@/features/auth'
import { WorkspaceSwitcher, useCreateWorkspace } from '@/features/workspace'
import {
  PageTree,
  RecentChanges,
  buildTree,
  nextStatus,
  useCreatePage,
  useDeletePage,
  usePageTree,
  useUpdatePage,
} from '@/features/pages'
import type { PageNode } from '@/features/pages'
import { PageView } from './PageView'

// ═══════════════════════════════════════════════════════════════════════════
//  WorkspacePage — ประกอบ route เข้าด้วยกัน
//  ต่อ hook เข้ากับ component ที่เป็น presentational ล้วน ไม่มี logic ของตัวเอง
// ═══════════════════════════════════════════════════════════════════════════
export function WorkspacePage() {
  const { pageId } = useParams<{ pageId: string }>()
  const navigate = useNavigate()

  // page/ เป็นชั้นที่ต่อ store เข้ากับ component ที่เป็น presentational ล้วน
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const expandedPageIds = useUiStore((s) => s.expandedPageIds)
  const togglePageExpanded = useUiStore((s) => s.togglePageExpanded)

  const { user, workspaces, currentWorkspace, selectWorkspace, logout } = useAuth()
  const createWorkspace = useCreateWorkspace()
  const createPage = useCreatePage()
  const deletePage = useDeletePage()
  const updatePage = useUpdatePage()
  const tree = usePageTree()

  const canEdit = currentWorkspace !== null && currentWorkspace.role !== 'guest'

  const switcher = (
    <WorkspaceSwitcher
      workspaces={workspaces}
      current={currentWorkspace}
      userName={user?.name ?? ''}
      onSelect={(id) => {
        selectWorkspace(id)
        void navigate('/', { replace: true })
      }}
      onCreate={async (name) => {
        await createWorkspace.mutateAsync({ name })
        void navigate('/', { replace: true })
      }}
      onOpenSettings={() => void navigate('/settings')}
      onLogout={() => {
        void logout().then(() => navigate('/login', { replace: true }))
      }}
    />
  )

  // ยังไม่มี workspace เลย — ต้องสร้างก่อนถึงจะทำอะไรได้
  if (currentWorkspace === null) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
        <div className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-7 text-center">
          <h1 className="text-lg font-semibold">ยังไม่มี workspace</h1>
          <p className="text-sm text-muted-foreground">
            สร้าง workspace แรกเพื่อเริ่มเก็บเอกสาร
          </p>
          <div className="pt-2">{switcher}</div>
        </div>
      </main>
    )
  }

  return (
    <AppShell
      sidebarWidth={sidebarWidth}
      collapsed={sidebarCollapsed}
      onToggleSidebar={toggleSidebar}
      sidebarHeader={
        <div className="space-y-1">
          {switcher}
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-muted-foreground"
              disabled={createPage.isPending}
              onClick={() => {
                createPage.mutate(
                  { parentId: null },
                  { onSuccess: (page) => void navigate(`/p/${page.id}`) },
                )
              }}
            >
              <Plus className="size-4" aria-hidden />
              หน้าใหม่
            </Button>
          )}
        </div>
      }
      sidebarBody={
        tree.isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : tree.error ? (
          <p className="px-3 py-6 text-sm text-destructive">{tree.error.message}</p>
        ) : (
          <PageTree
            nodes={buildTree(tree.data ?? [])}
            activePageId={pageId}
            onSelect={(id) => void navigate(`/p/${id}`)}
            onCreateChild={(parentId) => {
              // กางหน้าแม่ให้ด้วย ไม่งั้นสร้างหน้าย่อยแล้วมันหายไปเลย —
              // ผู้ใช้ถูกพาไปหน้าใหม่แต่ sidebar ไม่แสดงว่ามันอยู่ตรงไหน
              if (!expandedPageIds.includes(parentId)) togglePageExpanded(parentId)

              createPage.mutate(
                { parentId },
                { onSuccess: (page) => void navigate(`/p/${page.id}`) },
              )
            }}
            onDelete={(id) => {
              deletePage.mutate(id, {
                onSuccess: () => {
                  if (id === pageId) void navigate('/', { replace: true })
                },
              })
            }}
            onCycleStatus={(id) => {
              // อ่านสถานะจาก cache ที่ tree ใช้อยู่ ไม่ใช่จาก tree ที่ประกอบแล้ว
              // เพื่อให้ค่าที่ใช้คำนวณสถานะถัดไปเป็นค่าเดียวกับที่แสดงอยู่จริง
              const current = tree.data?.find((node) => node.id === id)?.status
              updatePage.mutate({ pageId: id, input: { status: nextStatus(current) } })
            }}
          />
        )
      }
      sidebarFooter={
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => void navigate('/trash')}
        >
          <Trash2 className="size-4" aria-hidden />
          ถังขยะ
        </Button>
      }
    >
      {pageId === undefined ? (
        <Home
          nodes={tree.data ?? []}
          currentUserId={user?.id}
          onSelect={(id) => void navigate(`/p/${id}`)}
        />
      ) : (
        <PageView pageId={pageId} />
      )}
    </AppShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  หน้าแรกเมื่อยังไม่ได้เลือกหน้าไหน
//
//  เดิมเป็นข้อความ "เลือกหน้าจากแถบด้านซ้าย" กลางจอเปล่า ๆ ซึ่งเป็นพื้นที่ที่
//  เปิดแอปมาแล้วเห็นก่อนทุกครั้ง — เอามาใช้บอกว่ามีอะไรเปลี่ยนไปบ้างคุ้มกว่า
//  โดยเฉพาะเมื่อ AI แก้งานอยู่เบื้องหลัง
// ═══════════════════════════════════════════════════════════════════════════
function Home({ nodes, currentUserId, onSelect }: {
  nodes: PageNode[]
  currentUserId?: string | undefined
  onSelect: (pageId: string) => void
}) {
  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          ยังไม่มีหน้า — กด “หน้าใหม่” ที่แถบด้านซ้าย
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h1 className="mb-4 text-lg font-semibold">เปลี่ยนแปลงล่าสุด</h1>
      <RecentChanges nodes={nodes} currentUserId={currentUserId} onSelect={onSelect} />
    </div>
  )
}
