// 取り込みファイルの読み取り（Excel・CSV・Googleスプレッドシート）→ シートごとの文字列の表
import ExcelJS from 'exceljs'
import iconv from 'iconv-lite'
import { autoMapColumns, detectSheet, type ImportKind } from '../shared/import'

export const MAX_ROWS_PER_SHEET = 5000
export const MAX_COLS = 80
export const MAX_FILE_BYTES = 20 * 1024 * 1024

export interface ParsedSheet {
  name: string
  rows: string[][]
  detected: { kind: ImportKind; headerRow: number; mapping: Record<string, number> } | null
}

class ParseError extends Error {}
export { ParseError }

// Excel のセル値 → 文字列（日付は YYYY-MM-DD、時刻のみは HH:MM、数式は計算結果）
function cellToString(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return ''
    const iso = v.toISOString()
    return iso.startsWith('1899-12-30') ? iso.slice(11, 16) : iso.slice(0, 10)
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return cellToString(o.result)
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map(t => t.text).join('')
    if ('text' in o) return String(o.text)
    if ('error' in o) return ''
    return ''
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)
  const s = String(v)
  return /^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(s) ? s.slice(0, 10) : s
}

// 末尾の空行・空列を落とす（Googleスプレッドシートは1000行など空行を大量に含むため）
function trimTable(rows: string[][]): string[][] {
  let lastRow = rows.length - 1
  while (lastRow >= 0 && rows[lastRow].every(c => !c.trim())) lastRow--
  const trimmed = rows.slice(0, lastRow + 1)
  let lastCol = -1
  for (const r of trimmed) for (let c = r.length - 1; c > lastCol; c--) if (r[c]?.trim()) { lastCol = c; break }
  return trimmed.map(r => Array.from({ length: lastCol + 1 }, (_, c) => r[c] ?? ''))
}

function withDetection(name: string, rows: string[][]): ParsedSheet {
  const det = detectSheet(rows)
  return {
    name, rows,
    detected: det ? { ...det, mapping: det.kind === 'companyInsurance' ? {} : autoMapColumns(rows[det.headerRow], det.kind) } : null,
  }
}

export async function parseXlsx(buf: Buffer): Promise<ParsedSheet[]> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer)
  } catch {
    throw new ParseError('Excelファイルを読み取れませんでした（.xlsx 形式で保存してください）')
  }
  const sheets: ParsedSheet[] = []
  wb.eachSheet(ws => {
    if (ws.state && ws.state !== 'visible') return
    const rows: string[][] = []
    const cols = Math.min(ws.columnCount, MAX_COLS)
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS_PER_SHEET) return
      const vals: string[] = []
      for (let c = 1; c <= cols; c++) vals.push(cellToString(row.getCell(c).value))
      rows[rowNumber - 1] = vals
    })
    for (let i = 0; i < rows.length; i++) rows[i] ??= []
    const table = trimTable(rows)
    if (table.length) sheets.push(withDetection(ws.name, table))
  })
  return sheets
}

// CSV（RFC 4180：引用符内の改行・カンマ・"" を扱う）
function parseCsvText(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false }
      else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
      if (rows.length >= MAX_ROWS_PER_SHEET) break
    } else field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.map(r => r.slice(0, MAX_COLS))
}

// Excel で保存した日本語CSVは Shift_JIS のことが多いため、UTF-8 として不正なら Shift_JIS で読む
function decodeCsv(buf: Buffer): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  const utf8 = buf.toString('utf8')
  return utf8.includes('�') ? iconv.decode(buf, 'Shift_JIS') : utf8
}

export function parseCsv(buf: Buffer, fileName: string): ParsedSheet[] {
  const table = trimTable(parseCsvText(decodeCsv(buf)))
  return table.length ? [withDetection(fileName.replace(/\.csv$/i, ''), table)] : []
}

export async function parseUpload(buf: Buffer, fileName: string): Promise<ParsedSheet[]> {
  if (buf.length > MAX_FILE_BYTES) throw new ParseError('ファイルが大きすぎます（20MBまで）')
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return parseCsv(buf, fileName)
  if (lower.endsWith('.xlsx') || buf.subarray(0, 2).toString() === 'PK') return parseXlsx(buf)
  if (lower.endsWith('.xls')) throw new ParseError('古い形式（.xls）は読み取れません。Excelで .xlsx 形式に保存し直してください')
  throw new ParseError('CSV または Excel（.xlsx）ファイルを選択してください')
}

// Googleスプレッドシート: URL からIDだけを取り出して Excel 形式で書き出す（任意のURLには接続しない）
export function googleSheetId(url: string): string | null {
  const m = url.trim().match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)
  return m ? m[1] : null
}

export async function fetchGoogleSheet(url: string): Promise<{ sheets: ParsedSheet[]; sourceName: string }> {
  const id = googleSheetId(url)
  if (!id) throw new ParseError('GoogleスプレッドシートのURL（https://docs.google.com/spreadsheets/d/…）を入力してください')
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: 'follow', signal: AbortSignal.timeout(30_000) })
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok || !type.includes('spreadsheetml')) {
    throw new ParseError('スプレッドシートを読み取れませんでした。共有設定を「リンクを知っている全員（閲覧者）」にするか、「ファイル → ダウンロード → Microsoft Excel」で保存したファイルを選択してください')
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_FILE_BYTES) throw new ParseError('スプレッドシートが大きすぎます（20MBまで）')
  const disposition = res.headers.get('content-disposition') ?? ''
  const name = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? '').replace(/\.xlsx$/, '') || 'Googleスプレッドシート'
  return { sheets: await parseXlsx(buf), sourceName: name }
}
