import React, { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  EVAL_CRITERIA, RATER_CRITERIA, SITE_SCALE, INTERVIEW_SCALE, PEER_QUICK, COMMENT_MAX, INTERVIEW_TEXT_MAX, CLIENT_EVAL_WINDOW_MINUTES,
  criterionLabel, type CriterionKey, type RaterType,
} from '../../../shared/evaluation'

export type Scores = Partial<Record<CriterionKey, number>>

const SCALE_STYLE: Record<number, string> = {
  5: 'bg-green-600 text-white border-green-600',
  3: 'bg-blue-600 text-white border-blue-600',
  1: 'bg-amber-500 text-white border-amber-500',
}

// 1項目 × 3段階のボタン（同じボタンをもう一度押すと未選択に戻せる）
export function ScaleButtons({ value, onChange, compact }: { value?: number; onChange: (v: number | undefined) => void; compact?: boolean }) {
  return (
    <div className="flex gap-1">
      {SITE_SCALE.map(s => (
        <button
          key={s.value} type="button" aria-pressed={value === s.value} title={s.label}
          onClick={() => onChange(value === s.value ? undefined : s.value)}
          className={`border rounded-lg ${compact ? 'px-1.5 py-0.5 text-xs' : 'flex-1 px-2 py-2 text-sm'} ${value === s.value ? SCALE_STYLE[s.value] : 'bg-white text-gray-600 border-gray-200'}`}
        >
          {s.face}{compact ? '' : ` ${s.label}`}
        </button>
      ))}
    </div>
  )
}

// 5段階（定期面談）
export function Scale5Buttons({ value, onChange, compact }: { value?: number; onChange: (v: number | undefined) => void; compact?: boolean }) {
  return (
    <div className="flex gap-1">
      {[...INTERVIEW_SCALE].reverse().map(s => (
        <button
          key={s.value} type="button" aria-pressed={value === s.value} title={s.label}
          onClick={() => onChange(value === s.value ? undefined : s.value)}
          className={`border rounded-lg ${compact ? 'w-7 py-0.5 text-xs' : 'flex-1 py-2 text-sm'} ${value === s.value ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]' : 'bg-white text-gray-600 border-gray-200'}`}
        >
          {s.value}
        </button>
      ))}
    </div>
  )
}

export function criteriaFor(rater: RaterType) {
  return EVAL_CRITERIA.filter(c => RATER_CRITERIA[rater].includes(c.key))
}

const errorOf = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || fallback

