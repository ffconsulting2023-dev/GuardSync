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
const PDFDocument = require('pdfkit')
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

function requireModule(module: string, permission: 'view' | 'edit' | 'admin') {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user as JwtPayload
    if (!user) { res.status(401).json({ error: '認証が必要です' }); return }
    if (user.isSuperAdmin) { next(); return }

    // ADMIN ロールは全モジュールに全権限
    if (user.role === 'ADMIN') { next(); return }

    // ModulePermission テーブルを確認
    const perm = await prisma.modulePermission.findUnique({
      where: { userId_module: { userId: user.userId, module } }
    })

    if (!perm) { res.status(403).json({ error: `${module}モジュールへのアクセス権限がありません` }); return }

    if (permission === 'view' && !perm.canView) { res.status(403).json({ error: '閲覧権限がありません' }); return }
    if (permission === 'edit' && !perm.canEdit) { res.status(403).json({ error: '編集権限がありません' }); return }
    if (permission === 'admin' && !perm.canAdmin) { res.status(403).json({ error: '管理権限がありません' }); return }

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
  const { guardId, amount } = req.body
  if (!guardId || !amount) { res.status(400).json({ error: '必須項目が不足しています' }); return }

  const guard = await prisma.guard.findFirst({ where: { id: guardId, companyId, dailyPayEnabled: true } })
  if (!guard) { res.status(400).json({ error: '日払い対象外の隊員です' }); return }

  const requestAmount = Number(amount)
  const feeRate = guard.dailyPayFeeRate ?? 0.03

  // 1回あたりの上限チェック
  if (guard.dailyPayLimit && requestAmount > guard.dailyPayLimit) {
    res.status(400).json({ error: `日払い上限額（¥${guard.dailyPayLimit.toLocaleString()}）を超えています` }); return
  }

  // 月間上限チェック
  if (guard.dailyPayMonthlyLimit) {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const monthlyTotal = await prisma.dailyPayRequest.aggregate({
      where: {
        guardId, companyId,
        status: { in: ['PENDING', 'APPROVED', 'PAID'] },
        requestDate: { gte: monthStart, lte: monthEnd },
      },
      _sum: { amount: true },
    })
    const currentTotal = monthlyTotal._sum.amount ?? 0
    if (currentTotal + requestAmount > guard.dailyPayMonthlyLimit) {
      res.status(400).json({
        error: `月間日払い上限額（¥${guard.dailyPayMonthlyLimit.toLocaleString()}）を超えます。今月の累計: ¥${currentTotal.toLocaleString()}`,
        currentMonthlyTotal: currentTotal,
        limit: guard.dailyPayMonthlyLimit,
      }); return
    }
  }

  const feeAmount = Math.floor(requestAmount * feeRate)
  const netAmount = requestAmount - feeAmount

  const request = await prisma.dailyPayRequest.create({
    data: { companyId, guardId, requestDate: new Date(), amount: requestAmount, feeRate, feeAmount, netAmount },
  })
  res.status(201).json(request)
})

// 日払い月間サマリー（隊員別の限度額・累計・残高）
app.get('/api/daily-pay/summary/:guardId', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const guard = await prisma.guard.findFirst({
    where: { id: req.params.guardId, companyId },
    select: { id: true, name: true, dailyPayEnabled: true, dailyPayLimit: true, dailyPayMonthlyLimit: true, dailyPayFeeRate: true },
  })
  if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  const monthlyRequests = await prisma.dailyPayRequest.findMany({
    where: {
      guardId: req.params.guardId, companyId,
      requestDate: { gte: monthStart, lte: monthEnd },
    },
    orderBy: { requestDate: 'desc' },
  })

  const totalAmount = monthlyRequests.filter(r => ['PENDING', 'APPROVED', 'PAID', 'DEDUCTED'].includes(r.status)).reduce((s, r) => s + r.amount, 0)
  const totalFee = monthlyRequests.filter(r => ['APPROVED', 'PAID', 'DEDUCTED'].includes(r.status)).reduce((s, r) => s + r.feeAmount, 0)
  const remaining = guard.dailyPayMonthlyLimit ? guard.dailyPayMonthlyLimit - totalAmount : null

  res.json({
    guard: { id: guard.id, name: guard.name, dailyPayEnabled: guard.dailyPayEnabled },
    limits: { perRequest: guard.dailyPayLimit, monthly: guard.dailyPayMonthlyLimit, feeRate: guard.dailyPayFeeRate ?? 0.03 },
    monthly: { totalAmount, totalFee, count: monthlyRequests.length, remaining },
    requests: monthlyRequests,
  })
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
// 外国人留学生 就労時間チェック（スライディングウィンドウ方式）
// ─────────────────────────────────────────────

// 任意の連続7日間で就労時間を計算（どの曜日から起算しても週28h以内）
async function checkForeignWorkerHours(guardId: string, companyId: string): Promise<{
  violations: { windowStart: Date; windowEnd: Date; totalHours: number; limitHours: number }[];
  warnings: { windowStart: Date; windowEnd: Date; totalHours: number; limitHours: number }[];
  isVacation: boolean;
  limitHours: number;
}> {
  const guard = await prisma.guard.findUnique({
    where: { id: guardId },
    select: {
      residenceStatus: true, weeklyHoursLimit: true,
      schoolVacationStart: true, schoolVacationEnd: true,
    },
  })
  if (!guard || guard.residenceStatus !== '留学') {
    return { violations: [], warnings: [], isVacation: false, limitHours: 0 }
  }

  const now = new Date()
  const isVacation = guard.schoolVacationStart && guard.schoolVacationEnd
    ? now >= guard.schoolVacationStart && now <= guard.schoolVacationEnd
    : false
  const limitHours = isVacation ? 40 : (guard.weeklyHoursLimit ?? 28)

  // 過去14日分の出退勤データを取得（スライディングウィンドウに必要）
  const fourteenDaysAgo = new Date()
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

  const attendances = await prisma.attendance.findMany({
    where: {
      guardId,
      companyId,
      clockInAt: { gte: fourteenDaysAgo },
      status: { in: ['COMPLETED', 'CLOCKED_IN'] },
    },
    select: { clockInAt: true, clockOutAt: true, breakMinutes: true },
    orderBy: { clockInAt: 'asc' },
  })

  const violations: { windowStart: Date; windowEnd: Date; totalHours: number; limitHours: number }[] = []
  const warnings: typeof violations = []

  // 過去14日間の各日を起点として、7日間のウィンドウをチェック
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const windowStart = new Date(fourteenDaysAgo)
    windowStart.setDate(windowStart.getDate() + dayOffset)
    windowStart.setHours(0, 0, 0, 0)

    const windowEnd = new Date(windowStart)
    windowEnd.setDate(windowEnd.getDate() + 7)

    let totalMinutes = 0
    for (const att of attendances) {
      if (!att.clockInAt || !att.clockOutAt) continue
      if (att.clockInAt >= windowStart && att.clockInAt < windowEnd) {
        const workMinutes = (att.clockOutAt.getTime() - att.clockInAt.getTime()) / 60000 - (att.breakMinutes || 0)
        totalMinutes += Math.max(0, workMinutes)
      }
    }

    const totalHours = totalMinutes / 60
    if (totalHours > limitHours) {
      violations.push({ windowStart, windowEnd, totalHours: Math.round(totalHours * 10) / 10, limitHours })
    } else if (totalHours >= limitHours * 0.9) {
      // 90%超で警告
      warnings.push({ windowStart, windowEnd, totalHours: Math.round(totalHours * 10) / 10, limitHours })
    }
  }

  return { violations, warnings, isVacation, limitHours }
}

// ─────────────────────────────────────────────
// CSVインポートAPI（マスタデータ一括登録）
// ─────────────────────────────────────────────

// 健康保険等級表インポート
app.post('/api/admin/import/health-insurance', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { fiscalYear, data } = req.body as {
    fiscalYear: number
    data: Array<{
      prefecture: string; grade: number; standardMonthly: number
      employeeShare: number; employerShare: number
      nursingEmployee?: number; nursingEmployer?: number
    }>
  }

  let imported = 0
  for (const row of data) {
    await prisma.healthInsGradeTable.upsert({
      where: {
        fiscalYear_prefecture_grade: {
          fiscalYear,
          prefecture: row.prefecture,
          grade: row.grade,
        },
      },
      update: {
        standardMonthly: row.standardMonthly,
        employeeShare: row.employeeShare,
        employerShare: row.employerShare,
        nursingEmployee: row.nursingEmployee ?? 0,
        nursingEmployer: row.nursingEmployer ?? 0,
      },
      create: {
        fiscalYear,
        prefecture: row.prefecture,
        grade: row.grade,
        standardMonthly: row.standardMonthly,
        employeeShare: row.employeeShare,
        employerShare: row.employerShare,
        nursingEmployee: row.nursingEmployee ?? 0,
        nursingEmployer: row.nursingEmployer ?? 0,
      },
    })
    imported++
  }

  res.json({ imported, fiscalYear })
})

// 厚生年金等級表インポート
app.post('/api/admin/import/pension', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { fiscalYear, data } = req.body as {
    fiscalYear: number
    data: Array<{
      grade: number; standardMonthly: number
      employeeShare: number; employerShare: number
    }>
  }

  let imported = 0
  for (const row of data) {
    await prisma.pensionGradeTable.upsert({
      where: {
        fiscalYear_grade: {
          fiscalYear,
          grade: row.grade,
        },
      },
      update: {
        standardMonthly: row.standardMonthly,
        employeeShare: row.employeeShare,
        employerShare: row.employerShare,
      },
      create: {
        fiscalYear,
        grade: row.grade,
        standardMonthly: row.standardMonthly,
        employeeShare: row.employeeShare,
        employerShare: row.employerShare,
      },
    })
    imported++
  }

  res.json({ imported, fiscalYear })
})

// 源泉徴収税額表インポート（同年度の既存データは先に削除）
app.post('/api/admin/import/income-tax', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { fiscalYear, data } = req.body as {
    fiscalYear: number
    data: Array<{
      salaryFrom: number; salaryTo: number
      dep0: number; dep1: number; dep2: number; dep3: number
      dep4: number; dep5: number; dep6: number; dep7: number
    }>
  }

  // 同年度の既存データを削除
  await prisma.incomeTaxTable.deleteMany({ where: { fiscalYear } })

  // 新データを一括作成
  await prisma.incomeTaxTable.createMany({
    data: data.map((row) => ({
      fiscalYear,
      salaryFrom: row.salaryFrom,
      salaryTo: row.salaryTo,
      dep0: row.dep0,
      dep1: row.dep1,
      dep2: row.dep2,
      dep3: row.dep3,
      dep4: row.dep4,
      dep5: row.dep5,
      dep6: row.dep6,
      dep7: row.dep7,
    })),
  })

  res.json({ imported: data.length, fiscalYear })
})

// マスタデータ件数サマリー取得
app.get('/api/admin/master-data/:fiscalYear', authenticate, requireRole('ADMIN'), async (req, res) => {
  const fiscalYear = parseInt(req.params.fiscalYear, 10)

  const [healthCount, healthPrefectures, pensionCount, employmentInsCount, incomeTaxCount] = await Promise.all([
    prisma.healthInsGradeTable.count({ where: { fiscalYear } }),
    prisma.healthInsGradeTable.groupBy({ by: ['prefecture'], where: { fiscalYear } }),
    prisma.pensionGradeTable.count({ where: { fiscalYear } }),
    prisma.employmentInsRate.count({ where: { fiscalYear } }),
    prisma.incomeTaxTable.count({ where: { fiscalYear } }),
  ])

  res.json({
    healthInsurance: { count: healthCount, prefectures: healthPrefectures.map((p) => p.prefecture) },
    pension: { count: pensionCount },
    employmentIns: { count: employmentInsCount },
    incomeTax: { count: incomeTaxCount },
  })
})

// ─────────────────────────────────────────────
// ModulePermission CRUD API
// ─────────────────────────────────────────────

// ユーザーのモジュール権限一覧取得
app.get('/api/admin/permissions/:userId', authenticate, requireRole('ADMIN'), async (req, res) => {
  const permissions = await prisma.modulePermission.findMany({
    where: { userId: req.params.userId },
    orderBy: { module: 'asc' },
  })
  res.json({ permissions })
})

// ユーザーのモジュール権限を一括更新
app.put('/api/admin/permissions/:userId', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { userId } = req.params
  const { permissions } = req.body as {
    permissions: Array<{ module: string; canView: boolean; canEdit: boolean; canAdmin: boolean }>
  }

  const results = []
  for (const perm of permissions) {
    const result = await prisma.modulePermission.upsert({
      where: { userId_module: { userId, module: perm.module } },
      update: {
        canView: perm.canView,
        canEdit: perm.canEdit,
        canAdmin: perm.canAdmin,
      },
      create: {
        userId,
        module: perm.module,
        canView: perm.canView,
        canEdit: perm.canEdit,
        canAdmin: perm.canAdmin,
      },
    })
    results.push(result)
  }

  res.json({ permissions: results })
})

// 外国人就労時間チェック API（個別隊員）
app.get('/api/guards/:id/work-hours-check', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const result = await checkForeignWorkerHours(req.params.id, companyId)
  res.json(result)
})

// 外国人就労時間チェック API（全留学生一括）
app.get('/api/foreign-worker-alerts', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const foreignGuards = await prisma.guard.findMany({
    where: { companyId, residenceStatus: '留学', isActive: true },
    select: { id: true, name: true, residenceExpiry: true, workPermitExpiry: true },
  })

  const alerts = []
  const now = new Date()

  for (const guard of foreignGuards) {
    const hoursCheck = await checkForeignWorkerHours(guard.id, companyId)

    // 就労時間違反
    for (const v of hoursCheck.violations) {
      alerts.push({
        guardId: guard.id, guardName: guard.name, alertType: 'VIOLATION',
        message: `週${v.limitHours}h上限超過: ${v.totalHours}h (${v.windowStart.toISOString().slice(0,10)}〜${v.windowEnd.toISOString().slice(0,10)})`,
        severity: 'critical',
      })
    }
    // 就労時間警告（90%超）
    for (const w of hoursCheck.warnings) {
      alerts.push({
        guardId: guard.id, guardName: guard.name, alertType: 'WARNING',
        message: `週${w.limitHours}h上限間近: ${w.totalHours}h (${w.windowStart.toISOString().slice(0,10)}〜${w.windowEnd.toISOString().slice(0,10)})`,
        severity: 'warning',
      })
    }
    // 在留期限チェック
    if (guard.residenceExpiry) {
      const daysUntilExpiry = Math.ceil((guard.residenceExpiry.getTime() - now.getTime()) / 86400000)
      if (daysUntilExpiry < 0) {
        alerts.push({ guardId: guard.id, guardName: guard.name, alertType: 'EXPIRY', message: `在留期限が切れています（${guard.residenceExpiry.toISOString().slice(0,10)}）`, severity: 'critical' })
      } else if (daysUntilExpiry <= 30) {
        alerts.push({ guardId: guard.id, guardName: guard.name, alertType: 'EXPIRY', message: `在留期限まで残り${daysUntilExpiry}日（${guard.residenceExpiry.toISOString().slice(0,10)}）`, severity: 'warning' })
      }
    }
    // 資格外活動許可期限チェック
    if (guard.workPermitExpiry) {
      const daysUntilExpiry = Math.ceil((guard.workPermitExpiry.getTime() - now.getTime()) / 86400000)
      if (daysUntilExpiry < 0) {
        alerts.push({ guardId: guard.id, guardName: guard.name, alertType: 'EXPIRY', message: `資格外活動許可が切れています（${guard.workPermitExpiry.toISOString().slice(0,10)}）`, severity: 'critical' })
      } else if (daysUntilExpiry <= 30) {
        alerts.push({ guardId: guard.id, guardName: guard.name, alertType: 'EXPIRY', message: `資格外活動許可まで残り${daysUntilExpiry}日`, severity: 'warning' })
      }
    }
  }

  res.json({ alerts, checkedAt: now.toISOString() })
})

