import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

const STATUS_LABELS: Record<string, string> = {
  PENDING: '未受領', RECEIVED: '受領済', PAID: '支払済',
}
const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600', RECEIVED: 'bg-yellow-100 text-yellow-700', PAID: 'bg-green-100 text-green-700',
}
const NEXT_STATUS: Record<string, string> = {
  PENDING: 'RECEIVED', RECEIVED: 'PAID',
}

interface PaymentData {
  id: string; companyId: string; partnerId: string | null
  partner: { id: string; name: string } | null
  partnerName: string; invoiceNumber: string | null
  year: number; month: number; status: string
  clientName: string | null; siteNames: string | null
  periodStart: string; periodEnd: string
  amount: number; taxRate: number; notes: string | null
  receivedAt: string | null; paidAt: string | null
  items: Array<{ date: string; siteName: string; amount: number; count: number }> | null
}

export default function SubcontractorPaymentPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [tab, setTab] = useState<string>('ALL')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    partnerName: '', invoiceNumber: '', clientName: '', siteNames: '',
    periodStart: '', periodEnd: '', amount: 0, taxRate: 0.1, notes: '',
  })

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')

  const { data: payments = [], isLoading } = useQuery<PaymentData[]>({
    queryKey: ['sub-payments', year, month],
    queryFn: () => api.get(`/subcontractor-payments?year=${year}&month=${month}`).then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/subcontractor-payments', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sub-payments'] }); setShowForm(false) },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.put(`/subcontractor-payments/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sub-payments'] }),
  })

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1) }

  const filtered = tab === 'ALL' ? payments : payments.filter(p => p.status === tab)

  const advanceStatus = (p: PaymentData) => {
    const next = NEXT_STATUS[p.status]
    if (!next) return
    const now = new Date().toISOString()
    const extra: Record<string, unknown> = { status: next }
    if (next === 'RECEIVED') extra.receivedAt = now
    if (next === 'PAID') extra.paidAt = now
    updateMut.mutate({ id: p.id, data: extra })
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    createMut.mutate({ ...form, year, month })
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">支払管理</h1>
        {canEdit && (
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ 新規登録</button>
        )}
      </div>

      {/* 月切り替え */}
      <div className="flex items-center gap-4 justify-center">
        <button onClick={prevMonth} className="btn-secondary text-sm px-3 py-1">&larr;</button>
        <span className="text-lg font-semibold">{year}年{month}月</span>
        <button onClick={nextMonth} className="btn-secondary text-sm px-3 py-1">&rarr;</button>
      </div>

      {/* タブ */}
      <div className="flex gap-2 border-b border-gray-200">
        {[
          { key: 'ALL', label: 'すべて', count: payments.length },
          { key: 'PENDING', label: '未受領', count: payments.filter(p => p.status === 'PENDING').length },
          { key: 'RECEIVED', label: '受領済', count: payments.filter(p => p.status === 'RECEIVED').length },
          { key: 'PAID', label: '支払済', count: payments.filter(p => p.status === 'PAID').length },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${tab === t.key ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">該当するデータがありません</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">協力会社名</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">発注先</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">案件</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">期間</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">金額</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">ステータス</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(p => (
                <React.Fragment key={p.id}>
                  <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                    <td className="px-4 py-3 font-medium text-gray-800">{p.partnerName}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{p.clientName || '-'}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{p.siteNames || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 hidden lg:table-cell text-xs">
                      {p.periodStart?.split('T')[0]} ~ {p.periodEnd?.split('T')[0]}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{p.amount.toLocaleString()}円</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[p.status]}`}>
                        {STATUS_LABELS[p.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canEdit && NEXT_STATUS[p.status] && (
                        <button onClick={(e) => { e.stopPropagation(); advanceStatus(p) }}
                          className="text-blue-600 hover:text-blue-800 text-xs"
                          disabled={updateMut.isPending}>
                          {STATUS_LABELS[NEXT_STATUS[p.status]]}にする
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === p.id && (
                    <tr>
                      <td colSpan={7} className="px-4 py-4 bg-gray-50">
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div><span className="text-gray-500">請求書番号:</span> {p.invoiceNumber || '-'}</div>
                            <div><span className="text-gray-500">税率:</span> {(p.taxRate * 100).toFixed(0)}%</div>
                            <div><span className="text-gray-500">受領日:</span> {p.receivedAt?.split('T')[0] || '-'}</div>
                            <div><span className="text-gray-500">支払日:</span> {p.paidAt?.split('T')[0] || '-'}</div>
                          </div>
                          {p.notes && <p className="text-sm text-gray-600">備考: {p.notes}</p>}
                          {p.items && Array.isArray(p.items) && p.items.length > 0 && (
                            <div>
                              <h4 className="text-sm font-semibold text-gray-700 mb-1">明細</h4>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b">
                                    <th className="text-left py-1 px-2">日付</th>
                                    <th className="text-left py-1 px-2">現場名</th>
                                    <th className="text-right py-1 px-2">人数</th>
                                    <th className="text-right py-1 px-2">金額</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(p.items as Array<{ date: string; siteName: string; count: number; amount: number }>).map((item, i) => (
                                    <tr key={i} className="border-b border-gray-100">
                                      <td className="py-1 px-2">{item.date}</td>
                                      <td className="py-1 px-2">{item.siteName}</td>
                                      <td className="py-1 px-2 text-right">{item.count}</td>
                                      <td className="py-1 px-2 text-right">{item.amount?.toLocaleString()}円</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新規登録モーダル */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">支払新規登録</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">X</button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="form-label">協力会社名 *</label>
                <input type="text" value={form.partnerName} onChange={e => setForm(f => ({ ...f, partnerName: e.target.value }))} className="form-input" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">請求書番号</label>
                  <input type="text" value={form.invoiceNumber} onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))} className="form-input" />
                </div>
                <div>
                  <label className="form-label">発注先</label>
                  <input type="text" value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} className="form-input" />
                </div>
              </div>
              <div>
                <label className="form-label">現場名</label>
                <input type="text" value={form.siteNames} onChange={e => setForm(f => ({ ...f, siteNames: e.target.value }))} className="form-input" placeholder="カンマ区切り" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">期間開始 *</label>
                  <input type="date" value={form.periodStart} onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">期間終了 *</label>
                  <input type="date" value={form.periodEnd} onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))} className="form-input" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">金額（税込） *</label>
                  <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">税率</label>
                  <input type="number" step="0.01" value={form.taxRate} onChange={e => setForm(f => ({ ...f, taxRate: Number(e.target.value) }))} className="form-input" />
                </div>
              </div>
              <div>
                <label className="form-label">備考</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="form-input" rows={2} />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">キャンセル</button>
                <button type="submit" className="btn-primary flex-1" disabled={createMut.isPending}>登録</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
