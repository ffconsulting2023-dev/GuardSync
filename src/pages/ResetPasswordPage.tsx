import React, { useState } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import axios from 'axios'

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  if (!token) {
    return (
      <div className="min-h-screen bg-[#1e3a5f] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-6 shadow-xl w-full max-w-sm text-center space-y-4">
          <p className="text-red-600 font-medium">無効なURLです。</p>
          <Link to="/forgot-password" className="text-sm text-blue-600 hover:underline">
            パスワードリセットを再申請する
          </Link>
        </div>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== passwordConfirm) { setError('パスワードが一致しません'); return }
    setLoading(true)
    try {
      await axios.post('/api/auth/reset-password', { token, password, passwordConfirm })
      setDone(true)
      setTimeout(() => navigate('/login', { replace: true }), 3000)
    } catch (err: any) {
      setError(err.response?.data?.error || 'エラーが発生しました。再度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  const EyeIcon = ({ visible }: { visible: boolean }) => visible ? (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )

  return (
    <div className="min-h-screen bg-[#1e3a5f] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[#e67e22] rounded-2xl mb-4">
            <span className="text-white text-2xl font-bold">GS</span>
          </div>
          <h1 className="text-white text-2xl font-bold">GuardSync</h1>
          <p className="text-white/60 text-sm mt-1">警備会社向け統合管理システム</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-xl">
          {done ? (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-green-100 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-800">パスワードを更新しました</h2>
              <p className="text-sm text-gray-500">
                新しいパスワードでログインしてください。<br />
                <span className="text-xs text-gray-400">（3秒後にログイン画面へ移動します）</span>
              </p>
              <Link to="/login" className="inline-block text-sm text-blue-600 hover:underline">
                今すぐログイン画面へ
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-800 mb-2">新しいパスワードの設定</h2>
              <p className="text-sm text-gray-500 mb-5">
                8文字以上で、大文字・小文字・数字を含めてください。
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="form-label">新しいパスワード</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="form-input pr-10"
                      placeholder="••••••••"
                      required
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
                      tabIndex={-1}
                      aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                    >
                      <EyeIcon visible={showPassword} />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="form-label">パスワード（確認）</label>
                  <div className="relative">
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      className="form-input pr-10"
                      placeholder="••••••••"
                      required
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
                      tabIndex={-1}
                      aria-label={showConfirm ? 'パスワードを隠す' : 'パスワードを表示'}
                    >
                      <EyeIcon visible={showConfirm} />
                    </button>
                  </div>
                </div>
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full btn-primary py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? '更新中...' : 'パスワードを更新する'}
                </button>
              </form>
              <div className="mt-4 text-center">
                <Link to="/login" className="text-sm text-gray-500 hover:text-gray-700 hover:underline">
                  ログイン画面に戻る
                </Link>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-white/40 text-xs mt-6">
          © 2026 GuardSync. All rights reserved.
        </p>
      </div>
    </div>
  )
}
