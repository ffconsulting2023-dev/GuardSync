import 'express-async-errors'
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
import crypto from 'crypto'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Stripe = require('stripe')

dotenv.config()

const isProduction = process.env.NODE_ENV === 'production'

// ─────────────────────────────────────────────
// 構造化ログ
// ─────────────────────────────────────────────
const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'info', timestamp: new Date().toISOString(), message, ...meta }))
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: 'warn', timestamp: new Date().toISOString(), message, ...meta }))
  },
  error: (message: string, error?: unknown, meta?: Record<string, unknown>) => {
    const errorInfo = error instanceof Error
      ? { errorMessage: error.message, stack: isProduction ? undefined : error.stack }
      : { errorMessage: String(error) }
    console.error(JSON.stringify({ level: 'error', timestamp: new Date().toISOString(), message, ...errorInfo, ...meta }))
  },
}

// ─────────────────────────────────────────────
// Stripe初期化（APIキー未設定時はnull → 使用時にチェック）
// ─────────────────────────────────────────────
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

function getPriceIdForPlan(planType: string): string {
  const map: Record<string, string> = {
    STARTER:    process.env.STRIPE_PRICE_STARTER    || '',
    STANDARD:   process.env.STRIPE_PRICE_STANDARD   || '',
    ENTERPRISE: process.env.STRIPE_PRICE_ENTERPRISE || '',
  }
  return map[planType] || map['STARTER']
}

// ─────────────────────────────────────────────
// 起動時セキュリティバリデーション
// ─────────────────────────────────────────────
const JWT_SECRET_RAW = process.env.JWT_SECRET
if (!JWT_SECRET_RAW || JWT_SECRET_RAW.length < 32) {
  logger.error('JWT_SECRET が未設定または短すぎます（32文字以上必要）。サーバーを起動できません。')
  // 注意: .env の JWT_SECRET を32文字以上に変更してください（例: openssl rand -hex 32）
  process.exit(1)
}
const JWT_SECRET: string = JWT_SECRET_RAW

// ─────────────────────────────────────────────
// 暗号化ヘルパー（LINE Works機密情報用）
// ─────────────────────────────────────────────
function encrypt(text: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key || key.length < 32) return text // 未設定時はそのまま（開発環境）
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key.slice(0, 32)), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return `enc:${iv.toString('hex')}:${encrypted.toString('hex')}`
}

function decrypt(text: string): string {
  if (!text?.startsWith('enc:')) return text // 未暗号化データはそのまま返す
  const key = process.env.ENCRYPTION_KEY
  if (!key || key.length < 32) return text
  const [, ivHex, encHex] = text.split(':')
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key.slice(0, 32)), Buffer.from(ivHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8')
}

// ─────────────────────────────────────────────
// HTMLエスケープヘルパー（メールテンプレート用）
// ─────────────────────────────────────────────
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ─────────────────────────────────────────────
// CSVインジェクション対策ヘルパー
// ─────────────────────────────────────────────
function escapeCsvCell(value: unknown): string {
  const str = value == null ? '' : String(value)
  // CSV injection: セル先頭が危険な文字の場合はシングルクォートを前置
  const sanitized = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str
  // カンマ・ダブルクォート・改行を含む場合はダブルクォートで囲む
  return sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n')
    ? `"${sanitized.replace(/"/g, '""')}"`
    : sanitized
}

// ─────────────────────────────────────────────
// Webhook認証ヘルパー
// ─────────────────────────────────────────────
function verifyWebhookSecret(req: express.Request, res: express.Response): boolean {
  const secret = process.env.INBOUND_SECRET
  if (!secret) return true // 未設定の場合はスキップ（開発環境考慮）
  const provided = req.headers['x-webhook-secret'] || req.query.secret
  if (provided !== secret) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

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
    logger.info(`SMTP未設定 - メール送信スキップ: ${subject} → ${to}`, { context: 'email' })
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
    logger.error('送信エラー', e, { context: 'email' })
    return false
  }
}

// ─────────────────────────────────────────────
// LINE Works送信ヘルパー
// ─────────────────────────────────────────────

async function getLineWorksToken(botId: string, botSecret: string): Promise<string | null> {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: botId,
    client_secret: botSecret,
    scope: 'bot',
  })
  try {
    const res = await fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    if (!res.ok) {
      const errText = await res.text()
      logger.error('token error', errText, { context: 'LINE Works', status: res.status })
      return null
    }
    const data = await res.json() as { access_token: string }
    return data.access_token
  } catch (e) {
    logger.error('token fetch error', e, { context: 'LINE Works' })
    return null
  }
}

// 個人宛メッセージ送信
async function sendLineWorksMessage(botId: string, userId: string, accessToken: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://www.worksapis.com/v1.0/bots/${botId}/users/${userId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { type: 'text', text } }),
    })
    if (!res.ok) {
      const errText = await res.text()
      logger.error('send error', errText, { context: 'LINE Works', status: res.status })
    }
    return res.ok
  } catch (e) {
    logger.error('send error', e, { context: 'LINE Works' })
    return false
  }
}

const app = express()
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error'],
})
const PORT = process.env.PORT || 3000

// ─────────────────────────────────────────────
// ミドルウェア
// ─────────────────────────────────────────────

// H-4: Content Security Policy を有効化
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],   // Viteのインラインスクリプト対応
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https://www.worksapis.com', 'https://auth.worksmobile.com'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}))

// H-3: CORS設定を明示的なオリジンリストに変更
const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? [process.env.APP_URL].filter(Boolean) as string[]
  : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173']

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) callback(null, true)
    else callback(new Error('CORS policy violation'))
  },
  credentials: true,
}))

// Stripe Webhookはraw bodyが必要なため、express.json()より前に登録
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// M-1: レート制限を強化
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: 'リクエストが多すぎます。しばらくしてからお試しください。' } })
app.use('/api/', limiter)

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'ログイン試行回数の上限に達しました。15分後にお試しください。' } })
app.use('/api/auth/login', authLimiter)

// Webhook専用レート制限: 緩めに設定
const webhookLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 30 })
app.use('/api/inbound/', webhookLimiter)
app.use('/api/webhook/', webhookLimiter)

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
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '4h' })
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
// テナント利用停止チェック（1分キャッシュ付き）
// ─────────────────────────────────────────────
const companyStatusCache = new Map<string, { isActive: boolean; status: string; expiresAt: number }>()

async function checkCompanyActive(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = (req as any).user as JwtPayload
  if (!user) { next(); return }
  if (user.isSuperAdmin) { next(); return }

  const cached = companyStatusCache.get(user.companyId)
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.isActive || cached.status === 'SUSPENDED') {
      res.status(403).json({ error: 'ご利用中のアカウントは現在停止されています。お支払い状況をご確認ください。', code: 'COMPANY_SUSPENDED' })
      return
    }
    next(); return
  }

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { isActive: true, subscriptionStatus: true },
  })
  companyStatusCache.set(user.companyId, {
    isActive: company?.isActive ?? false,
    status: company?.subscriptionStatus ?? 'TRIAL',
    expiresAt: Date.now() + 60_000,
  })

  if (!company || !company.isActive || company.subscriptionStatus === 'SUSPENDED') {
    res.status(403).json({ error: 'ご利用中のアカウントは現在停止されています。お支払い状況をご確認ください。', code: 'COMPANY_SUSPENDED' })
    return
  }
  next()
}

// authenticateとテナントチェックを合成したミドルウェア
function authenticateAndCheck(req: express.Request, res: express.Response, next: express.NextFunction) {
  authenticate(req, res, () => checkCompanyActive(req, res, next))
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

  // H-6: パスワード強度要件（8文字以上、大文字・小文字・数字を含む）
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/
  if (!passwordRegex.test(password)) {
    res.status(400).json({ error: 'パスワードは8文字以上で、大文字・小文字・数字を含む必要があります' })
    return
  }

  const invitation = await prisma.invitation.findUnique({ where: { token } })
  if (!invitation || invitation.usedAt || invitation.expiresAt < new Date()) {
    res.status(400).json({ error: '招待リンクが無効または期限切れです' }); return
  }

  // M-2: companyId必須チェック（スーパー管理者招待でcompanyIdが無い場合の安全対策）
  if (!invitation.companyId) {
    res.status(400).json({ error: '招待リンクが無効です（会社情報が不足しています）' })
    return
  }

  const existing = await prisma.user.findUnique({ where: { email: invitation.email } })
  if (existing) { res.status(409).json({ error: 'このメールアドレスは既に登録されています' }); return }

  const hashed = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({
    data: { email: invitation.email, password: hashed, name, companyId: invitation.companyId, role: 'OPERATOR' },
  })

  await prisma.invitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } })

  const jwtToken = signToken({ userId: user.id, companyId: user.companyId, role: user.role, isSuperAdmin: false })
  res.json({ token: jwtToken })
})

// ─────────────────────────────────────────────
// パスワードリセット API
// ─────────────────────────────────────────────

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body
  if (!email || typeof email !== 'string') { res.status(400).json({ error: 'メールアドレスは必須です' }); return }

  // ユーザー存在の有無を外部に漏らさないため、常に200を返す
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
  if (!user || !user.isActive) { res.json({ message: '登録済みのメールアドレスにリセット用URLを送信しました' }); return }

  // 既存の未使用トークンを無効化
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  })

  // 新しいトークン生成（1時間有効）
  const token = require('crypto').randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  await prisma.passwordResetToken.create({ data: { token, userId: user.id, expiresAt } })

  const resetUrl = `${process.env.APP_URL || 'http://localhost:5173'}/reset-password?token=${token}`
  await sendEmail(
    user.email,
    '【GuardSync】パスワードリセットのご案内',
    `<p>${escapeHtml(user.name)} 様</p>
<p>パスワードリセットのリクエストを受け付けました。</p>
<p>下記のURLをクリックして新しいパスワードを設定してください（有効期限：1時間）。</p>
<p><a href="${resetUrl}">${resetUrl}</a></p>
<p>このメールに心当たりがない場合は無視してください。</p>
<p>GuardSync 運営事務局</p>`
  )

  res.json({ message: '登録済みのメールアドレスにリセット用URLを送信しました' })
})

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password, passwordConfirm } = req.body
  if (!token || !password || !passwordConfirm) { res.status(400).json({ error: '必須項目が不足しています' }); return }
  if (password !== passwordConfirm) { res.status(400).json({ error: 'パスワードが一致しません' }); return }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/
  if (!passwordRegex.test(password)) {
    res.status(400).json({ error: 'パスワードは8文字以上で、大文字・小文字・数字を含めてください' }); return
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token },
    include: { user: true },
  })

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    res.status(400).json({ error: 'リセット用URLが無効または期限切れです。再度パスワードリセットを申請してください。' }); return
  }

  const hashed = await bcrypt.hash(password, 12)
  await prisma.user.update({ where: { id: resetToken.userId }, data: { password: hashed } })
  await prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } })

  res.json({ message: 'パスワードを更新しました。新しいパスワードでログインしてください。' })
})

