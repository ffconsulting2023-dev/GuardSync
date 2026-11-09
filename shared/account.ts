// アカウント（ログインID・パスワード・権限）SSOT: server.ts と画面の双方が参照する
import { z } from 'zod'

// ロール表示名（Prisma enum UserRole と一致させる）
export const ACCOUNT_ROLES = {
  ADMIN: '管理者',
  MANAGER: 'マネージャー',
  OPERATOR: 'オペレーター',
  VIEWER: '閲覧者',
  GUARD: '隊員',
} as const
export type AccountRole = keyof typeof ACCOUNT_ROLES

// ログインID: 会社をまたいでシステム全体で一意。大文字小文字は区別しない（小文字で保存）。
// '@' を含めないことで、ログイン欄の入力がメールアドレスかログインIDかを判別できる
export const LOGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{3,31}$/
export const LOGIN_ID_RULE_TEXT = '半角英数字と . _ - の4〜32文字（先頭は英数字、大文字小文字は区別しません）'
export const normalizeLoginId = (s: string) => s.trim().toLowerCase()
export const loginIdSchema = z.string().transform(normalizeLoginId).pipe(z.string().regex(LOGIN_ID_PATTERN, `ログインIDは${LOGIN_ID_RULE_TEXT}で入力してください`))

export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/
export const PASSWORD_RULE_TEXT = '8文字以上で、英大文字・英小文字・数字をすべて含めてください'

// パスワード設定用URLの有効期限
export const SETUP_LINK_TTL_DAYS = 7

const optionalEmail = z.union([z.literal(''), z.string().trim().toLowerCase().email('メールアドレスの形式が正しくありません')])
  .optional()
  .transform(v => v || undefined)

export const accountCreateSchema = z.object({
  name: z.string().trim().min(1, '氏名を入力してください').max(50),
  loginId: loginIdSchema,
  email: optionalEmail,
  role: z.enum(['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER', 'GUARD']),
  guardId: z.string().uuid().optional().nullable(),
  canIssueAccounts: z.boolean().optional(),
}).refine(v => v.role !== 'GUARD' || !!v.guardId, { message: '隊員アカウントは紐付ける隊員を選択してください', path: ['guardId'] })

export const accountUpdateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  loginId: loginIdSchema.optional(),
  email: optionalEmail.or(z.null()),
  role: z.enum(['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER', 'GUARD']).optional(),
  guardId: z.string().uuid().nullable().optional(),
  canIssueAccounts: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export const passwordSetupSchema = z.object({
  password: z.string().regex(PASSWORD_PATTERN, `パスワードは${PASSWORD_RULE_TEXT}`),
  passwordConfirm: z.string(),
}).refine(v => v.password === v.passwordConfirm, { message: 'パスワードが一致しません', path: ['passwordConfirm'] })
