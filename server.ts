import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import cron from 'node-cron'
import dotenv from 'dotenv'
import { z } from 'zod'
import nodemailer from 'nodemailer'

dotenv.config()

// ─────────────────────────────────────────────
// メール送信ヘルパー
// ─────────────────────────────────────────────

function createMailTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
    port: Number(process.env.SMTP_PORT) || 587,
    auth: {
      user: process.env.SMTP_USER || 'apikey',
      pass: process.env.SMTP_PASS || process.env.SENDGRID_API_KEY || '',
    },
  })
}

async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<boolean> {
  if (!process.env.SMTP_PASS && !process.env.SENDGRID_API_KEY) {
    console.log(`[email] SMTP未設定 - メール送信スキップ: ${subject} → ${to}`)
    return false
  }
  try {
    const transport = createMailTransport()
    await transport.sendMail({
      from: process.env.SMTP_FROM || 'noreply@guardsync.jp',
      to,
      subject,
      html,
      text,
    })
    return true
  } catch (e) {
    console.error('[email] 送信エラー:', e)
    return false
  }
}

// ─────────────────────────────────────────────
// LINE Works送信ヘルパー
// ─────────────────────────────────────────────

async function getLineWorksToken(clientId: string, clientSecret: string): Promise<string | null> {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'bot',
  })
  try {
    const res = await fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    if (!res.ok) return null
    const data = await res.json() as { access_token: string }
    return data.access_token
  } catch {
    return null
  }
}

async function sendLineWorksMessage(botId: string, channelId: string, accessToken: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://www.worksapis.com/v1.0/bots/${botId}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { type: 'text', text } }),
    })
    return res.ok
  } catch {
    return false
  }
}

const app = express()
const prisma = new PrismaClient()
const PORT = process.env.PORT || 3000
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'

// ─────────────────────────────────────────────
// ミドルウェア
// ─────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({ origin: process.env.NODE_ENV === 'production' ? false : true, credentials: true }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false })
app.use('/api/', limiter)

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 })
app.use('/api/auth/login', authLimiter)

// ─────────────────────────────────────────────
// 認証ヘルパー
// ─────────────────────────────────────────────

interface JwtPayload {
  userId: string
  companyId: string
  role: string
  isSuperAdmin: boolean
}

function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' })
}

function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: '認証が必要です' })
    return
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as JwtPayload
    ;(req as any).user = payload
    next()
  } catch {
    res.status(401).json({ error: 'トークンが無効です' })
  }
}

function requireRole(...roles: string[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user as JwtPayload
    if (!user) { res.status(401).json({ error: '認証が必要です' }); return }
    if (user.isSuperAdmin) { next(); return }
    if (!roles.includes(user.role)) { res.status(403).json({ error: '権限がありません' }); return }
    next()
  }
}

function requireSuperAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = (req as any).user as JwtPayload
  if (!user?.isSuperAdmin) { res.status(403).json({ error: 'スーパー管理者のみアクセス可能です' }); return }
  next()
}

// ─────────────────────────────────────────────
// ヘルスチェック
// ─────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() })
})

// ─────────────────────────────────────────────
// 認証 API
// ─────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

app.post('/api/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: '入力値が不正です' }); return }

  const { email, password } = parsed.data
  const user = await prisma.user.findUnique({
    where: { email },
    include: { company: true },
  })

  if (!user || !user.isActive) { res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' }); return }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) { res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' }); return }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

  const token = signToken({
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    isSuperAdmin: user.isSuperAdmin,
  })

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, company: { id: user.company.id, name: user.company.name, plan: user.company.plan } },
  })
})

app.get('/api/auth/me', authenticate, async (req, res) => {
  const { userId } = (req as any).user as JwtPayload
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, isSuperAdmin: true, company: { select: { id: true, name: true, plan: true } } },
  })
  if (!user) { res.status(404).json({ error: 'ユーザーが見つかりません' }); return }
  res.json(user)
})

// ─────────────────────────────────────────────
// 招待 API
// ─────────────────────────────────────────────

app.post('/api/auth/invite', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { email } = req.body
  if (!email) { res.status(400).json({ error: 'メールアドレスは必須です' }); return }

  const { companyId } = (req as any).user as JwtPayload
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const invitation = await prisma.invitation.create({ data: { email, companyId, expiresAt } })

  res.json({ token: invitation.token, expiresAt })
})

app.post('/api/auth/register', async (req, res) => {
  const { token, name, password } = req.body
  if (!token || !name || !password) { res.status(400).json({ error: '必須項目が不足しています' }); return }
  if (password.length < 8) { res.status(400).json({ error: 'パスワードは8文字以上にしてください' }); return }

  const invitation = await prisma.invitation.findUnique({ where: { token } })
  if (!invitation || invitation.usedAt || invitation.expiresAt < new Date()) {
    res.status(400).json({ error: '招待リンクが無効または期限切れです' }); return
  }

  const existing = await prisma.user.findUnique({ where: { email: invitation.email } })
  if (existing) { res.status(409).json({ error: 'このメールアドレスは既に登録されています' }); return }

  const hashed = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({
    data: { email: invitation.email, password: hashed, name, companyId: invitation.companyId!, role: 'OPERATOR' },
  })

  await prisma.invitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } })

  const jwtToken = signToken({ userId: user.id, companyId: user.companyId, role: user.role, isSuperAdmin: false })
  res.json({ token: jwtToken })
})

// ─────────────────────────────────────────────
// 隊員 API
// ─────────────────────────────────────────────

app.get('/api/guards', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { search, isActive } = req.query

  const guards = await prisma.guard.findMany({
    where: {
      companyId,
      ...(isActive !== undefined ? { isActive: isActive === 'true' } : {}),
      ...(search ? { OR: [{ name: { contains: String(search) } }, { nameKana: { contains: String(search) } }, { employeeNumber: { contains: String(search) } }] } : {}),
    },
    orderBy: { employeeNumber: 'asc' },
  })
  res.json(guards)
})

app.get('/api/guards/:id', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const guard = await prisma.guard.findFirst({ where: { id: req.params.id, companyId } })
  if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }
  res.json(guard)
})

const guardSchema = z.object({
  employeeNumber: z.string().min(1),
  name: z.string().min(1),
  nameKana: z.string().min(1),
  birthDate: z.string().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  certifications: z.array(z.string()).optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'DISPATCH']).optional(),
  dailyPayEnabled: z.boolean().optional(),
})

app.post('/api/guards', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const parsed = guardSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors }); return }

  const guard = await prisma.guard.create({
    data: { ...parsed.data, companyId, birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : undefined },
  })
  res.status(201).json(guard)
})

app.put('/api/guards/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.guard.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: '隊員が見つかりません' }); return }

  const parsed = guardSchema.partial().safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors }); return }

  const guard = await prisma.guard.update({
    where: { id: req.params.id },
    data: { ...parsed.data, birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : undefined },
  })
  res.json(guard)
})

app.delete('/api/guards/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.guard.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: '隊員が見つかりません' }); return }

  await prisma.guard.update({ where: { id: req.params.id }, data: { isActive: false } })
  res.json({ success: true })
})

// ─────────────────────────────────────────────
// 現場 API
// ─────────────────────────────────────────────

app.get('/api/sites', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const sites = await prisma.site.findMany({
    where: { companyId, isActive: true },
    include: { client: true, siteContact: true },
    orderBy: { name: 'asc' },
  })
  res.json(sites)
})

