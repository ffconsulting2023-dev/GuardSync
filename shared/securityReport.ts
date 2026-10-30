// 警備報告書 SSOT: 項目定義・選択肢・検証をここに集約し、server.ts と画面の双方が参照する。
// 隊員・現場・報告日は SecurityReport の FK/列が正であり、content には重複して持たない。
import { z } from 'zod'

export const REPORT_WEATHER = ['晴れ', '曇り', '雨', '雪', '強風', '霧'] as const

export const REPORT_PATROL_RESULT = {
  NORMAL: '異常なし',
  ABNORMAL: '異常あり',
} as const
export type PatrolResult = keyof typeof REPORT_PATROL_RESULT

export const REPORT_STATUS = {
  DRAFT_UNSIGNED: '確認待ち',
  SIGNED: 'サイン済',
  APPROVED: '承認済',
} as const

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

export const patrolRecordSchema = z.object({
  time: hhmm,
  location: z.string().min(1).max(100),
  result: z.enum(['NORMAL', 'ABNORMAL']).default('NORMAL'),
  note: z.string().max(500).default(''),
})

export const reportContentSchema = z.object({
  weather: z.enum(REPORT_WEATHER).default('晴れ'),
  workStart: hhmm.optional(),   // 実働開始
  workEnd: hhmm.optional(),     // 実働終了
  breakMinutes: z.number().int().min(0).max(480).default(0),
  patrolRecords: z.array(patrolRecordSchema).max(100).default([]),
  hasIncident: z.boolean().default(false),
  incidents: z.string().max(3000).default(''),       // 異常・インシデントの内容と対応
  specialNotes: z.string().max(3000).default(''),    // 引き継ぎ・連絡事項
  // 顧客別項目。項目名(label)は作成時点のスナップショットとして保持し、帳票設定変更後も過去分を正しく表示する
  customFields: z.array(z.object({
    key: z.string().max(30),
    label: z.string().max(40),
    value: z.union([z.string().max(1000), z.number(), z.boolean()]),
  })).max(20).default([]),
})
export type ReportContent = z.infer<typeof reportContentSchema>

// 署名画像(PNG data URL)の上限: 約 400KB
export const SIGNATURE_MAX_LENGTH = 400_000
export const signatureInputSchema = z.object({
  signerName: z.string().min(1).max(50),
  signerTitle: z.string().max(50).optional(),
  signatureImage: z
    .string()
    .max(SIGNATURE_MAX_LENGTH)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
  // サイン取得場所（端末の位置情報。拒否・取得不可の場合は省略）
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
})
export type SignatureInput = z.infer<typeof signatureInputSchema>

export function reportStatus(r: { approvedAt?: unknown; signedAt?: unknown }): keyof typeof REPORT_STATUS {
  return r.approvedAt ? 'APPROVED' : r.signedAt ? 'SIGNED' : 'DRAFT_UNSIGNED'
}

// ─────────────────────────────────────────────
// 現場写真
// ─────────────────────────────────────────────
export const MAX_PHOTOS_PER_REPORT = 10
export const PHOTO_MAX_DATAURL_LENGTH = 800_000 // 端末側で縮小後の上限（約600KB）。10枚+署名でJSON上限10MBに収める
export const photoInputSchema = z.object({
  dataUrl: z.string().max(PHOTO_MAX_DATAURL_LENGTH).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/),
  caption: z.string().max(100).default(''),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
})
export type PhotoInput = z.infer<typeof photoInputSchema>

export function decodePhotoDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/)
  if (!m) throw new Error('invalid data url')
  return { mimeType: m[1], base64: m[2] }
}

// ─────────────────────────────────────────────
// 修正履歴
// ─────────────────────────────────────────────
export const REPORT_REVISION_ACTION = {
  CREATE: '作成',
  UPDATE: '修正',
  PHOTO_ADD: '写真追加',
  PHOTO_DELETE: '写真削除',
  SIGN: '現場監督サイン',
  APPROVE: '発注元承認',
  SHARE: '協力会社へ共有',
  SHARE_REVOKE: '共有取消',
} as const
export type ReportRevisionAction = keyof typeof REPORT_REVISION_ACTION

