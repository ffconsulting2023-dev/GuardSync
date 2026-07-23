import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'
import { format } from 'date-fns'
import { CONTRACT_STATUS } from '../lib/constants'

const STATUS_LABELS = CONTRACT_STATUS

const EMPTY_FORM = {
  siteId: '', contractNumber: '', clientName: '', startDate: '', endDate: '',
  unitPrice: '', guardCount: '1', notes: '',
  unitPriceDay: '', unitPriceNight: '', unitPriceHolidayDay: '', unitPriceHolidayNight: '',
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

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/contracts', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contracts'] }); setShowForm(false); setForm(EMPTY_FORM) },
  })

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')

  // 現場選択時：clientの単価をデフォルト値として自動補完
  const handleSiteChange = (siteId: string) => {
    const site = sites.find((s: any) => s.id === siteId)
    const client = site?.client
    setForm(f => ({
      ...f,
      siteId,
      clientName: client ? client.name : f.clientName,
      unitPriceDay: client?.unitPriceDay != null ? String(client.unitPriceDay) : f.unitPriceDay,
      unitPriceNight: client?.unitPriceNight != null ? String(client.unitPriceNight) : f.unitPriceNight,
      unitPriceHolidayDay: client?.unitPriceHolidayDay != null ? String(client.unitPriceHolidayDay) : f.unitPriceHolidayDay,
      unitPriceHolidayNight: client?.unitPriceHolidayNight != null ? String(client.unitPriceHolidayNight) : f.unitPriceHolidayNight,
      // 旧unitPriceは日勤単価をデフォルトとする
      unitPrice: client?.unitPriceDay != null ? String(client.unitPriceDay) : f.unitPrice,
    }))
  }

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
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">日勤単価</th>
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
                      {c.unitPriceDay != null
                        ? `¥${c.unitPriceDay.toLocaleString()} × ${c.guardCount}名`
                        : `¥${c.unitPrice.toLocaleString()} × ${c.guardCount}名`}
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
                {form.siteId && sites.find((s: any) => s.id === form.siteId)?.client && (
                  <p className="text-xs text-blue-600 mt-1">取引先「{sites.find((s: any) => s.id === form.siteId)?.client?.name}」の単価を自動補完しました</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">契約番号 *</label>
                  <input type="text" value={form.contractNumber} onChange={e => setForm(f => ({ ...f, contractNumber: e.target.value }))} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">発注元名 *</label>
                  <input type="text" value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} className="form-input" required />
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

              {/* 契約単価（4区分） */}
              <div>
                <label className="form-label">契約単価（円）</label>
                <p className="text-xs text-gray-400 mb-2">現場の取引先単価から自動補完。個別に上書き可能です。</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500">日勤単価</label>
                    <input type="number" value={form.unitPriceDay} onChange={e => setForm(f => ({ ...f, unitPriceDay: e.target.value, unitPrice: e.target.value }))} className="form-input" min="0" placeholder="例: 15000" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">夜勤単価</label>
                    <input type="number" value={form.unitPriceNight} onChange={e => setForm(f => ({ ...f, unitPriceNight: e.target.value }))} className="form-input" min="0" placeholder="例: 18000" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">休日日勤単価</label>
                    <input type="number" value={form.unitPriceHolidayDay} onChange={e => setForm(f => ({ ...f, unitPriceHolidayDay: e.target.value }))} className="form-input" min="0" placeholder="例: 17000" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">休日夜勤単価</label>
                    <input type="number" value={form.unitPriceHolidayNight} onChange={e => setForm(f => ({ ...f, unitPriceHolidayNight: e.target.value }))} className="form-input" min="0" placeholder="例: 20000" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
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
