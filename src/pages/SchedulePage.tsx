import React, { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { format, addDays, subDays } from 'date-fns'
import { ja } from 'date-fns/locale'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'
import { SCHEDULE_STATUS } from '../lib/constants'

const STATUS_LABELS = SCHEDULE_STATUS

// 警備業務資格の略語変換マップ
const CERT_ABBR: Record<string, string> = {
  // 交通誘導
  '交通誘導警備業務検定1級': '交通1級',
  '交通誘導警備業務検定2級': '交通2級',
  '交通誘導1級': '交通1級',
  '交通誘導2級': '交通2級',
  // 施設警備
  '施設警備業務検定1級': '施設1級',
  '施設警備業務検定2級': '施設2級',
  '施設警備1級': '施設1級',
  '施設警備2級': '施設2級',
  // 雑踏警備
  '雑踏警備業務検定1級': '雑踏1級',
  '雑踏警備業務検定2級': '雑踏2級',
  '雑踏警備1級': '雑踏1級',
  '雑踏警備2級': '雑踏2級',
  // 貴重品運搬
  '貴重品運搬警備業務検定1級': '貴重1級',
  '貴重品運搬警備業務検定2級': '貴重2級',
  '貴重品運搬1級': '貴重1級',
  '貴重品運搬2級': '貴重2級',
  // 核燃料
  '核燃料物質等危険物運搬警備業務検定1級': '核燃1級',
  '核燃料物質等危険物運搬警備業務検定2級': '核燃2級',
  // 空港保安
  '空港保安警備業務検定1級': '空港1級',
  '空港保安警備業務検定2級': '空港2級',
  '空港保安1級': '空港1級',
  '空港保安2級': '空港2級',
  // 機械警備
  '機械警備業務管理者': '機械警備',
  // その他よくある表記
  '警備業務検定1級': '検定1級',
  '警備業務検定2級': '検定2級',
}

function abbreviateCert(cert: string): string {
  if (CERT_ABBR[cert]) return CERT_ABBR[cert]
  // 部分一致フォールバック：長すぎる場合は先頭4文字+…
  return cert.length > 6 ? cert.slice(0, 5) + '…' : cert
}

// ─── 隊員アバター（写真 or 頭文字）───────────────────────────
function GuardAvatar({ guardId, name, hasPhoto, size = 'md' }: {
  guardId: string; name: string; hasPhoto: boolean; size?: 'sm' | 'md' | 'lg'
}) {
  const [src, setSrc] = useState<string | null>(null)
  const sizeClass = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-14 h-14 text-lg' : 'w-10 h-10 text-sm'

  useEffect(() => {
    if (!hasPhoto) return
    const token = localStorage.getItem('token')
    fetch(`/api/guards/${guardId}/photo`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => {
      if (!r.ok) return
      return r.blob()
    }).then(blob => {
      if (blob) setSrc(URL.createObjectURL(blob))
    }).catch(() => {})
    return () => { if (src) URL.revokeObjectURL(src) }
  }, [guardId, hasPhoto])

  const initials = name.slice(0, 1)

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`${sizeClass} rounded-full object-cover flex-shrink-0 border-2 border-white shadow`}
      />
    )
  }
  return (
    <div className={`${sizeClass} rounded-full bg-[#1e3a5f] text-white flex items-center justify-center flex-shrink-0 font-bold shadow`}>
      {initials}
    </div>
  )
}

// ─── 配員確認モーダル ─────────────────────────────────────────
interface AssignModalProps {
  guard: any
  site: any
  date: string
  contracts: any[]
  onClose: () => void
  onConfirm: (data: { startTime: string; endTime: string; contractId: string }) => void
  isPending: boolean
}

