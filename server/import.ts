// データ取り込みの本体（取り込み計画の作成 → プレビュー／確定）。
// 列定義・値の解釈・名寄せのルールは shared/import.ts が正（SSOT）。
// プレビューと確定は同じ計画関数を通し、確定時だけ書き込む（プレビューと結果がずれないようにするため）。
import { Prisma, PrismaClient } from '@prisma/client'
import {
  IMPORT_FIELDS, DISPATCHER_KEYS, CERTIFICATION_ALIASES, NO_CERTIFICATION_WORDS, EMPLOYMENT_TYPE_ALIASES,
  COMPANY_INSURANCE_FIELDS, cleanText, parseYen, parseNumber, parseDate, parseTimeRange, hiraganaToKatakana,
  normalizePersonName, normalizeCompanyName, splitNameAndNote, matchScore, isValidMyNumber, parseCompanyInsurance, stripNameDecorations,
  siteOverrideKey,
  type ImportKind, type CompanyInsuranceKey, type Resolution, type ImportRequest, type RowIssue, type NameCandidate, type NameEntry,
  type SiteEntry, type ImportResult,
} from '../shared/import'
export type { Resolution, ImportRequest, ImportResult }
import { estimateRequestBilling } from '../shared/siteRequest'

export interface ImportDeps {
  prisma: PrismaClient
  encrypt: (plain: string) => string
  canEncrypt: boolean // ENCRYPTION_KEY が設定されているか（未設定ならマイナンバーは取り込まない）
}
export interface ImportActor { userId: string; name: string }

class ImportError extends Error {}

const cell = (row: string[], mapping: Record<string, number>, key: string) =>
  mapping[key] === undefined ? '' : cleanText(row[mapping[key]])

// 金額・数値の列: 解釈できない値は警告して空として扱う
function money(row: string[], m: Record<string, number>, key: string, rowNo: number, issues: RowIssue[], label: string): number | null {
  const v = cell(row, m, key)
  const n = parseYen(v)
  if (Number.isNaN(n)) { issues.push({ row: rowNo, level: 'warning', message: `${label}「${v}」を金額として読めないため空にしました` }); return null }
  return n
}
function num(row: string[], m: Record<string, number>, key: string, rowNo: number, issues: RowIssue[], label: string): number | null {
  const v = cell(row, m, key)
  const n = parseNumber(v)
  if (Number.isNaN(n)) { issues.push({ row: rowNo, level: 'warning', message: `${label}「${v}」を数値として読めないため空にしました` }); return null }
  return n
}

// 空欄で既存の値を消さないよう、値のある項目だけ更新データにする
function present<T extends Record<string, unknown>>(data: T): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== '')) as Partial<T>
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const dataRows = (req: ImportRequest) =>
  req.rows.map((r, i) => ({ r, rowNo: i + 1 })).slice(req.headerRow + 1)

// ─────────────────────────────────────────────
// 会社の社保・雇用保険情報
// ─────────────────────────────────────────────
async function importCompanyInsurance(deps: ImportDeps, companyId: string, req: ImportRequest, commit: boolean): Promise<ImportResult> {
  const lines = req.rows.map(r => r.find(c => cleanText(c)) ?? '')
  const { values, unparsed } = parseCompanyInsurance(lines)
  const company = await deps.prisma.company.findUnique({ where: { id: companyId } })
  if (!company) throw new ImportError('会社が見つかりません')
  const insurance = (Object.keys(COMPANY_INSURANCE_FIELDS) as CompanyInsuranceKey[])
    .filter(k => values[k])
    .map(k => ({ key: k, label: COMPANY_INSURANCE_FIELDS[k], current: (company as any)[k] ?? null, next: values[k]! }))
  const issues: RowIssue[] = unparsed.map(u => ({ row: lines.indexOf(u) + 1, level: 'warning' as const, message: `読み取れなかった行: ${u}` }))
  if (!insurance.length) issues.push({ row: 0, level: 'error', message: '社保・雇用保険の項目が見つかりませんでした' })
  if (commit && insurance.length) {
    await deps.prisma.company.update({ where: { id: companyId }, data: Object.fromEntries(insurance.map(i => [i.key, i.next])) })
  }
  return {
    kind: 'companyInsurance', committed: commit, insurance, issues, changes: [],
    summary: { updated: insurance.filter(i => i.current !== i.next).length, unchanged: insurance.filter(i => i.current === i.next).length },
  }
}

// ─────────────────────────────────────────────
// 取引先・協力会社（契約単価）
// ─────────────────────────────────────────────
function rateData(row: string[], m: Record<string, number>, rowNo: number, issues: RowIssue[]) {
  const contractDateRaw = cell(row, m, 'contractDate')
  const contractDate = parseDate(contractDateRaw)
  if (contractDate === undefined) issues.push({ row: rowNo, level: 'warning', message: `契約締結日「${contractDateRaw}」を日付として読めないため空にしました` })
  const y = (key: string, label: string) => money(row, m, key, rowNo, issues, label)
  return {
    contractDate: contractDate ? new Date(`${contractDate}T00:00:00Z`) : null,
    contractMethod: cell(row, m, 'contractMethod') || null,
    unitPriceDay: y('unitPriceDay', '日勤'),
    overtimeDayRate: y('overtimeDayRate', '日勤：時間外'),
    unitPriceNight: y('unitPriceNight', '夜勤'),
    overtimeNightRate: y('overtimeNightRate', '夜勤：時間外'),
    unitPriceHolidayDay: y('unitPriceHolidayDay', '土日日勤'),
    overtimeHolidayDayRate: y('overtimeHolidayDayRate', '土日：時間外'),
    unitPriceHolidayNight: y('unitPriceHolidayNight', '土日夜勤'),
    overtimeHolidayNightRate: y('overtimeHolidayNightRate', '土日夜：時間外'),
    qualificationAllowance: y('qualificationAllowance', '資格者'),
    seasonalAllowance: y('seasonalAllowance', '季節'),
    nominationAllowance: y('nominationAllowance', '指名'),
  }
}

