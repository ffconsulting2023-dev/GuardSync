// データ取り込み（CSV・Excel・Googleスプレッドシート）SSOT
// 取り込み種別・列定義・値の解釈・名寄せのルールをここに集約し、server/import.ts と画面の双方が参照する。

export const IMPORT_KINDS = {
  companyInsurance: { label: '社保・雇用保険情報（会社）', hint: '「社保・雇用保険情報」シート' },
  clients: { label: '契約情報（取引先）', hint: '「契約単価(建設」シート' },
  partners: { label: '契約情報（協力会社・警備会社）', hint: '「契約単価(警備」シート' },
  guards: { label: '隊員情報', hint: '「隊員名簿」シート' },
  siteRequests: { label: '現場情報・配員実績', hint: '「現場管理」シート' },
} as const
export type ImportKind = keyof typeof IMPORT_KINDS
// 依存関係の順（取引先・協力会社・隊員 → 現場管理の名寄せ）
export const IMPORT_ORDER: ImportKind[] = ['companyInsurance', 'clients', 'partners', 'guards', 'siteRequests']
export type TableImportKind = Exclude<ImportKind, 'companyInsurance'>

export interface FieldDef {
  key: string
  label: string
  aliases: string[]        // 見出しの表記ゆれ（normalizeHeader 後に前方一致で照合）
  required?: boolean
}

const f = (key: string, label: string, aliases: string[], required = false): FieldDef => ({ key, label, aliases: [label, ...aliases], required })

// 契約単価（取引先・協力会社で共通の列）
const RATE_FIELDS: FieldDef[] = [
  f('contractDate', '契約締結日', ['契約日']),
  f('contractMethod', '契約方法', []),
  f('unitPriceDay', '日勤', ['日勤単価']),
  f('overtimeDayRate', '日勤：時間外', ['日勤時間外']),
  f('unitPriceNight', '夜勤', ['夜勤単価']),
  f('overtimeNightRate', '夜勤：時間外', ['夜勤時間外']),
  f('unitPriceHolidayDay', '土日日勤', ['休日日勤']),
  f('overtimeHolidayDayRate', '土日：時間外', ['土日時間外', '休日時間外']),
  f('unitPriceHolidayNight', '土日夜勤', ['休日夜勤']),
  f('overtimeHolidayNightRate', '土日夜：時間外', ['土日夜時間外', '休日夜時間外']),
  f('qualificationAllowance', '資格者', ['資格者手当', '資格手当']),
  f('seasonalAllowance', '季節', ['季節手当']),
  f('nominationAllowance', '指名', ['指名料']),
]

