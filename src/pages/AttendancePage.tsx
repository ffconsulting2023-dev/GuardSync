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
  // attendanceId → 'in' | 'out' | null（修正モード管理）
  const [editMode, setEditMode] = useState<Record<string, 'in' | 'out' | null>>({})
  // 修正用時刻入力（attendanceId → HH:mm）
  const [editTimes, setEditTimes] = useState<Record<string, string>>({})

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

  const updateAttendanceMutation = useMutation({
    mutationFn: ({ attendanceId, clockInTime, clockOutTime }: { attendanceId: string; clockInTime?: string; clockOutTime?: string }) =>
      api.put(`/attendance/${attendanceId}`, { clockInTime, clockOutTime }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['schedules'] })
      setEditMode(prev => ({ ...prev, [vars.attendanceId]: null }))
    },
  })

  const openEdit = (attendanceId: string, type: 'in' | 'out', currentTime: string) => {
    setEditMode(prev => ({ ...prev, [attendanceId]: type }))
    setEditTimes(prev => ({ ...prev, [`${attendanceId}_${type}`]: currentTime }))
  }

  const cancelEdit = (attendanceId: string) => {
    setEditMode(prev => ({ ...prev, [attendanceId]: null }))
  }

  const submitEdit = (attendanceId: string, type: 'in' | 'out') => {
    const time = editTimes[`${attendanceId}_${type}`]
    if (!time) return
    updateAttendanceMutation.mutate({
      attendanceId,
      clockInTime: type === 'in' ? time : undefined,
      clockOutTime: type === 'out' ? time : undefined,
    })
  }

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
        <>
          {schedules.length === 0 ? (
            <div className="card text-center py-12 text-gray-400">この日の出動予定はありません</div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
              {schedules.map((s: any) => {
                const { label, className, canClockIn, canClockOut } = getStatusInfo(s)
                const ts = timeStates[s.id] ?? { clockInTime: s.startTime ?? '', clockOutTime: s.endTime ?? '', breakMinutes: '60' }
                const overtime = calcOvertime(s, ts)
                const aid = s.attendance?.id

                return (
                  <div key={s.id} className="card p-3 space-y-2 text-xs">

                    {/* ── 行1: 名前 / 現場 / ステータス / 依頼時間 ── */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-800">{s.guard?.name}</span>
                      <span className={`badge ${className}`}>{label}</span>
                      <span className="text-gray-400 truncate">{s.site?.name}</span>
                      <span className="ml-auto font-mono text-gray-500 shrink-0">{s.startTime}〜{s.endTime}</span>
                    </div>

                    {/* ── 行2: 実打刻（打刻済みの場合）── */}
                    {s.attendance?.clockInAt && (
                      <div className="flex items-center gap-3 flex-wrap border-t border-gray-50 pt-2">
                        {/* 出勤 */}
                        {editMode[aid] === 'in' ? (
                          <div className="flex items-center gap-1">
                            <span className="text-gray-400 w-8 shrink-0">出勤</span>
                            <input type="time" value={editTimes[`${aid}_in`] ?? ''} autoFocus
                              onChange={e => setEditTimes(prev => ({ ...prev, [`${aid}_in`]: e.target.value }))}
                              className="form-input py-0.5 w-24 text-xs font-mono" />
                            <button onClick={() => submitEdit(aid, 'in')} disabled={updateAttendanceMutation.isPending}
                              className="bg-blue-600 text-white px-2 py-0.5 rounded text-[10px] disabled:opacity-50">保存</button>
                            <button onClick={() => cancelEdit(aid)} className="text-gray-300 hover:text-gray-500">✕</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="text-gray-400">出勤</span>
                            <span className="font-mono font-semibold text-blue-600">{format(new Date(s.attendance.clockInAt), 'HH:mm')}</span>
                            {canEdit && (
                              <button onClick={() => openEdit(aid, 'in', format(new Date(s.attendance.clockInAt), 'HH:mm'))}
                                className="text-gray-300 hover:text-blue-400" title="修正">✏️</button>
                            )}
                          </div>
                        )}
                        {/* 退勤 */}
                        {s.attendance.clockOutAt && (
                          editMode[aid] === 'out' ? (
                            <div className="flex items-center gap-1">
                              <span className="text-gray-400 w-8 shrink-0">退勤</span>
                              <input type="time" value={editTimes[`${aid}_out`] ?? ''} autoFocus
                                onChange={e => setEditTimes(prev => ({ ...prev, [`${aid}_out`]: e.target.value }))}
                                className="form-input py-0.5 w-24 text-xs font-mono" />
                              <button onClick={() => submitEdit(aid, 'out')} disabled={updateAttendanceMutation.isPending}
                                className="bg-green-600 text-white px-2 py-0.5 rounded text-[10px] disabled:opacity-50">保存</button>
                              <button onClick={() => cancelEdit(aid)} className="text-gray-300 hover:text-gray-500">✕</button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <span className="text-gray-400">退勤</span>
                              <span className="font-mono font-semibold text-green-600">{format(new Date(s.attendance.clockOutAt), 'HH:mm')}</span>
                              {canEdit && (
                                <button onClick={() => openEdit(aid, 'out', format(new Date(s.attendance.clockOutAt), 'HH:mm'))}
                                  className="text-gray-300 hover:text-green-400" title="修正">✏️</button>
                              )}
                            </div>
                          )
                        )}
                        {/* 時間外インライン表示 */}
                        {overtime && overtime.totalOT > 0 && (
                          <span className="ml-auto text-red-500 font-semibold shrink-0">時間外 {minToHHMM(overtime.totalOT)}</span>
                        )}
                        {overtime && overtime.totalOT === 0 && (
                          <span className="ml-auto text-gray-300 shrink-0">実働 {minToHHMM(overtime.actualWorkMin)}</span>
                        )}
                      </div>
                    )}

                    {/* ── 打刻フォーム ── */}
                    {canEdit && (canClockIn || canClockOut) && (
                      <div className="flex items-center gap-2 flex-wrap border-t border-gray-50 pt-2">
                        <input type="time"
                          value={canClockIn ? ts.clockInTime : ts.clockOutTime}
                          onChange={e => setField(s.id, canClockIn ? 'clockInTime' : 'clockOutTime', e.target.value)}
                          className="form-input py-1 w-24 text-xs font-mono" />
                        {canClockOut && (
                          <>
                            <span className="text-gray-400">休憩</span>
                            <input type="number" value={ts.breakMinutes}
                              onChange={e => setField(s.id, 'breakMinutes', e.target.value)}
                              className="form-input py-1 w-14 text-xs" min="0" step="15" />
                            <span className="text-gray-400">分</span>
                          </>
                        )}
                        {canClockIn && (
                          <button onClick={() => clockInMutation.mutate({ scheduleId: s.id, clockInTime: ts.clockInTime })}
                            disabled={clockInMutation.isPending}
                            className="bg-blue-600 text-white text-xs px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
                            出勤打刻
                          </button>
                        )}
                        {canClockOut && (
                          <button onClick={() => clockOutMutation.mutate({ scheduleId: s.id, clockOutTime: ts.clockOutTime, breakMinutes: Number(ts.breakMinutes) || 0 })}
                            disabled={clockOutMutation.isPending}
                            className="bg-green-600 text-white text-xs px-3 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50 whitespace-nowrap">
                            退勤打刻
                          </button>
                        )}
                      </div>
                    )}

                    {/* ── 時間外詳細（退勤済み・時間外あり）── */}
                    {overtime && overtime.totalOT > 0 && (
                      <div className="flex gap-2 flex-wrap border-t border-gray-50 pt-2">
                        <span className="bg-gray-50 rounded px-2 py-0.5 text-gray-500">実働 {minToHHMM(overtime.actualWorkMin)}</span>
                        <span className="bg-gray-50 rounded px-2 py-0.5 text-gray-500">所定 {minToHHMM(overtime.scheduledWorkMin)}</span>
                        {overtime.earlyOT > 0 && <span className="bg-orange-50 rounded px-2 py-0.5 text-orange-600">早出 {minToHHMM(overtime.earlyOT)}</span>}
                        {overtime.lateOT > 0 && <span className="bg-red-50 rounded px-2 py-0.5 text-red-600">遅出 {minToHHMM(overtime.lateOT)}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
