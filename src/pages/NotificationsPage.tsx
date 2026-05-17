import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { format } from 'date-fns'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

const TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  SCHEDULE_REMINDER: { label: 'シフト確認', icon: '📅', color: 'badge-blue' },
  DAILY_PAY_PROCESSED: { label: '日払い処理', icon: '💴', color: 'badge-success' },
  INVOICE_SENT: { label: '請求書送付', icon: '📄', color: 'badge-warning' },
  GENERAL: { label: 'お知らせ', icon: '🔔', color: 'badge-gray' },
}

export default function NotificationsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', message: '', type: 'GENERAL', targetRole: '' })

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => r.data),
    refetchInterval: 30000,
  })

  const sendMutation = useMutation({
    mutationFn: (data: any) => api.post('/notifications/send', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      setShowForm(false)
      setForm({ title: '', message: '', type: 'GENERAL', targetRole: '' })
    },
  })

  const canSend = hasRole(user, 'ADMIN', 'MANAGER')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">通知管理</h1>
        {canSend && (
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ 通知送信</button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : notifications.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-3xl mb-3">🔔</p>
          <p className="text-gray-400">通知はありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((n: any) => {
            const t = TYPE_LABELS[n.type] || { label: n.type, icon: '🔔', color: 'badge-gray' }
            return (
              <div key={n.id} className="card">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{t.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`badge ${t.color}`}>{t.label}</span>
                      <span className="text-xs text-gray-400">{format(new Date(n.createdAt), 'M/d HH:mm')}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-800">{n.title}</p>
                    <p className="text-sm text-gray-600 mt-0.5">{n.message}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">通知送信</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={e => { e.preventDefault(); sendMutation.mutate(form) }} className="p-6 space-y-4">
              <div>
                <label className="form-label">種別</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="form-input">
                  {Object.entries(TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v.icon} {v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">対象ロール（空欄=全員）</label>
                <select value={form.targetRole} onChange={e => setForm(f => ({ ...f, targetRole: e.target.value }))} className="form-input">
                  <option value="">全員</option>
                  <option value="ADMIN">管理者</option>
                  <option value="MANAGER">マネージャー</option>
                  <option value="OPERATOR">オペレーター</option>
                  <option value="VIEWER">閲覧者</option>
                </select>
              </div>
              <div>
                <label className="form-label">タイトル *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="form-input"
                  required
                  placeholder="通知タイトル"
                />
              </div>
              <div>
                <label className="form-label">本文 *</label>
                <textarea
                  value={form.message}
                  onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  className="form-input"
                  rows={4}
                  required
                  placeholder="通知内容を入力してください"
                />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">キャンセル</button>
                <button type="submit" disabled={sendMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">
                  {sendMutation.isPending ? '送信中...' : '送信'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
