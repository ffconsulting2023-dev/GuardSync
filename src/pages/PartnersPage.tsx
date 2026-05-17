import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

const TYPE_LABELS: Record<string, { label: string; className: string; desc: string }> = {
  GROUP:     { label: 'グループ会社', className: 'badge-success', desc: '最優先で人員融通' },
  PREFERRED: { label: '優先協力会社', className: 'badge-info', desc: '次優先で人員融通' },
  GENERAL:   { label: '一般協力会社', className: 'badge-gray', desc: '通常の協力会社' },
}

const EMPTY_FORM = { name: '', type: 'GENERAL', contactName: '', phone: '', email: '', priority: '0' }

export default function PartnersPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  const { data: partners = [], isLoading } = useQuery({
    queryKey: ['partners'],
    queryFn: () => api.get('/partners').then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/partners', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['partners'] }); setShowForm(false); setForm(EMPTY_FORM) },
  })

  const canEdit = hasRole(user, 'ADMIN')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">協力会社管理</h1>
        {canEdit && <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ 会社登録</button>}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
        <p className="font-medium">優先人員融通フロー</p>
        <p className="text-xs mt-0.5">グループ会社 → 優先協力会社 → 一般協力会社 の順で自動エスカレーション</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {['GROUP', 'PREFERRED', 'GENERAL'].map(type => {
            const typePartners = partners.filter((p: any) => p.type === type)
            const { label, className, desc } = TYPE_LABELS[type]
            return (
              <div key={type} className="card space-y-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`badge ${className}`}>{label}</span>
                    <span className="text-xs text-gray-400">{typePartners.length}社</span>
                  </div>
                  <p className="text-xs text-gray-400">{desc}</p>
                </div>
                {typePartners.length === 0 ? (
                  <p className="text-xs text-gray-300">登録なし</p>
                ) : (
                  typePartners.map((p: any) => (
                    <div key={p.id} className="bg-gray-50 rounded-lg p-3">
                      <p className="font-medium text-gray-800 text-sm">{p.name}</p>
                      {p.contactName && <p className="text-xs text-gray-500">担当: {p.contactName}</p>}
                      {p.phone && <p className="text-xs text-gray-500">📞 {p.phone}</p>}
                      {p.email && <p className="text-xs text-gray-500">✉️ {p.email}</p>}
                      <p className="text-xs text-gray-400 mt-1">優先度: {p.priority}</p>
                    </div>
                  ))
                )}
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">協力会社登録</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={e => { e.preventDefault(); createMutation.mutate({ ...form, priority: Number(form.priority) }) }} className="p-6 space-y-4">
              <div>
                <label className="form-label">会社名 *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="form-input" required />
              </div>
              <div>
                <label className="form-label">種別</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="form-input">
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">担当者名</label>
                <input type="text" value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} className="form-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">電話番号</label>
                  <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="form-input" />
                </div>
                <div>
                  <label className="form-label">優先度（数値）</label>
                  <input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="form-input" min="0" />
                </div>
              </div>
              <div>
                <label className="form-label">メールアドレス</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="form-input" />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">キャンセル</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">登録</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
