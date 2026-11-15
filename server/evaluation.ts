// 隊員評価・申し送りの API（項目・点数の定義は shared/evaluation.ts）
// 会社ごとの機能フラグ Company.evaluationEnabled がオフの間は、設定の取得と切り替え以外のすべての API を拒否する。
import type express from 'express'
import type { PrismaClient } from '@prisma/client'
import {
  evaluationInputSchema, noteInputSchema, summarizeEvaluations, CLIENT_EVAL_WINDOW_MINUTES,
  type RaterType, type EvaluationLike,
} from '../shared/evaluation'
import { registerEvaluationPhase2Routes } from './evaluationPhase2'
import { detectSiteCoaching, loadRaterOffsets, growthScores, refreshOutcomes, todayJst, addDays } from './coaching'

interface JwtPayload { userId: string; companyId: string; role: string; isSuperAdmin: boolean }
type Mw = express.RequestHandler
interface Deps {
  prisma: PrismaClient
  authenticate: Mw
  requireRole: (...roles: string[]) => Mw
  requireSuperAdmin: Mw
  linkedGuardForUser: (u: JwtPayload) => Promise<{ id: string; name: string } | null>
}

const userOf = (req: express.Request) => (req as any).user as JwtPayload
const day = (s: unknown, fallback: Date) => {
  const d = typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : fallback
  return isNaN(d.getTime()) ? fallback : d
}
// 日本時間の日付で数える（深夜0〜9時に前日扱いにならないように）
const daysAgo = (n: number) => addDays(todayJst(), -n)

