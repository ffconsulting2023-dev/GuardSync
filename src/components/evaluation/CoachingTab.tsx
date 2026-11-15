import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { format, addDays } from 'date-fns'
import { api } from '../../lib/api'
import {
  COACHING_STATUS, COACHING_METHODS, COACHING_GUIDE, COACHING_FOLLOW_UP_DAYS, DIRECTION_LABEL, DIRECTION_SHORT, NOTE_MAX,
  criterionLabel, coachingTemplate, type CoachingStatus, type GapDirection,
} from '../../../shared/evaluation'

export interface CoachingTask {
  id: string; guardId: string; criterionKey: string; direction: GapDirection; gap: number; trigger: 'SITE' | 'INTERVIEW'
  evidence: { date: string; self: number; others: number }[] | null; detectedAt: string; dueDate: string; status: CoachingStatus
  coachedAt: string | null; coachName: string | null; method: string | null; content: string | null; followUpDate: string | null
  acknowledgedAt: string | null; guardCommitment: string | null; dismissReason: string | null
  guard?: { id: string; name: string; employeeNumber: string }
}

const errorOf = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || fallback
const today = () => format(new Date(), 'yyyy-MM-dd')

// 指導タスクの一覧（自動検知された乖離 → 指導の記録 → 本人の受け止め）
export default function CoachingTab() {
  const [status, setStatus] = useState<CoachingStatus | ''>('OPEN')
  const { data = [], isLoading, error } = useQuery<CoachingTask[]>({
    queryKey: ['coaching-tasks', status],
    queryFn: () => api.get('/coaching-tasks', { params: status ? { status } : {} }).then(r => r.data),
  })
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['OPEN', 'COACHED', 'DISMISSED', ''] as const).map(s => (
          <button key={s} onClick={() => setStatus(s)} className={`text-xs px-3 py-1.5 rounded-full border ${status === s ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]' : 'bg-white text-gray-600 border-gray-200'}`}>
            {s ? COACHING_STATUS[s] : 'すべて'}
          </button>
        ))}
        <p className="text-[11px] text-gray-500 ml-auto">本人と他者の評価の差が続いたとき（直近5回の現場のうち3回以上）や、面談で差が大きかったときに自動で作られます。</p>
      </div>
      {error && <div className="card text-sm text-red-600">{errorOf(error, '読み込めませんでした')}</div>}
      {isLoading && <div className="card text-center py-8 text-gray-400">読み込み中...</div>}
      {!isLoading && data.length === 0 && <div className="card text-center py-8 text-gray-400">該当する指導タスクはありません</div>}
      <div className="space-y-2">{data.map(t => <CoachingCard key={t.id} task={t} showGuard />)}</div>
    </div>
  )
}

