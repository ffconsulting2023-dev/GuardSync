// ─────────────────────────────────────────────
// 共通定数（ラベル・選択肢・ステータス表示）
// Prisma の enum と対応
// ─────────────────────────────────────────────

// 雇用形態（enum EmploymentType）
export const EMPLOYMENT_TYPE: Record<string, string> = {
  FULL_TIME: '正社員',
  PART_TIME: 'アルバイト・パート',
  CONTRACT: '契約社員',
  DISPATCH: '派遣',
}

// 性別（enum Gender）
export const GENDER: Record<string, string> = {
  MALE: '男性',
  FEMALE: '女性',
  OTHER: 'その他',
}

// 給与形態
export const PAY_TYPE: { value: string; label: string }[] = [
  { value: 'DAY', label: '日給' },
  { value: 'MONTH', label: '月給' },
  { value: 'HOUR', label: '時給' },
]

// 警備員クラス（格付け）
export const GUARD_CLASSES: string[] = ['S', 'A', 'B', 'C', 'D']

// スキル・保有資格の選択肢
export const SKILL_OPTIONS: string[] = [
  '隊長',
  '副隊長',
  '交通誘導',
  '雑踏警備',
  '施設警備',
  '機械警備',
  '身辺警備',
  '貴重品運搬',
]

// 都道府県
export const PREFECTURES: string[] = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
]

// ステータス表示（ラベル + バッジ用クラス）
type StatusMeta = { label: string; className: string }

// スケジュール（enum ScheduleStatus）
export const SCHEDULE_STATUS: Record<string, StatusMeta> = {
  DRAFT: { label: '下書き', className: 'badge-gray' },
  ASSIGNED: { label: '配員済み', className: 'badge-info' },
  CONFIRMED: { label: '確認済み', className: 'badge-success' },
  CANCELLED: { label: 'キャンセル', className: 'badge-danger' },
}

// 契約（enum ContractStatus）
export const CONTRACT_STATUS: Record<string, StatusMeta> = {
  DRAFT: { label: '下書き', className: 'badge-gray' },
  ACTIVE: { label: '有効', className: 'badge-success' },
  SUSPENDED: { label: '停止', className: 'badge-warning' },
  EXPIRED: { label: '期限切れ', className: 'badge-danger' },
  CANCELLED: { label: '解約', className: 'badge-gray' },
}

// 請求書（enum InvoiceStatus）
export const INVOICE_STATUS: Record<string, StatusMeta> = {
  DRAFT: { label: '下書き', className: 'badge-gray' },
  SENT: { label: '送付済み', className: 'badge-info' },
  PAID: { label: '入金済み', className: 'badge-success' },
  OVERDUE: { label: '期限超過', className: 'badge-danger' },
  CANCELLED: { label: 'キャンセル', className: 'badge-gray' },
}
