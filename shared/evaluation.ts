// 隊員評価 SSOT（評価項目・物差し・評価者ごとの項目・集計。server/evaluation.ts と画面が参照する）
// 全評価者が同じ6項目の上で評価し、本人と他者の点数の差（乖離）を比べられるようにする。
import { z } from 'zod'

export const EVAL_CRITERIA = [
  { key: 'discipline', label: '時間・規律', hint: '時間前の行動、遅刻・欠勤がない', clientLabel: '時間を守っていた' },
  { key: 'manner', label: '身だしなみ・挨拶', hint: '身だしなみ、挨拶、言葉遣い', clientLabel: '挨拶・身だしなみ・言葉遣い' },
  { key: 'safety', label: '安全・業務の的確さ', hint: '誘導の的確さ、ルールの理解', clientLabel: '誘導・業務が的確だった' },
  { key: 'communication', label: '報告・連絡・相談', hint: '必要なことを適切に伝えている', clientLabel: '' },
  { key: 'teamwork', label: '協調性・チームワーク', hint: '周囲と協力して動けている', clientLabel: '' },
  { key: 'initiative', label: '主体性・改善意欲', hint: '言われる前に動く、改善しようとする', clientLabel: '' },
] as const
export type CriterionKey = (typeof EVAL_CRITERIA)[number]['key']
export const CRITERION_KEYS = EVAL_CRITERIA.map(c => c.key) as CriterionKey[]
export const criterionLabel = (k: string) => EVAL_CRITERIA.find(c => c.key === k)?.label ?? k

export const RATER_TYPES = ['SELF', 'SUPERVISOR', 'CLIENT', 'PEER', 'MANAGEMENT'] as const
export type RaterType = (typeof RATER_TYPES)[number]
export const RATER_LABEL: Record<RaterType, string> = {
  SELF: '本人', SUPERVISOR: '上司', CLIENT: '依頼先', PEER: '同僚', MANAGEMENT: '経営者面談',
}
// 他者評価に含める評価者（本人以外）
export const OTHER_RATERS: RaterType[] = ['SUPERVISOR', 'CLIENT', 'PEER', 'MANAGEMENT']

// 評価者ごとに表示する項目（見て判断できる項目だけ）
export const RATER_CRITERIA: Record<RaterType, CriterionKey[]> = {
  SELF: CRITERION_KEYS,
  SUPERVISOR: CRITERION_KEYS,
  CLIENT: ['discipline', 'manner', 'safety'],
  PEER: ['safety', 'communication', 'teamwork'],
  MANAGEMENT: CRITERION_KEYS,
}

// 現場ごとの評価は3段階（入力の負担を減らすため）。点数は5段階の面談と同じ物差しに揃える
export const SITE_SCALE = [
  { value: 5, label: '良い', face: '😊' },
  { value: 3, label: '普通', face: '🙂' },
  { value: 1, label: '要改善', face: '😟' },
] as const
export const SITE_SCALE_VALUES = SITE_SCALE.map(s => s.value) as number[]
export const scaleLabel = (v: number) => SITE_SCALE.find(s => s.value === v)?.label ?? String(v)

// 定期面談は5段階（現場ごとの評価と同じ数値の物差し）
export const INTERVIEW_SCALE = [
  { value: 5, label: 'とても良い' },
  { value: 4, label: '良い' },
  { value: 3, label: '普通' },
  { value: 2, label: 'やや課題' },
  { value: 1, label: '課題あり' },
] as const
export const INTERVIEW_SCALE_VALUES = INTERVIEW_SCALE.map(s => s.value) as number[]
export type EvalScale = 'site' | 'interview'

// 依頼先がサインした後、評価を受け付ける時間（隊員の端末で監督に入力してもらうため）
export const CLIENT_EVAL_WINDOW_MINUTES = 30

export const NOTE_TAGS = ['体調', '人間関係', '顧客クレーム', '安全上の懸念', 'その他'] as const
export const NOTE_MAX = 1000
export const COMMENT_MAX = 300

// 本人の点数 − 他者の点数 がこの値以上離れていたら「乖離」として目立たせる（第2段階で指導タスクに使う）
export const GAP_THRESHOLD = 1.0