function joinNotes(...parts: (string | null | undefined)[]) {
  const s = parts.map(p => cleanText(p)).filter(Boolean).join('\n')
  return s || null
}

async function importCompanies(deps: ImportDeps, companyId: string, req: ImportRequest, commit: boolean, kind: 'clients' | 'partners'): Promise<ImportResult> {
  const m = req.mapping
  const issues: RowIssue[] = []
  const changes: ImportResult['changes'] = []
  const existing = kind === 'clients'
    ? await deps.prisma.client.findMany({ where: { companyId }, select: { id: true, name: true } })
    : await deps.prisma.partner.findMany({ where: { companyId }, select: { id: true, name: true } })
  const byNorm = new Map(existing.map(e => [normalizeCompanyName(e.name), e]))
  const seen = new Map<string, number>()
  const ops: ((tx: Prisma.TransactionClient) => Promise<unknown>)[] = []

  for (const { r, rowNo } of dataRows(req)) {
    const { name, note } = splitNameAndNote(cell(r, m, 'name'))
    if (!name) continue
    const norm = normalizeCompanyName(name)
    if (seen.has(norm)) {
      issues.push({ row: rowNo, level: 'error', message: `「${name}」は ${seen.get(norm)} 行目と同じ会社として扱われるため取り込みません（会社名を区別してください）` })
      continue
    }
    seen.set(norm, rowNo)
    const rates = rateData(r, m, rowNo, issues)
    const website = cell(r, m, 'website').match(/https?:\/\/\S+/)?.[0] ?? null
    const contactPerson = cell(r, m, 'contactName').split('\n')
    let data: Record<string, unknown>
    if (kind === 'clients') {
      const contact = cell(r, m, 'contact')
      const emails = contact.match(EMAIL_RE) ?? []
      const contactRest = contact.replace(EMAIL_RE, '').replace(/[↓\s]+/g, ' ').trim()
      data = {
        ...rates,
        website,
        email: emails[0]?.toLowerCase() ?? null,
        contactName: contactPerson[0] || null,
        notes: joinNotes(note, cell(r, m, 'notes'), emails.length > 1 ? `連絡先: ${emails.join(' / ')}` : '', contactRest && `連絡先メモ: ${contactRest}`, contactPerson.slice(1).join(' ')),
      }
    } else {
      const emails = cell(r, m, 'email').match(EMAIL_RE) ?? []
      data = {
        ...rates,
        website,
        email: emails[0]?.toLowerCase() ?? null,
        phone: cell(r, m, 'phone').normalize('NFKC') || null,
        address: cell(r, m, 'address') || null,
        contactName: contactPerson[0] || null,
        notes: joinNotes(note, cell(r, m, 'notes'), contactPerson.slice(1).join(' ')),
      }
    }
    const found = byNorm.get(norm)
    changes.push({ row: rowNo, action: found ? 'update' : 'create', label: found ? `${name}（既存: ${found.name}）` : name })
    if (!commit) continue
    if (kind === 'clients') {
      const category = /建設|工事|工務|造園|建築|電設/.test(name + req.sourceName) ? 'CONSTRUCTION' : 'OTHER'
      ops.push(tx => found
        ? tx.client.update({ where: { id: found.id }, data: present(data) as Prisma.ClientUpdateInput })
        : tx.client.create({ data: { companyId, name, relationship: '依頼主', category, ...present(data) } as Prisma.ClientUncheckedCreateInput }))
    } else {
      ops.push(tx => found
        ? tx.partner.update({ where: { id: found.id }, data: present(data) as Prisma.PartnerUpdateInput })
        : tx.partner.create({ data: { companyId, name, ...present(data) } as Prisma.PartnerUncheckedCreateInput }))
    }
  }
  if (commit) await deps.prisma.$transaction(async tx => { for (const op of ops) await op(tx) }, { timeout: 60_000 })
  return {
    kind, committed: commit, issues, changes,
    summary: { create: changes.filter(c => c.action === 'create').length, update: changes.filter(c => c.action === 'update').length, error: issues.filter(i => i.level === 'error').length },
  }
}

// ─────────────────────────────────────────────
// 隊員名簿
// ─────────────────────────────────────────────
const PREFECTURE_RE = /^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/

function insuranceFlag(v: string): { number: string | null; enrolled: boolean | null } {
  const s = v.normalize('NFKC').trim()
  if (!s) return { number: null, enrolled: null }
  if (/\d/.test(s)) return { number: s, enrolled: true }
  if (/対象外|なし|無/.test(s)) return { number: null, enrolled: false }
  if (/あり|有|加入/.test(s)) return { number: null, enrolled: true }
  return { number: null, enrolled: null }
}

async function nextEmployeeNumbers(prisma: PrismaClient, companyId: string) {
  const guards = await prisma.guard.findMany({ where: { companyId }, select: { employeeNumber: true } })
  const used = new Set(guards.map(g => g.employeeNumber))
  let n = guards.reduce((max, g) => Math.max(max, Number(g.employeeNumber.replace(/\D/g, '')) || 0), 0)
  return () => { let id: string; do { n += 1; id = `G${String(n).padStart(3, '0')}` } while (used.has(id)); used.add(id); return id }
}