// シフト作成時の就労時間事前チェック API
app.post('/api/schedules/check-foreign-worker', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { guardId, date, startTime, endTime } = req.body
  if (!guardId || !date || !startTime || !endTime) {
    res.status(400).json({ error: '必須項目が不足しています' }); return
  }

  const guard = await prisma.guard.findUnique({
    where: { id: guardId },
    select: { residenceStatus: true, weeklyHoursLimit: true, schoolVacationStart: true, schoolVacationEnd: true },
  })
  if (!guard || guard.residenceStatus !== '留学') {
    res.json({ ok: true, isForeignStudent: false }); return
  }

  // 新しいシフトの時間を計算
  const newHours = (new Date(`${date}T${endTime}`).getTime() - new Date(`${date}T${startTime}`).getTime()) / 3600000
  const shiftDate = new Date(date)
  const isVacation = guard.schoolVacationStart && guard.schoolVacationEnd
    ? shiftDate >= guard.schoolVacationStart && shiftDate <= guard.schoolVacationEnd
    : false
  const limitHours = isVacation ? 40 : (guard.weeklyHoursLimit ?? 28)

  // このシフトを含む全ての7日間ウィンドウをチェック
  const worstCase = { totalHours: 0, windowStart: '', windowEnd: '' }
  for (let offset = -6; offset <= 0; offset++) {
    const windowStart = new Date(shiftDate)
    windowStart.setDate(windowStart.getDate() + offset)
    windowStart.setHours(0, 0, 0, 0)
    const windowEnd = new Date(windowStart)
    windowEnd.setDate(windowEnd.getDate() + 7)

    const existingAttendances = await prisma.attendance.findMany({
      where: {
        guardId, companyId,
        clockInAt: { gte: windowStart, lt: windowEnd },
        status: { in: ['COMPLETED', 'CLOCKED_IN'] },
      },
      select: { clockInAt: true, clockOutAt: true, breakMinutes: true },
    })

    const existingSchedules = await prisma.schedule.findMany({
      where: {
        guardId, companyId,
        date: { gte: windowStart, lt: windowEnd },
        status: { in: ['DRAFT', 'ASSIGNED', 'CONFIRMED'] },
      },
      select: { startTime: true, endTime: true },
    })

    let totalMinutes = 0
    for (const att of existingAttendances) {
      if (!att.clockInAt || !att.clockOutAt) continue
      totalMinutes += Math.max(0, (att.clockOutAt.getTime() - att.clockInAt.getTime()) / 60000 - (att.breakMinutes || 0))
    }
    for (const sch of existingSchedules) {
      if (!sch.startTime || !sch.endTime) continue
      totalMinutes += Math.max(0, (new Date(sch.endTime).getTime() - new Date(sch.startTime).getTime()) / 60000)
    }
    totalMinutes += newHours * 60

    const totalHours = totalMinutes / 60
    if (totalHours > worstCase.totalHours) {
      worstCase.totalHours = Math.round(totalHours * 10) / 10
      worstCase.windowStart = windowStart.toISOString().slice(0, 10)
      worstCase.windowEnd = windowEnd.toISOString().slice(0, 10)
    }
  }

  const isViolation = worstCase.totalHours > limitHours
  const isWarning = worstCase.totalHours >= limitHours * 0.9

  res.json({
    ok: !isViolation,
    isForeignStudent: true,
    isVacation,
    limitHours,
    worstCase,
    alert: isViolation
      ? `このシフトを追加すると週${limitHours}h上限を超過します（${worstCase.totalHours}h / ${worstCase.windowStart}〜${worstCase.windowEnd}）`
      : isWarning
        ? `週${limitHours}h上限に近づいています（${worstCase.totalHours}h / ${worstCase.windowStart}〜${worstCase.windowEnd}）`
        : null,
  })
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
// 給与計算ヘルパー：控除・手当自動計算
// ─────────────────────────────────────────────

interface PayrollCalcInput {
  basicPay: number
  overtimePay: number
  holidayPay: number
  positionAllowance: number
  qualificationAllowance: number
  leaderAllowance: number
  commuteAllowance: number
  travelExpense: number
  otherAllowance: number
  earlyOtMinutes: number
  lateOtMinutes: number
  holidayWorkDays: number
  grossPay: number
}

interface PayrollCalcResult {
  healthInsurance: number
  pension: number
  employmentIns: number
  incomeTax: number
  residentTax: number
  overtimePay: number
  holidayPay: number
  dailyPayDeduction: number  // 日払い差引額（当月の承認済み日払い合計）
  dailyPayFee: number        // 日払い手数料合計
  dailyPayCount: number      // 日払い件数
}

async function calculatePayrollDeductions(
  payrollData: PayrollCalcInput,
  guard: Record<string, unknown>,
  companyId: string,
  fiscalYear: number,
  month: number,
): Promise<PayrollCalcResult> {
  const result: PayrollCalcResult = {
    healthInsurance: 0,
    pension: 0,
    employmentIns: 0,
    incomeTax: 0,
    residentTax: 0,
    overtimePay: payrollData.overtimePay,
    holidayPay: payrollData.holidayPay,
    dailyPayDeduction: 0,
    dailyPayFee: 0,
    dailyPayCount: 0,
  }

  // --- 7. 残業手当自動計算 ---
  if (payrollData.earlyOtMinutes > 0 || payrollData.lateOtMinutes > 0) {
    const hourlyBase = Number(guard.hourlyBase || 0)
    const earlyRate = Number(guard.dayOvertimeRate || 0) || (hourlyBase > 0 ? Math.round(hourlyBase * 1.25) : 0)
    const lateRate = Number(guard.nightOvertimeRate || 0) || (hourlyBase > 0 ? Math.round(hourlyBase * 1.5) : 0)
    result.overtimePay = Math.round((payrollData.earlyOtMinutes / 60) * earlyRate)
                       + Math.round((payrollData.lateOtMinutes / 60) * lateRate)
  }

  // --- 8. 休日手当自動計算 ---
  if (payrollData.holidayWorkDays > 0) {
    const dayShiftRate = Number(guard.dayShiftRate || 0)
    const holidayRate = Number(guard.holidayDayRate || 0) || (dayShiftRate > 0 ? Math.round(dayShiftRate * 1.35) : 0)
    result.holidayPay = payrollData.holidayWorkDays * holidayRate
  }

  // --- 1. 健康保険料 ---
  if (guard.healthInsurance && guard.healthInsuranceGrade) {
    const prefecture = String(guard.prefecture || '')
    if (prefecture) {
      try {
        const row = await prisma.healthInsGradeTable.findUnique({
          where: { fiscalYear_prefecture_grade: { fiscalYear, prefecture, grade: Number(guard.healthInsuranceGrade) } },
        })
        if (row) {
          result.healthInsurance = row.employeeShare

          // --- 3. 介護保険（40歳以上）---
          if (guard.nursingInsurance && guard.birthDate) {
            const birth = new Date(guard.birthDate as string)
            const targetDate = new Date(fiscalYear, month - 1, 1) // 対象月初日
            const age = targetDate.getFullYear() - birth.getFullYear()
              - (targetDate < new Date(targetDate.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0)
            if (age >= 40) {
              result.healthInsurance += row.nursingEmployee
            }
          }
        }
      } catch { /* マスタデータなし: 0 を維持 */ }
    }
  }

  // --- 2. 厚生年金 ---
  if (guard.pensionInsurance && guard.pensionInsuranceGrade) {
    try {
      const row = await prisma.pensionGradeTable.findUnique({
        where: { fiscalYear_grade: { fiscalYear, grade: Number(guard.pensionInsuranceGrade) } },
      })
      if (row) {
        result.pension = row.employeeShare
      }
    } catch { /* マスタデータなし: 0 を維持 */ }
  }

  // --- 4. 雇用保険 ---
  if (guard.employmentInsurance) {
    try {
      const row = await prisma.employmentInsRate.findUnique({
        where: { fiscalYear_businessType: { fiscalYear, businessType: '一般' } },
      })
      if (row) {
        result.employmentIns = Math.round(payrollData.grossPay * row.employeeRate)
      }
    } catch { /* マスタデータなし: 0 を維持 */ }
  }

  // --- 5. 所得税（甲欄） ---
  {
    // 課税対象額 = 課税支給項目合計（通勤手当・旅費は除外）
    const taxableTotal = payrollData.basicPay + result.overtimePay + result.holidayPay
      + payrollData.positionAllowance + payrollData.qualificationAllowance
      + payrollData.leaderAllowance + payrollData.otherAllowance
    // 社会保険料控除後の課税対象額
    const socialIns = result.healthInsurance + result.pension + result.employmentIns
    const taxBase = taxableTotal - socialIns
    if (taxBase > 0) {
      try {
        const row = await prisma.incomeTaxTable.findFirst({
          where: { fiscalYear, salaryFrom: { lte: taxBase }, salaryTo: { gt: taxBase } },
        })
        if (row) {
          const deps = Math.min(Number(guard.dependents || 0), 7)
          const depField = `dep${deps}` as keyof typeof row
          result.incomeTax = Number(row[depField] || 0)
        }
      } catch { /* マスタデータなし: 0 を維持 */ }
    }
  }

  // --- 6. 住民税 ---
  {
    const guardId = String(guard.id || '')
    if (guardId) {
      try {
        const row = await prisma.residentTax.findUnique({
          where: { guardId_fiscalYear_month: { guardId, fiscalYear, month } },
        })
        if (row) {
          result.residentTax = row.amount
        }
      } catch { /* マスタデータなし: 0 を維持 */ }
    }
  }

  // --- 日払い差引計算 ---
  // 当月の承認済み（APPROVED/PAID）の日払い申請を集計し、月給から差し引く
  try {
    const guardId = String(guard.id || '')
    if (guardId) {
      const monthStart = new Date(fiscalYear, month - 1, 1)
      const monthEnd = new Date(fiscalYear, month, 0)
      const dailyPayRequests = await prisma.dailyPayRequest.findMany({
        where: {
          guardId,
          companyId,
          status: { in: ['APPROVED', 'PAID'] },
          requestDate: { gte: monthStart, lte: monthEnd },
        },
      })
      if (dailyPayRequests.length > 0) {
        result.dailyPayDeduction = dailyPayRequests.reduce((sum, r) => sum + r.amount, 0)
        result.dailyPayFee = dailyPayRequests.reduce((sum, r) => sum + r.feeAmount, 0)
        result.dailyPayCount = dailyPayRequests.length

        // 差引処理済みフラグを更新
        for (const req of dailyPayRequests) {
          if (!req.deductedAt) {
            await prisma.dailyPayRequest.update({
              where: { id: req.id },
              data: { deductedAt: new Date(), status: 'DEDUCTED' },
            })
          }
        }
      }
    }
  } catch { /* 日払いデータなし: 0 を維持 */ }

  return result
}

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
  const grossPayBase = basicPay + posAllowance + qualAllowance + leadAllowance + travelExpense + otherAmount

  // 控除・手当の自動計算
  const deductions = await calculatePayrollDeductions(
    {
      basicPay, overtimePay: 0, holidayPay: 0,
      positionAllowance: posAllowance, qualificationAllowance: qualAllowance,
      leaderAllowance: leadAllowance, commuteAllowance: 0,
      travelExpense, otherAllowance: otherAmount,
      earlyOtMinutes, lateOtMinutes, holidayWorkDays,
      grossPay: grossPayBase,
    },
    guard as unknown as Record<string, unknown>,
    companyId, year, month,
  )

  const taxableTotal = basicPay + deductions.overtimePay + deductions.holidayPay
    + posAllowance + qualAllowance + leadAllowance + otherAmount
  const nonTaxableTotal = travelExpense
  const grossPay = taxableTotal + nonTaxableTotal
  const totalDeduction = deductions.healthInsurance + deductions.pension + deductions.employmentIns
    + deductions.incomeTax + deductions.residentTax + deductions.dailyPayDeduction
  const netPay = grossPay - totalDeduction

  const payrollFields = {
    workDays, holidayWorkDays, totalWorkMinutes,
    earlyOtMinutes, lateOtMinutes,
    basicPay, overtimePay: deductions.overtimePay, holidayPay: deductions.holidayPay,
    positionAllowance: posAllowance, qualificationAllowance: qualAllowance,
    leaderAllowance: leadAllowance, travelExpense, otherAllowance: otherAmount,
    taxableTotal, nonTaxableTotal, grossPay,
    healthInsurance: deductions.healthInsurance, pension: deductions.pension,
    employmentIns: deductions.employmentIns, incomeTax: deductions.incomeTax,
    residentTax: deductions.residentTax, totalDeduction, netPay,
  }

  const payroll = await prisma.payroll.upsert({
    where: { companyId_guardId_year_month: { companyId, guardId, year, month } },
    create: { companyId, guardId, year, month, ...payrollFields },
    update: payrollFields,
  })
  res.json(payroll)
})

