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
})
export type SignatureInput = z.infer<typeof signatureInputSchema>

export function reportStatus(r: { approvedAt?: unknown; signedAt?: unknown }): keyof typeof REPORT_STATUS {
  return r.approvedAt ? 'APPROVED' : r.signedAt ? 'SIGNED' : 'DRAFT_UNSIGNED'
}
