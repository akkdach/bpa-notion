import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { pageKeys } from '@/features/pages'
import * as docApi from '../service/docApi'

// ═══════════════════════════════════════════════════════════════════════════
//  useYDoc — วงจรชีวิตของเอกสารหนึ่งหน้า
//
//  Phase 1 ยังไม่มี realtime: update ถูกส่งขึ้น REST
//  Phase 2 จะเปลี่ยน transport เป็น SignalR โดยที่ Y.Doc, IndexedDB และ
//  ตรรกะ batching ตรงนี้ไม่ต้องเปลี่ยน — นั่นคือเหตุผลที่แยกเป็น hook ตั้งแต่แรก
//
//  ⚠️ IndexedDB ทำให้เปิดหน้าซ้ำเห็นเนื้อหาทันทีโดยไม่ต้องรอเครือข่าย และทำให้
//     สิ่งที่พิมพ์ตอนออฟไลน์ไม่หาย
// ═══════════════════════════════════════════════════════════════════════════

/**
 * รวม update ก่อนส่ง
 *
 * y-prosemirror ยิง update ประมาณหนึ่งครั้งต่อการกดแป้นหนึ่งครั้ง (~10 ครั้ง
 * ต่อวินาทีต่อคน) การส่งทีละอันจะกลายเป็น ~10 INSERT/วินาที/คน ซึ่งทำให้
 * autovacuum เป็นคอขวดก่อน CPU เสียอีก
 *
 * รวม 400ms แล้วส่งก้อนเดียวลดจำนวนแถวลงราวสิบเท่าโดยที่เซิร์ฟเวอร์ไม่ต้องรู้
 * เรื่องอะไรเลย (Yjs merge ให้ฝั่ง client ได้ฟรี)
 */
const FLUSH_DELAY_MS = 400

/** ส่ง projection หลังผู้ใช้หยุดพิมพ์ — ไม่ต้องเร็ว เพราะเป็นข้อมูล derived */
const PROJECTION_DELAY_MS = 2000

export type DocStatus = 'loading' | 'ready' | 'saving' | 'error' | 'offline'

export interface UseYDocResult {
  doc: Y.Doc | null
  status: DocStatus
  error: Error | null
  /** เรียกเมื่อเนื้อหาเปลี่ยน เพื่อ debounce การส่ง projection */
  reportProjection: (title: string, plainText: string) => void
}