// ─────────────────────────────────────────────
// 隊員 API
// ─────────────────────────────────────────────

app.get('/api/guards', authenticate, async (req, res) => {
  const { companyId, role } = (req as any).user as JwtPayload
  const isPrivileged = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'].includes(role) || (req as any).user.isSuperAdmin
  const { search, isActive } = req.query

  const guards = await prisma.guard.findMany({
    where: {
      companyId,
      ...(isActive !== undefined ? { isActive: isActive === 'true' } : {}),
      ...(search ? { OR: [{ name: { contains: String(search) } }, { nameKana: { contains: String(search) } }, { employeeNumber: { contains: String(search) } }] } : {}),
    },
    orderBy: { employeeNumber: 'asc' },
  })

  // H-1 & M-9: 権限が低いユーザーには機密フィールドを除外
  const result = guards.map(g => {
    if (isPrivileged) return g
    const { bankAccount, lineWorksId, ...safe } = g as any
    return safe
  })
  res.json(result)
})

app.get('/api/guards/:id', authenticate, async (req, res) => {
  const { companyId, role } = (req as any).user as JwtPayload
  const isPrivileged = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'].includes(role) || (req as any).user.isSuperAdmin
  const guard = await prisma.guard.findFirst({ where: { id: req.params.id, companyId } })
  if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

  // H-1 & M-9: 権限が低いユーザーには機密フィールドを除外
  if (!isPrivileged) {
    const { bankAccount, lineWorksId, ...safe } = guard as any
    res.json(safe)
    return
  }
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
  lineWorksId: z.string().optional(),
  // 住所（構造化）
  postalCode: z.string().optional(),
  prefecture: z.string().optional(),
  city: z.string().optional(),
  addressDetail: z.string().optional(),
  buildingName: z.string().optional(),
  // 最寄駅
  nearestStation1: z.string().optional(),
  line1: z.string().optional(),
  nearestStation2: z.string().optional(),
  line2: z.string().optional(),
  // 追加属性
  birthplace: z.string().optional(),
  medicalHistory: z.string().optional(),
  financialIssues: z.boolean().optional(),
  mbti: z.string().optional(),
  dormitory: z.string().optional(),
  guardClass: z.string().optional(),
  skills: z.array(z.string()).optional(),
  nationality: z.string().optional(),
  notes: z.string().optional(),
  // NG設定
  ngGuardIds: z.array(z.string()).optional(),
  ngCompanies: z.array(z.string()).optional(),
  ngConditions: z.string().optional(),
  // 評価
  overallRating: z.number().int().min(1).max(5).optional().nullable(),
  ratingComment: z.string().optional(),
  chartRatings: z.record(z.string(), z.number()).optional(),
  // 勤務希望条件
  workConditions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  // 給与体系
  payType: z.string().optional(),
  monthlyBase: z.number().int().optional().nullable(),
  hourlyBase: z.number().int().optional().nullable(),
  // 勤務単価
  dayShiftRate: z.number().int().optional().nullable(),
  nightShiftRate: z.number().int().optional().nullable(),
  holidayDayRate: z.number().int().optional().nullable(),
  holidayNightRate: z.number().int().optional().nullable(),
  dayOvertimeRate: z.number().int().optional().nullable(),
  nightOvertimeRate: z.number().int().optional().nullable(),
  holidayDayOtRate: z.number().int().optional().nullable(),
  holidayNightOtRate: z.number().int().optional().nullable(),
  // 手当
  positionAllowance: z.number().int().optional().nullable(),
  qualificationAllowance: z.number().int().optional().nullable(),
  leaderAllowance: z.number().int().optional().nullable(),
  joiningAllowance: z.number().int().optional().nullable(),
  otherAllowance1: z.number().int().optional().nullable(),
  otherAllowance2: z.number().int().optional().nullable(),
  otherAllowanceName1: z.string().optional(),
  otherAllowanceName2: z.string().optional(),
  // 社会保険
  employmentInsurance: z.boolean().optional(),
  healthInsurance: z.boolean().optional(),
  healthInsuranceGrade: z.number().int().optional().nullable(),
  pensionInsurance: z.boolean().optional(),
  pensionInsuranceGrade: z.number().int().optional().nullable(),
  nursingInsurance: z.boolean().optional(),
  // 家族構成
  spouse: z.boolean().optional(),
  spouseDeduction: z.boolean().optional(),
  dependents: z.number().int().optional(),
  // 緊急連絡先
  emergencyName: z.string().optional(),
  emergencyKana: z.string().optional(),
  emergencyRelation: z.string().optional(),
  emergencyPostal: z.string().optional(),
  emergencyPrefecture: z.string().optional(),
  emergencyCity: z.string().optional(),
  emergencyAddressDetail: z.string().optional(),
  // 書類
  docMyNumber: z.boolean().optional(),
  docIdCard: z.boolean().optional(),
  docIdentityCert: z.boolean().optional(),
  docResidenceCard: z.boolean().optional(),
  docResume: z.boolean().optional(),
  docPledge: z.boolean().optional(),
  docPhoto: z.boolean().optional(),
  docOther: z.boolean().optional(),
  // 銀行口座
  bankAccount: z.any().optional(),
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

  // H-5: TOCTOU対策 - updateManyでcompanyId条件を追加
  const updated = await prisma.guard.updateMany({
    where: { id: req.params.id, companyId },
    data: { ...parsed.data, birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : undefined },
  })
  if (updated.count === 0) { res.status(404).json({ error: '隊員が見つかりません' }); return }
  const guard = await prisma.guard.findFirst({ where: { id: req.params.id, companyId } })
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
// 取引先 API
// ─────────────────────────────────────────────

// H-2: 取引先バリデーションスキーマ
const clientSchema = z.object({
  name: z.string().min(1).max(200),
  nameKana: z.string().max(200).optional(),
  category: z.enum(['GOVERNMENT', 'PRIVATE', 'CONSTRUCTION', 'COMMERCIAL', 'INDIVIDUAL', 'OTHER']).optional(),
  positionTitle: z.string().max(100).optional(),
  contactName: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  fax: z.string().max(20).optional(),
  email: z.string().email().max(200).optional().or(z.literal('')),
  website: z.string().url().max(500).optional().or(z.literal('')),
  industry: z.string().max(100).optional(),
  relationship: z.string().max(100).optional(),
  accountingContactName: z.string().max(100).optional(),
  accountingPhone: z.string().max(20).optional(),
  accountingEmail: z.string().email().max(200).optional().or(z.literal('')),
  notes: z.string().max(2000).optional(),
  postalCode: z.string().max(10).optional(),
  prefecture: z.string().max(20).optional(),
  city: z.string().max(50).optional(),
  addressDetail: z.string().max(200).optional(),
  buildingName: z.string().max(200).optional(),
  addressee: z.string().max(100).optional(),
  billingSameAsCompany: z.boolean().optional(),
  billingPostalCode: z.string().max(10).optional(),
  billingPrefecture: z.string().max(20).optional(),
  billingCity: z.string().max(50).optional(),
  billingAddressDetail: z.string().max(200).optional(),
  billingBuildingName: z.string().max(200).optional(),
  billingAddressee: z.string().max(100).optional(),
  bankName: z.string().max(50).optional(),
  bankBranch: z.string().max(50).optional(),
  bankAccountType: z.enum(['普通', '当座']).optional(),
  bankAccountNumber: z.string().max(20).optional(),
  bankAccountHolder: z.string().max(100).optional(),
  invoiceRegistrationNumber: z.string().max(20).optional(),
  unitPriceDay: z.number().int().min(0).max(9999999).optional().nullable(),
  unitPriceNight: z.number().int().min(0).max(9999999).optional().nullable(),
  unitPriceHolidayDay: z.number().int().min(0).max(9999999).optional().nullable(),
  unitPriceHolidayNight: z.number().int().min(0).max(9999999).optional().nullable(),
  overtimeDayRate: z.number().int().min(0).max(9999999).optional().nullable(),
  overtimeNightRate: z.number().int().min(0).max(9999999).optional().nullable(),
  overtimeHolidayDayRate: z.number().int().min(0).max(9999999).optional().nullable(),
  overtimeHolidayNightRate: z.number().int().min(0).max(9999999).optional().nullable(),
  qualificationAllowance: z.number().int().min(0).max(9999999).optional().nullable(),
  radioAllowance: z.number().int().min(0).max(9999999).optional().nullable(),
  otherAllowance1: z.number().int().min(0).max(9999999).optional().nullable(),
  otherAllowance2: z.number().int().min(0).max(9999999).optional().nullable(),
})

app.get('/api/clients', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { category, search } = req.query
  const where: any = { companyId, isActive: true }
  if (category && category !== 'ALL') where.category = category
  if (search) where.OR = [
    { name: { contains: String(search) } },
    { nameKana: { contains: String(search) } },
    { contactName: { contains: String(search) } },
    { clientCode: { contains: String(search) } },
  ]
  const clients = await prisma.client.findMany({
    where,
    include: { _count: { select: { sites: true } } },
    orderBy: { clientCode: 'asc' },
  })
  res.json(clients)
})

app.get('/api/clients/:id', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const client = await prisma.client.findFirst({
    where: { id: req.params.id, companyId },
    include: {
      sites: { where: { isActive: true }, select: { id: true, name: true, address: true } },
      logs: { orderBy: { createdAt: 'desc' }, take: 20 },
      _count: { select: { sites: true } },
    },
  })
  if (!client) { res.status(404).json({ error: '取引先が見つかりません' }); return }
  res.json(client)
})

