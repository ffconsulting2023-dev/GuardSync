import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

const EMPTY_FORM = { name: '', contactName: '', phone: '', email: '', address: '', notes: '' }

export default function ClientsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/clients', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clients'] }); setShowForm(false); setForm(EMPTY_FORM) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => api.put(`/clients/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clients'] }); setShowForm(false); setEditTarget(null); setForm(EMPTY_FORM) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/clients/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  })

  const openEdit = (c: any) => {
    setEditTarget(c)
    setForm({
      name: c.name,
      contactName: c.contactName || '',
      phone: c.phone || '',
      email: c.email || '',
      address: c.address || '',
      notes: c.notes || '',
    })
    setShowForm(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editTarget) updateMutation.mutate({ id: editTarget.id, data: form })
    else createMutation.mutate(form)
  }

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')
  const canDelete = hasRole(user, 'ADMIN')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">取引先管理</h1>
        {canEdit && (
          <button
            onClick={() => { setEditTarget(null); setForm(EMPTY_FORM); setShowForm(true) }}
            className="btn-primary text-sm"
          >+ 取引先登録</button>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
        <p className="font-medium">取引先（発注元）マスタ</p>
        <p className="text-xs mt-0.5">現場・契約・請求書から共通の取引先情報として参照されます。</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">取引先名</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">担当者</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">電話</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">メール</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">住所</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {clients.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-gray-400">取引先が登録されていません</td></tr>
              ) : (
                clients.map((c: any) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{c.contactName || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{c.phone || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs hidden lg:table-cell">{c.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs hidden lg:table-cell">{c.address || '—'}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {canEdit && <button onClick={() => openEdit(c)} className="text-blue-600 hover:text-blue-800 text-xs mr-3">編集</button>}
                      {canDelete && (
                        <button
                          onClick={() => { if (window.confirm(`${c.name}を削除しますか？`)) deleteMutation.mutate(c.id) }}
                          className="text-red-500 hover:text-red-700 text-xs"
                        >削除</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">{editTarget ? '取引先編集' : '取引先登録'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="form-label">取引先名 *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="form-input" required />
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
                  <label className="form-label">メールアドレス</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="form-input" />
                </div>
              </div>
              <div>
                <label className="form-label">住所</label>
                <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="form-input" />
              </div>
              <div>
                <label className="form-label">備考</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="form-input" rows={3} />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">キャンセル</button>
                <button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">
                  {editTarget ? '更新' : '登録'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
