import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { format, addDays } from 'date-fns'
import { ja } from 'date-fns/locale'

function StatCard({ label, value, icon, color }: { label: string; value: number | string; icon: string; color: string }) {
  return (
    <div className="card flex items-center gap-4">
      <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center text-2xl`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const today = format(new Date(), 'yyyy-MM-dd')
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd')

  const { data: todaySchedules = [] } = useQuery({
    queryKey: ['schedules', today],
    queryFn: () => api.get(`/schedules?from=${today}&to=${today}`).then(r => r.data),
  })

  const { data: tomorrowSchedules = [] } = useQuery({
    queryKey: ['schedules', tomorrow],
    queryFn: () => api.get(`/schedules?from=${tomorrow}&to=${tomorrow}`).then(r => r.data),
  })

  const { data: guards = [] } = useQuery({
    queryKey: ['guards'],
    queryFn: () => api.get('/guards?isActive=true').then(r => r.data),
  })

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => api.get('/invoices').then(r => r.data),
  })

  const unpaidInvoices = invoices.filter((inv: any) => inv.status === 'SENT' || inv.status === 'OVERDUE')
  const completedToday = todaySchedules.filter((s: any) => s.attendance?.status === 'COMPLETED').length

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-800">ダッシュボード</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {format(new Date(), 'yyyy年M月d日(E)', { locale: ja })} / {user?.company?.name}
        </p>
      </div>

      {/* KPIカード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="本日の出動数" value={todaySchedules.length} icon="📋" color="bg-blue-100" />
        <StatCard label="出勤完了" value={completedToday} icon="✅" color="bg-green-100" />
        <StatCard label="登録隊員数" value={guards.length} icon="👷" color="bg-orange-100" />
        <StatCard label="未収金請求" value={`${unpaidInvoices.length}件`} icon="💴" color="bg-purple-100" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* 本日のシフト */}
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <span>📋</span> 本日の出動予定
            <span className="ml-auto text-sm text-gray-500 font-normal">{todaySchedules.length}件</span>
          </h2>
          {todaySchedules.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">本日の出動予定はありません</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {todaySchedules.slice(0, 10).map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{s.guard?.name}</p>
                    <p className="text-xs text-gray-500 truncate">{s.site?.name} / {s.startTime}〜{s.endTime}</p>
                  </div>
                  <span className={`badge ${
                    s.attendance?.status === 'COMPLETED' ? 'badge-success' :
                    s.attendance?.status === 'CLOCKED_IN' ? 'badge-info' :
                    s.status === 'CANCELLED' ? 'badge-danger' : 'badge-gray'
                  }`}>
                    {s.attendance?.status === 'COMPLETED' ? '完了' :
                     s.attendance?.status === 'CLOCKED_IN' ? '出勤中' :
                     s.status === 'CANCELLED' ? 'キャンセル' : '未出勤'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 明日のシフト */}
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <span>📅</span> 明日の出動予定
            <span className="ml-auto text-sm text-gray-500 font-normal">{tomorrowSchedules.length}件</span>
          </h2>
          {tomorrowSchedules.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">明日の出動予定はありません</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {tomorrowSchedules.slice(0, 10).map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{s.guard?.name}</p>
                    <p className="text-xs text-gray-500 truncate">{s.site?.name} / {s.startTime}〜{s.endTime}</p>
                  </div>
                  <span className={`badge ${s.confirmedAt ? 'badge-success' : 'badge-warning'}`}>
                    {s.confirmedAt ? '確認済み' : '未確認'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 未収金 */}
      {unpaidInvoices.length > 0 && (
        <div className="card border-l-4 border-orange-400">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <span>⚠️</span> 未収金・入金待ち請求書
            <span className="ml-auto text-sm text-gray-500 font-normal">{unpaidInvoices.length}件</span>
          </h2>
          <div className="space-y-2">
            {unpaidInvoices.slice(0, 5).map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between p-2 bg-orange-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-800">{inv.clientName}</p>
                  <p className="text-xs text-gray-500">#{inv.invoiceNumber} / 期限: {format(new Date(inv.dueDate), 'M/d')}</p>
                </div>
                <p className="font-bold text-gray-800 text-sm">¥{inv.total.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