// 修正履歴に残す項目名（content のキー → 表示名）
export const REPORT_FIELD_LABEL: Record<string, string> = {
  reportDate: '報告日',
  weather: '天候',
  workStart: '実働開始',
  workEnd: '実働終了',
  breakMinutes: '休憩(分)',
  patrolRecords: '巡回記録',
  hasIncident: 'インシデント有無',
  incidents: '異常・インシデント',
  specialNotes: '引継・連絡事項',
  customFields: '顧客別項目',
}

// ─────────────────────────────────────────────
// 協力会社への共有
// ─────────────────────────────────────────────
export const shareInputSchema = z.object({
  partnerId: z.string().uuid(),
  expiresInDays: z.number().int().min(1).max(90).default(30),
})

// ─────────────────────────────────────────────
// 顧客別の帳票カスタマイズ（SecurityReportTemplate.settings の構造）
// ─────────────────────────────────────────────
export const REPORT_SECTION = {
  workTime: '勤務時間',
  patrol: '巡回記録',
  incident: '異常・インシデント',
  notes: '引継・連絡事項',
  photos: '現場写真',
} as const
export type ReportSection = keyof typeof REPORT_SECTION

export const CUSTOM_FIELD_TYPE = {
  text: '1行テキスト',
  textarea: '複数行テキスト',
  number: '数値',
  select: '選択肢',
  checkbox: 'チェック',
} as const
export type CustomFieldType = keyof typeof CUSTOM_FIELD_TYPE

export const customFieldDefSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/),
  label: z.string().min(1).max(40),
  type: z.enum(['text', 'textarea', 'number', 'select', 'checkbox']),
  options: z.array(z.string().min(1).max(40)).max(20).default([]),
  required: z.boolean().default(false),
})
export type CustomFieldDef = z.infer<typeof customFieldDefSchema>

export const reportTemplateSchema = z.object({
  title: z.string().min(1).max(40).default('警備報告書'),
  headerNote: z.string().max(300).default(''),
  footerNote: z.string().max(300).default(''),
  hiddenSections: z.array(z.enum(['workTime', 'patrol', 'incident', 'notes', 'photos'])).default([]),
  minPhotos: z.number().int().min(0).max(MAX_PHOTOS_PER_REPORT).default(0),
  customFields: z.array(customFieldDefSchema).max(20).default([])
    .refine(a => new Set(a.map(f => f.key)).size === a.length, { message: '項目キーが重複しています' }),
})
export type ReportTemplate = z.infer<typeof reportTemplateSchema>
export const DEFAULT_REPORT_TEMPLATE: ReportTemplate = reportTemplateSchema.parse({})

// 帳票設定に対する入力チェック（サーバー・画面で共通利用）
export function validateReportAgainstTemplate(
  content: ReportContent,
  template: ReportTemplate,
  photoCount: number,
): string[] {
  const errors: string[] = []
  const values = new Map(content.customFields.map(f => [f.key, f.value]))
  for (const def of template.customFields) {
    const v = values.get(def.key)
    const empty = v === undefined || v === '' || (def.type === 'checkbox' && v !== true)
    if (def.required && empty) errors.push(`「${def.label}」は必須です`)
    if (v === undefined || v === '') continue
    if (def.type === 'number' && typeof v !== 'number') errors.push(`「${def.label}」は数値で入力してください`)
    if (def.type === 'select' && !def.options.includes(String(v))) errors.push(`「${def.label}」の選択肢が不正です`)
    if (def.type === 'checkbox' && typeof v !== 'boolean') errors.push(`「${def.label}」が不正です`)
  }
  if (!template.hiddenSections.includes('photos') && photoCount < template.minPhotos) {
    errors.push(`現場写真を${template.minPhotos}枚以上添付してください`)
  }
  return errors
}
