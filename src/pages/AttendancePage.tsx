import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { format } from 'date-fns'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

// HH:mm → 分数
function timeToMin(t: string): number {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// 分数 → "X時間Y分" 表示
function minToHHMM(min: number): string {
  if (min <= 0) return '0分'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? (m > 0 ? `${h}時間${m}分` : `${h}時間`) : `${m}分`
}

interface TimeState {
  clockInTime: string
  clockOutTime: string
  breakMinutes: string
}

export default function AttendancePage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const canEdit = hasRole(user, 'ADMIN', 'MANAGER', 'OPERATOR')

  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  // scheduleId → 時刻入力state
  const [timeStates, setTimeStates] = useState<Record<string, TimeState>>({})

  const { data: schedules = [], isLoading } = useQuery({
    queryKey: ['schedules', date],
    queryFn: () => api.get(`/schedules?from=${date}&to=${date}`).then(r => r.data),
  })

  // スケジュール読み込み時に現場時間で初期化
  useEffect(() => {
    if (!schedules.length) return
    setTimeStates(prev => {
      const next: Record<string, TimeState> = { ...prev }
      for (const s of schedules) {
        if (!next[s.id]) {
          next[s.id] = {
            clockInTime: s.startTime ?? '',
            clockOutTime: s.endTime ?? '',
            breakMinutes: '60',
          }
        }
      }
      return next
    })
  }, [schedules])

  const setField = (scheduleId: string, field: keyof TimeState, value: string) => {
    setTimeStates(prev => ({
      ...prev,
      [scheduleId]: { ...prev[scheduleId], [field]: value },
    }))
  }

  const clockInMutation = useMutation({
    mutationFn: ({ scheduleId, clockInTime }: { scheduleId: string; clockInTime: string }) =>
      api.post('/attendance/clock-in', { scheduleId, clockInTime }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  })

  const clockOutMutation = useMutation({
    mutationFn: ({ scheduleId, clockOutTime, breakMinutes }: { scheduleId: string; clockOutTime: string; breakMinutes: number }) =>
      api.post('/attendance/clock-out', { scheduleId, clockOutTime, breakMinutes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  })

  const getStatusInfo = (s: any) => {
    if (!s.attendance) return { label: '未出勤', className: 'badge-gray', canClockIn: true, canClockOut: false }
    if (s.attendance.status === 'CLOCKED_IN') return { label: '出勤中', className: 'badge-info', canClockIn: false, canClockOut: true }
    if (s.attendance.status === 'COMPLETED') return { label: '退勤済み', className: 'badge-success', canClockIn: false, canClockOut: false }
    return { label: s.attendance.status, className: 'badge-gray', canClockIn: false, canClockOut: false }
  }

  // 時間外計算（画面表示用）
  const calcOvertime = (s: any, ts: TimeState) => {
    if (!s.attendance?.clockOutAt) return null

    const inAt = new Date(s.attendance.clockInAt)
    const outAt = new Date(s.attendance.clockOutAt)
    const break_ = s.attendance.breakMinutes || 0

    const actualWorkMin = Math.round((outAt.getTime() - inAt.getTime()) / 60000) - break_
    const scheduledWorkMin = timeToMin(s.endTime) - timeToMin(s.startTime)
    const earlyOT = s.attendance.earlyOvertimeMin || 0
    const lateOT = s.attendance.lateOvertimeMin || 0
    const totalOT = earlyOT + lateOT

    return { actualWorkMin, scheduledWorkMin, earlyOT, lateOT, totalOT }
  }

  const completedCount = schedules.filter((s: any) => s.attendance?.status === 'COMPLETED').length
  const clockedInCount = schedules.filter((s: any) => s.attendance?.status === 'CLOCKED_IN').length

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-800">出退勤管理</h1>
        <div className="flex items-center gap-2">
          <a
            href={`${import.meta.env.VITE_API_URL || ''}/api/export/attendance?from=${date}&to=${date}`}
            download
            className="btn-secondary text-sm"
          >⬇ CSV</a>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="form-input w-auto" />
        </div>
      </div>

      {/* サマリー */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center py-3">
          <p className="text-2xl font-bold text-gray-800">{schedules.length}</p>
          <p className="text-xs text-gray-500">出動予定</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-2xl font-bold text-blue-600">{clockedInCount}</p>
          <p className="text-xs text-gray-500">出勤中</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-2xl font-bold text-green-600">{completedCount}</p>
          <p className="text-xs text-gray-500">退勤済み</p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="space-y-3">
          {schedules.length === 0 ? (
            <div className="card text-center py-12 text-gray-400">この日の出動予定はありません</div>
          ) : (
            schedules.map((s: any) => {
              const { label, className, canClockIn, canClockOut } = getStatusInfo(s)
              const ts = timeStates[s.id] ?? { clockInTime: s.startTime ?? '', clockOutTime: s.endTime ?? '', breakMinutes: '60' }
              const overtime = calcOvertime(s, ts)

              return (
                <div key={s.id} className="card space-y-3">
                  {/* 上段：隊員・現場・ステータス */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-800">{s.guard?.name}</p>
                        <span className={`badge ${className}`}>{label}</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5">{s.site?.name}</p>
                      {/* 依頼時間 */}
                      <p className="text-xs text-gray-400 mt-0.5">
                        依頼時間: <span className="font-mono font-medium text-gray-600">{s.startTime}〜{s.endTime}</span>
                      </p>
                    </div>
                    {/* 実打刻表示（完了後） */}
                    {s.attendance?.clockInAt && (
                      <div className="text-right text-xs shrink-0">
                        <p className="text-blue-600">
                          出勤 <span className="font-mono font-semibold">{format(new Date(s.attendance.clockInAt), 'HH:mm')}</span>
                        </p>
                        {s.attendance.clockOutAt && (
                          <p className="text-green-600">
                            退勤 <span className="font-mono font-semibold">{format(new Date(s.attendance.clockOutAt), 'HH:mm')}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 打刻フォーム */}
                  {canEdit && (canClockIn || canClockOut) && (
                    <div className="border-t border-gray-100 pt-3">
                      {canClockIn && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-gray-500 w-16 shrink-0">出勤時刻</span>
                          <input
                            type="time"
                            value={ts.clockInTime}
                            onChange={e => setField(s.id, 'clockInTime', e.target.value)}
                            className="form-input w-32 text-sm font-mono"
                          />
                          <button
                            onClick={() => clockInMutation.mutate({ scheduleId: s.id, clockInTime: ts.clockInTime })}
                            disabled={clockInMutation.isPending}
                            className="bg-blue-600 text-white text-xs px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                          >
                            出勤打刻
                          </button>
                        </div>
                      )}
                      {canClockOut && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-gray-500 w-16 shrink-0">退勤時刻</span>
                            <input
                              type="time"
                              value={ts.clockOutTime}
                              onChange={e => setField(s.id, 'clockOutTime', e.target.value)}
                              className="form-input w-32 text-sm font-mono"
                            />
                            <span className="text-xs text-gray-500">休憩</span>
                            <input
                              type="number"
                              value={ts.breakMinutes}
                              onChange={e => setField(s.id, 'breakMinutes', e.target.value)}
                              className="form-input w-20 text-sm"
                              min="0"
                              step="15"
                              placeholder="60"
                            />
                            <span className="text-xs text-gray-400">分</span>
                            <button
                              onClick={() => clockOutMutation.mutate({
                                scheduleId: s.id,
                                clockOutTime: ts.clockOutTime,
                                breakMinutes: Number(ts.breakMinutes) || 0,
                              })}
                              disabled={clockOutMutation.isPending}
                              className="bg-green-600 text-white text-xs px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
                            >
                              退勤打刻
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 時間外労働サマリー（退勤済み） */}
                  {overtime && (
                    <div className="border-t border-gray-100 pt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
                        <p className="text-gray-400">実労働時間</p>
                        <p className="font-semibold text-gray-700">{minToHHMM(overtime.actualWorkMin)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
                        <p className="text-gray-400">所定時間</p>
                        <p className="font-semibold text-gray-700">{minToHHMM(overtime.scheduledWorkMin)}</p>
                      </div>
                      <div className={`rounded-lg px-3 py-2 text-center ${overtime.earlyOT > 0 ? 'bg-orange-50' : 'bg-gray-50'}`}>
                        <p className="text-gray-400">早出残業</p>
                        <p className={`font-semibold ${overtime.earlyOT > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                          {overtime.earlyOT > 0 ? minToHHMM(overtime.earlyOT) : '—'}
                        </p>
                      </div>
                      <div className={`rounded-lg px-3 py-2 text-center ${overtime.lateOT > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                        <p className="text-gray-400">遅出残業</p>
                        <p className={`font-semibold ${overtime.lateOT > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                          {overtime.lateOT > 0 ? minToHHMM(overtime.lateOT) : '—'}
                        </p>
                      </div>
                      {overtime.totalOT > 0 && (
                        <div className="col-span-2 md:col-span-4 bg-red-50 border border-red-100 rounded-lg px-3 py-2 flex items-center justify-between">
                          <span className="text-red-600 font-medium">合計時間外労働</span>
                          <span className="text-red-700 font-bold">{minToHHMM(overtime.totalOT)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