async function resolveClientSnapshot(companyId: string, clientId: string | undefined | null) {
  if (!clientId) return null
  const client = await prisma.client.findFirst({ where: { id: clientId, companyId } })
  if (!client) throw Object.assign(new Error('取引先が見つかりません'), { status: 400 })
  return client
}

async function resolveSiteContactSnapshot(companyId: string, clientId: string | null | undefined, siteContactId: string | undefined | null) {
  if (!siteContactId) return null
  const contact = await prisma.clientContact.findFirst({
    where: { id: siteContactId, client: { companyId }, type: 'SITE' },
  })
  if (!contact) throw Object.assign(new Error('現場担当者が見つかりません'), { status: 400 })
  if (clientId && contact.clientId !== clientId) {
    throw Object.assign(new Error('現場担当者が選択した取引先に属していません'), { status: 400 })
  }
  return contact
}

app.post('/api/sites', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { clientId, siteContactId, name, address, lat, lng, clientName, clientPhone,
          siteContactName, siteContactPhone, siteContactEmail, notes } = req.body
  if (!name || !address) { res.status(400).json({ error: '現場名と住所は必須です' }); return }

  try {
    const client = await resolveClientSnapshot(companyId, clientId)
    const contact = await resolveSiteContactSnapshot(companyId, client?.id ?? null, siteContactId)
    const site = await prisma.site.create({
      data: {
        companyId, clientId: client?.id ?? null,
        siteContactId: contact?.id ?? null,
        name, address, lat, lng,
        clientName: client?.name ?? clientName ?? null,
        clientPhone: client?.phone ?? clientPhone ?? null,
        siteContactName:  siteContactName  ?? contact?.name  ?? null,
        siteContactPhone: siteContactPhone ?? contact?.phone ?? null,
        siteContactEmail: siteContactEmail ?? contact?.email ?? null,
        notes,
      },
    })
    res.status(201).json(site)
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || 'サーバーエラー' })
  }
})

app.put('/api/sites/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.site.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: '現場が見つかりません' }); return }

  const { clientId, siteContactId, name, address, lat, lng, clientName, clientPhone,
          siteContactName, siteContactPhone, siteContactEmail, notes, isActive } = req.body
  try {
    const client = await resolveClientSnapshot(companyId, clientId)
    const contact = await resolveSiteContactSnapshot(companyId, client?.id ?? null, siteContactId)
    const site = await prisma.site.update({
      where: { id: req.params.id },
      data: {
        clientId: clientId === undefined ? undefined : (client?.id ?? null),
        siteContactId: siteContactId === undefined ? undefined : (contact?.id ?? null),
        name, address, lat, lng,
        clientName: client?.name ?? clientName,
        clientPhone: client?.phone ?? clientPhone,
        siteContactName: siteContactName !== undefined ? siteContactName : (contact?.name ?? undefined),
        siteContactPhone: siteContactPhone !== undefined ? siteContactPhone : (contact?.phone ?? undefined),
        siteContactEmail: siteContactEmail !== undefined ? siteContactEmail : (contact?.email ?? undefined),
        notes, isActive,
      },
    })
    res.json(site)
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || 'サーバーエラー' })
  }
})

// ─────────────────────────────────────────────
// 取引先 API
// ─────────────────────────────────────────────

app.get('/api/clients', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const clients = await prisma.client.findMany({
    where: { companyId, isActive: true },
    include: { contacts: { orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }] } },
    orderBy: { name: 'asc' },
  })
  res.json(clients)
})

type IncomingContact = {
  id?: string
  type: 'SITE' | 'ACCOUNTING'
  name: string
  title?: string | null
  phone?: string | null
  email?: string | null
  notes?: string | null
  sortOrder?: number
}

function normalizeContacts(input: any): IncomingContact[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((c: any) => c && c.name && (c.type === 'SITE' || c.type === 'ACCOUNTING'))
    .map((c: any, i: number) => ({
      id: c.id || undefined,
      type: c.type,
      name: String(c.name),
      title: c.title ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
      notes: c.notes ?? null,
      sortOrder: typeof c.sortOrder === 'number' ? c.sortOrder : i,
    }))
}

app.post('/api/clients', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { name, contactName, phone, email, address, notes,
          representativeName, representativeTitle, representativePhone, representativeEmail,
          contacts } = req.body
  if (!name) { res.status(400).json({ error: '取引先名は必須です' }); return }
  const incomingContacts = normalizeContacts(contacts)
  const client = await prisma.client.create({
    data: {
      companyId, name, contactName, phone, email, address, notes,
      representativeName, representativeTitle, representativePhone, representativeEmail,
      contacts: { create: incomingContacts.map(({ id: _id, ...c }) => c) },
    },
    include: { contacts: true },
  })
  res.status(201).json(client)
})

app.put('/api/clients/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.client.findFirst({
    where: { id: req.params.id, companyId },
    include: { contacts: true },
  })
  if (!existing) { res.status(404).json({ error: '取引先が見つかりません' }); return }

  const { name, contactName, phone, email, address, notes, isActive,
          representativeName, representativeTitle, representativePhone, representativeEmail,
          contacts } = req.body

  const incoming = normalizeContacts(contacts)
  const incomingIds = new Set(incoming.filter(c => c.id).map(c => c.id!))
  const toDelete = existing.contacts.filter(c => !incomingIds.has(c.id)).map(c => c.id)
  const toUpdate = incoming.filter(c => c.id)
  const toCreate = incoming.filter(c => !c.id)

  const client = await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: req.params.id },
      data: {
        name, contactName, phone, email, address, notes, isActive,
        representativeName, representativeTitle, representativePhone, representativeEmail,
      },
    })
    if (toDelete.length) {
      // Site 側の siteContactId を NULL に戻してからコンタクトを削除
      await tx.site.updateMany({ where: { siteContactId: { in: toDelete } }, data: { siteContactId: null } })
      await tx.clientContact.deleteMany({ where: { id: { in: toDelete } } })
    }
    for (const c of toUpdate) {
      await tx.clientContact.update({
        where: { id: c.id! },
        data: { type: c.type, name: c.name, title: c.title, phone: c.phone, email: c.email, notes: c.notes, sortOrder: c.sortOrder },
      })
    }
    if (toCreate.length) {
      await tx.clientContact.createMany({
        data: toCreate.map(({ id: _id, ...c }) => ({ ...c, clientId: req.params.id })),
      })
    }
    return tx.client.findUnique({
      where: { id: req.params.id },
      include: { contacts: { orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }] } },
    })
  })
  res.json(client)
})

app.delete('/api/clients/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.client.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: '取引先が見つかりません' }); return }
  await prisma.client.update({ where: { id: req.params.id }, data: { isActive: false } })
  res.json({ success: true })
})

// ─────────────────────────────────────────────
// 契約 API
// ─────────────────────────────────────────────

app.get('/api/contracts', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const contracts = await prisma.contract.findMany({
    where: { companyId },
    include: { site: true, client: true },
    orderBy: { createdAt: 'desc' },
  })
  res.json(contracts)
})