function Sheet({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] bg-white overflow-y-auto">
      <div className="max-w-md mx-auto p-4 space-y-4 pb-10">
        <div>
          <h3 className="text-lg font-bold text-gray-800">{title}</h3>
          {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

// 本人の振り返り（報告書の提出直後に表示。全項目「普通」から始め、違う項目だけ変える）
export function SelfEvaluationSheet({ reportId, siteName, onDone }: { reportId: string; siteName?: string; onDone: () => void }) {
  const criteria = criteriaFor('SELF')
  const [scores, setScores] = useState<Scores>(() => Object.fromEntries(criteria.map(c => [c.key, 3])))
  const [comment, setComment] = useState('')
  const save = useMutation({
    mutationFn: (body: { scores: Scores; comment?: string }) => api.post(`/security-reports/${reportId}/evaluations/self`, body),
    onSuccess: onDone,
  })
  const allNormal = Object.fromEntries(criteria.map(c => [c.key, 3])) as Scores
  return (
    <Sheet title="今日の振り返り" sub={`${siteName ? `${siteName}：` : ''}自分の仕事ぶりを選んでください。上司・経営者が指導や面談の参考にします。`}>
      <button type="button" disabled={save.isPending} onClick={() => save.mutate({ scores: allNormal, comment: comment.trim() || undefined })}
        className="w-full py-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 font-medium disabled:opacity-50">
        🙂 いつも通りできた（全部「普通」で送信）
      </button>
      <p className="text-xs text-gray-400 text-center">良かった・悪かった項目があれば下で変えてから送信してください</p>
      <div className="space-y-3">
        {criteria.map(c => (
          <div key={c.key}>
            <p className="text-sm font-medium text-gray-800">{c.label}<span className="ml-2 text-xs font-normal text-gray-400">{c.hint}</span></p>
            <div className="mt-1"><ScaleButtons value={scores[c.key]} onChange={v => setScores(s => ({ ...s, [c.key]: v ?? 3 }))} /></div>
          </div>
        ))}
      </div>
      <div>
        <label className="form-label">気づき・困りごと（任意）</label>
        <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={COMMENT_MAX} rows={3} className="form-input" placeholder="例: 交代のタイミングが分かりにくかった" />
      </div>
      {save.isError && <p className="text-sm text-red-600">{errorOf(save.error, '送信できませんでした。通信状況をご確認ください。')}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onDone} className="btn-secondary flex-1">あとで</button>
        <button type="button" disabled={save.isPending} onClick={() => save.mutate({ scores, comment: comment.trim() || undefined })} className="btn-primary flex-1 disabled:opacity-50">
          {save.isPending ? '送信中...' : '送信'}
        </button>
      </div>
    </Sheet>
  )
}

// 依頼先（現場監督）の評価。サイン直後に隊員の端末を監督に渡して入力してもらう（任意）
export function ClientEvaluationSheet({ reportId, guardName, signerName, onDone }: { reportId: string; guardName?: string; signerName?: string; onDone: () => void }) {
  const criteria = criteriaFor('CLIENT')
  const [scores, setScores] = useState<Scores>({})
  const [repeatWish, setRepeatWish] = useState<boolean | null>(null)
  const [comment, setComment] = useState('')
  const save = useMutation({
    mutationFn: () => api.post(`/security-reports/${reportId}/evaluations/client`, { scores, repeatWish, comment: comment.trim() || undefined }),
    onSuccess: onDone,
  })
  const complete = criteria.every(c => scores[c.key])
  return (
    <Sheet
      title={`${signerName ? `${signerName} 様、` : ''}本日の警備はいかがでしたか`}
      sub={`サインありがとうございました。${guardName ? `警備員（${guardName}）` : '警備員'}の評価にご協力ください（任意・30秒ほど）。いただいた評価は警備会社の管理者のみが確認し、教育に役立てます。`}
    >
      <div className="space-y-3">
        {criteria.map(c => (
          <div key={c.key}>
            <p className="text-sm font-medium text-gray-800">{c.clientLabel || c.label}</p>
            <div className="mt-1"><ScaleButtons value={scores[c.key]} onChange={v => setScores(s => ({ ...s, [c.key]: v }))} /></div>
          </div>
        ))}
        <div>
          <p className="text-sm font-medium text-gray-800">また来てほしいですか</p>
          <div className="mt-1 flex gap-2">
            {[{ v: true, l: 'はい' }, { v: false, l: 'いいえ' }].map(o => (
              <button key={o.l} type="button" aria-pressed={repeatWish === o.v} onClick={() => setRepeatWish(repeatWish === o.v ? null : o.v)}
                className={`flex-1 border rounded-lg py-2 text-sm ${repeatWish === o.v ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]' : 'bg-white text-gray-600 border-gray-200'}`}>{o.l}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="form-label">ご意見（任意）</label>
          <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={COMMENT_MAX} rows={2} className="form-input" />
        </div>
      </div>
      {save.isError && <p className="text-sm text-red-600">{errorOf(save.error, '送信できませんでした')}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onDone} className="btn-secondary flex-1">スキップ</button>
        <button type="button" disabled={!complete || save.isPending} onClick={() => save.mutate()} className="btn-primary flex-1 disabled:opacity-50">
          {save.isPending ? '送信中...' : '送信'}
        </button>
      </div>
      <p className="text-[11px] text-gray-400 text-center">サインから{CLIENT_EVAL_WINDOW_MINUTES}分以内に入力できます</p>
    </Sheet>
  )
}

// 一緒に勤務した同僚の評価（1人につき 👍／—／👎 の1タップ。「詳しく」で項目ごとに変えられる）
export function PeerEvaluationSheet({ reportId, onDone }: { reportId: string; onDone: () => void }) {
  const criteria = criteriaFor('PEER')
  const { data: peers, isLoading, error } = useQuery<{ id: string; name: string; scores: Scores | null }[]>({
    queryKey: ['report-peers', reportId],
    queryFn: () => api.get(`/security-reports/${reportId}/peers`).then(r => r.data),
  })
  const [scores, setScores] = useState<Record<string, Scores>>({})
  const [detail, setDetail] = useState<string | null>(null)
  const current = (id: string) => scores[id] ?? peers?.find(p => p.id === id)?.scores ?? null
  const save = useMutation({
    mutationFn: () => api.post(`/security-reports/${reportId}/evaluations/peer`, {
      targets: Object.entries(scores).filter(([, s]) => criteria.every(c => s[c.key])).map(([guardId, s]) => ({ guardId, scores: s })),
    }),
    onSuccess: onDone,
  })
  const quick = (id: string, v: number) => setScores(m => ({ ...m, [id]: Object.fromEntries(criteria.map(c => [c.key, v])) }))
  const quickValue = (s: Scores | null) => {
    if (!s) return undefined
    const vals = criteria.map(c => s[c.key])
    return vals.every(v => v === vals[0]) ? vals[0] : undefined
  }
  if (!isLoading && !error && peers && peers.length === 0) {
    return (
      <Sheet title="一緒に働いた隊員の評価" sub="この現場で一緒に勤務した隊員はいません。">
        <button type="button" onClick={onDone} className="btn-primary w-full">閉じる</button>
      </Sheet>
    )
  }
  return (
    <Sheet title="一緒に働いた隊員の評価" sub="今日一緒に勤務した隊員について、ひとつ選んでください（任意）。誰が付けたかは本人には分かりません。">
      {isLoading && <p className="text-sm text-gray-400">読み込み中...</p>}
      {error && <p className="text-sm text-red-600">{errorOf(error, '読み込めませんでした')}</p>}
      <div className="space-y-3">
        {peers?.map(p => {
          const cur = current(p.id)
          const q = quickValue(cur)
          return (
            <div key={p.id} className="border border-gray-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium text-gray-800">{p.name}</p>
                <button type="button" onClick={() => setDetail(d => (d === p.id ? null : p.id))} className="text-xs text-blue-600">{detail === p.id ? '閉じる' : '詳しく'}</button>
              </div>
              <div className="flex gap-1">
                {PEER_QUICK.map(o => (
                  <button key={o.value} type="button" aria-pressed={q === o.value} onClick={() => quick(p.id, o.value)}
                    className={`flex-1 border rounded-lg py-2 text-xs whitespace-nowrap ${q === o.value ? SCALE_STYLE[o.value] : 'bg-white text-gray-600 border-gray-200'}`}>
                    {o.face} {o.label}
                  </button>
                ))}
              </div>
              {detail === p.id && (
                <div className="space-y-2 pt-1">
                  {criteria.map(c => (
                    <div key={c.key}>
                      <p className="text-xs text-gray-600">{c.label}</p>
                      <ScaleButtons value={cur?.[c.key]} onChange={v => setScores(m => ({ ...m, [p.id]: { ...(cur ?? {}), [c.key]: v ?? 3 } }))} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {save.isError && <p className="text-sm text-red-600">{errorOf(save.error, '送信できませんでした')}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onDone} className="btn-secondary flex-1">スキップ</button>
        <button type="button" disabled={!Object.keys(scores).length || save.isPending} onClick={() => save.mutate()} className="btn-primary flex-1 disabled:opacity-50">
          {save.isPending ? '送信中...' : '送信'}
        </button>
      </div>
    </Sheet>
  )
}

// 定期面談の前の自己評価（5段階・全項目）と今後の希望
export function InterviewSelfSheet({ interview, onDone }: { interview: { id: string; scheduledDate: string; periodFrom: string; periodTo: string; guardWish: string | null; selfScores: Scores | null }; onDone: () => void }) {
  const criteria = criteriaFor('SELF')
  const [scores, setScores] = useState<Scores>(interview.selfScores ?? {})
  const [wish, setWish] = useState(interview.guardWish ?? '')
  const save = useMutation({
    mutationFn: () => api.post(`/interviews/${interview.id}/self`, { scores, guardWish: wish.trim() || null }),
    onSuccess: onDone,
  })
  const complete = criteria.every(c => scores[c.key])
  return (
    <Sheet title="面談前の自己評価" sub={`面談日 ${interview.scheduledDate.slice(0, 10)}。${interview.periodFrom.slice(0, 10)}〜${interview.periodTo.slice(0, 10)} の自分の仕事ぶりを、5（とても良い）〜1（課題あり）で選んでください。`}>
      <div className="space-y-3">
        {criteria.map(c => (
          <div key={c.key}>
            <p className="text-sm font-medium text-gray-800">{c.label}<span className="ml-2 text-xs font-normal text-gray-400">{c.hint}</span></p>
            <div className="mt-1"><Scale5Buttons value={scores[c.key]} onChange={v => setScores(s => { const n = { ...s }; if (v) n[c.key] = v; else delete n[c.key]; return n })} /></div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400">5 とても良い ／ 4 良い ／ 3 普通 ／ 2 やや課題 ／ 1 課題あり</p>
      <div>
        <label className="form-label">今後の希望（任意）</label>
        <textarea value={wish} onChange={e => setWish(e.target.value)} maxLength={INTERVIEW_TEXT_MAX} rows={3} className="form-input" placeholder="例: 隊長を目指したい、交通誘導2級を取りたい" />
      </div>
      {save.isError && <p className="text-sm text-red-600">{errorOf(save.error, '送信できませんでした')}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onDone} className="btn-secondary flex-1">あとで</button>
        <button type="button" disabled={!complete || save.isPending} onClick={() => save.mutate()} className="btn-primary flex-1 disabled:opacity-50">{save.isPending ? '送信中...' : '送信'}</button>
      </div>
    </Sheet>
  )
}

// 上司からの指導の確認と、本人の取り組み
export function CoachingAckSheet({ task, onDone }: { task: { id: string; criterionKey: string; coachedAt: string; coachName: string | null; content: string | null }; onDone: () => void }) {
  const [commitment, setCommitment] = useState('')
  const save = useMutation({ mutationFn: () => api.post(`/coaching-tasks/${task.id}/acknowledge`, { commitment }), onSuccess: onDone })
  return (
    <Sheet title="上司からの指導" sub={`${task.coachedAt.slice(0, 10)} ${task.coachName ?? ''}／${criterionLabel(task.criterionKey)}`}>
      <p className="whitespace-pre-wrap text-sm text-gray-800 bg-gray-50 rounded-xl p-3">{task.content}</p>
      <div>
        <label className="form-label">これから取り組むこと *</label>
        <textarea value={commitment} onChange={e => setCommitment(e.target.value)} maxLength={INTERVIEW_TEXT_MAX} rows={3} className="form-input" placeholder="例: 車両が見えたらすぐに合図を出す" />
      </div>
      {save.isError && <p className="text-sm text-red-600">{errorOf(save.error, '送信できませんでした')}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onDone} className="btn-secondary flex-1">あとで</button>
        <button type="button" disabled={!commitment.trim() || save.isPending} onClick={() => save.mutate()} className="btn-primary flex-1 disabled:opacity-50">{save.isPending ? '送信中...' : '確認して送信'}</button>
      </div>
    </Sheet>
  )
}
