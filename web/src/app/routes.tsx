import { Navigate, type RouteObject } from 'react-router-dom'
import { RequireAuth } from '@/app/RequireAuth'
import { LoginPage } from '@/page/LoginPage'
import { WorkspacePage } from '@/page/WorkspacePage'
import { HealthPage } from '@/page/HealthPage'

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },

  { path: '/', element: <RequireAuth><WorkspacePage /></RequireAuth> },
  { path: '/p/:pageId', element: <RequireAuth><WorkspacePage /></RequireAuth> },

  // หน้าตรวจสุขภาพระบบจาก Phase 0 — ยังมีประโยชน์ตอน deploy
  { path: '/health', element: <HealthPage /> },

  { path: '*', element: <Navigate to="/" replace /> },
]
