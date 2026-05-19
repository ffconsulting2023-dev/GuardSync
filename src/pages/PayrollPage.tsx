import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '未入力', IN_REVIEW: '確認中', CONFIRMED: '確認済み', PAID: '支払済み',
}
const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600', IN_REVIEW: 'bg-yellow-100 text-yellow-700',
  CONFIRMED: 'bg-blue-100 text-blue-700', PAID: 'bg-green-100 text-green-700',
}

interface PayrollData {
  id: string
  guardId: string
  guard: { id: string; name: string; nameKana: string; employeeNumber: string }
  year: number; month: number; status: string
  workDays: number; holidayWorkDays: number; totalWorkMinutes: number
  regularMinutes: number; overtimeMinutes: number; earlyOtMinutes: number; lateOtMinutes: number
  paidLeaveDays: number; absentDays: number
  basicPay: number; overtimePay: number; holidayPay: number
  positionAllowance: number; qualificationAllowance: number; leaderAllowance: number
  commuteAllowance: number; travelExpense: number; otherAllowance: number
  taxableTotal: number; nonTaxableTotal: number; grossPay: number
  healthInsurance: number; pension: number; employmentIns: number
  incomeTax: number; residentTax: number; otherDeduction: number; totalDeduction: number
  yearEndAdj: number; netPay: number; notes: string | null
}

