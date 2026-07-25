import type { WorkspaceSummary } from '@/features/workspace'

export type { WorkspaceSummary }

export interface User {
  id: string
  email: string
  name: string
  avatarUrl?: string
  locale: string
}


export interface AuthSession {
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
  refreshTokenExpiresAt: string
  user: User
  workspaces: WorkspaceSummary[]
}

export interface LoginInput {
  email: string
  password: string
}

export interface RegisterInput extends LoginInput {
  name: string
}
