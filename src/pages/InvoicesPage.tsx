import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'
import { format } from 'date-fns'

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  DRAFT:     { label: '下書き',     className: 'badge-gray' },
  SENT:      { label: '送付済み',   className: 'badge-info' },
  PAID:      { label: '入金済み',   className: 'badge-success' },
  OVERDUE:   { label: '期限超過',   className: 'badge-danger' },
  CANCELLED: { label: 'キャンセル', className: 'badge-danger' },
}

interface InvoiceItem {
  description: string
  quantity: number
  unitPrice: number
}

const EMPTY_FORM = {
  invoiceNumber: '', clientName: '', clientEmail: '', issueDate: format(new Date(), 'yyyy-MM-dd'),
  dueDate: '', taxRate: '0.1', notes: '',
}

export default function InvoicesPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [items, setItems] = useState<InvoiceItem[]>([{ description: '', quantity: 1, unitPrice: 0 }])

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => api.get('/invoices').then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/invoices', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoices'] }); setShowForm(false); resetForm() },
  })

  const sendMutation = useMutation({
    mutationFn: (id: string) => api.put(`/invoices/${id}/send`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  })

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setItems([{ description: '', quantity: 1, unitPrice: 0 }])
  }

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const taxAmount = Math.floor(subtotal * Number(form.taxRate))
  const total = subtotal + taxAmount

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">請求管理</h1>
        <div className="flex gap-2">
          <a href={`${import.meta.env.VITE_API_URL || ''}/api/export/invoices`} download className="btn-secondary text-sm">⬇ CSV</a>
          {canEdit && <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ 請求書作成</button>}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">請求番号</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">発注元</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">発行日</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">支払期限</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">合計金額</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">ステータス</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invoices.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">請求書がありません</td></tr>
              ) : (
                invoices.map((inv: any) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{inv.clientName}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{format(new Date(inv.issueDate), 'yyyy/M/d')}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{format(new Date(inv.dueDate), 'yyyy/M/d')}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-800">¥{inv.total.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${STATUS_LABELS[inv.status]?.className}`}>{STATUS_LABELS[inv.status]?.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canEdit && inv.status === 'DRAFT' && (
                        <button onClick={() => { if (window.confirm('請求書を送付済みにしますか？')) sendMutation.mutate(inv.id) }} className="text-blue-600 hover:text-blue-800 text-xs">送付済みにする</button>
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
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">請求書作成</h2>
              <button onClick={() => { setShowForm(false); resetForm() }} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={e => { e.preventDefault(); createMutation.mutate({ ...form, items }) }} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">請求番号 *</label>
                  <input type="text" value={form.invoiceNumber} onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">発注元名 *</label>
                  <input type="text" value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} className="form-input" required />
                </div>
              </div>
              <div>
                <label className="form-label">発注元メールアドレス</label>
                <input type="email" value={form.clientEmail} onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))} className="form-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">発行日 *</label>
                  <input type="date" value={form.issueDate} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">支払期限 *</label>
                  <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} className="form-input" required />
                </div>
              </div>

              {/* 明細 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="form-label mb-0">明細 *</label>
                  <button type="button" onClick={() => setItems(its => [...its, { description: '', quantity: 1, unitPrice: 0 }])} className="text-blue-600 hover:text-blue-800 text-xs">+ 行追加</button>
                </div>
                <div className="space-y-2">
                  {items.map((item, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <input
                        type="text" value={item.description} placeholder="内容"
                        onChange={e => setItems(its => its.map((it, j) => j === i ? { ...it, description: e.target.value } : it))}
                        className="form-input col-span-6" required
                      />
                      <input
                        type="number" value={item.quantity} placeholder="数量" min="1"
                        onChange={e => setItems(its => its.map((it, j) => j === i ? { ...it, quantity: Number(e.target.value) } : it))}
                        className="form-input col-span-2" required
                      />
                      <input
                        type="number" value={item.unitPrice} placeholder="単価" min="0"
                        onChange={e => setItems(its => its.map((it, j) => j === i ? { ...it, unitPrice: Number(e.target.value) } : it))}
                        className="form-input col-span-3" required
                      />
                      <button type="button" onClick={() => setItems(its => its.filter((_, j) => j !== i))} className="col-span-1 text-red-400 hover:text-red-600 text-center">✕</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 小計 */}
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-600">小計</span><span className="font-medium">¥{subtotal.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">消費税（{Number(form.taxRate) * 100}%）</span><span>¥{taxAmount.toLocaleString()}</span></div>
                <div className="flex justify-between font-bold text-lg border-t border-gray-200 pt-1"><span>合計</span><span>¥{total.toLocaleString()}</span></div>
              </div>

              <div>
                <label className="form-label">備考</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="form-input" rows={2} />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => { setShowForm(false); resetForm() }} className="btn-secondary flex-1">キャンセル</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">作成</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
