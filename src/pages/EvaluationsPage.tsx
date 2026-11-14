import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { format, subDays } from 'date-fns'
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, Tooltip } from 'recharts'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'
import { useEvaluationEnabled } from '../hooks/useEvaluation'
import { ScaleButtons, criteriaFor, type Scores } from '../components/evaluation/EvaluationInputs'
import {
  EVAL_CRITERIA, RATER_LABEL, NOTE_TAGS, NOTE_MAX, COMMENT_MAX, GAP_THRESHOLD, scaleLabel, criterionLabel, gapLabel,
  type CriterionKey, type CriterionSummary, type RaterType,
} from '../../shared/evaluation'

interface Ev { id: string; raterType: RaterType; raterKey?: string; raterName: string; raterTitle?: string | null; scores: Scores; comment: string | null; repeatWish: boolean | null }
interface PendingReport {
  id: string; reportDate: string; signedAt: string | null
  guard: { id: string; name: string; employeeNumber: string }; site: { id: string; name: string }
  evaluations: Ev[]; mine: Ev | null; noteCount: number
}

const errorOf = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || fallback
const scoreText = (s: Scores, keys: CriterionKey[]) => keys.filter(k => s[k]).map(k => `${criterionLabel(k)}:${scaleLabel(s[k]!)}`).join(' / ')

