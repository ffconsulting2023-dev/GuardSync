/**
 * 隊員向けPWAアプリのメインページ
 * スマートフォン最適化レイアウト
 */
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { format, addMonths, subMonths } from 'date-fns'
import { ja } from 'date-fns/locale'

type Tab = 'today' | 'schedule' | 'attendance' | 'reports'

const EMPTY_REPORT = {
  guardId: '', siteId: '', reportDate: format(new Date(), 'yyyy-MM-dd'),
  weather: '晴れ', incidents: '', specialNotes: '',
}

export default function GuardAppPage() {
  const { user, logout } = useAuth()
  const [tab, setTab] = useState<Tab>('today')
  const [viewMonth, setViewMonth] = useState(new Date())
  const [reportForm, setReportForm] = useState(EMPTY_REPORT)
  const [showReportForm, setShowReportForm] = useState(false)
  const qc = useQueryClient()

  // 今日のシフト
  const today = format(new Date(), 'yyyy-MM-dd')
  const { data: todaySchedules = [] } = useQuery({
    queryKey: ['guard-today', user?.id, today],
    queryFn: () => api.get(`/guards/${user?.id}/schedule?year=${new Date().getFullYear()}&month=${new Date().getMonth() + 1}`).then(r =>
      r.data.schedules.filter((s: any) => s.date.split('T')[0] === today)
    ),
    enabled: !!user?.id,
    refetchInterval: 30000,
  })

  // 月間スケジュール
  const { data: monthData } = useQuery({
    queryKey: ['guard-schedule', user?.id, format(viewMonth, 'yyyy-MM')],
    queryFn: () => api.get(`/guards/${user?.id}/schedule?year=${viewMonth.getFullYear()}&month=${viewMonth.getMonth() + 1}`).then(r => r.data),
    enabled: !!user?.id && tab === 'schedule',
  })

  // 出退勤打刻
  const clockInMutation = useMutation({
    mutationFn: (scheduleId: string) => api.post('/attendance/clock-in', { scheduleId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guard-today'] }),
  })

  const clockOutMutation = useMutation({
    mutationFn: (scheduleId: string) => api.post('/attendance/clock-out', { scheduleId, breakMinutes: 60 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guard-today'] }),
  })

  // 報告書取得
  const { data: myReports = [] } = useQuery({
    queryKey: ['guard-reports', user?.id],
    queryFn: () => api.get('/security-reports').then(r => r.data.filter((rep: any) => rep.guardId === user?.id)),
    enabled: !!user?.id && tab === 'reports',
  })

  // 現場取得（報告書用）
  const { data: mySites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.get('/sites').then(r => r.data),
    enabled: tab === 'reports',
  })

  const submitReportMutation = useMutation({
    mutationFn: (data: any) => api.post('/security-reports', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guard-reports'] })
      setShowReportForm(false)
      setReportForm(EMPTY_REPORT)
    },
  })

  const TAB_ITEMS = [
    { key: 'today', label: '今日', icon: '🏠' },
    { key: 'schedule', label: 'シフト', icon: '📅' },
    { key: 'attendance', label: '出退勤', icon: '⏰' },
    { key: 'reports', label: '報告書', icon: '📝' },
  ] as const

  // 月間カレンダーデータ
  const calendarDays = (() => {
    const year = viewMonth.getFullYear()
    const month = viewMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const days: { date: Date; schedules: any[] }[] = []

    // 月初の曜日まで空白
    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push({ date: new Date(year, month, -i), schedules: [] })
    }
    days.reverse()

    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d)
      const dateStr = format(date, 'yyyy-MM-dd')
      const schedules = (monthData?.schedules || []).filter((s: any) => s.date.split('T')[0] === dateStr)
      days.push({ date, schedules })
    }
    return days
  })()

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      {/* ヘッダー */}
      <header className="bg-[#1e3a5f] text-white px-4 py-3 safe-area-top">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-lg">GuardSync</p>
            <p className="text-xs text-white/70">{user?.name}</p>
          </div>
          <button onClick={logout} className="text-white/60 text-sm hover:text-white">ログアウト</button>
        </div>
      </header>

      {/* コンテンツ */}
      <main className="flex-1 overflow-y-auto pb-20">
        {/* 今日タブ */}
        {tab === 'today' && (
          <div className="p-4 space-y-4">
            <div>
              <p className="text-sm text-gray-500">{format(new Date(), 'yyyy年M月d日(E)', { locale: ja })}</p>
              <h2 className="text-xl font-bold text-gray-800">今日の出動</h2>
            </div>

            {todaySchedules.length === 0 ? (
              <div className="card text-center py-12">
                <p className="text-4xl mb-3">😊</p>
                <p className="text-gray-500">本日の出動はありません</p>
              </div>
            ) : (
              todaySchedules.map((s: any) => {
                const att = s.attendance
                const canClockIn = !att?.clockInAt
                const canClockOut = att?.clockInAt && !att?.clockOutAt

                return (
                  <div key={s.id} className="card space-y-3">
                    <div>
                      <p className="font-bold text-gray-800 text-lg">{s.site?.name}</p>
                      <p className="text-sm text-gray-500">🕐 {s.startTime}〜{s.endTime}</p>
                      <p className="text-sm text-gray-500">📍 {s.site?.address}</p>
                    </div>

                    {/* 打刻状況 */}
                    <div className="bg-gray-50 rounded-lg p-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">出勤打刻</span>
                        <span className={att?.clockInAt ? 'text-green-600 font-medium' : 'text-gray-400'}>
                          {att?.clockInAt ? format(new Date(att.clockInAt), 'HH:mm') : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-gray-500">退勤打刻</span>
                        <span className={att?.clockOutAt ? 'text-green-600 font-medium' : 'text-gray-400'}>
                          {att?.clockOutAt ? format(new Date(att.clockOutAt), 'HH:mm') : '—'}
                        </span>
                      </div>
                    </div>

                    {/* 打刻ボタン */}
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => clockInMutation.mutate(s.id)}
                        disabled={!canClockIn || clockInMutation.isPending}
                        className={`py-3 rounded-xl font-bold text-sm transition-all ${
                          canClockIn
                            ? 'bg-blue-600 text-white active:scale-95 hover:bg-blue-700'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        {att?.clockInAt ? '✅ 出勤済み' : '出勤打刻'}
                      </button>
                      <button
                        onClick={() => clockOutMutation.mutate(s.id)}
                        disabled={!canClockOut || clockOutMutation.isPending}
                        className={`py-3 rounded-xl font-bold text-sm transition-all ${
                          canClockOut
                            ? 'bg-green-600 text-white active:scale-95 hover:bg-green-700'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        {att?.clockOutAt ? '✅ 退勤済み' : '退勤打刻'}
                      </button>
                    </div>

                    {/* 経路案内ボタン */}
                    {s.site?.address && (
                      <a
                        href={`https://maps.google.com/maps?q=${encodeURIComponent(s.site.address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-center bg-orange-50 border border-orange-200 text-orange-700 py-2 rounded-lg text-sm font-medium hover:bg-orange-100"
                      >
                        📍 Googleマップで経路案内
                      </a>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* シフトタブ（月間カレンダー） */}
        {tab === 'schedule' && (
          <div className="p-4 space-y-4">
            {/* 月ナビゲーション */}
            <div className="flex items-center justify-between">
              <button onClick={() => setViewMonth(m => subMonths(m, 1))} className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200">◀</button>
              <h2 className="text-lg font-bold text-gray-800">{format(viewMonth, 'yyyy年M月', { locale: ja })}</h2>
              <button onClick={() => setViewMonth(m => addMonths(m, 1))} className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200">▶</button>
            </div>

            {/* カレンダーグリッド */}
            <div>
              {/* 曜日ヘッダー */}
              <div className="grid grid-cols-7 mb-1">
                {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
                  <div key={d} className={`text-center text-xs font-medium py-1 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'}`}>{d}</div>
                ))}
              </div>
              {/* 日グリッド */}
              <div className="grid grid-cols-7 gap-0.5">
                {calendarDays.map((day, i) => {
                  const isToday = format(day.date, 'yyyy-MM-dd') === today
                  const isCurrentMonth = day.date.getMonth() === viewMonth.getMonth()
                  const dayOfWeek = day.date.getDay()
                  return (
                    <div key={i} className={`min-h-14 p-1 rounded-lg ${isToday ? 'bg-[#1e3a5f]/10 ring-1 ring-[#1e3a5f]' : isCurrentMonth ? 'bg-white' : 'bg-gray-50'}`}>
                      <p className={`text-xs font-medium text-center ${
                        !isCurrentMonth ? 'text-gray-300' :
                        isToday ? 'text-[#1e3a5f] font-bold' :
                        dayOfWeek === 0 ? 'text-red-400' :
                        dayOfWeek === 6 ? 'text-blue-400' :
                        'text-gray-700'
                      }`}>
                        {isCurrentMonth ? day.date.getDate() : ''}
                      </p>
                      {day.schedules.map((s: any) => (
                        <div key={s.id} className="mt-0.5 bg-blue-500 text-white text-xs rounded px-0.5 py-0 truncate leading-4">
                          {s.startTime}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 月間シフト一覧 */}
            <div>
              <h3 className="font-semibold text-gray-700 mb-2">{format(viewMonth, 'M月', { locale: ja })}の出動一覧</h3>
              <div className="space-y-2">
                {(monthData?.schedules || []).length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-4">出動予定はありません</p>
                ) : (
                  (monthData?.schedules || []).map((s: any) => (
                    <div key={s.id} className="card py-3 flex items-center gap-3">
                      <div className="text-center min-w-12">
                        <p className="text-xs text-gray-400">{format(new Date(s.date), 'M月', { locale: ja })}</p>
                        <p className="text-xl font-bold text-gray-800 leading-tight">{format(new Date(s.date), 'd')}</p>
                        <p className="text-xs text-gray-400">{format(new Date(s.date), '(E)', { locale: ja })}</p>
                      </div>
                      <div className="flex-1 min-w-0 border-l border-gray-100 pl-3">
                        <p className="font-medium text-gray-800 truncate">{s.site?.name}</p>
                        <p className="text-xs text-gray-500">{s.startTime}〜{s.endTime}</p>
                        <p className="text-xs text-gray-400 truncate">{s.site?.address}</p>
                      </div>
                      <span className={`badge flex-shrink-0 ${
                        s.attendance?.status === 'COMPLETED' ? 'badge-success' :
                        s.attendance?.status === 'CLOCKED_IN' ? 'badge-info' :
                        'badge-gray'
                      }`}>
                        {s.attendance?.status === 'COMPLETED' ? '完了' : s.attendance?.status === 'CLOCKED_IN' ? '出勤中' : '予定'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* 出退勤タブ */}
        {tab === 'attendance' && (
          <div className="p-4 space-y-4">
            <h2 className="text-xl font-bold text-gray-800">出退勤</h2>
            <div className="card space-y-4">
              <p className="text-sm text-gray-500">本日 {format(new Date(), 'yyyy年M月d日(E)', { locale: ja })}</p>
              {todaySchedules.length === 0 ? (
                <p className="text-gray-400 text-center py-6">本日の出動予定がありません</p>
              ) : (
                todaySchedules.map((s: any) => {
                  const att = s.attendance
                  return (
                    <div key={s.id} className="space-y-2">
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="font-medium text-gray-800">{s.site?.name}</p>
                        <p className="text-xs text-gray-500">勤務時間: {s.startTime}〜{s.endTime}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-center text-sm">
                        <div className="bg-blue-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500 mb-1">出勤時刻</p>
                          <p className="text-xl font-bold text-blue-600">{att?.clockInAt ? format(new Date(att.clockInAt), 'HH:mm') : '—'}</p>
                        </div>
                        <div className="bg-green-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500 mb-1">退勤時刻</p>
                          <p className="text-xl font-bold text-green-600">{att?.clockOutAt ? format(new Date(att.clockOutAt), 'HH:mm') : '—'}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => clockInMutation.mutate(s.id)}
                          disabled={!!att?.clockInAt}
                          className={`py-4 rounded-xl font-bold transition-all ${att?.clockInAt ? 'bg-gray-100 text-gray-400' : 'bg-blue-600 text-white active:scale-95'}`}
                        >
                          {att?.clockInAt ? '出勤済み ✅' : '出勤打刻'}
                        </button>
                        <button
                          onClick={() => clockOutMutation.mutate(s.id)}
                          disabled={!att?.clockInAt || !!att?.clockOutAt}
                          className={`py-4 rounded-xl font-bold transition-all ${att?.clockOutAt ? 'bg-gray-100 text-gray-400' : !att?.clockInAt ? 'bg-gray-100 text-gray-400' : 'bg-green-600 text-white active:scale-95'}`}
                        >
                          {att?.clockOutAt ? '退勤済み ✅' : '退勤打刻'}
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* 報告書タブ */}
        {tab === 'reports' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-800">警備報告書</h2>
              <button onClick={() => {
                setReportForm({ ...EMPTY_REPORT, guardId: user?.id || '' })
                setShowReportForm(true)
              }} className="btn-primary text-sm">+ 提出</button>
            </div>

            {myReports.length === 0 ? (
              <div className="card text-center py-8">
                <p className="text-3xl mb-3">📝</p>
                <p className="text-gray-400 text-sm">提出済みの報告書はありません</p>
              </div>
            ) : (
              <div className="space-y-3">
                {myReports.map((rep: any) => (
                  <div key={rep.id} className="card">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-gray-800">{rep.site?.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{rep.reportDate?.split('T')[0]} / 天候: {rep.weather}</p>
                      </div>
                      <span className={`badge ${rep.approvedAt ? 'badge-success' : 'badge-warning'}`}>
                        {rep.approvedAt ? '承認済' : '確認待ち'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 報告書提出フォーム */}
            {showReportForm && (
              <div className="fixed inset-0 z-50 bg-white overflow-y-auto">
                <div className="sticky top-0 bg-white px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800">警備報告書 提出</h3>
                  <button onClick={() => setShowReportForm(false)} className="text-gray-400">✕</button>
                </div>
                <form onSubmit={e => {
                  e.preventDefault()
                  submitReportMutation.mutate({
                    ...reportForm,
                    content: { patrolRecords: [], incidents: reportForm.incidents, specialNotes: reportForm.specialNotes, weather: reportForm.weather }
                  })
                }} className="p-4 space-y-4">
                  <div>
                    <label className="form-label">現場 *</label>
                    <select value={reportForm.siteId} onChange={e => setReportForm(f => ({ ...f, siteId: e.target.value }))} className="form-input" required>
                      <option value="">選択してください</option>
                      {mySites.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">日付 *</label>
                    <input type="date" value={reportForm.reportDate} onChange={e => setReportForm(f => ({ ...f, reportDate: e.target.value }))} className="form-input" required />
                  </div>
                  <div>
                    <label className="form-label">天候</label>
                    <select value={reportForm.weather} onChange={e => setReportForm(f => ({ ...f, weather: e.target.value }))} className="form-input">
                      {['晴れ', '曇り', '雨', '雪', '強風'].map(w => <option key={w} value={w}>{w}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">特記事項・インシデント</label>
                    <textarea
                      value={reportForm.incidents}
                      onChange={e => setReportForm(f => ({ ...f, incidents: e.target.value }))}
                      className="form-input"
                      rows={4}
                      placeholder="異常なし、または発生した事象を記載"
                    />
                  </div>
                  <div>
                    <label className="form-label">その他連絡事項</label>
                    <textarea
                      value={reportForm.specialNotes}
                      onChange={e => setReportForm(f => ({ ...f, specialNotes: e.target.value }))}
                      className="form-input"
                      rows={3}
                      placeholder="引き継ぎ事項等"
                    />
                  </div>
                  <div className="flex gap-3 pb-8">
                    <button type="button" onClick={() => setShowReportForm(false)} className="btn-secondary flex-1">キャンセル</button>
                    <button type="submit" disabled={submitReportMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">
                      {submitReportMutation.isPending ? '提出中...' : '提出'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ボトムナビゲーション */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-gray-200 safe-area-bottom">
        <div className="grid grid-cols-4">
          {TAB_ITEMS.map(item => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`flex flex-col items-center py-2 px-1 text-xs transition-colors ${
                tab === item.key ? 'text-[#1e3a5f]' : 'text-gray-400'
              }`}
            >
              <span className="text-xl leading-tight">{item.icon}</span>
              <span className={`leading-tight mt-0.5 ${tab === item.key ? 'font-medium' : ''}`}>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
