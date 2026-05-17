import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { format } from 'date-fns'

export default function AttendancePage() {
  const qc = useQueryClient()
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  const { data: schedules = [], isLoading } = useQuery({
    queryKey: ['schedules', date],
    queryFn: () => api.get(`/schedules?from=${date}&to=${date}`).then(r => r.data),
  })

  const clockInMutation = useMutation({
    mutationFn: (scheduleId: string) => api.post('/attendance/clock-in', { scheduleId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  })

  const clockOutMutation = useMutation({
    mutationFn: ({ scheduleId, breakMinutes }: { scheduleId: string; breakMinutes: number }) =>
      api.post('/attendance/clock-out', { scheduleId, breakMinutes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  })

  const getStatusInfo = (s: any) => {
    if (!s.attendance) return { label: '未出勤', className: 'badge-gray', canClockIn: true, canClockOut: false }
    if (s.attendance.status === 'CLOCKED_IN') return { label: '出勤中', className: 'badge-info', canClockIn: false, canClockOut: true }
    if (s.attendance.status === 'COMPLETED') return { label: '退勤済み', className: 'badge-success', canClockIn: false, canClockOut: false }
    return { label: s.attendance.status, className: 'badge-gray', canClockIn: false, canClockOut: false }
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
        <div className="space-y-2">
          {schedules.length === 0 ? (
            <div className="card text-center py-12 text-gray-400">この日の出動予定はありません</div>
          ) : (
            schedules.map((s: any) => {
              const { label, className, canClockIn, canClockOut } = getStatusInfo(s)
              return (
                <div key={s.id} className="card flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-800">{s.guard?.name}</p>
                      <span className={`badge ${className}`}>{label}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">{s.site?.name}</p>
                    <p className="text-xs text-gray-400">{s.startTime}〜{s.endTime}</p>
                    {s.attendance?.clockInAt && (
                      <p className="text-xs text-blue-600">
                        出勤: {format(new Date(s.attendance.clockInAt), 'HH:mm')}
                        {s.attendance?.clockOutAt && ` / 退勤: ${format(new Date(s.attendance.clockOutAt), 'HH:mm')}`}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    {canClockIn && (
                      <button
                        onClick={() => clockInMutation.mutate(s.id)}
                        disabled={clockInMutation.isPending}
                        className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                      >
                        出勤打刻
                      </button>
                    )}
                    {canClockOut && (
                      <button
                        onClick={() => clockOutMutation.mutate({ scheduleId: s.id, breakMinutes: 60 })}
                        disabled={clockOutMutation.isPending}
                        className="bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
                      >
                        退勤打刻
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