export const IMPORT_FIELDS: Record<TableImportKind, FieldDef[]> = {
  clients: [
    f('name', '会社名', ['取引先名', '依頼主'], true),
    ...RATE_FIELDS,
    f('website', 'HP', ['ホームページ', 'URL']),
    f('contact', '連絡先', ['メールアドレス', 'メアド']),
    f('contactName', '担当', ['担当者']),
    f('notes', '備考', []),
  ],
  partners: [
    f('name', '会社名', ['協力会社名'], true),
    ...RATE_FIELDS,
    f('phone', '電話', ['電話番号', 'TEL']),
    f('address', '住所', ['所在地']),
    f('contactName', '担当', ['担当者']),
    f('email', 'メアド', ['メールアドレス', 'メール']),
    f('website', 'HP', ['ホームページ', 'URL']),
    f('notes', '備考', []),
  ],
  guards: [
    f('name', '名前', ['氏名'], true),
    f('nameKana', 'ふりがな', ['フリガナ', 'カナ']),
    f('birthDate', '生年月日', []),
    f('employmentType', '契約形態', ['雇用形態']),
    f('address', '現住所', ['住所']),
    f('nearestStation', '最寄駅', []),
    f('myNumber', 'マイナンバー', ['個人番号']),
    f('employmentInsuranceNumber', '雇用保険番号', ['雇用保険']),
    f('pensionNumber', '社保番号', ['基礎年金番号', '社会保険番号']),
    f('certifications', '資格', ['保有資格']),
    f('dependents', '扶養人数', ['扶養']),
    f('bankName', '銀行', ['銀行名', '金融機関']),
    f('bankBranch', '支店', ['支店名']),
    f('bankCode', '銀行コード', ['金融機関コード']),
    f('branchCode', '支店コード', []),
    f('accountNumber', '口座番号', []),
    f('accountHolder', '受取名', ['口座名義', '名義']),
    f('dayShiftRate', '日勤：単価', ['日勤単価']),
    f('nightShiftRate', '夜勤：単価', ['夜勤単価']),
    f('email', 'メールアドレス', ['メール', 'メアド']),
    f('dormitory', '寮利用', ['寮']),
    f('commuteNotes', '交通費', []),
    f('notes', '備考', []),
  ],
  siteRequests: [
    f('no', 'NO.', ['No', '番号']),
    f('client', '依頼主', ['取引先'], true),
    f('siteName', '現場名', [], true),
    f('nearestStation', '最寄駅', []),
    f('unitPrice', '依頼単価', ['単価']),
    f('transportFee', '交通費単価', ['交通費']),
    f('year', '依頼年', []),
    f('month', '依頼月', []),
    f('days', '依頼期間', []),
    f('date', '年月日', ['日付']),
    f('time', '時間', ['勤務時間']),
    f('qualifiedFlag', '資格者有無', []),
    f('requestedCount', '依頼人数', ['人数']),
    f('qualifiedCount', 'うち資格者', ['資格者数']),
    f('dispatcher1', '派遣者1', []),
    f('dispatcher2', '派遣者2', []),
    f('dispatcher3', '派遣者3', []),
    f('dispatcher4', '派遣者4', []),
    f('dispatcher5', '派遣者5', []),
    f('overtimeRate', '残業単価', []),
    f('overtimeHours', '残業時間', []),
    f('overtimeCount', '残業人数', []),
    f('subcontractor', '再委託先', []),
    f('subcontractUnitPrice', '再委託単価', []),
    f('workDays', '稼働日数', []),
    f('sheetBillingPerDay', '請求額/日', ['請求額']),
    f('notes', '備考', []),
  ],
}
export const DISPATCHER_KEYS = ['dispatcher1', 'dispatcher2', 'dispatcher3', 'dispatcher4', 'dispatcher5'] as const

// 資格欄の表記 → 隊員の保有資格（GuardsPage のチェックボックスと同じ名称）
export const CERTIFICATION_ALIASES: Record<string, string> = {
  '1級': '交通誘導警備業務検定1級',
  '2級': '交通誘導警備業務検定2級',
  '交通1級': '交通誘導警備業務検定1級',
  '交通2級': '交通誘導警備業務検定2級',
  '施設1級': '施設警備業務検定1級',
  '施設2級': '施設警備業務検定2級',
  '雑踏1級': '雑踏警備業務検定1級',
  '雑踏2級': '雑踏警備業務検定2級',
}
export const NO_CERTIFICATION_WORDS = ['なし', '無し', '資格なし', '無', '-', '－']

export const EMPLOYMENT_TYPE_ALIASES: Record<string, string> = {
  '役員': 'EXECUTIVE',
  '正社員': 'FULL_TIME',
  '社員': 'FULL_TIME',
  'アルバイト': 'PART_TIME',
  'パート': 'PART_TIME',
  '契約社員': 'CONTRACT',
  '派遣': 'DISPATCH',
}

// ─────────────────────────────────────────────
// 取り込みの指示・結果（server/import.ts と画面で共通の型）
// ─────────────────────────────────────────────

// 名寄せの指示（画面で利用者が確定する）
export type Resolution =
  | { action: 'client'; id: string }
  | { action: 'partner'; id: string }
  | { action: 'guard'; id: string }
  | { action: 'newClient'; name?: string }   // name: 作成する取引先名（省略時は表記のまま）
  | { action: 'clientFromPartner'; id: string } // 協力会社の情報で取引先を作る（警備会社からの依頼）
  | { action: 'newGuard' }
  | { action: 'newPartner'; name?: string }  // name: 作成する協力会社名（同名はまとめて1社）
  | { action: 'skip' }

