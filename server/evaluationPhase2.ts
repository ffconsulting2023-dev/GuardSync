// 隊員評価 第2段階：同僚評価・定期面談・指導タスク（server/evaluation.ts から登録）
import type express from 'express'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import {
  evaluationInputSchema, summarizeEvaluations, coachingInputSchema,
  INTERVIEW_TEXT_MAX, INTERVIEW_DEFAULT_PERIOD_MONTHS, COACHING_FOLLOW_UP_DAYS, NOTE_MAX,
  type EvaluationLike,
} from '../shared/evaluation'
import { detectSiteCoaching, detectInterviewCoaching, todayJst, addDays, ymd } from './coaching'

interface JwtPayload { userId: string; companyId: string; role: string; isSuperAdmin: boolean }
type Mw = express.RequestHandler
export interface Phase2Deps {
  prisma: PrismaClient
  authenticate: Mw
  requireRole: (...roles: string[]) => Mw
  requireEvaluation: Mw
  linkedGuardForUser: (u: JwtPayload) => Promise<{ id: string; name: string } | null>
  userName: (userId: string) => Promise<string>
}

const userOf = (req: express.Request) => (req as any).user as JwtPayload
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const toDate = (s: string) => new Date(`${s}T00:00:00Z`)
const firstIssue = (e: z.ZodError) => e.issues[0]?.message || '入力が不正です'