app.put('/api/payroll/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const existing = await prisma.payroll.findFirst({ where: { id: req.params.id, companyId } })
  if (!existing) { res.status(404).json({ error: '給与データが見つかりません' }); return }

  // 隊員情報を取得（控除自動計算に必要）
  const guard = await prisma.guard.findFirst({ where: { id: existing.guardId, companyId } })
  if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

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

  // 控除・手当の自動計算を実行
  const calcInput: PayrollCalcInput = {
    basicPay: n('basicPay'),
    overtimePay: n('overtimePay'),
    holidayPay: n('holidayPay'),
    positionAllowance: n('positionAllowance'),
    qualificationAllowance: n('qualificationAllowance'),
    leaderAllowance: n('leaderAllowance'),
    commuteAllowance: n('commuteAllowance'),
    travelExpense: n('travelExpense'),
    otherAllowance: n('otherAllowance'),
    earlyOtMinutes: n('earlyOtMinutes'),
    lateOtMinutes: n('lateOtMinutes'),
    holidayWorkDays: n('holidayWorkDays'),
    grossPay: 0, // 仮値: 下で再計算
  }
  // grossPay の暫定計算（雇用保険料の算出基盤に使用）
  calcInput.grossPay = calcInput.basicPay + calcInput.overtimePay + calcInput.holidayPay
    + calcInput.positionAllowance + calcInput.qualificationAllowance
    + calcInput.leaderAllowance + calcInput.otherAllowance
    + calcInput.commuteAllowance + calcInput.travelExpense

  const deductions = await calculatePayrollDeductions(
    calcInput,
    guard as unknown as Record<string, unknown>,
    companyId, existing.year, existing.month,
  )

  // 自動計算結果を data に反映（クライアントが明示的に送信した値より自動計算を優先）
  data.overtimePay = deductions.overtimePay
  data.holidayPay = deductions.holidayPay
  data.healthInsurance = deductions.healthInsurance
  data.pension = deductions.pension
  data.employmentIns = deductions.employmentIns
  data.incomeTax = deductions.incomeTax
  data.residentTax = deductions.residentTax

  // 日払い差引を otherDeduction に加算（明細に反映するため notes にも記録）
  if (deductions.dailyPayDeduction > 0) {
    data.otherDeduction = (Number(data.otherDeduction || 0)) + deductions.dailyPayDeduction
    const dailyPayNote = `日払い差引: ¥${deductions.dailyPayDeduction.toLocaleString()}（${deductions.dailyPayCount}件, 手数料¥${deductions.dailyPayFee.toLocaleString()}）`
    data.notes = data.notes ? `${data.notes}\n${dailyPayNote}` : dailyPayNote
  }

  // 最終的な支給合計・控除合計・差引支給額を再計算
  const n2 = (k: string) => Number((data[k] ?? existing[k as keyof typeof existing]) || 0)
  const taxableTotal = n2('basicPay') + n2('overtimePay') + n2('holidayPay') +
    n2('positionAllowance') + n2('qualificationAllowance') + n2('leaderAllowance') + n2('otherAllowance')
  const nonTaxableTotal = n2('commuteAllowance') + n2('travelExpense')
  const grossPay = taxableTotal + nonTaxableTotal
  const totalDeduction = n2('healthInsurance') + n2('pension') + n2('employmentIns') +
    n2('incomeTax') + n2('residentTax') + n2('otherDeduction')
  const netPay = grossPay - totalDeduction + n2('yearEndAdj')
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
// 全銀フォーマットCSV出力 / 給与明細PDF
// ─────────────────────────────────────────────

function padRight(str: string, len: number): string {
  const s = str || ''
  return (s + ' '.repeat(len)).slice(0, len)
}
function padLeft(num: number, len: number): string {
  return String(num).padStart(len, '0')
}
function toKana(str: string): string {
  // 簡易変換: そのまま返す（本格的なカナ変換は将来対応）
  return str.toUpperCase()
}

app.post('/api/payroll/bank-transfer', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { year, month, transferDate, bankCode, branchCode, accountType, accountNumber, depositorName, depositorCode } = req.body
  if (!year || !month || !transferDate || !bankCode || !branchCode || !accountNumber || !depositorName) {
    res.status(400).json({ error: '必須項目が不足しています' }); return
  }

  const payrolls = await prisma.payroll.findMany({
    where: {
      companyId, year: Number(year), month: Number(month),
      status: { in: ['CONFIRMED', 'PAID'] },
    },
    include: { guard: true },
  })

  // ヘッダーレコード（120バイト固定長）
  const mmdd = transferDate.replace(/-/g, '').slice(4, 8)
  const header = '1'                                       // データ区分(1)
    + '21'                                                  // 種別コード(2)
    + '0'                                                   // コード区分(1)
    + padRight(depositorCode || '', 10)                     // 振込依頼人コード(10)
    + padRight(toKana(depositorName), 40)                   // 振込依頼人名(40)
    + mmdd                                                  // 振込日(4)
    + padRight(bankCode, 4)                                 // 仕向銀行番号(4)
    + padRight('', 15)                                      // 仕向銀行名(15)
    + padRight(branchCode, 3)                               // 仕向支店番号(3)
    + padRight('', 15)                                      // 仕向支店名(15)
    + (accountType || '1')                                  // 預金種目(1)
    + padRight(accountNumber, 7)                            // 口座番号(7)
    + padRight('', 17)                                      // ダミー(17)

  // データレコード生成
  const dataRecords: string[] = []
  let totalAmount = 0
  for (const p of payrolls) {
    if (p.netPay <= 0) continue
    const ba = p.guard.bankAccount as Record<string, string> | null
    if (!ba) continue

    const record = '2'                                      // データ区分(1)
      + padRight(ba.bank || '', 4)                          // 被仕向銀行番号(4)
      + padRight('', 15)                                    // 被仕向銀行名(15)
      + padRight(ba.branch || '', 3)                        // 被仕向支店番号(3)
      + padRight('', 15)                                    // 被仕向支店名(15)
      + '0000'                                              // 手形交換所番号(4)
      + (ba.type === '当座' ? '2' : '1')                     // 預金種目(1)
      + padRight(ba.number || '', 7)                        // 口座番号(7)
      + padRight(toKana(ba.holder || p.guard.name || ''), 30) // 受取人名(30)
      + padLeft(p.netPay, 10)                               // 振込金額(10)
      + '0'                                                 // 新規コード(1)
      + padRight(p.guard.employeeNumber || '', 10)          // 顧客コード1(10)
      + padRight('', 10)                                    // 顧客コード2(10)
      + '0'                                                 // 振込区分(1)
      + padRight('', 8)                                     // ダミー(8)

    dataRecords.push(record)
    totalAmount += p.netPay
  }

  // トレーラーレコード
  const trailer = '8'
    + padLeft(dataRecords.length, 6)
    + padLeft(totalAmount, 12)
    + padRight('', 101)

  // エンドレコード
  const endRecord = '9' + padRight('', 119)

  const content = [header, ...dataRecords, trailer, endRecord].join('\r\n')
  const filename = `zengin_${String(year)}${padLeft(Number(month), 2)}.txt`

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`)
  res.send(content)
})

function formatCurrency(amount: number): string {
  return '\\' + amount.toLocaleString('en-US')
}

app.get('/api/payroll/:id/pdf', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const payroll = await prisma.payroll.findFirst({
    where: { id: req.params.id, companyId },
    include: { guard: true },
  })
  if (!payroll) { res.status(404).json({ error: '給与データが見つかりません' }); return }

  const doc = new PDFDocument({ size: 'A4', margin: 50 })
  const buffers: Buffer[] = []
  doc.on('data', (chunk: Buffer) => buffers.push(chunk))

  await new Promise<void>((resolve, reject) => {
    doc.on('end', resolve)
    doc.on('error', reject)

    const g = payroll.guard
    const leftCol = 50
    const rightCol = 320
    let y = 50

    // ヘッダー
    doc.fontSize(20).text('Pay Slip', leftCol, y, { align: 'center' })
    y += 30
    doc.fontSize(12).text(`${payroll.year}/${padLeft(payroll.month, 2)}`, leftCol, y, { align: 'center' })
    y += 30

    // 罫線
    doc.moveTo(leftCol, y).lineTo(545, y).stroke()
    y += 15

    // 隊員情報
    doc.fontSize(10)
    doc.text(`Name: ${g.name || ''}`, leftCol, y)
    doc.text(`Employee No: ${g.employeeNumber || ''}`, rightCol, y)
    y += 20
    doc.text(`Department: -`, leftCol, y)
    y += 20

    doc.moveTo(leftCol, y).lineTo(545, y).stroke()
    y += 15

    // 勤怠
    doc.fontSize(11).text('[ Attendance ]', leftCol, y)
    y += 18
    doc.fontSize(9)
    doc.text(`Work Days: ${payroll.workDays}`, leftCol, y)
    doc.text(`Holiday Work Days: ${payroll.holidayWorkDays}`, rightCol, y)
    y += 15
    const totalHours = Math.floor(payroll.totalWorkMinutes / 60)
    const totalMins = payroll.totalWorkMinutes % 60
    doc.text(`Total Work Hours: ${totalHours}h ${totalMins}m`, leftCol, y)
    const otHours = Math.floor((payroll.earlyOtMinutes + payroll.lateOtMinutes) / 60)
    const otMins = (payroll.earlyOtMinutes + payroll.lateOtMinutes) % 60
    doc.text(`Overtime: ${otHours}h ${otMins}m`, rightCol, y)
    y += 20

    doc.moveTo(leftCol, y).lineTo(545, y).stroke()
    y += 15

    // 支給
    doc.fontSize(11).text('[ Earnings ]', leftCol, y)
    y += 18
    doc.fontSize(9)
    const earnings: [string, number][] = [
      ['Basic Pay', payroll.basicPay],
      ['Overtime Pay', payroll.overtimePay],
      ['Holiday Pay', payroll.holidayPay],
      ['Position Allowance', payroll.positionAllowance],
      ['Qualification Allowance', payroll.qualificationAllowance],
      ['Leader Allowance', payroll.leaderAllowance],
      ['Travel Expense', payroll.travelExpense],
      ['Other Allowance', payroll.otherAllowance],
    ]
    for (const [label, val] of earnings) {
      doc.text(label, leftCol, y)
      doc.text(formatCurrency(val), rightCol, y, { width: 180, align: 'right' })
      y += 14
    }
    doc.fontSize(10).text('Gross Pay', leftCol, y)
    doc.text(formatCurrency(payroll.grossPay), rightCol, y, { width: 180, align: 'right' })
    y += 20

    doc.moveTo(leftCol, y).lineTo(545, y).stroke()
    y += 15

    // 控除
    doc.fontSize(11).text('[ Deductions ]', leftCol, y)
    y += 18
    doc.fontSize(9)
    const deductions: [string, number][] = [
      ['Health Insurance', payroll.healthInsurance],
      ['Pension', payroll.pension],
      ['Employment Insurance', payroll.employmentIns],
      ['Income Tax', payroll.incomeTax],
      ['Resident Tax', payroll.residentTax],
    ]
    for (const [label, val] of deductions) {
      doc.text(label, leftCol, y)
      doc.text(formatCurrency(val), rightCol, y, { width: 180, align: 'right' })
      y += 14
    }
    doc.fontSize(10).text('Total Deduction', leftCol, y)
    doc.text(formatCurrency(payroll.totalDeduction), rightCol, y, { width: 180, align: 'right' })
    y += 25

    // 差引支給額
    doc.moveTo(leftCol, y).lineTo(545, y).lineWidth(2).stroke()
    doc.lineWidth(1)
    y += 15
    doc.fontSize(14).text('Net Pay', leftCol, y)
    doc.text(formatCurrency(payroll.netPay), rightCol, y, { width: 180, align: 'right' })

    doc.end()
  })

  const pdfBuffer = Buffer.concat(buffers)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename=payslip_${payroll.year}${padLeft(payroll.month, 2)}_${payroll.guard.employeeNumber || payroll.guardId}.pdf`)
  res.send(pdfBuffer)
})