export function CoachingCard({ task: t, showGuard }: { task: CoachingTask; showGuard?: boolean }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'coach' | 'dismiss' | null>(null)
  const [method, setMethod] = useState<string>(COACHING_METHODS[0])
  const [content, setContent] = useState(() => coachingTemplate(t.criterionKey, t.direction))
  const [coachedAt, setCoachedAt] = useState(today())
  const [followUp, setFollowUp] = useState(format(addDays(new Date(), COACHING_FOLLOW_UP_DAYS), 'yyyy-MM-dd'))
  const [reason, setReason] = useState('')
  const done = () => { setMode(null); qc.invalidateQueries({ queryKey: ['coaching-tasks'] }); qc.invalidateQueries({ queryKey: ['evaluation-counts'] }); qc.invalidateQueries({ queryKey: ['guard-evaluations'] }) }
  const coach = useMutation({ mutationFn: () => api.put(`/coaching-tasks/${t.id}/coach`, { method, content, coachedAt, followUpDate: followUp }), onSuccess: done })
  const dismiss = useMutation({ mutationFn: () => api.put(`/coaching-tasks/${t.id}/dismiss`, { reason }), onSuccess: done })
  const overdue = t.status === 'OPEN' && t.dueDate.slice(0, 10) < today()

  return (
    <div className={`card p-4 space-y-2 ${overdue ? 'border border-red-200' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {showGuard && t.guard && <Link to={`/evaluations?guard=${t.guardId}`} className="font-medium text-gray-800 hover:underline">{t.guard.name}</Link>}
        <span className="text-sm font-medium text-gray-700">{criterionLabel(t.criterionKey)}</span>
        <span className={`text-[11px] px-1.5 py-0.5 rounded ${t.direction === 'OVER' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`} title={DIRECTION_LABEL[t.direction]}>
          {DIRECTION_SHORT[t.direction]}（{t.gap > 0 ? '+' : ''}{t.gap}）
        </span>
        <span className="text-[11px] text-gray-400">{t.trigger === 'INTERVIEW' ? '面談で検知' : '現場の評価で検知'} {t.detectedAt.slice(0, 10)}</span>
        <span className={`text-[11px] ml-auto px-1.5 py-0.5 rounded ${t.status === 'OPEN' ? (overdue ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700') : t.status === 'COACHED' ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-400'}`}>
          {COACHING_STATUS[t.status]}{t.status === 'OPEN' && `・期限 ${t.dueDate.slice(0, 10)}${overdue ? '（超過）' : ''}`}
        </span>
      </div>
      {t.evidence && t.evidence.length > 0 && (
        <div className="flex flex-wrap gap-1 text-[11px] text-gray-500">
          <span>根拠（本人／他者）:</span>
          {t.evidence.map((e, i) => <span key={i} className="px-1.5 rounded bg-gray-50">{e.date.slice(5)} {e.self}／{e.others}</span>)}
        </div>
      )}
      {t.status === 'COACHED' && (
        <div className="text-sm bg-gray-50 rounded-lg p-2 space-y-1">
          <p className="text-xs text-gray-500">{t.coachedAt?.slice(0, 10)} {t.coachName}（{t.method}）・変化の確認日 {t.followUpDate?.slice(0, 10)}</p>
          <p className="whitespace-pre-wrap text-gray-800">{t.content}</p>
          {t.acknowledgedAt
            ? <p className="text-xs text-green-700">本人の取り組み（{t.acknowledgedAt.slice(0, 10)}）: {t.guardCommitment}</p>
            : <p className="text-xs text-amber-700">本人はまだ確認していません（隊員アプリに表示されています）</p>}
        </div>
      )}
      {t.status === 'DISMISSED' && <p className="text-xs text-gray-500">対応不要: {t.dismissReason}（{t.coachName}）</p>}
      {t.status === 'OPEN' && !mode && (
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode('coach')} className="btn-primary text-sm">指導を記録</button>
          <button type="button" onClick={() => setMode('dismiss')} className="btn-secondary text-sm">対応不要</button>
        </div>
      )}
      {mode === 'coach' && (
        <div className="space-y-2 border-t border-gray-100 pt-2">
          <p className="text-xs text-gray-600 bg-blue-50 rounded p-2">指導の方針: {COACHING_GUIDE[t.direction]}</p>
          <div className="flex flex-wrap gap-2">
            <select value={method} onChange={e => setMethod(e.target.value)} className="form-input !w-40 text-sm">{COACHING_METHODS.map(m => <option key={m}>{m}</option>)}</select>
            <label className="text-xs text-gray-500 flex items-center gap-1 whitespace-nowrap">指導日<input type="date" value={coachedAt} onChange={e => setCoachedAt(e.target.value)} className="form-input text-sm w-40" /></label>
            <label className="text-xs text-gray-500 flex items-center gap-1 whitespace-nowrap">変化の確認日<input type="date" value={followUp} onChange={e => setFollowUp(e.target.value)} className="form-input text-sm w-40" /></label>
          </div>
          <textarea value={content} onChange={e => setContent(e.target.value)} maxLength={NOTE_MAX} rows={4} className="form-input text-sm" />
          <p className="text-[11px] text-gray-400">指導内容は隊員アプリで本人に表示され、本人が取り組みを入力します。</p>
          {coach.isError && <p className="text-sm text-red-600">{errorOf(coach.error, '保存できませんでした')}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setMode(null)} className="btn-secondary text-sm">キャンセル</button>
            <button type="button" disabled={!content.trim() || coach.isPending} onClick={() => coach.mutate()} className="btn-primary text-sm disabled:opacity-50">保存</button>
          </div>
        </div>
      )}
      {mode === 'dismiss' && (
        <div className="space-y-2 border-t border-gray-100 pt-2">
          <input value={reason} onChange={e => setReason(e.target.value)} maxLength={NOTE_MAX} className="form-input text-sm" placeholder="理由（例: 評価者の付け間違い、別の機会に指導済み）" />
          {dismiss.isError && <p className="text-sm text-red-600">{errorOf(dismiss.error, '保存できませんでした')}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setMode(null)} className="btn-secondary text-sm">キャンセル</button>
            <button type="button" disabled={!reason.trim() || dismiss.isPending} onClick={() => dismiss.mutate()} className="btn-primary text-sm disabled:opacity-50">対応不要にする</button>
          </div>
        </div>
      )}
    </div>
  )
}
