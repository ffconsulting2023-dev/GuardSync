// アプリ共通の表示用定数。
// キーはバックエンド（prisma/schema.prisma）の enum 値と一致させること。
// ステータスは { label, className } の形で、className は index.css の .badge-* を指す。

export interface StatusMeta {
  label: string
  className: string
}

// ContractStatus: DRAFT | ACTIVE | SUSPENDED | EXPIRED | CANCELLED
export const CONTRACT_STATUS: Record<string, StatusMeta> = {
  DRAFT:     { label: '下書き',   className: 'badge-gray' },
  ACTIVE:    { label: '稼働中',   className: 'badge-success' },
  SUSPENDED: { label: '停止中',   className: 'badge-warning' },
  EXPIRED:   { label: '期限切れ', className: 'badge-danger' },
  CANCELLED: { label: '解約',     className: 'badge-gray' },
}

// InvoiceStatus: DRAFT | SENT | PAID | OVERDUE | CANCELLED
export const INVOICE_STATUS: Record<string, StatusMeta> = {
  DRAFT:     { label: '下書き',   className: 'badge-gray' },
  SENT:      { label: '送付済み', className: 'badge-info' },
  PAID:      { label: '入金済み', className: 'badge-success' },
  OVERDUE:   { label: '期限超過', className: 'badge-danger' },
  CANCELLED: { label: '取消',     className: 'badge-gray' },
}

// ScheduleStatus: DRAFT | ASSIGNED | CONFIRMED | CANCELLED
export const SCHEDULE_STATUS: Record<string, StatusMeta> = {
  DRAFT:     { label: '下書き',   className: 'badge-gray' },
  ASSIGNED:  { label: '配員済み', className: 'badge-info' },
  CONFIRMED: { label: '確認済み', className: 'badge-success' },
  CANCELLED: { label: 'キャンセル', className: 'badge-gray' },
}

// EmploymentType: FULL_TIME | PART_TIME | CONTRACT | DISPATCH
export const EMPLOYMENT_TYPE: Record<string, string> = {
  FULL_TIME: '正社員',
  PART_TIME: 'アルバイト・パート',
  CONTRACT:  '契約社員',
  DISPATCH:  '派遣',
}

// Gender: MALE | FEMALE | OTHER
export const GENDER: Record<string, string> = {
  MALE:   '男性',
  FEMALE: '女性',
  OTHER:  'その他',
}

// payType（String列, 既定 "DAY"）: DAY | MONTH | HOUR
export const PAY_TYPE: { value: string; label: string }[] = [
  { value: 'DAY',   label: '日給' },
  { value: 'MONTH', label: '月給' },
  { value: 'HOUR',  label: '時給' },
]

// guardClass（String列）: 社内クラス S/A/B/C
export const GUARD_CLASSES: string[] = ['S', 'A', 'B', 'C']

// 隊員スキル（skills: String[]）の選択肢
export const SKILL_OPTIONS: string[] = [
  '施設警備',
  '交通誘導',
  '雑踏警備',
  '身辺警備',
  '機械警備',
  '普通自動車免許',
  '上級救命講習',
  '英語対応',
  'パソコン操作',
]

// 都道府県
export const PREFECTURES: string[] = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
]
