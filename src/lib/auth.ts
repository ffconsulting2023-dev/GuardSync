import { api } from './api'

export interface AuthUser {
  id: string
  name: string
  email: string | null
  loginId?: string | null
  role: string
  isSuperAdmin?: boolean
  canIssueAccounts?: boolean
  guardId?: string | null
  company: { id: string; name: string; plan: string }
}

// id はログインID またはメールアドレス
export async function login(id: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const res = await api.post('/auth/login', { id, password })
  return res.data
}

export async function getMe(): Promise<AuthUser> {
  const res = await api.get('/auth/me')
  return res.data
}

export function saveToken(token: string) {
  localStorage.setItem('token', token)
}

export function clearToken() {
  localStorage.removeItem('token')
}

export function getToken(): string | null {
  return localStorage.getItem('token')
}

export function hasRole(user: AuthUser | null, ...roles: string[]): boolean {
  if (!user) return false
  if (user.isSuperAdmin) return true
  return roles.includes(user.role)
}

// ID発行（アカウント管理）ができるか。ADMIN は常に可、それ以外は会社ごとに付与された権限
export function canIssueAccounts(user: AuthUser | null): boolean {
  if (!user) return false
  return !!user.isSuperAdmin || user.role === 'ADMIN' || !!user.canIssueAccounts
}
