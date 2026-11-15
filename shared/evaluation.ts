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
export interface EvaluationLike { raterType: RaterType; scores: Record<string, number>; raterKey?: string | null; siteId?: string | null }

// ─── 評価者の甘い・辛いの補正 ───
// 評価者ごとの平均が全体の平均からずれている分の一部を差し引く（甘い評価者は下げ、辛い評価者は上げる）
export const RATER_MIN_COUNT = 10   // これ未満の点数しか付けていない評価者は補正しない
export const RATER_CORRECTION_RATE = 0.5
export const RATER_WINDOW_DAYS = 180

// 評価者の識別：上司はユーザー、依頼先は現場（現場ごとに監督が同じため）、同僚は評価した隊員
export function raterIdentity(e: { raterType: RaterType; raterKey?: string | null; siteId?: string | null }): string | null {
  if (e.raterType === 'SUPERVISOR') return e.raterKey ? `S:${e.raterKey}` : null
  if (e.raterType === 'CLIENT') return e.siteId ? `C:${e.siteId}` : null
  if (e.raterType === 'PEER') return e.raterKey ? `P:${e.raterKey.split(':')[0]}` : null
  return null
}

export type RaterOffsets = Record<string, number>
export function computeRaterOffsets(evals: EvaluationLike[]): RaterOffsets {
  const all = { sum: 0, count: 0 }
  const by = new Map<string, { sum: number; count: number }>()
  for (const e of evals) {
    const id = raterIdentity(e)
    if (!id) continue
    for (const v of Object.values(e.scores ?? {})) {
      if (typeof v !== 'number') continue
      all.sum += v; all.count++
      const a = by.get(id) ?? { sum: 0, count: 0 }
      a.sum += v; a.count++
      by.set(id, a)
    }
  }
  const out: RaterOffsets = {}
  if (!all.count) return out
  const mean = all.sum / all.count
  for (const [id, a] of by) {
    if (a.count < RATER_MIN_COUNT) continue
    const off = round2((a.sum / a.count - mean) * RATER_CORRECTION_RATE)
    if (off !== 0) out[id] = off
  }
  return out
}
// 補正後の点数（1〜5に収める）
export function correctedScore(v: number, e: { raterType: RaterType; raterKey?: string | null; siteId?: string | null }, offsets?: RaterOffsets): number {
  const id = offsets ? raterIdentity(e) : null
  const off = id ? offsets![id] ?? 0 : 0
  return Math.min(5, Math.max(1, v - off))
}
export interface CriterionSummary {
  key: CriterionKey
  byRater: Partial<Record<RaterType, { avg: number; count: number }>>
  self: number | null
  others: number | null // 本人以外の全評価の平均（offsets を渡した場合は評価者の補正後）
  othersRaw: number | null // 補正前
  gap: number | null    // self − others（＋は本人のほうが高い＝過大評価、−は過小評価）
}

function round1(n: number) { return Math.round(n * 10) / 10 }
function round2(n: number) { return Math.round(n * 100) / 100 }

