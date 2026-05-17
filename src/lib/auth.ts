import { api } from './api'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: string
  isSuperAdmin?: boolean
  company: { id: string; name: string; plan: string }
}

export async function login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const res = await api.post('/auth/login', { email, password })
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
