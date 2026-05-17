import React, { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { format } from 'date-fns'

export default function SuperAdminPage() {
  const { user } = useAuth()
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteResult, setInviteResult] = useState<any>(null)

  if (!user?.isSuperAdmin) {
    return <div className="p-8 text-center text-red-600 font-medium">アクセス権限がありません</div>
  }

  const { data: stats } = useQuery({
    queryKey: ['super-admin-stats'],
    queryFn: () => api.get('/super-admin/stats').then(r => r.data),
    refetchInterval: 30000,
  })

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['super-admin-companies'],
    queryFn: () => api.get('/super-admin/companies').then(r => r.data),
  })

  const inviteMutation = useMutation({
    mutationFn: (email: string) => api.post('/super-admin/invite', { email }),
    onSuccess: (res) => { setInviteResult(res.data); setInviteEmail('') },
  })

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-xl">🔒</span>
        <h1 className="text-xl font-bold text-gray-800">スーパー管理者ダッシュボード</h1>
      </div>

      {/* 統計 */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: '会社数', value: stats.companies, icon: '🏢' },
            { label: 'ユーザー数', value: stats.users, icon: '👤' },
            { label: '隊員総数', value: stats.guards, icon: '👷' },
            { label: 'シフト総数', value: stats.schedules, icon: '📋' },
          ].map(({ label, value, icon }) => (
            <div key={label} className="card text-center py-3">
              <p className="text-3xl mb-1">{icon}</p>
              <p className="text-2xl font-bold text-gray-800">{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* 会社招待 */}
      <div className="card">
        <h2 className="font-semibold text-gray-800 mb-3">新規会社招待</h2>
        <div className="flex gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="会社管理者のメールアドレス"
            className="form-input flex-1"
          />
          <button
            onClick={() => inviteMutation.mutate(inviteEmail)}
            disabled={!inviteEmail || inviteMutation.isPending}
            className="btn-primary disabled:opacity-50 whitespace-nowrap"
          >
            招待送信
          </button>
        </div>
        {inviteResult && (
          <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
            <p className="text-green-800 font-medium">招待リンク生成完了</p>
            <p className="text-green-600 mt-1 break-all">{window.location.origin}{inviteResult.registrationUrl}</p>
            <p className="text-xs text-green-500 mt-1">このURLを新規会社の担当者に送付してください（7日間有効）</p>
          </div>
        )}
      </div>

      {/* 会社一覧 */}
      <div className="card overflow-x-auto p-0">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">登録会社一覧</h2>
        </div>
        {isLoading ? (
          <div className="text-center py-8 text-gray-400">読み込み中...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">会社名</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">コード</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">プラン</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">ユーザー</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">隊員</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">シフト</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">登録日</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">状態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {companies.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{c.code}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`badge ${c.plan === 'MAX' ? 'badge-success' : 'badge-info'}`}>{c.plan}</span>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600 hidden md:table-cell">{c._count.users}</td>
                  <td className="px-4 py-3 text-center text-gray-600 hidden md:table-cell">{c._count.guards}</td>
                  <td className="px-4 py-3 text-center text-gray-600 hidden lg:table-cell">{c._count.schedules}</td>
                  <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">{format(new Date(c.createdAt), 'yyyy/M/d')}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`badge ${c.isActive ? 'badge-success' : 'badge-danger'}`}>{c.isActive ? '有効' : '停止'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