app.post('/api/contracts', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId, userId } = (req as any).user as JwtPayload
  const { siteId, clientId, contractNumber, clientName, startDate, endDate, unitPrice, guardCount, shiftPattern, notes } = req.body
  if (!siteId || !contractNumber || !startDate || !unitPrice) {
    res.status(400).json({ error: '必須項目が不足しています' }); return
  }

  try {
    const client = await resolveClientSnapshot(companyId, clientId)
    const finalClientName = client?.name ?? clientName
    if (!finalClientName) { res.status(400).json({ error: '取引先または発注元名は必須です' }); return }

    const contract = await prisma.contract.create({
      data: {
        companyId, siteId, clientId: client?.id ?? null,
        contractNumber, clientName: finalClientName,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        unitPrice: Number(unitPrice), guardCount: Number(guardCount) || 1,
        shiftPattern, notes, createdById: userId,
      },
      include: { site: true, client: true },
    })
    res.status(201).json(contract)
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || 'サーバーエラー' })
  }
})

// ─────────────────────────────────────────────
// シフト・配員 API
// ─────────────────────────────────────────────

app.get('/api/schedules', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { from, to, guardId, siteId } = req.query

  const schedules = await prisma.schedule.findMany({
    where: {
      companyId,
      ...(from || to ? { date: { ...(from ? { gte: new Date(String(from)) } : {}), ...(to ? { lte: new Date(String(to)) } : {}) } } : {}),
      ...(guardId ? { guardId: String(guardId) } : {}),
      ...(siteId ? { siteId: String(siteId) } : {}),
    },
    include: { guard: true, site: true, attendance: true },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  })
  res.json(schedules)
})

app.post('/api/schedules', authenticate, requireRole('ADMIN', 'MANAGER', 'OPERATOR'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { guardId, siteId, date, startTime, endTime, notes } = req.body
  if (!guardId || !siteId || !date || !startTime || !endTime) {
    res.status(400).json({ error: '必須項目が不足しています' }); return
  }

  const schedule = await prisma.schedule.create({
    data: { companyId, guardId, siteId, date: new Date(date), startTime, endTime, notes },
    include: { guard: true, site: true },
  })
  res.status(201).json(schedule)
})

app.put('/api/schedules/:id', authenticate, requireRole('ADMIN', 'MANAGER', 'OPERATOR'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.schedule.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: 'シフトが見つかりません' }); return }

  const { guardId, siteId, date, startTime, endTime, status, notes } = req.body
  const schedule = await prisma.schedule.update({
    where: { id: req.params.id },
    data: { guardId, siteId, date: date ? new Date(date) : undefined, startTime, endTime, status, notes },
    include: { guard: true, site: true },
  })
  res.json(schedule)
})

app.delete('/api/schedules/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.schedule.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: 'シフトが見つかりません' }); return }

  await prisma.schedule.update({ where: { id: req.params.id }, data: { status: 'CANCELLED' } })
  res.json({ success: true })
})

// ─────────────────────────────────────────────
// 出退勤 API
// ─────────────────────────────────────────────

app.post('/api/attendance/clock-in', authenticate, async (req, res) => {
  const { userId, companyId } = (req as any).user as JwtPayload
  const { scheduleId } = req.body
  if (!scheduleId) { res.status(400).json({ error: 'scheduleIdは必須です' }); return }

  const schedule = await prisma.schedule.findFirst({ where: { id: scheduleId, companyId } })
  if (!schedule) { res.status(404).json({ error: 'シフトが見つかりません' }); return }

  const existing = await prisma.attendance.findUnique({ where: { scheduleId } })
  if (existing?.clockInAt) { res.status(409).json({ error: '既に出勤打刻済みです' }); return }

  const attendance = existing
    ? await prisma.attendance.update({ where: { scheduleId }, data: { clockInAt: new Date(), status: 'CLOCKED_IN' } })
    : await prisma.attendance.create({ data: { companyId, guardId: schedule.guardId, scheduleId, clockInAt: new Date(), status: 'CLOCKED_IN' } })

  res.json(attendance)
})

app.post('/api/attendance/clock-out', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { scheduleId, breakMinutes } = req.body
  if (!scheduleId) { res.status(400).json({ error: 'scheduleIdは必須です' }); return }

  const attendance = await prisma.attendance.findFirst({ where: { scheduleId, companyId } })
  if (!attendance?.clockInAt) { res.status(400).json({ error: '出勤打刻がありません' }); return }

  const updated = await prisma.attendance.update({
    where: { id: attendance.id },
    data: { clockOutAt: new Date(), breakMinutes: Number(breakMinutes) || 0, status: 'COMPLETED' },
  })
  res.json(updated)
})

// ─────────────────────────────────────────────
// 請求 API
// ─────────────────────────────────────────────

app.get('/api/invoices', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const invoices = await prisma.invoice.findMany({
    where: { companyId },
    include: { items: true, client: true },
    orderBy: { issueDate: 'desc' },
  })
  res.json(invoices)
})

app.post('/api/invoices', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId, userId } = (req as any).user as JwtPayload
  const { invoiceNumber, clientId, clientName, clientEmail, issueDate, dueDate, items, taxRate = 0.1, notes } = req.body
  if (!invoiceNumber || !issueDate || !dueDate || !items?.length) {
    res.status(400).json({ error: '必須項目が不足しています' }); return
  }

  try {
    const client = await resolveClientSnapshot(companyId, clientId)
    const finalClientName = client?.name ?? clientName
    if (!finalClientName) { res.status(400).json({ error: '取引先または発注元名は必須です' }); return }

    const subtotal = items.reduce((sum: number, item: any) => sum + item.quantity * item.unitPrice, 0)
    const taxAmount = Math.floor(subtotal * taxRate)
    const total = subtotal + taxAmount

    const invoice = await prisma.invoice.create({
      data: {
        companyId, clientId: client?.id ?? null,
        invoiceNumber, clientName: finalClientName,
        clientEmail: client?.email ?? clientEmail,
        issueDate: new Date(issueDate), dueDate: new Date(dueDate),
        subtotal, taxRate, taxAmount, total, notes, createdById: userId,
        items: { create: items.map((item: any) => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, amount: item.quantity * item.unitPrice, contractId: item.contractId, date: item.date ? new Date(item.date) : undefined })) },
      },
      include: { items: true, client: true },
    })
    res.status(201).json(invoice)
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || 'サーバーエラー' })
  }
})

