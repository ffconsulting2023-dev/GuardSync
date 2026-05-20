import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { format, eachDayOfInterval, parseISO, addDays } from 'date-fns'
import { ja } from 'date-fns/locale'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────

interface ShiftTypeDef {
  type: string
  label: string
  startTime: string
  endTime: string
}

interface SurveyAnswer {
  date: string
  shiftType: string
  available: boolean
  note?: string
}

interface SurveyResponse {
  id: string
  surveyId: string
  guardId: string
  companyId: string
  answers: SurveyAnswer[]
  submittedAt: string | null
  guard: { id: string; name: string; nameKana: string }
}

interface ShiftSurvey {
  id: string
  companyId: string
  title: string
  shiftTypes: ShiftTypeDef[]
  startDate: string
  endDate: string
  answerStartAt: string
  answerEndAt: string
  isExported: boolean
  createdAt: string
  responses: SurveyResponse[]
}

interface Guard {
  id: string
  name: string
  nameKana: string
  isActive: boolean
}

type ViewMode = 'list' | 'detail' | 'form'

// ─────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────

export default function ShiftSurveyPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)

  // フォーム状態
  const [formTitle, setFormTitle] = useState('')
  const [formShiftTypes, setFormShiftTypes] = useState<ShiftTypeDef[]>([
    { type: 'DAY', label: '①日勤', startTime: '08:00', endTime: '17:00' },
  ])
  const [formStartDate, setFormStartDate] = useState('')
  const [formEndDate, setFormEndDate] = useState('')
  const [formAnswerStart, setFormAnswerStart] = useState('')
  const [formAnswerEnd, setFormAnswerEnd] = useState('')
  const [formTargetGuards, setFormTargetGuards] = useState<string[]>([])
  const [selectAll, setSelectAll] = useState(false)

  // ─── API ───
  const { data: surveys = [], isLoading } = useQuery<ShiftSurvey[]>({
    queryKey: ['shift-surveys'],
    queryFn: () => api.get('/shift-surveys').then(r => r.data),
  })

  const { data: surveyDetail, isLoading: detailLoading } = useQuery<ShiftSurvey>({
    queryKey: ['shift-surveys', selectedId],
    queryFn: () => api.get(`/shift-surveys/${selectedId}`).then(r => r.data),
    enabled: !!selectedId && viewMode === 'detail',
  })

  const { data: guards = [] } = useQuery<Guard[]>({
    queryKey: ['guards-active'],
    queryFn: () => api.get('/guards?isActive=true').then(r => r.data),
    enabled: viewMode === 'form',
  })

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/shift-surveys', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shift-surveys'] }); closeForm() },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.put(`/shift-surveys/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shift-surveys'] }); closeForm() },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/shift-surveys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-surveys'] }),
  })

  const exportMutation = useMutation({
    mutationFn: async (survey: ShiftSurvey) => {
      // 「○」の回答をスケジュールとして一括登録
      const schedules: Array<{ guardId: string; siteId?: string; date: string; startTime: string; endTime: string; shiftType: string }> = []
      for (const resp of survey.responses) {
        const answers = resp.answers as SurveyAnswer[]
        for (const ans of answers) {
          if (ans.available) {
            const st = survey.shiftTypes.find(s => s.type === ans.shiftType)
            if (st) {
              schedules.push({
                guardId: resp.guardId,
                date: ans.date,
                startTime: st.startTime,
                endTime: st.endTime,
                shiftType: ans.shiftType,
              })
            }
          }
        }
      }
      // 一括登録
      for (const s of schedules) {
        await api.post('/schedules', s)
      }
      // エクスポート済みフラグ
      await api.put(`/shift-surveys/${survey.id}`, { isExported: true })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift-surveys'] })
      qc.invalidateQueries({ queryKey: ['shift-surveys', selectedId] })
      alert('スケジュールにエクスポートしました')
    },
  })

  // ─── ヘルパー ───
  function closeForm() {
    setViewMode('list')
    setEditId(null)
    resetForm()
  }

  function resetForm() {
    setFormTitle('')
    setFormShiftTypes([{ type: 'DAY', label: '①日勤', startTime: '08:00', endTime: '17:00' }])
    setFormStartDate('')
    setFormEndDate('')
    setFormAnswerStart('')
    setFormAnswerEnd('')
    setFormTargetGuards([])
    setSelectAll(false)
  }

  function openCreate() {
    resetForm()
    setEditId(null)
    setViewMode('form')
  }

  function openEdit(survey: ShiftSurvey) {
    setEditId(survey.id)
    setFormTitle(survey.title)
    setFormShiftTypes(survey.shiftTypes)
    setFormStartDate(survey.startDate.split('T')[0])
    setFormEndDate(survey.endDate.split('T')[0])
    setFormAnswerStart(survey.answerStartAt.slice(0, 16))
    setFormAnswerEnd(survey.answerEndAt.slice(0, 16))
    setFormTargetGuards([])
    setViewMode('form')
  }

  function openDetail(id: string) {
    setSelectedId(id)
    setViewMode('detail')
  }

  function handleSubmit() {
    const data = {
      title: formTitle,
      shiftTypes: formShiftTypes,
      startDate: formStartDate,
      endDate: formEndDate,
      answerStartAt: formAnswerStart,
      answerEndAt: formAnswerEnd,
    }
    if (editId) {
      updateMutation.mutate({ id: editId, data })
    } else {
      createMutation.mutate(data)
    }
  }

  function handleDelete(id: string) {
    if (!confirm('このアンケートを削除しますか？')) return
    deleteMutation.mutate(id)
  }

  function handleExport(survey: ShiftSurvey) {
    if (!confirm('「○」の回答をスケジュールに一括登録します。よろしいですか？')) return
    exportMutation.mutate(survey)
  }

  function addShiftType() {
    const num = formShiftTypes.length + 1
    setFormShiftTypes([...formShiftTypes, { type: `TYPE_${num}`, label: `⑤シフト${num}`, startTime: '09:00', endTime: '18:00' }])
  }

  function removeShiftType(idx: number) {
    setFormShiftTypes(formShiftTypes.filter((_, i) => i !== idx))
  }

  function updateShiftType(idx: number, field: keyof ShiftTypeDef, value: string) {
    setFormShiftTypes(formShiftTypes.map((st, i) => i === idx ? { ...st, [field]: value } : st))
  }

  function toggleSelectAll() {
    if (selectAll) {
      setFormTargetGuards([])
    } else {
      setFormTargetGuards(guards.map(g => g.id))
    }
    setSelectAll(!selectAll)
  }

  function toggleGuard(id: string) {
    setFormTargetGuards(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    )
  }

  function getStatus(survey: ShiftSurvey): { label: string; className: string } {
    if (survey.isExported) return { label: 'エクスポート済み', className: 'bg-purple-100 text-purple-800' }
    const now = new Date()
    if (now < new Date(survey.answerStartAt)) return { label: '受付前', className: 'bg-gray-100 text-gray-800' }
    if (now > new Date(survey.answerEndAt)) return { label: '受付終了', className: 'bg-red-100 text-red-800' }
    return { label: '受付中', className: 'bg-green-100 text-green-800' }
  }

  // ─── 一覧ビュー ───
  if (viewMode === 'list') {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">シフトアンケート</h1>
          {canEdit && (
            <button onClick={openCreate} className="btn-primary">＋ 新規作成</button>
          )}
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-gray-500">読み込み中...</div>
        ) : surveys.length === 0 ? (
          <div className="text-center py-12 text-gray-400">アンケートがありません</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {surveys.map(s => {
              const status = getStatus(s)
              const answered = s.responses?.filter(r => r.submittedAt).length ?? 0
              const unanswered = (s.responses?.length ?? 0) - answered
              return (
                <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-semibold text-gray-800 text-lg">{s.title}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
                      {status.label}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500 space-y-1">
                    <p>回答期間: {format(new Date(s.answerStartAt), 'M/d HH:mm')} 〜 {format(new Date(s.answerEndAt), 'M/d HH:mm')}</p>
                    <p>対象期間: {format(new Date(s.startDate), 'M/d')} 〜 {format(new Date(s.endDate), 'M/d')}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">回答済み {answered}人</span>
                    <span className="text-xs bg-gray-50 text-gray-600 px-2 py-0.5 rounded-full">未回答 {unanswered}人</span>
                  </div>
                  <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100">
                    <button onClick={() => openDetail(s.id)} className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100">
                      詳細
                    </button>
                    {canEdit && (
                      <>
                        <button onClick={() => openEdit(s)} className="text-xs px-3 py-1.5 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100">
                          編集
                        </button>
                        <button onClick={() => handleDelete(s.id)} className="text-xs px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100">
                          削除
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ─── 詳細ビュー ───
  if (viewMode === 'detail' && surveyDetail) {
    return <SurveyDetailView survey={surveyDetail} onBack={() => setViewMode('list')} onExport={handleExport} canEdit={canEdit} />
  }
  if (viewMode === 'detail' && detailLoading) {
    return <div className="p-6 text-center text-gray-500">読み込み中...</div>
  }

  // ─── フォームビュー ───
  return (
    <div className="p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">
            {editId ? 'アンケート編集' : 'アンケート新規作成'}
          </h1>
          <button onClick={closeForm} className="text-sm text-gray-500 hover:text-gray-700">✕ 閉じる</button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          {/* タイトル */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">タイトル</label>
            <input
              type="text"
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              placeholder="例: 6月前半シフト希望調査"
              className="input w-full"
            />
          </div>

          {/* シフト種別定義 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">シフト種別定義</label>
            <div className="space-y-2">
              {formShiftTypes.map((st, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={st.label}
                    onChange={e => updateShiftType(idx, 'label', e.target.value)}
                    placeholder="種別ラベル"
                    className="input flex-1"
                  />
                  <input
                    type="time"
                    value={st.startTime}
                    onChange={e => updateShiftType(idx, 'startTime', e.target.value)}
                    className="input w-32"
                  />
                  <span className="text-gray-400">〜</span>
                  <input
                    type="time"
                    value={st.endTime}
                    onChange={e => updateShiftType(idx, 'endTime', e.target.value)}
                    className="input w-32"
                  />
                  {formShiftTypes.length > 1 && (
                    <button onClick={() => removeShiftType(idx)} className="text-red-400 hover:text-red-600 px-2">✕</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addShiftType} className="mt-2 text-sm text-blue-600 hover:text-blue-800">
              ＋ シフト追加
            </button>
          </div>

          {/* 対象期間 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">対象開始日</label>
              <input type="date" value={formStartDate} onChange={e => setFormStartDate(e.target.value)} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">対象終了日</label>
              <input type="date" value={formEndDate} onChange={e => setFormEndDate(e.target.value)} className="input w-full" />
            </div>
          </div>

          {/* 回答期間 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">回答開始日時</label>
              <input type="datetime-local" value={formAnswerStart} onChange={e => setFormAnswerStart(e.target.value)} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">回答終了日時</label>
              <input type="datetime-local" value={formAnswerEnd} onChange={e => setFormAnswerEnd(e.target.value)} className="input w-full" />
            </div>
          </div>

          {/* 送付対象 */}
          {!editId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">送付対象</label>
              <div className="border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                <label className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-100">
                  <input type="checkbox" checked={selectAll} onChange={toggleSelectAll} className="rounded" />
                  <span className="text-sm font-medium text-gray-700">全選択</span>
                </label>
                {guards.map(g => (
                  <label key={g.id} className="flex items-center gap-2 py-1">
                    <input
                      type="checkbox"
                      checked={formTargetGuards.includes(g.id)}
                      onChange={() => toggleGuard(g.id)}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700">{g.name}</span>
                    <span className="text-xs text-gray-400">{g.nameKana}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ボタン */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button onClick={closeForm} className="btn-secondary">キャンセル</button>
            <button
              onClick={handleSubmit}
              disabled={!formTitle || !formStartDate || !formEndDate || createMutation.isPending || updateMutation.isPending}
              className="btn-primary"
            >
              {createMutation.isPending || updateMutation.isPending ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 詳細ビューコンポーネント
// ─────────────────────────────────────────────

function SurveyDetailView({
  survey,
  onBack,
  onExport,
  canEdit,
}: {
  survey: ShiftSurvey
  onBack: () => void
  onExport: (s: ShiftSurvey) => void
  canEdit: boolean
}) {
  const dates = useMemo(() => {
    const start = parseISO(survey.startDate.split('T')[0])
    const end = parseISO(survey.endDate.split('T')[0])
    return eachDayOfInterval({ start, end })
  }, [survey.startDate, survey.endDate])

  const shiftTypes = survey.shiftTypes as ShiftTypeDef[]

  // 回答マップ: guardId -> { "2026-05-20_DAY": true/false }
  const answerMap = useMemo(() => {
    const map: Record<string, Record<string, boolean | null>> = {}
    for (const resp of survey.responses) {
      map[resp.guardId] = {}
      const answers = resp.answers as SurveyAnswer[]
      for (const a of answers) {
        map[resp.guardId][`${a.date}_${a.shiftType}`] = a.available
      }
    }
    return map
  }, [survey.responses])

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700">← 戻る</button>
        <h1 className="text-2xl font-bold text-gray-800">{survey.title}</h1>
        {survey.isExported && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">エクスポート済み</span>
        )}
      </div>

      <div className="flex items-center gap-6 text-sm text-gray-500">
        <span>対象期間: {format(new Date(survey.startDate), 'yyyy/M/d')} 〜 {format(new Date(survey.endDate), 'yyyy/M/d')}</span>
        <span>回答期間: {format(new Date(survey.answerStartAt), 'yyyy/M/d HH:mm')} 〜 {format(new Date(survey.answerEndAt), 'yyyy/M/d HH:mm')}</span>
      </div>

      <div className="flex items-center gap-3">
        {canEdit && !survey.isExported && (
          <button onClick={() => onExport(survey)} className="btn-primary text-sm">
            シフトにエクスポート
          </button>
        )}
        <button className="btn-secondary text-sm" onClick={() => alert('LINE送信機能は準備中です')}>
          全員に送信 ✉️
        </button>
      </div>

      {/* 回答状況テーブル */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="text-xs w-full">
          <thead>
            <tr className="bg-gray-50">
              <th className="sticky left-0 bg-gray-50 z-10 px-3 py-2 text-left font-medium text-gray-700 border-b border-r border-gray-200 min-w-[120px]">
                隊員名
              </th>
              {dates.map(d => (
                <th
                  key={d.toISOString()}
                  className="px-2 py-2 text-center font-medium text-gray-700 border-b border-gray-200 min-w-[60px]"
                >
                  <div>{format(d, 'M/d')}</div>
                  <div className="text-gray-400">{format(d, 'E', { locale: ja })}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {survey.responses.length === 0 ? (
              <tr>
                <td colSpan={dates.length + 1} className="text-center py-8 text-gray-400">回答がありません</td>
              </tr>
            ) : (
              survey.responses.map(resp => (
                <tr key={resp.guardId} className="hover:bg-gray-50">
                  <td className="sticky left-0 bg-white z-10 px-3 py-2 font-medium text-gray-800 border-b border-r border-gray-200 whitespace-nowrap">
                    {resp.guard.name}
                  </td>
                  {dates.map(d => {
                    const dateStr = format(d, 'yyyy-MM-dd')
                    const guardAnswers = answerMap[resp.guardId] || {}
                    const hasAny = shiftTypes.some(st => guardAnswers[`${dateStr}_${st.type}`] !== undefined)
                    return (
                      <td key={d.toISOString()} className="px-1 py-1 text-center border-b border-gray-100 align-top">
                        {!hasAny ? (
                          <span className="text-gray-300">-</span>
                        ) : (
                          <div className="space-y-0.5">
                            {shiftTypes.map((st, si) => {
                              const val = guardAnswers[`${dateStr}_${st.type}`]
                              if (val === undefined || val === null) return (
                                <div key={si} className="text-gray-300">-</div>
                              )
                              return (
                                <div key={si} className={val ? 'text-green-600 font-bold' : 'text-red-500'}>
                                  {si + 1}{val ? '○' : '×'}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 凡例 */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span>凡例:</span>
        {shiftTypes.map((st, i) => (
          <span key={i}>{i + 1}: {st.label} ({st.startTime}-{st.endTime})</span>
        ))}
        <span className="text-green-600 font-bold">○ 可能</span>
        <span className="text-red-500">× 不可</span>
        <span className="text-gray-300">- 未回答</span>
      </div>
    </div>
  )
}
