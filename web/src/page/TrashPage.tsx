import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth'
import { TrashList, usePurgePage, useRestorePage, useTrash } from '@/features/pages'

// ═══════════════════════════════════════════════════════════════════════════
//  TrashPage — ประกอบ route เข้าด้วยกัน ไม่มี logic ของตัวเอง
//
//  endpoint ทั้งสามตัว (trash / restore / purge) มีมาตั้งแต่ Phase 1 แต่ไม่เคย
//  มีหน้าจอเรียก การเปิดให้ AI ลบหน้าได้โดยที่เจ้าของกู้คืนไม่ได้ ถือว่าไม่ควร
//  จึงต้องมีหน้านี้ก่อนจะปล่อย tool ลบ
// ═══════════════════════════════════════════════════════════════════════════
export function TrashPage() {
  const navigate = useNavigate()
  const { currentWorkspace } = useAuth()

  const trash = useTrash()
  const restore = useRestorePage()
  const purge = usePurgePage()

  // จำว่าปุ่มไหนกำลังทำงาน เพื่อ disable แค่แถวนั้น ไม่ใช่ทั้งหน้า
  const [busyPageId, setBusyPageId] = useState<string>()

  const role = currentWorkspace?.role
  const canPurge = role === 'owner' || role === 'admin'

  const run = (pageId: string, action: (id: string) => Promise<unknown>) => {
    setBusyPageId(pageId)
    void action(pageId).finally(() => setBusyPageId(undefined))
  }

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => void navigate('/')}
        >
          <ArrowLeft className="size-4" aria-hidden />
          กลับ
        </Button>
        <h1 className="text-lg font-semibold">ถังขยะ</h1>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        กู้คืนแล้วหน้าลูกทั้งหมดที่อยู่ข้างใต้จะกลับมาด้วย — รวมหน้าที่ถูกลบไปก่อนหน้านี้
        ซึ่งย้อนกลับไม่ได้
      </p>

      {trash.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : trash.error ? (
        <p className="py-10 text-center text-sm text-destructive">{trash.error.message}</p>
      ) : (
        <TrashList
          nodes={trash.data ?? []}
          canPurge={canPurge}
          busyPageId={busyPageId}
          onRestore={(id) => run(id, restore.mutateAsync)}
          onPurge={(id) => run(id, purge.mutateAsync)}
        />
      )}
    </main>
  )
}
