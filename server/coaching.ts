// 乖離の検知 → 指導タスクの自動作成（判定の規則は shared/evaluation.ts detectSiteGaps / detectInterviewGaps）
import type { PrismaClient, Prisma } from '@prisma/client'
import {
  detectSiteGaps, detectInterviewGaps, COACHING_DUE_DAYS, type DetectedGap, type SiteEvalPoint, type RaterType,
} from '../shared/evaluation'

type Db = PrismaClient | Prisma.TransactionClient

// 日本時間の今日（@db.Date と比べるため UTC 0時で表す）
export function todayJst(): Date {
  const d = new Date(Date.now() + 9 * 3600_000)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000)
export const ymd = (d: Date) => d.toISOString().slice(0, 10)

// 同じ項目で、未指導のタスクがある／指導後のフォロー期間中／対応不要にしてからフォロー期間内 の場合は作らない
async function shouldCreate(db: Db, companyId: string, guardId: string, criterionKey: string) {
  const today = todayJst()
  const blocking = await db.coachingTask.findFirst({
    where: {
      companyId, guardId, criterionKey,
      OR: [
        { status: 'OPEN' },
        { status: 'COACHED', followUpDate: { gte: today } },
        { status: 'COACHED', followUpDate: null },
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

// 現場ごとの評価（直近180日）から検知する。評価を保存するたびに呼ぶ
export async function detectSiteCoaching(db: Db, companyId: string, guardId: string) {
  const evals = await db.evaluation.findMany({
    where: { companyId, guardId, interviewId: null, evalDate: { gte: addDays(todayJst(), -180) } },
    select: { evalDate: true, siteId: true, raterType: true, scores: true },
  })
  const points: SiteEvalPoint[] = evals.map(e => ({ date: ymd(e.evalDate), siteId: e.siteId, raterType: e.raterType as RaterType, scores: e.scores as Record<string, number> }))
  return createTasks(db, companyId, guardId, detectSiteGaps(points), 'SITE')
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
