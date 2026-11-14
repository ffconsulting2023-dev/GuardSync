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

// 依頼先がサインした後、評価を受け付ける時間（隊員の端末で監督に入力してもらうため）
export const CLIENT_EVAL_WINDOW_MINUTES = 30

export const NOTE_TAGS = ['体調', '人間関係', '顧客クレーム', '安全上の懸念', 'その他'] as const
export const NOTE_MAX = 1000
export const COMMENT_MAX = 300

// 本人の点数 − 他者の点数 がこの値以上離れていたら「乖離」として目立たせる（第2段階で指導タスクに使う）
export const GAP_THRESHOLD = 1.0

// 評価の入力。scores は評価者に表示した項目だけを受け付ける
export function evaluationInputSchema(rater: RaterType, opts: { requireAll: boolean }) {
  const allowed = RATER_CRITERIA[rater]
  return z.object({
    scores: z.record(z.string(), z.number()).superRefine((s, ctx) => {
      const keys = Object.keys(s)
      if (keys.some(k => !allowed.includes(k as CriterionKey))) ctx.addIssue({ code: 'custom', message: '評価項目が不正です' })
      if (Object.values(s).some(v => !SITE_SCALE_VALUES.includes(v))) ctx.addIssue({ code: 'custom', message: '点数が不正です' })
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
