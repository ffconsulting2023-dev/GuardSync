import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

const EMPTY_FORM = { plateNumber: '', model: '', year: '' }

export default function VehiclesPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => api.get('/vehicles').then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/vehicles', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicles'] }); setShowForm(false); setForm(EMPTY_FORM) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => api.put(`/vehicles/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicles'] }); setShowForm(false); setEditTarget(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/vehicles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicles'] }),
  })

  const openEdit = (v: any) => {
    setEditTarget(v)
    setForm({ plateNumber: v.plateNumber, model: v.model || '', year: v.year?.toString() || '' })
    setShowForm(true)
  }

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">車両管理</h1>
        {canEdit && (
          <button onClick={() => { setEditTarget(null); setForm(EMPTY_FORM); setShowForm(true) }} className="btn-primary text-sm">+ 車両登録</button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {vehicles.length === 0 ? (
            <div className="col-span-3 card text-center py-12 text-gray-400">車両が登録されていません</div>
          ) : (
            vehicles.map((v: any) => (
              <div key={v.id} className="card space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-2xl">🚗</p>
                    <p className="font-bold text-gray-800 text-lg">{v.plateNumber}</p>
                  </div>
                  <span className={`badge ${v.isActive ? 'badge-success' : 'badge-gray'}`}>{v.isActive ? '稼働中' : '停止中'}</span>
                </div>
                {v.model && <p className="text-sm text-gray-600">車種: {v.model}</p>}
                {v.year && <p className="text-sm text-gray-600">年式: {v.year}年</p>}
                {canEdit && (
                  <div className="flex gap-2 pt-2 border-t border-gray-100">
                    <button onClick={() => openEdit(v)} className="text-blue-600 hover:text-blue-800 text-xs">編集</button>
                    <button
                      onClick={() => { if (window.confirm(`${v.plateNumber}を削除しますか？`)) deleteMutation.mutate(v.id) }}
                      className="text-red-500 hover:text-red-700 text-xs ml-2"
                    >削除</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">{editTarget ? '車両編集' : '車両登録'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={e => {
              e.preventDefault()
              const data = { ...form, year: form.year ? Number(form.year) : undefined }
              if (editTarget) updateMutation.mutate({ id: editTarget.id, data })
              else createMutation.mutate(data)
            }} className="p-6 space-y-4">
              <div>
                <label className="form-label">ナンバープレート *</label>
                <input type="text" value={form.plateNumber} onChange={e => setForm(f => ({ ...f, plateNumber: e.target.value }))} className="form-input" required placeholder="品川 501 あ 1234" />
              </div>
              <div>
                <label className="form-label">車種・型式</label>
                <input type="text" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className="form-input" placeholder="トヨタ プリウス" />
              </div>
              <div>
                <label className="form-label">年式</label>
                <input type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} className="form-input" min="1990" max={new Date().getFullYear()} />
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
