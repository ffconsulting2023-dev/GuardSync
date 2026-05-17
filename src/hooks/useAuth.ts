import { useState, useEffect, createContext, useContext } from 'react'
import { AuthUser, getMe, getToken, clearToken } from '../lib/auth'

interface AuthContext {
  user: AuthUser | null
  loading: boolean
  logout: () => void
  refresh: () => Promise<void>
}

import React from 'react'
export const AuthCtx = createContext<AuthContext>({ user: null, loading: true, logout: () => {}, refresh: async () => {} })

export function useAuth() {
  return useContext(AuthCtx)
}

export function useAuthProvider(): AuthContext {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    if (!getToken()) { setLoading(false); return }
    try {
      const me = await getMe()
      setUser(me)
    } catch {
      clearToken()
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const logout = () => {
    clearToken()
    setUser(null)
    window.location.href = '/login'
  }

  return { user, loading, logout, refresh }
}