app.post('/api/clients', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload

  // H-2: zodバリデーション
  const parsed = clientSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors }); return }

  // 取引先コード自動生成（C00001形式）
  const count = await prisma.client.count({ where: { companyId } })
  const clientCode = `C${String(count + 1).padStart(5, '0')}`

  const { name, nameKana, category, positionTitle, contactName, phone, fax, email, website, industry, relationship,
    accountingContactName, accountingPhone, accountingEmail, notes,
    postalCode, prefecture, city, addressDetail, buildingName, addressee,
    billingSameAsCompany, billingPostalCode, billingPrefecture, billingCity, billingAddressDetail, billingBuildingName, billingAddressee,
    bankName, bankBranch, bankAccountType, bankAccountNumber, bankAccountHolder,
    unitPriceDay, unitPriceNight, unitPriceHolidayDay, unitPriceHolidayNight,
    overtimeDayRate, overtimeNightRate, overtimeHolidayDayRate, overtimeHolidayNightRate,
    qualificationAllowance, radioAllowance, otherAllowance1, otherAllowance2,
    invoiceRegistrationNumber } = parsed.data
  // zodスキーマ外のフィールドはreq.bodyから取得
  const { subContacts, documents, contractDate } = req.body

  const client = await prisma.client.create({
    data: {
      companyId, clientCode, name, nameKana, category: category || 'OTHER',
      positionTitle, contactName, phone, fax, email, website, industry, relationship,
      accountingContactName, accountingPhone, accountingEmail, notes,
      subContacts, postalCode, prefecture, city, addressDetail, buildingName, addressee,
      billingSameAsCompany: billingSameAsCompany !== false,
      billingPostalCode, billingPrefecture, billingCity, billingAddressDetail, billingBuildingName, billingAddressee,
      documents, bankName, bankBranch, bankAccountType, bankAccountNumber, bankAccountHolder,
      contractDate: contractDate ? new Date(contractDate) : null,
      unitPriceDay: unitPriceDay ? Number(unitPriceDay) : null,
      unitPriceNight: unitPriceNight ? Number(unitPriceNight) : null,
      unitPriceHolidayDay: unitPriceHolidayDay ? Number(unitPriceHolidayDay) : null,
      unitPriceHolidayNight: unitPriceHolidayNight ? Number(unitPriceHolidayNight) : null,
      overtimeDayRate: overtimeDayRate ? Number(overtimeDayRate) : null,
      overtimeNightRate: overtimeNightRate ? Number(overtimeNightRate) : null,
      overtimeHolidayDayRate: overtimeHolidayDayRate ? Number(overtimeHolidayDayRate) : null,
      overtimeHolidayNightRate: overtimeHolidayNightRate ? Number(overtimeHolidayNightRate) : null,
      qualificationAllowance: qualificationAllowance ? Number(qualificationAllowance) : null,
      radioAllowance: radioAllowance ? Number(radioAllowance) : null,
      otherAllowance1: otherAllowance1 ? Number(otherAllowance1) : null,
      otherAllowance2: otherAllowance2 ? Number(otherAllowance2) : null,
      invoiceRegistrationNumber,
    },
  })
  res.status(201).json(client)
})

app.put('/api/clients/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.client.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: '取引先が見つかりません' }); return }

  // H-2: zodバリデーション（部分更新なのでpartial）
  const parsed = clientSchema.partial().safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors }); return }

  const { name, nameKana, category, positionTitle, contactName, phone, fax, email, website, industry, relationship,
    accountingContactName, accountingPhone, accountingEmail, notes,
    postalCode, prefecture, city, addressDetail, buildingName, addressee,
    billingSameAsCompany, billingPostalCode, billingPrefecture, billingCity, billingAddressDetail, billingBuildingName, billingAddressee,
    bankName, bankBranch, bankAccountType, bankAccountNumber, bankAccountHolder,
    unitPriceDay, unitPriceNight, unitPriceHolidayDay, unitPriceHolidayNight,
    overtimeDayRate, overtimeNightRate, overtimeHolidayDayRate, overtimeHolidayNightRate,
    qualificationAllowance, radioAllowance, otherAllowance1, otherAllowance2,
    invoiceRegistrationNumber } = parsed.data
  const { subContacts, documents, contractDate, isActive } = req.body

  // H-5: TOCTOU対策 - updateManyでcompanyId条件を追加
  await prisma.client.updateMany({
    where: { id: req.params.id, companyId },
    data: {
      name, nameKana, category, positionTitle, contactName, phone, fax, email, website, industry, relationship,
      accountingContactName, accountingPhone, accountingEmail, notes,
      subContacts, postalCode, prefecture, city, addressDetail, buildingName, addressee,
      billingSameAsCompany: billingSameAsCompany !== false,
      billingPostalCode, billingPrefecture, billingCity, billingAddressDetail, billingBuildingName, billingAddressee,
      documents, bankName, bankBranch, bankAccountType, bankAccountNumber, bankAccountHolder,
      contractDate: contractDate ? new Date(contractDate) : null,
      unitPriceDay: unitPriceDay != null ? Number(unitPriceDay) : null,
      unitPriceNight: unitPriceNight != null ? Number(unitPriceNight) : null,
      unitPriceHolidayDay: unitPriceHolidayDay != null ? Number(unitPriceHolidayDay) : null,
      unitPriceHolidayNight: unitPriceHolidayNight != null ? Number(unitPriceHolidayNight) : null,
      overtimeDayRate: overtimeDayRate != null ? Number(overtimeDayRate) : null,
      overtimeNightRate: overtimeNightRate != null ? Number(overtimeNightRate) : null,
      overtimeHolidayDayRate: overtimeHolidayDayRate != null ? Number(overtimeHolidayDayRate) : null,
      overtimeHolidayNightRate: overtimeHolidayNightRate != null ? Number(overtimeHolidayNightRate) : null,
      qualificationAllowance: qualificationAllowance != null ? Number(qualificationAllowance) : null,
      radioAllowance: radioAllowance != null ? Number(radioAllowance) : null,
      otherAllowance1: otherAllowance1 != null ? Number(otherAllowance1) : null,
      otherAllowance2: otherAllowance2 != null ? Number(otherAllowance2) : null,
      invoiceRegistrationNumber, isActive,
    },
  })
  const client = await prisma.client.findFirst({ where: { id: req.params.id, companyId } })
  res.json(client)
})

app.delete('/api/clients/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.client.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: '取引先が見つかりません' }); return }

  await prisma.client.update({ where: { id: req.params.id }, data: { isActive: false } })
  res.json({ success: true })
})

// 連絡ログ
app.get('/api/clients/:id/logs', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const client = await prisma.client.findFirst({ where: { id: req.params.id, companyId } })
  if (!client) { res.status(404).json({ error: '取引先が見つかりません' }); return }
  const logs = await prisma.clientLog.findMany({ where: { clientId: req.params.id }, orderBy: { createdAt: 'desc' } })
  res.json(logs)
})

app.post('/api/clients/:id/logs', authenticate, async (req, res) => {
  const { companyId, userId } = (req as any).user as JwtPayload
  const client = await prisma.client.findFirst({ where: { id: req.params.id, companyId } })
  if (!client) { res.status(404).json({ error: '取引先が見つかりません' }); return }
  const { logType, content } = req.body
  if (!content) { res.status(400).json({ error: '内容は必須です' }); return }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
  const log = await prisma.clientLog.create({
    data: { clientId: req.params.id, companyId, logType: logType || 'NOTE', content, createdByName: user?.name },
  })
  res.status(201).json(log)
})

// ─────────────────────────────────────────────
// 現場 API
// ─────────────────────────────────────────────

app.get('/api/sites', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const sites = await prisma.site.findMany({
    where: { companyId, isActive: true },
    include: { client: true },
    orderBy: { name: 'asc' },
  })
  res.json(sites)
})

app.post('/api/sites', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { name, address, lat, lng, clientId, clientName, clientPhone, notes,
    siteCode, requiredCount, requiredQualifiedA, requiredQualifiedB,
    assemblyTime, defaultStartTime, defaultEndTime, assemblyPlace, cautions } = req.body
  if (!name || !address) { res.status(400).json({ error: '現場名と住所は必須です' }); return }

  const site = await prisma.site.create({
    data: {
      companyId, name, address, lat, lng, clientId: clientId || null, clientName, clientPhone, notes,
      siteCode: siteCode || null,
      requiredCount: requiredCount != null ? Number(requiredCount) : 1,
      requiredQualifiedA: requiredQualifiedA != null ? Number(requiredQualifiedA) : 0,
      requiredQualifiedB: requiredQualifiedB != null ? Number(requiredQualifiedB) : 0,
      assemblyTime: assemblyTime || null, defaultStartTime: defaultStartTime || null,
      defaultEndTime: defaultEndTime || null, assemblyPlace: assemblyPlace || null, cautions: cautions || null,
    },
    include: { client: true },
  })
  res.status(201).json(site)
})

app.put('/api/sites/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.site.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: '現場が見つかりません' }); return }

  const { name, address, lat, lng, clientId, clientName, clientPhone, notes, isActive,
    siteCode, requiredCount, requiredQualifiedA, requiredQualifiedB,
    assemblyTime, defaultStartTime, defaultEndTime, assemblyPlace, cautions } = req.body
  // H-5: TOCTOU対策 - updateManyでcompanyId条件を追加
  await prisma.site.updateMany({
    where: { id: req.params.id, companyId },
    data: {
      name, address, lat, lng, clientId: clientId || null, clientName, clientPhone, notes, isActive,
      siteCode: siteCode !== undefined ? (siteCode || null) : undefined,
      requiredCount: requiredCount != null ? Number(requiredCount) : undefined,
      requiredQualifiedA: requiredQualifiedA != null ? Number(requiredQualifiedA) : undefined,
      requiredQualifiedB: requiredQualifiedB != null ? Number(requiredQualifiedB) : undefined,
      assemblyTime: assemblyTime !== undefined ? (assemblyTime || null) : undefined,
      defaultStartTime: defaultStartTime !== undefined ? (defaultStartTime || null) : undefined,
      defaultEndTime: defaultEndTime !== undefined ? (defaultEndTime || null) : undefined,
      assemblyPlace: assemblyPlace !== undefined ? (assemblyPlace || null) : undefined,
      cautions: cautions !== undefined ? (cautions || null) : undefined,
    },
  })
  const site = await prisma.site.findFirst({ where: { id: req.params.id, companyId }, include: { client: true } })
  res.json(site)
})