export function registerEvaluationRoutes(app: express.Express, d: Deps) {
  const { prisma, authenticate, requireRole, requireSuperAdmin, linkedGuardForUser } = d
  // 評価を入力・閲覧できる上司（経営者・管理者）
  const supervisorOnly = requireRole('ADMIN', 'MANAGER')

  const isEnabled = async (companyId: string) =>
    !!(await prisma.company.findUnique({ where: { id: companyId }, select: { evaluationEnabled: true } }))?.evaluationEnabled

  const requireEvaluation: Mw = async (req, res, next) => {
    if (!(await isEnabled(userOf(req).companyId))) { res.status(403).json({ error: '評価機能は利用できません', code: 'EVALUATION_DISABLED' }); return }
    next()
  }

  const userName = async (userId: string) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name || 'ユーザー'

  const findReport = (id: string, companyId: string) =>
    prisma.securityReport.findFirst({ where: { id, companyId }, select: { id: true, companyId: true, guardId: true, siteId: true, reportDate: true, signedAt: true, signerName: true, signerTitle: true } })

  const evalData = (report: NonNullable<Awaited<ReturnType<typeof findReport>>>, raterType: RaterType) => ({
    companyId: report.companyId, guardId: report.guardId, securityReportId: report.id, siteId: report.siteId,
    evalDate: report.reportDate, raterType,
  })

  // 同僚評価・定期面談・指導タスク
  registerEvaluationPhase2Routes(app, { prisma, authenticate, requireRole, requireEvaluation, linkedGuardForUser, userName })

  // ─── 機能のオン・オフ ───
  app.get('/api/evaluations/config', authenticate, async (req, res) => {
    res.json({ enabled: await isEnabled(userOf(req).companyId) })
  })

  app.patch('/api/super-admin/companies/:id/evaluation', authenticate, requireSuperAdmin, async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') { res.status(400).json({ error: 'enabled を指定してください' }); return }
    const found = await prisma.company.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!found) { res.status(404).json({ error: '会社が見つかりません' }); return }
    const c = await prisma.company.update({ where: { id: req.params.id }, data: { evaluationEnabled: req.body.enabled }, select: { id: true, name: true, evaluationEnabled: true } })
    res.json(c)
  })

  // ─── 隊員アプリ：本人の振り返り・依頼先の評価 ───

  // 自分の報告書に付いた評価の有無（点数は返さない。本人・依頼先の入力済み表示用）
  app.get('/api/evaluations/mine', authenticate, requireEvaluation, async (req, res) => {
    const user = userOf(req)
    const linked = await linkedGuardForUser(user)
    const reports = await prisma.securityReport.findMany({
      where: { companyId: user.companyId, OR: [{ submittedByUserId: user.userId }, ...(linked ? [{ guardId: linked.id }] : [])] },
      select: { id: true },
    })
    const evals = await prisma.evaluation.findMany({
      where: { companyId: user.companyId, securityReportId: { in: reports.map(r => r.id) }, raterType: { in: ['SELF', 'CLIENT', 'PEER'] } },
      select: { securityReportId: true, raterType: true },
    })
    res.json({ guardId: linked?.id ?? null, evaluations: evals })
  })

  // 本人の振り返り（報告対象の隊員本人のみ。入力し直しは上書き）
  app.post('/api/security-reports/:id/evaluations/self', authenticate, requireEvaluation, async (req, res) => {
    const user = userOf(req)
    const parsed = evaluationInputSchema('SELF', { requireAll: true }).safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || '入力が不正です' }); return }
    const report = await findReport(req.params.id, user.companyId)
    if (!report) { res.status(404).json({ error: '報告書が見つかりません' }); return }
    const linked = await linkedGuardForUser(user)
    if (linked?.id !== report.guardId) { res.status(403).json({ error: '振り返りは報告書の隊員本人のみ入力できます' }); return }
    const data = { scores: parsed.data.scores, comment: parsed.data.comment?.trim() || null, raterUserId: user.userId, raterName: linked.name }
    const ev = await prisma.evaluation.upsert({
      where: { securityReportId_raterType_raterKey: { securityReportId: report.id, raterType: 'SELF', raterKey: 'self' } },
      create: { ...evalData(report, 'SELF'), raterKey: 'self', ...data },
      update: data,
    })
    await detectSiteCoaching(prisma, user.companyId, report.guardId)
    res.status(201).json({ id: ev.id })
  })

  // 依頼先（現場監督）の評価。サイン直後に隊員の端末で入力してもらう。1回のみ・サインから一定時間内
  app.post('/api/security-reports/:id/evaluations/client', authenticate, requireEvaluation, async (req, res) => {
    const user = userOf(req)
    const parsed = evaluationInputSchema('CLIENT', { requireAll: true }).safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || '入力が不正です' }); return }
    const report = await findReport(req.params.id, user.companyId)
    if (!report) { res.status(404).json({ error: '報告書が見つかりません' }); return }
    if (!report.signedAt) { res.status(409).json({ error: '現場監督のサイン後に入力できます' }); return }
    if (Date.now() - report.signedAt.getTime() > CLIENT_EVAL_WINDOW_MINUTES * 60_000) {
      res.status(409).json({ error: `依頼先の評価はサインから${CLIENT_EVAL_WINDOW_MINUTES}分以内に入力してください` }); return
    }
    const exists = await prisma.evaluation.findFirst({ where: { securityReportId: report.id, raterType: 'CLIENT' }, select: { id: true } })
    if (exists) { res.status(409).json({ error: '依頼先の評価は入力済みです' }); return }
    const ev = await prisma.evaluation.create({
      data: {
        ...evalData(report, 'CLIENT'), raterKey: 'client', raterUserId: user.userId, // 入力に使われた端末のアカウント
        raterName: parsed.data.raterName?.trim() || report.signerName || '依頼先', raterTitle: parsed.data.raterTitle?.trim() || report.signerTitle,
        scores: parsed.data.scores, repeatWish: parsed.data.repeatWish ?? null, comment: parsed.data.comment?.trim() || null,
      },
    })
    await detectSiteCoaching(prisma, user.companyId, report.guardId)
    res.status(201).json({ id: ev.id })
  })

  // ─── 上司：評価待ち一覧と入力 ───

  app.get('/api/evaluations/pending', authenticate, supervisorOnly, requireEvaluation, async (req, res) => {
    const { companyId, userId } = userOf(req)
    const from = day(req.query.from, daysAgo(7))
    const to = day(req.query.to, daysAgo(0))
    const reports = await prisma.securityReport.findMany({
      where: { companyId, reportDate: { gte: from, lte: to } },
      select: {
        id: true, reportDate: true, guardId: true, signedAt: true,
        guard: { select: { id: true, name: true, employeeNumber: true } },
        site: { select: { id: true, name: true } },
        evaluations: { select: { id: true, guardId: true, raterType: true, raterKey: true, raterName: true, scores: true, comment: true, repeatWish: true } },
        _count: { select: { confidentialNotes: true } },
      },
      orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
    })
    res.json({
      from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
      // 同僚評価はその隊員の報告書に紐付くが、評価対象は同僚のため、報告書の隊員への評価だけを返す
      reports: reports.map(({ evaluations, ...r }) => ({ ...r, evaluations: evaluations.filter(e => e.guardId === r.guardId) })).map(r => ({
        ...r,
        mine: r.evaluations.find(e => e.raterType === 'SUPERVISOR' && e.raterKey === userId) ?? null,
        noteCount: r._count.confidentialNotes,
      })),
    })
  })

  // 上司の評価（評価者ごとに1件。入力し直しは上書き。項目の一部だけでもよい）
  app.put('/api/security-reports/:id/evaluations/supervisor', authenticate, supervisorOnly, requireEvaluation, async (req, res) => {
    const user = userOf(req)
    const parsed = evaluationInputSchema('SUPERVISOR', { requireAll: false }).safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || '入力が不正です' }); return }
    const report = await findReport(req.params.id, user.companyId)
    if (!report) { res.status(404).json({ error: '報告書が見つかりません' }); return }
    const data = { scores: parsed.data.scores, comment: parsed.data.comment?.trim() || null, raterUserId: user.userId, raterName: await userName(user.userId) }
    const ev = await prisma.evaluation.upsert({
      where: { securityReportId_raterType_raterKey: { securityReportId: report.id, raterType: 'SUPERVISOR', raterKey: user.userId } },
      create: { ...evalData(report, 'SUPERVISOR'), raterKey: user.userId, ...data },
      update: data,
    })
    await detectSiteCoaching(prisma, user.companyId, report.guardId)
    res.json(ev)
  })

  // ─── 隊員ごとの評価 ───
  app.get('/api/guards/:id/evaluations', authenticate, supervisorOnly, requireEvaluation, async (req, res) => {
    const { companyId } = userOf(req)
    const guard = await prisma.guard.findFirst({ where: { id: req.params.id, companyId }, select: { id: true, name: true, employeeNumber: true } })
    if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }
    const from = day(req.query.from, daysAgo(180))
    const to = day(req.query.to, daysAgo(-1))
    const evaluations = await prisma.evaluation.findMany({
      where: { companyId, guardId: guard.id, interviewId: null, evalDate: { gte: from, lte: to } },
      select: { id: true, evalDate: true, raterType: true, raterKey: true, raterName: true, raterTitle: true, scores: true, comment: true, repeatWish: true, siteId: true, securityReportId: true },
      orderBy: [{ evalDate: 'desc' }, { createdAt: 'desc' }],
    })
    const siteIds = [...new Set(evaluations.map(e => e.siteId).filter((x): x is string => !!x))]
    const sites = await prisma.site.findMany({ where: { id: { in: siteIds }, companyId }, select: { id: true, name: true } })
    const siteName = new Map(sites.map(s => [s.id, s.name]))
    const client = evaluations.filter(e => e.raterType === 'CLIENT' && e.repeatWish != null)
    await refreshOutcomes(prisma, companyId, guard.id)
    const offsets = await loadRaterOffsets(prisma, companyId)
    const growth = (await growthScores(prisma, companyId, [guard.id], undefined, offsets)).get(guard.id)
    const [coachingTasks, interviews] = await Promise.all([
      prisma.coachingTask.findMany({ where: { companyId, guardId: guard.id }, orderBy: { detectedAt: 'desc' }, take: 50 }),
      prisma.interview.findMany({ where: { companyId, guardId: guard.id }, select: { id: true, scheduledDate: true, status: true, goal: true }, orderBy: { scheduledDate: 'desc' }, take: 20 }),
    ])
    res.json({
      guard, coachingTasks, interviews, growth, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
      // 他者の点数は評価者の甘い・辛いを補正した値（othersRaw が補正前）
      summary: summarizeEvaluations(evaluations as unknown as EvaluationLike[], offsets),
      repeatWish: { yes: client.filter(e => e.repeatWish).length, total: client.length },
      evaluations: evaluations.map(({ raterKey: _k, ...e }) => ({ ...e, siteName: e.siteId ? siteName.get(e.siteId) ?? null : null })),
    })
  })

  // ─── 申し送り（経営者・上司のみ。閲覧・作成・削除を記録する） ───
  const logNote = (companyId: string, guardId: string, userId: string, name: string, action: string, noteId?: string) =>
    prisma.confidentialNoteAccessLog.create({ data: { companyId, guardId, userId, userName: name, action, noteId: noteId ?? null } })

  app.get('/api/guards/:id/confidential-notes', authenticate, supervisorOnly, requireEvaluation, async (req, res) => {
    const user = userOf(req)
    const guard = await prisma.guard.findFirst({ where: { id: req.params.id, companyId: user.companyId }, select: { id: true } })
    if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }
    const notes = await prisma.confidentialNote.findMany({
      where: { companyId: user.companyId, guardId: guard.id },
      include: { securityReport: { select: { reportDate: true, site: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
    })
    await logNote(user.companyId, guard.id, user.userId, await userName(user.userId), 'VIEW')
    res.json(notes)
  })

  app.post('/api/guards/:id/confidential-notes', authenticate, supervisorOnly, requireEvaluation, async (req, res) => {
    const user = userOf(req)
    const parsed = noteInputSchema.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || '入力が不正です' }); return }
    const guard = await prisma.guard.findFirst({ where: { id: req.params.id, companyId: user.companyId }, select: { id: true } })
    if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }
    const reportId = parsed.data.securityReportId || null
    if (reportId) {
      const r = await prisma.securityReport.findFirst({ where: { id: reportId, companyId: user.companyId, guardId: guard.id }, select: { id: true } })
      if (!r) { res.status(400).json({ error: '報告書が不正です' }); return }
    }
    const name = await userName(user.userId)
    const note = await prisma.confidentialNote.create({
      data: { companyId: user.companyId, guardId: guard.id, securityReportId: reportId, authorUserId: user.userId, authorName: name, body: parsed.data.body, tags: parsed.data.tags },
    })
    await logNote(user.companyId, guard.id, user.userId, name, 'CREATE', note.id)
    res.status(201).json(note)
  })

  // 削除は作成者本人または会社の管理者のみ
  app.delete('/api/confidential-notes/:id', authenticate, supervisorOnly, requireEvaluation, async (req, res) => {
    const user = userOf(req)
    const note = await prisma.confidentialNote.findFirst({ where: { id: req.params.id, companyId: user.companyId } })
    if (!note) { res.status(404).json({ error: '申し送りが見つかりません' }); return }
    if (note.authorUserId !== user.userId && user.role !== 'ADMIN' && !user.isSuperAdmin) { res.status(403).json({ error: '作成者または管理者のみ削除できます' }); return }
    await prisma.confidentialNote.delete({ where: { id: note.id } })
    await logNote(user.companyId, note.guardId, user.userId, await userName(user.userId), 'DELETE', note.id)
    res.json({ success: true })
  })

  app.get('/api/guards/:id/confidential-notes/access-log', authenticate, requireRole('ADMIN'), requireEvaluation, async (req, res) => {
    const { companyId } = userOf(req)
    res.json(await prisma.confidentialNoteAccessLog.findMany({ where: { companyId, guardId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 200 }))
  })
}
