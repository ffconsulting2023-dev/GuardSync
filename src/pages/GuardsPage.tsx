import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME: '正社員', PART_TIME: 'アルバイト', CONTRACT: '契約社員', DISPATCH: '派遣',
}

const GENDER_LABELS: Record<string, string> = { MALE: '男性', FEMALE: '女性', OTHER: 'その他' }

interface GuardFormData {
  employeeNumber: string
  name: string
  nameKana: string
  birthDate: string
  gender: string
  phone: string
  email: string
  address: string
  employmentType: string
  certifications: string
  dailyPayEnabled: boolean
}

const EMPTY_FORM: GuardFormData = {
  employeeNumber: '', name: '', nameKana: '', birthDate: '', gender: 'MALE',
  phone: '', email: '', address: '', employmentType: 'PART_TIME', certifications: '', dailyPayEnabled: false,
}

export default function GuardsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [form, setForm] = useState<GuardFormData>(EMPTY_FORM)

  const { data: guards = [], isLoading } = useQuery({
    queryKey: ['guards', search],
    queryFn: () => api.get(`/guards?isActive=true${search ? `&search=${encodeURIComponent(search)}` : ''}`).then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/guards', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['guards'] }); setShowForm(false); setForm(EMPTY_FORM) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/guards/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['guards'] }); setShowForm(false); setEditTarget(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/guards/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guards'] }),
  })

  const openEdit = (guard: any) => {
    setEditTarget(guard)
    setForm({
      employeeNumber: guard.employeeNumber, name: guard.name, nameKana: guard.nameKana,
      birthDate: guard.birthDate ? guard.birthDate.split('T')[0] : '', gender: guard.gender || 'MALE',
      phone: guard.phone || '', email: guard.email || '', address: guard.address || '',
      employmentType: guard.employmentType, certifications: (guard.certifications || []).join(', '),
      dailyPayEnabled: guard.dailyPayEnabled,
    })
    setShowForm(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data = {
      ...form,
      certifications: form.certifications ? form.certifications.split(',').map(s => s.trim()).filter(Boolean) : [],
    }
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">隊員管理</h1>
        <div className="flex gap-2">
          <a href={`${import.meta.env.VITE_API_URL || ''}/api/export/guards`} download className="btn-secondary text-sm">⬇ CSV</a>
          {canEdit && (
            <button onClick={() => { setEditTarget(null); setForm(EMPTY_FORM); setShowForm(true) }} className="btn-primary text-sm">
              + 隊員登録
            </button>
          )}
        </div>
      </div>

      {/* 検索 */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="form-input"
        placeholder="名前・読み・社員番号で検索..."
      />

      {/* テーブル */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">社員番号</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">名前</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">雇用形態</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">電話番号</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">日払い</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {guards.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-gray-400">隊員が登録されていません</td></tr>
              ) : (
                guards.map((g: any) => (
                  <tr key={g.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{g.employeeNumber}</td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-800">{g.name}</p>
                        <p className="text-xs text-gray-400">{g.nameKana}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="badge badge-info">{EMPLOYMENT_LABELS[g.employmentType]}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{g.phone || '—'}</td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {g.dailyPayEnabled ? <span className="badge badge-success">対象</span> : <span className="badge badge-gray">対象外</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canEdit && (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => openEdit(g)} className="text-blue-600 hover:text-blue-800 text-xs">編集</button>
                          <button onClick={() => { if (window.confirm(`${g.name}を無効化しますか？`)) deleteMutation.mutate(g.id) }} className="text-red-500 hover:text-red-700 text-xs">削除</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* フォームモーダル */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">{editTarget ? '隊員編集' : '隊員登録'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">社員番号 *</label>
                  <input type="text" value={form.employeeNumber} onChange={e => setForm(f => ({ ...f, employeeNumber: e.target.value }))} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">雇用形態</label>
                  <select value={form.employmentType} onChange={e => setForm(f => ({ ...f, employmentType: e.target.value }))} className="form-input">
                    {Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">氏名 *</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">フリガナ *</label>
                  <input type="text" value={form.nameKana} onChange={e => setForm(f => ({ ...f, nameKana: e.target.value }))} className="form-input" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">生年月日</label>
                  <input type="date" value={form.birthDate} onChange={e => setForm(f => ({ ...f, birthDate: e.target.value }))} className="form-input" />
                </div>
                <div>
                  <label className="form-label">性別</label>
                  <select value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))} className="form-input">
                    {Object.entries(GENDER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="form-label">電話番号</label>
                <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="form-input" />
              </div>
              <div>
                <label className="form-label">メールアドレス</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="form-input" />
              </div>
              <div>
                <label className="form-label">住所</label>
                <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="form-input" />
              </div>
              <div>
                <label className="form-label">保有資格（カンマ区切り）</label>
                <input type="text" value={form.certifications} onChange={e => setForm(f => ({ ...f, certifications: e.target.value }))} className="form-input" placeholder="施設警備2級, 雑踏警備2級" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="dailyPay" checked={form.dailyPayEnabled} onChange={e => setForm(f => ({ ...f, dailyPayEnabled: e.target.checked }))} className="w-4 h-4" />
                <label htmlFor="dailyPay" className="text-sm text-gray-700">日払い対象にする</label>
              </div>
              <div className="flex gap-3 pt-2">
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
