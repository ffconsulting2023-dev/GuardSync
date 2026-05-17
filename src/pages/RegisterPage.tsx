import React, { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { saveToken } from '../lib/auth'

export default function RegisterPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== passwordConfirm) { setError('パスワードが一致しません'); return }
    if (password.length < 8) { setError('パスワードは8文字以上にしてください'); return }
    setError('')
    setLoading(true)
    try {
      const res = await api.post('/auth/register', { token, name, password })
      saveToken(res.data.token)
      navigate('/', { replace: true })
    } catch (err: any) {
      setError(err.response?.data?.error || '登録に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1e3a5f]">
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-red-600 font-medium">招待リンクが無効です</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#1e3a5f] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[#e67e22] rounded-2xl mb-4">
            <span className="text-white text-2xl font-bold">GS</span>
          </div>
          <h1 className="text-white text-2xl font-bold">GuardSync</h1>
          <p className="text-white/60 text-sm mt-1">アカウント登録</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-xl">
          <h2 className="text-lg font-semibold text-gray-800 mb-6">アカウントを作成</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="form-label">お名前</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="form-input" placeholder="山田 太郎" required />
            </div>
            <div>
              <label className="form-label">パスワード（8文字以上）</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="form-input" required />
            </div>
            <div>
              <label className="form-label">パスワード（確認）</label>
              <input type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} className="form-input" required />
            </div>
            {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}
            <button type="submit" disabled={loading} className="w-full btn-primary py-3 text-base disabled:opacity-50">
              {loading ? '登録中...' : '登録する'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