app.get('/api/payroll/:id/send-email', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const payroll = await prisma.payroll.findFirst({
    where: { id: req.params.id, companyId },
    include: { guard: true },
  })
  if (!payroll) { res.status(404).json({ error: '給与データが見つかりません' }); return }
  if (!payroll.guard.email) { res.status(400).json({ error: '隊員のメールアドレスが未設定です' }); return }

  // PDF生成
  const doc = new PDFDocument({ size: 'A4', margin: 50 })
  const buffers: Buffer[] = []
  doc.on('data', (chunk: Buffer) => buffers.push(chunk))

  await new Promise<void>((resolve, reject) => {
    doc.on('end', resolve)
    doc.on('error', reject)

    const g = payroll.guard
    const leftCol = 50; const rightCol = 320; let y = 50

    doc.fontSize(20).text('Pay Slip', leftCol, y, { align: 'center' })
    y += 30
    doc.fontSize(12).text(`${payroll.year}/${padLeft(payroll.month, 2)}`, leftCol, y, { align: 'center' })
    y += 30
    doc.moveTo(leftCol, y).lineTo(545, y).stroke(); y += 15
    doc.fontSize(10)
    doc.text(`Name: ${g.name || ''}`, leftCol, y)
    doc.text(`Employee No: ${g.employeeNumber || ''}`, rightCol, y); y += 20
    doc.moveTo(leftCol, y).lineTo(545, y).stroke(); y += 15

    doc.fontSize(11).text('[ Earnings ]', leftCol, y); y += 18
    doc.fontSize(9)
    const earnings: [string, number][] = [
      ['Basic Pay', payroll.basicPay], ['Overtime Pay', payroll.overtimePay],
      ['Holiday Pay', payroll.holidayPay], ['Position Allowance', payroll.positionAllowance],
      ['Qualification Allowance', payroll.qualificationAllowance], ['Leader Allowance', payroll.leaderAllowance],
      ['Travel Expense', payroll.travelExpense], ['Other Allowance', payroll.otherAllowance],
    ]
    for (const [label, val] of earnings) {
      doc.text(label, leftCol, y); doc.text(formatCurrency(val), rightCol, y, { width: 180, align: 'right' }); y += 14
    }
    doc.fontSize(10).text('Gross Pay', leftCol, y)
    doc.text(formatCurrency(payroll.grossPay), rightCol, y, { width: 180, align: 'right' }); y += 20

    doc.moveTo(leftCol, y).lineTo(545, y).stroke(); y += 15
    doc.fontSize(11).text('[ Deductions ]', leftCol, y); y += 18
    doc.fontSize(9)
    const deds: [string, number][] = [
      ['Health Insurance', payroll.healthInsurance], ['Pension', payroll.pension],
      ['Employment Insurance', payroll.employmentIns], ['Income Tax', payroll.incomeTax],
      ['Resident Tax', payroll.residentTax],
    ]
    for (const [label, val] of deds) {
      doc.text(label, leftCol, y); doc.text(formatCurrency(val), rightCol, y, { width: 180, align: 'right' }); y += 14
    }
    doc.fontSize(10).text('Total Deduction', leftCol, y)
    doc.text(formatCurrency(payroll.totalDeduction), rightCol, y, { width: 180, align: 'right' }); y += 25

    doc.moveTo(leftCol, y).lineTo(545, y).lineWidth(2).stroke(); doc.lineWidth(1); y += 15
    doc.fontSize(14).text('Net Pay', leftCol, y)
    doc.text(formatCurrency(payroll.netPay), rightCol, y, { width: 180, align: 'right' })

    doc.end()
  })

  const pdfBuffer = Buffer.concat(buffers)

  // メール送信（添付付き）
  if (!process.env.SMTP_PASS && !process.env.SENDGRID_API_KEY) {
    logger.info(`SMTP未設定 - 給与明細メール送信スキップ`, { context: 'email' })
    res.json({ success: false, message: 'SMTP未設定のため送信スキップ' }); return
  }
  try {
    const transport = createMailTransport()
    await transport.sendMail({
      from: process.env.SMTP_FROM || 'noreply@guardsync.jp',
      to: payroll.guard.email,
      subject: `給与明細書 ${payroll.year}年${payroll.month}月分`,
      html: `<p>${payroll.guard.name} 様</p><p>${payroll.year}年${payroll.month}月分の給与明細書をお送りします。</p><p>添付ファイルをご確認ください。</p>`,
      attachments: [
        {
          filename: `payslip_${payroll.year}${padLeft(payroll.month, 2)}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    })
    res.json({ success: true, message: '給与明細を送信しました' })
  } catch (e) {
    logger.error('給与明細メール送信エラー', e, { context: 'email' })
    res.status(500).json({ error: '送信に失敗しました' })
  }
})

// ─────────────────────────────────────────────
// 有給休暇管理 API
// ─────────────────────────────────────────────

app.get('/api/paid-leave/:guardId', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { guardId } = req.params

  const records = await prisma.paidLeave.findMany({
    where: { companyId, guardId },
    orderBy: { grantDate: 'asc' },
  })
  res.json(records)
})

app.post('/api/paid-leave/grant', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { guardId, grantDays, grantDate: grantDateInput } = req.body

  if (!guardId || grantDays == null || grantDays <= 0) {
    res.status(400).json({ error: 'guardId と grantDays（正の数）は必須です' }); return
  }

  const guard = await prisma.guard.findFirst({ where: { id: guardId, companyId } })
  if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

  const grantDate = grantDateInput ? new Date(grantDateInput) : new Date()
  const expiryDate = new Date(grantDate)
  expiryDate.setFullYear(expiryDate.getFullYear() + 2)

  const record = await prisma.paidLeave.create({
    data: {
      companyId,
      guardId,
      grantDate,
      grantDays: Number(grantDays),
      usedDays: 0,
      expiryDate,
    },
  })
  res.status(201).json(record)
})

app.post('/api/paid-leave/use', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { guardId, useDays } = req.body

  if (!guardId || useDays == null || useDays <= 0) {
    res.status(400).json({ error: 'guardId と useDays（正の数）は必須です' }); return
  }

  const guard = await prisma.guard.findFirst({ where: { id: guardId, companyId } })
  if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

  // 有効期限が近い順に取得（期限切れは除外）
  const now = new Date()
  const records = await prisma.paidLeave.findMany({
    where: {
      companyId, guardId,
      expiryDate: { gt: now },
    },
    orderBy: { expiryDate: 'asc' },
  })

  // 残日数合計チェック
  const totalRemaining = records.reduce((sum, r) => sum + (r.grantDays - r.usedDays), 0)
  if (totalRemaining < Number(useDays)) {
    res.status(400).json({ error: `有給残日数が不足しています（残: ${totalRemaining}日, 申請: ${useDays}日）` }); return
  }

  let remaining = Number(useDays)
  for (const record of records) {
    if (remaining <= 0) break
    const available = record.grantDays - record.usedDays
    if (available <= 0) continue

    const consume = Math.min(available, remaining)
    await prisma.paidLeave.update({
      where: { id: record.id },
      data: { usedDays: record.usedDays + consume },
    })
    remaining -= consume
  }

  res.json({ ok: true, usedDays: Number(useDays) })
})

app.get('/api/paid-leave/alerts', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const now = new Date()

  const guards = await prisma.guard.findMany({
    where: { companyId, isActive: true },
    select: { id: true, name: true },
  })

  const alerts: Array<{
    guardId: string; guardName: string; alertType: string; message: string;
    usedDaysInYear?: number; remainingDays?: number; expiryDate?: Date;
  }> = []

  for (const guard of guards) {
    const records = await prisma.paidLeave.findMany({
      where: { companyId, guardId: guard.id },
      orderBy: { grantDate: 'asc' },
    })

    // 年5日取得義務チェック: 各付与レコードについて付与日から1年以内に5日取得しているか
    for (const record of records) {
      if (record.grantDays < 10) continue // 10日以上付与された場合のみ義務対象
      const oneYearLater = new Date(record.grantDate)
      oneYearLater.setFullYear(oneYearLater.getFullYear() + 1)
      if (now > oneYearLater) continue // 既に1年経過済み
      if (record.usedDays < 5) {
        const daysUntilDeadline = Math.ceil((oneYearLater.getTime() - now.getTime()) / 86400000)
        alerts.push({
          guardId: guard.id,
          guardName: guard.name,
          alertType: daysUntilDeadline <= 30 ? 'critical' : 'warning',
          message: `年5日取得義務未達（取得済: ${record.usedDays}日, 期限まで${daysUntilDeadline}日）`,
          usedDaysInYear: record.usedDays,
        })
      }
    }

    // 期限切れ間近チェック（残日数があり、60日以内に期限切れ）
    for (const record of records) {
      const remainingDays = record.grantDays - record.usedDays
      if (remainingDays <= 0) continue
      const daysUntilExpiry = Math.ceil((record.expiryDate.getTime() - now.getTime()) / 86400000)
      if (daysUntilExpiry > 0 && daysUntilExpiry <= 60) {
        alerts.push({
          guardId: guard.id,
          guardName: guard.name,
          alertType: daysUntilExpiry <= 30 ? 'critical' : 'warning',
          message: `有給休暇の期限切れ間近（残: ${remainingDays}日, 期限まで${daysUntilExpiry}日）`,
          remainingDays,
          expiryDate: record.expiryDate,
        })
      }
    }
  }

  res.json({ alerts })
})

// ─────────────────────────────────────────────
// 36協定・残業上限管理 API
// ─────────────────────────────────────────────

app.get('/api/overtime-alerts', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const guards = await prisma.guard.findMany({
    where: { companyId, isActive: true },
    select: { id: true, name: true },
  })

  const alerts: Array<{
    guardId: string; guardName: string; monthlyHours: number; yearlyHours: number;
    alertType: string; message: string;
  }> = []

  // 今月の開始日・終了日
  const monthStart = new Date(currentYear, currentMonth - 1, 1)
  const monthEnd = new Date(currentYear, currentMonth, 1)

  // 今年の開始日
  const yearStart = new Date(currentYear, 0, 1)

  for (const guard of guards) {
    // 今月の残業時間（Attendance から集計）
    const monthlyAttendances = await prisma.attendance.findMany({
      where: {
        companyId, guardId: guard.id,
        clockInAt: { gte: monthStart, lt: monthEnd },
      },
      select: { earlyOvertimeMin: true, lateOvertimeMin: true },
    })

    const monthlyMinutes = monthlyAttendances.reduce(
      (sum, a) => sum + a.earlyOvertimeMin + a.lateOvertimeMin, 0
    )
    const monthlyHours = Math.round((monthlyMinutes / 60) * 100) / 100

    // 年間の残業時間（1月〜今月）
    const yearlyAttendances = await prisma.attendance.findMany({
      where: {
        companyId, guardId: guard.id,
        clockInAt: { gte: yearStart, lt: monthEnd },
      },
      select: { earlyOvertimeMin: true, lateOvertimeMin: true },
    })

    const yearlyMinutes = yearlyAttendances.reduce(
      (sum, a) => sum + a.earlyOvertimeMin + a.lateOvertimeMin, 0
    )
    const yearlyHours = Math.round((yearlyMinutes / 60) * 100) / 100

    // アラート生成
    if (monthlyHours > 45) {
      alerts.push({
        guardId: guard.id, guardName: guard.name, monthlyHours, yearlyHours,
        alertType: 'critical',
        message: `月間残業${monthlyHours}時間 — 36協定上限（45時間）超過`,
      })
    } else if (monthlyHours > 36) {
      alerts.push({
        guardId: guard.id, guardName: guard.name, monthlyHours, yearlyHours,
        alertType: 'warning',
        message: `月間残業${monthlyHours}時間 — 36協定上限に接近中（警告ライン: 36時間）`,
      })
    }

    if (yearlyHours > 360) {
      alerts.push({
        guardId: guard.id, guardName: guard.name, monthlyHours, yearlyHours,
        alertType: 'critical',
        message: `年間残業${yearlyHours}時間 — 36協定年間上限（360時間）超過`,
      })
    } else if (yearlyHours > 300) {
      alerts.push({
        guardId: guard.id, guardName: guard.name, monthlyHours, yearlyHours,
        alertType: 'warning',
        message: `年間残業${yearlyHours}時間 — 36協定年間上限に接近中（警告ライン: 300時間）`,
      })
    }
  }

  res.json({ alerts })
})

// ─────────────────────────────────────────────
// 源泉徴収票 API（簡易版）
// ─────────────────────────────────────────────

app.get('/api/payroll/withholding-slip/:guardId/:year', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { guardId } = req.params
  const year = Number(req.params.year)

  if (!year || year < 2000 || year > 2100) {
    res.status(400).json({ error: '年度が不正です' }); return
  }

  const guard = await prisma.guard.findFirst({
    where: { id: guardId, companyId },
    select: { id: true, name: true, nameKana: true, address: true, prefecture: true, city: true, addressDetail: true },
  })
  if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })

  const payrolls = await prisma.payroll.findMany({
    where: { companyId, guardId, year },
    orderBy: { month: 'asc' },
  })

  if (payrolls.length === 0) {
    res.status(404).json({ error: `${year}年の給与データがありません` }); return
  }

  // 年間集計
  const paymentAmount = payrolls.reduce((sum, p) => sum + p.grossPay, 0)
  const socialInsurance = payrolls.reduce((sum, p) => sum + p.healthInsurance + p.pension + p.employmentIns, 0)
  const incomeTaxTotal = payrolls.reduce((sum, p) => sum + p.incomeTax, 0)

  // 給与所得控除後の金額（概算）
  let incomeAfterDeduction: number
  if (paymentAmount <= 5_500_000) {
    incomeAfterDeduction = paymentAmount - (paymentAmount * 0.3 + 80_000)
  } else if (paymentAmount <= 6_600_000) {
    incomeAfterDeduction = paymentAmount - (paymentAmount * 0.2 + 440_000)
  } else {
    incomeAfterDeduction = paymentAmount - (paymentAmount * 0.1 + 1_100_000)
  }
  incomeAfterDeduction = Math.max(0, Math.round(incomeAfterDeduction))

  // 所得控除の額の合計（社会保険料 + 基礎控除48万円の概算）
  const totalIncomeDeductions = socialInsurance + 480_000

  // 受給者住所
  const guardAddress = [guard.prefecture, guard.city, guard.addressDetail].filter(Boolean).join('') || guard.address || ''

  // PDF生成（A4横向き）
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 })

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="withholding_${year}_${guardId}.pdf"`)
  doc.pipe(res)

  // フォント設定（日本語対応）
  const fontPath = path.join(__dirname, 'fonts', 'NotoSansJP-Regular.ttf')
  let fontRegistered = false
  try {
    const fs = require('fs')
    if (fs.existsSync(fontPath)) {
      doc.registerFont('JP', fontPath)
      doc.font('JP')
      fontRegistered = true
    }
  } catch { /* フォールバック */ }

  if (!fontRegistered) {
    doc.font('Helvetica')
  }

  const fmt = (n: number) => n.toLocaleString('ja-JP')

  // タイトル
  doc.fontSize(16).text('WITHHOLDING TAX SLIP', 40, 40, { align: 'center' })
  if (fontRegistered) {
    doc.fontSize(14).text('給与所得の源泉徴収票', 40, 62, { align: 'center' })
  }
  doc.moveDown(0.5)

  // 年度
  doc.fontSize(12).text(`${year}`, 40, 90, { align: 'center' })

  // 区切り線
  doc.moveTo(40, 115).lineTo(800, 115).stroke()

  // テーブルレイアウト
  const col1 = 50
  const col2 = 250
  const col3 = 450
  const col4 = 650
  let y = 130

  const labelFontSize = 10
  const valueFontSize = 12

  // 行1: 支払金額 / 給与所得控除後の金額
  doc.fontSize(labelFontSize).text(fontRegistered ? '支払金額' : 'Payment Amount', col1, y)
  doc.fontSize(valueFontSize).text(fmt(paymentAmount), col2, y)
  doc.fontSize(labelFontSize).text(fontRegistered ? '給与所得控除後の金額' : 'Income After Deduction', col3, y)
  doc.fontSize(valueFontSize).text(fmt(incomeAfterDeduction), col4, y)

  y += 35
  // 行2: 所得控除の額の合計 / 源泉徴収税額
  doc.fontSize(labelFontSize).text(fontRegistered ? '所得控除の額の合計額' : 'Total Deductions', col1, y)
  doc.fontSize(valueFontSize).text(fmt(totalIncomeDeductions), col2, y)
  doc.fontSize(labelFontSize).text(fontRegistered ? '源泉徴収税額' : 'Withholding Tax', col3, y)
  doc.fontSize(valueFontSize).text(fmt(incomeTaxTotal), col4, y)

  y += 35
  // 行3: 社会保険料等の金額
  doc.fontSize(labelFontSize).text(fontRegistered ? '社会保険料等の金額' : 'Social Insurance', col1, y)
  doc.fontSize(valueFontSize).text(fmt(socialInsurance), col2, y)

  // 区切り線
  y += 35
  doc.moveTo(40, y).lineTo(800, y).stroke()
  y += 15

  // 受給者情報
  doc.fontSize(labelFontSize).text(fontRegistered ? '受給者 氏名' : 'Recipient Name', col1, y)
  doc.fontSize(valueFontSize).text(guard.name, col2, y)

  y += 25
  doc.fontSize(labelFontSize).text(fontRegistered ? '受給者 住所' : 'Recipient Address', col1, y)
  doc.fontSize(valueFontSize).text(guardAddress || '-', col2, y)

  y += 35
  doc.moveTo(40, y).lineTo(800, y).stroke()
  y += 15

  // 支払者情報
  doc.fontSize(labelFontSize).text(fontRegistered ? '支払者 会社名' : 'Payer Company', col1, y)
  doc.fontSize(valueFontSize).text(company?.name || '-', col2, y)

  doc.end()
})

// ─────────────────────────────────────────────
// 年末調整計算エンジン
// ─────────────────────────────────────────────

/** 給与所得控除額（2026年税制） */
function calcIncomeDeduction(grossPay: number): number {
  if (grossPay <= 1_625_000) return 550_000
  if (grossPay <= 1_800_000) return Math.floor(grossPay * 0.4 - 100_000)
  if (grossPay <= 3_600_000) return Math.floor(grossPay * 0.3 + 80_000)
  if (grossPay <= 6_600_000) return Math.floor(grossPay * 0.2 + 440_000)
  if (grossPay <= 8_500_000) return Math.floor(grossPay * 0.1 + 1_100_000)
  return 1_950_000
}

/** 所得税額（税率テーブル） */
function calcIncomeTaxFromTaxable(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0
  if (taxableIncome <= 1_950_000) return Math.floor(taxableIncome * 0.05)
  if (taxableIncome <= 3_300_000) return Math.floor(taxableIncome * 0.10 - 97_500)
  if (taxableIncome <= 6_950_000) return Math.floor(taxableIncome * 0.20 - 427_500)
  if (taxableIncome <= 9_000_000) return Math.floor(taxableIncome * 0.23 - 636_000)
  if (taxableIncome <= 18_000_000) return Math.floor(taxableIncome * 0.33 - 1_536_000)
  if (taxableIncome <= 40_000_000) return Math.floor(taxableIncome * 0.40 - 2_796_000)
  return Math.floor(taxableIncome * 0.45 - 4_796_000)
}

/** 年末調整の全計算を実行し結果オブジェクトを返す */
async function executeYearEndAdjustment(
  companyId: string,
  guardId: string,
  year: number,
): Promise<{
  totalGrossPay: number
  incomeDeduction: number
  totalDeductions: number
  taxableIncome: number
  annualTax: number
  recoveryTax: number
  totalAnnualTax: number
  alreadyWithheld: number
  adjustment: number
  isRefund: boolean
  totalSocialIns: number
  spouseDeductionAmount: number
  dependentsDeductionAmount: number
  basicDeduction: number
  guardName: string
  guardAddress: string
  companyName: string
}> {
  // 隊員情報
  const guard = await prisma.guard.findFirst({ where: { id: guardId, companyId } })
  if (!guard) throw new Error('隊員が見つかりません')

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })

  // 全月 Payroll
  const payrolls = await prisma.payroll.findMany({
    where: { companyId, guardId, year },
    orderBy: { month: 'asc' },
  })

  // 全賞与（該当年の paymentDate が対象年内のもの）
  const startDate = new Date(year, 0, 1)
  const endDate = new Date(year, 11, 31, 23, 59, 59)
  const bonuses = await prisma.bonusPayroll.findMany({
    where: { companyId, guardId, paymentDate: { gte: startDate, lte: endDate } },
  })

  // 年間集計
  const payrollGross = payrolls.reduce((s, p) => s + p.grossPay, 0)
  const bonusGross = bonuses.reduce((s, b) => s + b.grossAmount, 0)
  const totalGrossPay = payrollGross + bonusGross

  const payrollSocialIns = payrolls.reduce(
    (s, p) => s + p.healthInsurance + p.pension + p.employmentIns, 0,
  )
  const bonusSocialIns = bonuses.reduce(
    (s, b) => s + b.healthInsurance + b.pension + b.employmentIns, 0,
  )
  const totalSocialIns = payrollSocialIns + bonusSocialIns

  const payrollIncomeTax = payrolls.reduce((s, p) => s + p.incomeTax, 0)
  const bonusIncomeTax = bonuses.reduce((s, b) => s + b.incomeTax, 0)
  const alreadyWithheld = payrollIncomeTax + bonusIncomeTax

  // 給与所得控除
  const incomeDeduction = calcIncomeDeduction(totalGrossPay)
  const salaryIncome = Math.max(0, totalGrossPay - incomeDeduction)

  // 所得控除
  const basicDeduction = salaryIncome <= 24_000_000 ? 480_000 : 0
  const socialInsDeduction = totalSocialIns
  const spouseDeductionAmount = guard.spouseDeduction ? 380_000 : 0
  const dependentsCount = Number(guard.dependents || 0)
  const dependentsDeductionAmount = dependentsCount * 380_000
  const totalDeductions = basicDeduction + socialInsDeduction + spouseDeductionAmount + dependentsDeductionAmount

  // 課税所得金額（1,000円未満切り捨て）
  const taxableIncome = Math.max(0, Math.floor((salaryIncome - totalDeductions) / 1000) * 1000)

  // 年税額
  const annualTax = calcIncomeTaxFromTaxable(taxableIncome)
  const recoveryTax = Math.floor(annualTax * 0.021) // 復興特別所得税
  const totalAnnualTax = Math.floor((annualTax + recoveryTax) / 100) * 100 // 100円未満切り捨て

  // 過不足額
  const adjustment = totalAnnualTax - alreadyWithheld
  const isRefund = adjustment < 0

  // 受給者住所
  const guardAddress = [guard.prefecture, guard.city, guard.addressDetail].filter(Boolean).join('')
    || guard.address || ''

  return {
    totalGrossPay,
    incomeDeduction,
    totalDeductions,
    taxableIncome,
    annualTax,
    recoveryTax,
    totalAnnualTax,
    alreadyWithheld,
    adjustment,
    isRefund,
    totalSocialIns,
    spouseDeductionAmount,
    dependentsDeductionAmount,
    basicDeduction,
    guardName: guard.name,
    guardAddress,
    companyName: company?.name || '',
  }
}

// POST: 年末調整を計算し12月分 Payroll に保存
app.post('/api/year-end-adjustment/:guardId/:year', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = (req as unknown as { user: JwtPayload }).user
    const { guardId } = req.params
    const year = Number(req.params.year)

    if (!year || year < 2000 || year > 2100) {
      res.status(400).json({ error: '年度が不正です' }); return
    }

    const result = await executeYearEndAdjustment(companyId, guardId, year)

    // 12月分の Payroll を更新（yearEndAdj フィールド）
    const decPayroll = await prisma.payroll.findFirst({
      where: { companyId, guardId, year, month: 12 },
    })

    if (decPayroll) {
      // yearEndAdj: 還付ならプラス（手取り増）、追加徴収ならマイナス（手取り減）
      const yearEndAdjValue = result.adjustment * -1
      await prisma.payroll.update({
        where: { id: decPayroll.id },
        data: {
          yearEndAdj: yearEndAdjValue,
          netPay: decPayroll.grossPay - decPayroll.totalDeduction + yearEndAdjValue,
        },
      })
    }

    res.json(result)
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err))
    logger.error('年末調整計算エラー', { error: e.message })
    res.status(e.message === '隊員が見つかりません' ? 404 : 500).json({ error: e.message })
  }
})

