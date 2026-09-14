// ─────────────────────────────────────────────
// GuardSync 共通定数
// SSOT: ラベル・ステータス・選択肢は必ずここから import する
// ─────────────────────────────────────────────

export type StatusDef = { label: string; className: string }

// ─── ユーザーロール ───────────────────────────
export const USER_ROLES: Record<string, string> = {
  ADMIN:    '管理者',
  MANAGER:  'マネージャー',
  OPERATOR: 'オペレーター',
  VIEWER:   '閲覧者',
}

// ─── 電子契約ステータス ───────────────────────
export const E_CONTRACT_STATUS: Record<string, StatusDef> = {
  DRAFT:            { label: '下書き',     className: 'badge-gray' },
  SENT:             { label: '署名依頼中', className: 'badge-warning' },
  PARTIALLY_SIGNED: { label: '署名中',     className: 'badge-info' },
  COMPLETED:        { label: '締結完了',   className: 'badge-success' },
  EXPIRED:          { label: '期限切れ',   className: 'badge-danger' },
  CANCELLED:        { label: 'キャンセル', className: 'badge-danger' },
}

// ─── 契約ステータス ───────────────────────────
export const CONTRACT_STATUS: Record<string, StatusDef> = {
  DRAFT:     { label: '下書き',     className: 'badge-gray' },
  ACTIVE:    { label: '有効',       className: 'badge-success' },
  SUSPENDED: { label: '停止中',     className: 'badge-warning' },
  EXPIRED:   { label: '期限切れ',   className: 'badge-danger' },
  CANCELLED: { label: 'キャンセル', className: 'badge-danger' },
}

// ─── シフトステータス ─────────────────────────
export const SCHEDULE_STATUS: Record<string, StatusDef> = {
  DRAFT:     { label: '下書き',     className: 'badge-gray' },
  ASSIGNED:  { label: '配員済み',   className: 'badge-info' },
  CONFIRMED: { label: '確認済み',   className: 'badge-success' },
  CANCELLED: { label: 'キャンセル', className: 'badge-danger' },
}

// ─── 日払いステータス ─────────────────────────
export const DAILY_PAY_STATUS: Record<string, StatusDef> = {
  PENDING:  { label: '申請中',   className: 'badge-warning' },
  APPROVED: { label: '承認済み', className: 'badge-info' },
  PAID:     { label: '支払済み', className: 'badge-success' },
  REJECTED: { label: '否認',     className: 'badge-danger' },
  DEDUCTED: { label: '差引済み', className: 'badge-gray' },
}

// ─── 給与ステータス ───────────────────────────
export const PAYROLL_STATUS: Record<string, StatusDef> = {
  DRAFT:     { label: '未入力',   className: 'bg-gray-100 text-gray-600' },
  IN_REVIEW: { label: '確認中',   className: 'bg-yellow-100 text-yellow-700' },
  CONFIRMED: { label: '確認済み', className: 'bg-blue-100 text-blue-700' },
  PAID:      { label: '支払済み', className: 'bg-green-100 text-green-700' },
}

// ─── 請求書ステータス ─────────────────────────
export const INVOICE_STATUS: Record<string, StatusDef> = {
  DRAFT:     { label: '下書き',     className: 'badge-gray' },
  SENT:      { label: '送付済み',   className: 'badge-info' },
  PAID:      { label: '入金済み',   className: 'badge-success' },
  OVERDUE:   { label: '期限超過',   className: 'badge-danger' },
  CANCELLED: { label: 'キャンセル', className: 'badge-danger' },
}

// ─── 支払管理ステータス ───────────────────────
export const SUBPAY_STATUS: Record<string, StatusDef> = {
  PENDING:  { label: '未受領',   className: 'bg-gray-100 text-gray-600' },
  RECEIVED: { label: '受領済み', className: 'bg-yellow-100 text-yellow-700' },
  PAID:     { label: '支払済み', className: 'bg-green-100 text-green-700' },
}
export const SUBPAY_NEXT_STATUS: Record<string, string> = {
  PENDING: 'RECEIVED',
  RECEIVED: 'PAID',
}

// ─── 雇用形態 ─────────────────────────────────
export const EMPLOYMENT_TYPE: Record<string, string> = {
  FULL_TIME: '正社員',
  PART_TIME: 'アルバイト',
  CONTRACT:  '契約社員',
  DISPATCH:  '派遣',
}