async function importGuards(deps: ImportDeps, companyId: string, actor: ImportActor, req: ImportRequest, commit: boolean): Promise<ImportResult> {
  const m = req.mapping
  const issues: RowIssue[] = []
  const changes: ImportResult['changes'] = []
  const existing = await deps.prisma.guard.findMany({ where: { companyId }, select: { id: true, name: true, birthDate: true, certifications: true, bankAccount: true } })
  const rows = dataRows(req).filter(({ r }) => splitNameAndNote(cell(r, m, 'name')).name)

  // マイナンバーの重複（同じ番号が複数人に入っている）は誤入力の可能性が高いため、該当者全員分を取り込まない
  const myNumberRows = new Map<string, number[]>()
  for (const { r, rowNo } of rows) {
    const mn = cell(r, m, 'myNumber').replace(/\D/g, '')
    if (mn) myNumberRows.set(mn, [...(myNumberRows.get(mn) ?? []), rowNo])
  }
  const nextNo = await nextEmployeeNumbers(deps.prisma, companyId)
  const ops: ((tx: Prisma.TransactionClient) => Promise<unknown>)[] = []
  const seen = new Map<string, number>()
  let myNumberCount = 0

  for (const { r, rowNo } of rows) {
    const name = cleanText(cell(r, m, 'name')).replace(/\s+/g, '　')
    const key = normalizePersonName(name)
    const birthRaw = cell(r, m, 'birthDate')
    const birth = parseDate(birthRaw)
    if (birth === undefined) issues.push({ row: rowNo, level: 'warning', message: `${name}: 生年月日「${birthRaw}」を読めないため空にしました` })
    const dupKey = `${key}|${birth ?? ''}`
    if (seen.has(dupKey)) { issues.push({ row: rowNo, level: 'error', message: `${name}: ${seen.get(dupKey)} 行目と同じ隊員のため取り込みません` }); continue }
    seen.set(dupKey, rowNo)

    const sameName = existing.filter(g => normalizePersonName(g.name) === key)
    const found = sameName.find(g => !birth || !g.birthDate || g.birthDate.toISOString().slice(0, 10) === birth)
    if (!found && sameName.length) issues.push({ row: rowNo, level: 'warning', message: `${name}: 同姓同名の隊員がいますが生年月日が異なるため別人として登録します` })

    const empRaw = cell(r, m, 'employmentType')
    const employmentType = empRaw ? EMPLOYMENT_TYPE_ALIASES[empRaw.normalize('NFKC').replace(/\s/g, '')] : undefined
    if (empRaw && !employmentType) issues.push({ row: rowNo, level: 'warning', message: `${name}: 契約形態「${empRaw}」は該当する区分が無いため変更しません` })

    const certRaw = cell(r, m, 'certifications')
    const certs = certRaw.split(/[、,，/／・\n]/).map(c => c.normalize('NFKC').trim()).filter(c => c && !NO_CERTIFICATION_WORDS.includes(c))
      .map(c => CERTIFICATION_ALIASES[c] ?? c)

    const emp = insuranceFlag(cell(r, m, 'employmentInsuranceNumber'))
    const social = insuranceFlag(cell(r, m, 'pensionNumber'))
    const address = cell(r, m, 'address')
    const email = cell(r, m, 'email').match(EMAIL_RE)?.[0]?.toLowerCase() ?? null
    const kana = hiraganaToKatakana(cell(r, m, 'nameKana')).replace(/\s+/g, ' ')

    const bank: Record<string, string> = present({
      bank: cell(r, m, 'bankName').normalize('NFKC'),
      branch: cell(r, m, 'bankBranch').normalize('NFKC'),
      bankCode: cell(r, m, 'bankCode').replace(/\D/g, '').padStart(4, '0').replace(/^0000$/, ''),
      branchCode: cell(r, m, 'branchCode').replace(/\D/g, '').padStart(3, '0').replace(/^000$/, ''),
      number: cell(r, m, 'accountNumber').replace(/\D/g, '').padStart(7, '0').replace(/^0000000$/, ''),
      holder: cell(r, m, 'accountHolder').normalize('NFKC'),
    })
    if (Object.keys(bank).length && !bank.type) bank.type = '普通'

    // マイナンバー
    const mnRaw = cell(r, m, 'myNumber').replace(/\D/g, '')
    let myNumber: string | null = null
    if (mnRaw) {
      if (!isValidMyNumber(mnRaw)) issues.push({ row: rowNo, level: 'error', message: `${name}: マイナンバーの桁数または検査用数字が正しくないため、マイナンバーは取り込みません` })
      else if ((myNumberRows.get(mnRaw)?.length ?? 0) > 1) issues.push({ row: rowNo, level: 'error', message: `${name}: マイナンバーが ${myNumberRows.get(mnRaw)!.join('・')} 行目で重複しているため、マイナンバーは取り込みません` })
      else if (!deps.canEncrypt) issues.push({ row: rowNo, level: 'error', message: `${name}: サーバーの暗号鍵（ENCRYPTION_KEY）が未設定のため、マイナンバーは取り込みません` })
      else myNumber = mnRaw
    }

    const data = present({
      name,
      nameKana: kana,
      birthDate: birth ? new Date(`${birth}T00:00:00Z`) : null,
      employmentType,
      address,
      prefecture: address.match(PREFECTURE_RE)?.[1] ?? null,
      nearestStation1: cell(r, m, 'nearestStation'),
      employmentInsuranceNumber: emp.number,
      employmentInsurance: emp.enrolled,
      pensionNumber: social.number,
      healthInsurance: social.enrolled,
      pensionInsurance: social.enrolled,
      dependents: num(r, m, 'dependents', rowNo, issues, '扶養人数'),
      dayShiftRate: money(r, m, 'dayShiftRate', rowNo, issues, '日勤単価'),
      nightShiftRate: money(r, m, 'nightShiftRate', rowNo, issues, '夜勤単価'),
      email,
      dormitory: cell(r, m, 'dormitory'),
      commuteNotes: cell(r, m, 'commuteNotes'),
      notes: cell(r, m, 'notes'),
    })
    if (myNumber) myNumberCount++
    changes.push({
      row: rowNo, action: found ? 'update' : 'create', label: name,
      detail: [myNumber && 'マイナンバーあり', certs.length && certs.join('・')].filter(Boolean).join(' / ') || undefined,
    })
    if (!commit) continue

    ops.push(async tx => {
      const merged = {
        ...data,
        ...(certs.length ? { certifications: Array.from(new Set([...(found?.certifications ?? []), ...certs])) } : {}),
        ...(Object.keys(bank).length ? { bankAccount: { ...((found?.bankAccount as Record<string, unknown>) ?? {}), ...bank } } : {}),
        ...(myNumber ? { myNumber: deps.encrypt(myNumber), myNumberUpdatedAt: new Date(), docMyNumber: true } : {}),
      }
      const g = found
        ? await tx.guard.update({ where: { id: found.id }, data: merged as Prisma.GuardUpdateInput })
        : await tx.guard.create({ data: { companyId, employeeNumber: nextNo(), nameKana: '', ...merged } as Prisma.GuardUncheckedCreateInput })
      if (myNumber) {
        await tx.myNumberAuditLog.create({ data: { companyId, guardId: g.id, userId: actor.userId, userName: actor.name, action: 'IMPORT' } })
      }
    })
  }
  if (commit) await deps.prisma.$transaction(async tx => { for (const op of ops) await op(tx) }, { timeout: 60_000 })
  return {
    kind: 'guards', committed: commit, issues, changes,
    summary: {
      create: changes.filter(c => c.action === 'create').length,
      update: changes.filter(c => c.action === 'update').length,
      myNumber: myNumberCount,
      error: issues.filter(i => i.level === 'error').length,
    },
  }
}

