import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { format, addDays, subDays, startOfWeek, eachDayOfInterval } from 'date-fns'
import { ja } from 'date-fns/locale'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  DRAFT:     { label: '下書き',   className: 'badge-gray' },
  ASSIGNED:  { label: '配員済み', className: 'badge-info' },
  CONFIRMED: { label: '確認済み', className: 'badge-success' },
  CANCELLED: { label: 'キャンセル', className: 'badge-danger' },
}

export default function SchedulePage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [viewDate, setViewDate] = useState(new Date())
  const [view, setView] = useState<'day' | 'week'>('day')
  const [showForm, setShowForm] = useState(false)
  const [showAvailable, setShowAvailable] = useState(false)
  const [form, setForm] = useState({
    guardId: '', siteId: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    startTime: '09:00', endTime: '17:00', notes: '',
  })

  const dateFrom = view === 'week'
    ? format(startOfWeek(viewDate, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    : format(viewDate, 'yyyy-MM-dd')
  const dateTo = view === 'week'
    ? format(addDays(startOfWeek(viewDate, { weekStartsOn: 1 }), 6), 'yyyy-MM-dd')
    : format(viewDate, 'yyyy-MM-dd')

  const { data: schedules = [], isLoading } = useQuery({
    queryKey: ['schedules', dateFrom, dateTo],
    queryFn: () => api.get(`/schedules?from=${dateFrom}&to=${dateTo}`).then(r => r.data),
    refetchInterval: 30000,
  })

  const { data: guards = [] } = useQuery({ queryKey: ['guards'], queryFn: () => api.get('/guards?isActive=true').then(r => r.data) })
  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: () => api.get('/sites').then(r => r.data) })

  const { data: availableGuards = [] } = useQuery({
    queryKey: ['available-guards', form.date],
    queryFn: () => api.get(`/schedules/available-guards?date=${form.date}`).then(r => r.data),
    enabled: showForm,
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/schedules', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['schedules'] }); setShowForm(false); resetForm() },
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/schedules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  })

  const resetForm = () => setForm({ guardId: '', siteId: '', date: format(new Date(), 'yyyy-MM-dd'), startTime: '09:00', endTime: '17:00', notes: '' })

  const weekDays = view === 'week'
    ? eachDayOfInterval({ start: new Date(dateFrom), end: new Date(dateTo) })
    : [viewDate]

  // 月間CSVダウンロード
  const downloadMonthlyCSV = async () => {
    const y = viewDate.getFullYear()
    const m = viewDate.getMonth() + 1
    const res = await api.get(`/schedules/monthly?year=${y}&month=${m}`, {
      headers: { Accept: 'text/csv' },
      responseType: 'blob',
    })
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `schedule_${y}_${m}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER', 'OPERATOR')

  // サイト別グループ
  const bySite = schedules.reduce((acc: any, s: any) => {
    const key = s.siteId
    if (!acc[key]) acc[key] = { site: s.site, schedules: [] }
    acc[key].schedules.push(s)
    return acc
  }, {})

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-800">管制・配員</h1>
        <div className="flex gap-2">
          <button onClick={downloadMonthlyCSV} className="btn-secondary text-sm">📥 月間CSV</button>
          {canEdit && (
            <button onClick={() => { resetForm(); setShowForm(true) }} className="btn-primary text-sm">+ 配員追加</button>
          )}
        </div>
      </div>

      {/* ナビゲーション */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          <button onClick={() => setView('day')} className={`px-3 py-1.5 text-sm ${view === 'day' ? 'bg-[#1e3a5f] text-white' : 'bg-white text-gray-600'}`}>日</button>
          <button onClick={() => setView('week')} className={`px-3 py-1.5 text-sm ${view === 'week' ? 'bg-[#1e3a5f] text-white' : 'bg-white text-gray-600'}`}>週</button>
        </div>
        <button onClick={() => setViewDate(d => view === 'week' ? subDays(d, 7) : subDays(d, 1))} className="btn-secondary px-3 py-1.5 text-sm">◀</button>
        <span className="text-sm font-medium text-gray-700 min-w-36 text-center">
          {view === 'week'
            ? `${format(new Date(dateFrom), 'M/d(E)', { locale: ja })} 〜 ${format(new Date(dateTo), 'M/d(E)', { locale: ja })}`
            : format(viewDate, 'yyyy年M月d日(E)', { locale: ja })
          }
        </span>
        <button onClick={() => setViewDate(d => view === 'week' ? addDays(d, 7) : addDays(d, 1))} className="btn-secondary px-3 py-1.5 text-sm">▶</button>
        <button onClick={() => setViewDate(new Date())} className="text-xs text-blue-600 hover:underline">今日</button>
        <span className="ml-auto text-sm text-gray-500">{schedules.length}件</span>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : view === 'day' ? (
        // 日表示：現場別グループ
        <div className="space-y-3">
          {Object.keys(bySite).length === 0 ? (
            <div className="card text-center py-12 text-gray-400">この日の配員はありません</div>
          ) : (
            Object.values(bySite).map((group: any) => (
              <div key={group.site.id} className="card p-0 overflow-hidden">
                <div className="px-4 py-2.5 bg-[#1e3a5f]/5 border-b border-gray-100">
                  <p className="text-sm font-semibold text-[#1e3a5f]">📍 {group.site.name}</p>
                  <p className="text-xs text-gray-400">{group.site.address}</p>
                </div>
                <div className="divide-y divide-gray-50">
                  {group.schedules.map((s: any) => (
                    <div key={s.id} className="px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-800 text-sm">{s.guard?.name}</p>
                          <span className="text-xs text-gray-400">{s.guard?.employeeNumber}</span>
                          <span className={`badge ${STATUS_LABELS[s.status]?.className}`}>{STATUS_LABELS[s.status]?.label}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{s.startTime}〜{s.endTime}</p>
                      </div>
                      {s.attendance && (
                        <div className="text-right">
                          <span className={`badge text-xs ${s.attendance.status === 'COMPLETED' ? 'badge-success' : s.attendance.status === 'CLOCKED_IN' ? 'badge-info' : 'badge-gray'}`}>
                            {s.attendance.status === 'COMPLETED' ? '退勤済' : s.attendance.status === 'CLOCKED_IN' ? '出勤中' : '未打刻'}
                          </span>
                        </div>
                      )}
                      {canEdit && s.status !== 'CANCELLED' && (
                        <button onClick={() => { if (window.confirm('キャンセルしますか？')) cancelMutation.mutate(s.id) }} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        // 週表示
        <div className="grid grid-cols-7 gap-1 overflow-x-auto">
          {weekDays.map(day => {
            const dayStr = format(day, 'yyyy-MM-dd')
            const daySchedules = schedules.filter((s: any) => s.date.split('T')[0] === dayStr)
            const isToday = dayStr === format(new Date(), 'yyyy-MM-dd')
            return (
              <div key={dayStr} className={`bg-white rounded-lg border min-w-[80px] ${isToday ? 'border-[#1e3a5f]' : 'border-gray-100'} overflow-hidden`}>
                <div className={`px-1 py-1.5 text-center text-xs font-medium ${isToday ? 'bg-[#1e3a5f] text-white' : 'bg-gray-50 text-gray-600'}`}>
                  <p>{format(day, 'M/d', { locale: ja })}</p>
                  <p>{format(day, '(E)', { locale: ja })}</p>
                  {daySchedules.length > 0 && <span className="bg-white/30 rounded px-1">{daySchedules.length}件</span>}
                </div>
                <div className="p-1 space-y-1 min-h-20">
                  {daySchedules.map((s: any) => (
                    <div key={s.id} className={`text-xs rounded px-1 py-0.5 truncate ${
                      s.attendance?.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                      s.attendance?.status === 'CLOCKED_IN' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {s.guard?.name?.slice(0, 4)}
                    </div>
                  ))}
                  {daySchedules.length === 0 && <div className="text-xs text-gray-200 text-center pt-3">—</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 配員追加モーダル */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">配員追加</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form) }} className="p-6 space-y-4">
              <div>
                <label className="form-label">日付 *</label>
                <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value, guardId: '' }))} className="form-input" required />
              </div>
              <div>
                <label className="form-label">
                  隊員 *
                  {availableGuards.length > 0 && <span className="ml-2 text-xs text-green-600">（{availableGuards.length}名空き）</span>}
                </label>
                <select value={form.guardId} onChange={e => setForm(f => ({ ...f, guardId: e.target.value }))} className="form-input" required>
                  <option value="">選択してください</option>
                  <optgroup label={`空き隊員（${availableGuards.length}名）`}>
                    {availableGuards.map((g: any) => (
                      <option key={g.id} value={g.id}>{g.name} ({g.employeeNumber})</option>
                    ))}
                  </optgroup>
                  <optgroup label="全隊員">
                    {guards.map((g: any) => <option key={g.id} value={g.id}>{g.name} ({g.employeeNumber})</option>)}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="form-label">現場 *</label>
                <select value={form.siteId} onChange={e => setForm(f => ({ ...f, siteId: e.target.value }))} className="form-input" required>
                  <option value="">選択してください</option>
                  {sites.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">開始時間 *</label>
                  <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">終了時間 *</label>
                  <input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} className="form-input" required />
                </div>
              </div>
              <div>
                <label className="form-label">メモ</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="form-input" rows={2} />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">キャンセル</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">追加</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