// 評価の入力。scores は評価者に表示した項目だけを受け付ける
export function evaluationInputSchema(rater: RaterType, opts: { requireAll: boolean; scale?: EvalScale }) {
  const allowed = RATER_CRITERIA[rater]
  const values = opts.scale === 'interview' ? INTERVIEW_SCALE_VALUES : SITE_SCALE_VALUES
  return z.object({
    scores: z.record(z.string(), z.number()).superRefine((s, ctx) => {
      const keys = Object.keys(s)
      if (keys.some(k => !allowed.includes(k as CriterionKey))) ctx.addIssue({ code: 'custom', message: '評価項目が不正です' })
      if (Object.values(s).some(v => !values.includes(v))) ctx.addIssue({ code: 'custom', message: '点数が不正です' })
      if (opts.requireAll ? allowed.some(k => !(k in s)) : keys.length === 0) ctx.addIssue({ code: 'custom', message: '評価を入力してください' })
    }),
    comment: z.string().max(COMMENT_MAX).optional().nullable(),
    repeatWish: z.boolean().optional().nullable(),
    raterName: z.string().max(50).optional().nullable(),
    raterTitle: z.string().max(50).optional().nullable(),
  })
}

export const noteInputSchema = z.object({
  body: z.string().trim().min(1, '内容を入力してください').max(NOTE_MAX, `${NOTE_MAX}文字以内で入力してください`),
  tags: z.array(z.enum(NOTE_TAGS)).max(NOTE_TAGS.length).default([]),
  securityReportId: z.string().optional().nullable(),
})