app.put('/api/invoices/:id/send', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.invoice.findFirst({ where: { id: req.params.id, companyId }, include: { company: true } })
  if (!existing) { res.status(404).json({ error: '請求書が見つかりません' }); return }

  const invoice = await prisma.invoice.update({ where: { id: req.params.id }, data: { status: 'SENT', sentAt: new Date() } })

  // 請求書メール送信
  if (existing.clientEmail) {
    const subject = `【請求書】${existing.invoiceNumber} - ${existing.company.name}`
    const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#1e3a5f;color:white;padding:16px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">請求書のご送付</h2>
  </div>
  <div style="background:white;border:1px solid #ddd;border-top:none;padding:24px;border-radius:0 0 8px 8px">
    <p>${existing.clientName} 御中</p>
    <div style="background:#f5f6fa;border-radius:8px;padding:16px;margin:16px 0;font-size:14px">
      <p><strong>請求番号:</strong> ${existing.invoiceNumber}</p>
      <p><strong>合計金額:</strong> ¥${existing.total.toLocaleString()}</p>
      <p><strong>支払期限:</strong> ${new Date(existing.dueDate).toLocaleDateString('ja-JP')}</p>
    </div>
    <p style="font-size:13px;color:#666">ご不明な点は担当者までお問い合わせください。</p>
    <p style="font-size:12px;color:#999">${existing.company.name} | GuardSync</p>
  </div>
</div>`
    await sendEmail(existing.clientEmail, subject, html)
  }

  res.json(invoice)
})

app.put('/api/invoices/:id/paid', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const invoice = await prisma.invoice.updateMany({
    where: { id: req.params.id, companyId, status: { in: ['SENT', 'OVERDUE'] } },
    data: { status: 'PAID' },
  })
  if (invoice.count === 0) { res.status(404).json({ error: '請求書が見つかりません' }); return }
  res.json({ success: true })
})

// ─────────────────────────────────────────────
// 日払い API
// ─────────────────────────────────────────────

app.get('/api/daily-pay', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const requests = await prisma.dailyPayRequest.findMany({
    where: { companyId },
    include: { guard: true },
    orderBy: { createdAt: 'desc' },
  })
  res.json(requests)
})

app.post('/api/daily-pay/request', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { guardId, amount, feeRate = 0.03 } = req.body
  if (!guardId || !amount) { res.status(400).json({ error: '必須項目が不足しています' }); return }

  const guard = await prisma.guard.findFirst({ where: { id: guardId, companyId, dailyPayEnabled: true } })
  if (!guard) { res.status(400).json({ error: '日払い対象外の隊員です' }); return }

  const feeAmount = Math.floor(amount * feeRate)
  const netAmount = amount - feeAmount

  const request = await prisma.dailyPayRequest.create({
    data: { companyId, guardId, requestDate: new Date(), amount: Number(amount), feeRate, feeAmount, netAmount },
  })
  res.status(201).json(request)
})

app.put('/api/daily-pay/:id/approve', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId, userId } = (req as any).user as JwtPayload
  const existing = await prisma.dailyPayRequest.findFirst({ where: { id: req.params.id, companyId, status: 'PENDING' } })
  if (!existing) { res.status(404).json({ error: '申請が見つかりません' }); return }

  const request = await prisma.dailyPayRequest.update({
    where: { id: req.params.id },
    data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
  })
  res.json(request)
})

// ─────────────────────────────────────────────
// 電子契約 API
// ─────────────────────────────────────────────

app.get('/api/e-contracts', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const eContracts = await prisma.electronicContract.findMany({
    where: { companyId },
    include: { signatures: true },
    orderBy: { createdAt: 'desc' },
  })
  res.json(eContracts)
})

app.post('/api/e-contracts', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { title, content, contractId, signers, expiresAt } = req.body
  if (!title || !content || !signers?.length) {
    res.status(400).json({ error: '必須項目が不足しています' }); return
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } })
  const expiry = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  const eContract = await prisma.electronicContract.create({
    data: {
      companyId, title, content, contractId,
      expiresAt: expiry,
      status: 'SENT',
      auditLog: [{ action: 'CREATED', at: new Date().toISOString(), by: companyId }],
      signatures: { create: signers.map((s: any) => ({ signerEmail: s.email, signerName: s.name })) },
    },
    include: { signatures: true },
  })

  // 署名依頼メール送信
  const baseUrl = process.env.APP_URL || 'https://guardsync.up.railway.app'
  for (const sig of eContract.signatures) {
    const signUrl = `${baseUrl}/sign/${sig.token}`
    const subject = `【署名依頼】${title}`
    const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#1e3a5f;color:white;padding:16px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">電子契約 署名依頼</h2>
  </div>
  <div style="background:white;border:1px solid #ddd;border-top:none;padding:24px;border-radius:0 0 8px 8px">
    <p>${sig.signerName} 様</p>
    <p>下記の契約書への電子署名をお願いします。</p>
    <div style="background:#f5f6fa;border-radius:8px;padding:16px;margin:16px 0">
      <p style="margin:0;font-weight:bold">${title}</p>
      <p style="margin:8px 0 0;font-size:13px;color:#666">署名期限: ${expiry.toLocaleDateString('ja-JP')}</p>
    </div>
    <div style="text-align:center;margin:24px 0">
      <a href="${signUrl}" style="background:#1e3a5f;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">署名する</a>
    </div>
    <p style="font-size:12px;color:#999">署名時のIPアドレス・ブラウザ情報が記録されます。</p>
    <p style="font-size:12px;color:#999">${company?.name} | GuardSync</p>
  </div>
</div>`
    await sendEmail(sig.signerEmail, subject, html)
  }

  res.status(201).json(eContract)
})

// 署名URL経由でのアクセス（認証不要）
app.get('/api/e-contracts/sign/:token', async (req, res) => {
  const sig = await prisma.eContractSignature.findUnique({
    where: { token: req.params.token },
    include: { eContract: true },
  })
  if (!sig) { res.status(404).json({ error: '署名リンクが見つかりません' }); return }
  if (sig.signedAt) { res.status(409).json({ error: '既に署名済みです' }); return }
  if (sig.eContract.expiresAt && sig.eContract.expiresAt < new Date()) {
    res.status(410).json({ error: '署名期限が切れています' }); return
  }

  res.json({ title: sig.eContract.title, content: sig.eContract.content, signerName: sig.signerName })
})

app.post('/api/e-contracts/sign/:token', async (req, res) => {
  const sig = await prisma.eContractSignature.findUnique({
    where: { token: req.params.token },
    include: { eContract: { include: { signatures: true } } },
  })
  if (!sig || sig.signedAt) { res.status(400).json({ error: '無効または署名済みです' }); return }
  if (sig.eContract.expiresAt && sig.eContract.expiresAt < new Date()) {
    res.status(410).json({ error: '署名期限が切れています' }); return
  }

  const ipAddress = req.ip
  const userAgent = req.headers['user-agent']

  await prisma.eContractSignature.update({
    where: { id: sig.id },
    data: { signedAt: new Date(), ipAddress, userAgent },
  })

  // 全員署名済みか確認
  const allSigned = sig.eContract.signatures.every(s => s.id === sig.id || s.signedAt)
  if (allSigned) {
    await prisma.electronicContract.update({
      where: { id: sig.eContractId },
      data: {
        status: 'COMPLETED',
        auditLog: { push: { action: 'ALL_SIGNED', at: new Date().toISOString() } },
      },
    })
  } else {
    await prisma.electronicContract.update({
      where: { id: sig.eContractId },
      data: { status: 'PARTIALLY_SIGNED', auditLog: { push: { action: 'SIGNED', by: sig.signerEmail, at: new Date().toISOString(), ip: ipAddress } } },
    })
  }

  res.json({ success: true, message: '署名が完了しました' })
})

// ─────────────────────────────────────────────
// 協力会社 API
// ─────────────────────────────────────────────

app.get('/api/partners', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const partners = await prisma.partner.findMany({
    where: { companyId, isActive: true },
    orderBy: [{ type: 'asc' }, { priority: 'desc' }],
  })
  res.json(partners)
})

app.post('/api/partners', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { name, type = 'GENERAL', contactName, phone, email, priority = 0 } = req.body
  if (!name) { res.status(400).json({ error: '会社名は必須です' }); return }

  const partner = await prisma.partner.create({ data: { companyId, name, type, contactName, phone, email, priority } })
  res.status(201).json(partner)
})

// ─────────────────────────────────────────────
// スーパー管理者 API
// ─────────────────────────────────────────────

app.get('/api/super-admin/companies', authenticate, requireSuperAdmin, async (_req, res) => {
  const companies = await prisma.company.findMany({
    include: { _count: { select: { users: true, guards: true, schedules: true } } },
    orderBy: { createdAt: 'desc' },
  })
  res.json(companies)
})