export default function EvaluationsPage() {
  const enabled = useEvaluationEnabled()
  const [params, setParams] = useSearchParams()
  const tab = params.get('guard') ? 'guard' : (params.get('tab') ?? 'pending')
  const setTab = (t: string) => setParams(t === 'pending' ? {} : { tab: t })

  if (!enabled) {
    return <div className="p-6"><div className="card text-center py-10 text-gray-500">評価機能はこの会社では利用できません。</div></div>
  }
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-800">隊員評価</h1>
        <p className="text-xs text-gray-500">現場が完了するごと（警備報告書の提出ごと）に、本人の振り返り・依頼先の評価・上司の評価を同じ6項目で集めます。</p>
      </div>
      <div className="flex gap-1 border-b border-gray-200">
        {[{ k: 'pending', l: '現場ごとの評価' }, { k: 'guard', l: '隊員別' }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === t.k ? 'border-[#1e3a5f] text-[#1e3a5f] font-medium' : 'border-transparent text-gray-500'}`}>{t.l}</button>
        ))}
      </div>
      {tab === 'pending' ? <PendingTab /> : <GuardTab guardId={params.get('guard') ?? ''} onSelect={id => setParams(id ? { guard: id } : { tab: 'guard' })} />}
    </div>
  )
}

// ─── 現場ごとの評価（上司がまとめて入力） ───
function PendingTab() {
  const [from, setFrom] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'))
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [onlyTodo, setOnlyTodo] = useState(true)
  const [noteFor, setNoteFor] = useState<PendingReport | null>(null)
  const { data, isLoading, error } = useQuery<{ reports: PendingReport[] }>({
    queryKey: ['evaluations-pending', from, to],
    queryFn: () => api.get('/evaluations/pending', { params: { from, to } }).then(r => r.data),
  })
  const reports = (data?.reports ?? []).filter(r => !onlyTodo || !r.mine)
  const todo = (data?.reports ?? []).filter(r => !r.mine).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="w-40"><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="form-input text-sm" /></div>
        <span>〜</span>
        <div className="w-40"><input type="date" value={to} onChange={e => setTo(e.target.value)} className="form-input text-sm" /></div>
        <label className="flex items-center gap-1 ml-2"><input type="checkbox" checked={onlyTodo} onChange={e => setOnlyTodo(e.target.checked)} />自分が未評価のみ</label>
        <span className="ml-auto text-xs text-gray-500">評価待ち <b className="text-gray-800">{todo}</b> 件</span>
      </div>
      {error && <div className="card text-sm text-red-600">{errorOf(error, '読み込めませんでした')}</div>}
      {isLoading && <div className="card text-center py-8 text-gray-400">読み込み中...</div>}
      {data && reports.length === 0 && <div className="card text-center py-8 text-gray-400">{onlyTodo ? '評価待ちの現場はありません' : '対象期間の報告書はありません'}</div>}
      <div className="space-y-2">
        {reports.map(r => <PendingRow key={r.id} report={r} onNote={() => setNoteFor(r)} />)}
      </div>
      {noteFor && (
        <Modal title={`申し送り：${noteFor.guard.name}`} onClose={() => setNoteFor(null)}>
          <ConfidentialNotes guardId={noteFor.guard.id} reportId={noteFor.id} reportLabel={`${noteFor.reportDate.slice(0, 10)} ${noteFor.site.name}`} />
        </Modal>
      )}
    </div>
  )
}

function PendingRow({ report: r, onNote }: { report: PendingReport; onNote: () => void }) {
  const qc = useQueryClient()
  const criteria = criteriaFor('SUPERVISOR')
  const [open, setOpen] = useState(!r.mine)
  const [scores, setScores] = useState<Scores>(r.mine?.scores ?? {})
  const [comment, setComment] = useState(r.mine?.comment ?? '')
  const save = useMutation({
    mutationFn: () => api.put(`/security-reports/${r.id}/evaluations/supervisor`, { scores, comment: comment.trim() || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['evaluations-pending'] }); setOpen(false) },
  })
  const self = r.evaluations.find(e => e.raterType === 'SELF')
  const client = r.evaluations.find(e => e.raterType === 'CLIENT')
  const setAll = (v: number) => setScores(Object.fromEntries(criteria.map(c => [c.key, v])))
  const chip = (label: string, done: boolean) => <span className={`text-[11px] px-1.5 py-0.5 rounded ${done ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'}`}>{done ? '✓' : '—'} {label}</span>

  return (
    <div className="card p-0">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
        <span className="text-xs text-gray-500 w-20">{r.reportDate.slice(0, 10)}</span>
        <span className="font-medium text-gray-800">{r.guard.name}</span>
        <span className="text-sm text-gray-500">{r.site.name}</span>
        <span className="flex gap-1 ml-auto">
          {chip('本人', !!self)}
          {chip(`依頼先${client?.repeatWish === true ? '（また来てほしい）' : client?.repeatWish === false ? '（希望なし）' : ''}`, !!client)}
          {chip('上司（自分）', !!r.mine)}
          {r.noteCount > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-50 text-red-700">🔒 申し送り {r.noteCount}</span>}
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          {(self || client) && (
            <div className="text-xs text-gray-600 space-y-1 bg-gray-50 rounded-lg p-2">
              {self && <p><b>本人:</b> {scoreText(self.scores, criteria.map(c => c.key))}{self.comment && <span className="block text-gray-500">「{self.comment}」</span>}</p>}
              {client && <p><b>依頼先（{client.raterName}）:</b> {scoreText(client.scores, criteriaFor('CLIENT').map(c => c.key))}{client.comment && <span className="block text-gray-500">「{client.comment}」</span>}</p>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">まとめて:</span>
            <button type="button" onClick={() => setAll(5)} className="text-xs px-2 py-1 rounded border border-green-200 text-green-700">😊 全部良い</button>
            <button type="button" onClick={() => setAll(3)} className="text-xs px-2 py-1 rounded border border-blue-200 text-blue-700">🙂 全部普通</button>
            <span className="text-[11px] text-gray-400">付けた項目だけ保存されます</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
            {criteria.map(c => (
              <div key={c.key} className="flex items-center justify-between gap-2">
                <span className="text-sm text-gray-700" title={c.hint}>{c.label}</span>
                <ScaleButtons compact value={scores[c.key]} onChange={v => setScores(s => { const n = { ...s }; if (v) n[c.key] = v; else delete n[c.key]; return n })} />
              </div>
            ))}
          </div>
          <input value={comment} onChange={e => setComment(e.target.value)} maxLength={COMMENT_MAX} className="form-input text-sm" placeholder="ひとこと（任意。本人には表示されません）" />
          {save.isError && <p className="text-sm text-red-600">{errorOf(save.error, '保存できませんでした')}</p>}
          <div className="flex items-center gap-2">
            <button type="button" onClick={onNote} className="text-xs px-3 py-1.5 rounded border border-red-200 text-red-700">🔒 申し送りを書く</button>
            <Link to={`/evaluations?guard=${r.guard.id}`} className="text-xs text-blue-600">この隊員の評価を見る</Link>
            <button type="button" disabled={!Object.keys(scores).length || save.isPending} onClick={() => save.mutate()} className="btn-primary text-sm ml-auto disabled:opacity-50">
              {save.isPending ? '保存中...' : r.mine ? '更新' : '保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 隊員別 ───
function GuardTab({ guardId, onSelect }: { guardId: string; onSelect: (id: string) => void }) {
  const { data: guards = [] } = useQuery<any[]>({ queryKey: ['guards-active'], queryFn: () => api.get('/guards?isActive=true').then(r => r.data) })
  const { data, isLoading, error } = useQuery<{ summary: CriterionSummary[]; repeatWish: { yes: number; total: number }; evaluations: (Ev & { evalDate: string; siteName: string | null })[]; from: string; to: string }>({
    queryKey: ['guard-evaluations', guardId],
    queryFn: () => api.get(`/guards/${guardId}/evaluations`).then(r => r.data),
    enabled: !!guardId,
  })
  const chart = (data?.summary ?? []).map(s => ({ item: criterionLabel(s.key), 本人: s.self ?? 0, 他者: s.others ?? 0 }))
  const raters: RaterType[] = ['SELF', 'SUPERVISOR', 'CLIENT']

  return (
    <div className="space-y-4">
      <div className="max-w-sm">
        <select value={guardId} onChange={e => onSelect(e.target.value)} className="form-input">
          <option value="">隊員を選択</option>
          {guards.map(g => <option key={g.id} value={g.id}>{g.employeeNumber} {g.name}</option>)}
        </select>
      </div>
      {error && <div className="card text-sm text-red-600">{errorOf(error, '読み込めませんでした')}</div>}
      {isLoading && guardId && <div className="card text-center py-8 text-gray-400">読み込み中...</div>}
      {data && (
        <>
          <p className="text-xs text-gray-500">{data.from} 〜 {data.to} の評価（{data.evaluations.length}件）。点数は 良い=5・普通=3・要改善=1 の平均です。</p>
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="font-semibold text-gray-800 mb-2">本人と他者の比較</h3>
              {data.evaluations.length ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={chart} outerRadius="70%">
                      <PolarGrid />
                      <PolarAngleAxis dataKey="item" tick={{ fontSize: 11 }} />
                      <PolarRadiusAxis domain={[0, 5]} tickCount={6} tick={{ fontSize: 10 }} />
                      <Radar name="本人" dataKey="本人" stroke="#e67e22" fill="#e67e22" fillOpacity={0.15} />
                      <Radar name="他者（上司・依頼先）" dataKey="他者" stroke="#1e3a5f" fill="#1e3a5f" fillOpacity={0.25} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Tooltip />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="text-sm text-gray-400 py-8 text-center">まだ評価がありません</p>}
            </div>
            <div className="card p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2">項目</th>
                    {raters.map(r => <th key={r} className="text-right px-3 py-2 whitespace-nowrap">{RATER_LABEL[r]}</th>)}
                    <th className="text-right px-3 py-2 whitespace-nowrap">他者平均</th>
                    <th className="text-right px-3 py-2 whitespace-nowrap">乖離</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.summary.map(s => {
                    const flagged = s.gap != null && Math.abs(s.gap) >= GAP_THRESHOLD
                    return (
                      <tr key={s.key} className={flagged ? 'bg-amber-50' : ''}>
                        <td className="px-3 py-2">{criterionLabel(s.key)}</td>
                        {raters.map(r => <td key={r} className="px-3 py-2 text-right whitespace-nowrap">{s.byRater[r] ? <>{s.byRater[r]!.avg}<span className="text-[10px] text-gray-400">（{s.byRater[r]!.count}）</span></> : <span className="text-gray-300">—</span>}</td>)}
                        <td className="px-3 py-2 text-right font-medium">{s.others ?? '—'}</td>
                        <td className={`px-3 py-2 text-right ${flagged ? 'text-amber-700 font-bold' : 'text-gray-500'}`} title={gapLabel(s.gap)}>
                          {s.gap == null ? '—' : `${s.gap > 0 ? '+' : ''}${s.gap}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="px-3 py-2 text-[11px] text-gray-500 space-y-0.5">
                <p>乖離 = 本人 − 他者平均。±{GAP_THRESHOLD} 以上を黄色で表示します（＋は本人の評価が高い＝過大評価、−は低い＝過小評価）。</p>
                {data.repeatWish.total > 0 && <p>依頼先の「また来てほしい」: {data.repeatWish.yes} / {data.repeatWish.total} 件</p>}
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="font-semibold text-gray-800 mb-2">評価の履歴</h3>
              <div className="divide-y divide-gray-100 max-h-[28rem] overflow-y-auto">
                {data.evaluations.map(e => (
                  <div key={e.id} className="py-2 text-xs">
                    <p className="text-gray-500">{e.evalDate.slice(0, 10)} {e.siteName} <span className="ml-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{RATER_LABEL[e.raterType]}</span> {e.raterType !== 'SELF' && e.raterName}{e.repeatWish != null && <span className="ml-1">{e.repeatWish ? '・また来てほしい' : '・再依頼の希望なし'}</span>}</p>
                    <p className="text-gray-700">{scoreText(e.scores, EVAL_CRITERIA.map(c => c.key))}</p>
                    {e.comment && <p className="text-gray-500">「{e.comment}」</p>}
                  </div>
                ))}
                {!data.evaluations.length && <p className="text-sm text-gray-400 py-4 text-center">まだ評価がありません</p>}
              </div>
            </div>
            <div className="card">
              <ConfidentialNotes guardId={guardId} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── 申し送り（経営者・上司のみ） ───
function ConfidentialNotes({ guardId, reportId, reportLabel }: { guardId: string; reportId?: string; reportLabel?: string }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)
  const { data: notes = [], isLoading } = useQuery<any[]>({
    queryKey: ['confidential-notes', guardId],
    queryFn: () => api.get(`/guards/${guardId}/confidential-notes`).then(r => r.data),
  })
  const { data: log = [] } = useQuery<any[]>({
    queryKey: ['confidential-notes-log', guardId],
    queryFn: () => api.get(`/guards/${guardId}/confidential-notes/access-log`).then(r => r.data),
    enabled: showLog,
  })
  const add = useMutation({
    mutationFn: () => api.post(`/guards/${guardId}/confidential-notes`, { body, tags, securityReportId: reportId ?? null }),
    onSuccess: () => { setBody(''); setTags([]); qc.invalidateQueries({ queryKey: ['confidential-notes', guardId] }); qc.invalidateQueries({ queryKey: ['evaluations-pending'] }) },
  })
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/confidential-notes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['confidential-notes', guardId] }); qc.invalidateQueries({ queryKey: ['evaluations-pending'] }) },
  })
  const ACTION: Record<string, string> = { VIEW: '閲覧', CREATE: '作成', DELETE: '削除' }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold text-gray-800">🔒 申し送り事項</h3>
        <p className="text-[11px] text-red-700">経営者・上司（管理者・マネージャー）のみ閲覧できます。本人・同僚・依頼先には表示されません。閲覧・作成・削除は記録されます。本人から開示を求められる場合もあるため、事実を中心に記載してください。</p>
      </div>
      <div className="space-y-2">
        {reportLabel && <p className="text-xs text-gray-500">対象の現場: {reportLabel}</p>}
        <div className="flex flex-wrap gap-1">
          {NOTE_TAGS.map(t => (
            <button key={t} type="button" aria-pressed={tags.includes(t)} onClick={() => setTags(ts => ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t])}
              className={`text-xs px-2 py-1 rounded-full border ${tags.includes(t) ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-200'}`}>{t}</button>
          ))}
        </div>
        <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={NOTE_MAX} rows={3} className="form-input text-sm" placeholder="例: 5/12 現場監督から休憩の取り方について指摘あり。本人には未伝達。" />
        {add.isError && <p className="text-sm text-red-600">{errorOf(add.error, '保存できませんでした')}</p>}
        <div className="text-right"><button type="button" disabled={!body.trim() || add.isPending} onClick={() => add.mutate()} className="btn-primary text-sm disabled:opacity-50">申し送りを保存</button></div>
      </div>
      <div className="divide-y divide-gray-100">
        {isLoading && <p className="text-sm text-gray-400">読み込み中...</p>}
        {notes.map(n => (
          <div key={n.id} className="py-2 text-sm">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>{format(new Date(n.createdAt), 'yyyy/M/d HH:mm')}</span><span>{n.authorName}</span>
              {n.securityReport && <span>（{n.securityReport.reportDate.slice(0, 10)} {n.securityReport.site?.name}）</span>}
              {(n.authorUserId === user?.id || hasRole(user, 'ADMIN')) && (
                <button type="button" onClick={() => { if (window.confirm('この申し送りを削除しますか？')) del.mutate(n.id) }} className="ml-auto text-red-600">削除</button>
              )}
            </div>
            {n.tags?.length > 0 && <div className="flex gap-1 mt-0.5">{n.tags.map((t: string) => <span key={t} className="text-[10px] px-1.5 rounded bg-red-50 text-red-700">{t}</span>)}</div>}
            <p className="whitespace-pre-wrap text-gray-800 mt-0.5">{n.body}</p>
          </div>
        ))}
        {!isLoading && !notes.length && <p className="text-sm text-gray-400 py-2">申し送りはありません</p>}
      </div>
      {hasRole(user, 'ADMIN') && (
        <div>
          <button type="button" onClick={() => setShowLog(s => !s)} className="text-xs text-blue-600">{showLog ? '閲覧記録を閉じる' : '閲覧記録を見る'}</button>
          {showLog && (
            <div className="mt-1 max-h-40 overflow-y-auto text-[11px] text-gray-600">
              {log.map(l => <p key={l.id}>{format(new Date(l.createdAt), 'yyyy/M/d HH:mm')} {l.userName} {ACTION[l.action] ?? l.action}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-lg my-8">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