export function useYDoc(pageId: string | undefined): UseYDocResult {
  const queryClient = useQueryClient()

  // ─────────────────────────────────────────────────────────────────────
  //  Y.Doc สร้างตอน render ไม่ใช่ใน effect
  //
  //  ⚠️ เวอร์ชันแรกเก็บ doc ใน useState แล้ว setDoc() ใน effect body ซึ่ง
  //     react-hooks/set-state-in-effect ฟ้อง (ถูกแล้ว — มันทำให้ render
  //     ซ้อนกันรอบหนึ่งทุกครั้งที่เปลี่ยนหน้า)
  //
  //     useMemo ที่ผูกกับ pageId ให้ผลเดียวกันโดยไม่ต้อง setState เลย และ
  //     effect เหลือหน้าที่เดียวคือ "ต่อ doc เข้ากับโลกภายนอก" ซึ่งตรงกับที่
  //     effect ควรทำจริง ๆ
  // ─────────────────────────────────────────────────────────────────────
  const doc = useMemo(() => (pageId === undefined ? null : new Y.Doc()), [pageId])

  // เก็บ pageId ไว้ในตัว state ด้วย เพื่อให้รู้ว่าค่าที่มีเป็นของหน้าไหน
  // — เปลี่ยนหน้าแล้วอ่านได้ว่า 'loading' ทันทีตอน render โดยไม่ต้อง setState
  const [sync, setSync] = useState<{ pageId?: string; status: DocStatus; error: Error | null }>({
    status: 'loading',
    error: null,
  })

  const isCurrent = sync.pageId === pageId
  const status: DocStatus = isCurrent ? sync.status : 'loading'
  const error = isCurrent ? sync.error : null

  const projectionRef = useRef<{ title: string; plainText: string } | null>(null)
  const projectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (pageId === undefined || doc === null) return

    let disposed = false
    const controller = new AbortController()

    const ydoc = doc
    const persistence = new IndexeddbPersistence(`pm-page-${pageId}`, ydoc)

    // update ที่รอส่ง — เก็บสะสมแล้ว merge เป็นก้อนเดียว
    let pending: Uint8Array[] = []
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    let headSeq = 0

    async function flush() {
      flushTimer = null
      if (pending.length === 0 || disposed) return

      const merged = Y.mergeUpdates(pending)
      pending = []

      try {
        setSync({ pageId, status: 'saving', error: null })
        const result = await docApi.appendUpdate(pageId!, merged, ydoc.clientID)
        headSeq = result.seq
        if (!disposed) setSync({ pageId, status: 'ready', error: null })

        // เซิร์ฟเวอร์บอกว่า log ยาวแล้ว — client เป็นฝ่ายสร้าง snapshot ให้
        // (เซิร์ฟเวอร์ merge CRDT เองไม่ได้)
        if (result.shouldCompact) {
          await docApi
            .saveSnapshot(pageId!, Y.encodeStateAsUpdate(ydoc), headSeq)
            .catch(() => undefined)   // compact ล้มเหลวไม่กระทบผู้ใช้
        }
      } catch (cause) {
        // ⚠️ ไม่ทิ้ง update ที่ส่งไม่สำเร็จ — เอากลับเข้าคิว
        //    เนื้อหายังอยู่ใน IndexedDB อยู่แล้ว แต่การเอากลับเข้าคิวทำให้
        //    รอบถัดไปส่งไปด้วยโดยไม่ต้องรอ reload
        pending.unshift(merged)
        if (!disposed) {
          setSync({ pageId, status: 'offline', error: cause instanceof Error ? cause : new Error(String(cause)) })
        }
      }
    }

    function handleUpdate(update: Uint8Array, origin: unknown) {
      // ข้าม update ที่มาจากการโหลดครั้งแรก (origin = ตัว persistence เอง
      // หรือ 'bootstrap') ไม่งั้นจะส่งของที่เพิ่งดาวน์โหลดมากลับขึ้นไปทันที
      if (origin === persistence || origin === 'bootstrap') return

      pending.push(update)
      flushTimer ??= setTimeout(() => void flush(), FLUSH_DELAY_MS)
    }

    async function bootstrap() {
      try {
        // รอ IndexedDB ก่อน — ได้เนื้อหาขึ้นจอทันทีโดยไม่ต้องรอเครือข่าย
        await persistence.whenSynced

        const remote = await docApi.fetchDocument(pageId!, controller.signal)
        if (disposed) return

        // ⚠️ origin = 'bootstrap' เพื่อไม่ให้ handleUpdate ส่งกลับขึ้นเซิร์ฟเวอร์
        //    Yjs idempotent อยู่แล้วจึงไม่เสียหาย แต่จะเปลือง log ฟรี ๆ
        ydoc.transact(() => {
          for (const frame of remote.frames) {
            if (frame.length > 0) Y.applyUpdate(ydoc, frame, 'bootstrap')
          }
        }, 'bootstrap')

        headSeq = remote.headSeq
        ydoc.on('update', handleUpdate)

        setSync({ pageId, status: 'ready', error: null })
      } catch (cause) {
        if (disposed) return

        // มีสำเนาใน IndexedDB อยู่แล้ว → ทำงานต่อแบบออฟไลน์ได้
        ydoc.on('update', handleUpdate)
        setSync({ pageId, status: 'offline', error: cause instanceof Error ? cause : new Error(String(cause)) })
      }
    }

    void bootstrap()

    return () => {
      disposed = true
      controller.abort()
      if (flushTimer !== null) clearTimeout(flushTimer)
      ydoc.off('update', handleUpdate)

      // ส่งของที่ค้างก่อนปิด — ไม่ await เพราะ cleanup ต้อง synchronous
      if (pending.length > 0) {
        const merged = Y.mergeUpdates(pending)
        void docApi.appendUpdate(pageId, merged, ydoc.clientID).catch(() => undefined)
      }

      void persistence.destroy()
      ydoc.destroy()
    }
  }, [pageId, doc])

  // ─── projection แยกจาก update stream ────────────────────────────────────
  // เป็นข้อมูล derived ที่ใช้ทำ index ค้นหาและ title ใน sidebar จึงส่งช้ากว่า
  // และไม่ต้องรับประกันว่าถึงทุกครั้ง
  useEffect(() => {
    if (pageId === undefined) return

    const timer = projectionTimer
    const payloadRef = projectionRef

    return () => {
      if (timer.current !== null) clearTimeout(timer.current)

      // ─────────────────────────────────────────────────────────────────
      //  ส่ง projection ที่ค้างอยู่ก่อนออกจากหน้า
      //
      //  ถ้าไม่ทำ ผู้ใช้ที่พิมพ์แล้วกดไปหน้าอื่นภายใน 2 วินาที จะเห็นชื่อหน้า
      //  ใน sidebar เป็น "ไม่มีชื่อ" ต่อไปทั้งที่พิมพ์ไปแล้ว — เนื้อหาไม่หาย
      //  (นั่นคนละสาย) แต่ดูเหมือนระบบไม่บันทึก
      // ─────────────────────────────────────────────────────────────────
      const pendingProjection = payloadRef.current
      if (pendingProjection !== null) {
        payloadRef.current = null
        void docApi
          .saveProjection(pageId, pendingProjection)
          .then(() => queryClient.invalidateQueries({ queryKey: pageKeys.tree }))
          .catch(() => undefined)
      }
    }
  }, [pageId, queryClient])

  function reportProjection(title: string, plainText: string) {
    if (pageId === undefined) return

    projectionRef.current = { title, plainText }

    if (projectionTimer.current !== null) clearTimeout(projectionTimer.current)

    projectionTimer.current = setTimeout(() => {
      const payload = projectionRef.current
      if (payload === null) return

      void docApi
        .saveProjection(pageId, payload)
        // ─────────────────────────────────────────────────────────────
        //  ต้อง invalidate tree ด้วย ไม่งั้นชื่อหน้าใน sidebar ค้างเป็น
        //  "ไม่มีชื่อ" ทั้งที่เซิร์ฟเวอร์อัปเดตแล้ว
        //
        //  projection เขียน pages.title ฝั่งเซิร์ฟเวอร์ แต่ cache ของ
        //  React Query ไม่มีทางรู้เอง — นี่คือจุดที่ Phase 2 จะเปลี่ยนไป
        //  รับสัญญาณจาก SignalR แทนการ invalidate เอง
        // ─────────────────────────────────────────────────────────────
        .then(() => queryClient.invalidateQueries({ queryKey: pageKeys.tree }))
        .catch(() => undefined)
    }, PROJECTION_DELAY_MS)
  }

  return { doc, status, error, reportProjection }
}
