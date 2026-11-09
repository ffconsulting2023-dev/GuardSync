import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PASSWORD_PATTERN, PASSWORD_RULE_TEXT } from '../../shared/account'

const API_URL = import.meta.env.VITE_API_URL || ''

// 管理者が発行した設定用URL（メール・URL・QRコード）から本人がパスワードを設定する画面（ログイン不要）
export default function SetupPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [info, setInfo] = useState<{ name: string; loginId: string; companyName: string; expiresAt: string } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) { setLoadError('URLが正しくありません。管理者から届いたURLをそのまま開いてください。'); return }
    fetch(`${API_URL}/api/auth/setup/${encodeURIComponent(token)}`)
      .then(async r => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error || 'URLを確認できませんでした')
        setInfo(body)
      })
      .catch(e => setLoadError(e.message))
  }, [token])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!PASSWORD_PATTERN.test(password)) { setError(`パスワードは${PASSWORD_RULE_TEXT}`); return }
    if (password !== confirm) { setError('パスワードが一致しません'); return }
    setSubmitting(true)
    try {
      const r = await fetch(`${API_URL}/api/auth/setup/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, passwordConfirm: confirm }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || '設定に失敗しました')
      setDone(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const checks = [
    { ok: password.length >= 8, label: '8文字以上' },
    { ok: /[A-Z]/.test(password), label: '英大文字' },
    { ok: /[a-z]/.test(password), label: '英小文字' },
    { ok: /\d/.test(password), label: '数字' },
  ]

  return (
    <div className="min-h-screen bg-[#1e3a5f] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-[#e67e22] rounded-2xl mb-3">
            <span className="text-white text-xl font-bold">GS</span>
          </div>
          <h1 className="text-white text-xl font-bold">パスワードの設定</h1>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-xl">
          {loadError ? (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{loadError}</p>
          ) : !info ? (
            <p className="text-center text-gray-400 py-6">確認中...</p>
          ) : done ? (
            <div className="space-y-4 text-center">
              <p className="text-green-700 font-medium">パスワードを設定しました</p>
              <p className="text-sm text-gray-600">ログインID <span className="font-mono font-semibold">{info.loginId}</span> と、設定したパスワードでログインしてください。</p>
              <Link to="/login" className="btn-primary inline-block w-full py-3">ログイン画面へ</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p className="text-gray-500 text-xs">{info.companyName}</p>
                <p className="font-medium text-gray-800">{info.name} 様</p>
                <p className="text-gray-600">ログインID: <span className="font-mono font-semibold">{info.loginId}</span></p>
              </div>
              {/* パスワード管理ツールがログインIDと組で保存できるようにする */}
              <input type="text" name="username" value={info.loginId} autoComplete="username" readOnly hidden />
              <div>
                <label className="form-label">新しいパスワード</label>
                <input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} className="form-input" autoComplete="new-password" required />
                <div className="flex flex-wrap gap-2 mt-2">
                  {checks.map(c => (
                    <span key={c.label} className={`text-xs px-2 py-0.5 rounded-full ${c.ok ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{c.ok ? '✓' : '・'} {c.label}</span>
                  ))}
                </div>
              </div>
              <div>
                <label className="form-label">新しいパスワード（確認）</label>
                <input type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} className="form-input" autoComplete="new-password" required />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />パスワードを表示
              </label>
              {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <button type="submit" disabled={submitting} className="w-full btn-primary py-3 disabled:opacity-50">{submitting ? '設定中...' : 'パスワードを設定する'}</button>
              <p className="text-xs text-gray-400 text-center">このURLの有効期限: {new Date(info.expiresAt).toLocaleString('ja-JP')}</p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