// GET: 年末調整の計算結果を返却（保存なし）
app.get('/api/year-end-adjustment/:guardId/:year', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = (req as unknown as { user: JwtPayload }).user
    const { guardId } = req.params
    const year = Number(req.params.year)

    if (!year || year < 2000 || year > 2100) {
      res.status(400).json({ error: '年度が不正です' }); return
    }

    const result = await executeYearEndAdjustment(companyId, guardId, year)
    res.json(result)
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err))
    logger.error('年末調整取得エラー', { error: e.message })
    res.status(e.message === '隊員が見つかりません' ? 404 : 500).json({ error: e.message })
  }
})

// POST: 全隊員の年末調整を一括実行
app.post('/api/year-end-adjustment/batch/:year', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = (req as unknown as { user: JwtPayload }).user
    const year = Number(req.params.year)

    if (!year || year < 2000 || year > 2100) {
      res.status(400).json({ error: '年度が不正です' }); return
    }

    // 該当年の給与データがある全隊員を取得
    const payrollGuards = await prisma.payroll.findMany({
      where: { companyId, year },
      select: { guardId: true },
      distinct: ['guardId'],
    })

    const results: Array<{ guardId: string; guardName: string; adjustment: number; isRefund: boolean; error?: string }> = []

    for (const pg of payrollGuards) {
      try {
        const result = await executeYearEndAdjustment(companyId, pg.guardId, year)

        // 12月分の Payroll を更新
        const decPayroll = await prisma.payroll.findFirst({
          where: { companyId, guardId: pg.guardId, year, month: 12 },
        })

        if (decPayroll) {
          const yearEndAdjValue = result.adjustment * -1
          await prisma.payroll.update({
            where: { id: decPayroll.id },
            data: {
              yearEndAdj: yearEndAdjValue,
              netPay: decPayroll.grossPay - decPayroll.totalDeduction + yearEndAdjValue,
            },
          })
        }

        results.push({
          guardId: pg.guardId,
          guardName: result.guardName,
          adjustment: result.adjustment,
          isRefund: result.isRefund,
        })
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err))
        results.push({
          guardId: pg.guardId,
          guardName: '',
          adjustment: 0,
          isRefund: false,
          error: e.message,
        })
      }
    }

    res.json({
      year,
      totalProcessed: results.length,
      refundCount: results.filter(r => r.isRefund && !r.error).length,
      additionalCount: results.filter(r => !r.isRefund && r.adjustment > 0 && !r.error).length,
      errorCount: results.filter(r => r.error).length,
      results,
    })
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err))
    logger.error('年末調整一括処理エラー', { error: e.message })
    res.status(500).json({ error: e.message })
  }
})

// ─────────────────────────────────────────────
// 源泉徴収票 完全版 API
// ─────────────────────────────────────────────