app.get('/api/super-admin/stats', authenticate, requireSuperAdmin, async (_req, res) => {
  const [companies, users, guards, schedules] = await Promise.all([
    prisma.company.count(),
    prisma.user.count(),
    prisma.guard.count(),
    prisma.schedule.count(),
  ])
  res.json({ companies, users, guards, schedules, timestamp: new Date().toISOString() })
})

app.post('/api/super-admin/invite', authenticate, requireSuperAdmin, async (req, res) => {
  const { email } = req.body
  if (!email) { res.status(400).json({ error: 'メールアドレスは必須です' }); return }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const invitation = await prisma.invitation.create({ data: { email, expiresAt } })
  res.json({ token: invitation.token, registrationUrl: `/register?token=${invitation.token}` })
})

// ─────────────────────────────────────────────
// cron: 前日確認通知（毎日10:00）
// ─────────────────────────────────────────────

cron.schedule('0 10 * * *', async () => {
  console.log('[cron] 前日確認通知 開始')
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowDate = tomorrow.toISOString().split('T')[0]

  const schedules = await prisma.schedule.findMany({
    where: { date: new Date(tomorrowDate), status: 'ASSIGNED' },
    include: { guard: true, site: true, company: { include: { lineWorksSettings: true } } },
  })

  for (const schedule of schedules) {
    const dateStr = `${tomorrow.getFullYear()}年${tomorrow.getMonth() + 1}月${tomorrow.getDate()}日`

    // LINE Works送信
    if (schedule.company.lineWorksSettings) {
      const lw = schedule.company.lineWorksSettings
      let token = lw.accessToken
      if (!token || (lw.tokenExpiresAt && lw.tokenExpiresAt < new Date())) {
        const clientId = process.env.LINE_WORKS_CLIENT_ID
        const clientSecret = process.env.LINE_WORKS_CLIENT_SECRET
        if (clientId && clientSecret) {
          token = await getLineWorksToken(clientId, clientSecret)
          if (token) {
            await prisma.lineWorksSettings.update({
              where: { companyId: schedule.companyId },
              data: { accessToken: token, tokenExpiresAt: new Date(Date.now() + 3600 * 1000) },
            })
          }
        }
      }
      if (token) {
        const msg = `【前日確認】${schedule.guard.name} 様\n明日（${dateStr}）の出動をご確認ください。\n\n📍 ${schedule.site.name}\n🕐 ${schedule.startTime}〜${schedule.endTime}\n📌 ${schedule.site.address}`
        await sendLineWorksMessage(lw.botId, lw.channelId, token, msg)
      }
    }

    // メール送信
    if (schedule.guard.email) {
      const subject = `【前日確認】${dateStr} ${schedule.site.name} 出動のご確認`
      const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#1e3a5f;color:white;padding:16px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">明日の出動確認</h2>
  </div>
  <div style="background:white;border:1px solid #ddd;border-top:none;padding:24px;border-radius:0 0 8px 8px">
    <p>${schedule.guard.name} 様</p>
    <p>明日の出動についてご確認ください。</p>
    <div style="background:#f5f6fa;border-radius:8px;padding:16px;margin:16px 0;font-size:14px">
      <p><strong>日時:</strong> ${dateStr} ${schedule.startTime}〜${schedule.endTime}</p>
      <p><strong>現場:</strong> ${schedule.site.name}</p>
      <p><strong>住所:</strong> ${schedule.site.address}</p>
    </div>
    <p style="font-size:13px;color:#666">不明点・変更がある場合は管理者にご連絡ください。</p>
    <p style="font-size:12px;color:#999">${schedule.company.name} | GuardSync</p>
  </div>
</div>`
      await sendEmail(schedule.guard.email, subject, html)
    }

    await prisma.schedule.update({ where: { id: schedule.id }, data: { confirmedAt: new Date() } })
    await prisma.notification.create({
      data: {
        companyId: schedule.companyId,
        type: 'DAY_BEFORE_CONFIRM',
        title: '前日確認送信',
        body: `${schedule.guard.name} → ${schedule.site.name}`,
        targetId: schedule.guardId,
        status: 'SENT',
        sentAt: new Date(),
      },
    })
    console.log(`[cron] 前日確認: ${schedule.guard.name} → ${schedule.site.name}`)
  }
  console.log(`[cron] 前日確認通知 完了: ${schedules.length}件`)
})

// ─────────────────────────────────────────────
// 車両 API
// ─────────────────────────────────────────────

app.get('/api/vehicles', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const vehicles = await prisma.vehicle.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
  })
  res.json(vehicles)
})

app.post('/api/vehicles', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { plateNumber, model, year } = req.body
  if (!plateNumber) { res.status(400).json({ error: 'ナンバープレートは必須です' }); return }

  const vehicle = await prisma.vehicle.create({
    data: { companyId, plateNumber, model, year: year ? Number(year) : undefined },
  })
  res.status(201).json(vehicle)
})

app.put('/api/vehicles/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.vehicle.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: '車両が見つかりません' }); return }

  const { plateNumber, model, year, isActive } = req.body
  const vehicle = await prisma.vehicle.update({
    where: { id: req.params.id },
    data: { plateNumber, model, year: year ? Number(year) : undefined, isActive },
  })
  res.json(vehicle)
})

app.delete('/api/vehicles/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  await prisma.vehicle.updateMany({
    where: { id: req.params.id, companyId },
    data: { isActive: false },
  })
  res.json({ success: true })
})

// ─────────────────────────────────────────────
// LINE Works Webhook API（自動受付）
// ─────────────────────────────────────────────

app.post('/api/webhook/line-works', async (req, res) => {
  // LINE Works はBotが登録されているChanne IDを識別
  const { type, content, source } = req.body

  if (type !== 'message') { res.json({ ok: true }); return }

  // テキストメッセージのみ処理
  const text = content?.text
  if (!text) { res.json({ ok: true }); return }

  // チャンネルIDからCompanyを特定
  const channelId = source?.channelId
  if (!channelId) { res.json({ ok: true }); return }

  const lwSettings = await prisma.lineWorksSettings.findFirst({ where: { channelId } })
  if (!lwSettings) { res.json({ ok: true }); return }

  // 簡易パース：「○月○日 ×現場 △名」のような文言を受信した場合
  const autoReceipt = await prisma.autoReceipt.create({
    data: {
      companyId: lwSettings.companyId,
      source: 'LINE_WORKS',
      rawContent: text,
      status: 'PENDING',
    },
  })

  console.log(`[webhook] LINE Works自動受付: ${text.slice(0, 50)} (companyId: ${lwSettings.companyId})`)
  res.json({ ok: true })
})

// ─────────────────────────────────────────────
// 設定 API
// ─────────────────────────────────────────────

app.get('/api/settings/line-works', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const settings = await prisma.lineWorksSettings.findUnique({ where: { companyId } })
  if (!settings) { res.status(404).json({ error: 'LINE Works未設定' }); return }
  res.json({ botId: settings.botId, channelId: settings.channelId, tokenExpiresAt: settings.tokenExpiresAt })
})

app.post('/api/settings/line-works', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { botId, channelId } = req.body
  if (!botId || !channelId) { res.status(400).json({ error: 'Bot IDとChannel IDは必須です' }); return }

  const settings = await prisma.lineWorksSettings.upsert({
    where: { companyId },
    create: { companyId, botId, channelId },
    update: { botId, channelId, accessToken: null, tokenExpiresAt: null },
  })
  res.json(settings)
})

app.get('/api/settings/users', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const users = await prisma.user.findMany({
    where: { companyId, isActive: true },
    select: { id: true, name: true, email: true, role: true, lastLoginAt: true },
    orderBy: { name: 'asc' },
  })
  res.json(users)
})

// ─────────────────────────────────────────────
// 管制機能 - 一括配員 API
// ─────────────────────────────────────────────

// 空きの隊員を返す（指定日・時間帯で未配員の隊員）
app.get('/api/schedules/available-guards', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { date, startTime, endTime } = req.query
  if (!date) { res.status(400).json({ error: 'dateは必須です' }); return }

  // 指定日にすでに配員されている隊員ID
  const assigned = await prisma.schedule.findMany({
    where: { companyId, date: new Date(String(date)), status: { not: 'CANCELLED' } },
    select: { guardId: true },
  })
  const assignedIds = assigned.map(s => s.guardId)

  const guards = await prisma.guard.findMany({
    where: { companyId, isActive: true, id: { notIn: assignedIds } },
    orderBy: { employeeNumber: 'asc' },
  })
  res.json(guards)
})

// 月間シフト一覧（CSV出力用）
app.get('/api/schedules/monthly', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { year, month } = req.query
  if (!year || !month) { res.status(400).json({ error: 'year・monthは必須です' }); return }

  const y = Number(year)
  const m = Number(month)
  const from = new Date(y, m - 1, 1)
  const to = new Date(y, m, 0)

  const schedules = await prisma.schedule.findMany({
    where: { companyId, date: { gte: from, lte: to } },
    include: { guard: true, site: true, attendance: true },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  })

  if (req.headers.accept === 'text/csv') {
    const rows = [
      ['日付', '曜日', '隊員番号', '隊員名', '現場', '開始', '終了', '出勤時刻', '退勤時刻', 'ステータス'],
      ...schedules.map(s => {
        const d = new Date(s.date)
        const weekdays = ['日', '月', '火', '水', '木', '金', '土']
        return [
          `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`,
          weekdays[d.getDay()],
          s.guard.employeeNumber,
          s.guard.name,
          s.site.name,
          s.startTime,
          s.endTime,
          s.attendance?.clockInAt ? new Date(s.attendance.clockInAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '',
          s.attendance?.clockOutAt ? new Date(s.attendance.clockOutAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '',
          s.status,
        ].join(',')
      }),
    ]
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="schedule_${year}_${month}.csv"`)
    res.send('\uFEFF' + rows.join('\n')) // BOM付きUTF-8
    return
  }

  res.json(schedules)
})