export default function PayrollPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<PayrollData>>({})

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')

  const { data: payrolls = [], isLoading } = useQuery<PayrollData[]>({
    queryKey: ['payroll', year, month],
    queryFn: () => api.get(`/payroll?year=${year}&month=${month}`).then(r => r.data),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.put(`/payroll/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll'] }),
  })

  const generateMut = useMutation({
    mutationFn: (guardId: string) => api.post(`/payroll/${guardId}/generate?year=${year}&month=${month}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll'] }),
  })

  const { data: guards = [] } = useQuery({
    queryKey: ['guards-active'],
    queryFn: () => api.get('/guards?isActive=true').then(r => r.data),
  })

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1)
  }

  const toggleExpand = (p: PayrollData) => {
    if (expandedId === p.id) { setExpandedId(null); return }
    setExpandedId(p.id)
    setEditData({ ...p })
  }

  const handleSave = (id: string) => {
    const grossPay = (editData.basicPay || 0) + (editData.overtimePay || 0) + (editData.holidayPay || 0) +
      (editData.positionAllowance || 0) + (editData.qualificationAllowance || 0) + (editData.leaderAllowance || 0) +
      (editData.commuteAllowance || 0) + (editData.travelExpense || 0) + (editData.otherAllowance || 0)
    const totalDeduction = (editData.healthInsurance || 0) + (editData.pension || 0) + (editData.employmentIns || 0) +
      (editData.incomeTax || 0) + (editData.residentTax || 0) + (editData.otherDeduction || 0)
    const netPay = grossPay - totalDeduction + (editData.yearEndAdj || 0)
    updateMut.mutate({ id, data: { ...editData, grossPay, totalDeduction, netPay } })
  }

  const draftCount = payrolls.filter(p => p.status === 'DRAFT').length
  const reviewCount = payrolls.filter(p => p.status === 'IN_REVIEW').length
  const confirmedCount = payrolls.filter(p => p.status === 'CONFIRMED').length

  const numField = (label: string, key: keyof PayrollData) => (
    <div>
      <label className="text-xs text-gray-500">{label}</label>
      <input type="number" value={(editData[key] as number) || 0}
        onChange={e => setEditData(d => ({ ...d, [key]: Number(e.target.value) }))}
        className="form-input text-right text-sm" />
    </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">給与管理</h1>
      </div>

      {/* 月切り替え */}
      <div className="flex items-center gap-4 justify-center">
        <button onClick={prevMonth} className="btn-secondary text-sm px-3 py-1">&larr;</button>
        <span className="text-lg font-semibold">{year}年{month}月</span>
        <button onClick={nextMonth} className="btn-secondary text-sm px-3 py-1">&rarr;</button>
      </div>

      {/* サマリ */}
      <div className="flex gap-3 flex-wrap">
        <div className="bg-gray-50 rounded-lg px-4 py-2 text-center">
          <p className="text-xs text-gray-500">未入力</p>
          <p className="text-xl font-bold text-gray-600">{draftCount}</p>
        </div>
        <div className="bg-yellow-50 rounded-lg px-4 py-2 text-center">
          <p className="text-xs text-gray-500">確認中</p>
          <p className="text-xl font-bold text-yellow-600">{reviewCount}</p>
        </div>
        <div className="bg-green-50 rounded-lg px-4 py-2 text-center">
          <p className="text-xs text-gray-500">確認済み</p>
          <p className="text-xl font-bold text-green-600">{confirmedCount}</p>
        </div>
      </div>

      {/* 一括生成 */}
      {canEdit && (
        <div className="flex gap-2">
          <button onClick={() => {
            guards.forEach((g: { id: string }) => generateMut.mutate(g.id))
          }} className="btn-primary text-sm" disabled={generateMut.isPending}>
            全隊員の給与自動計算
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : payrolls.length === 0 ? (
        <div className="text-center py-12 text-gray-400">該当月の給与データがありません。「全隊員の給与自動計算」で生成してください。</div>
      ) : (
        <div className="space-y-2">
          {payrolls.map(p => (
            <div key={p.id} className="card">
              <div className="flex items-center justify-between cursor-pointer" onClick={() => toggleExpand(p)}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-bold text-blue-700">
                    {p.guard.name[0]}
                  </div>
                  <div>
                    <p className="font-medium text-gray-800">{p.guard.name}</p>
                    <p className="text-xs text-gray-400">{p.guard.employeeNumber}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[p.status]}`}>
                    {STATUS_LABELS[p.status]}
                  </span>
                  <span className="font-semibold text-gray-700">{p.netPay.toLocaleString()}円</span>
                  <span className="text-gray-400">{expandedId === p.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {expandedId === p.id && (
                <div className="mt-4 border-t pt-4 space-y-4">
                  {/* ステータス */}
                  <div className="flex gap-2">
                    {(['DRAFT', 'IN_REVIEW', 'CONFIRMED', 'PAID'] as const).map(s => (
                      <button key={s} onClick={() => {
                        setEditData(d => ({ ...d, status: s }))
                        updateMut.mutate({ id: p.id, data: { status: s } })
                      }}
                        className={`text-xs px-3 py-1 rounded-full border ${p.status === s ? STATUS_COLORS[s] + ' border-current' : 'border-gray-200 text-gray-400'}`}
                      >
                        {STATUS_LABELS[s]}
                      </button>
                    ))}
                  </div>

                  {/* 勤怠サマリ */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">勤怠サマリ</h4>
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                      {numField('出勤日数', 'workDays')}
                      {numField('休日出勤', 'holidayWorkDays')}
                      {numField('総労働(分)', 'totalWorkMinutes')}
                      {numField('早出残業(分)', 'earlyOtMinutes')}
                      {numField('遅出残業(分)', 'lateOtMinutes')}
                    </div>
                  </div>

                  {/* 支給 */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">支給</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {numField('基本給', 'basicPay')}
                      {numField('残業手当', 'overtimePay')}
                      {numField('休日手当', 'holidayPay')}
                      {numField('役職手当', 'positionAllowance')}
                      {numField('資格手当', 'qualificationAllowance')}
                      {numField('隊長手当', 'leaderAllowance')}
                      {numField('通勤手当', 'commuteAllowance')}
                      {numField('旅費', 'travelExpense')}
                      {numField('その他手当', 'otherAllowance')}
                    </div>
                    <div className="mt-2 text-right">
                      <span className="text-sm text-gray-500">総支給額: </span>
                      <span className="font-bold text-lg text-gray-800">
                        {((editData.basicPay || 0) + (editData.overtimePay || 0) + (editData.holidayPay || 0) +
                          (editData.positionAllowance || 0) + (editData.qualificationAllowance || 0) +
                          (editData.leaderAllowance || 0) + (editData.commuteAllowance || 0) +
                          (editData.travelExpense || 0) + (editData.otherAllowance || 0)).toLocaleString()}円
                      </span>
                    </div>
                  </div>

                  {/* 控除 */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">控除</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {numField('健康保険', 'healthInsurance')}
                      {numField('厚生年金', 'pension')}
                      {numField('雇用保険', 'employmentIns')}
                      {numField('所得税', 'incomeTax')}
                      {numField('住民税', 'residentTax')}
                      {numField('その他控除', 'otherDeduction')}
                    </div>
                  </div>

                  {/* 年末調整・差引支給額 */}
                  <div className="grid grid-cols-2 gap-2">
                    {numField('年末調整', 'yearEndAdj')}
                    <div>
                      <label className="text-xs text-gray-500">備考</label>
                      <input type="text" value={editData.notes || ''}
                        onChange={e => setEditData(d => ({ ...d, notes: e.target.value }))}
                        className="form-input text-sm" />
                    </div>
                  </div>

                  <div className="bg-blue-50 rounded-lg p-3 flex items-center justify-between">
                    <span className="font-semibold text-blue-800">差引支給額</span>
                    <span className="text-2xl font-bold text-blue-900">
                      {(() => {
                        const gross = (editData.basicPay || 0) + (editData.overtimePay || 0) + (editData.holidayPay || 0) +
                          (editData.positionAllowance || 0) + (editData.qualificationAllowance || 0) +
                          (editData.leaderAllowance || 0) + (editData.commuteAllowance || 0) +
                          (editData.travelExpense || 0) + (editData.otherAllowance || 0)
                        const deduct = (editData.healthInsurance || 0) + (editData.pension || 0) + (editData.employmentIns || 0) +
                          (editData.incomeTax || 0) + (editData.residentTax || 0) + (editData.otherDeduction || 0)
                        return (gross - deduct + (editData.yearEndAdj || 0)).toLocaleString()
                      })()}円
                    </span>
                  </div>

                  {canEdit && (
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => window.print()} className="btn-secondary text-sm">PDF出力</button>
                      <button className="btn-secondary text-sm" disabled>メール送信</button>
                      <button onClick={() => handleSave(p.id)} className="btn-primary text-sm"
                        disabled={updateMut.isPending}>保存</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