app.get('/api/payroll/withholding-slip-full/:guardId/:year', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = (req as unknown as { user: JwtPayload }).user
    const { guardId } = req.params
    const year = Number(req.params.year)

    if (!year || year < 2000 || year > 2100) {
      res.status(400).json({ error: '年度が不正です' }); return
    }

    // 年末調整計算を再利用
    const result = await executeYearEndAdjustment(companyId, guardId, year)

    // 会社情報を取得
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    })

    // 令和変換
    const reiwaYear = year - 2018
    const reiwaLabel = `令和${reiwaYear}年分`

    // 給与所得控除後の金額
    const incomeAfterDeduction = Math.max(0, result.totalGrossPay - result.incomeDeduction)

    // PDF生成（A4横向き）
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="withholding_full_${year}_${guardId}.pdf"`)
    doc.pipe(res)

    // フォント設定（日本語対応）
    const fontPath = path.join(__dirname, 'fonts', 'NotoSansJP-Regular.ttf')
    let fontRegistered = false
    try {
      const fs = require('fs')
      if (fs.existsSync(fontPath)) {
        doc.registerFont('JP', fontPath)
        doc.font('JP')
        fontRegistered = true
      }
    } catch { /* フォールバック */ }

    if (!fontRegistered) {
      doc.font('Helvetica')
    }

    const fmt = (n: number) => n.toLocaleString('ja-JP')
    const marginL = 30
    const marginR = 30
    const contentW = 842 - marginL - marginR // A4横幅

    // タイトル
    const titleText = fontRegistered ? `${reiwaLabel} 給与所得の源泉徴収票` : `${year} WITHHOLDING TAX SLIP`
    doc.fontSize(14).text(titleText, marginL, 30, { align: 'center', width: contentW })

    // 外枠
    const tableTop = 60
    const tableLeft = marginL
    const tableWidth = contentW
    const rowH = 30

    doc.lineWidth(1.5)
    doc.rect(tableLeft, tableTop, tableWidth, rowH * 9).stroke()

    // ユーティリティ: セル描画
    const drawCell = (x: number, cy: number, w: number, h: number, label: string, value: string, labelSize = 7, valueSize = 10) => {
      doc.lineWidth(0.5)
      doc.rect(x, cy, w, h).stroke()
      if (label) {
        doc.fontSize(labelSize).text(label, x + 3, cy + 2, { width: w - 6 })
      }
      if (value) {
        doc.fontSize(valueSize).text(value, x + 3, cy + h / 2 + (label ? 2 : -4), { width: w - 6, align: 'right' })
      }
    }

    // 行1: 種別 / 支払金額 / 給与所得控除後の金額 / 所得控除の額の合計額 / 源泉徴収税額
    const colW5 = tableWidth / 5
    let cy = tableTop

    const lbl = fontRegistered
    drawCell(tableLeft, cy, colW5, rowH,
      lbl ? '種別' : 'Type',
      lbl ? '給与・賞与' : 'Salary/Bonus', 7, 9)
    drawCell(tableLeft + colW5, cy, colW5, rowH,
      lbl ? '支払金額' : 'Payment',
      fmt(result.totalGrossPay))
    drawCell(tableLeft + colW5 * 2, cy, colW5, rowH,
      lbl ? '給与所得控除後の金額' : 'After Deduction',
      fmt(incomeAfterDeduction))
    drawCell(tableLeft + colW5 * 3, cy, colW5, rowH,
      lbl ? '所得控除の額の合計額' : 'Total Deductions',
      fmt(result.totalDeductions))
    drawCell(tableLeft + colW5 * 4, cy, colW5, rowH,
      lbl ? '源泉徴収税額' : 'Tax Amount',
      fmt(result.totalAnnualTax))

    // 行2: 社会保険料 / 配偶者控除 / 扶養控除 / 基礎控除
    cy += rowH
    const colW4 = tableWidth / 4
    drawCell(tableLeft, cy, colW4, rowH,
      lbl ? '社会保険料等の金額' : 'Social Insurance',
      fmt(result.totalSocialIns))
    drawCell(tableLeft + colW4, cy, colW4, rowH,
      lbl ? '配偶者控除額' : 'Spouse Deduction',
      fmt(result.spouseDeductionAmount))
    drawCell(tableLeft + colW4 * 2, cy, colW4, rowH,
      lbl ? '扶養控除額' : 'Dependents Deduction',
      fmt(result.dependentsDeductionAmount))
    drawCell(tableLeft + colW4 * 3, cy, colW4, rowH,
      lbl ? '基礎控除額' : 'Basic Deduction',
      fmt(result.basicDeduction))

    // 行3: 課税所得金額 / 年税額 / 復興特別所得税 / 既徴収税額
    cy += rowH
    drawCell(tableLeft, cy, colW4, rowH,
      lbl ? '課税所得金額' : 'Taxable Income',
      fmt(result.taxableIncome))
    drawCell(tableLeft + colW4, cy, colW4, rowH,
      lbl ? '算出年税額' : 'Annual Tax',
      fmt(result.annualTax))
    drawCell(tableLeft + colW4 * 2, cy, colW4, rowH,
      lbl ? '復興特別所得税' : 'Recovery Tax',
      fmt(result.recoveryTax))
    drawCell(tableLeft + colW4 * 3, cy, colW4, rowH,
      lbl ? '既徴収税額' : 'Already Withheld',
      fmt(result.alreadyWithheld))

    // 行4: 過不足額
    cy += rowH
    const adjLabel = result.isRefund
      ? (lbl ? '差引超過額（還付）' : 'Refund Amount')
      : (lbl ? '差引不足額（追加徴収）' : 'Additional Tax')
    drawCell(tableLeft, cy, tableWidth / 2, rowH, adjLabel, fmt(Math.abs(result.adjustment)))
    drawCell(tableLeft + tableWidth / 2, cy, tableWidth / 2, rowH, '', '')

    // 区切り
    cy += rowH + 10
    doc.lineWidth(1).moveTo(tableLeft, cy).lineTo(tableLeft + tableWidth, cy).stroke()
    cy += 10

    // 受給者情報
    const col2W = tableWidth / 2
    drawCell(tableLeft, cy, col2W, rowH * 2,
      lbl ? '受給者 住所' : 'Recipient Address',
      result.guardAddress || '-', 8, 9)
    drawCell(tableLeft + col2W, cy, col2W, rowH * 2,
      lbl ? '受給者 氏名（フリガナ）' : 'Recipient Name',
      result.guardName, 8, 11)

    // 支払者情報
    cy += rowH * 2
    drawCell(tableLeft, cy, col2W, rowH * 2,
      lbl ? '支払者 住所' : 'Payer Address',
      '-', 8, 9)
    drawCell(tableLeft + col2W, cy, col2W, rowH * 2,
      lbl ? '支払者 名称' : 'Payer Name',
      company?.name || '-', 8, 11)

    // 備考欄
    cy += rowH * 2
    drawCell(tableLeft, cy, tableWidth, rowH,
      lbl ? '摘要' : 'Remarks',
      lbl ? '年末調整済' : 'Year-end adjusted', 8, 9)

    doc.end()
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err))
    logger.error('源泉徴収票（完全版）生成エラー', { error: e.message })
    if (!res.headersSent) {
      res.status(e.message === '隊員が見つかりません' ? 404 : 500).json({ error: e.message })
    }
  }
})

// ─────────────────────────────────────────────
// 賞与計算エンジン API
// ─────────────────────────────────────────────

// 賞与に対する源泉徴収税額の算出率を返す（前月課税給与額ベース）
function getBonusTaxRate(prevMonthTaxable: number): number {
  // 千円単位の閾値で判定
  if (prevMonthTaxable < 68_000) return 0
  if (prevMonthTaxable < 79_000) return 0.02042
  if (prevMonthTaxable < 252_000) return 0.04084
  if (prevMonthTaxable < 300_000) return 0.06126
  if (prevMonthTaxable < 334_000) return 0.08168
  if (prevMonthTaxable < 363_000) return 0.10210
  if (prevMonthTaxable < 395_000) return 0.12252
  if (prevMonthTaxable < 427_000) return 0.14294
  if (prevMonthTaxable < 550_000) return 0.16336
  if (prevMonthTaxable < 700_000) return 0.18378
  if (prevMonthTaxable < 850_000) return 0.20420
  return 0.22462
}

app.post('/api/bonus-payroll/generate', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = (req as any).user as JwtPayload
    const { guardId, paymentDate, bonusType, grossAmount } = req.body

    if (!guardId || !paymentDate || !bonusType || grossAmount == null) {
      res.status(400).json({ error: 'guardId, paymentDate, bonusType, grossAmount は必須です' }); return
    }
    if (!['SUMMER', 'WINTER', 'OTHER'].includes(bonusType)) {
      res.status(400).json({ error: 'bonusType は SUMMER/WINTER/OTHER のいずれかです' }); return
    }

    const guard = await prisma.guard.findFirst({ where: { id: guardId, companyId } })
    if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

    const payDate = new Date(paymentDate)
    const fiscalYear = payDate.getFullYear()

    // --- 賞与の社保料計算 ---
    let healthIns = 0
    let pensionIns = 0
    let nursingIns = 0
    let employmentIns = 0

    // 健康保険料（賞与額 × 料率）
    if (guard.healthInsurance) {
      const prefecture = guard.prefecture || ''
      if (prefecture) {
        try {
          // 等級1の標準報酬月額に対する employeeShare の比率から保険料率を逆算
          const grade1 = await prisma.healthInsGradeTable.findUnique({
            where: { fiscalYear_prefecture_grade: { fiscalYear, prefecture, grade: 1 } },
          })
          if (grade1 && grade1.standardMonthly > 0) {
            const healthRate = grade1.employeeShare / grade1.standardMonthly
            healthIns = Math.round(grossAmount * healthRate)

            // 介護保険（40歳以上）
            if (guard.nursingInsurance && guard.birthDate) {
              const birth = new Date(guard.birthDate)
              const age = payDate.getFullYear() - birth.getFullYear()
                - (payDate < new Date(payDate.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0)
              if (age >= 40 && grade1.nursingEmployee > 0) {
                const nursingRate = grade1.nursingEmployee / grade1.standardMonthly
                nursingIns = Math.round(grossAmount * nursingRate)
              }
            }
          } else {
            // マスタデータがない場合は簡易計算（東京都）
            healthIns = Math.round(grossAmount * 0.0499)
          }
        } catch {
          healthIns = Math.round(grossAmount * 0.0499)
        }
      } else {
        healthIns = Math.round(grossAmount * 0.0499)
      }
    }

    // 厚生年金（賞与額 × 9.15%）
    if (guard.pensionInsurance) {
      pensionIns = Math.round(grossAmount * 0.0915)
    }

    // 雇用保険
    if (guard.employmentInsurance) {
      try {
        const row = await prisma.employmentInsRate.findUnique({
          where: { fiscalYear_businessType: { fiscalYear, businessType: '一般' } },
        })
        if (row) {
          employmentIns = Math.round(grossAmount * row.employeeRate)
        }
      } catch { /* マスタデータなし */ }
    }

    // --- 賞与の所得税計算 ---
    // 前月の給与の課税対象額を取得
    const prevMonth = payDate.getMonth() // 0-based（前月）
    const prevYear = prevMonth === 0 ? payDate.getFullYear() - 1 : payDate.getFullYear()
    const prevMonthNum = prevMonth === 0 ? 12 : prevMonth

    let incomeTax = 0
    try {
      const prevPayroll = await prisma.payroll.findFirst({
        where: { companyId, guardId, year: prevYear, month: prevMonthNum },
      })
      const prevMonthTaxable = prevPayroll ? prevPayroll.taxableTotal : 0
      const taxRate = getBonusTaxRate(prevMonthTaxable)

      const socialInsTotal = healthIns + nursingIns + pensionIns + employmentIns
      incomeTax = Math.round((grossAmount - socialInsTotal) * taxRate)
      if (incomeTax < 0) incomeTax = 0
    } catch {
      // 前月給与データがない場合は税率0%
      incomeTax = 0
    }

    // 健保に介護保険を含める（BonusPayroll モデルに介護保険専用フィールドがないため）
    const totalHealthIns = healthIns + nursingIns
    const otherDeduction = 0
    const netAmount = grossAmount - (totalHealthIns + pensionIns + employmentIns + incomeTax + otherDeduction)

    const bonus = await prisma.bonusPayroll.create({
      data: {
        companyId,
        guardId,
        paymentDate: payDate,
        bonusType,
        grossAmount: Number(grossAmount),
        healthInsurance: totalHealthIns,
        pension: pensionIns,
        employmentIns,
        incomeTax,
        otherDeduction,
        netAmount,
      },
    })
    res.status(201).json(bonus)
  } catch (e) {
    logger.error('賞与計算エラー', e, { context: 'bonus-payroll' })
    res.status(500).json({ error: '賞与計算に失敗しました' })
  }
})

app.get('/api/bonus-payroll', authenticate, async (req, res) => {
  try {
    const { companyId } = (req as any).user as JwtPayload
    const year = Number(req.query.year) || new Date().getFullYear()

    const startDate = new Date(year, 0, 1)
    const endDate = new Date(year, 11, 31)

    const bonuses = await prisma.bonusPayroll.findMany({
      where: {
        companyId,
        paymentDate: { gte: startDate, lte: endDate },
      },
      orderBy: { paymentDate: 'desc' },
    })
    res.json(bonuses)
  } catch (e) {
    logger.error('賞与一覧取得エラー', e, { context: 'bonus-payroll' })
    res.status(500).json({ error: '賞与一覧の取得に失敗しました' })
  }
})

app.get('/api/bonus-payroll/:id/pdf', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { companyId } = (req as any).user as JwtPayload
    const bonus = await prisma.bonusPayroll.findFirst({
      where: { id: req.params.id, companyId },
    })
    if (!bonus) { res.status(404).json({ error: '賞与データが見つかりません' }); return }

    const guard = await prisma.guard.findFirst({
      where: { id: bonus.guardId, companyId },
      select: { name: true, nameKana: true, employeeNumber: true },
    })
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })

    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename=bonus_${bonus.bonusType}_${bonus.guardId}.pdf`)
    doc.pipe(res)

    const fontPath = path.join(__dirname, 'fonts', 'NotoSansJP-Regular.ttf')
    let fontRegistered = false
    try {
      const fs = require('fs')
      if (fs.existsSync(fontPath)) {
        doc.registerFont('JP', fontPath)
        doc.font('JP')
        fontRegistered = true
      }
    } catch { /* フォールバック */ }
    if (!fontRegistered) doc.font('Helvetica')

    const leftCol = 50
    const rightCol = 300
    let y = 50

    // タイトル
    const bonusLabel = bonus.bonusType === 'SUMMER' ? '夏季賞与' : bonus.bonusType === 'WINTER' ? '冬季賞与' : '賞与'
    doc.fontSize(18).text(fontRegistered ? `${bonusLabel}明細書` : `Bonus Pay Slip (${bonus.bonusType})`, leftCol, y, { align: 'center' })
    y += 35

    // 支給日
    const pd = new Date(bonus.paymentDate)
    doc.fontSize(12).text(`${pd.getFullYear()}/${padLeft(pd.getMonth() + 1, 2)}/${padLeft(pd.getDate(), 2)}`, leftCol, y, { align: 'center' })
    y += 25

    // 隊員情報
    doc.fontSize(10)
    if (guard) {
      doc.text(fontRegistered ? `氏名: ${guard.name}` : `Name: ${guard.name}`, leftCol, y)
      doc.text(fontRegistered ? `社員番号: ${guard.employeeNumber || '-'}` : `Employee No: ${guard.employeeNumber || '-'}`, rightCol, y)
      y += 20
    }
    if (company) {
      doc.text(fontRegistered ? `会社: ${company.name}` : `Company: ${company.name}`, leftCol, y)
      y += 20
    }

    doc.moveTo(leftCol, y).lineTo(550, y).stroke()
    y += 15

    // 支給額
    doc.fontSize(12).text(fontRegistered ? '【支給】' : '[Payment]', leftCol, y)
    y += 20
    doc.fontSize(10)
    doc.text(fontRegistered ? '賞与額' : 'Gross Amount', leftCol, y)
    doc.text(formatCurrency(bonus.grossAmount), rightCol, y, { width: 180, align: 'right' })
    y += 20

    doc.moveTo(leftCol, y).lineTo(550, y).stroke()
    y += 15

    // 控除
    doc.fontSize(12).text(fontRegistered ? '【控除】' : '[Deductions]', leftCol, y)
    y += 20
    doc.fontSize(10)

    const deductionItems: [string, number][] = [
      [fontRegistered ? '健康保険料' : 'Health Insurance', bonus.healthInsurance],
      [fontRegistered ? '厚生年金' : 'Pension', bonus.pension],
      [fontRegistered ? '雇用保険料' : 'Employment Insurance', bonus.employmentIns],
      [fontRegistered ? '所得税' : 'Income Tax', bonus.incomeTax],
      [fontRegistered ? 'その他控除' : 'Other Deduction', bonus.otherDeduction],
    ]
    for (const [label, amount] of deductionItems) {
      doc.text(label, leftCol, y)
      doc.text(formatCurrency(amount), rightCol, y, { width: 180, align: 'right' })
      y += 18
    }

    const totalDeduction = bonus.healthInsurance + bonus.pension + bonus.employmentIns + bonus.incomeTax + bonus.otherDeduction
    y += 5
    doc.fontSize(11).text(fontRegistered ? '控除合計' : 'Total Deductions', leftCol, y)
    doc.text(formatCurrency(totalDeduction), rightCol, y, { width: 180, align: 'right' })
    y += 25

    doc.moveTo(leftCol, y).lineTo(550, y).stroke()
    y += 15

    // 差引支給額
    doc.fontSize(14).text(fontRegistered ? '差引支給額' : 'Net Amount', leftCol, y)
    doc.text(formatCurrency(bonus.netAmount), rightCol, y, { width: 180, align: 'right' })

    doc.end()
  } catch (e) {
    logger.error('賞与PDF生成エラー', e, { context: 'bonus-payroll' })
    res.status(500).json({ error: '賞与PDF生成に失敗しました' })
  }
})

// ─────────────────────────────────────────────
// 算定基礎届データ作成 API
// ─────────────────────────────────────────────

app.get('/api/insurance/santeikiso/:year', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = (req as any).user as JwtPayload
    const year = Number(req.params.year)

    if (!year || year < 2000 || year > 2100) {
      res.status(400).json({ error: '年度が不正です' }); return
    }

    // 4月・5月・6月の Payroll を全隊員分取得
    const payrolls = await prisma.payroll.findMany({
      where: { companyId, year, month: { in: [4, 5, 6] } },
      include: { guard: { select: { id: true, name: true, employeeNumber: true, healthInsuranceGrade: true, pensionInsuranceGrade: true, prefecture: true } } },
      orderBy: [{ guardId: 'asc' }, { month: 'asc' }],
    })

    // 隊員ごとにグルーピング
    const guardMap = new Map<string, { guard: { id: string; name: string; employeeNumber: string; healthInsuranceGrade: number | null; pensionInsuranceGrade: number | null; prefecture: string | null }; months: { [month: number]: number } }>()

    for (const p of payrolls) {
      if (!guardMap.has(p.guardId)) {
        guardMap.set(p.guardId, { guard: p.guard, months: {} })
      }
      const entry = guardMap.get(p.guardId)!
      entry.months[p.month] = p.grossPay
    }

    // 等級テーブルを取得（健康保険: 都道府県別）
    const healthGrades = await prisma.healthInsGradeTable.findMany({
      where: { fiscalYear: year },
      orderBy: [{ prefecture: 'asc' }, { grade: 'asc' }],
    })

    const results: Array<{
      guardId: string; guardName: string; employeeNumber: string;
      apr: number; may: number; jun: number; average: number;
      currentGrade: number | null; newGrade: number; newStandardMonthly: number; changed: boolean;
    }> = []

    for (const [guardId, data] of guardMap) {
      const apr = data.months[4] || 0
      const may = data.months[5] || 0
      const jun = data.months[6] || 0
      const monthCount = (apr > 0 ? 1 : 0) + (may > 0 ? 1 : 0) + (jun > 0 ? 1 : 0)
      if (monthCount === 0) continue

      const average = Math.round((apr + may + jun) / monthCount)

      // 都道府県別の等級テーブルから標準報酬月額を決定
      const prefecture = data.guard.prefecture || '東京都'
      const prefGrades = healthGrades.filter(g => g.prefecture === prefecture)

      let newGrade = 1
      let newStandardMonthly = 0
      if (prefGrades.length > 0) {
        // 報酬月額に最も近い標準報酬月額の等級を選択
        let minDiff = Infinity
        for (const g of prefGrades) {
          const diff = Math.abs(g.standardMonthly - average)
          if (diff < minDiff) {
            minDiff = diff
            newGrade = g.grade
            newStandardMonthly = g.standardMonthly
          }
        }
      }

      const currentGrade = data.guard.healthInsuranceGrade
      const changed = currentGrade !== newGrade

      results.push({
        guardId,
        guardName: data.guard.name,
        employeeNumber: data.guard.employeeNumber,
        apr, may, jun, average,
        currentGrade,
        newGrade,
        newStandardMonthly,
        changed,
      })
    }

    res.json(results)
  } catch (e) {
    logger.error('算定基礎届データ取得エラー', e, { context: 'insurance' })
    res.status(500).json({ error: '算定基礎届データの取得に失敗しました' })
  }
})