export function summarizeEvaluations(evals: EvaluationLike[], offsets?: RaterOffsets): CriterionSummary[] {
  return CRITERION_KEYS.map(key => {
    const acc: Partial<Record<RaterType, { sum: number; count: number }>> = {}
    const others = { sum: 0, raw: 0, count: 0 }
    for (const e of evals) {
      const v = e.scores?.[key]
      if (typeof v !== 'number') continue
      const a = (acc[e.raterType] ??= { sum: 0, count: 0 })
      a.sum += v; a.count++
      if (e.raterType !== 'SELF') { others.sum += correctedScore(v, e, offsets); others.raw += v; others.count++ }
    }
    const byRater: CriterionSummary['byRater'] = {}
    for (const [r, a] of Object.entries(acc)) byRater[r as RaterType] = { avg: round1(a!.sum / a!.count), count: a!.count }
    const self = byRater.SELF?.avg ?? null
    const oth = others.count ? round1(others.sum / others.count) : null
    return { key, byRater, self, others: oth, othersRaw: others.count ? round1(others.raw / others.count) : null, gap: self != null && oth != null ? round1(self - oth) : null }
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
export const COACHING_STATUS = { OPEN: '未指導', COACHED: '指導済み', CLOSED: '結果確定', DISMISSED: '対応不要' } as const
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

export interface SiteEvalPoint { date: string; siteId: string | null; raterType: RaterType; raterKey?: string | null; scores: Record<string, number> }
export interface DetectedGap {
  criterionKey: CriterionKey
  direction: GapDirection
  gap: number
  evidence: { date: string; self: number; others: number }[]
}

// 同じ日・同じ現場の評価を1回の現場（イベント）にまとめ、項目ごとに本人と他者（補正後の平均）を並べる。新しい順
export interface SitePair { date: string; self: number | null; others: number | null }
export function siteEventPairs(points: SiteEvalPoint[], key: CriterionKey, offsets?: RaterOffsets): SitePair[] {
  const events = new Map<string, { date: string; self: number | null; others: number[] }>()
  for (const p of points) {
    if (p.raterType === 'MANAGEMENT') continue
    const v = p.scores?.[key]
    const k = `${p.date}|${p.siteId ?? ''}`
    const ev = events.get(k) ?? { date: p.date, self: null, others: [] }
    if (typeof v === 'number') {
      if (p.raterType === 'SELF') ev.self = v
      else ev.others.push(correctedScore(v, p, offsets))
    }
    events.set(k, ev)
  }
  return [...events.values()]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(e => ({ date: e.date, self: e.self, others: e.others.length ? round1(e.others.reduce((a, b) => a + b, 0) / e.others.length) : null }))
}

// 現場ごとの評価から乖離の続いている項目を探す（他者の点数は評価者の補正後）
export function detectSiteGaps(points: SiteEvalPoint[], offsets?: RaterOffsets): DetectedGap[] {
  const found: DetectedGap[] = []
  for (const key of CRITERION_KEYS) {
    const pairs = siteEventPairs(points, key, offsets)
      .filter((x): x is { date: string; self: number; others: number } => x.self != null && x.others != null)
      .slice(0, SITE_WINDOW)
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

// ─── 指導後の変化（第3段階） ───
// 指導前（指導日より前の直近5回）と指導後（指導日以降の最初の5回）の現場の評価を比べる
export const OUTCOME_MIN_POST_EVENTS = 2 // 指導後の現場がこの回数以上あれば判定する（確認日を過ぎれば1回でも判定）
export const OUTCOME_VERDICT = {
  IMPROVED: '改善（改善の意思あり）',
  CONTINUE: '継続して支援',
  NO_WILL: '改善が見られない（改善の意思が感じられない）',
  INSUFFICIENT: '判定に必要な評価が不足',
} as const
export type OutcomeVerdict = keyof typeof OUTCOME_VERDICT
export const CONFIRMABLE_VERDICTS: OutcomeVerdict[] = ['IMPROVED', 'CONTINUE', 'NO_WILL']
// 判定の基準
export const OUTCOME_IMPROVED_MIN = 0.5    // 改善度がこれ以上
export const OUTCOME_WILL_HIGH = 60        // 改善意欲がこれ以上で「改善」
export const OUTCOME_WILL_LOW = 40         // 改善度が0以下かつ改善意欲がこれ未満で「改善が見られない」
export const ACK_PROMPT_DAYS = 7           // 指導からこの日数以内に本人が確認すれば満点

export interface OutcomeInput {
  direction: GapDirection
  coachedAt: string        // YYYY-MM-DD
  acknowledgedAt: string | null
  followUpDate: string | null
  today: string
  pairs: SitePair[]        // その項目の現場ごとの本人・他者（新しい順）
  reportsAfter: number     // 指導日以降に提出した報告書の数
  reflectionsAfter: number // そのうち振り返りを入力した数
}
export interface OutcomeResult {
  verdict: OutcomeVerdict
  improvement: number | null // 改善度：他者の評価の伸び ＋ 乖離の縮小 × 0.5
  willingness: number        // 改善意欲（0〜100）
  detail: {
    preOthers: number | null; postOthers: number | null; preGap: number | null; postGap: number | null
    preCount: number; postCount: number
    ackPoints: number; reflectionPoints: number; awarenessPoints: number
  }
}
const avgOf = (xs: number[]) => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

export function computeCoachingOutcome(i: OutcomeInput): OutcomeResult {
  const valid = i.pairs.filter(p => p.others != null)
  const pre = valid.filter(p => p.date < i.coachedAt).slice(0, SITE_WINDOW)
  const post = valid.filter(p => p.date >= i.coachedAt).reverse().slice(0, SITE_WINDOW)
  const preOthers = avgOf(pre.map(p => p.others!))
  const postOthers = avgOf(post.map(p => p.others!))
  const gapOf = (xs: SitePair[]) => avgOf(xs.filter(p => p.self != null).map(p => Math.abs(p.self! - p.others!)))
  const preGap = gapOf(pre), postGap = gapOf(post)

  // 改善意欲：本人の確認（30）＋ 指導後の振り返りの入力率（40）＋ 自己認識の変化（30）
  let ackPoints = 0
  if (i.acknowledgedAt) {
    const days = (Date.parse(i.acknowledgedAt) - Date.parse(i.coachedAt)) / 86400_000
    ackPoints = days <= ACK_PROMPT_DAYS ? 30 : 15
  }
  const reflectionPoints = i.reportsAfter ? Math.round((40 * Math.min(i.reflectionsAfter, i.reportsAfter)) / i.reportsAfter) : 0
  const awarenessPoints = preGap == null || postGap == null ? 0 : postGap < preGap ? 30 : postGap === preGap ? 15 : 0
  const willingness = ackPoints + reflectionPoints + awarenessPoints

  // 改善度：過大評価は他者の評価が上がること＋乖離の縮小、過小評価は乖離の縮小（本人が自信を持つ）が中心
  let improvement: number | null = null
  if (preOthers != null && postOthers != null) {
    const gapShrink = preGap != null && postGap != null ? preGap - postGap : 0
    improvement = round2(i.direction === 'OVER' ? postOthers - preOthers + gapShrink * 0.5 : gapShrink)
  }
  const followUpPassed = !!i.followUpDate && i.today >= i.followUpDate
  let verdict: OutcomeVerdict
  if (improvement == null || (post.length < OUTCOME_MIN_POST_EVENTS && !followUpPassed) || post.length === 0) verdict = 'INSUFFICIENT'
  else if (improvement >= OUTCOME_IMPROVED_MIN && willingness >= OUTCOME_WILL_HIGH) verdict = 'IMPROVED'
  else if (improvement <= 0 && willingness < OUTCOME_WILL_LOW) verdict = 'NO_WILL'
  else verdict = 'CONTINUE'
  return {
    verdict, improvement, willingness,
    detail: { preOthers, postOthers, preGap, postGap, preCount: pre.length, postCount: post.length, ackPoints, reflectionPoints, awarenessPoints },
  }
}

// ─── 成長スコア（0〜100） ───
// 評価（他者の補正後の平均）60％・自己認識（本人と他者の差の小ささ）15％・指導の結果 25％。データのない要素は除いて按分する
export const GROWTH_WINDOW_DAYS = 90
export const GROWTH_WEIGHTS = { evaluation: 0.6, awareness: 0.15, coaching: 0.25 } as const
export interface GrowthInput { othersAvg: number | null; avgAbsGap: number | null; outcomes: OutcomeVerdict[] }
export interface GrowthResult { score: number | null; parts: { evaluation: number | null; awareness: number | null; coaching: number | null } }
export function computeGrowthScore(i: GrowthInput): GrowthResult {
  const evaluation = i.othersAvg == null ? null : Math.round(((i.othersAvg - 1) / 4) * 100)
  const awareness = i.avgAbsGap == null ? null : Math.round(Math.max(0, 1 - i.avgAbsGap / 4) * 100)
  const counted = i.outcomes.filter(v => v !== 'INSUFFICIENT')
  const coaching = counted.length
    ? Math.min(100, Math.max(0, 50 + counted.reduce((a, v) => a + (v === 'IMPROVED' ? 20 : v === 'NO_WILL' ? -25 : 0), 0)))
    : null
  const parts = { evaluation, awareness, coaching }
  let sum = 0, w = 0
  for (const k of Object.keys(GROWTH_WEIGHTS) as (keyof typeof GROWTH_WEIGHTS)[]) {
    if (parts[k] == null) continue
    sum += parts[k]! * GROWTH_WEIGHTS[k]; w += GROWTH_WEIGHTS[k]
  }
  return { score: w ? Math.round(sum / w) : null, parts }
}
// 成長スコアの入力を評価から作る（直近の評価と、確定した指導の結果）
export function growthInputFrom(evals: EvaluationLike[], offsets: RaterOffsets | undefined, outcomes: OutcomeVerdict[]): GrowthInput {
  const others: number[] = []
  for (const e of evals) {
    if (e.raterType === 'SELF' || e.raterType === 'MANAGEMENT') continue
    for (const v of Object.values(e.scores ?? {})) if (typeof v === 'number') others.push(correctedScore(v, e, offsets))
  }
  const gaps = summarizeEvaluations(evals.filter(e => e.raterType !== 'MANAGEMENT'), offsets).map(s => s.gap).filter((g): g is number => g != null)
  return { othersAvg: avgOf(others), avgAbsGap: avgOf(gaps.map(Math.abs)), outcomes }
}
