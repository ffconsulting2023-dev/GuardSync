import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await axios.post('/api/auth/forgot-password', { email })
      setSent(true)
    } catch (err: any) {
      setError(err.response?.data?.error || '送信に失敗しました。しばらく後に再試行してください。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#1e3a5f] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* ロゴ */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[#e67e22] rounded-2xl mb-4">
            <span className="text-white text-2xl font-bold">GS</span>
          </div>
          <h1 className="text-white text-2xl font-bold">GuardSync</h1>
          <p className="text-white/60 text-sm mt-1">警備会社向け統合管理システム</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-xl">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-green-100 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-800">メールを送信しました</h2>
              <p className="text-sm text-gray-500">
                登録済みのメールアドレスにパスワードリセット用のURLを送信しました。<br />
                メールをご確認のうえ、記載のURLからパスワードを再設定してください。<br />
                <span className="text-xs text-gray-400">（有効期限：1時間）</span>
              </p>
              <Link to="/login" className="inline-block mt-2 text-sm text-blue-600 hover:underline">
                ログイン画面に戻る
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-800 mb-2">パスワードのリセット</h2>
              <p className="text-sm text-gray-500 mb-5">
                登録済みのメールアドレスを入力してください。パスワードリセット用のURLをお送りします。
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="form-label">メールアドレス</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="form-input"
                    placeholder="example@company.co.jp"
                    required
                    autoComplete="email"
                  />
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
                  {loading ? '送信中...' : 'リセット用メールを送信'}
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