// ─────────────────────────────────────────────
// 現場管理（取引先・現場・現場依頼・配員）
// ─────────────────────────────────────────────
interface ParsedRequestRow {
  rowNo: number
  sourceKey: string
  clientName: string
  siteName: string
  nearestStation: string
  date: string
  time: ReturnType<typeof parseTimeRange>
  requestedCount: number
  qualifiedCount: number
  unitPrice: number | null
  transportFee: number | null
  overtimeRate: number | null
  overtimeHours: number | null
  overtimeCount: number | null
  dispatchers: string[]
  subcontractor: string
  subcontractUnitPrice: number | null
  sheetBillingPerDay: number | null  // シート側の請求額/日（照合用。保存しない）
  status: 'CONFIRMED' | 'PLANNED' | 'CANCELLED'
  notes: string
}

function parseRequestRows(req: ImportRequest, issues: RowIssue[]): ParsedRequestRow[] {
  const m = req.mapping
  const out: ParsedRequestRow[] = []
  const noCount = new Map<string, number>()
  // 「3.4.6」のように複数日をまとめた行。日別の行が別にある集計行なら取り込まず、無ければエラーにする
  const undated: { rowNo: number; clientName: string; siteName: string; days: string; workDays: number | null; ym: string }[] = []
  for (const { r, rowNo } of dataRows(req)) {
    const clientName = splitNameAndNote(cell(r, m, 'client')).name
    const siteName = cell(r, m, 'siteName').replace(/\s+/g, ' ')
    if (!clientName && !siteName) continue
    if (!clientName || !siteName) { issues.push({ row: rowNo, level: 'error', message: '依頼主または現場名が空のため取り込みません' }); continue }

    let date = parseDate(cell(r, m, 'date'))
    if (!date) {
      // 年月日が無い行は 依頼年・依頼月・依頼期間（1日分）から組み立てる
      const y = parseNumber(cell(r, m, 'year')), mo = parseNumber(cell(r, m, 'month')), d = cell(r, m, 'days').normalize('NFKC')
      if (y && mo && /^\d{1,2}(\.0+)?$/.test(d)) date = parseDate(`${y}/${mo}/${parseInt(d, 10)}`)
    }
    const days = cell(r, m, 'days')
    const workDays = parseNumber(cell(r, m, 'workDays'))
    if (!date) {
      undated.push({ rowNo, clientName, siteName, days, workDays, ym: `${parseNumber(cell(r, m, 'year')) ?? ''}-${parseNumber(cell(r, m, 'month')) ?? ''}` })
      continue
    }
    const no = cell(r, m, 'no').replace(/\.0+$/, '') || `r${rowNo}`
    const occurrence = (noCount.get(no) ?? 0) + 1
    noCount.set(no, occurrence)
    if (occurrence > 1) issues.push({ row: rowNo, level: 'warning', message: `NO.${no} が重複しています（${occurrence}件目として区別して取り込みます）` })

    const requestedCount = num(r, m, 'requestedCount', rowNo, issues, '依頼人数') ?? 1
    const time = parseTimeRange(cell(r, m, 'time'))
    if (!time.start && time.label) issues.push({ row: rowNo, level: 'warning', message: `${siteName}: 時間「${time.label}」は時刻ではないため、配員は時刻なしで登録します` })
    out.push({
      rowNo,
      sourceKey: `siteRequests#${no}${occurrence > 1 ? `-${occurrence}` : ''}`,
      clientName, siteName,
      nearestStation: cell(r, m, 'nearestStation'),
      date, time,
      requestedCount: Math.max(0, Math.round(requestedCount)),
      // 「うち資格者」が空で「資格者有無」が有なら、「有 1名」等の人数か1名とみなす
      qualifiedCount: Math.max(0, Math.round(num(r, m, 'qualifiedCount', rowNo, issues, 'うち資格者')
        ?? (/^有/.test(cell(r, m, 'qualifiedFlag').normalize('NFKC')) ? Number(cell(r, m, 'qualifiedFlag').normalize('NFKC').match(/(\d+)/)?.[1] ?? 1) : 0))),
      unitPrice: money(r, m, 'unitPrice', rowNo, issues, '依頼単価'),
      transportFee: money(r, m, 'transportFee', rowNo, issues, '交通費単価'),
      overtimeRate: money(r, m, 'overtimeRate', rowNo, issues, '残業単価'),
      overtimeHours: num(r, m, 'overtimeHours', rowNo, issues, '残業時間'),
      overtimeCount: num(r, m, 'overtimeCount', rowNo, issues, '残業人数'),
      dispatchers: DISPATCHER_KEYS.map(k => cell(r, m, k)).filter(Boolean),
      subcontractor: cell(r, m, 'subcontractor'),
      subcontractUnitPrice: money(r, m, 'subcontractUnitPrice', rowNo, issues, '再委託単価'),
      sheetBillingPerDay: money(r, m, 'sheetBillingPerDay', rowNo, issues, '請求額/日'),
      // 稼働日数: 1以上=稼働、0=中止（雨天中止など）、空欄=未確定（予定）。列を割り当てていなければ稼働とみなす
      status: m.workDays === undefined ? 'CONFIRMED' : workDays === null || Number.isNaN(workDays) ? 'PLANNED' : workDays > 0 ? 'CONFIRMED' : 'CANCELLED',
      notes: cell(r, m, 'notes'),
    })
  }
  for (const u of undated) {
    const daily = out.filter(o => o.clientName === u.clientName && o.siteName === u.siteName && `${+o.date.slice(0, 4)}-${+o.date.slice(5, 7)}` === u.ym)
    if (!u.workDays) {
      issues.push({ row: u.rowNo, level: 'warning', message: `${u.siteName}: 依頼期間「${u.days}」は複数日をまとめた集計行（稼働日数0）のため取り込みません（日別の行を取り込みます）` })
    } else if (daily.length) {
      issues.push({ row: u.rowNo, level: 'warning', message: `${u.siteName}: 依頼期間「${u.days}」は複数日をまとめた行で、同じ月の日別の行（${daily.map(d => +d.date.slice(8)).join('・')}日）があるため取り込みません。日別の行が足りない日は追加してください` })
    } else {
      issues.push({ row: u.rowNo, level: 'error', message: `${u.siteName}: 依頼期間「${u.days}」を1日に特定できません。1日1行に分けてから取り込んでください` })
    }
  }
  return out
}