export interface ImportRequest {
  kind: ImportKind
  sourceName: string
  rows: string[][]
  headerRow: number
  mapping: Record<string, number>
  clientResolutions?: Record<string, Resolution>   // 依頼主名 → 指示
  peopleResolutions?: Record<string, Resolution>   // 派遣者名・再委託先名 → 指示
  siteClientOverrides?: Record<string, Resolution>  // siteOverrideKey(依頼主, 現場名) → 現場ごとの取引先（同じ依頼主名でも契約が分かれる場合）
}
export const siteOverrideKey = (clientName: string, siteName: string) => `${clientName}\u0001${siteName}`
export interface SiteEntry { key: string; clientName: string; siteName: string; count: number; resolution: Resolution; overridden: boolean; existing: boolean }

export interface RowIssue { row: number; level: 'error' | 'warning'; message: string }
export interface NameCandidate { kind: 'client' | 'partner' | 'guard'; id: string; name: string; score: number }
export interface NameEntry {
  name: string
  count: number
  resolution: Resolution
  auto: 'exact' | 'suggested' | 'default' | 'manual'
  candidates: NameCandidate[]
}
export interface ImportResult {
  kind: ImportKind
  committed: boolean
  summary: Record<string, number>
  issues: RowIssue[]
  changes: { row: number; action: 'create' | 'update' | 'skip'; label: string; detail?: string }[]
  clientNames?: NameEntry[]
  peopleNames?: NameEntry[]
  sites?: SiteEntry[]
  insurance?: { key: string; label: string; current: string | null; next: string }[]
  batchId?: string
}

// ─────────────────────────────────────────────
// 見出しの判定
// ─────────────────────────────────────────────

export const normalizeHeader = (s: string) =>
  (s ?? '').normalize('NFKC').replace(/[\s\n\r]/g, '').replace(/[()（）:：]/g, '').toLowerCase()

// 見出しセル → 項目キー（最も長く一致した別名を採用）
export function autoMapColumns(headers: string[], kind: TableImportKind): Record<string, number> {
  const mapping: Record<string, number> = {}
  const used = new Set<number>()
  const candidates: { key: string; col: number; score: number }[] = []
  headers.forEach((h, col) => {
    const nh = normalizeHeader(h)
    if (!nh) return
    for (const def of IMPORT_FIELDS[kind]) {
      for (const a of def.aliases) {
        const na = normalizeHeader(a)
        if (nh === na) candidates.push({ key: def.key, col, score: 1000 + na.length })
        else if (nh.startsWith(na)) candidates.push({ key: def.key, col, score: na.length })
      }
    }
  })
  candidates.sort((a, b) => b.score - a.score || a.col - b.col)
  for (const c of candidates) {
    if (c.key in mapping || used.has(c.col)) continue
    mapping[c.key] = c.col
    used.add(c.col)
  }
  return mapping
}

// シートの先頭から見出し行と種別を推定する（社保シートは見出しの無い箇条書きなので別判定）
export function detectSheet(rows: string[][]): { kind: ImportKind; headerRow: number } | null {
  const text = rows.slice(0, 5).map(r => r.join('')).join('')
  if (/社保|雇用保険/.test(text) && rows.every(r => r.filter(Boolean).length <= 2)) {
    return { kind: 'companyInsurance', headerRow: -1 }
  }
  // 一致した列が多い種別を優先（取引先と協力会社は列がほぼ同じため、割合ではなく件数で比べる）。
  // 半分以上の項目が一致しないシート（集計・給与用の派生シート等）は対象外とする
  let best: { kind: TableImportKind; headerRow: number; matched: number; ratio: number } | null = null
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    for (const kind of Object.keys(IMPORT_FIELDS) as TableImportKind[]) {
      const m = autoMapColumns(rows[r], kind)
      const required = IMPORT_FIELDS[kind].filter(d => d.required)
      if (!required.every(d => d.key in m)) continue
      const matched = Object.keys(m).length
      const ratio = matched / IMPORT_FIELDS[kind].length
      if (ratio < 0.5) continue
      if (!best || matched > best.matched || (matched === best.matched && ratio > best.ratio)) best = { kind, headerRow: r, matched, ratio }
    }
  }
  return best && { kind: best.kind, headerRow: best.headerRow }
}

// ─────────────────────────────────────────────
// 値の解釈
// ─────────────────────────────────────────────

export const cleanText = (v: unknown) => (v == null ? '' : String(v)).replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').trim()