// 隊員の月間シフト（隊員アプリ用）
app.get('/api/guards/:id/schedule', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { year, month } = req.query

  const y = Number(year) || new Date().getFullYear()
  const m = Number(month) || new Date().getMonth() + 1
  const from = new Date(y, m - 1, 1)
  const to = new Date(y, m, 0)

  const guard = await prisma.guard.findFirst({ where: { id: req.params.id, companyId } })
  if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

  const schedules = await prisma.schedule.findMany({
    where: { guardId: req.params.id, companyId, date: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
    include: { site: true, attendance: true },
    orderBy: { date: 'asc' },
  })
  res.json({ guard, schedules })
})

// ─────────────────────────────────────────────
// 管制機能 - 警備報告書 API
// ─────────────────────────────────────────────

app.get('/api/security-reports', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { guardId, siteId, from, to } = req.query

  const reports = await prisma.securityReport.findMany({
    where: {
      companyId,
      ...(guardId ? { guardId: String(guardId) } : {}),
      ...(siteId ? { siteId: String(siteId) } : {}),
      ...(from || to ? { reportDate: { ...(from ? { gte: new Date(String(from)) } : {}), ...(to ? { lte: new Date(String(to)) } : {}) } } : {}),
    },
    include: { guard: true, site: true },
    orderBy: { reportDate: 'desc' },
  })
  res.json(reports)
})

app.post('/api/security-reports', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { guardId, siteId, reportDate, content, clientEmail } = req.body
  if (!guardId || !siteId || !reportDate || !content) {
    res.status(400).json({ error: '必須項目が不足しています' }); return
  }

  const report = await prisma.securityReport.create({
    data: { companyId, guardId, siteId, reportDate: new Date(reportDate), content },
    include: { guard: true, site: true, company: true },
  })

  // 発注元への承認依頼メール
  if (clientEmail) {
    const baseUrl = process.env.APP_URL || 'https://guardsync.up.railway.app'
    const approvalUrl = `${baseUrl}/api/security-reports/approve/${report.approvalToken}`
    const dateStr = new Date(reportDate).toLocaleDateString('ja-JP')
    const subject = `【承認依頼】${dateStr} ${(report as any).site.name} 警備報告書`
    const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#1e3a5f;color:white;padding:16px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">警備報告書 承認依頼</h2>
  </div>
  <div style="background:white;border:1px solid #ddd;border-top:none;padding:24px;border-radius:0 0 8px 8px">
    <p>担当者様</p>
    <p>下記の警備報告書のご確認・承認をお願いします。</p>
    <div style="background:#f5f6fa;border-radius:8px;padding:16px;margin:16px 0;font-size:14px">
      <p><strong>報告日:</strong> ${dateStr}</p>
      <p><strong>現場:</strong> ${(report as any).site.name}</p>
      <p><strong>担当隊員:</strong> ${(report as any).guard.name}</p>
    </div>
    <div style="text-align:center;margin:24px 0">
      <a href="${approvalUrl}" style="background:#27ae60;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">報告書を承認する</a>
    </div>
    <p style="font-size:12px;color:#999">${(report as any).company.name} | GuardSync</p>
  </div>
</div>`
    await sendEmail(clientEmail, subject, html)
  }

  res.status(201).json(report)
})

// メールリンクによる承認（認証不要）
app.post('/api/security-reports/approve/:token', async (req, res) => {
  const report = await prisma.securityReport.findFirst({ where: { approvalToken: req.params.token } })
  if (!report) { res.status(404).json({ error: '報告書が見つかりません' }); return }
  if (report.approvedAt) { res.status(409).json({ error: '既に承認済みです' }); return }

  const { approvedBy } = req.body
  await prisma.securityReport.update({
    where: { id: report.id },
    data: { approvedAt: new Date(), approvedBy: approvedBy || '承認者' },
  })
  res.json({ success: true, message: '警備報告書が承認されました' })
})

// ─────────────────────────────────────────────
// CSV出力 API
// ─────────────────────────────────────────────

// 隊員一覧CSV
app.get('/api/export/guards', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const guards = await prisma.guard.findMany({ where: { companyId }, orderBy: { employeeNumber: 'asc' } })

  const rows = [
    ['社員番号', '氏名', 'フリガナ', '生年月日', '性別', '電話番号', 'メール', '雇用形態', '日払い対象', '入社日', '資格'],
    ...guards.map(g => [
      g.employeeNumber, g.name, g.nameKana,
      g.birthDate ? new Date(g.birthDate).toLocaleDateString('ja-JP') : '',
      g.gender || '',
      g.phone || '', g.email || '',
      g.employmentType,
      g.dailyPayEnabled ? '○' : '×',
      g.joinedAt ? new Date(g.joinedAt).toLocaleDateString('ja-JP') : '',
      (g.certifications || []).join('・'),
    ].join(',')),
  ]
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="guards.csv"')
  res.send('\uFEFF' + rows.join('\n'))
})

// 請求書CSV（会計ソフト連携用）
app.get('/api/export/invoices', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { from, to, format: fmt } = req.query

  const invoices = await prisma.invoice.findMany({
    where: {
      companyId,
      ...(from || to ? { issueDate: { ...(from ? { gte: new Date(String(from)) } : {}), ...(to ? { lte: new Date(String(to)) } : {}) } } : {}),
    },
    include: { items: true },
    orderBy: { issueDate: 'asc' },
  })

  // マネーフォワード・弥生・freee共通フォーマット（仕訳形式）
  const rows = [
    ['請求番号', '発行日', '支払期限', '発注元', '品目', '数量', '単価', '金額', '税率', '税額', '合計', 'ステータス'],
    ...invoices.flatMap(inv =>
      inv.items.map(item => [
        inv.invoiceNumber,
        new Date(inv.issueDate).toLocaleDateString('ja-JP'),
        new Date(inv.dueDate).toLocaleDateString('ja-JP'),
        inv.clientName,
        item.description,
        item.quantity,
        item.unitPrice,
        item.amount,
        `${inv.taxRate * 100}%`,
        inv.taxAmount,
        inv.total,
        inv.status,
      ].join(','))
    ),
  ]
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"')
  res.send('\uFEFF' + rows.join('\n'))
})

// 日払い集計CSV（月末給与差引用）
app.get('/api/export/daily-pay', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { year, month } = req.query
  if (!year || !month) { res.status(400).json({ error: 'year・monthは必須です' }); return }

  const y = Number(year)
  const m = Number(month)
  const from = new Date(y, m - 1, 1)
  const to = new Date(y, m, 0)

  const requests = await prisma.dailyPayRequest.findMany({
    where: { companyId, status: 'APPROVED', requestDate: { gte: from, lte: to } },
    include: { guard: true },
    orderBy: [{ guard: { employeeNumber: 'asc' } }, { requestDate: 'asc' }],
  })

  // 隊員別集計
  const summary = new Map<string, { guard: any; totalAmount: number; totalFee: number; count: number }>()
  for (const r of requests) {
    const key = r.guardId
    if (!summary.has(key)) summary.set(key, { guard: r.guard, totalAmount: 0, totalFee: 0, count: 0 })
    const s = summary.get(key)!
    s.totalAmount += r.amount
    s.totalFee += r.feeAmount
    s.count += 1
  }

  const rows = [
    [`${y}年${m}月 日払い集計`],
    ['社員番号', '氏名', '申請回数', '申請合計額', '手数料合計', '差引額（月末給与から控除）'],
    ...[...summary.values()].map(s => [
      s.guard.employeeNumber, s.guard.name, s.count,
      s.totalAmount, s.totalFee, s.totalFee,
    ].join(',')),
  ]
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="daily_pay_${year}_${month}.csv"`)
  res.send('\uFEFF' + rows.join('\n'))
})

