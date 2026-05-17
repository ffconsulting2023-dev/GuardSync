import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

export default function SettingsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'lineworks' | 'company' | 'users'>('lineworks')

  const { data: lwSettings } = useQuery({
    queryKey: ['lw-settings'],
    queryFn: () => api.get('/settings/line-works').then(r => r.data).catch(() => null),
  })

  const [lwForm, setLwForm] = useState({ botId: '', channelId: '' })
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteResult, setInviteResult] = useState<any>(null)

  React.useEffect(() => {
    if (lwSettings) setLwForm({ botId: lwSettings.botId || '', channelId: lwSettings.channelId || '' })
  }, [lwSettings])

  const saveLwMutation = useMutation({
    mutationFn: (data: any) => api.post('/settings/line-works', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lw-settings'] }),
  })

  const inviteMutation = useMutation({
    mutationFn: (email: string) => api.post('/auth/invite', { email }),
    onSuccess: (res) => { setInviteResult(res.data); setInviteEmail('') },
  })

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/settings/users').then(r => r.data),
    enabled: tab === 'users',
  })

  const canAdmin = hasRole(user, 'ADMIN')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-800">設定</h1>

      {/* タブ */}
      <div className="flex border-b border-gray-200">
        {[
          { key: 'lineworks', label: 'LINE Works' },
          { key: 'company', label: '会社情報' },
          { key: 'users', label: 'ユーザー管理' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? 'border-[#1e3a5f] text-[#1e3a5f]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* LINE Works設定 */}
      {tab === 'lineworks' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
            <p className="font-medium mb-1">LINE Works Bot API v2 設定</p>
            <p className="text-xs">LINE Worksテナントでボットを作成し、Bot IDとChannel IDを入力してください。</p>
            <p className="text-xs mt-1">認証情報（Client ID / Secret）はサーバーの環境変数に設定します。</p>
          </div>

          {lwSettings ? (
            <div className="card space-y-1 text-sm">
              <p className="text-xs text-gray-500">接続状態</p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <p className="text-green-700 font-medium">設定済み</p>
              </div>
              <p className="text-gray-500 text-xs">Bot ID: {lwSettings.botId}</p>
            </div>
          ) : (
            <div className="card space-y-1 text-sm">
              <p className="text-xs text-gray-500">接続状態</p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
                <p className="text-gray-400">未設定</p>
              </div>
            </div>
          )}

          {canAdmin && (
            <div className="card space-y-4">
              <h3 className="font-semibold text-gray-800">LINE Works 接続設定</h3>
              <div>
                <label className="form-label">Bot ID</label>
                <input type="text" value={lwForm.botId} onChange={e => setLwForm(f => ({ ...f, botId: e.target.value }))} className="form-input" placeholder="例: 12345678" />
              </div>
              <div>
                <label className="form-label">Channel ID（送信先チャンネル）</label>
                <input type="text" value={lwForm.channelId} onChange={e => setLwForm(f => ({ ...f, channelId: e.target.value }))} className="form-input" placeholder="例: 98765432" />
              </div>
              <p className="text-xs text-gray-400">
                Client ID / Client Secretは管理者に環境変数（LINE_WORKS_CLIENT_ID / LINE_WORKS_CLIENT_SECRET）で設定してもらってください。
              </p>
              <button
                onClick={() => saveLwMutation.mutate(lwForm)}
                disabled={!lwForm.botId || !lwForm.channelId || saveLwMutation.isPending}
                className="btn-primary disabled:opacity-50"
              >
                {saveLwMutation.isPending ? '保存中...' : '保存'}
              </button>
              {saveLwMutation.isSuccess && <p className="text-green-600 text-sm">✅ 保存しました</p>}
            </div>
          )}
        </div>
      )}

      {/* 会社情報 */}
      {tab === 'company' && (
        <div className="card space-y-3">
          <h3 className="font-semibold text-gray-800">会社情報</h3>
          <div>
            <p className="text-xs text-gray-500">会社名</p>
            <p className="font-medium text-gray-800">{user?.company?.name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">プラン</p>
            <span className={`badge ${user?.company?.plan === 'MAX' ? 'badge-success' : 'badge-info'}`}>{user?.company?.plan}</span>
          </div>
          <p className="text-xs text-gray-400">会社名・プランの変更はサポートまでお問い合わせください。</p>
        </div>
      )}

      {/* ユーザー管理 */}
      {tab === 'users' && (
        <div className="space-y-4">
          {/* 招待 */}
          {canAdmin && (
            <div className="card space-y-3">
              <h3 className="font-semibold text-gray-800">ユーザー招待</h3>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="招待するメールアドレス"
                  className="form-input flex-1"
                />
                <button
                  onClick={() => inviteMutation.mutate(inviteEmail)}
                  disabled={!inviteEmail || inviteMutation.isPending}
                  className="btn-primary disabled:opacity-50 whitespace-nowrap"
                >
                  招待
                </button>
              </div>
              {inviteResult && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                  <p className="text-green-800 font-medium">招待リンク生成完了</p>
                  <p className="text-green-600 mt-1 break-all text-xs">{window.location.origin}/register?token={inviteResult.token}</p>
                  <p className="text-xs text-green-500 mt-1">7日間有効</p>
                </div>
              )}
            </div>
          )}

          {/* ユーザー一覧 */}
          <div className="card overflow-x-auto p-0">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">ユーザー一覧</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">名前</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">メール</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">役割</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">最終ログイン</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map((u: any) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{u.name}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{u.email}</td>
                    <td className="px-4 py-3"><span className="badge badge-info">{u.role}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden md:table-cell">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('ja-JP') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
