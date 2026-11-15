// 乖離の検知 → 指導タスクの自動作成（判定の規則は shared/evaluation.ts detectSiteGaps / detectInterviewGaps）
import type { PrismaClient, Prisma } from '@prisma/client'
import {
  detectSiteGaps, detectInterviewGaps, siteEventPairs, computeRaterOffsets, computeCoachingOutcome, computeGrowthScore, growthInputFrom,
  COACHING_DUE_DAYS, RATER_WINDOW_DAYS, GROWTH_WINDOW_DAYS,
  type DetectedGap, type SiteEvalPoint, type RaterType, type RaterOffsets, type CriterionKey, type OutcomeVerdict, type EvaluationLike, type GrowthResult,
} from '../shared/evaluation'

type Db = PrismaClient | Prisma.TransactionClient

// 日本時間の今日（@db.Date と比べるため UTC 0時で表す）
export function todayJst(): Date {
  const d = new Date(Date.now() + 9 * 3600_000)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000)
export const ymd = (d: Date) => d.toISOString().slice(0, 10)

// 同じ項目で、未指導・指導済み（結果の確定前）のタスクがある、または対応不要にしてから30日以内 の場合は作らない
async function shouldCreate(db: Db, companyId: string, guardId: string, criterionKey: string) {
  const today = todayJst()
  const blocking = await db.coachingTask.findFirst({
    where: {
      companyId, guardId, criterionKey,
      OR: [
        { status: 'OPEN' },
        // 指導済みは、結果を確定するまでは同じ項目で作らない（確定後は、改善していなければ再び検知される）
        { status: 'COACHED' },
        { status: 'DISMISSED', updatedAt: { gte: addDays(today, -30) } },
      ],
    },
    select: { id: true },
  })
  return !blocking
}

async function createTasks(db: Db, companyId: string, guardId: string, gaps: DetectedGap[], trigger: 'SITE' | 'INTERVIEW', interviewId?: string) {
  let created = 0
  for (const g of gaps) {
    if (!(await shouldCreate(db, companyId, guardId, g.criterionKey))) continue
    await db.coachingTask.create({
      data: {
        companyId, guardId, criterionKey: g.criterionKey, direction: g.direction, gap: g.gap, trigger,
        interviewId: interviewId ?? null, evidence: g.evidence, dueDate: addDays(todayJst(), COACHING_DUE_DAYS),
      },
    })
    created++
  }
  return created
}

// 会社全体の評価から、評価者ごとの甘い・辛いの補正値を求める
export async function loadRaterOffsets(db: Db, companyId: string): Promise<RaterOffsets> {
  const evals = await db.evaluation.findMany({
    where: { companyId, interviewId: null, raterType: { in: ['SUPERVISOR', 'CLIENT', 'PEER'] }, evalDate: { gte: addDays(todayJst(), -RATER_WINDOW_DAYS) } },
    select: { raterType: true, raterKey: true, siteId: true, scores: true },
  })
  return computeRaterOffsets(evals as unknown as EvaluationLike[])
}

async function sitePoints(db: Db, companyId: string, guardId: string, days = 365): Promise<SiteEvalPoint[]> {
  const evals = await db.evaluation.findMany({
    where: { companyId, guardId, interviewId: null, evalDate: { gte: addDays(todayJst(), -days) } },
    select: { evalDate: true, siteId: true, raterType: true, raterKey: true, scores: true },
  })
  return evals.map(e => ({ date: ymd(e.evalDate), siteId: e.siteId, raterType: e.raterType as RaterType, raterKey: e.raterKey, scores: e.scores as Record<string, number> }))
}

// 現場ごとの評価（直近180日）から検知し、指導済みのタスクの変化を計算し直す。評価を保存するたびに呼ぶ
export async function detectSiteCoaching(db: Db, companyId: string, guardId: string) {
  const offsets = await loadRaterOffsets(db, companyId)
  const since = ymd(addDays(todayJst(), -180))
  const points = await sitePoints(db, companyId, guardId)
  const created = await createTasks(db, companyId, guardId, detectSiteGaps(points.filter(p => p.date >= since), offsets), 'SITE')
  await refreshOutcomes(db, companyId, guardId, { offsets, points })
  return created
}

