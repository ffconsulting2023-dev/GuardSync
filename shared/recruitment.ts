// 採用経路 SSOT（隊員の採用経路の選択肢と表示。server.ts・server/import.ts・画面が参照する）
// 選択肢は 3 種類: 媒体（会社ごとのマスタ）／人材紹介会社（取引先の種別が人材紹介会社のもの）／その他（自由記入）

// 会社のマスタが空のときに用意する媒体
export const DEFAULT_RECRUITMENT_CHANNELS = ['Indeed', 'ギガバイト'] as const

// 取引先の種別（Prisma enum ClientCategory）のうち、人材紹介会社として採用経路に出すもの
export const RECRUITMENT_AGENCY_CATEGORY = 'RECRUITMENT' as const

export interface GuardRecruitment {
  recruitmentChannelId?: string | null
  recruitmentAgencyId?: string | null
  recruitmentNote?: string | null
  recruitmentChannel?: { name: string } | null
  recruitmentAgency?: { name: string } | null
}

// 画面の選択値 <-> 隊員の項目
export type RecruitmentSelectValue = '' | 'free' | `channel:${string}` | `agency:${string}`
export function recruitmentToSelect(g: GuardRecruitment): RecruitmentSelectValue {
  if (g.recruitmentChannelId) return `channel:${g.recruitmentChannelId}`
  if (g.recruitmentAgencyId) return `agency:${g.recruitmentAgencyId}`
  return g.recruitmentNote ? 'free' : ''
}
export function selectToRecruitment(v: RecruitmentSelectValue): { recruitmentChannelId: string | null; recruitmentAgencyId: string | null } {
  return {
    recruitmentChannelId: v.startsWith('channel:') ? v.slice(8) : null,
    recruitmentAgencyId: v.startsWith('agency:') ? v.slice(7) : null,
  }
}

// 一覧などに出す表記（例: 「Indeed」「人材紹介: ○○株式会社」「その他: 知人の紹介」）
export function recruitmentLabel(g: GuardRecruitment): string {
  const detail = g.recruitmentNote?.trim()
  if (g.recruitmentChannel) return detail ? `${g.recruitmentChannel.name}（${detail}）` : g.recruitmentChannel.name
  if (g.recruitmentAgency) return detail ? `人材紹介: ${g.recruitmentAgency.name}（${detail}）` : `人材紹介: ${g.recruitmentAgency.name}`
  return detail ? `その他: ${detail}` : ''
}

// ─────────────────────────────────────────────
// 人材紹介会社への紹介料（採用経路別の稼働実績から算出）
// ─────────────────────────────────────────────

// 何を「1勤務」と数えるか
export const FEE_BASIS = {
  SCHEDULE: '配員（中止を除く）',
  ATTENDANCE: '出勤打刻あり',
} as const
export type FeeBasis = keyof typeof FEE_BASIS

export const CONSUMPTION_TAX_RATE = 0.1

// 紹介料の単価ルール（人材紹介会社ごと。適用開始日の異なるルールを重ねて単価の改定を表す）
export interface FeeRule {
  id: string
  agencyId: string
  effectiveFrom: string        // YYYY-MM-DD
  effectiveTo: string | null   // YYYY-MM-DD（空なら終了なし）
  amountPerShift: number       // 1勤務あたり（税別）
  nightAmountPerShift: number | null // 夜勤1勤務あたり（空なら amountPerShift）
  maxMonthsFromHire: number | null   // 入社（初回勤務）から何か月までの勤務を対象にするか（空なら期限なし）
  basis: FeeBasis
}

export interface WorkShift {
  guardId: string
  date: string          // YYYY-MM-DD
  shiftType: string     // DAY / NIGHT ...
  clockedIn: boolean
}

// その日に適用されるルール（適用期間内で適用開始日が最も新しいもの）
export function ruleForDate(rules: FeeRule[], date: string): FeeRule | null {
  return rules
    .filter(r => r.effectiveFrom <= date && (!r.effectiveTo || r.effectiveTo >= date))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null
}

// 入社日から n か月の期間の末日（YYYY-MM-DD・この日を含む）。民法143条: 応当日の前日、応当日が無い月はその月の末日
export function periodEnd(start: string, months: number): string {
  const d = new Date(`${start}T00:00:00Z`)
  const day = d.getUTCDate()
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  if (day > lastDay) return new Date(Date.UTC(y, m, lastDay)).toISOString().slice(0, 10)
  return new Date(Date.UTC(y, m, day - 1)).toISOString().slice(0, 10)
}

export interface ShiftFee { shift: WorkShift; fee: number; rule: FeeRule | null; reason?: string }

// 1勤務ごとの紹介料。hireDate は入社日（無ければ初回勤務日）
export function shiftFee(shift: WorkShift, rules: FeeRule[], hireDate: string | null): ShiftFee {
  const rule = ruleForDate(rules, shift.date)
  if (!rule) return { shift, fee: 0, rule: null, reason: '単価ルールの適用期間外' }
  if (rule.basis === 'ATTENDANCE' && !shift.clockedIn) return { shift, fee: 0, rule, reason: '出勤打刻なし' }
  if (rule.maxMonthsFromHire != null && hireDate && shift.date > periodEnd(hireDate, rule.maxMonthsFromHire)) {
    return { shift, fee: 0, rule, reason: `入社から${rule.maxMonthsFromHire}か月を超えた勤務` }
  }
  const night = shift.shiftType === 'NIGHT' && rule.nightAmountPerShift != null
  return { shift, fee: night ? rule.nightAmountPerShift! : rule.amountPerShift, rule }
}

export const withTax = (amount: number) => Math.floor(amount * (1 + CONSUMPTION_TAX_RATE))
