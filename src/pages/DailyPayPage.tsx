import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'
import { format } from 'date-fns'

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  PENDING:   { label: '申請中',   className: 'badge-warning' },
  APPROVED:  { label: '承認済み', className: 'badge-info' },
  PAID:      { label: '支払済み', className: 'badge-success' },
  REJECTED:  { label: '否認',     className: 'badge-danger' },
  DEDUCTED:  { label: '差引済み', className: 'badge-gray' },
}

export default function DailyPayPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [guardId, setGuardId] = useState('')
  const [amount, setAmount] = useState('')
  const FEE_RATE = 0.03

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['daily-pay'],
    queryFn: () => api.get('/daily-pay').then(r => r.data),
  })

  const { data: guards = [] } = useQuery({
    queryKey: ['guards-dailypay'],
    queryFn: () => api.get('/guards?isActive=true').then(r => r.data).then((gs: any[]) => gs.filter(g => g.dailyPayEnabled)),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/daily-pay/request', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['daily-pay'] }); setShowForm(false); setGuardId(''); setAmount('') },
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.put(`/daily-pay/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['daily-pay'] }),
  })

  const feeAmount = Math.floor(Number(amount) * FEE_RATE)
  const netAmount = Number(amount) - feeAmount

  const canApprove = hasRole(user, 'ADMIN', 'MANAGER')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">日払い管理</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ 日払い申請</button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="space-y-3">
          {requests.length === 0 ? (
            <div className="card text-center py-12 text-gray-400">日払い申請はありません</div>
          ) : (
            requests.map((req: any) => (
              <div key={req.id} className="card flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-800">{req.guard?.name}</p>
                    <span className={`badge ${STATUS_LABELS[req.status]?.className}`}>{STATUS_LABELS[req.status]?.label}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">{format(new Date(req.requestDate), 'yyyy/M/d')} 申請</p>
                  <div className="text-xs text-gray-500 mt-1 flex gap-3">
                    <span>申請額: ¥{req.amount.toLocaleString()}</span>
                    <span className="text-red-500">手数料: -¥{req.feeAmount.toLocaleString()}（{(req.feeRate * 100).toFixed(0)}%）</span>
                    <span className="text-green-600 font-medium">振込額: ¥{req.netAmount.toLocaleString()}</span>
                  </div>
                </div>
                {canApprove && req.status === 'PENDING' && (
                  <button
                    onClick={() => approveMutation.mutate(req.id)}
                    disabled={approveMutation.isPending}
                    className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                  >
                    承認
                  </button>
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
              <h2 className="font-semibold text-gray-800">日払い申請</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={e => { e.preventDefault(); createMutation.mutate({ guardId, amount: Number(amount), feeRate: FEE_RATE }) }} className="p-6 space-y-4">
              <div>
                <label className="form-label">隊員 *</label>
                <select value={guardId} onChange={e => setGuardId(e.target.value)} className="form-input" required>
                  <option value="">選択してください（日払い対象のみ）</option>
                  {guards.map((g: any) => <option key={g.id} value={g.id}>{g.name} ({g.employeeNumber})</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">申請金額（円）*</label>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="form-input" min="1000" required />
              </div>
              {Number(amount) > 0 && (
                <div className="bg-blue-50 rounded-lg p-3 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-gray-600">申請金額</span><span>¥{Number(amount).toLocaleString()}</span></div>
                  <div className="flex justify-between text-red-600"><span>手数料（{FEE_RATE * 100}%）</span><span>-¥{feeAmount.toLocaleString()}</span></div>
                  <div className="flex justify-between font-bold text-green-700 border-t border-blue-200 pt-1"><span>振込額</span><span>¥{netAmount.toLocaleString()}</span></div>
                  <p className="text-xs text-gray-400">※手数料は月末給与から自動差引されます</p>
                </div>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">キャンセル</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">申請</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
