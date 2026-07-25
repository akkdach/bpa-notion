import { type RouteObject } from 'react-router-dom'
import { HealthPage } from '@/page/HealthPage'

// ═══════════════════════════════════════════════════════════════════════════
//  Phase 0 — มีหน้าเดียวไว้พิสูจน์ว่า web → nginx → api → postgres ต่อกันครบ
//  Phase 1 จะเพิ่ม /login, /register และ layout /w/:workspaceSlug/*
// ═══════════════════════════════════════════════════════════════════════════
export const routes: RouteObject[] = [
  { path: '/', element: <HealthPage /> },
  { path: '*', element: <HealthPage /> },
]
