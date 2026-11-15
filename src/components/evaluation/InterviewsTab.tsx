import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, addDays } from 'date-fns'
import { api } from '../../lib/api'
import { Scale5Buttons, criteriaFor, type Scores } from './EvaluationInputs'
import { CoachingCard, type CoachingTask } from './CoachingTab'
import {
  INTERVIEW_STATUS, INTERVIEW_TEXT_MAX, INTERVIEW_GAP_THRESHOLD, RATER_LABEL, criterionLabel,
  type CriterionSummary, type InterviewStatus, type RaterType,
} from '../../../shared/evaluation'

interface InterviewRow {
  id: string; guardId: string; scheduledDate: string; periodFrom: string; periodTo: string; status: InterviewStatus
  interviewerName: string; goal: string | null; selfDone: boolean; managementDone: boolean
  guard: { id: string; name: string; employeeNumber: string }; _count: { coachingTasks: number }
}
interface InterviewDetail extends Omit<InterviewRow, 'selfDone' | 'managementDone' | '_count'> {
  guardWish: string | null; managementComment: string | null
  evaluations: { raterType: RaterType; scores: Scores }[]
  stats: { shifts: number; clockedIn: number; late: number; evaluationCount: number; siteSummary: CriterionSummary[]; repeatWish: { yes: number; total: number } }
  coachingTasks: CoachingTask[]
  previous: { scheduledDate: string; goal: string | null } | null
}

const errorOf = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || fallback
const d10 = (s: string) => s.slice(0, 10)

