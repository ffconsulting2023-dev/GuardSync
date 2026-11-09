// 現場依頼の状態（スプレッドシートの「稼働日数」: 1=稼働、0=中止、空欄=未確定）
export const SITE_REQUEST_STATUS = {
  CONFIRMED: '稼働',
  PLANNED: '予定',
  CANCELLED: '中止',
} as const
export type SiteRequestStatus = keyof typeof SITE_REQUEST_STATUS

// 現場依頼（受注実績）の請求見込み SSOT（スプレッドシート「現場管理」の計算式と同じ）
// 請求額/日 = (依頼単価 + 交通費) × 依頼人数 + 資格者手当 × 資格者数 + 残業単価 × 残業時間 × 残業人数
export interface BillableRequest {
  unitPrice: number | null
  transportFee: number | null
  requestedCount: number
  qualifiedCount: number
  overtimeRate: number | null
  overtimeHours: number | null
  overtimeCount: number | null
}

export function estimateRequestBilling(r: BillableRequest, qualificationAllowance: number | null | undefined): number {
  const base = ((r.unitPrice ?? 0) + (r.transportFee ?? 0)) * r.requestedCount
  const qualified = (qualificationAllowance ?? 0) * r.qualifiedCount
  const overtime = Math.round((r.overtimeRate ?? 0) * (r.overtimeHours ?? 0)) * (r.overtimeCount ?? 0)
  return base + qualified + overtime
}
