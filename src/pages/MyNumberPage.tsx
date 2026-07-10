import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'

interface Guard {
  id: string
  name: string
  employeeNumber: string
  myNumber?: string | null
  myNumberUpdatedAt?: string | null
}

interface AuditLog {
  id: string
  guardId: string
  userId: string
  userName: string
  action: string
  ipAddress: string | null
  createdAt: string
}

export default function MyNumberPage() {
  const { user } = useAuth()
  const [guards, setGuards] = useState<Guard[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [activeTab, setActiveTab] = useState<'list' | 'audit'>('list')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // モーダル制御
  const [modalGuard, setModalGuard] = useState<Guard | null>(null)
  const [modalType, setModalType] = useState<'register' | 'view' | null>(null)
  const [inputMyNumber, setInputMyNumber] = useState('')
  const [viewedMyNumber, setViewedMyNumber] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isSuperAdmin = user?.isSuperAdmin || false
  const isAdmin = user?.role === 'ADMIN' || isSuperAdmin

  const fetchGuards = useCallback(async () => {
    try {
      const res = await api.get('/guards')
      setGuards(res.data)
    } catch {
      setError('隊員一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAuditLogs = useCallback(async () => {
    if (!isSuperAdmin) return
    try {
      const res = await api.get('/my-number/audit-log')
      setAuditLogs(res.data)
    } catch {
      setError('監査ログの取得に失敗しました')
    }
  }, [isSuperAdmin])

  useEffect(() => {
    fetchGuards()
  }, [fetchGuards])

  useEffect(() => {
    if (activeTab === 'audit') fetchAuditLogs()
  }, [activeTab, fetchAuditLogs])

  // マイナンバー登録
  const handleRegister = async () => {
    if (!modalGuard) return
    if (!/^\d{12}$/.test(inputMyNumber)) {
      setError('マイナンバーは12桁の数字で入力してください')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await api.post(`/guards/${modalGuard.id}/my-number`, { myNumber: inputMyNumber })
      setModalGuard(null)
      setModalType(null)
      setInputMyNumber('')
      fetchGuards()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || '登録に失敗しました'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // マイナンバー表示（マスク）
  const handleView = async (guard: Guard) => {
    setModalGuard(guard)
    setModalType('view')
    setViewedMyNumber(null)
    setError('')
    try {
      const res = await api.get(`/guards/${guard.id}/my-number`)
      setViewedMyNumber(res.data.myNumber || '未登録')
    } catch {
      setError('マイナンバーの取得に失敗しました')
    }
  }

  // マイナンバーフル表示（スーパー管理者のみ）
  const handleViewFull = async () => {
    if (!modalGuard) return
    try {
      const res = await api.get(`/guards/${modalGuard.id}/my-number/full`)
      setViewedMyNumber(res.data.myNumber || '未登録')
    } catch {
      setError('マイナンバーの取得に失敗しました')
    }
  }

  // マイナンバー削除
  const handleDelete = async (guard: Guard) => {
    if (!confirm(`${guard.name} のマイナンバーを削除しますか？この操作は取り消せません。`)) return
    try {
      await api.delete(`/guards/${guard.id}/my-number`)
      fetchGuards()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const closeModal = () => {
    setModalGuard(null)
    setModalType(null)
    setInputMyNumber('')
    setViewedMyNumber(null)
    setError('')
  }

  const actionLabel = (action: string) => {
    switch (action) {
      case 'VIEW': return '閲覧'
      case 'UPDATE': return '更新'
      case 'DELETE': return '削除'
      default: return action
    }
  }

  const actionColor = (action: string) => {
    switch (action) {
      case 'VIEW': return 'bg-blue-100 text-blue-800'
      case 'UPDATE': return 'bg-green-100 text-green-800'
      case 'DELETE': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          この機能は管理者のみ利用できます。
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* ヘッダー */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">マイナンバー管理</h1>
        <p className="text-sm text-gray-500 mt-1">隊員のマイナンバーを安全に管理します</p>
      </div>

      {/* セキュリティ注意書き */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
        <span className="text-amber-500 text-lg mt-0.5">&#9888;</span>
        <div>
          <p className="font-medium text-amber-800">セキュリティに関する注意</p>
          <p className="text-sm text-amber-700 mt-1">
            マイナンバーの閲覧・操作は全て監査ログに記録されます。
            不正なアクセスは法令違反となる場合があります。業務目的以外での閲覧・取得は禁止されています。
          </p>
        </div>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-red-500 hover:text-red-700">&#10005;</button>
        </div>
      )}

      {/* タブ */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('list')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'list' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          隊員一覧
        </button>
        {isSuperAdmin && (
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'audit' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            監査ログ
          </button>
        )}
      </div>

      {/* 隊員一覧タブ */}
      {activeTab === 'list' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-400">読み込み中...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">社員番号</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">氏名</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">マイナンバー登録状況</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">最終更新</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {guards.map((guard) => (
                    <tr key={guard.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">{guard.employeeNumber}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{guard.name}</td>
                      <td className="px-4 py-3">
                        {guard.myNumber ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            登録済
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            未登録
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {guard.myNumberUpdatedAt
                          ? new Date(guard.myNumberUpdatedAt).toLocaleString('ja-JP')
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          onClick={() => { setModalGuard(guard); setModalType('register'); setInputMyNumber(''); setError('') }}
                          className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                        >
                          {guard.myNumber ? '更新' : '登録'}
                        </button>
                        {guard.myNumber && (
                          <>
                            <button
                              onClick={() => handleView(guard)}
                              className="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                            >
                              表示
                            </button>
                            <button
                              onClick={() => handleDelete(guard)}
                              className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                            >
                              削除
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {guards.length === 0 && (
                <div className="p-8 text-center text-gray-400">隊員が登録されていません</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 監査ログタブ */}
      {activeTab === 'audit' && isSuperAdmin && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">日時</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">操作者</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">対象隊員ID</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">操作</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">IPアドレス</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700 text-xs">
                      {new Date(log.createdAt).toLocaleString('ja-JP')}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{log.userName}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{log.guardId.slice(0, 8)}...</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${actionColor(log.action)}`}>
                        {actionLabel(log.action)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{log.ipAddress || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {auditLogs.length === 0 && (
              <div className="p-8 text-center text-gray-400">監査ログはありません</div>
            )}
          </div>
        </div>
      )}

      {/* 登録モーダル */}
      {modalType === 'register' && modalGuard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 w-96 shadow-xl space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">
              マイナンバー{modalGuard.myNumber ? '更新' : '登録'}
            </h3>
            <p className="text-sm text-gray-600">
              {modalGuard.name}（{modalGuard.employeeNumber}）
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">マイナンバー（12桁）</label>
              <input
                type="password"
                maxLength={12}
                value={inputMyNumber}
                onChange={(e) => setInputMyNumber(e.target.value.replace(/\D/g, ''))}
                placeholder="123456789012"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg tracking-widest"
                autoComplete="off"
              />
              <p className="text-xs text-gray-400 mt-1">{inputMyNumber.length}/12桁</p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button onClick={closeModal} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                キャンセル
              </button>
              <button
                onClick={handleRegister}
                disabled={submitting || inputMyNumber.length !== 12}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? '処理中...' : '登録'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 表示モーダル */}
      {modalType === 'view' && modalGuard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 w-96 shadow-xl space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">マイナンバー確認</h3>
            <p className="text-sm text-gray-600">
              {modalGuard.name}（{modalGuard.employeeNumber}）
            </p>
            <div className="bg-gray-50 rounded-lg p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">マイナンバー</p>
              <p className="text-2xl font-mono tracking-widest text-gray-800">
                {viewedMyNumber || '読み込み中...'}
              </p>
            </div>
            {isSuperAdmin && viewedMyNumber && viewedMyNumber.includes('*') && (
              <button
                onClick={handleViewFull}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
              >
                全桁表示（スーパー管理者権限）
              </button>
            )}
            <p className="text-xs text-amber-600">
              &#9888; この閲覧は監査ログに記録されています
            </p>
            <button onClick={closeModal} className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