// ─────────────────────────────────────────────
// 契約 API
// ─────────────────────────────────────────────

app.get('/api/contracts', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const contracts = await prisma.contract.findMany({
    where: { companyId },
    include: { site: true },
    orderBy: { createdAt: 'desc' },
  })
  res.json(contracts)
})

app.post('/api/contracts', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId, userId } = (req as any).user as JwtPayload
  const { siteId, contractNumber, clientName, startDate, endDate, unitPrice, guardCount, shiftPattern, notes } = req.body
  if (!siteId || !contractNumber || !clientName || !startDate || !unitPrice) {
    res.status(400).json({ error: '必須項目が不足しています' }); return
  }

  const contract = await prisma.contract.create({
    data: { companyId, siteId, contractNumber, clientName, startDate: new Date(startDate), endDate: endDate ? new Date(endDate) : null, unitPrice: Number(unitPrice), guardCount: Number(guardCount) || 1, shiftPattern, notes, createdById: userId },
    include: { site: true },
  })
  res.status(201).json(contract)
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
  // H-5: TOCTOU対策 - updateManyでcompanyId条件を追加
  await prisma.schedule.updateMany({
    where: { id: req.params.id, companyId },
    data: { guardId, siteId, date: date ? new Date(date) : undefined, startTime, endTime, status, notes },
  })
  const schedule = await prisma.schedule.findFirst({ where: { id: req.params.id, companyId }, include: { guard: true, site: true } })
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
    include: { items: true },
    orderBy: { issueDate: 'desc' },
  })
  res.json(invoices)
})

app.post('/api/invoices', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId, userId } = (req as any).user as JwtPayload
  const { invoiceNumber, clientName, clientEmail, issueDate, dueDate, items, taxRate = 0.1, notes } = req.body
  if (!invoiceNumber || !clientName || !issueDate || !dueDate || !items?.length) {
    res.status(400).json({ error: '必須項目が不足しています' }); return
  }

  const subtotal = items.reduce((sum: number, item: any) => sum + item.quantity * item.unitPrice, 0)
  const taxAmount = Math.floor(subtotal * taxRate)
  const total = subtotal + taxAmount

  const invoice = await prisma.invoice.create({
    data: {
      companyId, invoiceNumber, clientName, clientEmail, issueDate: new Date(issueDate), dueDate: new Date(dueDate),
      subtotal, taxRate, taxAmount, total, notes, createdById: userId,
      items: { create: items.map((item: any) => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, amount: item.quantity * item.unitPrice, contractId: item.contractId, date: item.date ? new Date(item.date) : undefined })) },
    },
    include: { items: true },
  })
  res.status(201).json(invoice)
})

app.put('/api/invoices/:id/send', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.invoice.findFirst({ where: { id: req.params.id, companyId }, include: { company: true } })
  if (!existing) { res.status(404).json({ error: '請求書が見つかりません' }); return }

  // H-5: TOCTOU対策 - updateManyでcompanyId条件を追加
  await prisma.invoice.updateMany({ where: { id: req.params.id, companyId }, data: { status: 'SENT', sentAt: new Date() } })
  const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, companyId } })

  // 請求書メール送信（L-6: HTMLエスケープ適用）
  if (existing.clientEmail) {
    const subject = `【請求書】${existing.invoiceNumber} - ${existing.company.name}`
    const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#1e3a5f;color:white;padding:16px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">請求書のご送付</h2>
  </div>
  <div style="background:white;border:1px solid #ddd;border-top:none;padding:24px;border-radius:0 0 8px 8px">
    <p>${escapeHtml(existing.clientName)} 御中</p>
    <div style="background:#f5f6fa;border-radius:8px;padding:16px;margin:16px 0;font-size:14px">
      <p><strong>請求番号:</strong> ${escapeHtml(existing.invoiceNumber)}</p>
      <p><strong>合計金額:</strong> ¥${existing.total.toLocaleString()}</p>
      <p><strong>支払期限:</strong> ${new Date(existing.dueDate).toLocaleDateString('ja-JP')}</p>
    </div>
    <p style="font-size:13px;color:#666">ご不明な点は担当者までお問い合わせください。</p>
    <p style="font-size:12px;color:#999">${escapeHtml(existing.company.name)} | GuardSync</p>
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
    <p>${escapeHtml(sig.signerName)} 様</p>
    <p>下記の契約書への電子署名をお願いします。</p>
    <div style="background:#f5f6fa;border-radius:8px;padding:16px;margin:16px 0">
      <p style="margin:0;font-weight:bold">${escapeHtml(title)}</p>
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
  logger.info('前日確認通知 開始', { context: 'cron' })
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
        const botId = lw.botId || process.env.LINE_WORKS_BOT_ID || ''
        const botSecret = decrypt(lw.botSecret || '') || process.env.LINE_WORKS_BOT_SECRET || ''
        if (botId && botSecret) {
          token = await getLineWorksToken(botId, botSecret)
          if (token) {
            await prisma.lineWorksSettings.update({
              where: { companyId: schedule.companyId },
              data: { accessToken: token, tokenExpiresAt: new Date(Date.now() + 3600 * 1000) },
            })
          }
        }
      }
      if (token && (schedule.guard as any).lineWorksId) {
        const msg = `【前日確認】${schedule.guard.name} 様\n明日（${dateStr}）の出動をご確認ください。\n\n📍 ${schedule.site.name}\n🕐 ${schedule.startTime}〜${schedule.endTime}\n📌 ${schedule.site.address}`
        await sendLineWorksMessage(lw.botId, (schedule.guard as any).lineWorksId, token, msg)
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
    <p>${escapeHtml(schedule.guard.name)} 様</p>
    <p>明日の出動についてご確認ください。</p>
    <div style="background:#f5f6fa;border-radius:8px;padding:16px;margin:16px 0;font-size:14px">
      <p><strong>日時:</strong> ${escapeHtml(dateStr)} ${escapeHtml(schedule.startTime)}〜${escapeHtml(schedule.endTime)}</p>
      <p><strong>現場:</strong> ${escapeHtml(schedule.site.name)}</p>
      <p><strong>住所:</strong> ${escapeHtml(schedule.site.address)}</p>
    </div>
    <p style="font-size:13px;color:#666">不明点・変更がある場合は管理者にご連絡ください。</p>
    <p style="font-size:12px;color:#999">${escapeHtml(schedule.company.name)} | GuardSync</p>
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
    logger.info(`前日確認: ${schedule.guard.name} → ${schedule.site.name}`, { context: 'cron' })
  }
  logger.info(`前日確認通知 完了: ${schedules.length}件`, { context: 'cron' })
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
  // H-5: TOCTOU対策 - updateManyでcompanyId条件を追加
  await prisma.vehicle.updateMany({
    where: { id: req.params.id, companyId },
    data: { plateNumber, model, year: year ? Number(year) : undefined, isActive },
  })
  const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.id, companyId } })
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
  // LINE Works Bot Secret による HMAC-SHA256 署名検証
  const signature = req.headers['x-works-signature'] as string | undefined
  if (signature) {
    // 署名ヘッダーがある場合は検証（LINE Works からの正規リクエスト）
    const settings = await prisma.lineWorksSettings.findFirst({
      where: { botSecret: { not: null } },
      select: { botSecret: true },
    })
    if (settings?.botSecret) {
      const secret = decrypt(settings.botSecret)
      const body = JSON.stringify(req.body)
      const expected = crypto.createHmac('sha256', secret).update(body).digest('base64')
      if (signature !== expected) {
        logger.warn('LINE Works webhook 署名検証失敗', { context: 'webhook/line-works' })
        res.status(401).json({ error: '署名が無効です' })
        return
      }
    }
  } else {
    // 署名ヘッダーなし → 本番環境では拒否
    if (isProduction) {
      logger.warn('LINE Works webhook 署名ヘッダーなし', { context: 'webhook/line-works' })
      res.status(401).json({ error: '署名が必要です' })
      return
    }
    logger.warn('LINE Works webhook 署名なし（開発環境のためスキップ）', { context: 'webhook/line-works' })
  }
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

  logger.info(`LINE Works自動受付: ${text.slice(0, 50)}`, { context: 'webhook', companyId: lwSettings.companyId })
  res.json({ ok: true })
})

// ─────────────────────────────────────────────
// 設定 API
// ─────────────────────────────────────────────

app.get('/api/settings/line-works', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const settings = await prisma.lineWorksSettings.findUnique({ where: { companyId } })
  if (!settings) { res.status(404).json({ error: 'LINE Works未設定' }); return }
  res.json({ botId: settings.botId, channelId: settings.channelId, hasBotSecret: !!settings.botSecret, tokenExpiresAt: settings.tokenExpiresAt })
})