// 経営者との定期面談（会社の管理者のみ）
export default function InterviewsTab() {
  const qc = useQueryClient()
  const [openId, setOpenId] = useState<string | null>(null)
  const [form, setForm] = useState({ guardId: '', scheduledDate: format(addDays(new Date(), 7), 'yyyy-MM-dd') })
  const { data: guards = [] } = useQuery<any[]>({ queryKey: ['guards-active'], queryFn: () => api.get('/guards?isActive=true').then(r => r.data) })
  const { data = [], isLoading, error } = useQuery<InterviewRow[]>({ queryKey: ['interviews'], queryFn: () => api.get('/interviews').then(r => r.data) })
  const create = useMutation({
    mutationFn: () => api.post('/interviews', form).then(r => r.data),
    onSuccess: (iv: any) => { qc.invalidateQueries({ queryKey: ['interviews'] }); qc.invalidateQueries({ queryKey: ['evaluation-counts'] }); setForm(f => ({ ...f, guardId: '' })); setOpenId(iv.id) },
  })
  if (openId) return <InterviewPanel id={openId} onClose={() => setOpenId(null)} />

  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <h3 className="font-semibold text-gray-800">面談を予定する</h3>
        <p className="text-xs text-gray-500">予定すると隊員アプリに「面談前の自己評価」が表示されます。振り返りの対象期間は前回の面談の翌日から（初回は3か月前から）面談日までです。</p>
        <div className="flex flex-wrap gap-2">
          <select value={form.guardId} onChange={e => setForm(f => ({ ...f, guardId: e.target.value }))} className="form-input w-60">
            <option value="">隊員を選択</option>
            {guards.map(g => <option key={g.id} value={g.id}>{g.employeeNumber} {g.name}</option>)}
          </select>
          <input type="date" value={form.scheduledDate} onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))} className="form-input w-44" />
          <button type="button" disabled={!form.guardId || create.isPending} onClick={() => create.mutate()} className="btn-primary disabled:opacity-50">予定する</button>
        </div>
        {create.isError && <p className="text-sm text-red-600">{errorOf(create.error, '作成できませんでした')}</p>}
      </div>
      {error && <div className="card text-sm text-red-600">{errorOf(error, '読み込めませんでした')}</div>}
      {isLoading && <div className="card text-center py-8 text-gray-400">読み込み中...</div>}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr><th className="text-left px-4 py-2">面談日</th><th className="text-left px-4 py-2">隊員</th><th className="text-left px-4 py-2">対象期間</th><th className="px-4 py-2">本人の自己評価</th><th className="px-4 py-2">状態</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.map(i => (
              <tr key={i.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setOpenId(i.id)}>
                <td className="px-4 py-2 whitespace-nowrap">{d10(i.scheduledDate)}</td>
                <td className="px-4 py-2">{i.guard.name}</td>
                <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{d10(i.periodFrom)}〜{d10(i.periodTo)}</td>
                <td className="px-4 py-2 text-center text-xs">{i.selfDone ? <span className="text-green-700">✓ 入力済み</span> : <span className="text-gray-400">未入力</span>}</td>
                <td className="px-4 py-2 text-center text-xs whitespace-nowrap">{INTERVIEW_STATUS[i.status]}{i._count.coachingTasks > 0 && <span className="ml-1 text-amber-700">指導 {i._count.coachingTasks}</span>}</td>
                <td className="px-4 py-2 text-right text-xs text-blue-600">開く</td>
              </tr>
            ))}
            {!isLoading && data.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-400">面談はまだありません</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function InterviewPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const criteria = criteriaFor('MANAGEMENT')
  const { data: iv, isLoading, error } = useQuery<InterviewDetail>({ queryKey: ['interview', id], queryFn: () => api.get(`/interviews/${id}`).then(r => r.data) })
  const [scores, setScores] = useState<Scores | null>(null)
  const [goal, setGoal] = useState<string | null>(null)
  const [comment, setComment] = useState<string | null>(null)
  const mgmt = iv?.evaluations.find(e => e.raterType === 'MANAGEMENT')?.scores ?? {}
  const self = iv?.evaluations.find(e => e.raterType === 'SELF')?.scores ?? null
  const cur = scores ?? mgmt
  const refresh = () => { qc.invalidateQueries({ queryKey: ['interview', id] }); qc.invalidateQueries({ queryKey: ['interviews'] }); qc.invalidateQueries({ queryKey: ['evaluation-counts'] }); qc.invalidateQueries({ queryKey: ['coaching-tasks'] }) }
  const save = useMutation({
    mutationFn: (complete: boolean) => api.put(`/interviews/${id}/management`, { scores: cur, goal: goal ?? iv?.goal ?? null, managementComment: comment ?? iv?.managementComment ?? null, complete }).then(r => r.data),
    onSuccess: (r: any) => { refresh(); if (r.tasksCreated) window.alert(`本人の自己評価との差が大きい項目があったため、指導タスクを ${r.tasksCreated} 件作成しました。`) },
  })
  const cancel = useMutation({ mutationFn: () => api.put(`/interviews/${id}`, { status: 'CANCELLED' }), onSuccess: refresh })
  const remove = useMutation({ mutationFn: () => api.delete(`/interviews/${id}`), onSuccess: () => { refresh(); onClose() } })

  if (isLoading) return <div className="card text-center py-8 text-gray-400">読み込み中...</div>
  if (error || !iv) return <div className="card text-sm text-red-600">{errorOf(error, '読み込めませんでした')} <button onClick={onClose} className="text-blue-600 ml-2">戻る</button></div>
  const editable = iv.status === 'SCHEDULED'
  const complete = criteria.every(c => cur[c.key])
  const s = iv.stats

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onClose} className="text-sm text-blue-600">‹ 面談一覧</button>
        <h3 className="font-semibold text-gray-800">{iv.guard.name} の面談（{d10(iv.scheduledDate)}）</h3>
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100">{INTERVIEW_STATUS[iv.status]}</span>
        {editable && (
          <span className="ml-auto flex gap-3 text-xs">
            <button onClick={() => { if (window.confirm('この面談を中止にしますか？')) cancel.mutate() }} className="text-gray-500">中止にする</button>
            <button onClick={() => { if (window.confirm('この面談を削除しますか？')) remove.mutate() }} className="text-red-600">削除</button>
          </span>
        )}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        {/* 左：対象期間の実績（自動集計） */}
        <div className="space-y-3">
          <div className="card space-y-2">
            <h4 className="font-semibold text-gray-800 text-sm">対象期間の実績（{d10(iv.periodFrom)}〜{d10(iv.periodTo)}）</h4>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[{ l: '勤務', v: `${s.shifts}回` }, { l: '出勤打刻', v: `${s.clockedIn}回` }, { l: '遅刻', v: `${s.late}回`, warn: s.late > 0 }, { l: 'また来てほしい', v: s.repeatWish.total ? `${s.repeatWish.yes}/${s.repeatWish.total}` : '—' }].map(x => (
                <div key={x.l} className="bg-gray-50 rounded-lg py-2"><p className="text-[11px] text-gray-500">{x.l}</p><p className={`font-bold ${x.warn ? 'text-red-600' : 'text-gray-800'}`}>{x.v}</p></div>
              ))}
            </div>
            <p className="text-[11px] text-gray-400">遅刻は出勤打刻が配員の開始時刻より後の回数です。</p>
            <table className="w-full text-xs">
              <thead className="text-gray-500"><tr><th className="text-left py-1">現場ごとの評価（{s.evaluationCount}件）</th><th className="text-right">本人</th><th className="text-right">他者</th><th className="text-right">乖離</th></tr></thead>
              <tbody>
                {s.siteSummary.map(x => (
                  <tr key={x.key} className="border-t border-gray-100">
                    <td className="py-1">{criterionLabel(x.key)}</td><td className="text-right">{x.self ?? '—'}</td><td className="text-right">{x.others ?? '—'}</td>
                    <td className={`text-right ${x.gap != null && Math.abs(x.gap) >= 1 ? 'text-amber-700 font-bold' : 'text-gray-400'}`}>{x.gap == null ? '—' : `${x.gap > 0 ? '+' : ''}${x.gap}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {iv.previous?.goal && <div className="card text-sm"><p className="text-xs text-gray-500">前回（{d10(iv.previous.scheduledDate)}）の目標</p><p>{iv.previous.goal}</p></div>}
          {iv.guardWish && <div className="card text-sm"><p className="text-xs text-gray-500">本人の今後の希望</p><p className="whitespace-pre-wrap">{iv.guardWish}</p></div>}
          <div className="space-y-2">
            <h4 className="font-semibold text-gray-800 text-sm">指導（未指導・対象期間）</h4>
            {iv.coachingTasks.length ? iv.coachingTasks.map(t => <CoachingCard key={t.id} task={t} />) : <p className="text-xs text-gray-400">ありません</p>}
          </div>
        </div>

        {/* 右：経営者の評価 */}
        <div className="card space-y-3 h-fit">
          <h4 className="font-semibold text-gray-800 text-sm">面談の評価（5 とても良い 〜 1 課題あり）</h4>
          {!self && <p className="text-xs text-amber-700">本人の自己評価はまだ入力されていません（入力されると、ここに並べて表示されます）。</p>}
          <div className="space-y-2">
            {criteria.map(c => {
              const diff = self?.[c.key] && cur[c.key] ? self[c.key]! - cur[c.key]! : null
              return (
                <div key={c.key} className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-gray-700 w-40" title={c.hint}>{c.label}</span>
                  <span className="text-xs text-gray-500 w-16">{RATER_LABEL.SELF} {self?.[c.key] ?? '—'}</span>
                  {editable
                    ? <Scale5Buttons compact value={cur[c.key]} onChange={v => setScores(() => { const n = { ...cur }; if (v) n[c.key] = v; else delete n[c.key]; return n })} />
                    : <span className="text-sm font-bold">{cur[c.key] ?? '—'}</span>}
                  {diff != null && Math.abs(diff) >= INTERVIEW_GAP_THRESHOLD && <span className="text-[11px] text-amber-700">差 {diff > 0 ? '+' : ''}{diff}</span>}
                </div>
              )
            })}
          </div>
          <div>
            <label className="form-label">次の期間の目標（本人にも表示）</label>
            <textarea value={goal ?? iv.goal ?? ''} onChange={e => setGoal(e.target.value)} disabled={!editable} maxLength={INTERVIEW_TEXT_MAX} rows={2} className="form-input text-sm" />
          </div>
          <div>
            <label className="form-label">所見（本人には表示しません）</label>
            <textarea value={comment ?? iv.managementComment ?? ''} onChange={e => setComment(e.target.value)} disabled={!editable} maxLength={INTERVIEW_TEXT_MAX} rows={3} className="form-input text-sm" />
          </div>
          {save.isError && <p className="text-sm text-red-600">{errorOf(save.error, '保存できませんでした')}</p>}
          {editable && (
            <div className="flex gap-2 justify-end">
              <button type="button" disabled={!complete || save.isPending} onClick={() => save.mutate(false)} className="btn-secondary text-sm disabled:opacity-50">一時保存</button>
              <button type="button" disabled={!complete || save.isPending} onClick={() => { if (window.confirm('面談を実施済みにします。以後は変更できません。')) save.mutate(true) }} className="btn-primary text-sm disabled:opacity-50">面談を完了</button>
            </div>
          )}
          {editable && <p className="text-[11px] text-gray-400">完了すると、本人の自己評価と{INTERVIEW_GAP_THRESHOLD}以上差がある項目について指導タスクを作成します。</p>}
        </div>
      </div>
    </div>
  )
}