// "18,000" "¥18,000" "18000円" → 18000。空欄は null、数値でなければ NaN
export function parseYen(v: unknown): number | null {
  const s = cleanText(v).normalize('NFKC').replace(/[,¥￥円\s]/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : NaN
}

export function parseNumber(v: unknown): number | null {
  const s = cleanText(v).normalize('NFKC').replace(/[,\s人名hH時間]/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

const ERAS: Record<string, number> = { 明治: 1867, 大正: 1911, 昭和: 1925, 平成: 1988, 令和: 2018 }
const pad = (n: number) => String(n).padStart(2, '0')
function ymd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

// "2026-08-01" "2026/8/1" "2026年8月1日" "昭和42年3月30日" → "YYYY-MM-DD"。空欄は null、解釈不能は undefined
export function parseDate(v: unknown): string | null | undefined {
  const s = cleanText(v).normalize('NFKC')
  if (!s) return null
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/)
  if (m) return ymd(+m[1], +m[2], +m[3]) ?? undefined
  m = s.match(/^(明治|大正|昭和|平成|令和)(\d{1,2}|元)年(\d{1,2})月(\d{1,2})日$/)
  if (m) return ymd(ERAS[m[1]] + (m[2] === '元' ? 1 : +m[2]), +m[3], +m[4]) ?? undefined
  return undefined
}

// "8:30〜17:30" "19:00～04:00" → 開始・終了。巡回など時刻の無い表記は start/end 空で label に保持
export function parseTimeRange(v: unknown): { start: string; end: string; shiftType: 'DAY' | 'NIGHT'; label: string } {
  const label = cleanText(v)
  const s = label.normalize('NFKC').replace(/[〜～~ー−-]/g, '~')
  const m = s.match(/(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})/)
  if (!m) return { start: '', end: '', shiftType: 'DAY', label }
  const start = `${pad(+m[1])}:${m[2]}`
  const end = `${pad(+m[3])}:${m[4]}`
  const night = +m[1] >= 17 || +m[3] < +m[1]
  return { start, end, shiftType: night ? 'NIGHT' : 'DAY', label }
}

export const hiraganaToKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))

// ─────────────────────────────────────────────
// 名寄せ
// ─────────────────────────────────────────────

// 人名: 空白・全角半角の違いを無視
export const normalizePersonName = (s: string) => cleanText(s).normalize('NFKC').replace(/\s/g, '').toLowerCase()

// 会社名: 法人格・空白・記号・全角半角・大文字小文字の違いを無視し、セル内2行目以降（注記）は除く
export function normalizeCompanyName(s: string): string {
  return cleanText(s).split('\n')[0].normalize('NFKC')
    .replace(/株式会社|有限会社|合同会社|一般社団法人|\(株\)|\(有\)|\(同\)|㈱|㈲/g, '')
    .replace(/[\s・_\-－.,()（）「」]/g, '')
    .toLowerCase()
}

// 会社名セルの1行目を正式名、2行目以降を注記として分ける
export function splitNameAndNote(v: unknown): { name: string; note: string } {
  const lines = cleanText(v).split('\n').map(l => l.trim()).filter(Boolean)
  return { name: (lines[0] ?? '').replace(/\s+/g, ' '), note: lines.slice(1).join('\n') }
}

// 編集距離による類似度（0〜1）
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return 1 - dp[a.length][b.length] / Math.max(a.length, b.length)
}

// 敬称・予定などの添え書きを除く（「○○さん予定」→「○○」）
export const stripNameDecorations = (s: string) =>
  s.replace(/[（(]?予定[）)]?$/, '').replace(/(さん|様|さま|氏|殿|くん|君)$/, '')

// 名寄せの候補判定: 完全一致 > 前方・包含一致 > 類似（0.6以上）
export function matchScore(source: string, target: string): number {
  if (!source || !target) return 0
  if (source === target) return 1
  if (target.startsWith(source) || source.startsWith(target)) return 0.9
  if (target.includes(source) || source.includes(target)) return 0.8
  const s = similarity(source, target)
  return s >= 0.6 ? s * 0.75 : 0
}

// ─────────────────────────────────────────────
// マイナンバー（個人番号）の検査用数字
// ─────────────────────────────────────────────