app.post('/api/settings/line-works', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { botId, botSecret, channelId } = req.body
  if (!botId) { res.status(400).json({ error: 'Bot IDは必須です' }); return }

  // H-7: LINE Works機密情報を暗号化して保存
  const encryptedBotSecret = botSecret ? encrypt(botSecret) : null
  const settings = await prisma.lineWorksSettings.upsert({
    where: { companyId },
    create: { companyId, botId, botSecret: encryptedBotSecret, channelId: channelId || '' },
    update: { botId, botSecret: encryptedBotSecret || undefined, channelId: channelId || undefined, accessToken: null, tokenExpiresAt: null },
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
    // M-3: CSVインジェクション対策適用
    const rows = [
      ['日付', '曜日', '隊員番号', '隊員名', '現場', '開始', '終了', '出勤時刻', '退勤時刻', 'ステータス'].map(escapeCsvCell).join(','),
      ...schedules.map(s => {
        const d = new Date(s.date)
        const weekdays = ['日', '月', '火', '水', '木', '金', '土']
        return [
          escapeCsvCell(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`),
          escapeCsvCell(weekdays[d.getDay()]),
          escapeCsvCell(s.guard.employeeNumber),
          escapeCsvCell(s.guard.name),
          escapeCsvCell(s.site.name),
          escapeCsvCell(s.startTime),
          escapeCsvCell(s.endTime),
          escapeCsvCell(s.attendance?.clockInAt ? new Date(s.attendance.clockInAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : ''),
          escapeCsvCell(s.attendance?.clockOutAt ? new Date(s.attendance.clockOutAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : ''),
          escapeCsvCell(s.status),
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
      <p><strong>報告日:</strong> ${escapeHtml(dateStr)}</p>
      <p><strong>現場:</strong> ${escapeHtml((report as any).site.name)}</p>
      <p><strong>担当隊員:</strong> ${escapeHtml((report as any).guard.name)}</p>
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

  // M-3: CSVインジェクション対策適用
  const rows = [
    ['社員番号', '氏名', 'フリガナ', '生年月日', '性別', '電話番号', 'メール', '雇用形態', '日払い対象', '入社日', '資格'].map(escapeCsvCell).join(','),
    ...guards.map(g => [
      escapeCsvCell(g.employeeNumber), escapeCsvCell(g.name), escapeCsvCell(g.nameKana),
      escapeCsvCell(g.birthDate ? new Date(g.birthDate).toLocaleDateString('ja-JP') : ''),
      escapeCsvCell(g.gender || ''),
      escapeCsvCell(g.phone || ''), escapeCsvCell(g.email || ''),
      escapeCsvCell(g.employmentType),
      escapeCsvCell(g.dailyPayEnabled ? '○' : '×'),
      escapeCsvCell(g.joinedAt ? new Date(g.joinedAt).toLocaleDateString('ja-JP') : ''),
      escapeCsvCell((g.certifications || []).join('・')),
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

  // M-3: CSVインジェクション対策適用
  const rows = [
    ['請求番号', '発行日', '支払期限', '発注元', '品目', '数量', '単価', '金額', '税率', '税額', '合計', 'ステータス'].map(escapeCsvCell).join(','),
    ...invoices.flatMap(inv =>
      inv.items.map(item => [
        escapeCsvCell(inv.invoiceNumber),
        escapeCsvCell(new Date(inv.issueDate).toLocaleDateString('ja-JP')),
        escapeCsvCell(new Date(inv.dueDate).toLocaleDateString('ja-JP')),
        escapeCsvCell(inv.clientName),
        escapeCsvCell(item.description),
        escapeCsvCell(item.quantity),
        escapeCsvCell(item.unitPrice),
        escapeCsvCell(item.amount),
        escapeCsvCell(`${inv.taxRate * 100}%`),
        escapeCsvCell(inv.taxAmount),
        escapeCsvCell(inv.total),
        escapeCsvCell(inv.status),
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

  // M-3: CSVインジェクション対策適用
  const rows = [
    escapeCsvCell(`${y}年${m}月 日払い集計`),
    ['社員番号', '氏名', '申請回数', '申請合計額', '手数料合計', '差引額（月末給与から控除）'].map(escapeCsvCell).join(','),
    ...[...summary.values()].map(s => [
      escapeCsvCell(s.guard.employeeNumber), escapeCsvCell(s.guard.name), escapeCsvCell(s.count),
      escapeCsvCell(s.totalAmount), escapeCsvCell(s.totalFee), escapeCsvCell(s.totalFee),
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

  // M-3: CSVインジェクション対策適用
  const rows = [
    ['社員番号', '氏名', '現場', '日付', '出勤時刻', '退勤時刻', '勤務時間（分）', '休憩時間（分）'].map(escapeCsvCell).join(','),
    ...records.map(a => {
      const s = a.schedule as any
      const clockIn = new Date(a.clockInAt as Date)
      const clockOut = a.clockOutAt ? new Date(a.clockOutAt as Date) : null
      const workMin = clockOut
        ? Math.floor((clockOut.getTime() - clockIn.getTime()) / 60000) - (a.breakMinutes || 0)
        : ''
      return [
        escapeCsvCell(s?.guard?.employeeNumber || ''),
        escapeCsvCell(s?.guard?.name || ''),
        escapeCsvCell(s?.site?.name || ''),
        escapeCsvCell(clockIn.toLocaleDateString('ja-JP')),
        escapeCsvCell(clockIn.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })),
        escapeCsvCell(clockOut ? clockOut.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '未退勤'),
        escapeCsvCell(workMin),
        escapeCsvCell(a.breakMinutes || 0),
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

  logger.info('月末日払い差引処理 開始', { context: 'cron' })

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
    logger.info(`日払い差引: ${req.guard.name} 手数料¥${req.feeAmount}`, { context: 'cron' })
  }

  logger.info(`月末日払い差引処理 完了: ${approvedRequests.length}件`, { context: 'cron' })
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
  if (lw && guard.lineWorksId) {
    const botId = lw.botId || process.env.LINE_WORKS_BOT_ID || ''
    // H-7: 暗号化されたbotSecretを復号して使用
    const botSecret = decrypt(lw.botSecret || '') || process.env.LINE_WORKS_BOT_SECRET || ''
    if (botId && botSecret) {
      const token = await getLineWorksToken(botId, botSecret)
      if (token) lineWorksSent = await sendLineWorksMessage(botId, guard.lineWorksId, token, text)
    }
  }

  res.json({ success: true, emailSent, lineWorksSent })
})

// ─────────────────────────────────────────────
// メール受信 Webhook (SendGrid Inbound Parse)
// ─────────────────────────────────────────────
// SendGrid → Settings > Inbound Parse > POST /api/inbound/email
app.post('/api/inbound/email', express.urlencoded({ extended: true }), async (req, res) => {
  // C-3: Webhookシークレット認証
  if (!verifyWebhookSecret(req, res)) return

  try {
    const from: string = req.body.from || req.body.sender || ''
    const subject: string = req.body.subject || ''
    const text: string = req.body.text || req.body.html || ''
    const rawContent = `差出人: ${from}\n件名: ${subject}\n\n${text}`.slice(0, 2000)

    // C-4: テナント分離 - 環境変数から受信先会社コードを取得
    const companyCode = process.env.INBOUND_COMPANY_CODE
    const targetCompany = companyCode
      ? await prisma.company.findFirst({ where: { code: companyCode, isActive: true } })
      : await prisma.company.findFirst({ where: { isActive: true } }) // フォールバック

    if (!targetCompany) {
      logger.warn('受信先会社が見つかりません。INBOUND_COMPANY_CODEを設定してください。', { context: 'inbound' })
      res.status(200).send('ok')
      return
    }

    await prisma.autoReceipt.create({
      data: {
        companyId: targetCompany.id,
        source: 'EMAIL',
        rawContent,
        status: 'PENDING',
      },
    })
    logger.info('AutoReceipt created', { context: 'inbound/email' })
    res.status(200).send('ok')
  } catch (err) {
    logger.error('error', err, { context: 'inbound/email' })
    res.status(200).send('ok') // SendGridは200以外でリトライするため必ず200を返す
  }
})

// ─────────────────────────────────────────────
// FAX受信 Webhook stub (Google Vision API OCR)
// ─────────────────────────────────────────────
// FAX受信サービス（eFax, RingCentral等）からPDFをPOSTで受け取り、
// Google Vision API でOCRしてAutoReceiptに登録する
app.post('/api/inbound/fax', async (req, res) => {
  // C-3: Webhookシークレット認証
  if (!verifyWebhookSecret(req, res)) return

  try {
    // req.body.pdfBase64 または req.body.imageBase64 を想定
    const rawText: string = req.body.text || req.body.ocrText || 'FAX受信（OCR未処理）'
    const from: string = req.body.from || req.body.callerNumber || '不明'
    const rawContent = `FAX送信元: ${from}\n\n${rawText}`.slice(0, 2000)

    // C-4: テナント分離 - 環境変数から受信先会社コードを取得
    const companyCode = process.env.INBOUND_COMPANY_CODE
    const targetCompany = companyCode
      ? await prisma.company.findFirst({ where: { code: companyCode, isActive: true } })
      : await prisma.company.findFirst({ where: { isActive: true } }) // フォールバック

    if (!targetCompany) {
      logger.warn('受信先会社が見つかりません。INBOUND_COMPANY_CODEを設定してください。', { context: 'inbound' })
      res.status(200).send('ok')
      return
    }

    await prisma.autoReceipt.create({
      data: {
        companyId: targetCompany.id,
        source: 'FAX',
        rawContent,
        status: 'PENDING',
      },
    })
    logger.info('AutoReceipt created from FAX', { context: 'inbound/fax' })
    res.status(200).json({ success: true })
  } catch (err) {
    logger.error('error', err, { context: 'inbound/fax' })
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────
// LINE Works 接続テスト
// ─────────────────────────────────────────────
app.post('/api/settings/line-works/test', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { testUserId } = req.body // テスト送信先のLINE WorksメンバーID
  const settings = await prisma.lineWorksSettings.findUnique({ where: { companyId } })
  if (!settings) { res.status(400).json({ error: 'LINE Works設定が見つかりません' }); return }

  try {
    const botId = settings.botId || process.env.LINE_WORKS_BOT_ID || ''
    // H-7: 暗号化されたbotSecretを復号して使用
    const botSecret = decrypt(settings.botSecret || '') || process.env.LINE_WORKS_BOT_SECRET || ''
    if (!botId || !botSecret) {
      res.status(400).json({ error: 'Bot IDまたはBot Secretが未設定です。設定画面で入力してください。' })
      return
    }
    const token = await getLineWorksToken(botId, botSecret)
    if (!token) { res.status(400).json({ error: 'アクセストークン取得失敗。Bot IDとBot Secretを確認してください。' }); return }

    if (!testUserId) {
      res.status(400).json({ error: 'テスト送信先のメンバーIDを入力してください。' })
      return
    }
    const ok = await sendLineWorksMessage(botId, testUserId, token, '🔔 GuardSync LINE Works 接続テスト成功！')
    if (!ok) { res.status(400).json({ error: 'メッセージ送信失敗。メンバーIDを確認してください。' }); return }
    res.json({ success: true, message: `${testUserId} にテストメッセージを送信しました` })
  } catch (err: any) {
    res.status(400).json({ error: `接続失敗: ${err.message}` })
  }
})

// ─────────────────────────────────────────────
// シフトアンケート API
// ─────────────────────────────────────────────

app.get('/api/shift-surveys', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const surveys = await prisma.shiftSurvey.findMany({
    where: { companyId },
    include: { responses: true },
    orderBy: { createdAt: 'desc' },
  })
  res.json(surveys)
})

app.post('/api/shift-surveys', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { title, shiftTypes, startDate, endDate, answerStartAt, answerEndAt } = req.body
  if (!title || !startDate || !endDate) { res.status(400).json({ error: '必須項目が不足しています' }); return }

  const survey = await prisma.shiftSurvey.create({
    data: {
      companyId, title, shiftTypes: shiftTypes || [],
      startDate: new Date(startDate), endDate: new Date(endDate),
      answerStartAt: new Date(answerStartAt || Date.now()),
      answerEndAt: new Date(answerEndAt || endDate),
    },
  })
  res.status(201).json(survey)
})

app.get('/api/shift-surveys/:id', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const survey = await prisma.shiftSurvey.findFirst({
    where: { id: req.params.id, companyId },
    include: { responses: { include: { guard: { select: { id: true, name: true, nameKana: true } } } } },
  })
  if (!survey) { res.status(404).json({ error: 'アンケートが見つかりません' }); return }
  res.json(survey)
})

app.put('/api/shift-surveys/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.shiftSurvey.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: 'アンケートが見つかりません' }); return }

  const { title, shiftTypes, startDate, endDate, answerStartAt, answerEndAt, isExported } = req.body
  await prisma.shiftSurvey.updateMany({
    where: { id: req.params.id, companyId },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(shiftTypes !== undefined ? { shiftTypes } : {}),
      ...(startDate ? { startDate: new Date(startDate) } : {}),
      ...(endDate ? { endDate: new Date(endDate) } : {}),
      ...(answerStartAt ? { answerStartAt: new Date(answerStartAt) } : {}),
      ...(answerEndAt ? { answerEndAt: new Date(answerEndAt) } : {}),
      ...(isExported !== undefined ? { isExported } : {}),
    },
  })
  const survey = await prisma.shiftSurvey.findFirst({ where: { id: req.params.id, companyId } })
  res.json(survey)
})

// 個別レスポンス保存 or 更新
app.put('/api/shift-surveys/:id/responses/:guardId', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { answers } = req.body
  const survey = await prisma.shiftSurvey.findFirst({ where: { id: req.params.id, companyId } })
  if (!survey) { res.status(404).json({ error: '不明' }); return }
  const guard = await prisma.guard.findFirst({ where: { id: req.params.guardId, companyId } })
  if (!guard) { res.status(404).json({ error: '不明' }); return }
  const response = await prisma.shiftSurveyResponse.upsert({
    where: { surveyId_guardId: { surveyId: req.params.id, guardId: req.params.guardId } },
    create: { surveyId: req.params.id, guardId: req.params.guardId, companyId, answers, submittedAt: new Date() },
    update: { answers, submittedAt: new Date() },
  })
  res.json(response)
})

// アンケート削除
app.delete('/api/shift-surveys/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.shiftSurvey.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: 'アンケートが見つかりません' }); return }
  await prisma.shiftSurveyResponse.deleteMany({ where: { surveyId: req.params.id } })
  await prisma.shiftSurvey.deleteMany({ where: { id: req.params.id, companyId } })
  res.json({ ok: true })
})

// ─────────────────────────────────────────────
// 管制 API
// ─────────────────────────────────────────────

// 管制用: 日付ごとの現場別集計取得
app.get('/api/dispatch/:date', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const date = req.params.date // 'yyyy-MM-dd'

  // その日のスケジュールを現場ごとにグループ化して返す
  const schedules = await prisma.schedule.findMany({
    where: { companyId, date: new Date(date) },
    include: {
      guard: { select: { id: true, name: true, nameKana: true, guardClass: true, certifications: true, lineWorksId: true } },
      site: { select: { id: true, name: true, address: true, clientName: true, requiredCount: true, requiredQualifiedA: true, requiredQualifiedB: true, assemblyTime: true, defaultStartTime: true, defaultEndTime: true, assemblyPlace: true } },
      attendance: true,
    },
    orderBy: { startTime: 'asc' },
  })

  // 現場ごとにグループ化
  const sitesMap = new Map<string, { site: unknown; schedules: unknown[]; confirmedCount: number; sentCount: number }>()
  for (const s of schedules) {
    if (!sitesMap.has(s.siteId)) {
      sitesMap.set(s.siteId, {
        site: s.site,
        schedules: [],
        confirmedCount: 0,
        sentCount: 0,
      })
    }
    const group = sitesMap.get(s.siteId)!
    group.schedules.push(s)
    if (s.status === 'CONFIRMED') group.confirmedCount++
    if (s.sentAt) group.sentCount++
  }

  res.json({
    date,
    groups: Array.from(sitesMap.values()),
    totalSchedules: schedules.length,
  })
})

// 勤怠実績の一括更新（管制画面から）
app.post('/api/dispatch/attendance', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { scheduleId, clockIn, clockOut, earlyOvertimeMin, lateOvertimeMin } = req.body

  const schedule = await prisma.schedule.findFirst({ where: { id: scheduleId, companyId } })
  if (!schedule) { res.status(404).json({ error: '不明' }); return }

  const existing = await prisma.attendance.findFirst({ where: { scheduleId } })
  if (existing) {
    await prisma.attendance.update({
      where: { id: existing.id },
      data: {
        clockInAt: clockIn ? new Date(`${schedule.date.toISOString().split('T')[0]}T${clockIn}`) : undefined,
        clockOutAt: clockOut ? new Date(`${schedule.date.toISOString().split('T')[0]}T${clockOut}`) : undefined,
        earlyOvertimeMin: earlyOvertimeMin ?? existing.earlyOvertimeMin,
        lateOvertimeMin: lateOvertimeMin ?? existing.lateOvertimeMin,
        status: clockOut ? 'COMPLETED' : clockIn ? 'CLOCKED_IN' : existing.status,
      }
    })
  } else {
    await prisma.attendance.create({
      data: {
        companyId,
        guardId: schedule.guardId,
        scheduleId,
        clockInAt: clockIn ? new Date(`${schedule.date.toISOString().split('T')[0]}T${clockIn}`) : undefined,
        clockOutAt: clockOut ? new Date(`${schedule.date.toISOString().split('T')[0]}T${clockOut}`) : undefined,
        earlyOvertimeMin: earlyOvertimeMin ?? 0,
        lateOvertimeMin: lateOvertimeMin ?? 0,
        status: clockOut ? 'COMPLETED' : clockIn ? 'CLOCKED_IN' : 'PENDING',
      }
    })
  }
  res.json({ ok: true })
})

// ─────────────────────────────────────────────
// 給与管理 API
// ─────────────────────────────────────────────

app.get('/api/payroll', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const year = Number(req.query.year) || new Date().getFullYear()
  const month = Number(req.query.month) || new Date().getMonth() + 1

  const payrolls = await prisma.payroll.findMany({
    where: { companyId, year, month },
    include: { guard: { select: { id: true, name: true, nameKana: true, employeeNumber: true } } },
    orderBy: { guard: { employeeNumber: 'asc' } },
  })
  res.json(payrolls)
})

app.post('/api/payroll/:guardId/generate', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { guardId } = req.params
  const year = Number(req.query.year) || new Date().getFullYear()
  const month = Number(req.query.month) || new Date().getMonth() + 1

  const guard = await prisma.guard.findFirst({ where: { id: guardId, companyId } })
  if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

  // 対象月の勤怠を集計
  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 0)
  const attendances = await prisma.attendance.findMany({
    where: {
      companyId, guardId,
      schedule: { date: { gte: startDate, lte: endDate } },
      status: { in: ['COMPLETED', 'CLOCKED_IN'] },
    },
    include: { schedule: true },
  })

  let workDays = 0; let holidayWorkDays = 0; let totalWorkMinutes = 0
  let earlyOtMinutes = 0; let lateOtMinutes = 0; let travelExpense = 0; let otherAmount = 0
  for (const a of attendances) {
    if (a.clockInAt && a.clockOutAt) {
      const mins = Math.round((a.clockOutAt.getTime() - a.clockInAt.getTime()) / 60000) - a.breakMinutes
      totalWorkMinutes += Math.max(0, mins)
    }
    if (a.isHoliday) holidayWorkDays++; else workDays++
    earlyOtMinutes += a.earlyOvertimeMin
    lateOtMinutes += a.lateOvertimeMin
    travelExpense += a.transportAmount
    otherAmount += a.otherAmount
  }

  const basicPay = guard.payType === 'MONTH' ? (guard.monthlyBase || 0)
    : guard.payType === 'HOUR' ? (guard.hourlyBase || 0) * Math.round(totalWorkMinutes / 60)
    : (guard.dayShiftRate || 0) * workDays + (guard.holidayDayRate || 0) * holidayWorkDays

  const posAllowance = guard.positionAllowance || 0
  const qualAllowance = guard.qualificationAllowance || 0
  const leadAllowance = guard.leaderAllowance || 0
  const grossPay = basicPay + posAllowance + qualAllowance + leadAllowance + travelExpense + otherAmount

  const payroll = await prisma.payroll.upsert({
    where: { companyId_guardId_year_month: { companyId, guardId, year, month } },
    create: {
      companyId, guardId, year, month,
      workDays, holidayWorkDays, totalWorkMinutes,
      earlyOtMinutes, lateOtMinutes,
      basicPay, positionAllowance: posAllowance, qualificationAllowance: qualAllowance,
      leaderAllowance: leadAllowance, travelExpense, otherAllowance: otherAmount,
      grossPay, netPay: grossPay,
    },
    update: {
      workDays, holidayWorkDays, totalWorkMinutes,
      earlyOtMinutes, lateOtMinutes,
      basicPay, positionAllowance: posAllowance, qualificationAllowance: qualAllowance,
      leaderAllowance: leadAllowance, travelExpense, otherAllowance: otherAmount,
      grossPay, netPay: grossPay,
    },
  })
  res.json(payroll)
})

app.put('/api/payroll/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.payroll.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: '給与データが見つかりません' }); return }

  const allowedFields = [
    'status', 'workDays', 'holidayWorkDays', 'totalWorkMinutes', 'regularMinutes', 'overtimeMinutes',
    'earlyOtMinutes', 'lateOtMinutes', 'paidLeaveDays', 'absentDays',
    'basicPay', 'overtimePay', 'holidayPay', 'positionAllowance', 'qualificationAllowance',
    'leaderAllowance', 'commuteAllowance', 'travelExpense', 'otherAllowance',
    'healthInsurance', 'pension', 'employmentIns', 'incomeTax', 'residentTax', 'otherDeduction',
    'yearEndAdj', 'notes', 'issueDate', 'sentAt', 'confirmedAt', 'payDate',
  ]
  const data: Record<string, unknown> = {}
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) {
      if (['issueDate', 'sentAt', 'confirmedAt', 'payDate'].includes(key) && req.body[key]) {
        data[key] = new Date(req.body[key] as string)
      } else {
        data[key] = req.body[key]
      }
    }
  }

  // 支給合計・控除合計・差引支給額はサーバー側で計算（クライアントからの値は使用しない）
  const n = (k: string) => Number((data[k] ?? existing[k as keyof typeof existing]) || 0)
  const taxableTotal = n('basicPay') + n('overtimePay') + n('holidayPay') +
    n('positionAllowance') + n('qualificationAllowance') + n('leaderAllowance') + n('otherAllowance')
  const nonTaxableTotal = n('commuteAllowance') + n('travelExpense')
  const grossPay = taxableTotal + nonTaxableTotal
  const totalDeduction = n('healthInsurance') + n('pension') + n('employmentIns') +
    n('incomeTax') + n('residentTax') + n('otherDeduction')
  const netPay = grossPay - totalDeduction + n('yearEndAdj')
  data.taxableTotal = taxableTotal
  data.nonTaxableTotal = nonTaxableTotal
  data.grossPay = grossPay
  data.totalDeduction = totalDeduction
  data.netPay = netPay

  await prisma.payroll.updateMany({ where: { id: req.params.id, companyId }, data })
  const payroll = await prisma.payroll.findFirst({
    where: { id: req.params.id, companyId },
    include: { guard: { select: { id: true, name: true, nameKana: true, employeeNumber: true } } },
  })
  res.json(payroll)
})

// ─────────────────────────────────────────────
// 支払管理 API
// ─────────────────────────────────────────────

app.get('/api/subcontractor-payments', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const year = Number(req.query.year) || new Date().getFullYear()
  const month = Number(req.query.month) || new Date().getMonth() + 1

  const payments = await prisma.subcontractorPayment.findMany({
    where: { companyId, year, month },
    include: { partner: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  })
  res.json(payments)
})

app.post('/api/subcontractor-payments', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { partnerId, partnerName, invoiceNumber, year, month, clientName, siteNames,
    periodStart, periodEnd, amount, taxRate, notes, items } = req.body
  if (!partnerName || !periodStart || !periodEnd || amount == null) {
    res.status(400).json({ error: '必須項目が不足しています' }); return
  }

  const payment = await prisma.subcontractorPayment.create({
    data: {
      companyId, partnerId: partnerId || null, partnerName, invoiceNumber,
      year: year || new Date().getFullYear(), month: month || new Date().getMonth() + 1,
      clientName, siteNames,
      periodStart: new Date(periodStart), periodEnd: new Date(periodEnd),
      amount: Number(amount), taxRate: taxRate != null ? Number(taxRate) : 0.1,
      notes, items,
    },
  })
  res.status(201).json(payment)
})

app.put('/api/subcontractor-payments/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.subcontractorPayment.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: '支払データが見つかりません' }); return }

  const { status, partnerName, invoiceNumber, clientName, siteNames, amount, taxRate, notes, items,
    receivedAt, paidAt } = req.body
  const data: Record<string, unknown> = {}
  if (status !== undefined) data.status = status
  if (partnerName !== undefined) data.partnerName = partnerName
  if (invoiceNumber !== undefined) data.invoiceNumber = invoiceNumber
  if (clientName !== undefined) data.clientName = clientName
  if (siteNames !== undefined) data.siteNames = siteNames
  if (amount !== undefined) data.amount = Number(amount)
  if (taxRate !== undefined) data.taxRate = Number(taxRate)
  if (notes !== undefined) data.notes = notes
  if (items !== undefined) data.items = items
  if (receivedAt !== undefined) data.receivedAt = receivedAt ? new Date(receivedAt as string) : null
  if (paidAt !== undefined) data.paidAt = paidAt ? new Date(paidAt as string) : null

  await prisma.subcontractorPayment.updateMany({ where: { id: req.params.id, companyId }, data })
  const payment = await prisma.subcontractorPayment.findFirst({ where: { id: req.params.id, companyId } })
  res.json(payment)
})

// ─────────────────────────────────────────────
// Stripe Webhook
// ─────────────────────────────────────────────

app.post('/api/stripe/webhook', async (req, res) => {
  if (!stripe) { res.status(503).json({ error: 'Stripe未設定' }); return }
  const sig = req.headers['stripe-signature'] as string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || '')
  } catch (err) {
    logger.error('署名検証失敗', err, { context: 'Stripe Webhook' })
    res.status(400).json({ error: 'Webhook signature verification failed' }); return
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object); break
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object); break
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object); break
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object); break
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object); break
    }
  } catch (err) {
    logger.error('処理エラー', err, { context: 'Stripe Webhook', eventType: event.type })
  }

  res.json({ received: true })
})

async function handleCheckoutCompleted(session: any) {
  const companyId = session.metadata?.companyId
  if (!companyId) return
  await prisma.company.update({
    where: { id: companyId },
    data: {
      subscriptionStatus: 'ACTIVE',
      stripeCustomerId: session.customer as string,
      lastPaymentAt: new Date(),
      isActive: true,
      suspendedAt: null,
    },
  })
  if (session.subscription && stripe) {
    const sub = await stripe.subscriptions.retrieve(session.subscription as string)
    await prisma.billingSubscription.upsert({
      where: { stripeSubscriptionId: sub.id },
      create: {
        companyId, stripeSubscriptionId: sub.id,
        stripePriceId: sub.items.data[0]?.price?.id,
        status: sub.status,
        currentPeriodStart: new Date(sub.current_period_start * 1000),
        currentPeriodEnd: new Date(sub.current_period_end * 1000),
      },
      update: { status: sub.status, currentPeriodEnd: new Date(sub.current_period_end * 1000) },
    })
  }
  await prisma.billingLog.create({ data: {
    companyId, type: 'PAYMENT_SUCCEEDED', amount: session.amount_total || 0,
    stripePaymentIntentId: session.payment_intent as string,
    description: '初回支払い完了（Payment Link経由）', occurredAt: new Date(),
  }})
  companyStatusCache.delete(companyId)
  logger.info('初回決済完了', { context: 'Stripe', companyId })
}

async function handlePaymentSucceeded(invoice: any) {
  const customerId = invoice.customer as string
  const company = await prisma.company.findFirst({ where: { stripeCustomerId: customerId } })
  if (!company) return
  await prisma.company.update({
    where: { id: company.id },
    data: { subscriptionStatus: 'ACTIVE', lastPaymentAt: new Date(), isActive: true, suspendedAt: null },
  })
  await prisma.billingLog.upsert({
    where: { stripeInvoiceId: invoice.id },
    create: {
      companyId: company.id, type: 'PAYMENT_SUCCEEDED', amount: invoice.amount_paid,
      stripeInvoiceId: invoice.id, description: '月次支払い成功', occurredAt: new Date(),
    },
    update: {},
  })
  companyStatusCache.delete(company.id)
}

async function handlePaymentFailed(invoice: any) {
  const customerId = invoice.customer as string
  const company = await prisma.company.findFirst({ where: { stripeCustomerId: customerId } })
  if (!company) return
  await prisma.company.update({ where: { id: company.id }, data: { subscriptionStatus: 'PAST_DUE' } })
  await prisma.billingLog.upsert({
    where: { stripeInvoiceId: invoice.id },
    create: {
      companyId: company.id, type: 'PAYMENT_FAILED', amount: invoice.amount_due,
      stripeInvoiceId: invoice.id, description: '支払い失敗', occurredAt: new Date(),
    },
    update: {},
  })
  companyStatusCache.delete(company.id)
  logger.warn('支払い失敗', { context: 'Stripe', companyId: company.id })
}

async function handleSubscriptionUpdated(sub: any) {
  await prisma.billingSubscription.updateMany({
    where: { stripeSubscriptionId: sub.id },
    data: {
      status: sub.status,
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
    },
  })
}

async function handleSubscriptionDeleted(sub: any) {
  const bSub = await prisma.billingSubscription.findUnique({ where: { stripeSubscriptionId: sub.id } })
  if (!bSub) return
  await prisma.billingSubscription.update({
    where: { stripeSubscriptionId: sub.id },
    data: { status: 'canceled', cancelledAt: new Date() },
  })
  await prisma.company.update({
    where: { id: bSub.companyId },
    data: { subscriptionStatus: 'CANCELLED' },
  })
  await prisma.billingLog.create({ data: {
    companyId: bSub.companyId, type: 'SUBSCRIPTION_CANCELLED',
    amount: 0, description: 'サブスクリプション解約', occurredAt: new Date(),
  }})
  companyStatusCache.delete(bSub.companyId)
}

// ─────────────────────────────────────────────
// スーパー管理者 請求管理 API
// ─────────────────────────────────────────────

app.get('/api/super-admin/billing', authenticate, requireSuperAdmin, async (_req, res) => {
  const companies = await prisma.company.findMany({
    where: { isSuperAdmin: false },
    select: {
      id: true, name: true, code: true, plan: true, planType: true,
      subscriptionStatus: true, billingEmail: true,
      trialEndsAt: true, suspendedAt: true, lastPaymentAt: true,
      stripeCustomerId: true, isActive: true, createdAt: true,
      billingLogs: { orderBy: { occurredAt: 'desc' }, take: 5 },
      _count: { select: { users: true, guards: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json(companies)
})

app.post('/api/super-admin/companies/:id/send-payment-link', authenticate, requireSuperAdmin, async (req, res) => {
  const { id } = req.params
  const { email, planType = 'STARTER' } = req.body
  if (!email) { res.status(400).json({ error: 'メールアドレスは必須です' }); return }

  const company = await prisma.company.findUnique({ where: { id } })
  if (!company) { res.status(404).json({ error: '会社が見つかりません' }); return }

  if (!stripe) { res.status(503).json({ error: 'Stripe未設定です。STRIPE_SECRET_KEY環境変数を確認してください。' }); return }

  const priceId = getPriceIdForPlan(planType)
  if (!priceId) { res.status(400).json({ error: 'Stripe PriceIDが未設定です。環境変数を確認してください。' }); return }

  // Stripe Customer作成（未作成の場合）
  let customerId = company.stripeCustomerId
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: company.name, email,
      metadata: { companyId: company.id, companyCode: company.code },
    })
    customerId = customer.id
    await prisma.company.update({ where: { id }, data: { stripeCustomerId: customerId, billingEmail: email } })
  }

  // Payment Link生成
  const paymentLink = await stripe.paymentLinks.create({
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { companyId: company.id },
    subscription_data: { metadata: { companyId: company.id } },
    restrictions: { completed_sessions: { limit: 1 } },
    after_completion: { type: 'redirect', redirect: { url: `${process.env.APP_URL || 'https://guardsync-production.up.railway.app'}/payment-complete` } },
  })

  // メール送付
  await sendEmail(
    email,
    `【GuardSync】お支払いのご案内 - ${company.name}様`,
    `<p>${escapeHtml(company.name)} ご担当者様</p>
    <p>いつもGuardSyncをご利用いただきありがとうございます。</p>
    <p>下記URLよりお支払いのお手続きをお願いいたします。</p>
    <p><a href="${paymentLink.url}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
    お支払いはこちら
    </a></p>
    <p>ご不明な点がございましたら、サポートまでお問い合わせください。</p>`
  )

  // BillingLog記録
  await prisma.billingLog.create({ data: {
    companyId: id, type: 'PAYMENT_LINK_SENT', amount: 0,
    description: `Payment Link送付: ${email} (プラン: ${planType})`, occurredAt: new Date(),
  }})

  res.json({ paymentLinkUrl: paymentLink.url, message: 'Payment Linkをメールで送付しました' })
})

app.post('/api/super-admin/companies/:id/suspend', authenticate, requireSuperAdmin, async (req, res) => {
  const { id } = req.params
  const { reason } = req.body
  const company = await prisma.company.findUnique({ where: { id } })
  if (!company || company.isSuperAdmin) { res.status(404).json({ error: '会社が見つかりません' }); return }

  await prisma.company.update({
    where: { id },
    data: { subscriptionStatus: 'SUSPENDED', isActive: false, suspendedAt: new Date() },
  })
  await prisma.billingLog.create({ data: {
    companyId: id, type: 'MANUAL_SUSPEND', amount: 0,
    description: reason || '手動停止', occurredAt: new Date(),
  }})
  companyStatusCache.delete(id)
  res.json({ success: true })
})

app.post('/api/super-admin/companies/:id/reactivate', authenticate, requireSuperAdmin, async (req, res) => {
  const { id } = req.params
  const company = await prisma.company.findUnique({ where: { id } })
  if (!company || company.isSuperAdmin) { res.status(404).json({ error: '会社が見つかりません' }); return }

  await prisma.company.update({
    where: { id },
    data: { subscriptionStatus: 'ACTIVE', isActive: true, suspendedAt: null },
  })
  await prisma.billingLog.create({ data: {
    companyId: id, type: 'MANUAL_REACTIVATE', amount: 0,
    description: '手動再開', occurredAt: new Date(),
  }})
  companyStatusCache.delete(id)
  res.json({ success: true })
})

app.patch('/api/super-admin/companies/:id/plan', authenticate, requireSuperAdmin, async (req, res) => {
  const { id } = req.params
  const { planType, plan, trialEndsAt, billingEmail } = req.body
  const company = await prisma.company.findUnique({ where: { id } })
  if (!company || company.isSuperAdmin) { res.status(404).json({ error: '会社が見つかりません' }); return }

  const data: Record<string, unknown> = {}
  if (planType) data.planType = planType
  if (plan) data.plan = plan
  if (trialEndsAt) data.trialEndsAt = new Date(trialEndsAt)
  if (billingEmail) data.billingEmail = billingEmail

  await prisma.company.update({ where: { id }, data })

  // Stripeサブスクリプションのプラン変更
  if (planType) {
    const sub = await prisma.billingSubscription.findFirst({
      where: { companyId: id, status: { in: ['active', 'trialing'] } },
    })
    if (sub?.stripeSubscriptionId && stripe) {
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
      const newPriceId = getPriceIdForPlan(planType)
      if (newPriceId) {
        await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          items: [{ id: stripeSub.items.data[0].id, price: newPriceId }],
          proration_behavior: 'create_prorations',
        })
      }
    }
  }

  await prisma.billingLog.create({ data: {
    companyId: id, type: 'SUBSCRIPTION_UPDATED', amount: 0,
    description: `プラン変更: ${planType || plan || ''}`, occurredAt: new Date(),
  }})
  res.json({ success: true })
})

app.get('/api/super-admin/companies/:id/billing-logs', authenticate, requireSuperAdmin, async (req, res) => {
  const { id } = req.params
  const logs = await prisma.billingLog.findMany({
    where: { companyId: id },
    orderBy: { occurredAt: 'desc' },
    take: 50,
  })
  res.json(logs)
})

// ─────────────────────────────────────────────
// Cron: 支払い状況チェック・自動停止（毎日 AM1:00）
// ─────────────────────────────────────────────

cron.schedule('0 1 * * *', async () => {
  logger.info('支払い状況チェック 開始', { context: 'cron' })
  const now = new Date()
  const gracePeriodDays = 3

  // PAST_DUE で猶予期間超過 → 自動停止
  const pastDueCompanies = await prisma.company.findMany({
    where: { subscriptionStatus: 'PAST_DUE', isActive: true },
    include: {
      billingLogs: {
        where: { type: 'PAYMENT_FAILED' },
        orderBy: { occurredAt: 'desc' },
        take: 1,
      },
    },
  })
  for (const company of pastDueCompanies) {
    const lastFailure = company.billingLogs[0]?.occurredAt
    if (!lastFailure) continue
    const daysSince = Math.floor((now.getTime() - lastFailure.getTime()) / 86400000)
    if (daysSince >= gracePeriodDays) {
      await prisma.company.update({
        where: { id: company.id },
        data: { subscriptionStatus: 'SUSPENDED', isActive: false, suspendedAt: now },
      })
      await prisma.billingLog.create({ data: {
        companyId: company.id, type: 'AUTO_SUSPEND', amount: 0,
        description: `支払い遅延${daysSince}日 - 自動停止`, occurredAt: now,
      }})
      companyStatusCache.delete(company.id)
      logger.info(`自動停止: ${company.name} (遅延${daysSince}日)`, { context: 'cron' })
    }
  }

  // トライアル期限切れ → 自動停止
  const expiredTrials = await prisma.company.findMany({
    where: { subscriptionStatus: 'TRIAL', trialEndsAt: { lte: now }, isActive: true },
  })
  for (const company of expiredTrials) {
    await prisma.company.update({
      where: { id: company.id },
      data: { subscriptionStatus: 'SUSPENDED', isActive: false, suspendedAt: now },
    })
    await prisma.billingLog.create({ data: {
      companyId: company.id, type: 'AUTO_SUSPEND', amount: 0,
      description: 'トライアル期限切れ - 自動停止', occurredAt: now,
    }})
    companyStatusCache.delete(company.id)
    logger.info(`トライアル終了 自動停止: ${company.name}`, { context: 'cron' })
  }

  logger.info('支払い状況チェック 完了', { context: 'cron' })
}, { timezone: 'Asia/Tokyo' })

// ─────────────────────────────────────────────
// Cron: 請求リマインドメール（毎日 AM9:00）
// ─────────────────────────────────────────────

cron.schedule('0 9 * * *', async () => {
  logger.info('請求リマインド 開始', { context: 'cron' })
  const now = new Date()

  // トライアル終了3日前
  const d3 = new Date(now.getTime() + 3 * 86400000)
  const d3Start = new Date(d3.toISOString().split('T')[0])
  const d3End   = new Date(d3Start.getTime() + 86400000)
  const trialEnding = await prisma.company.findMany({
    where: { subscriptionStatus: 'TRIAL', trialEndsAt: { gte: d3Start, lt: d3End } },
  })
  for (const company of trialEnding) {
    if (!company.billingEmail) continue
    await sendEmail(
      company.billingEmail,
      '【GuardSync】トライアル終了のお知らせ（3日前）',
      `<p>${escapeHtml(company.name)} ご担当者様</p><p>トライアル期間が3日後に終了します。継続利用にはお支払い手続きが必要です。担当者よりお支払いリンクをお送りします。</p>`
    )
    await prisma.billingLog.create({ data: {
      companyId: company.id, type: 'REMINDER_SENT', amount: 0,
      description: 'トライアル終了3日前リマインド', occurredAt: now,
    }})
  }

  // PAST_DUE リマインド
  const pastDue = await prisma.company.findMany({
    where: { subscriptionStatus: 'PAST_DUE', isActive: true },
  })
  for (const company of pastDue) {
    if (!company.billingEmail) continue
    await sendEmail(
      company.billingEmail,
      '【GuardSync】お支払いのお願い',
      `<p>${escapeHtml(company.name)} ご担当者様</p><p>お支払いが確認できておりません。このまま未払いが続くと3日後にサービスが停止されます。担当者へお問い合わせいただくか、送付済みのPayment Linkよりお手続きください。</p>`
    )
    await prisma.billingLog.create({ data: {
      companyId: company.id, type: 'REMINDER_SENT', amount: 0,
      description: '支払い遅延リマインド', occurredAt: now,
    }})
  }

  logger.info('請求リマインド 完了', { context: 'cron' })
}, { timezone: 'Asia/Tokyo' })

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
// M-4: グローバルエラーハンドラー
// ─────────────────────────────────────────────
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('未処理エラー', err, { method: req.method, path: req.path })
  if (isProduction) {
    res.status(500).json({ error: '内部サーバーエラーが発生しました' })
  } else {
    res.status(500).json({ error: err.message, stack: err.stack })
  }
})

// 404ハンドラー（APIルート）
app.use('/api/', (req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'エンドポイントが見つかりません' })
})

// ─────────────────────────────────────────────
// 起動
// ─────────────────────────────────────────────

const server = app.listen(PORT, () => {
  logger.info('サーバー起動', { port: PORT, env: process.env.NODE_ENV || 'development' })
})

// グレースフルシャットダウン
const shutdown = async (signal: string) => {
  logger.info(`${signal} 受信、シャットダウン開始`)
  server.close(() => {
    prisma.$disconnect().then(() => {
      logger.info('シャットダウン完了')
      process.exit(0)
    })
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export default app