// ─── 集計 ───
export interface EvaluationLike { raterType: RaterType; scores: Record<string, number> }
export interface CriterionSummary {
  key: CriterionKey
  byRater: Partial<Record<RaterType, { avg: number; count: number }>>
  self: number | null
  others: number | null // 本人以外の全評価の平均
  gap: number | null    // self − others（＋は本人のほうが高い＝過大評価、−は過小評価）
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function summarizeEvaluations(evals: EvaluationLike[]): CriterionSummary[] {
  return CRITERION_KEYS.map(key => {
    const acc: Partial<Record<RaterType, { sum: number; count: number }>> = {}
    const others = { sum: 0, count: 0 }
    for (const e of evals) {
      const v = e.scores?.[key]
      if (typeof v !== 'number') continue
      const a = (acc[e.raterType] ??= { sum: 0, count: 0 })
      a.sum += v; a.count++
      if (e.raterType !== 'SELF') { others.sum += v; others.count++ }
    }
    const byRater: CriterionSummary['byRater'] = {}
    for (const [r, a] of Object.entries(acc)) byRater[r as RaterType] = { avg: round1(a!.sum / a!.count), count: a!.count }
    const self = byRater.SELF?.avg ?? null
    const oth = others.count ? round1(others.sum / others.count) : null
    return { key, byRater, self, others: oth, gap: self != null && oth != null ? round1(self - oth) : null }
  })
}

export const gapLabel = (gap: number | null) =>
  gap == null || Math.abs(gap) < GAP_THRESHOLD ? '' : gap > 0 ? '本人の評価が高い（過大評価）' : '本人の評価が低い（過小評価）'

// ─── 同僚評価 ───
// 1人の同僚につき 👍／—／👎 の1タップ（同僚に表示する項目すべてに同じ点数を付ける）。詳しく付けたいときは項目ごとに変えられる
export const PEER_QUICK = [
  { value: 5, label: '頼りになった', face: '👍' },
  { value: 3, label: 'ふつう', face: '—' },
  { value: 1, label: '気になった', face: '👎' },
] as const
// 本人（隊員）に同僚評価を見せる場合は、この人数以上の平均のみ（第3段階で使用）
export const PEER_MIN_RATERS = 2

// ─── 定期面談 ───
export const INTERVIEW_STATUS = { SCHEDULED: '予定', COMPLETED: '実施済み', CANCELLED: '中止' } as const
export type InterviewStatus = keyof typeof INTERVIEW_STATUS
export const INTERVIEW_DEFAULT_PERIOD_MONTHS = 3
export const INTERVIEW_TEXT_MAX = 1000

// ─── 乖離の検知と指導タスク ───
export const COACHING_STATUS = { OPEN: '未指導', COACHED: '指導済み', DISMISSED: '対応不要' } as const
export type CoachingStatus = keyof typeof COACHING_STATUS
export const COACHING_METHODS = ['面談', '現場での指導', '電話', 'その他'] as const
export const COACHING_DUE_DAYS = 7        // 検知から指導までの期限
export const COACHING_FOLLOW_UP_DAYS = 30 // 指導から変化を確認するまで（この間は同じ項目で再検知しない）
// 現場ごとの評価：本人と他者の両方がある直近 SITE_WINDOW 回のうち、同じ向きに GAP_THRESHOLD 以上離れた回が SITE_MIN_HITS 回以上
export const SITE_WINDOW = 5
export const SITE_MIN_HITS = 3
// 面談：5段階で本人と経営者の差がこの値以上
export const INTERVIEW_GAP_THRESHOLD = 2
export type GapDirection = 'OVER' | 'UNDER'
export const DIRECTION_LABEL: Record<GapDirection, string> = { OVER: '本人の評価が高い（過大評価）', UNDER: '本人の評価が低い（過小評価）' }
export const DIRECTION_SHORT: Record<GapDirection, string> = { OVER: '過大評価', UNDER: '過小評価' }

// 指導の方針（過大評価は気づきを促す、過小評価は自信をつける）と文例
export const COACHING_GUIDE: Record<GapDirection, string> = {
  OVER: '周りから見た状態に気づいてもらう指導。具体的な場面と、周りの評価を事実として伝え、次に何をするかを本人と決める。',
  UNDER: '自信をつける指導。周りが評価している点を具体的に伝え、できていることを認める。',
}
export function coachingTemplate(criterion: string, direction: GapDirection): string {
  const label = criterionLabel(criterion)
  return direction === 'OVER'
    ? `「${label}」について、本人の自己評価に比べて周り（上司・依頼先・同僚）の評価が低い状態が続いています。\n具体的な場面: \n次の現場から取り組むこと: `
    : `「${label}」について、周り（上司・依頼先・同僚）はよくできていると評価しています。自信を持って続けてください。\n評価されている点: `
}

export interface SiteEvalPoint { date: string; siteId: string | null; raterType: RaterType; scores: Record<string, number> }
export interface DetectedGap {
  criterionKey: CriterionKey
  direction: GapDirection
  gap: number
  evidence: { date: string; self: number; others: number }[]
}

// 現場ごとの評価から乖離の続いている項目を探す。同じ日・同じ現場の評価を1回の現場として扱う
export function detectSiteGaps(points: SiteEvalPoint[]): DetectedGap[] {
  const events = new Map<string, { date: string; self: Record<string, number> | null; others: Record<string, number>[] }>()
  for (const p of points) {
    const key = `${p.date}|${p.siteId ?? ''}`
    const ev = events.get(key) ?? { date: p.date, self: null, others: [] }
    if (p.raterType === 'SELF') ev.self = p.scores
    else if (p.raterType !== 'MANAGEMENT') ev.others.push(p.scores)
    events.set(key, ev)
  }
  const sorted = [...events.values()].sort((a, b) => (a.date < b.date ? 1 : -1)) // 新しい順
  const found: DetectedGap[] = []
  for (const key of CRITERION_KEYS) {
    const pairs: { date: string; self: number; others: number }[] = []
    for (const ev of sorted) {
      const self = ev.self?.[key]
      const vals = ev.others.map(o => o[key]).filter((v): v is number => typeof v === 'number')
      if (typeof self !== 'number' || !vals.length) continue
      pairs.push({ date: ev.date, self, others: round1(vals.reduce((a, b) => a + b, 0) / vals.length) })
      if (pairs.length === SITE_WINDOW) break
    }
    for (const direction of ['OVER', 'UNDER'] as GapDirection[]) {
      const hits = pairs.filter(x => (direction === 'OVER' ? x.self - x.others : x.others - x.self) >= GAP_THRESHOLD)
      if (hits.length >= SITE_MIN_HITS) {
        found.push({ criterionKey: key, direction, gap: round1(hits.reduce((a, x) => a + x.self - x.others, 0) / hits.length), evidence: pairs })
      }
    }
  }
  return found
}

// 面談の本人と経営者の評価の差
export function detectInterviewGaps(self: Record<string, number>, management: Record<string, number>, date: string): DetectedGap[] {
  const found: DetectedGap[] = []
  for (const key of CRITERION_KEYS) {
    const s = self[key], m = management[key]
    if (typeof s !== 'number' || typeof m !== 'number' || Math.abs(s - m) < INTERVIEW_GAP_THRESHOLD) continue
    found.push({ criterionKey: key, direction: s > m ? 'OVER' : 'UNDER', gap: s - m, evidence: [{ date, self: s, others: m }] })
  }
  return found
}

export const coachingInputSchema = z.object({
  method: z.enum(COACHING_METHODS),
  content: z.string().trim().min(1, '指導内容を入力してください').max(NOTE_MAX),
  coachedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
})
