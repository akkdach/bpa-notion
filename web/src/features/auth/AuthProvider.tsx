import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { tokenStore } from '@/lib/tokenStore'
import * as authApi from './service/authApi'
import type { AuthSession, LoginInput, RegisterInput, User, WorkspaceSummary } from './types'

// ═══════════════════════════════════════════════════════════════════════════
//  AuthProvider
//
//  ถือ session ที่กำลังใช้งานอยู่ และ workspace ที่เลือก
//
//  ⚠️ workspace ที่เลือกต้องเขียนลง tokenStore ด้วย ไม่ใช่เก็บแค่ใน state
//     เพราะ apiClient อ่านจากตรงนั้นเพื่อใส่ header X-Workspace-Id ให้ทุก
//     request — รวมถึง request ที่ยิงก่อน React จะ render เสร็จ
// ═══════════════════════════════════════════════════════════════════════════

interface AuthContextValue {
  user: User | null
  workspaces: WorkspaceSummary[]
  currentWorkspace: WorkspaceSummary | null
  isLoading: boolean

  login: (input: LoginInput) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => Promise<void>
  selectWorkspace: (workspaceId: string) => void
  refreshWorkspaces: () => Promise<void>
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const [user, setUser] = useState<User | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(
    () => tokenStore.getWorkspaceId(),
  )
  // ⚠️ คำนวณค่าเริ่มต้นตอน mount ไม่ใช่ตั้ง true แล้วค่อย setState(false) ใน
  //    effect — การเรียก setState แบบ synchronous ใน effect body ทำให้ render
  //    ซ้อนกันรอบหนึ่งโดยไม่จำเป็น (react-hooks/set-state-in-effect ฟ้อง)
  const [isLoading, setIsLoading] = useState(() => tokenStore.getAccessToken() !== null)

  const applySession = useCallback((session: AuthSession, withTokens: boolean) => {
    if (withTokens) tokenStore.save(session.accessToken, session.refreshToken)

    setUser(session.user)
    setWorkspaces(session.workspaces)

    // เลือก workspace อัตโนมัติเมื่อยังไม่เคยเลือก หรือเมื่อตัวที่เคยเลือก
    // หายไปแล้ว (ถูกถอดออกจาก workspace นั้น)
    const stored = tokenStore.getWorkspaceId()
    const stillMember = session.workspaces.some((w) => w.id === stored)
    const next = stillMember ? stored : (session.workspaces[0]?.id ?? null)

    tokenStore.setWorkspaceId(next)
    setCurrentWorkspaceId(next)
  }, [])

  // ─── กู้ session ตอนเปิดแอป ────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController()

    // ไม่มี token ก็ไม่มีอะไรให้กู้ — isLoading เป็น false มาตั้งแต่ต้นแล้ว
    if (!tokenStore.getAccessToken()) return

    authApi
      .fetchMe(controller.signal)
      // withTokens = false เพราะ /me ไม่ออก token ใหม่ ช่องพวกนั้นว่างอยู่
      .then((session) => applySession(session, false))
      .catch(() => {
        // ─────────────────────────────────────────────────────────────
        //  ⚠️ request ที่ถูก abort ไม่ใช่ auth ล้มเหลว
        //
        //  React StrictMode รัน effect สองรอบตอน dev: mount → cleanup
        //  (abort) → mount ใหม่ ถ้าถือว่า abort = token ใช้ไม่ได้ แล้ว
        //  clear() ทิ้ง ผู้ใช้จะถูกเด้งออกทุกครั้งที่เปิดแอป ทั้งที่
        //  /auth/me ตอบ 200 อยู่
        //
        //  ใน production ก็เกิดได้เมื่อผู้ใช้เปลี่ยนหน้าเร็ว ๆ ระหว่างโหลด
        //  — เทสในเบราว์เซอร์เท่านั้นที่จับเรื่องนี้ได้
        // ─────────────────────────────────────────────────────────────
        if (controller.signal.aborted) return

        // token หมดอายุหรือถูกยกเลิกจริง — interceptor พยายาม refresh ให้แล้ว
        tokenStore.clear()
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })

    return () => controller.abort()
  }, [applySession])

  const login = useCallback(async (input: LoginInput) => {
    applySession(await authApi.login(input), true)
  }, [applySession])

  const register = useCallback(async (input: RegisterInput) => {
    applySession(await authApi.register(input), true)
  }, [applySession])

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.getRefreshToken()

    // ถ้า API ล้ม ก็ยังต้องออกจากระบบฝั่ง client ให้ได้
    if (refreshToken) await authApi.logout(refreshToken).catch(() => undefined)

    tokenStore.clear()
    tokenStore.setWorkspaceId(null)
    setUser(null)
    setWorkspaces([])
    setCurrentWorkspaceId(null)

    // ⚠️ ล้าง cache ทั้งหมด ไม่งั้นคนที่ login ต่อจะเห็นข้อมูลของคนก่อนหน้า
    //    ค้างอยู่ชั่วครู่ก่อน refetch
    queryClient.clear()
  }, [queryClient])

  const selectWorkspace = useCallback((workspaceId: string) => {
    tokenStore.setWorkspaceId(workspaceId)
    setCurrentWorkspaceId(workspaceId)

    // ข้อมูลทุกอย่างผูกกับ workspace — เปลี่ยนแล้วต้องโหลดใหม่หมด
    queryClient.clear()
  }, [queryClient])

  const refreshWorkspaces = useCallback(async () => {
    applySession(await authApi.fetchMe(), false)
  }, [applySession])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    workspaces,
    currentWorkspace: workspaces.find((w) => w.id === currentWorkspaceId) ?? null,
    isLoading,
    login,
    register,
    logout,
    selectWorkspace,
    refreshWorkspaces,
  }), [user, workspaces, currentWorkspaceId, isLoading,
       login, register, logout, selectWorkspace, refreshWorkspaces])

  return <AuthContext value={value}>{children}</AuthContext>
}