app.get('/api/export/attendance', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { from, to, year, month } = req.query
  const y = year ? Number(year) : new Date().getFullYear()
  const m = month ? Number(month) : new Date().getMonth() + 1
  const dateFrom = from ? new Date(String(from)) : new Date(y, m - 1, 1)
  const dateTo = to ? new Date(String(to)) : new Date(y, m, 0, 23, 59, 59)

  const records = await prisma.attendance.findMany({
    where: { companyId, clockInAt: { gte: dateFrom, lte: dateTo } },
    include: { schedule: { include: { guard: true, site: true } } },
    orderBy: { clockInAt: 'asc' },
  })

  const rows = [
    ['社員番号', '氏名', '現場', '日付', '出勤時刻', '退勤時刻', '勤務時間（分）', '休憩時間（分）'],
    ...records.map(a => {
      const s = a.schedule as any
      const clockIn = new Date(a.clockInAt as Date)
      const clockOut = a.clockOutAt ? new Date(a.clockOutAt as Date) : null
      const workMin = clockOut
        ? Math.floor((clockOut.getTime() - clockIn.getTime()) / 60000) - (a.breakMinutes || 0)
        : ''
      return [
        s?.guard?.employeeNumber || '',
        s?.guard?.name || '',
        s?.site?.name || '',
        clockIn.toLocaleDateString('ja-JP'),
        clockIn.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
        clockOut ? clockOut.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '未退勤',
        workMin,
        a.breakMinutes || 0,
      ].join(',')
    }),
  ]
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="attendance_${y}_${m}.csv"`)
  res.send('\uFEFF' + rows.join('\n'))
})

// ─────────────────────────────────────────────
// 通知 API
// ─────────────────────────────────────────────

app.get('/api/notifications', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const notifications = await prisma.notification.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  res.json(notifications)
})

app.post('/api/notifications/send', authenticate, requireRole('ADMIN', 'MANAGER', 'OPERATOR'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { type, title, body, targetIds, channel = 'LINE_WORKS' } = req.body
  if (!type || !title || !body) { res.status(400).json({ error: '必須項目が不足しています' }); return }

  const targets = targetIds?.length ? targetIds : ['ALL']
  const notifications = await prisma.$transaction(
    targets.map((targetId: string) =>
      prisma.notification.create({
        data: { companyId, type, title, body, targetId, channel, status: 'PENDING' },
      })
    )
  )

  // LINE Works送信は Week 3 で実装
  // ここではDBに記録してPENDINGのまま
  res.json({ sent: notifications.length, notifications })
})

// ─────────────────────────────────────────────
// 自動受付 API (FAX/メール OCR)
// ─────────────────────────────────────────────

app.get('/api/auto-receipts', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const receipts = await prisma.autoReceipt.findMany({
    where: { companyId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  })
  res.json(receipts)
})

app.post('/api/auto-receipts/:id/accept', authenticate, requireRole('ADMIN', 'MANAGER', 'OPERATOR'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const receipt = await prisma.autoReceipt.findFirst({ where: { id: req.params.id, companyId } })
  if (!receipt) { res.status(404).json({ error: '受付データが見つかりません' }); return }

  // サジェストをスケジュールに登録
  const { scheduleData } = req.body // { guardId, siteId, date, startTime, endTime }
  if (scheduleData) {
    await prisma.schedule.create({
      data: { companyId, ...scheduleData, date: new Date(scheduleData.date) },
    })
  }

  await prisma.autoReceipt.update({
    where: { id: receipt.id },
    data: { status: 'ACCEPTED', processedAt: new Date() },
  })
  res.json({ success: true })
})

app.post('/api/auto-receipts/:id/reject', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  await prisma.autoReceipt.updateMany({
    where: { id: req.params.id, companyId },
    data: { status: 'REJECTED', processedAt: new Date() },
  })
  res.json({ success: true })
})

// ─────────────────────────────────────────────
// ダッシュボード統計 API
// ─────────────────────────────────────────────

app.get('/api/stats/dashboard', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const [
    todayCount, tomorrowCount, activeGuards, pendingInvoices,
    pendingDailyPay, monthlySchedules, openContracts,
  ] = await Promise.all([
    prisma.schedule.count({ where: { companyId, date: today, status: { not: 'CANCELLED' } } }),
    prisma.schedule.count({ where: { companyId, date: tomorrow, status: { not: 'CANCELLED' } } }),
    prisma.guard.count({ where: { companyId, isActive: true } }),
    prisma.invoice.count({ where: { companyId, status: { in: ['SENT', 'OVERDUE'] } } }),
    prisma.dailyPayRequest.count({ where: { companyId, status: 'PENDING' } }),
    prisma.schedule.count({
      where: {
        companyId,
        date: {
          gte: new Date(today.getFullYear(), today.getMonth(), 1),
          lte: new Date(today.getFullYear(), today.getMonth() + 1, 0),
        },
      },
    }),
    prisma.contract.count({ where: { companyId, status: 'ACTIVE' } }),
  ])

  res.json({ todayCount, tomorrowCount, activeGuards, pendingInvoices, pendingDailyPay, monthlySchedules, openContracts })
})

// ─────────────────────────────────────────────
// cron: 月末日払い手数料差引処理（毎月末日 23:55）
// ─────────────────────────────────────────────

cron.schedule('55 23 28-31 * *', async () => {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)

  // 今日が月末日のときのみ実行
  if (tomorrow.getMonth() === now.getMonth()) return

  console.log('[cron] 月末日払い差引処理 開始')

  const approvedRequests = await prisma.dailyPayRequest.findMany({
    where: {
      status: 'PAID',
      deductedAt: null,
      requestDate: {
        gte: new Date(now.getFullYear(), now.getMonth(), 1),
        lte: new Date(now.getFullYear(), now.getMonth() + 1, 0),
      },
    },
    include: { guard: true },
  })

  for (const req of approvedRequests) {
    await prisma.dailyPayRequest.update({
      where: { id: req.id },
      data: { status: 'DEDUCTED', deductedAt: new Date() },
    })
    console.log(`[cron] 日払い差引: ${req.guard.name} 手数料¥${req.feeAmount}`)
  }

  console.log(`[cron] 月末日払い差引処理 完了: ${approvedRequests.length}件`)
})

// ─────────────────────────────────────────────
// スケジュール 前日確認メール 手動送信
// ─────────────────────────────────────────────
app.post('/api/schedules/:id/send-reminder', authenticate, requireRole('ADMIN', 'MANAGER', 'OPERATOR'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const schedule = await prisma.schedule.findFirst({
    where: { id: req.params.id, companyId },
    include: { guard: true, site: true, company: { include: { lineWorksSettings: true } } },
  })
  if (!schedule) { res.status(404).json({ error: '配員データが見つかりません' }); return }

  const { guard, site, company } = schedule as any
  const dateStr = new Date(schedule.date).toLocaleDateString('ja-JP')
  const text = `【前日確認】${guard.name}様\n明日 ${dateStr} ${schedule.startTime}〜${schedule.endTime}\n現場: ${site.name}\nご確認ください。`

  let emailSent = false
  let lineWorksSent = false

  if (guard.email) {
    emailSent = await sendEmail(
      guard.email,
      `【前日確認】${dateStr} ${site.name}`,
      `<p>${text.replace(/\n/g, '<br>')}</p>`,
      text
    )
  }

  const lw = company.lineWorksSettings
  if (lw) {
    const clientId = process.env.LINE_WORKS_CLIENT_ID || ''
    const clientSecret = process.env.LINE_WORKS_CLIENT_SECRET || ''
    const token = await getLineWorksToken(clientId, clientSecret)
    if (token) lineWorksSent = await sendLineWorksMessage(lw.botId, lw.channelId, token, text)
  }

  res.json({ success: true, emailSent, lineWorksSent })
})

// ─────────────────────────────────────────────
// メール受信 Webhook (SendGrid Inbound Parse)
// ─────────────────────────────────────────────
// SendGrid → Settings > Inbound Parse > POST /api/inbound/email
app.post('/api/inbound/email', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const from: string = req.body.from || req.body.sender || ''
    const subject: string = req.body.subject || ''
    const text: string = req.body.text || req.body.html || ''
    const rawContent = `差出人: ${from}\n件名: ${subject}\n\n${text}`.slice(0, 2000)

    // メールアドレスドメインからテナント特定（例: receive@{company_code}.guardsync.jp）
    // シンプルに全会社共通受信 → 会社コードが件名またはToに含まれる場合に振り分け
    // ここでは最初に見つかった有効会社に登録（本番は会社コード解析を追加）
    const firstCompany = await prisma.company.findFirst({ where: { isActive: true } })
    if (!firstCompany) { res.status(200).send('ok'); return }

    await prisma.autoReceipt.create({
      data: {
        companyId: firstCompany.id,
        source: 'EMAIL',
        rawContent,
        status: 'PENDING',
      },
    })
    console.log('[inbound/email] AutoReceipt created')
    res.status(200).send('ok')
  } catch (err) {
    console.error('[inbound/email] error:', err)
    res.status(200).send('ok') // SendGridは200以外でリトライするため必ず200を返す
  }
})

// ─────────────────────────────────────────────
// FAX受信 Webhook stub (Google Vision API OCR)
// ─────────────────────────────────────────────
// FAX受信サービス（eFax, RingCentral等）からPDFをPOSTで受け取り、
// Google Vision API でOCRしてAutoReceiptに登録する
app.post('/api/inbound/fax', async (req, res) => {
  try {
    // req.body.pdfBase64 または req.body.imageBase64 を想定
    const rawText: string = req.body.text || req.body.ocrText || 'FAX受信（OCR未処理）'
    const from: string = req.body.from || req.body.callerNumber || '不明'
    const rawContent = `FAX送信元: ${from}\n\n${rawText}`.slice(0, 2000)

    const firstCompany = await prisma.company.findFirst({ where: { isActive: true } })
    if (!firstCompany) { res.status(200).send('ok'); return }

    await prisma.autoReceipt.create({
      data: {
        companyId: firstCompany.id,
        source: 'FAX',
        rawContent,
        status: 'PENDING',
      },
    })
    console.log('[inbound/fax] AutoReceipt created from FAX')
    res.status(200).json({ success: true })
  } catch (err) {
    console.error('[inbound/fax] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────
// LINE Works 接続テスト
// ─────────────────────────────────────────────
app.post('/api/settings/line-works/test', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const settings = await prisma.lineWorksSettings.findUnique({ where: { companyId } })
  if (!settings) { res.status(400).json({ error: 'LINE Works設定が見つかりません' }); return }

  try {
    const clientId = process.env.LINE_WORKS_CLIENT_ID || ''
    const clientSecret = process.env.LINE_WORKS_CLIENT_SECRET || ''
    const token = await getLineWorksToken(clientId, clientSecret)
    if (!token) { res.status(400).json({ error: 'アクセストークン取得失敗。環境変数（LINE_WORKS_CLIENT_ID等）を確認してください' }); return }
    await sendLineWorksMessage(settings.botId, settings.channelId, token, '🔔 GuardSync LINE Works 接続テスト成功！')
    res.json({ success: true, message: 'テストメッセージを送信しました' })
  } catch (err: any) {
    res.status(400).json({ error: `接続失敗: ${err.message}` })
  }
})

// ─────────────────────────────────────────────
// 静的ファイル配信（本番）
// ─────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist/public')))
  app.use((_req, res) => {
    res.sendFile(path.join(__dirname, 'dist/public/index.html'))
  })
}

// ─────────────────────────────────────────────
// 起動
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`GuardSync server running on port ${PORT}`)
})

export default app