export function registerEvaluationPhase2Routes(app: express.Express, d: Phase2Deps) {
  const { prisma, authenticate, requireRole, requireEvaluation: on, linkedGuardForUser, userName } = d
  const supervisorOnly = requireRole('ADMIN', 'MANAGER')
  const adminOnly = requireRole('ADMIN') // 定期面談は経営者（会社の管理者）

  // ─────────── 同僚評価 ───────────

  // その日・その現場で一緒に勤務した隊員（配員または報告書）。報告書の隊員本人のみ
  async function colleaguesOf(req: express.Request, res: express.Response) {
    const user = userOf(req)
    const report = await prisma.securityReport.findFirst({ where: { id: req.params.id, companyId: user.companyId }, select: { id: true, guardId: true, siteId: true, reportDate: true } })
    if (!report) { res.status(404).json({ error: '報告書が見つかりません' }); return null }
    const linked = await linkedGuardForUser(user)
    if (linked?.id !== report.guardId) { res.status(403).json({ error: '同僚の評価は報告書の隊員本人のみ入力できます' }); return null }
    const [schedules, reports] = await Promise.all([
      prisma.schedule.findMany({ where: { companyId: user.companyId, siteId: report.siteId, date: report.reportDate, status: { not: 'CANCELLED' } }, select: { guardId: true } }),
      prisma.securityReport.findMany({ where: { companyId: user.companyId, siteId: report.siteId, reportDate: report.reportDate }, select: { guardId: true } }),
    ])
    const ids = [...new Set([...schedules, ...reports].map(x => x.guardId))].filter(id => id !== report.guardId)
    const guards = await prisma.guard.findMany({ where: { id: { in: ids }, companyId: user.companyId, isActive: true }, select: { id: true, name: true }, orderBy: { employeeNumber: 'asc' } })
    return { report, me: linked, guards }
  }

  app.get('/api/security-reports/:id/peers', authenticate, on, async (req, res) => {
    const c = await colleaguesOf(req, res)
    if (!c) return
    const mine = await prisma.evaluation.findMany({ where: { securityReportId: c.report.id, raterType: 'PEER' }, select: { guardId: true, scores: true } })
    res.json(c.guards.map(g => ({ ...g, scores: mine.find(m => m.guardId === g.id)?.scores ?? null })))
  })

  const peerSchema = z.object({
    targets: z.array(z.object({ guardId: z.string(), scores: z.record(z.string(), z.number()) })).min(1).max(30),
  })
  app.post('/api/security-reports/:id/evaluations/peer', authenticate, on, async (req, res) => {
    const parsed = peerSchema.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: '入力が不正です' }); return }
    const scoreSchema = evaluationInputSchema('PEER', { requireAll: true })
    for (const t of parsed.data.targets) {
      const s = scoreSchema.safeParse({ scores: t.scores })
      if (!s.success) { res.status(400).json({ error: firstIssue(s.error) }); return }
    }
    const c = await colleaguesOf(req, res)
    if (!c) return
    const allowed = new Set(c.guards.map(g => g.id))
    if (parsed.data.targets.some(t => !allowed.has(t.guardId))) { res.status(400).json({ error: '一緒に勤務した隊員のみ評価できます' }); return }
    const user = userOf(req)
    for (const t of parsed.data.targets) {
      const raterKey = `${c.me!.id}:${t.guardId}`
      const data = { scores: t.scores, raterUserId: user.userId, raterName: c.me!.name }
      await prisma.evaluation.upsert({
        where: { securityReportId_raterType_raterKey: { securityReportId: c.report.id, raterType: 'PEER', raterKey } },
        create: { companyId: user.companyId, guardId: t.guardId, securityReportId: c.report.id, siteId: c.report.siteId, evalDate: c.report.reportDate, raterType: 'PEER', raterKey, ...data },
        update: data,
      })
      await detectSiteCoaching(prisma, user.companyId, t.guardId)
    }
    res.status(201).json({ saved: parsed.data.targets.length })
  })

  // ─────────── 定期面談 ───────────

  const interviewCreateSchema = z.object({
    guardId: z.string(),
    scheduledDate: dateStr,
    periodFrom: dateStr.optional(),
    periodTo: dateStr.optional(),
  })

  app.get('/api/interviews', authenticate, adminOnly, on, async (req, res) => {
    const { companyId } = userOf(req)
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const list = await prisma.interview.findMany({
      where: { companyId, ...(status ? { status } : {}), ...(typeof req.query.guardId === 'string' ? { guardId: req.query.guardId } : {}) },
      include: { guard: { select: { id: true, name: true, employeeNumber: true } }, evaluations: { select: { raterType: true } }, _count: { select: { coachingTasks: true } } },
      orderBy: [{ scheduledDate: 'desc' }],
      take: 300,
    })
    res.json(list.map(({ evaluations, ...i }) => ({ ...i, selfDone: evaluations.some(e => e.raterType === 'SELF'), managementDone: evaluations.some(e => e.raterType === 'MANAGEMENT') })))
  })

  app.post('/api/interviews', authenticate, adminOnly, on, async (req, res) => {
    const user = userOf(req)
    const parsed = interviewCreateSchema.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: '入力が不正です' }); return }
    const guard = await prisma.guard.findFirst({ where: { id: parsed.data.guardId, companyId: user.companyId }, select: { id: true } })
    if (!guard) { res.status(400).json({ error: '隊員が不正です' }); return }
    const scheduled = toDate(parsed.data.scheduledDate)
    const periodTo = parsed.data.periodTo ? toDate(parsed.data.periodTo) : scheduled
    let periodFrom: Date
    if (parsed.data.periodFrom) periodFrom = toDate(parsed.data.periodFrom)
    else {
      // 前回の面談の翌日から。初回は既定の月数前から
      const prev = await prisma.interview.findFirst({ where: { companyId: user.companyId, guardId: guard.id, status: 'COMPLETED', periodTo: { lt: periodTo } }, orderBy: { periodTo: 'desc' } })
      if (prev) periodFrom = addDays(prev.periodTo, 1)
      else { periodFrom = new Date(periodTo); periodFrom.setUTCMonth(periodFrom.getUTCMonth() - INTERVIEW_DEFAULT_PERIOD_MONTHS) }
    }
    if (periodFrom > periodTo) { res.status(400).json({ error: '対象期間が不正です' }); return }
    const created = await prisma.interview.create({
      data: { companyId: user.companyId, guardId: guard.id, scheduledDate: scheduled, periodFrom, periodTo, interviewerUserId: user.userId, interviewerName: await userName(user.userId) },
    })
    res.status(201).json(created)
  })

  // 面談画面：対象期間の実績（自動集計）と、本人・経営者の評価
  app.get('/api/interviews/:id', authenticate, adminOnly, on, async (req, res) => {
    const { companyId } = userOf(req)
    const iv = await prisma.interview.findFirst({
      where: { id: req.params.id, companyId },
      include: { guard: { select: { id: true, name: true, employeeNumber: true, joinedAt: true } }, evaluations: true },
    })
    if (!iv) { res.status(404).json({ error: '面談が見つかりません' }); return }
    const range = { gte: iv.periodFrom, lte: iv.periodTo }
    const today = todayJst()
    const [schedules, siteEvals, tasks, prev] = await Promise.all([
      prisma.schedule.findMany({
        where: { companyId, guardId: iv.guardId, date: { ...range, lte: iv.periodTo < today ? iv.periodTo : today }, status: { not: 'CANCELLED' } },
        select: { date: true, startTime: true, attendance: { select: { clockInAt: true } } },
      }),
      prisma.evaluation.findMany({ where: { companyId, guardId: iv.guardId, interviewId: null, evalDate: range }, select: { raterType: true, scores: true, repeatWish: true } }),
      prisma.coachingTask.findMany({ where: { companyId, guardId: iv.guardId, OR: [{ status: 'OPEN' }, { detectedAt: { gte: iv.periodFrom } }] }, orderBy: { detectedAt: 'desc' } }),
      prisma.interview.findFirst({ where: { companyId, guardId: iv.guardId, status: 'COMPLETED', scheduledDate: { lt: iv.scheduledDate } }, orderBy: { scheduledDate: 'desc' }, select: { scheduledDate: true, goal: true } }),
    ])
    // 遅刻：出勤打刻が配員の開始時刻（日本時間）より後
    let clockedIn = 0, late = 0
    for (const s of schedules) {
      const at = s.attendance?.clockInAt
      if (!at) continue
      clockedIn++
      const start = Date.parse(`${ymd(s.date)}T${s.startTime}:00+09:00`)
      if (!isNaN(start) && at.getTime() > start) late++
    }
    const client = siteEvals.filter(e => e.raterType === 'CLIENT' && e.repeatWish != null)
    res.json({
      ...iv,
      stats: {
        shifts: schedules.length, clockedIn, late,
        siteSummary: summarizeEvaluations(siteEvals as unknown as EvaluationLike[]),
        evaluationCount: siteEvals.length,
        repeatWish: { yes: client.filter(e => e.repeatWish).length, total: client.length },
      },
      coachingTasks: tasks,
      previous: prev,
    })
  })

  const interviewUpdateSchema = z.object({
    scheduledDate: dateStr.optional(),
    periodFrom: dateStr.optional(),
    periodTo: dateStr.optional(),
    status: z.enum(['SCHEDULED', 'CANCELLED']).optional(),
  })
  app.put('/api/interviews/:id', authenticate, adminOnly, on, async (req, res) => {
    const { companyId } = userOf(req)
    const parsed = interviewUpdateSchema.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: '入力が不正です' }); return }
    const iv = await prisma.interview.findFirst({ where: { id: req.params.id, companyId } })
    if (!iv) { res.status(404).json({ error: '面談が見つかりません' }); return }
    if (iv.status === 'COMPLETED') { res.status(409).json({ error: '実施済みの面談は変更できません' }); return }
    const v = parsed.data
    const periodFrom = v.periodFrom ? toDate(v.periodFrom) : iv.periodFrom
    const periodTo = v.periodTo ? toDate(v.periodTo) : iv.periodTo
    if (periodFrom > periodTo) { res.status(400).json({ error: '対象期間が不正です' }); return }
    res.json(await prisma.interview.update({ where: { id: iv.id }, data: { ...(v.scheduledDate ? { scheduledDate: toDate(v.scheduledDate) } : {}), periodFrom, periodTo, ...(v.status ? { status: v.status } : {}) } }))
  })

  app.delete('/api/interviews/:id', authenticate, adminOnly, on, async (req, res) => {
    const { companyId } = userOf(req)
    const iv = await prisma.interview.findFirst({ where: { id: req.params.id, companyId } })
    if (!iv) { res.status(404).json({ error: '面談が見つかりません' }); return }
    if (iv.status === 'COMPLETED') { res.status(409).json({ error: '実施済みの面談は削除できません' }); return }
    await prisma.interview.delete({ where: { id: iv.id } })
    res.json({ success: true })
  })

  // 経営者の評価（5段階・全項目）。complete=true で実施済みにし、本人の自己評価との差から指導タスクを作る
  const managementSchema = z.object({
    goal: z.string().max(INTERVIEW_TEXT_MAX).optional().nullable(),
    managementComment: z.string().max(INTERVIEW_TEXT_MAX).optional().nullable(),
    complete: z.boolean().optional(),
  })
  app.put('/api/interviews/:id/management', authenticate, adminOnly, on, async (req, res) => {
    const user = userOf(req)
    const sc = evaluationInputSchema('MANAGEMENT', { requireAll: true, scale: 'interview' }).safeParse({ scores: req.body?.scores })
    if (!sc.success) { res.status(400).json({ error: firstIssue(sc.error) }); return }
    const parsed = managementSchema.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: '入力が不正です' }); return }
    const iv = await prisma.interview.findFirst({ where: { id: req.params.id, companyId: user.companyId } })
    if (!iv) { res.status(404).json({ error: '面談が見つかりません' }); return }
    if (iv.status !== 'SCHEDULED') { res.status(409).json({ error: '予定中の面談のみ入力できます' }); return }
    const name = await userName(user.userId)
    const raterKey = user.userId
    const data = { scores: sc.data.scores, raterUserId: user.userId, raterName: name }
    await prisma.evaluation.upsert({
      where: { interviewId_raterType_raterKey: { interviewId: iv.id, raterType: 'MANAGEMENT', raterKey } },
      create: { companyId: user.companyId, guardId: iv.guardId, interviewId: iv.id, evalDate: iv.scheduledDate, raterType: 'MANAGEMENT', raterKey, ...data },
      update: data,
    })
    const updated = await prisma.interview.update({
      where: { id: iv.id },
      data: {
        goal: parsed.data.goal?.trim() || null, managementComment: parsed.data.managementComment?.trim() || null,
        ...(parsed.data.complete ? { status: 'COMPLETED', completedAt: new Date() } : {}),
      },
    })
    const tasksCreated = parsed.data.complete ? await detectInterviewCoaching(prisma, user.companyId, iv) : 0
    res.json({ ...updated, tasksCreated })
  })

  // ─── 隊員アプリ：面談前の自己評価 ───
  app.get('/api/guard-app/interviews', authenticate, on, async (req, res) => {
    const user = userOf(req)
    const linked = await linkedGuardForUser(user)
    if (!linked) { res.json([]); return }
    const list = await prisma.interview.findMany({
      where: { companyId: user.companyId, guardId: linked.id, OR: [{ status: 'SCHEDULED' }, { status: 'COMPLETED', completedAt: { gte: addDays(new Date(), -120) } }] },
      select: { id: true, scheduledDate: true, periodFrom: true, periodTo: true, status: true, guardWish: true, goal: true, evaluations: { where: { raterType: 'SELF' }, select: { scores: true } } },
      orderBy: { scheduledDate: 'desc' },
    })
    // 経営者の評価・所見は本人に返さない（目標のみ）
    res.json(list.map(({ evaluations, ...i }) => ({ ...i, selfScores: evaluations[0]?.scores ?? null })))
  })

  app.post('/api/interviews/:id/self', authenticate, on, async (req, res) => {
    const user = userOf(req)
    const sc = evaluationInputSchema('SELF', { requireAll: true, scale: 'interview' }).safeParse({ scores: req.body?.scores })
    if (!sc.success) { res.status(400).json({ error: firstIssue(sc.error) }); return }
    const wish = z.string().max(INTERVIEW_TEXT_MAX).optional().nullable().safeParse(req.body?.guardWish)
    if (!wish.success) { res.status(400).json({ error: '入力が不正です' }); return }
    const iv = await prisma.interview.findFirst({ where: { id: req.params.id, companyId: user.companyId } })
    if (!iv) { res.status(404).json({ error: '面談が見つかりません' }); return }
    const linked = await linkedGuardForUser(user)
    if (linked?.id !== iv.guardId) { res.status(403).json({ error: '面談の自己評価は本人のみ入力できます' }); return }
    if (iv.status !== 'SCHEDULED') { res.status(409).json({ error: '予定中の面談のみ入力できます' }); return }
    const data = { scores: sc.data.scores, raterUserId: user.userId, raterName: linked.name }
    await prisma.evaluation.upsert({
      where: { interviewId_raterType_raterKey: { interviewId: iv.id, raterType: 'SELF', raterKey: 'self' } },
      create: { companyId: user.companyId, guardId: iv.guardId, interviewId: iv.id, evalDate: iv.scheduledDate, raterType: 'SELF', raterKey: 'self', ...data },
      update: data,
    })
    await prisma.interview.update({ where: { id: iv.id }, data: { guardWish: wish.data?.trim() || null } })
    res.status(201).json({ success: true })
  })

  // ─────────── 指導タスク ───────────

  app.get('/api/coaching-tasks', authenticate, supervisorOnly, on, async (req, res) => {
    const { companyId } = userOf(req)
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const tasks = await prisma.coachingTask.findMany({
      where: { companyId, ...(status ? { status } : {}), ...(typeof req.query.guardId === 'string' ? { guardId: req.query.guardId } : {}) },
      include: { guard: { select: { id: true, name: true, employeeNumber: true } } },
      orderBy: [{ status: 'desc' }, { dueDate: 'asc' }, { detectedAt: 'desc' }],
      take: 300,
    })
    res.json(tasks)
  })

  // ナビ・ダッシュボード用の件数
  app.get('/api/evaluations/counts', authenticate, supervisorOnly, on, async (req, res) => {
    const { companyId, role, isSuperAdmin } = userOf(req)
    const today = todayJst()
    const [openTasks, overdueTasks, upcomingInterviews] = await Promise.all([
      prisma.coachingTask.count({ where: { companyId, status: 'OPEN' } }),
      prisma.coachingTask.count({ where: { companyId, status: 'OPEN', dueDate: { lt: today } } }),
      role === 'ADMIN' || isSuperAdmin ? prisma.interview.count({ where: { companyId, status: 'SCHEDULED', scheduledDate: { lte: addDays(today, 7) } } }) : Promise.resolve(0),
    ])
    res.json({ openTasks, overdueTasks, upcomingInterviews })
  })

  app.put('/api/coaching-tasks/:id/coach', authenticate, supervisorOnly, on, async (req, res) => {
    const user = userOf(req)
    const parsed = coachingInputSchema.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: firstIssue(parsed.error) }); return }
    const task = await prisma.coachingTask.findFirst({ where: { id: req.params.id, companyId: user.companyId } })
    if (!task) { res.status(404).json({ error: '指導タスクが見つかりません' }); return }
    if (task.status === 'DISMISSED') { res.status(409).json({ error: '対応不要にしたタスクです' }); return }
    if (task.acknowledgedAt) { res.status(409).json({ error: '本人が確認済みのため変更できません' }); return }
    const coachedAt = parsed.data.coachedAt ? toDate(parsed.data.coachedAt) : new Date()
    const followUp = parsed.data.followUpDate ? toDate(parsed.data.followUpDate) : addDays(todayJst(), COACHING_FOLLOW_UP_DAYS)
    res.json(await prisma.coachingTask.update({
      where: { id: task.id },
      data: { status: 'COACHED', coachedAt, coachUserId: user.userId, coachName: await userName(user.userId), method: parsed.data.method, content: parsed.data.content, followUpDate: followUp },
    }))
  })

  app.put('/api/coaching-tasks/:id/dismiss', authenticate, supervisorOnly, on, async (req, res) => {
    const user = userOf(req)
    const reason = z.string().trim().min(1, '理由を入力してください').max(NOTE_MAX).safeParse(req.body?.reason)
    if (!reason.success) { res.status(400).json({ error: firstIssue(reason.error) }); return }
    const task = await prisma.coachingTask.findFirst({ where: { id: req.params.id, companyId: user.companyId } })
    if (!task) { res.status(404).json({ error: '指導タスクが見つかりません' }); return }
    if (task.status !== 'OPEN') { res.status(409).json({ error: '未指導のタスクのみ対応不要にできます' }); return }
    res.json(await prisma.coachingTask.update({ where: { id: task.id }, data: { status: 'DISMISSED', dismissReason: reason.data, coachUserId: user.userId, coachName: await userName(user.userId) } }))
  })

  // ─── 隊員アプリ：上司からの指導と本人の受け止め ───
  app.get('/api/guard-app/coaching', authenticate, on, async (req, res) => {
    const user = userOf(req)
    const linked = await linkedGuardForUser(user)
    if (!linked) { res.json([]); return }
    // 乖離の数値・根拠は返さない（指導内容のみ）
    res.json(await prisma.coachingTask.findMany({
      where: { companyId: user.companyId, guardId: linked.id, status: 'COACHED', coachedAt: { gte: addDays(new Date(), -180) } },
      select: { id: true, criterionKey: true, coachedAt: true, coachName: true, method: true, content: true, acknowledgedAt: true, guardCommitment: true },
      orderBy: { coachedAt: 'desc' },
    }))
  })

  app.post('/api/coaching-tasks/:id/acknowledge', authenticate, on, async (req, res) => {
    const user = userOf(req)
    const c = z.string().trim().min(1, '取り組むことを入力してください').max(INTERVIEW_TEXT_MAX).safeParse(req.body?.commitment)
    if (!c.success) { res.status(400).json({ error: firstIssue(c.error) }); return }
    const task = await prisma.coachingTask.findFirst({ where: { id: req.params.id, companyId: user.companyId } })
    const linked = await linkedGuardForUser(user)
    if (!task || linked?.id !== task.guardId) { res.status(404).json({ error: '指導が見つかりません' }); return }
    if (task.status !== 'COACHED') { res.status(409).json({ error: '指導の記録後に入力できます' }); return }
    res.json(await prisma.coachingTask.update({ where: { id: task.id }, data: { acknowledgedAt: new Date(), guardCommitment: c.data }, select: { id: true, acknowledgedAt: true, guardCommitment: true } }))
  })

}