app.post('/api/insurance/santeikiso/:year/apply', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = (req as any).user as JwtPayload
    const year = Number(req.params.year)

    if (!year || year < 2000 || year > 2100) {
      res.status(400).json({ error: '年度が不正です' }); return
    }

    // 算定基礎データを再計算
    const payrolls = await prisma.payroll.findMany({
      where: { companyId, year, month: { in: [4, 5, 6] } },
      include: { guard: { select: { id: true, prefecture: true } } },
      orderBy: [{ guardId: 'asc' }, { month: 'asc' }],
    })

    const guardMap = new Map<string, { prefecture: string | null; months: { [month: number]: number } }>()
    for (const p of payrolls) {
      if (!guardMap.has(p.guardId)) {
        guardMap.set(p.guardId, { prefecture: p.guard.prefecture, months: {} })
      }
      guardMap.get(p.guardId)!.months[p.month] = p.grossPay
    }

    const healthGrades = await prisma.healthInsGradeTable.findMany({
      where: { fiscalYear: year },
      orderBy: [{ prefecture: 'asc' }, { grade: 'asc' }],
    })

    const pensionGrades = await prisma.pensionGradeTable.findMany({
      where: { fiscalYear: year },
      orderBy: { grade: 'asc' },
    })

    let updatedCount = 0
    for (const [guardId, data] of guardMap) {
      const apr = data.months[4] || 0
      const may = data.months[5] || 0
      const jun = data.months[6] || 0
      const monthCount = (apr > 0 ? 1 : 0) + (may > 0 ? 1 : 0) + (jun > 0 ? 1 : 0)
      if (monthCount === 0) continue

      const average = Math.round((apr + may + jun) / monthCount)

      // 健保等級
      const prefecture = data.prefecture || '東京都'
      const prefGrades = healthGrades.filter(g => g.prefecture === prefecture)
      let newHealthGrade = 1
      if (prefGrades.length > 0) {
        let minDiff = Infinity
        for (const g of prefGrades) {
          const diff = Math.abs(g.standardMonthly - average)
          if (diff < minDiff) { minDiff = diff; newHealthGrade = g.grade }
        }
      }

      // 年金等級
      let newPensionGrade = 1
      if (pensionGrades.length > 0) {
        let minDiff = Infinity
        for (const g of pensionGrades) {
          const diff = Math.abs(g.standardMonthly - average)
          if (diff < minDiff) { minDiff = diff; newPensionGrade = g.grade }
        }
      }

      await prisma.guard.updateMany({
        where: { id: guardId, companyId },
        data: { healthInsuranceGrade: newHealthGrade, pensionInsuranceGrade: newPensionGrade },
      })
      updatedCount++
    }

    res.json({ success: true, updatedCount })
  } catch (e) {
    logger.error('算定基礎届適用エラー', e, { context: 'insurance' })
    res.status(500).json({ error: '算定基礎届の適用に失敗しました' })
  }
})

// ─────────────────────────────────────────────
// 月額変更届データ作成 API
// ─────────────────────────────────────────────

app.get('/api/insurance/getsuhen/:guardId', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = (req as any).user as JwtPayload
    const { guardId } = req.params
    const changeMonth = req.query.changeMonth as string

    if (!changeMonth || !/^\d{4}-\d{2}$/.test(changeMonth)) {
      res.status(400).json({ error: 'changeMonth（例: 2026-04）は必須です' }); return
    }

    const guard = await prisma.guard.findFirst({
      where: { id: guardId, companyId },
      select: { id: true, name: true, employeeNumber: true, healthInsuranceGrade: true, pensionInsuranceGrade: true, prefecture: true },
    })
    if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

    // changeMonth から3ヶ月分の year/month を算出
    const [startYear, startMonth] = changeMonth.split('-').map(Number)
    const months: { year: number; month: number }[] = []
    for (let i = 0; i < 3; i++) {
      let m = startMonth + i
      let y = startYear
      if (m > 12) { m -= 12; y++ }
      months.push({ year: y, month: m })
    }

    // 3ヶ月分の Payroll を取得
    const payrolls = await prisma.payroll.findMany({
      where: {
        companyId,
        guardId,
        OR: months.map(m => ({ year: m.year, month: m.month })),
      },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    })

    const monthlyAmounts: number[] = [0, 0, 0]
    for (const p of payrolls) {
      const idx = months.findIndex(m => m.year === p.year && m.month === p.month)
      if (idx >= 0) monthlyAmounts[idx] = p.grossPay
    }

    const validMonths = monthlyAmounts.filter(a => a > 0)
    const average = validMonths.length > 0 ? Math.round(validMonths.reduce((s, a) => s + a, 0) / validMonths.length) : 0

    // 新しい標準報酬月額を決定
    const fiscalYear = startYear
    const prefecture = guard.prefecture || '東京都'
    const healthGrades = await prisma.healthInsGradeTable.findMany({
      where: { fiscalYear, prefecture },
      orderBy: { grade: 'asc' },
    })

    let newGrade = 1
    let newStandardMonthly = 0
    if (healthGrades.length > 0) {
      let minDiff = Infinity
      for (const g of healthGrades) {
        const diff = Math.abs(g.standardMonthly - average)
        if (diff < minDiff) { minDiff = diff; newGrade = g.grade; newStandardMonthly = g.standardMonthly }
      }
    }

    const currentGrade = guard.healthInsuranceGrade || 0
    const gradeChange = Math.abs(newGrade - currentGrade)
    const isEligible = gradeChange >= 2

    res.json({
      guardId: guard.id,
      guardName: guard.name,
      month1: monthlyAmounts[0],
      month2: monthlyAmounts[1],
      month3: monthlyAmounts[2],
      average,
      currentGrade: guard.healthInsuranceGrade,
      newGrade,
      gradeChange,
      isEligible,
    })
  } catch (e) {
    logger.error('月額変更届データ取得エラー', e, { context: 'insurance' })
    res.status(500).json({ error: '月額変更届データの取得に失敗しました' })
  }
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
// マイナンバー管理 API
// ─────────────────────────────────────────────

// マイナンバー登録・更新
app.post('/api/guards/:id/my-number', authenticate, requireRole('ADMIN'), async (req, res) => {
  const user = (req as any).user as JwtPayload
  const { id } = req.params
  const { myNumber } = req.body

  if (!myNumber || !/^\d{12}$/.test(myNumber)) {
    res.status(400).json({ error: 'マイナンバーは12桁の数字で入力してください' })
    return
  }

  const guard = await prisma.guard.findFirst({ where: { id, companyId: user.companyId } })
  if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

  const encrypted = encrypt(myNumber)
  await prisma.guard.update({
    where: { id },
    data: { myNumber: encrypted, myNumberUpdatedAt: new Date() },
  })

  // ユーザー名を取得
  const dbUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } })

  await prisma.myNumberAuditLog.create({
    data: {
      companyId: user.companyId,
      guardId: id,
      userId: user.userId,
      userName: dbUser?.name || 'Unknown',
      action: 'UPDATE',
      ipAddress: req.ip || req.headers['x-forwarded-for']?.toString() || null,
      userAgent: req.headers['user-agent'] || null,
    },
  })

  logger.info('マイナンバー更新', { guardId: id, userId: user.userId })
  res.json({ success: true })
})

// マイナンバー取得（マスク表示）
app.get('/api/guards/:id/my-number', authenticate, requireRole('ADMIN'), async (req, res) => {
  const user = (req as any).user as JwtPayload
  const { id } = req.params

  const guard = await prisma.guard.findFirst({
    where: { id, companyId: user.companyId },
    select: { myNumber: true },
  })
  if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

  if (!guard.myNumber) {
    res.json({ myNumber: null, hasMyNumber: false })
    return
  }

  const decrypted = decrypt(guard.myNumber)

  // ユーザー名を取得
  const dbUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } })

  await prisma.myNumberAuditLog.create({
    data: {
      companyId: user.companyId,
      guardId: id,
      userId: user.userId,
      userName: dbUser?.name || 'Unknown',
      action: 'VIEW',
      ipAddress: req.ip || req.headers['x-forwarded-for']?.toString() || null,
      userAgent: req.headers['user-agent'] || null,
    },
  })

  // マスク表示: 先頭4桁のみ表示、残り8桁は ********
  const masked = decrypted.slice(0, 4) + '********'
  res.json({ myNumber: masked, hasMyNumber: true })
})

// マイナンバー取得（フル表示 - スーパー管理者のみ）
app.get('/api/guards/:id/my-number/full', authenticate, requireSuperAdmin, async (req, res) => {
  const user = (req as any).user as JwtPayload
  const { id } = req.params

  const guard = await prisma.guard.findFirst({
    where: { id, companyId: user.companyId },
    select: { myNumber: true },
  })
  if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

  if (!guard.myNumber) {
    res.json({ myNumber: null })
    return
  }

  const decrypted = decrypt(guard.myNumber)

  // ユーザー名を取得
  const dbUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } })

  await prisma.myNumberAuditLog.create({
    data: {
      companyId: user.companyId,
      guardId: id,
      userId: user.userId,
      userName: dbUser?.name || 'Unknown',
      action: 'VIEW',
      ipAddress: req.ip || req.headers['x-forwarded-for']?.toString() || null,
      userAgent: req.headers['user-agent'] || null,
    },
  })

  res.json({ myNumber: decrypted })
})

// マイナンバー削除
app.delete('/api/guards/:id/my-number', authenticate, requireRole('ADMIN'), async (req, res) => {
  const user = (req as any).user as JwtPayload
  const { id } = req.params

  const guard = await prisma.guard.findFirst({ where: { id, companyId: user.companyId } })
  if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

  await prisma.guard.update({
    where: { id },
    data: { myNumber: null, myNumberUpdatedAt: null },
  })

  // ユーザー名を取得
  const dbUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } })

  await prisma.myNumberAuditLog.create({
    data: {
      companyId: user.companyId,
      guardId: id,
      userId: user.userId,
      userName: dbUser?.name || 'Unknown',
      action: 'DELETE',
      ipAddress: req.ip || req.headers['x-forwarded-for']?.toString() || null,
      userAgent: req.headers['user-agent'] || null,
    },
  })

  logger.info('マイナンバー削除', { guardId: id, userId: user.userId })
  res.json({ success: true })
})

// マイナンバー監査ログ取得（スーパー管理者のみ）
app.get('/api/my-number/audit-log', authenticate, requireSuperAdmin, async (req, res) => {
  const user = (req as any).user as JwtPayload
  const { guardId, userId, from, to } = req.query as { guardId?: string; userId?: string; from?: string; to?: string }

  const where: Record<string, unknown> = { companyId: user.companyId }
  if (guardId) where.guardId = guardId
  if (userId) where.userId = userId
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    }
  }

  const logs = await prisma.myNumberAuditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  res.json(logs)
})

// ─────────────────────────────────────────────
// 最適人材配置 API（地図ベース）
// ─────────────────────────────────────────────

// Haversine formula: 2点間の直線距離(km)を計算
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371 // 地球の半径(km)
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// 都道府県の代表座標（Geocoding APIフォールバック用）
const PREFECTURE_COORDS: Record<string, { lat: number; lng: number }> = {
  '北海道': { lat: 43.0646, lng: 141.3468 },
  '青森県': { lat: 40.8244, lng: 140.7400 },
  '岩手県': { lat: 39.7036, lng: 141.1527 },
  '宮城県': { lat: 38.2688, lng: 140.8721 },
  '秋田県': { lat: 39.7186, lng: 140.1024 },
  '山形県': { lat: 38.2404, lng: 140.3634 },
  '福島県': { lat: 37.7503, lng: 140.4676 },
  '茨城県': { lat: 36.3418, lng: 140.4468 },
  '栃木県': { lat: 36.5657, lng: 139.8836 },
  '群馬県': { lat: 36.3911, lng: 139.0608 },
  '埼玉県': { lat: 35.8569, lng: 139.6489 },
  '千葉県': { lat: 35.6047, lng: 140.1233 },
  '東京都': { lat: 35.6895, lng: 139.6917 },
  '神奈川県': { lat: 35.4478, lng: 139.6425 },
  '新潟県': { lat: 37.9026, lng: 139.0236 },
  '富山県': { lat: 36.6953, lng: 137.2114 },
  '石川県': { lat: 36.5946, lng: 136.6256 },
  '福井県': { lat: 36.0652, lng: 136.2219 },
  '山梨県': { lat: 35.6642, lng: 138.5684 },
  '長野県': { lat: 36.2326, lng: 138.1810 },
  '岐阜県': { lat: 35.3912, lng: 136.7223 },
  '静岡県': { lat: 34.9769, lng: 138.3831 },
  '愛知県': { lat: 35.1802, lng: 136.9066 },
  '三重県': { lat: 34.7303, lng: 136.5086 },
  '滋賀県': { lat: 35.0045, lng: 135.8686 },
  '京都府': { lat: 35.0116, lng: 135.7681 },
  '大阪府': { lat: 34.6863, lng: 135.5200 },
  '兵庫県': { lat: 34.6913, lng: 135.1830 },
  '奈良県': { lat: 34.6851, lng: 135.8328 },
  '和歌山県': { lat: 34.2260, lng: 135.1675 },
  '鳥取県': { lat: 35.5039, lng: 134.2381 },
  '島根県': { lat: 35.4723, lng: 133.0505 },
  '岡山県': { lat: 34.6618, lng: 133.9344 },
  '広島県': { lat: 34.3966, lng: 132.4596 },
  '山口県': { lat: 34.1861, lng: 131.4714 },
  '徳島県': { lat: 34.0658, lng: 134.5593 },
  '香川県': { lat: 34.3401, lng: 134.0434 },
  '愛媛県': { lat: 33.8416, lng: 132.7657 },
  '高知県': { lat: 33.5597, lng: 133.5311 },
  '福岡県': { lat: 33.6064, lng: 130.4183 },
  '佐賀県': { lat: 33.2494, lng: 130.2988 },
  '長崎県': { lat: 32.7448, lng: 129.8737 },
  '熊本県': { lat: 32.7898, lng: 130.7417 },
  '大分県': { lat: 33.2382, lng: 131.6126 },
  '宮崎県': { lat: 31.9111, lng: 131.4239 },
  '鹿児島県': { lat: 31.5602, lng: 130.5581 },
  '沖縄県': { lat: 26.2124, lng: 127.6809 },
}