function AssignModal({ guard, site, date, contracts, onClose, onConfirm, isPending }: AssignModalProps) {
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [contractId, setContractId] = useState('')

  // 現場に紐づく有効契約
  const siteContracts = contracts.filter((c: any) => c.siteId === site.id && c.status === 'ACTIVE')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <GuardAvatar guardId={guard.id} name={guard.name} hasPhoto={guard.hasPhoto} size="md" />
          <div>
            <p className="font-semibold text-gray-800">{guard.name}</p>
            <p className="text-xs text-gray-400">{guard.nearestStation1 && `${guard.nearestStation1}駅`}</p>
          </div>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="bg-blue-50 rounded-lg px-3 py-2 text-sm">
            <span className="text-blue-600 font-medium">📍 {site.name}</span>
            <span className="text-gray-400 mx-2">›</span>
            <span className="text-gray-600">{format(new Date(date), 'M月d日(E)', { locale: ja })}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">開始時間 *</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="form-label">終了時間 *</label>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="form-input" />
            </div>
          </div>
          {siteContracts.length > 0 && (
            <div>
              <label className="form-label">契約（任意）</label>
              <select value={contractId} onChange={e => setContractId(e.target.value)} className="form-input">
                <option value="">紐付けなし</option>
                {siteContracts.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.contractNumber} — {c.clientName}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">キャンセル</button>
          <button
            onClick={() => onConfirm({ startTime, endTime, contractId })}
            disabled={isPending}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {isPending ? '配員中...' : '配員する'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 隊員カード（ドラッグ対象）──────────────────────────────
function GuardCard({ guard, onDragStart }: { guard: any; onDragStart: (g: any) => void }) {
  const surveyBadge = guard.surveyAvailable === true
    ? <span className="text-xs text-green-600 font-medium">◎ 勤務可</span>
    : guard.surveyAvailable === false
    ? <span className="text-xs text-red-400">✕ 勤務不可</span>
    : <span className="text-xs text-gray-300">— 未回答</span>

  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('guardId', guard.id)
        e.dataTransfer.effectAllowed = 'copy'
        onDragStart(guard)
      }}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-grab active:cursor-grabbing border transition-all select-none
        ${guard.isAssigned
          ? 'bg-gray-50 border-gray-100 opacity-50'
          : 'bg-white border-gray-200 hover:border-[#1e3a5f]/30 hover:shadow-md'
        }`}
    >
      <GuardAvatar guardId={guard.id} name={guard.name} hasPhoto={guard.hasPhoto} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="font-medium text-gray-800 text-sm truncate">{guard.name}</p>
          {guard.isAssigned && <span className="text-xs text-blue-500 flex-shrink-0">配員済</span>}
        </div>
        <p className="text-xs text-gray-400 truncate">
          {guard.nearestStation1 ? `${guard.nearestStation1}駅` : ''}
          {guard.line1 ? ` · ${guard.line1}` : ''}
          {!guard.nearestStation1 && !guard.line1 ? '最寄駅未設定' : ''}
        </p>
        <div className="mt-0.5">{surveyBadge}</div>
      </div>
    </div>
  )
}

// ─── 隊員カード・横並び版（上段用）─────────────────────────
function GuardCardHorizontal({ guard, onDragStart }: { guard: any; onDragStart: (g: any) => void }) {
  const hasCert = Array.isArray(guard.certifications) && guard.certifications.length > 0

  const surveyDot = guard.surveyAvailable === true
    ? <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="勤務可" />
    : guard.surveyAvailable === false
    ? <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" title="勤務不可" />
    : <span className="w-2 h-2 rounded-full bg-gray-200 flex-shrink-0" title="未回答" />

  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('guardId', guard.id)
        e.dataTransfer.effectAllowed = 'copy'
        onDragStart(guard)
      }}
      className={`flex flex-col items-center gap-1 px-2 py-2 rounded-xl cursor-grab active:cursor-grabbing border transition-all select-none flex-shrink-0 w-20
        ${guard.isAssigned
          ? 'bg-gray-50 border-gray-100 opacity-50'
          : hasCert
          ? 'bg-red-50 border-red-200 hover:border-red-400 hover:shadow-md'
          : 'bg-white border-gray-200 hover:border-[#1e3a5f]/40 hover:shadow-md'
        }`}
    >
      <div className="relative">
        <GuardAvatar guardId={guard.id} name={guard.name} hasPhoto={guard.hasPhoto} size="lg" />
        <span className="absolute -bottom-0.5 -right-0.5">{surveyDot}</span>
      </div>
      <p className={`text-xs font-semibold text-center leading-tight line-clamp-2 w-full
        ${hasCert ? 'text-red-600' : 'text-gray-700'}`}>
        {guard.name}
      </p>
      <p className="text-[10px] text-gray-400 text-center leading-tight truncate w-full">
        {guard.nearestStation1 ? `${guard.nearestStation1}駅` : '—'}
      </p>
      {hasCert && (
        <span className="text-[10px] text-red-500 font-medium leading-tight text-center" title={guard.certifications.join(', ')}>
          {guard.certifications.slice(0, 2).map(abbreviateCert).join(' ')}
        </span>
      )}
      {guard.isAssigned && <span className="text-[10px] text-blue-500">配員済</span>}
    </div>
  )
}

// ─── 現場カード（ドロップ対象）──────────────────────────────
function SiteDropZone({
  site, onDrop, onCancelSchedule, canEdit,
}: {
  site: any
  onDrop: (siteId: string) => void
  onCancelSchedule: (scheduleId: string) => void
  canEdit: boolean
}) {
  const [isOver, setIsOver] = useState(false)

  return (
    <div
      className={`card p-0 overflow-hidden transition-all ${isOver ? 'ring-2 ring-[#1e3a5f] shadow-lg' : ''}`}
      onDragOver={e => { e.preventDefault(); setIsOver(true) }}
      onDragLeave={() => setIsOver(false)}
      onDrop={e => {
        e.preventDefault()
        setIsOver(false)
        onDrop(site.id)
      }}
    >
      {/* ヘッダー */}
      <div className={`px-4 py-2.5 border-b border-gray-100 flex items-center justify-between transition-colors ${isOver ? 'bg-[#1e3a5f]/10' : 'bg-[#1e3a5f]/5'}`}>
        <div>
          <p className="text-sm font-semibold text-[#1e3a5f]">📍 {site.name}</p>
          <p className="text-xs text-gray-400">{site.address}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">
            {site.schedules.length}名 / {site.requiredCount}名必要
          </p>
          {site.schedules.length < site.requiredCount && (
            <span className="text-xs text-orange-500 font-medium">要員不足</span>
          )}
          {site.schedules.length >= site.requiredCount && (
            <span className="text-xs text-green-600 font-medium">配員完了</span>
          )}
        </div>
      </div>

      {/* 配員済み隊員 */}
      <div className="px-3 py-2 min-h-[56px]">
        {site.schedules.length === 0 ? (
          <p className={`text-xs text-center py-3 transition-colors ${isOver ? 'text-[#1e3a5f] font-medium' : 'text-gray-300'}`}>
            {isOver ? '↓ ここにドロップ' : '配員なし — 隊員をドロップして配員'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2 py-1">
            {site.schedules.map((s: any) => (
              <div key={s.id} className={`flex items-center gap-1.5 bg-white border rounded-lg px-2 py-1 text-xs shadow-sm
                ${s.status === 'CONFIRMED' ? 'border-green-300' : 'border-gray-200'}`}>
                <GuardAvatar guardId={s.guard.id} name={s.guard.name} hasPhoto={false} size="sm" />
                <div>
                  <p className="font-medium text-gray-700">{s.guard.name}</p>
                  <p className="text-gray-400">{s.startTime}〜{s.endTime}</p>
                </div>
                <span className={`badge ml-1 ${STATUS_LABELS[s.status]?.className}`}>{STATUS_LABELS[s.status]?.label}</span>
                {canEdit && s.status !== 'CANCELLED' && (
                  <button
                    onClick={() => { if (window.confirm(`${s.guard.name}の配員をキャンセルしますか？`)) onCancelSchedule(s.id) }}
                    className="text-red-300 hover:text-red-500 ml-1"
                    title="キャンセル"
                  >✕</button>
                )}
              </div>
            ))}
            {isOver && (
              <div className="flex items-center gap-1 border-2 border-dashed border-[#1e3a5f]/40 rounded-lg px-3 py-1.5 text-xs text-[#1e3a5f]">
                ＋ 追加する
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── サジェストモーダル ───────────────────────────────────────
interface SuggestResult {
  assignments: Array<{
    siteId: string
    siteName: string
    siteAddress: string | null
    requiredCount: number
    assignedGuards: Array<{
      guardId: string
      guardName: string
      score: number
      reasons: string[]
      distanceKm: number | null
    }>
    unfilledCount: number
  }>
  stats: { totalSites: number; totalGuards: number; assignedCount: number; unfilledSites: number }
}

function SuggestModal({ result, onClose, onApply, isApplying, date }: {
  result: SuggestResult
  onClose: () => void
  onApply: (assignments: Array<{ siteId: string; guardId: string }>) => void
  isApplying: boolean
  date: string
}) {
  const allAssignments = result.assignments.flatMap(a =>
    a.assignedGuards.map(g => ({ siteId: a.siteId, guardId: g.guardId }))
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-800">🤖 自動配置サジェスト</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              距離・相性・資格・経験を総合スコアで算出しました（{date}）
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {/* 統計サマリ */}
        <div className="flex gap-4 px-6 py-3 bg-blue-50 border-b border-blue-100 text-xs">
          <span className="text-blue-700">対象現場: <b>{result.stats.totalSites}</b></span>
          <span className="text-blue-700">配置可能隊員: <b>{result.stats.totalGuards}</b></span>
          <span className="text-green-700">配置提案: <b>{result.stats.assignedCount}</b>名</span>
          {result.stats.unfilledSites > 0 && (
            <span className="text-orange-600">要員不足現場: <b>{result.stats.unfilledSites}</b></span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {result.assignments.length === 0 ? (
            <p className="text-center text-gray-400 py-8">提案できる配置がありません（隊員が不足しているか、全員配置済みです）</p>
          ) : (
            result.assignments.map(site => (
              <div key={site.siteId} className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{site.siteName}</p>
                    {site.siteAddress && <p className="text-xs text-gray-400">{site.siteAddress}</p>}
                  </div>
                  <div className="text-right text-xs">
                    <span className="text-gray-500">{site.assignedGuards.length}/{site.requiredCount}名</span>
                    {site.unfilledCount > 0 && (
                      <span className="ml-2 text-orange-500">あと{site.unfilledCount}名不足</span>
                    )}
                  </div>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {site.assignedGuards.length === 0 ? (
                    <p className="text-xs text-gray-400">この現場への配置提案なし</p>
                  ) : (
                    site.assignedGuards.map(g => (
                      <div key={g.guardId} className="flex items-center gap-3 text-xs">
                        <div className="w-24 font-medium text-gray-700 truncate">{g.guardName}</div>
                        <div className="flex-1 flex flex-wrap gap-1">
                          {g.distanceKm !== null && (
                            <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-[10px]">
                              {g.distanceKm}km
                            </span>
                          )}
                          {g.reasons.map((r, i) => (
                            <span key={i} className={`px-1.5 py-0.5 rounded text-[10px]
                              ${r.includes('NG') || r.includes('相性△') ? 'bg-red-50 text-red-500'
                              : r.includes('相性◎') ? 'bg-green-50 text-green-600'
                              : r.includes('資格') || r.includes('級') ? 'bg-purple-50 text-purple-600'
                              : 'bg-gray-100 text-gray-500'}`}>
                              {r}
                            </span>
                          ))}
                        </div>
                        <div className="text-right font-mono">
                          <span className={`font-bold ${g.score >= 120 ? 'text-green-600' : g.score >= 100 ? 'text-blue-600' : 'text-gray-500'}`}>
                            {g.score}pt
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">キャンセル</button>
          <button
            onClick={() => onApply(allAssignments)}
            disabled={isApplying || allAssignments.length === 0}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {isApplying ? '反映中...' : `一括反映（${allAssignments.length}件）`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── メインページ ─────────────────────────────────────────────
export default function SchedulePage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [viewDate, setViewDate] = useState(new Date())
  const [surveyFilter, setSurveyFilter] = useState<'all' | 'available' | 'unavailable' | 'noAnswer'>('all')
  const [draggedGuard, setDraggedGuard] = useState<any>(null)
  const [assignTarget, setAssignTarget] = useState<{ guard: any; site: any } | null>(null)
  const [suggestResult, setSuggestResult] = useState<SuggestResult | null>(null)

  const dateStr = format(viewDate, 'yyyy-MM-dd')
  const canEdit = hasRole(user, 'ADMIN', 'MANAGER', 'OPERATOR')

  // 管制ボードデータ（隊員＋現場＋当日スケジュール）
  const { data: board, isLoading } = useQuery({
    queryKey: ['dispatch-board', dateStr],
    queryFn: () => api.get(`/schedules/dispatch-board?date=${dateStr}`).then(r => r.data),
    refetchInterval: 30000,
  })

  // 契約一覧（ドロップ時の契約選択に使用）
  const { data: contracts = [] } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => api.get('/contracts').then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/schedules', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatch-board', dateStr] })
      setAssignTarget(null)
      setDraggedGuard(null)
    },
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/schedules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dispatch-board', dateStr] }),
  })

  // 自動配置サジェスト
  const suggestMutation = useMutation({
    mutationFn: (respectSurvey: boolean) =>
      api.post('/dispatch/optimize', { date: dateStr, mode: 'balanced', respectSurvey }).then(r => r.data),
    onSuccess: (data) => setSuggestResult(data),
  })

  const applyMutation = useMutation({
    mutationFn: (assignments: Array<{ siteId: string; guardId: string }>) =>
      api.post('/dispatch/optimize/apply', { date: dateStr, assignments }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatch-board', dateStr] })
      setSuggestResult(null)
    },
  })

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

  const guards: any[] = board?.guards ?? []
  const sites: any[] = board?.sites ?? []
  const hasSurvey: boolean = board?.hasSurvey ?? false

  // フィルタ適用
  const filteredGuards = guards.filter(g => {
    if (surveyFilter === 'available') return g.surveyAvailable === true
    if (surveyFilter === 'unavailable') return g.surveyAvailable === false
    if (surveyFilter === 'noAnswer') return g.surveyAvailable === null
    return true
  })

  const handleDrop = (siteId: string) => {
    if (!draggedGuard) return
    const site = sites.find(s => s.id === siteId)
    if (!site) return
    setAssignTarget({ guard: draggedGuard, site })
  }

  const handleAssignConfirm = (data: { startTime: string; endTime: string; contractId: string }) => {
    if (!assignTarget) return
    createMutation.mutate({
      guardId: assignTarget.guard.id,
      siteId: assignTarget.site.id,
      date: dateStr,
      startTime: data.startTime,
      endTime: data.endTime,
      contractId: data.contractId || undefined,
    })
  }

  return (
    <div className="flex flex-col h-full" style={{ height: 'calc(100vh - 56px)' }}>
      {/* ─── ヘッダー ─── */}
      <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-3 bg-white border-b border-gray-100">
        <h1 className="text-lg font-bold text-gray-800">管制・配員ボード</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 日付ナビ */}
          <button onClick={() => setViewDate(d => subDays(d, 1))} className="btn-secondary px-2.5 py-1.5 text-sm">◀</button>
          <span className="text-sm font-medium text-gray-700 min-w-32 text-center">
            {format(viewDate, 'yyyy年M月d日(E)', { locale: ja })}
          </span>
          <button onClick={() => setViewDate(d => addDays(d, 1))} className="btn-secondary px-2.5 py-1.5 text-sm">▶</button>
          <button onClick={() => setViewDate(new Date())} className="text-xs text-blue-600 hover:underline">今日</button>
          <button onClick={downloadMonthlyCSV} className="btn-secondary text-sm">📥 月間CSV</button>
          {canEdit && (
            <button
              onClick={() => suggestMutation.mutate(surveyFilter === 'available')}
              disabled={suggestMutation.isPending}
              className="btn-primary text-sm disabled:opacity-50 flex items-center gap-1"
              title="距離・相性・資格を元に最適な配置を提案"
            >
              {suggestMutation.isPending ? '計算中...' : '🤖 自動配置サジェスト'}
            </button>
          )}
        </div>
      </div>

      {/* ─── メインコンテンツ（上下分割）─── */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">読み込み中...</div>
      ) : (
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* ─── 上段：隊員一覧（横スクロール）─── */}
          <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50">
            {/* 上段ヘッダー */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 bg-white">
              <p className="text-xs font-semibold text-gray-600 whitespace-nowrap">隊員一覧</p>
              <span className="text-xs text-gray-400 whitespace-nowrap">{filteredGuards.length}名</span>
              {hasSurvey ? (
                <select
                  value={surveyFilter}
                  onChange={e => setSurveyFilter(e.target.value as any)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 focus:outline-none focus:border-[#1e3a5f]"
                >
                  <option value="all">シフト調査：全員</option>
                  <option value="available">◎ 勤務可のみ</option>
                  <option value="unavailable">✕ 勤務不可のみ</option>
                  <option value="noAnswer">— 未回答のみ</option>
                </select>
              ) : (
                <span className="text-xs text-gray-300">この日のシフト調査なし</span>
              )}
              <span className="ml-auto text-xs text-gray-300">← カードをドラッグして下の現場へ配員 →</span>
            </div>

            {/* 隊員カード横スクロール */}
            <div className="flex gap-2 px-3 py-2.5 overflow-x-auto">
              {filteredGuards.length === 0 ? (
                <p className="text-xs text-gray-300 py-4 px-2">表示する隊員がいません</p>
              ) : (
                filteredGuards.map(g => (
                  <GuardCardHorizontal key={g.id} guard={g} onDragStart={setDraggedGuard} />
                ))
              )}
            </div>
          </div>

          {/* ─── 下段：配員ボード（現場ドロップゾーン）─── */}
          <div className="flex-1 overflow-y-auto p-4">
            {sites.length === 0 ? (
              <div className="text-center py-20 text-gray-300">
                <p className="text-4xl mb-3">📋</p>
                <p className="text-sm">現場が登録されていません</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {sites.map(site => (
                  <SiteDropZone
                    key={site.id}
                    site={site}
                    onDrop={handleDrop}
                    onCancelSchedule={id => cancelMutation.mutate(id)}
                    canEdit={canEdit}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── サジェストモーダル ─── */}
      {suggestResult && (
        <SuggestModal
          result={suggestResult}
          date={dateStr}
          onClose={() => setSuggestResult(null)}
          onApply={assignments => applyMutation.mutate(assignments)}
          isApplying={applyMutation.isPending}
        />
      )}

      {/* ─── 配員確認モーダル ─── */}
      {assignTarget && (
        <AssignModal
          guard={assignTarget.guard}
          site={assignTarget.site}
          date={dateStr}
          contracts={contracts}
          onClose={() => { setAssignTarget(null); setDraggedGuard(null) }}
          onConfirm={handleAssignConfirm}
          isPending={createMutation.isPending}
        />
      )}
    </div>
  )
}