// 指導済み（結果を確定していない）タスクの、指導後の変化（改善度・改善意欲・判定）を計算して保存する
export async function refreshOutcomes(db: Db, companyId: string, guardId: string, pre?: { offsets: RaterOffsets; points: SiteEvalPoint[] }) {
  const tasks = await db.coachingTask.findMany({ where: { companyId, guardId, status: 'COACHED', coachedAt: { not: null } } })
  if (!tasks.length) return
  const offsets = pre?.offsets ?? (await loadRaterOffsets(db, companyId))
  const points = pre?.points ?? (await sitePoints(db, companyId, guardId))
  const today = ymd(todayJst())
  for (const t of tasks) {
    const coachedAt = ymd(t.coachedAt!)
    const reports = await db.securityReport.findMany({
      where: { companyId, guardId, reportDate: { gte: new Date(`${coachedAt}T00:00:00Z`) } },
      select: { id: true, evaluations: { where: { raterType: 'SELF' }, select: { id: true } } },
    })
    const r = computeCoachingOutcome({
      direction: t.direction as 'OVER' | 'UNDER', coachedAt, today,
      acknowledgedAt: t.acknowledgedAt ? ymd(t.acknowledgedAt) : null,
      followUpDate: t.followUpDate ? ymd(t.followUpDate) : null,
      pairs: siteEventPairs(points, t.criterionKey as CriterionKey, offsets),
      reportsAfter: reports.length, reflectionsAfter: reports.filter(x => x.evaluations.length).length,
    })
    await db.coachingTask.update({
      where: { id: t.id },
      data: { outcomeVerdict: r.verdict, outcomeImprovement: r.improvement, outcomeWillingness: r.willingness, outcomeDetail: r.detail as object, outcomeComputedAt: new Date() },
    })
  }
}

// 成長スコア：直近90日の評価（補正後）と、確定した指導の結果（直近180日）
export async function growthScores(db: Db, companyId: string, guardIds: string[], asOf = todayJst(), offsets?: RaterOffsets): Promise<Map<string, GrowthResult & { evaluationCount: number }>> {
  const offs = offsets ?? (await loadRaterOffsets(db, companyId))
  const [evals, tasks] = await Promise.all([
    db.evaluation.findMany({
      where: { companyId, guardId: { in: guardIds }, interviewId: null, evalDate: { gte: addDays(asOf, -GROWTH_WINDOW_DAYS), lte: asOf } },
      select: { guardId: true, raterType: true, raterKey: true, siteId: true, scores: true },
    }),
    db.coachingTask.findMany({
      where: { companyId, guardId: { in: guardIds }, status: 'CLOSED', confirmedAt: { gte: addDays(asOf, -180), lte: addDays(asOf, 1) } },
      select: { guardId: true, confirmedVerdict: true },
    }),
  ])
  const out = new Map<string, GrowthResult & { evaluationCount: number }>()
  for (const id of guardIds) {
    const mine = evals.filter(e => e.guardId === id) as unknown as EvaluationLike[]
    const outcomes = tasks.filter(t => t.guardId === id && t.confirmedVerdict).map(t => t.confirmedVerdict as OutcomeVerdict)
    out.set(id, { ...computeGrowthScore(growthInputFrom(mine, offs, outcomes)), evaluationCount: mine.length })
  }
  return out
}

// 面談の完了時に、本人の事前自己評価と経営者の評価の差から検知する
export async function detectInterviewCoaching(db: Db, companyId: string, interview: { id: string; guardId: string; scheduledDate: Date }) {
  const evals = await db.evaluation.findMany({ where: { interviewId: interview.id }, select: { raterType: true, scores: true } })
  const self = evals.find(e => e.raterType === 'SELF')
  const mgmt = evals.find(e => e.raterType === 'MANAGEMENT')
  if (!self || !mgmt) return 0
  const gaps = detectInterviewGaps(self.scores as Record<string, number>, mgmt.scores as Record<string, number>, ymd(interview.scheduledDate))
  return createTasks(db, companyId, interview.guardId, gaps, 'INTERVIEW', interview.id)
}