// ─── 性別 ─────────────────────────────────────
export const GENDER: Record<string, string> = {
  MALE:   '男性',
  FEMALE: '女性',
  OTHER:  'その他',
}

// ─── 給与形態 ─────────────────────────────────
export const PAY_TYPE = [
  { value: 'DAY',   label: '日給' },
  { value: 'MONTH', label: '月給' },
  { value: 'HOUR',  label: '時給' },
] as const

// ─── 協力会社タイプ ───────────────────────────
export const PARTNER_TYPE: Record<string, { label: string; className: string; desc: string }> = {
  GROUP:     { label: 'グループ会社',   className: 'badge-success', desc: '最優先で人員融通' },
  PREFERRED: { label: '優先協力会社',   className: 'badge-info',    desc: '次優先で人員融通' },
  GENERAL:   { label: '一般協力会社',   className: 'badge-gray',    desc: '通常の協力会社' },
}

// ─── 通知タイプ ───────────────────────────────
export const NOTIFICATION_TYPE: Record<string, { label: string; icon: string; color: string }> = {
  SCHEDULE_REMINDER:   { label: 'シフト確認',   icon: '📅', color: 'badge-blue' },
  DAILY_PAY_PROCESSED: { label: '日払い処理',   icon: '💴', color: 'badge-success' },
  INVOICE_SENT:        { label: '請求書送付',   icon: '📄', color: 'badge-warning' },
  GENERAL:             { label: 'お知らせ',     icon: '🔔', color: 'badge-gray' },
}

// ─── 取引先カテゴリ ───────────────────────────
export const CLIENT_CATEGORY: Record<string, { label: string; color: string }> = {
  GOVERNMENT:   { label: '官公庁',     color: 'bg-purple-100 text-purple-700' },
  PRIVATE:      { label: '民間企業',   color: 'bg-blue-100 text-blue-700' },
  CONSTRUCTION: { label: '建設・工事', color: 'bg-orange-100 text-orange-700' },
  COMMERCIAL:   { label: '商業施設',   color: 'bg-green-100 text-green-700' },
  INDIVIDUAL:   { label: '個人',       color: 'bg-gray-100 text-gray-600' },
  OTHER:        { label: 'その他',     color: 'bg-gray-100 text-gray-500' },
}

// ─── 隊員クラス ───────────────────────────────
export const GUARD_CLASSES = ['S', 'A', 'B', 'C'] as const

// ─── スキル選択肢 ─────────────────────────────
export const SKILL_OPTIONS = [
  '隊長', '方交', '交通誘導', '施設警備', '雑踏警備', '身辺警護', '運搬警備',
] as const

// ─── サブスクリプションステータス ─────────────
export const SUBSCRIPTION_STATUS: Record<string, StatusDef> = {
  TRIAL:     { label: 'トライアル', className: 'bg-blue-100 text-blue-700' },
  ACTIVE:    { label: '有効',       className: 'bg-green-100 text-green-700' },
  PAST_DUE:  { label: '支払遅延',   className: 'bg-yellow-100 text-yellow-700' },
  SUSPENDED: { label: '停止中',     className: 'bg-red-100 text-red-700' },
  CANCELLED: { label: '解約済み',   className: 'bg-gray-100 text-gray-500' },
}

// ─── 課金プランタイプ ─────────────────────────
export const PLAN_TYPE: Record<string, { label: string; price: string }> = {
  STARTER:    { label: 'スターター',         price: '¥9,800/月' },
  STANDARD:   { label: 'スタンダード',       price: '¥29,800/月' },
  ENTERPRISE: { label: 'エンタープライズ',   price: '¥49,800/月' },
}

// ─── 請求ログタイプ ───────────────────────────
export const BILLING_LOG_TYPE: Record<string, string> = {
  PAYMENT_LINK_SENT:      'Payment Link送付',
  PAYMENT_SUCCEEDED:      '支払い成功',
  PAYMENT_FAILED:         '支払い失敗',
  SUBSCRIPTION_CREATED:   'サブスクリプション作成',
  SUBSCRIPTION_UPDATED:   'サブスクリプション更新',
  SUBSCRIPTION_CANCELLED: 'サブスクリプション解約',
  MANUAL_SUSPEND:         '手動停止',
  MANUAL_REACTIVATE:      '手動再開',
  AUTO_SUSPEND:           '自動停止',
  REMINDER_SENT:          'リマインド送付',
}

// ─── 都道府県 ─────────────────────────────────
export const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
] as const
