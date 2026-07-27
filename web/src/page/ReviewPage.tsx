import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ActivityFeed, useActivity } from '@/features/activity'
import { TaskBoard, usePageTree, useUpdatePage } from '@/features/pages'
import type { PageStatus } from '@/features/pages'
import type { UserKind } from '@/features/workspace'

// ═══════════════════════════════════════════════════════════════════════════
//  ReviewPage — ประกอบ route เข้าด้วยกัน ไม่มี logic ของตัวเอง
//
//  หน้าที่ตอบคำถาม "AI ทำอะไรไปบ้าง และงานอยู่ตรงไหนแล้ว"
//
//  ตัวกรองอยู่ใน URL (?actor=agent) เพื่อให้ปุ่มย้อนกลับของเบราว์เซอร์ทำงาน
//  และส่งลิงก์ "ดูเฉพาะที่ AI ทำ" ให้คนอื่นได้ — แบบเดียวกับหมวดในหน้าตั้งค่า
// ═══════════════════════════════════════════════════════════════════════════

type Tab = 'board' | 'activity'

export function ReviewPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const tab: Tab = params.get('tab') === 'activity' ? 'activity' : 'board'
  const actorParam = params.get('actor')
  const actorKind: UserKind | undefined =
    actorParam === 'agent' || actorParam === 'human' ? actorParam : undefined

  const tree = usePageTree()
  const updatePage = useUpdatePage()
  const activity = useActivity(actorKind === undefined ? {} : { actorKind })

  const [busyPageId, setBusyPageId] = useState<string>()

  const setStatus = (pageId: string, status: PageStatus | '') => {
    setBusyPageId(pageId)
    updatePage.mutate(
      { pageId, input: { status } },
      { onSettled: () => setBusyPageId(undefined) },
    )
  }

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params)
    if (value === undefined) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  return (
    <main className="mx-auto w-full max-w-4xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void navigate('/')}>
          <ArrowLeft className="size-4" aria-hidden />
          กลับ
        </Button>
        <h1 className="text-lg font-semibold">ตรวจงาน</h1>
      </div>

      {/* ─── แท็บ ───────────────────────────────────────────────────────── */}
      <div className="mb-4 flex gap-1 border-b" role="tablist">
        <TabButton
          active={tab === 'board'}
          onClick={() => setParam('tab', undefined)}
          label="บอร์ดงาน"
        />
        <TabButton
          active={tab === 'activity'}
          onClick={() => setParam('tab', 'activity')}
          label="ใครทำอะไร"
        />
      </div>

      {tab === 'board' ? (
        tree.isLoading ? (
          <Loading />
        ) : tree.error ? (
          <p className="py-10 text-center text-sm text-destructive">{tree.error.message}</p>
        ) : (
          <TaskBoard
            nodes={tree.data ?? []}
            busyPageId={busyPageId}
            onSelect={(id) => void navigate(`/p/${id}`)}
            onSetStatus={setStatus}
          />
        )
      ) : (
        <>
          {/* ─── กรองว่าใครทำ — เหตุผลหลักที่หน้านี้มีอยู่ ───────────────── */}
          <div className="mb-3 flex gap-1">
            <FilterChip
              active={actorKind === undefined}
              onClick={() => setParam('actor', undefined)}
              label="ทั้งหมด"
            />
            <FilterChip
              active={actorKind === 'agent'}
              onClick={() => setParam('actor', 'agent')}
              label="🤖 เฉพาะที่ AI ทำ"
            />
            <FilterChip
              active={actorKind === 'human'}
              onClick={() => setParam('actor', 'human')}
              label="👤 เฉพาะที่คนทำ"
            />
          </div>

          {activity.isLoading ? (
            <Loading />
          ) : activity.error ? (
            <p className="py-10 text-center text-sm text-destructive">{activity.error.message}</p>
          ) : (
            <ActivityFeed
              items={activity.data?.items ?? []}
              truncated={activity.data?.truncated ?? false}
              busyPageId={busyPageId}
              onSelectPage={(id) => void navigate(`/p/${id}`)}
              onUndoStatus={setStatus}
            />
          )}
        </>
      )}
    </main>
  )
}

function Loading() {
  return (
    <div className="flex justify-center py-10">
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
    </div>
  )
}

function TabButton({ active, onClick, label }: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-sm',
        active
          ? 'border-foreground font-medium'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}

function FilterChip({ active, onClick, label }: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs',
        active ? 'border-foreground bg-accent' : 'text-muted-foreground hover:bg-accent/50',
      )}
    >
      {label}
    </button>
  )
}