interface Directory {
  clients: { id: string; name: string; norm: string }[]
  partners: { id: string; name: string; norm: string }[]
  guards: { id: string; name: string; norm: string }[]
}

function candidatesFor(name: string, dir: Directory, kinds: ('client' | 'partner' | 'guard')[]): NameCandidate[] {
  const out: NameCandidate[] = []
  const company = stripNameDecorations(normalizeCompanyName(name)), person = stripNameDecorations(normalizePersonName(name))
  if (kinds.includes('client')) for (const c of dir.clients) { const s = matchScore(company, c.norm); if (s) out.push({ kind: 'client', id: c.id, name: c.name, score: s }) }
  // 取引先と同名の協力会社（協力会社から作った取引先）は、取引先側の候補だけを出す（候補が2つに割れて新規作成されないように）
  const clientNorms = kinds.includes('client') ? new Set(dir.clients.map(c => c.norm)) : new Set<string>()
  if (kinds.includes('partner')) for (const p of dir.partners) { if (clientNorms.has(p.norm)) continue; const s = matchScore(company, p.norm); if (s) out.push({ kind: 'partner', id: p.id, name: p.name, score: s }) }
  if (kinds.includes('guard')) for (const g of dir.guards) { const s = matchScore(person, g.norm); if (s) out.push({ kind: 'guard', id: g.id, name: g.name, score: s }) }
  return out.sort((a, b) => b.score - a.score).slice(0, 5)
}

// 候補が1件だけ十分に近い（包含一致 0.8 以上、または表記ゆれ 0.45 以上で他に近い候補が無い）
function isUniqueSuggestion(candidates: NameCandidate[]): boolean {
  const best = candidates[0]
  if (!best) return false
  if (best.score >= 0.8) return candidates.filter(c => c.score >= 0.8).length === 1
  return best.score >= 0.45 && candidates.filter(c => c.score >= 0.45).length === 1
}

function resolveClientName(name: string, count: number, dir: Directory, manual?: Resolution): NameEntry {
  const candidates = candidatesFor(name, dir, ['client', 'partner'])
  if (manual) return { name, count, resolution: manual, auto: 'manual', candidates }
  const best = candidates[0]
  const toRes = (c: NameCandidate): Resolution => c.kind === 'client' ? { action: 'client', id: c.id } : { action: 'clientFromPartner', id: c.id }
  if (best?.score === 1) return { name, count, resolution: toRes(best), auto: 'exact', candidates }
  // 前方・包含一致（「○○電設」→「○○電設株式会社」）や表記ゆれ（「△△建設」→「△△建築」）は、候補が1社に絞れる場合のみ当てる（要確認）
  if (best && isUniqueSuggestion(candidates)) return { name, count, resolution: toRes(best), auto: 'suggested', candidates }
  return { name, count, resolution: { action: 'newClient' }, auto: 'default', candidates }
}

function resolvePersonName(name: string, count: number, dir: Directory, subcontractorNames: string[], manual?: Resolution): NameEntry {
  const candidates = candidatesFor(name, dir, ['guard', 'partner'])
  if (manual) return { name, count, resolution: manual, auto: 'manual', candidates }
  const best = candidates[0]
  const toRes = (c: NameCandidate): Resolution => c.kind === 'guard' ? { action: 'guard', id: c.id } : { action: 'partner', id: c.id }
  if (best?.score === 1) return { name, count, resolution: toRes(best), auto: 'exact', candidates }
  if (best && isUniqueSuggestion(candidates)) return { name, count, resolution: toRes(best), auto: 'suggested', candidates }
  // 再委託先の列にある名前（またはその略称）は協力会社として新規登録する（「○○ヒルズ」→「○○ヒルズパートナーズ」）
  const norm = stripNameDecorations(normalizeCompanyName(name))
  const sub = subcontractorNames.find(s => { const n = normalizeCompanyName(s); return n === norm || n.startsWith(norm) || norm.startsWith(n) })
  if (sub) return { name, count, resolution: { action: 'newPartner', name: sub }, auto: 'suggested', candidates }
  // 会社らしい名前は協力会社、それ以外は隊員として新規登録を既定にする（画面で変更可）
  const looksCompany = /警備|保障|コーポレーション|セキュリティ|株式会社|パートナーズ|サービス/.test(name)
  return { name, count, resolution: looksCompany ? { action: 'newPartner' } : { action: 'newGuard' }, auto: 'default', candidates }
}

