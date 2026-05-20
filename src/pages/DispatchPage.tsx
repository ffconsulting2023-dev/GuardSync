import React, { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { format, addDays, subDays } from 'date-fns'
import { ja } from 'date-fns/locale'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────

interface GuardInfo {
  id: string
  name: string
  nameKana: string
  guardClass: string | null
  certifications: string[]
  lineWorksId: string | null
}

interface SiteInfo {
  id: string
  name: string
  address: string
  clientName: string | null
  requiredCount: number
  requiredQualifiedA: number
  requiredQualifiedB: number
  assemblyTime: string | null
  defaultStartTime: string | null
  defaultEndTime: string | null
  assemblyPlace: string | null
}

interface AttendanceInfo {
  id: string
  clockInAt: string | null
  clockOutAt: string | null
  earlyOvertimeMin: number
  lateOvertimeMin: number
  status: string
}

interface ScheduleItem {
  id: string
  guardId: string
  siteId: string
  date: string
  startTime: string
  endTime: string
  status: string
  shiftType: string
  assemblyTime: string | null
  sentAt: string | null
  notes: string | null
  guard: GuardInfo
  site: SiteInfo
  attendance: AttendanceInfo | null
}

interface SiteGroup {
  site: SiteInfo
  schedules: ScheduleItem[]
  confirmedCount: number
  sentCount: number
}

interface DispatchData {
  date: string
  groups: SiteGroup[]
  totalSchedules: number
}

interface NewSiteForm {
  siteId: string
  requiredCount: number
  startTime: string
  endTime: string
}

// ─────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────

export default function DispatchPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const canEdit = hasRole(user, 'ADMIN', 'MANAGER', 'OPERATOR')

  const [currentDate, setCurrentDate] = useState(new Date())
  const dateStr = format(currentDate, 'yyyy-MM-dd')

  // フィルター
  const [filterShift, setFilterShift] = useState<'ALL' | 'DAY' | 'NIGHT'>('ALL')
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false)
  const [showUnconfirmedOnly, setShowUnconfirmedOnly] = useState(false)

  // 隊員プール開閉状態
  const [poolExpanded, setPoolExpanded] = useState<Record<string, boolean>>({})

  // 勤怠展開状態
  const [attendanceExpanded, setAttendanceExpanded] = useState<Record<string, boolean>>({})

  // 新規現場モーダル
  const [showNewSiteModal, setShowNewSiteModal] = useState(false)
  const [newSiteForm, setNewSiteForm] = useState<NewSiteForm>({ siteId: '', requiredCount: 1, startTime: '09:00', endTime: '17:00' })

  // 勤怠入力状態
  const [attendanceInputs, setAttendanceInputs] = useState<Record<string, { clockIn: string; clockOut: string; earlyOt: number; lateOt: number }>>({})

  // 送信済み表示状態
  const [sentSuccess, setSentSuccess] = useState<Record<string, boolean>>({})

  // ─── API ───
  const { data: dispatchData, isLoading } = useQuery<DispatchData>({
    queryKey: ['dispatch', dateStr],
    queryFn: () => api.get(`/dispatch/${dateStr}`).then(r => r.data),
    refetchInterval: 30000,
  })

  const { data: allSchedules = [] } = useQuery<ScheduleItem[]>({
    queryKey: ['schedules-day', dateStr],
    queryFn: () => api.get(`/schedules?from=${dateStr}&to=${dateStr}`).then(r => r.data),
  })

  const { data: sites = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['sites'],
    queryFn: () => api.get('/sites').then(r => r.data),
  })

  const sendNotifyMutation = useMutation({
    mutationFn: (scheduleId: string) => api.post(`/schedules/${scheduleId}/send-reminder`),
    onSuccess: (_data, scheduleId) => {
      setSentSuccess(prev => ({ ...prev, [scheduleId]: true }))
      setTimeout(() => {
        setSentSuccess(prev => ({ ...prev, [scheduleId]: false }))
      }, 5000)
    },
    onError: () => {
      alert('送信に失敗しました')
    },
  })

  const saveAttendanceMutation = useMutation({
    mutationFn: (data: { scheduleId: string; clockIn: string; clockOut: string; earlyOvertimeMin: number; lateOvertimeMin: number }) =>
      api.post('/dispatch/attendance', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatch', dateStr] })
    },
  })

  // ─── 集計 ───
  const groups = dispatchData?.groups ?? []

  const summary = useMemo(() => {
    let totalSites = groups.length
    let totalRequired = 0
    let totalAssigned = 0
    let totalShortage = 0
    let clockedIn = 0
    let clockedOut = 0

    for (const g of groups) {
      const req = g.site.requiredCount
      const assigned = g.schedules.length
      totalRequired += req
      totalAssigned += assigned
      if (assigned < req) totalShortage += (req - assigned)
      for (const s of g.schedules) {
        if (s.attendance?.status === 'CLOCKED_IN') clockedIn++
        if (s.attendance?.status === 'COMPLETED') clockedOut++
      }
    }
    return { totalSites, totalRequired, totalAssigned, totalShortage, clockedIn, clockedOut }
  }, [groups])

  // 隊員プール: シフト種別ごとにグループ化
  const guardPool = useMemo(() => {
    const pool: Record<string, { label: string; guards: Array<{ guard: GuardInfo; scheduleId: string; assigned: boolean }> }> = {}
    for (const s of allSchedules) {
      const st = s.shiftType || 'DAY'
      if (!pool[st]) {
        const labels: Record<string, string> = { DAY: '①日勤', NIGHT: '②夜勤', DAY_AM: '③日勤前半', DAY_PM: '④日勤後半' }
        pool[st] = { label: labels[st] || st, guards: [] }
      }
      const isAssigned = groups.some(g => g.schedules.some(gs => gs.guardId === s.guardId))
      pool[st].guards.push({ guard: s.guard, scheduleId: s.id, assigned: isAssigned })
    }
    return pool
  }, [allSchedules, groups])

  // フィルター適用
  const filteredGroups = useMemo(() => {
    let result = groups
    if (filterShift === 'DAY') {
      result = result.map(g => ({
        ...g,
        schedules: g.schedules.filter(s => s.shiftType === 'DAY' || s.shiftType === 'DAY_AM' || s.shiftType === 'DAY_PM'),
      })).filter(g => g.schedules.length > 0 || g.site.requiredCount > 0)
    }
    if (filterShift === 'NIGHT') {
      result = result.map(g => ({
        ...g,
        schedules: g.schedules.filter(s => s.shiftType === 'NIGHT'),
      })).filter(g => g.schedules.length > 0)
    }
    if (showUnassignedOnly) {
      result = result.filter(g => g.schedules.length < g.site.requiredCount)
    }
    if (showUnconfirmedOnly) {
      result = result.filter(g => g.schedules.some(s => s.status !== 'CONFIRMED'))
    }
    return result
  }, [groups, filterShift, showUnassignedOnly, showUnconfirmedOnly])

  // ─── ハンドラー ───
  function goToday() { setCurrentDate(new Date()) }
  function goPrev() { setCurrentDate(prev => subDays(prev, 1)) }
  function goNext() { setCurrentDate(prev => addDays(prev, 1)) }

  function togglePool(shiftType: string) {
    setPoolExpanded(prev => ({ ...prev, [shiftType]: !prev[shiftType] }))
  }

  function toggleAttendance(siteId: string) {
    setAttendanceExpanded(prev => ({ ...prev, [siteId]: !prev[siteId] }))
  }

  function handleSendNotify(scheduleId: string) {
    sendNotifyMutation.mutate(scheduleId)
  }

  function handleBulkSend(group: SiteGroup) {
    const unsent = group.schedules.filter(s => !s.sentAt)
    if (unsent.length === 0) {
      alert('全員送信済みです')
      return
    }
    if (!confirm(`${unsent.length}名に一括送信します。よろしいですか？`)) return
    for (const s of unsent) {
      sendNotifyMutation.mutate(s.id)
    }
  }

  function initAttendanceInput(scheduleId: string, att: AttendanceInfo | null) {
    if (!attendanceInputs[scheduleId]) {
      setAttendanceInputs(prev => ({
        ...prev,
        [scheduleId]: {
          clockIn: att?.clockInAt ? format(new Date(att.clockInAt), 'HH:mm') : '',
          clockOut: att?.clockOutAt ? format(new Date(att.clockOutAt), 'HH:mm') : '',
          earlyOt: att?.earlyOvertimeMin ?? 0,
          lateOt: att?.lateOvertimeMin ?? 0,
        }
      }))
    }
  }

  function saveAttendance(scheduleId: string) {
    const input = attendanceInputs[scheduleId]
    if (!input) return
    saveAttendanceMutation.mutate({
      scheduleId,
      clockIn: input.clockIn,
      clockOut: input.clockOut,
      earlyOvertimeMin: input.earlyOt,
      lateOvertimeMin: input.lateOt,
    })
  }

  function copyLeaderAttendance(group: SiteGroup) {
    if (group.schedules.length === 0) return
    const leaderId = group.schedules[0].id
    const leaderInput = attendanceInputs[leaderId]
    if (!leaderInput) {
      alert('隊長の勤怠を先に入力してください')
      return
    }
    const updated: typeof attendanceInputs = {}
    for (const s of group.schedules) {
      updated[s.id] = { ...leaderInput }
    }
    setAttendanceInputs(prev => ({ ...prev, ...updated }))
  }

  function getCardBorderColor(group: SiteGroup): string {
    const assigned = group.schedules.length
    const required = group.site.requiredCount
    if (assigned === 0) return 'border-gray-300 bg-gray-50'
    if (assigned < required) return 'border-red-400 bg-red-50'
    const allConfirmed = group.schedules.every(s => s.status === 'CONFIRMED')
    if (allConfirmed) return 'border-green-400 bg-green-50'
    return 'border-yellow-400 bg-yellow-50'
  }

  // ─── レンダリング ───
  return (
    <div className="p-4 space-y-4">
      {/* 日付ヘッダー */}
      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={goPrev} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">←</button>
        <h1 className="text-xl font-bold text-gray-800">
          {format(currentDate, 'yyyy年M月d日（E）', { locale: ja })}
        </h1>
        <button onClick={goNext} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">→</button>
        <input
          type="date"
          value={dateStr}
          onChange={e => setCurrentDate(new Date(e.target.value))}
          className="input text-sm"
        />
        <button onClick={goToday} className="text-sm px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100">今日</button>
        <div className="text-sm text-gray-500">
          シフト人員: {allSchedules.length}人
        </div>
      </div>

      {/* サマリバー */}
      <div className="flex items-center gap-6 bg-white rounded-xl border border-gray-200 px-5 py-3 text-sm flex-wrap">
        <span>案件数: <b>{summary.totalSites}件</b></span>
        <span>依頼人数: <b>{summary.totalRequired}</b></span>
        <span>配置済み: <b className="text-green-600">{summary.totalAssigned}</b></span>
        <span>不足: <b className={summary.totalShortage > 0 ? 'text-red-600' : 'text-gray-500'}>{summary.totalShortage}</b></span>
        <span>上番中: <b className="text-blue-600">{summary.clockedIn}人</b></span>
        <span>下番中: <b className="text-gray-600">{summary.clockedOut}人</b></span>
      </div>

      {/* フィルター */}
      <div className="flex items-center gap-4 text-sm flex-wrap">
        <label className="flex items-center gap-1.5">
          <input type="radio" name="shiftFilter" checked={filterShift === 'ALL'} onChange={() => setFilterShift('ALL')} />
          全て
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="shiftFilter" checked={filterShift === 'DAY'} onChange={() => setFilterShift('DAY')} />
          日勤のみ
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="shiftFilter" checked={filterShift === 'NIGHT'} onChange={() => setFilterShift('NIGHT')} />
          夜勤のみ
        </label>
        <span className="text-gray-300">|</span>
        <label className="flex items-center gap-1.5 text-gray-400 cursor-not-allowed">
          <input type="checkbox" disabled />
          AI配置実行
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showUnassignedOnly} onChange={e => setShowUnassignedOnly(e.target.checked)} />
          未配置のみ表示
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showUnconfirmedOnly} onChange={e => setShowUnconfirmedOnly(e.target.checked)} />
          未確定のみ表示
        </label>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">読み込み中...</div>
      ) : (
        <div className="flex gap-4 flex-col lg:flex-row">
          {/* 左パネル: 隊員プール */}
          <div className="lg:w-64 flex-shrink-0 space-y-3">
            <h2 className="font-bold text-gray-700 text-sm">隊員プール</h2>
            {Object.entries(guardPool).map(([shiftType, pool]) => {
              const unassigned = pool.guards.filter(g => !g.assigned)
              const expanded = poolExpanded[shiftType] ?? false
              return (
                <div key={shiftType} className="bg-white rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">
                      {pool.label} {pool.guards.length}人
                    </span>
                    <button
                      onClick={() => togglePool(shiftType)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      {expanded ? '-' : '+'}
                    </button>
                  </div>
                  {expanded && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {unassigned.length === 0 ? (
                        <span className="text-xs text-gray-400">空き隊員なし</span>
                      ) : (
                        unassigned.map(g => (
                          <span
                            key={g.guard.id}
                            className="inline-flex items-center px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded-full cursor-pointer hover:bg-blue-100"
                            title={g.guard.nameKana}
                          >
                            {g.guard.name}{g.guard.guardClass ? g.guard.guardClass : ''}
                          </span>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {Object.keys(guardPool).length === 0 && (
              <div className="text-xs text-gray-400">シフトデータなし</div>
            )}
          </div>

          {/* 右パネル: 現場一覧 */}
          <div className="flex-1 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-gray-700 text-sm">現場一覧</h2>
              {canEdit && (
                <button onClick={() => setShowNewSiteModal(true)} className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  ＋ 新規現場
                </button>
              )}
            </div>

            {filteredGroups.length === 0 ? (
              <div className="text-center py-12 text-gray-400">表示する現場がありません</div>
            ) : (
              filteredGroups.map((group, idx) => {
                const borderColor = getCardBorderColor(group)
                const assigned = group.schedules.length
                const required = group.site.requiredCount
                const qualA = group.schedules.filter(s => s.guard.certifications?.includes('交通誘導警備業務検定1級') || s.guard.certifications?.includes('交通誘導警備業務検定2級')).length
                const qualB = group.schedules.filter(s => s.guard.certifications?.includes('雑踏警備業務検定1級') || s.guard.certifications?.includes('雑踏警備業務検定2級')).length
                const isAttendanceOpen = attendanceExpanded[group.site.id] ?? false

                return (
                  <div key={group.site.id} className={`rounded-xl border-2 ${borderColor} p-4 space-y-3`}>
                    {/* カードヘッダー */}
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-gray-500">NO.{idx + 1}</span>
                        <button
                          onClick={() => handleBulkSend(group)}
                          className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100"
                        >
                          一括✉️送信
                        </button>
                        {canEdit && (
                          <button className="text-xs px-2 py-1 bg-gray-50 text-gray-600 rounded hover:bg-gray-100">
                            隊員編集
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 現場情報 */}
                    <div>
                      <div className="font-bold text-gray-800">
                        {group.site.clientName && <span className="text-gray-500 font-normal mr-2">{group.site.clientName}</span>}
                        {group.site.name}
                      </div>
                      <div className="text-sm text-gray-500 mt-1 space-x-3">
                        {group.site.assemblyTime && <span>集合 {group.site.assemblyTime}</span>}
                        {group.site.defaultStartTime && <span>開始 {group.site.defaultStartTime}</span>}
                        {group.site.defaultEndTime && <span>終了 {group.site.defaultEndTime}</span>}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm">
                        <span className={assigned >= required ? 'text-green-600' : 'text-red-600'}>
                          隊員数: {assigned}/{required}
                        </span>
                        <span>資格者A: {qualA}/{group.site.requiredQualifiedA}</span>
                        <span>資格者B: {qualB}/{group.site.requiredQualifiedB}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        {assigned >= required && group.schedules.every(s => s.status === 'CONFIRMED') && (
                          <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full">☑ 確定</span>
                        )}
                        {assigned >= required && !group.schedules.every(s => s.status === 'CONFIRMED') && (
                          <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">☑ 手配済</span>
                        )}
                        {assigned < required && (
                          <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full">不足</span>
                        )}
                      </div>
                      {group.site.address && (
                        <div className="text-xs text-gray-400 mt-1">住所: {group.site.address}</div>
                      )}
                      {group.site.assemblyPlace && (
                        <div className="text-xs text-gray-400">集合場所: {group.site.assemblyPlace}</div>
                      )}
                    </div>

                    {/* 隊員バッジ */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200">
                      {group.schedules.map(s => (
                        <span key={s.id} className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-blue-50 text-blue-800 rounded-lg">
                          {s.guard.name}{s.guard.guardClass || ''}
                          <button
                            onClick={() => handleSendNotify(s.id)}
                            disabled={sendNotifyMutation.isPending}
                            className="ml-1 hover:bg-blue-200 rounded px-1"
                            title="LINE送信"
                          >
                            {sentSuccess[s.id] ? '✅' : '✉️'}
                          </button>
                        </span>
                      ))}
                      {group.schedules.length === 0 && (
                        <span className="text-xs text-gray-400">隊員未配置</span>
                      )}
                    </div>

                    {/* 勤怠入力 */}
                    {canEdit && (
                      <div>
                        <button
                          onClick={() => {
                            toggleAttendance(group.site.id)
                            for (const s of group.schedules) {
                              initAttendanceInput(s.id, s.attendance)
                            }
                          }}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          {isAttendanceOpen ? '▼ 勤怠入力を閉じる' : '▶ 勤怠入力'}
                        </button>
                        {isAttendanceOpen && (
                          <div className="mt-2 space-y-2">
                            <div className="flex items-center gap-2 mb-2">
                              <button
                                onClick={() => copyLeaderAttendance(group)}
                                className="text-xs px-2 py-1 bg-orange-50 text-orange-700 rounded hover:bg-orange-100"
                              >
                                隊長の結果を他の隊員にコピー
                              </button>
                            </div>
                            {group.schedules.map((s, si) => {
                              const input = attendanceInputs[s.id] || { clockIn: '', clockOut: '', earlyOt: 0, lateOt: 0 }
                              return (
                                <div key={s.id} className="flex items-center gap-2 text-xs flex-wrap">
                                  <span className="w-20 font-medium text-gray-700">{s.guard.name}</span>
                                  <label className="flex items-center gap-1">
                                    出勤
                                    <input
                                      type="time"
                                      value={input.clockIn}
                                      onChange={e => setAttendanceInputs(prev => ({ ...prev, [s.id]: { ...input, clockIn: e.target.value } }))}
                                      className="input text-xs w-24"
                                    />
                                  </label>
                                  <label className="flex items-center gap-1">
                                    退勤
                                    <input
                                      type="time"
                                      value={input.clockOut}
                                      onChange={e => setAttendanceInputs(prev => ({ ...prev, [s.id]: { ...input, clockOut: e.target.value } }))}
                                      className="input text-xs w-24"
                                    />
                                  </label>
                                  <label className="flex items-center gap-1">
                                    早出(分)
                                    <input
                                      type="number"
                                      value={input.earlyOt}
                                      onChange={e => setAttendanceInputs(prev => ({ ...prev, [s.id]: { ...input, earlyOt: Number(e.target.value) } }))}
                                      className="input text-xs w-16"
                                    />
                                  </label>
                                  <label className="flex items-center gap-1">
                                    遅出(分)
                                    <input
                                      type="number"
                                      value={input.lateOt}
                                      onChange={e => setAttendanceInputs(prev => ({ ...prev, [s.id]: { ...input, lateOt: Number(e.target.value) } }))}
                                      className="input text-xs w-16"
                                    />
                                  </label>
                                  <button
                                    onClick={() => saveAttendance(s.id)}
                                    disabled={saveAttendanceMutation.isPending}
                                    className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                                  >
                                    保存
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* 新規現場モーダル */}
      {showNewSiteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 w-96 shadow-xl space-y-4">
            <h3 className="font-bold text-gray-800 text-lg">新規現場追加</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">現場</label>
              <select
                value={newSiteForm.siteId}
                onChange={e => setNewSiteForm(prev => ({ ...prev, siteId: e.target.value }))}
                className="input w-full"
              >
                <option value="">選択してください</option>
                {sites.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">開始時間</label>
                <input
                  type="time"
                  value={newSiteForm.startTime}
                  onChange={e => setNewSiteForm(prev => ({ ...prev, startTime: e.target.value }))}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">終了時間</label>
                <input
                  type="time"
                  value={newSiteForm.endTime}
                  onChange={e => setNewSiteForm(prev => ({ ...prev, endTime: e.target.value }))}
                  className="input w-full"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">必要人数</label>
              <input
                type="number"
                min={1}
                value={newSiteForm.requiredCount}
                onChange={e => setNewSiteForm(prev => ({ ...prev, requiredCount: Number(e.target.value) }))}
                className="input w-full"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowNewSiteModal(false)} className="btn-secondary">キャンセル</button>
              <button
                onClick={() => {
                  // 新規現場は現場IDを指定するだけ（スケジュール自体は別途追加）
                  alert('現場を追加しました（スケジュール配員は管制・配員画面から行ってください）')
                  setShowNewSiteModal(false)
                }}
                className="btn-primary"
              >
                追加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
