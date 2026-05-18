import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'
import { format } from 'date-fns'

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  DRAFT:     { label: '下書き',   className: 'badge-gray' },
  ACTIVE:    { label: '有効',     className: 'badge-success' },
  SUSPENDED: { label: '停止中',   className: 'badge-warning' },
  EXPIRED:   { label: '期限切れ', className: 'badge-danger' },
  CANCELLED: { label: 'キャンセル', className: 'badge-danger' },
}

const EMPTY_FORM = {
  siteId: '', clientId: '', contractNumber: '', clientName: '', startDate: '', endDate: '',
  unitPrice: '', guardCount: '1', notes: '',
}

export default function ContractsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => api.get('/contracts').then(r => r.data),
  })

  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: () => api.get('/sites').then(r => r.data) })
  const { data: clients = [] } = useQuery({ queryKey: ['clients'], queryFn: () => api.get('/clients').then(r => r.data) })

  const handleSiteChange = (siteId: string) => {
    const s = sites.find((x: any) => x.id === siteId)
    setForm(f => ({
      ...f,
      siteId,
      clientId: s?.clientId || f.clientId,
      clientName: s?.client?.name ?? s?.clientName ?? f.clientName,
    }))
  }

  const handleClientChange = (clientId: string) => {
    const c = clients.find((x: any) => x.id === clientId)
    setForm(f => ({ ...f, clientId, clientName: c?.name ?? f.clientName }))
  }

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/contracts', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contracts'] }); setShowForm(false); setForm(EMPTY_FORM) },
  })

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">契約管理</h1>
        {canEdit && (
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ 契約登録</button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">契約番号</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">発注元</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">現場</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">期間</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">単価</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">ステータス</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {contracts.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-gray-400">契約が登録されていません</td></tr>
              ) : (
                contracts.map((c: any) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{c.contractNumber}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{c.clientName}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{c.site?.name}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs hidden md:table-cell">
                      {format(new Date(c.startDate), 'yyyy/M/d')} 〜 {c.endDate ? format(new Date(c.endDate), 'yyyy/M/d') : '無期限'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-800 hidden lg:table-cell">
                      ¥{c.unitPrice.toLocaleString()} × {c.guardCount}名
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${STATUS_LABELS[c.status]?.className}`}>{STATUS_LABELS[c.status]?.label}</span>
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
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">契約登録</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={e => { e.preventDefault(); createMutation.mutate(form) }} className="p-6 space-y-4">
              <div>
                <label className="form-label">現場 *</label>
                <select value={form.siteId} onChange={e => handleSiteChange(e.target.value)} className="form-input" required>
                  <option value="">選択してください</option>
                  {sites.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">取引先（発注元）</label>
                <select value={form.clientId} onChange={e => handleClientChange(e.target.value)} className="form-input">
                  <option value="">— 未指定（手入力） —</option>
                  {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">契約番号 *</label>
                  <input type="text" value={form.contractNumber} onChange={e => setForm(f => ({ ...f, contractNumber: e.target.value }))} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">発注元名 *</label>
                  <input type="text" value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} className="form-input" required disabled={!!form.clientId} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">開始日 *</label>
                  <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">終了日</label>
                  <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} className="form-input" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">単価（円）*</label>
                  <input type="number" value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} className="form-input" required min="0" />
                </div>
                <div>
                  <label className="form-label">配員数</label>
                  <input type="number" value={form.guardCount} onChange={e => setForm(f => ({ ...f, guardCount: e.target.value }))} className="form-input" min="1" />
                </div>
              </div>
              <div>
                <label className="form-label">備考</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="form-input" rows={2} />
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
