import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { format, addDays } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Link } from 'react-router-dom'

function StatCard({ label, value, icon, color, to }: { label: string; value: number | string; icon: string; color: string; to?: string }) {
  const content = (
    <div className={`card flex items-center gap-4 ${to ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}>
      <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center text-2xl flex-shrink-0`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  )
  return to ? <Link to={to}>{content}</Link> : content
}

export default function DashboardPage() {
  const { user } = useAuth()
  const today = format(new Date(), 'yyyy-MM-dd')
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd')

  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get('/stats/dashboard').then(r => r.data),
    refetchInterval: 60000,
  })

  const { data: todaySchedules = [] } = useQuery({
    queryKey: ['schedules-today', today],
    queryFn: () => api.get(`/schedules?from=${today}&to=${today}`).then(r => r.data),
    refetchInterval: 30000,
  })

  const { data: tomorrowSchedules = [] } = useQuery({
    queryKey: ['schedules-tomorrow', tomorrow],
    queryFn: () => api.get(`/schedules?from=${tomorrow}&to=${tomorrow}`).then(r => r.data),
  })

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => r.data),
  })

  const { data: autoReceipts = [] } = useQuery({
    queryKey: ['auto-receipts'],
    queryFn: () => api.get('/auto-receipts').then(r => r.data),
  })

  const completedToday = todaySchedules.filter((s: any) => s.attendance?.status === 'COMPLETED').length
  const clockedIn = todaySchedules.filter((s: any) => s.attendance?.status === 'CLOCKED_IN').length

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-800">ダッシュボード</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {format(new Date(), 'yyyy年M月d日(E)', { locale: ja })} / {user?.company?.name}
        </p>
      </div>

      {/* アラート：自動受付・日払い申請 */}
      {(autoReceipts.length > 0 || stats?.pendingDailyPay > 0) && (
        <div className="space-y-2">
          {autoReceipts.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-xl">📨</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-orange-800">自動受付 {autoReceipts.length}件 が未処理です</p>
                <p className="text-xs text-orange-600">FAX/メール/LINE Worksから受信した配員依頼を確認してください</p>
              </div>
            </div>
          )}
          {stats?.pendingDailyPay > 0 && (
            <Link to="/daily-pay" className="block bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-blue-100">
              <span className="text-xl">💵</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-800">日払い申請 {stats.pendingDailyPay}件 が承認待ちです</p>
              </div>
            </Link>
          )}
        </div>
      )}

      {/* KPIカード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="本日の出動予定" value={stats?.todayCount ?? todaySchedules.length} icon="📋" color="bg-blue-100" to="/schedule" />
        <StatCard label="出勤中" value={clockedIn} icon="🟢" color="bg-green-100" to="/attendance" />
        <StatCard label="退勤完了" value={completedToday} icon="✅" color="bg-emerald-100" to="/attendance" />
        <StatCard label="登録隊員数" value={stats?.activeGuards ?? '—'} icon="👷" color="bg-orange-100" to="/guards" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="稼働契約数" value={stats?.openContracts ?? '—'} icon="📄" color="bg-purple-100" to="/contracts" />
        <StatCard label="月間シフト数" value={stats?.monthlySchedules ?? '—'} icon="📅" color="bg-indigo-100" to="/schedule" />
        <StatCard label="未収金請求" value={stats?.pendingInvoices > 0 ? `${stats?.pendingInvoices}件` : '0件'} icon="💴" color="bg-red-100" to="/invoices" />
        <StatCard label="明日の出動予定" value={stats?.tomorrowCount ?? tomorrowSchedules.length} icon="📅" color="bg-yellow-100" to="/schedule" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* 本日のシフト */}
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <span>📋</span> 本日の出動状況
            <span className="ml-auto text-sm text-gray-500 font-normal">{todaySchedules.length}件</span>
          </h2>
          {todaySchedules.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">本日の出動予定はありません</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {todaySchedules.map((s: any) => {
                const attStatus = s.attendance?.status
                return (
                  <div key={s.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{s.guard?.name}</p>
                      <p className="text-xs text-gray-500 truncate">{s.site?.name} {s.startTime}〜{s.endTime}</p>
                    </div>
                    <span className={`badge ${
                      attStatus === 'COMPLETED' ? 'badge-success' :
                      attStatus === 'CLOCKED_IN' ? 'badge-info' :
                      s.status === 'CANCELLED' ? 'badge-danger' : 'badge-gray'
                    }`}>
                      {attStatus === 'COMPLETED' ? '完了' : attStatus === 'CLOCKED_IN' ? '出勤中' : s.status === 'CANCELLED' ? 'キャンセル' : '未出勤'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 明日のシフト・前日確認状況 */}
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <span>📅</span> 明日の出動予定
            <span className="ml-auto text-sm text-gray-500 font-normal">{tomorrowSchedules.length}件</span>
          </h2>
          {tomorrowSchedules.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">明日の出動予定はありません</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {tomorrowSchedules.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{s.guard?.name}</p>
                    <p className="text-xs text-gray-500 truncate">{s.site?.name} {s.startTime}〜{s.endTime}</p>
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

      {/* 最近の通知 */}
      {notifications.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <span>🔔</span> 最近の通知
            <span className="ml-auto text-sm text-gray-500 font-normal">{notifications.length}件</span>
          </h2>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {notifications.slice(0, 10).map((n: any) => (
              <div key={n.id} className="flex items-start gap-3 p-2 bg-gray-50 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{n.title}</p>
                  <p className="text-xs text-gray-500 truncate">{n.body}</p>
                </div>
                <span className={`badge flex-shrink-0 ${n.status === 'SENT' ? 'badge-success' : 'badge-gray'}`}>
                  {n.status === 'SENT' ? '送信済み' : '未送信'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