async function importSiteRequests(deps: ImportDeps, companyId: string, req: ImportRequest, commit: boolean, batchId: string | null): Promise<ImportResult> {
  const issues: RowIssue[] = []
  const rows = parseRequestRows(req, issues)
  const [clients, partners, guards, sites] = await Promise.all([
    deps.prisma.client.findMany({ where: { companyId }, select: { id: true, name: true, qualificationAllowance: true } }),
    deps.prisma.partner.findMany({ where: { companyId } }),
    deps.prisma.guard.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true } }),
    deps.prisma.site.findMany({ where: { companyId }, select: { id: true, name: true, clientId: true } }),
  ])
  const dir: Directory = {
    clients: clients.map(c => ({ ...c, norm: normalizeCompanyName(c.name) })),
    partners: partners.map(p => ({ id: p.id, name: p.name, norm: normalizeCompanyName(p.name) })),
    guards: guards.map(g => ({ ...g, norm: normalizePersonName(g.name) })),
  }

  // 名寄せ（同じ表記はまとめて1回決める）
  const clientCounts = new Map<string, number>(), peopleCounts = new Map<string, number>()
  for (const row of rows) {
    clientCounts.set(row.clientName, (clientCounts.get(row.clientName) ?? 0) + 1)
    for (const p of [...row.dispatchers, row.subcontractor].filter(Boolean)) peopleCounts.set(p, (peopleCounts.get(p) ?? 0) + 1)
  }
  const subcontractorNames = [...new Set(rows.map(r => r.subcontractor).filter(Boolean))]
  const clientNames = [...clientCounts].map(([n, c]) => resolveClientName(n, c, dir, req.clientResolutions?.[n]))
  const peopleNames = [...peopleCounts].map(([n, c]) => resolvePersonName(n, c, dir, subcontractorNames, req.peopleResolutions?.[n]))
  const clientRes = new Map(clientNames.map(e => [e.name, e.resolution]))
  const peopleRes = new Map(peopleNames.map(e => [e.name, e.resolution]))

  // 指示が実在する相手を指しているか確認（他社のIDや削除済みを防ぐ）
  const idsOk = (res: Resolution) =>
    res.action === 'client' ? dir.clients.some(c => c.id === res.id)
      : res.action === 'partner' || res.action === 'clientFromPartner' ? dir.partners.some(p => p.id === res.id)
        : res.action === 'guard' ? dir.guards.some(g => g.id === res.id) : true
  for (const [label, res] of [...clientNames.map(e => [e.name, e.resolution] as const), ...peopleNames.map(e => [e.name, e.resolution] as const), ...Object.entries(req.siteClientOverrides ?? {})]) {
    if (!idsOk(res)) throw new ImportError(`「${String(label).replace('\u0001', ' / ')}」の紐付け先が見つかりません。画面を再読み込みしてください`)
  }

  // 行ごとの取引先（現場単位の指定があればそれを優先）と、その同一性キー（同じ取引先は1回だけ作る）
  const rowClientRes = (row: ParsedRequestRow): Resolution => req.siteClientOverrides?.[siteOverrideKey(row.clientName, row.siteName)] ?? clientRes.get(row.clientName)!
  const identityOf = (res: Resolution, fallbackName: string) =>
    res.action === 'client' ? `id:${res.id}` : res.action === 'clientFromPartner' ? `partner:${res.id}`
      : res.action === 'newClient' ? `new:${normalizeCompanyName(res.name || fallbackName)}` : 'skip'
  const siteKeyOf = (row: ParsedRequestRow) => `${identityOf(rowClientRes(row), row.clientName)}|${normalizePersonName(row.siteName)}`
  const existingSiteOf = (row: ParsedRequestRow) => {
    const res = rowClientRes(row)
    if (res.action !== 'client') return undefined
    return sites.find(s => s.clientId === res.id && normalizePersonName(s.name) === normalizePersonName(row.siteName))
  }

  // 現場の一覧（画面で現場ごとに取引先を変えられるように返す）
  const siteEntries = new Map<string, SiteEntry>()
  for (const row of rows) {
    const key = siteOverrideKey(row.clientName, row.siteName)
    const e = siteEntries.get(key)
    if (e) { e.count++; continue }
    siteEntries.set(key, { key, clientName: row.clientName, siteName: row.siteName, count: 1, resolution: rowClientRes(row), overridden: !!req.siteClientOverrides?.[key], existing: !!existingSiteOf(row) })
  }

  // 計画
  const changes: ImportResult['changes'] = []
  const plannedSites = new Map<string, { row: ParsedRequestRow; existingId?: string }>()
  let scheduleCount = 0, subcontractCount = 0, mismatchCount = 0
  const plannedRows: { row: ParsedRequestRow; guardNames: string[]; partnerName: string | null }[] = []
  for (const row of rows) {
    if (rowClientRes(row).action === 'skip') { issues.push({ row: row.rowNo, level: 'warning', message: `依頼主「${row.clientName}」を取り込まない指定のため、この行を取り込みません` }); continue }
    const key = siteKeyOf(row)
    if (!plannedSites.has(key)) plannedSites.set(key, { row, existingId: existingSiteOf(row)?.id })
    const guardNames: string[] = []
    let partnerName: string | null = null
    for (const p of row.dispatchers) {
      const res = peopleRes.get(p)!
      if (res.action === 'guard' || res.action === 'newGuard') guardNames.push(p)
      else if (res.action === 'partner' || res.action === 'newPartner') partnerName ??= p
    }
    if (row.subcontractor) {
      const res = peopleRes.get(row.subcontractor)!
      if (res.action === 'partner' || res.action === 'newPartner') partnerName = row.subcontractor
      else if (res.action !== 'skip') issues.push({ row: row.rowNo, level: 'warning', message: `再委託先「${row.subcontractor}」が隊員に紐付けられているため、再委託としては記録しません` })
    }
    // 同じ人が別表記で並ぶ（「山田太郎」「山田　太郎」のように空白の有無が違う）場合も1件にまとめる
    const guardIdentity = (n: string) => { const r = peopleRes.get(n)!; return r.action === 'guard' ? `id:${r.id}` : `new:${normalizePersonName(n)}` }
    const uniqueGuards = guardNames.filter((g, i) => guardNames.findIndex(x => guardIdentity(x) === guardIdentity(g)) === i)
    if (uniqueGuards.length < guardNames.length) issues.push({ row: row.rowNo, level: 'warning', message: '同じ隊員が同じ行に重複しているため1件にまとめます' })
    if (uniqueGuards.length > row.requestedCount) issues.push({ row: row.rowNo, level: 'warning', message: `派遣者（${uniqueGuards.length}名）が依頼人数（${row.requestedCount}名）を超えています` })
    // シートの請求額/日と、取引先の資格者手当を使った計算が一致するか照合する（移行時の単価・手当の取り違えを見つけるため）
    if (row.sheetBillingPerDay != null) {
      const res = rowClientRes(row)
      const allowance = res.action === 'client' ? clients.find(c => c.id === res.id)?.qualificationAllowance
        : res.action === 'clientFromPartner' ? partners.find(x => x.id === res.id)?.qualificationAllowance : null
      const est = estimateRequestBilling(row, allowance)
      if (est !== row.sheetBillingPerDay) {
        issues.push({ row: row.rowNo, level: 'warning', message: `${row.siteName} ${row.date}: 請求額/日がシート（${row.sheetBillingPerDay.toLocaleString()}円）と計算（${est.toLocaleString()}円）で異なります。単価・資格者数・資格者手当を確認してください${row.notes ? `（備考: ${row.notes}）` : ''}` })
        mismatchCount++
      }
    }
    scheduleCount += uniqueGuards.length
    if (partnerName) subcontractCount++
    plannedRows.push({ row, guardNames: uniqueGuards, partnerName })
  }
  for (const [, s] of plannedSites) changes.push({ row: s.row.rowNo, action: s.existingId ? 'update' : 'create', label: `現場: ${s.row.siteName}（${s.row.clientName}）` })

  const existingRequests = await deps.prisma.siteRequest.findMany({
    where: { companyId, sourceKey: { in: plannedRows.map(p => p.row.sourceKey) } },
    select: { id: true, sourceKey: true },
  })
  const existingReqByKey = new Map(existingRequests.map(r => [r.sourceKey!, r.id]))

  const usedClientRes = [...new Map(plannedRows.map(p => { const r = rowClientRes(p.row); return [identityOf(r, p.row.clientName), r] })).values()]
  const newPartnerNames = new Set(peopleNames.filter(p => p.resolution.action === 'newPartner').map(p => normalizeCompanyName((p.resolution as { name?: string }).name || p.name)))
  const summary = {
    requests: plannedRows.length,
    requestsUpdate: plannedRows.filter(p => existingReqByKey.has(p.row.sourceKey)).length,
    schedules: scheduleCount,
    subcontracted: subcontractCount,
    newClients: usedClientRes.filter(r => r.action === 'newClient' || r.action === 'clientFromPartner').length,
    newSites: [...plannedSites.values()].filter(s => !s.existingId).length,
    newGuards: new Set(peopleNames.filter(p => p.resolution.action === 'newGuard').map(p => normalizePersonName(p.name))).size,
    newPartners: newPartnerNames.size,
    cancelled: plannedRows.filter(p => p.row.status === 'CANCELLED').length,
    planned: plannedRows.filter(p => p.row.status === 'PLANNED').length,
    billingMismatch: mismatchCount,
    error: issues.filter(i => i.level === 'error').length,
  }
  const result: ImportResult = { kind: 'siteRequests', committed: commit, summary, issues, changes, clientNames, peopleNames, sites: [...siteEntries.values()] }
  if (!commit) return result

  await deps.prisma.$transaction(async tx => {
    // 1. 取引先（同一性キーごとに1回）
    const clientIdByIdentity = new Map<string, string>()
    for (const p of plannedRows) {
      const res = rowClientRes(p.row)
      const identity = identityOf(res, p.row.clientName)
      if (clientIdByIdentity.has(identity)) continue
      if (res.action === 'client') clientIdByIdentity.set(identity, res.id)
      else if (res.action === 'newClient') {
        const name = res.name || p.row.clientName
        const same = await tx.client.findFirst({ where: { companyId, name } })
        clientIdByIdentity.set(identity, (same ?? await tx.client.create({ data: { companyId, name, relationship: '依頼主' } })).id)
      } else if (res.action === 'clientFromPartner') {
        const partner = partners.find(x => x.id === res.id)!
        const same = await tx.client.findFirst({ where: { companyId, name: partner.name } })
        // 警備会社との契約単価は相互の単価のため、依頼元としての請求にも同じ単価・手当を使う
        const c = same ?? await tx.client.create({
          data: {
            companyId, name: partner.name, relationship: '協力会社（依頼元）',
            email: partner.email, phone: partner.phone, contactName: partner.contactName, website: partner.website, address: partner.address,
            contractDate: partner.contractDate, contractMethod: partner.contractMethod,
            unitPriceDay: partner.unitPriceDay, unitPriceNight: partner.unitPriceNight, unitPriceHolidayDay: partner.unitPriceHolidayDay, unitPriceHolidayNight: partner.unitPriceHolidayNight,
            overtimeDayRate: partner.overtimeDayRate, overtimeNightRate: partner.overtimeNightRate, overtimeHolidayDayRate: partner.overtimeHolidayDayRate, overtimeHolidayNightRate: partner.overtimeHolidayNightRate,
            qualificationAllowance: partner.qualificationAllowance, seasonalAllowance: partner.seasonalAllowance, nominationAllowance: partner.nominationAllowance,
          },
        })
        clientIdByIdentity.set(identity, c.id)
      }
    }
    // 2. 協力会社・隊員（新規。同じ名前はまとめて1件）
    const partnerIdByName = new Map<string, string>(), guardIdByName = new Map<string, string>()
    const newPartnerIds = new Map<string, string>(), newGuardIds = new Map<string, string>()
    const nextNo = await nextEmployeeNumbers(tx as unknown as PrismaClient, companyId)
    for (const e of peopleNames) {
      const res = e.resolution
      if (res.action === 'partner') partnerIdByName.set(e.name, res.id)
      else if (res.action === 'guard') guardIdByName.set(e.name, res.id)
      else if (res.action === 'newPartner') {
        const name = res.name || e.name
        const key = normalizeCompanyName(name)
        if (!newPartnerIds.has(key)) newPartnerIds.set(key, (await tx.partner.create({ data: { companyId, name } })).id)
        partnerIdByName.set(e.name, newPartnerIds.get(key)!)
      } else if (res.action === 'newGuard') {
        const key = normalizePersonName(e.name)
        if (!newGuardIds.has(key)) {
          const g = await tx.guard.create({ data: { companyId, employeeNumber: nextNo(), name: e.name, nameKana: '', notes: '現場管理の取り込みで作成（隊員名簿に無い派遣者）' } })
          newGuardIds.set(key, g.id)
        }
        guardIdByName.set(e.name, newGuardIds.get(key)!)
      }
    }
    // 3. 現場
    const siteIdByKey = new Map<string, string>()
    for (const [key, s] of plannedSites) {
      const clientId = clientIdByIdentity.get(identityOf(rowClientRes(s.row), s.row.clientName))!
      const station = s.row.nearestStation || null
      if (s.existingId) {
        if (station) await tx.site.update({ where: { id: s.existingId }, data: { nearestStation: station } })
        siteIdByKey.set(key, s.existingId)
      } else {
        const site = await tx.site.create({ data: { companyId, clientId, name: s.row.siteName, address: '', nearestStation: station, clientName: s.row.clientName } })
        siteIdByKey.set(key, site.id)
      }
    }
    // 4. 現場依頼と配員（同じ取り込み元の行は更新し、配員は出退勤の記録が無いものだけ入れ替える）
    for (const { row, guardNames, partnerName } of plannedRows) {
      const data = {
        siteId: siteIdByKey.get(siteKeyOf(row))!,
        date: new Date(`${row.date}T00:00:00Z`),
        timeLabel: row.time.label || null,
        startTime: row.time.start || null,
        endTime: row.time.end || null,
        shiftType: row.time.shiftType,
        status: row.status,
        requestedCount: row.requestedCount,
        qualifiedCount: row.qualifiedCount,
        unitPrice: row.unitPrice,
        transportFee: row.transportFee,
        overtimeRate: row.overtimeRate,
        overtimeHours: row.overtimeHours,
        overtimeCount: row.overtimeCount == null ? null : Math.round(row.overtimeCount),
        subcontractPartnerId: partnerName ? partnerIdByName.get(partnerName)! : null,
        subcontractCount: partnerName ? Math.max(1, row.requestedCount - guardNames.length) : 0,
        subcontractUnitPrice: partnerName ? row.subcontractUnitPrice : null,
        notes: row.notes || null,
        importBatchId: batchId,
      }
      const existingId = existingReqByKey.get(row.sourceKey)
      const request = existingId
        ? await tx.siteRequest.update({ where: { id: existingId }, data })
        : await tx.siteRequest.create({ data: { companyId, sourceKey: row.sourceKey, ...data } })
      if (existingId) await tx.schedule.deleteMany({ where: { siteRequestId: request.id, attendance: null } })
      const kept = existingId ? await tx.schedule.findMany({ where: { siteRequestId: request.id }, select: { guardId: true } }) : []
      for (const g of guardNames) {
        const guardId = guardIdByName.get(g)!
        if (kept.some(k => k.guardId === guardId)) continue
        await tx.schedule.create({
          data: {
            companyId, guardId, siteId: data.siteId, date: data.date,
            startTime: row.time.start, endTime: row.time.end, shiftType: row.time.shiftType,
            status: row.status === 'CANCELLED' ? 'CANCELLED' : 'ASSIGNED', siteRequestId: request.id,
            notes: row.time.start ? null : row.time.label || null,
          },
        })
      }
    }
  }, { timeout: 120_000 })
  return result
}

