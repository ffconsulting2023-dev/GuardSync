import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { format, addDays } from 'date-fns'
import { api } from '../../lib/api'
import {
  COACHING_STATUS, COACHING_METHODS, COACHING_GUIDE, COACHING_FOLLOW_UP_DAYS, DIRECTION_LABEL, DIRECTION_SHORT, NOTE_MAX,
  OUTCOME_VERDICT, CONFIRMABLE_VERDICTS, OUTCOME_IMPROVED_MIN, OUTCOME_WILL_HIGH, OUTCOME_WILL_LOW,
  criterionLabel, coachingTemplate, type CoachingStatus, type GapDirection, type OutcomeVerdict, type OutcomeResult,
} from '../../../shared/evaluation'

export interface CoachingTask {
  id: string; guardId: string; criterionKey: string; direction: GapDirection; gap: number; trigger: 'SITE' | 'INTERVIEW'
  evidence: { date: string; self: number; others: number }[] | null; detectedAt: string; dueDate: string; status: CoachingStatus
  coachedAt: string | null; coachName: string | null; method: string | null; content: string | null; followUpDate: string | null
  acknowledgedAt: string | null; guardCommitment: string | null; dismissReason: string | null
  outcomeVerdict: OutcomeVerdict | null; outcomeImprovement: number | null; outcomeWillingness: number | null; outcomeDetail: OutcomeResult['detail'] | null
  confirmedVerdict: OutcomeVerdict | null; confirmedNote: string | null; confirmedByName: string | null; confirmedAt: string | null
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
        {(['OPEN', 'COACHED', 'CLOSED', 'DISMISSED', ''] as const).map(s => (
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
        <span className={`text-[11px] ml-auto px-1.5 py-0.5 rounded ${t.status === 'OPEN' ? (overdue ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700') : t.status === 'COACHED' || t.status === 'CLOSED' ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-400'}`}>
          {COACHING_STATUS[t.status]}{t.status === 'OPEN' && `・期限 ${t.dueDate.slice(0, 10)}${overdue ? '（超過）' : ''}`}
        </span>
      </div>
      {t.evidence && t.evidence.length > 0 && (
        <div className="flex flex-wrap gap-1 text-[11px] text-gray-500">
          <span>根拠（本人／他者）:</span>
          {t.evidence.map((e, i) => <span key={i} className="px-1.5 rounded bg-gray-50">{e.date.slice(5)} {e.self}／{e.others}</span>)}
        </div>
      )}
      {(t.status === 'COACHED' || t.status === 'CLOSED') && (
        <div className="text-sm bg-gray-50 rounded-lg p-2 space-y-1">
          <p className="text-xs text-gray-500">{t.coachedAt?.slice(0, 10)} {t.coachName}（{t.method}）・変化の確認日 {t.followUpDate?.slice(0, 10)}</p>
          <p className="whitespace-pre-wrap text-gray-800">{t.content}</p>
          {t.acknowledgedAt
            ? <p className="text-xs text-green-700">本人の取り組み（{t.acknowledgedAt.slice(0, 10)}）: {t.guardCommitment}</p>
            : <p className="text-xs text-amber-700">本人はまだ確認していません（隊員アプリに表示されています）</p>}
        </div>
      )}
      {(t.status === 'COACHED' || t.status === 'CLOSED') && t.outcomeVerdict && <OutcomeBox task={t} onDone={done} />}
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

export const VERDICT_STYLE: Record<OutcomeVerdict, string> = {
  IMPROVED: 'bg-green-100 text-green-800',
  CONTINUE: 'bg-sky-100 text-sky-800',
  NO_WILL: 'bg-red-100 text-red-700',
  INSUFFICIENT: 'bg-gray-100 text-gray-500',
}

// 指導後の変化（システムの判定）と、上司による確定
function OutcomeBox({ task: t, onDone }: { task: CoachingTask; onDone: () => void }) {
  const suggested = t.outcomeVerdict && CONFIRMABLE_VERDICTS.includes(t.outcomeVerdict) ? t.outcomeVerdict : 'CONTINUE'
  const [verdict, setVerdict] = useState<OutcomeVerdict>(suggested)
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)
  const confirm = useMutation({ mutationFn: () => api.put(`/coaching-tasks/${t.id}/confirm`, { verdict, note: note.trim() || null }), onSuccess: onDone })
  const d = t.outcomeDetail
  const fmt = (v: number | null | undefined) => (v == null ? '—' : v)
  return (
    <div className="border border-gray-200 rounded-lg p-2 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">指導後の変化</span>
        <span className={`text-xs px-2 py-0.5 rounded ${VERDICT_STYLE[t.outcomeVerdict!]}`} title="システムの判定（提案）">{OUTCOME_VERDICT[t.outcomeVerdict!]}</span>
        <span className="text-xs text-gray-600">改善度 <b>{t.outcomeImprovement == null ? '—' : `${t.outcomeImprovement > 0 ? '+' : ''}${t.outcomeImprovement}`}</b></span>
        <span className="text-xs text-gray-600">改善意欲 <b>{t.outcomeWillingness ?? '—'}</b>/100</span>
        {t.status === 'CLOSED' && t.confirmedVerdict && (
          <span className={`text-xs px-2 py-0.5 rounded ml-auto ${VERDICT_STYLE[t.confirmedVerdict]}`}>確定: {OUTCOME_VERDICT[t.confirmedVerdict]}（{t.confirmedByName} {t.confirmedAt?.slice(0, 10)}）</span>
        )}
      </div>
      {d && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[11px] text-gray-600">
          <span>他者の評価 {fmt(d.preOthers)} → <b>{fmt(d.postOthers)}</b></span>
          <span>乖離 {fmt(d.preGap)} → <b>{fmt(d.postGap)}</b></span>
          <span>現場 指導前{d.preCount}回／後{d.postCount}回</span>
          <span>意欲の内訳: 確認{d.ackPoints}・振り返り{d.reflectionPoints}・自己認識{d.awarenessPoints}</span>
        </div>
      )}
      {t.status === 'CLOSED' && t.confirmedNote && <p className="text-xs text-gray-600">メモ: {t.confirmedNote}</p>}
      {t.status === 'COACHED' && (
        !open ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setOpen(true)} className="btn-secondary text-xs">結果を確定する</button>
            {t.outcomeVerdict === 'INSUFFICIENT' && <span className="text-[11px] text-gray-400">指導後の評価がまだ足りません（変化の確認日を過ぎるか、指導後の現場が2回以上で判定します）</span>}
          </div>
        ) : (
          <div className="space-y-2 border-t border-gray-100 pt-2">
            <p className="text-[11px] text-gray-500">判定の目安: 改善度 {OUTCOME_IMPROVED_MIN} 以上かつ改善意欲 {OUTCOME_WILL_HIGH} 以上で「改善」、改善度 0 以下かつ改善意欲 {OUTCOME_WILL_LOW} 未満で「改善が見られない」。最終判断は上司が行ってください。</p>
            <div className="flex flex-wrap gap-1">
              {CONFIRMABLE_VERDICTS.map(v => (
                <button key={v} type="button" aria-pressed={verdict === v} onClick={() => setVerdict(v)}
                  className={`text-xs px-2 py-1 rounded border ${verdict === v ? VERDICT_STYLE[v] + ' border-transparent font-medium' : 'bg-white text-gray-600 border-gray-200'}`}>{OUTCOME_VERDICT[v]}</button>
              ))}
            </div>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={NOTE_MAX} className="form-input text-sm" placeholder="メモ（任意。判定を変えた理由など）" />
            {confirm.isError && <p className="text-sm text-red-600">{errorOf(confirm.error, '確定できませんでした')}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setOpen(false)} className="btn-secondary text-sm">キャンセル</button>
              <button type="button" disabled={confirm.isPending} onClick={() => confirm.mutate()} className="btn-primary text-sm disabled:opacity-50">確定</button>
            </div>
          </div>
        )
      )}
    </div>
  )
}