export function isValidMyNumber(v: string): boolean {
  if (!/^\d{12}$/.test(v)) return false
  const digits = v.split('').map(Number)
  const check = digits[11]
  let sum = 0
  for (let n = 1; n <= 11; n++) {
    const p = digits[11 - n] // 検査用数字を除いた下位から n 桁目
    const q = n <= 6 ? n + 1 : n - 5
    sum += p * q
  }
  const r = sum % 11
  return check === (r <= 1 ? 0 : 11 - r)
}

// ─────────────────────────────────────────────
// 社保・雇用保険（会社）: 見出しの無い箇条書きを項目に分解する
// ─────────────────────────────────────────────

export const COMPANY_INSURANCE_FIELDS = {
  socialInsuranceOfficeSymbol: '社会保険 事業所整理記号',
  socialInsuranceOfficeNumber: '社会保険 事業所番号',
  healthInsuranceNumber: '健康保険 番号',
  employmentInsuranceOfficeNumber: '雇用保険 適用事業所番号',
  employmentInsuranceJurisdiction: '雇用保険 管轄区分',
  laborInsuranceNumber: '労働保険番号',
  laborInsuranceEstablishmentType: '労働保険 設置区分',
  industryClassification: '産業分類',
} as const
export type CompanyInsuranceKey = keyof typeof COMPANY_INSURANCE_FIELDS

export function parseCompanyInsurance(lines: string[]): { values: Partial<Record<CompanyInsuranceKey, string>>; unparsed: string[] } {
  const items = lines.map(l => cleanText(l)).filter(Boolean)
  const values: Partial<Record<CompanyInsuranceKey, string>> = {}
  const unparsed: string[] = []
  let section = ''
  let pending: CompanyInsuranceKey | null = null
  const set = (key: CompanyInsuranceKey, v: string) => { values[key] = values[key] ? `${values[key]} ${v}` : v }

  const keyFor = (label: string): CompanyInsuranceKey | null => {
    const l = label.normalize('NFKC')
    if (/整理(番号|記号)/.test(l)) return 'socialInsuranceOfficeSymbol'
    if (/事業所番号/.test(l)) return section === 'employment' ? 'employmentInsuranceOfficeNumber' : 'socialInsuranceOfficeNumber'
    if (/管轄区分/.test(l)) return 'employmentInsuranceJurisdiction'
    if (/労働保険番号/.test(l)) return 'laborInsuranceNumber'
    if (/設置区分/.test(l)) return 'laborInsuranceEstablishmentType'
    if (/産業分類/.test(l)) return 'industryClassification'
    return null
  }

  for (const raw of items) {
    // 「◾️」は絵文字の異体字セレクタ（U+FE0F）付きで入力されることがあるため一緒に除く
    const line = raw.normalize('NFKC').replace(/^[◾■□◆●・【\uFE0F\s]+/, '').replace(/】$/, '').trim()
    if (/^社保・雇用保険$/.test(line)) continue
    if (/^社保$|^社会保険$/.test(line)) { section = 'social'; pending = null; continue }
    if (/^健康保険$/.test(line)) { section = 'health'; pending = 'healthInsuranceNumber'; continue }
    if (/^雇用保険$/.test(line)) { section = 'employment'; pending = null; continue }

    const kv = line.match(/^([^:]+):\s*(.*)$/)
    if (kv) {
      const key = keyFor(kv[1])
      if (key) {
        if (kv[2]) set(key, kv[2])
        pending = kv[2] ? (key === 'socialInsuranceOfficeSymbol' ? key : null) : key
        continue
      }
    }
    const labelOnly = keyFor(line)
    if (labelOnly && !/\d/.test(line.replace(/\(.*\)?$/, '').replace(/^\D+/, ''))) {
      pending = labelOnly
      // 「設置区分（当然」のように見出しに補足が付く場合は値の後ろに添える
      const note = line.match(/[（(]([^）)]+)[）)]?$/)
      if (note) (values as any).__note = note[1]
      continue
    }
    if (pending) {
      const note = (values as any).__note
      delete (values as any).__note
      set(pending, note ? `${line}（${note}）` : line)
      // 整理記号は2行に分かれて書かれることがあるため続けて受ける
      if (pending !== 'socialInsuranceOfficeSymbol') pending = null
      continue
    }
    unparsed.push(raw)
  }
  delete (values as any).__note
  return { values, unparsed }
}