// 配置スコア計算
function calculateAssignmentScore(
  guard: {
    id: string
    lat: number | null
    lng: number | null
    certifications: string[]
    guardClass: string | null
    overallRating: number | null
    ngGuardIds: unknown
    ngCompanies: unknown
    skills: string[]
  },
  site: {
    id: string
    lat: number | null
    lng: number | null
    requiredQualifiedA: number
    clientName: string | null
    clientId: string | null
  },
  mode: string,
  alreadyAssignedGuardIds: string[],
  pastExperienceCount: number,
): { score: number; reasons: string[]; distanceKm: number | null } {
  let score = 100
  const reasons: string[] = []
  let distanceKm: number | null = null

  // NG チェック（スコア0 = 配置不可）
  let ngGuards: Array<{ id?: string }> = []
  let ngCompanies: Array<{ name?: string }> = []
  try { ngGuards = JSON.parse(typeof guard.ngGuardIds === 'string' ? guard.ngGuardIds : JSON.stringify(guard.ngGuardIds || '[]')) } catch { ngGuards = [] }
  try { ngCompanies = JSON.parse(typeof guard.ngCompanies === 'string' ? guard.ngCompanies : JSON.stringify(guard.ngCompanies || '[]')) } catch { ngCompanies = [] }

  // ngGuards にこの現場に既に配置されている隊員がいたら不可
  if (Array.isArray(ngGuards) && ngGuards.length > 0) {
    const ngIds = ngGuards.map((ng) => ng.id).filter(Boolean)
    const conflict = alreadyAssignedGuardIds.some((id) => ngIds.includes(id))
    if (conflict) {
      return { score: 0, reasons: ['NG隊員が配置済み'], distanceKm: null }
    }
  }

  // ngCompanies にこの現場の取引先が含まれていたら不可
  if (Array.isArray(ngCompanies) && ngCompanies.length > 0) {
    const ngNames = ngCompanies.map((ng) => ng.name).filter(Boolean)
    if (site.clientName && ngNames.includes(site.clientName)) {
      return { score: 0, reasons: ['NG取引先'], distanceKm: null }
    }
  }

  // 距離スコア
  let distScore = 0
  if (guard.lat && guard.lng && site.lat && site.lng) {
    const dist = haversineDistance(guard.lat, guard.lng, site.lat, site.lng)
    distanceKm = Math.round(dist * 10) / 10
    if (dist <= 10) { distScore = 30; reasons.push(`近距離(${distanceKm}km)`) }
    else if (dist <= 20) { distScore = 20; reasons.push(`中距離(${distanceKm}km)`) }
    else if (dist <= 30) { distScore = 10; reasons.push(`${distanceKm}km`) }
    else if (dist > 50) { distScore = -20; reasons.push(`遠距離(${distanceKm}km)`) }
  }

  // スキルマッチスコア
  let skillScore = 0
  if (site.requiredQualifiedA > 0 && guard.certifications && guard.certifications.length > 0) {
    skillScore = 20
    reasons.push('資格保有')
  }

  // クラススコア
  let classScore = 0
  if (guard.guardClass === 'S') { classScore = 15; reasons.push('Sクラス') }
  else if (guard.guardClass === 'A') { classScore = 10; reasons.push('Aクラス') }
  else if (guard.guardClass === 'B') { classScore = 5; reasons.push('Bクラス') }

  // 過去の現場経験スコア
  if (pastExperienceCount > 0) {
    const expScore = Math.min(pastExperienceCount * 3, 15)
    score += expScore
    reasons.push(`経験${pastExperienceCount}回`)
  }

  // 評価スコア
  if (guard.overallRating) {
    const ratingScore = (guard.overallRating - 3) * 5
    score += ratingScore
    if (guard.overallRating >= 4) reasons.push(`評価${guard.overallRating}`)
  }

  // モード別の重み付け
  if (mode === 'distance') {
    score += distScore * 2 + skillScore + classScore
  } else if (mode === 'skill') {
    score += distScore + skillScore * 2 + classScore * 2
  } else {
    // balanced
    score += distScore + skillScore + classScore
  }

  return { score, reasons, distanceKm }
}

// POST /api/dispatch/optimize - 最適人材配置
app.post('/api/dispatch/optimize', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { date, siteIds, guardIds, mode = 'balanced' } = req.body

  if (!date) { res.status(400).json({ error: 'date は必須です' }); return }

  const targetDate = new Date(date)

  // 1. 対象現場を取得
  const siteWhere: Record<string, unknown> = { companyId, isActive: true }
  if (siteIds && Array.isArray(siteIds) && siteIds.length > 0) {
    siteWhere.id = { in: siteIds }
  }
  const allSites = await prisma.site.findMany({ where: siteWhere })

  // 各現場の配置済み人数を取得
  const existingSchedules = await prisma.schedule.findMany({
    where: {
      companyId,
      date: targetDate,
      status: { not: 'CANCELLED' },
      siteId: { in: allSites.map((s) => s.id) },
    },
    select: { siteId: true, guardId: true },
  })

  const siteAssignedMap = new Map<string, string[]>()
  for (const s of existingSchedules) {
    if (!siteAssignedMap.has(s.siteId)) siteAssignedMap.set(s.siteId, [])
    siteAssignedMap.get(s.siteId)!.push(s.guardId)
  }

  // 未充足の現場のみ
  const unfilledSites = allSites.filter((site) => {
    const assigned = siteAssignedMap.get(site.id)?.length || 0
    return assigned < site.requiredCount
  })

  // 2. その日にスケジュールがない隊員を取得
  const guardWhere: Record<string, unknown> = { companyId, isActive: true }
  if (guardIds && Array.isArray(guardIds) && guardIds.length > 0) {
    guardWhere.id = { in: guardIds }
  }
  const allGuards = await prisma.guard.findMany({ where: guardWhere })

  const busyGuardSchedules = await prisma.schedule.findMany({
    where: {
      companyId,
      date: targetDate,
      status: { not: 'CANCELLED' },
      guardId: { in: allGuards.map((g) => g.id) },
    },
    select: { guardId: true },
  })
  const busyGuardIds = new Set(busyGuardSchedules.map((s) => s.guardId))
  const availableGuards = allGuards.filter((g) => !busyGuardIds.has(g.id))

  // 3. 過去の配置回数を集計（各隊員×各現場）
  const pastSchedules = await prisma.schedule.findMany({
    where: {
      companyId,
      guardId: { in: availableGuards.map((g) => g.id) },
      siteId: { in: unfilledSites.map((s) => s.id) },
      status: { not: 'CANCELLED' },
    },
    select: { guardId: true, siteId: true },
  })
  const experienceMap = new Map<string, number>()
  for (const ps of pastSchedules) {
    const key = `${ps.guardId}:${ps.siteId}`
    experienceMap.set(key, (experienceMap.get(key) || 0) + 1)
  }

  // 4. スコア計算 & Greedy割当
  interface ScoreEntry {
    guardId: string
    guardName: string
    guardLat: number | null
    guardLng: number | null
    siteId: string
    score: number
    reasons: string[]
    distanceKm: number | null
  }

  const scoreEntries: ScoreEntry[] = []

  for (const site of unfilledSites) {
    const alreadyAssigned = siteAssignedMap.get(site.id) || []
    for (const guard of availableGuards) {
      const expCount = experienceMap.get(`${guard.id}:${site.id}`) || 0
      const result = calculateAssignmentScore(
        {
          id: guard.id,
          lat: guard.lat,
          lng: guard.lng,
          certifications: guard.certifications,
          guardClass: guard.guardClass,
          overallRating: guard.overallRating,
          ngGuardIds: guard.ngGuardIds,
          ngCompanies: guard.ngCompanies,
          skills: guard.skills,
        },
        {
          id: site.id,
          lat: site.lat,
          lng: site.lng,
          requiredQualifiedA: site.requiredQualifiedA,
          clientName: site.clientName,
          clientId: site.clientId,
        },
        mode,
        alreadyAssigned,
        expCount,
      )
      if (result.score > 0) {
        scoreEntries.push({
          guardId: guard.id,
          guardName: guard.name,
          guardLat: guard.lat,
          guardLng: guard.lng,
          siteId: site.id,
          score: result.score,
          reasons: result.reasons,
          distanceKm: result.distanceKm,
        })
      }
    }
  }

  // スコア降順ソート
  scoreEntries.sort((a, b) => b.score - a.score)

  // Greedy割当（1隊員1現場）
  const assignedGuardIds = new Set<string>()
  const siteAssignments = new Map<string, ScoreEntry[]>()
  const siteRemainingMap = new Map<string, number>()

  for (const site of unfilledSites) {
    const alreadyCount = siteAssignedMap.get(site.id)?.length || 0
    siteRemainingMap.set(site.id, site.requiredCount - alreadyCount)
    siteAssignments.set(site.id, [])
  }

  for (const entry of scoreEntries) {
    if (assignedGuardIds.has(entry.guardId)) continue
    const remaining = siteRemainingMap.get(entry.siteId) || 0
    if (remaining <= 0) continue

    assignedGuardIds.add(entry.guardId)
    siteAssignments.get(entry.siteId)!.push(entry)
    siteRemainingMap.set(entry.siteId, remaining - 1)
  }

  // 5. レスポンス構築
  const assignments = unfilledSites.map((site) => {
    const assigned = siteAssignments.get(site.id) || []
    const alreadyCount = siteAssignedMap.get(site.id)?.length || 0
    return {
      siteId: site.id,
      siteName: site.name,
      siteAddress: site.address,
      siteLat: site.lat,
      siteLng: site.lng,
      requiredCount: site.requiredCount,
      assignedGuards: assigned.map((a) => ({
        guardId: a.guardId,
        guardName: a.guardName,
        guardLat: a.guardLat,
        guardLng: a.guardLng,
        score: a.score,
        reasons: a.reasons,
        distanceKm: a.distanceKm,
      })),
      unfilledCount: Math.max(0, site.requiredCount - alreadyCount - assigned.length),
    }
  })

  const unassignedGuards = availableGuards
    .filter((g) => !assignedGuardIds.has(g.id))
    .map((g) => ({
      guardId: g.id,
      guardName: g.name,
      reason: '適合する未充足現場なし',
    }))

  res.json({
    date,
    assignments,
    unassignedGuards,
    stats: {
      totalSites: unfilledSites.length,
      totalGuards: availableGuards.length,
      assignedCount: assignedGuardIds.size,
      unfilledSites: assignments.filter((a) => a.unfilledCount > 0).length,
    },
  })
})

// POST /api/dispatch/optimize/apply - 最適化結果をScheduleに一括登録
app.post('/api/dispatch/optimize/apply', authenticate, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const { date, assignments } = req.body

  if (!date || !assignments || !Array.isArray(assignments)) {
    res.status(400).json({ error: 'date と assignments は必須です' })
    return
  }

  const targetDate = new Date(date)
  const created = []

  for (const assignment of assignments) {
    const { siteId, guardId, startTime, endTime } = assignment

    // 現場の存在確認
    const site = await prisma.site.findFirst({ where: { id: siteId, companyId } })
    if (!site) continue

    // 隊員の存在確認
    const guard = await prisma.guard.findFirst({ where: { id: guardId, companyId } })
    if (!guard) continue

    // 既に同日同隊員のスケジュールが存在しないか確認
    const existing = await prisma.schedule.findFirst({
      where: { companyId, guardId, date: targetDate, status: { not: 'CANCELLED' } },
    })
    if (existing) continue

    const schedule = await prisma.schedule.create({
      data: {
        companyId,
        guardId,
        siteId,
        date: targetDate,
        startTime: startTime || site.defaultStartTime || '09:00',
        endTime: endTime || site.defaultEndTime || '17:00',
        status: 'ASSIGNED',
      },
    })
    created.push(schedule)
  }

  res.json({ ok: true, createdCount: created.length, schedules: created })
})

// GET /api/dispatch/map-data/:date - 地図表示用データ
app.get('/api/dispatch/map-data/:date', authenticate, async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const date = req.params.date
  const targetDate = new Date(date)

  // 全アクティブ現場
  const sites = await prisma.site.findMany({
    where: { companyId, isActive: true },
    select: {
      id: true, name: true, address: true, lat: true, lng: true,
      requiredCount: true, requiredQualifiedA: true, requiredQualifiedB: true,
      clientName: true, defaultStartTime: true, defaultEndTime: true,
    },
  })

  // 指定日の全スケジュール
  const schedules = await prisma.schedule.findMany({
    where: { companyId, date: targetDate, status: { not: 'CANCELLED' } },
    select: { guardId: true, siteId: true, site: { select: { name: true } } },
  })

  const siteAssignedCounts = new Map<string, number>()
  const guardAssignmentMap = new Map<string, string>()
  for (const s of schedules) {
    siteAssignedCounts.set(s.siteId, (siteAssignedCounts.get(s.siteId) || 0) + 1)
    guardAssignmentMap.set(s.guardId, s.site.name)
  }

  // 全アクティブ隊員
  const guards = await prisma.guard.findMany({
    where: { companyId, isActive: true },
    select: {
      id: true, name: true, nameKana: true, lat: true, lng: true,
      guardClass: true, certifications: true, skills: true,
      prefecture: true, city: true,
    },
  })

  res.json({
    sites: sites.map((s) => ({
      ...s,
      assignedCount: siteAssignedCounts.get(s.id) || 0,
    })),
    guards: guards.map((g) => ({
      ...g,
      isAssigned: guardAssignmentMap.has(g.id),
      assignedSiteName: guardAssignmentMap.get(g.id) || null,
    })),
  })
})

// POST /api/guards/:id/geocode - 隊員住所からジオコーディング
app.post('/api/guards/:id/geocode', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { companyId } = (req as any).user as JwtPayload
  const guardId = req.params.id

  const guard = await prisma.guard.findFirst({ where: { id: guardId, companyId } })
  if (!guard) { res.status(404).json({ error: '隊員が見つかりません' }); return }

  // 住所を構築
  const addressParts = [guard.prefecture, guard.city, guard.addressDetail].filter(Boolean)
  const fullAddress = addressParts.join('')

  if (!fullAddress) {
    res.status(400).json({ error: '住所が設定されていません' })
    return
  }

  let lat: number | null = null
  let lng: number | null = null
  let geocodeSource = 'none'

  // Google Geocoding API を試行
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (apiKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${apiKey}&language=ja`
      const response = await fetch(url)
      const data = await response.json() as {
        status: string
        results: Array<{ geometry: { location: { lat: number; lng: number } } }>
      }
      if (data.status === 'OK' && data.results.length > 0) {
        lat = data.results[0].geometry.location.lat
        lng = data.results[0].geometry.location.lng
        geocodeSource = 'google'
      }
    } catch (err) {
      logger.warn('Google Geocoding API エラー、フォールバックを使用', { guardId, error: String(err) })
    }
  }

  // フォールバック: 都道府県の代表座標を使用
  if (lat === null && guard.prefecture) {
    const coords = PREFECTURE_COORDS[guard.prefecture]
    if (coords) {
      lat = coords.lat
      lng = coords.lng
      geocodeSource = 'prefecture_fallback'
    }
  }

  if (lat === null || lng === null) {
    res.status(400).json({ error: 'ジオコーディングに失敗しました。住所を確認してください。' })
    return
  }

  const updated = await prisma.guard.update({
    where: { id: guardId },
    data: { lat, lng },
  })

  res.json({
    ok: true,
    guardId: updated.id,
    lat: updated.lat,
    lng: updated.lng,
    geocodeSource,
    address: fullAddress,
  })
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