// ─────────────────────────────────────────────
// 入口
// ─────────────────────────────────────────────
export async function runImport(deps: ImportDeps, companyId: string, actor: ImportActor, req: ImportRequest, commit: boolean): Promise<ImportResult> {
  if (req.kind !== 'companyInsurance') {
    const fields = IMPORT_FIELDS[req.kind]
    const missing = fields.filter(f => f.required && req.mapping[f.key] === undefined)
    if (missing.length) throw new ImportError(`必須の列が割り当てられていません: ${missing.map(f => f.label).join('、')}`)
  }
  let result: ImportResult
  let batchId: string | null = null
  if (commit) batchId = (await deps.prisma.importBatch.create({ data: { companyId, kind: req.kind, sourceName: req.sourceName.slice(0, 200), createdById: actor.userId, createdByName: actor.name, summary: {} } })).id
  try {
    switch (req.kind) {
      case 'companyInsurance': result = await importCompanyInsurance(deps, companyId, req, commit); break
      case 'clients': result = await importCompanies(deps, companyId, req, commit, 'clients'); break
      case 'partners': result = await importCompanies(deps, companyId, req, commit, 'partners'); break
      case 'guards': result = await importGuards(deps, companyId, actor, req, commit); break
      case 'siteRequests': result = await importSiteRequests(deps, companyId, req, commit, batchId); break
      default: throw new ImportError('取り込み種別が不正です')
    }
  } catch (e) {
    if (batchId) await deps.prisma.importBatch.delete({ where: { id: batchId } }).catch(() => {})
    throw e
  }
  if (batchId) {
    await deps.prisma.importBatch.update({ where: { id: batchId }, data: { summary: { ...result.summary, warnings: result.issues.filter(i => i.level === 'warning').length } } })
    result.batchId = batchId
  }
  return result
}

export { ImportError }
