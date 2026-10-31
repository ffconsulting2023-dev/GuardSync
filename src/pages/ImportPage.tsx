import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import {
  IMPORT_KINDS, IMPORT_ORDER, IMPORT_FIELDS,
  type ImportKind, type TableImportKind, type ImportRequest, type ImportResult, type NameEntry, type Resolution, type SiteEntry,
} from '../../shared/import'

interface ParsedSheet {
  name: string
  rows: string[][]
  detected: { kind: ImportKind; headerRow: number; mapping: Record<string, number> } | null
}
interface Directory {
  company: { id: string; name: string; code: string } | null
  clients: { id: string; name: string }[]
  partners: { id: string; name: string }[]
  guards: { id: string; name: string; employeeNumber: string }[]
  canEncryptMyNumber: boolean
}
interface SheetState {
  kind: ImportKind | ''
  headerRow: number
  mapping: Record<string, number>
  clientResolutions: Record<string, Resolution>
  peopleResolutions: Record<string, Resolution>
  siteClientOverrides: Record<string, Resolution>
  preview: ImportResult | null
  stale: boolean        // プレビュー後に指示を変えた（取り込む前にもう一度プレビューが必要）
  done: ImportResult | null
}

const SUMMARY_LABELS: Record<string, string> = {
  create: '新規', update: '更新', unchanged: '変更なし', error: 'エラー', myNumber: 'マイナンバー',
  requests: '現場依頼', requestsUpdate: 'うち更新', schedules: '配員', subcontracted: '再委託',
  newClients: '新規取引先', newSites: '新規現場', newGuards: '新規隊員', newPartners: '新規協力会社', cancelled: 'うち中止', planned: 'うち予定（未確定）', billingMismatch: '請求額の不一致', updated: '更新',
}
// 列の割り当て確認用の見本: マイナンバー・口座番号は画面に出さない
const maskSample = (key: string, v: string) =>
  !v ? '' : key === 'myNumber' ? '************' : key === 'accountNumber' ? `****${v.slice(-3)}` : v
const apiError = (e: any, fallback: string) => e?.response?.data?.error || fallback
const colLabel = (i: number) => { let s = '', n = i + 1; while (n) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26) } return s }

// 名寄せの選択値 <-> 指示
const resToValue = (r: Resolution) => ('id' in r ? `${r.action}:${r.id}` : r.action)
function valueToRes(v: string, prev: Resolution): Resolution {
  const [action, id] = v.split(':') as [Resolution['action'], string | undefined]
  if (id) return { action, id } as Resolution
  if (action === 'newClient' || action === 'newPartner') return { action, name: 'name' in prev ? prev.name : undefined }
  return { action } as Resolution
}

const AUTO_BADGE: Record<NameEntry['auto'], { label: string; cls: string }> = {
  exact: { label: '一致', cls: 'bg-green-100 text-green-700' },
  suggested: { label: '候補（要確認）', cls: 'bg-amber-100 text-amber-800' },
  default: { label: '新規（要確認）', cls: 'bg-orange-100 text-orange-800' },
  manual: { label: '手動', cls: 'bg-blue-100 text-blue-700' },
}

function NameResolutionTable({ title, entries, kind, dir, onChange }: {
  title: string; entries: NameEntry[]; kind: 'client' | 'people'; dir: Directory
  onChange: (name: string, res: Resolution) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const needsReview = entries.filter(e => e.auto !== 'exact')
  const list = showAll ? entries : needsReview
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h4 className="font-semibold text-gray-800 text-sm">{title}（{entries.length}件・要確認 {needsReview.length}件）</h4>
        <label className="text-xs text-gray-500 flex items-center gap-1"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />一致したものも表示</label>
      </div>
      {list.length === 0 ? <p className="text-xs text-gray-400 px-4 py-3">確認が必要な名前はありません</p> : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-50">
            {list.map(e => (
              <tr key={e.name}>
                <td className="px-4 py-2 w-1/3">
                  <p className="font-medium text-gray-800">{e.name}</p>
                  <p className="text-xs text-gray-400">{e.count}行 <span className={`ml-1 px-1.5 py-0.5 rounded ${AUTO_BADGE[e.auto].cls}`}>{AUTO_BADGE[e.auto].label}</span></p>
                </td>
                <td className="px-4 py-2">
                  <select value={resToValue(e.resolution)} onChange={ev => onChange(e.name, valueToRes(ev.target.value, e.resolution))} className="form-input text-sm">
                    {kind === 'client' ? (
                      <>
                        <optgroup label="既存の取引先">{dir.clients.map(c => <option key={c.id} value={`client:${c.id}`}>{c.name}</option>)}</optgroup>
                        <optgroup label="協力会社の情報で取引先を作成">{dir.partners.map(p => <option key={p.id} value={`clientFromPartner:${p.id}`}>{p.name}</option>)}</optgroup>
                        <option value="newClient">新しい取引先として登録</option>
                      </>
                    ) : (
                      <>
                        <optgroup label="隊員">{dir.guards.map(g => <option key={g.id} value={`guard:${g.id}`}>{g.employeeNumber} {g.name}</option>)}</optgroup>
                        <optgroup label="協力会社（再委託）">{dir.partners.map(p => <option key={p.id} value={`partner:${p.id}`}>{p.name}</option>)}</optgroup>
                        <option value="newGuard">新しい隊員として登録</option>
                        <option value="newPartner">新しい協力会社として登録</option>
                      </>
                    )}
                    <option value="skip">取り込まない</option>
                  </select>
                  {(e.resolution.action === 'newClient' || e.resolution.action === 'newPartner') && (
                    <input value={e.resolution.name ?? e.name} onChange={ev => onChange(e.name, { action: e.resolution.action as 'newClient', name: ev.target.value })}
                      className="form-input text-sm mt-1" placeholder="登録する名称" />
                  )}
                  {e.candidates.length > 0 && e.auto !== 'exact' && (
                    <p className="text-[11px] text-gray-400 mt-1">候補: {e.candidates.map(c => `${c.name}（${Math.round(c.score * 100)}）`).join('、')}</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// 同じ依頼主名でも現場によって契約（取引先）が違う場合に、現場ごとに取引先を変える
function SiteClientTable({ sites, dir, onChange }: { sites: SiteEntry[]; dir: Directory; onChange: (key: string, res: Resolution | null) => void }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const list = sites.filter(s => !filter || s.clientName.includes(filter) || s.siteName.includes(filter))
  return (
    <div className="card p-0 overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full px-4 py-3 flex items-center justify-between text-left">
        <span className="font-semibold text-gray-800 text-sm">現場ごとの取引先（{sites.length}現場・個別指定 {sites.filter(s => s.overridden).length}件）</span>
        <span className="text-xs text-gray-500">{open ? '閉じる' : '開く'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100">
          <p className="text-xs text-gray-500 px-4 pt-2">同じ依頼主でも契約が分かれている現場（例: 部署ごとに契約・請求書が分かれている取引先）だけ取引先を変えてください。</p>
          <div className="px-4 py-2"><input value={filter} onChange={e => setFilter(e.target.value)} className="form-input text-sm" placeholder="依頼主・現場名で絞り込み" /></div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {list.map(s => (
                <tr key={s.key}>
                  <td className="px-4 py-2"><p className="text-gray-800">{s.siteName}</p><p className="text-xs text-gray-400">{s.clientName}・{s.count}件{s.existing ? '・登録済みの現場' : ''}</p></td>
                  <td className="px-4 py-2 w-1/2">
                    <select value={s.overridden ? resToValue(s.resolution) : ''} onChange={e => onChange(s.key, e.target.value ? valueToRes(e.target.value, s.resolution) : null)} className="form-input text-sm">
                      <option value="">依頼主の設定に従う</option>
                      <optgroup label="既存の取引先">{dir.clients.map(c => <option key={c.id} value={`client:${c.id}`}>{c.name}</option>)}</optgroup>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ResultView({ result }: { result: ImportResult }) {
  const [showWarnings, setShowWarnings] = useState(false)
  const errors = result.issues.filter(i => i.level === 'error')
  const warnings = result.issues.filter(i => i.level === 'warning')
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {Object.entries(result.summary).map(([k, v]) => (
          <span key={k} className={`px-3 py-1.5 rounded-lg text-sm ${k === 'error' && v ? 'bg-red-50 text-red-700' : k === 'billingMismatch' && v ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>
            {SUMMARY_LABELS[k] ?? k}: <strong>{v.toLocaleString()}</strong>
          </span>
        ))}
      </div>
      {result.insurance && (
        <table className="w-full text-sm card p-0">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left px-3 py-2">項目</th><th className="text-left px-3 py-2">現在</th><th className="text-left px-3 py-2">取り込み後</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {result.insurance.map(i => <tr key={i.key}><td className="px-3 py-2">{i.label}</td><td className="px-3 py-2 text-gray-400">{i.current ?? '—'}</td><td className="px-3 py-2 font-medium">{i.next}</td></tr>)}
          </tbody>
        </table>
      )}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
          <p className="font-medium text-red-700 mb-1">エラー {errors.length}件（この行・項目は取り込まれません）</p>
          <ul className="space-y-0.5 text-red-700 text-xs max-h-48 overflow-y-auto">{errors.map((i, n) => <li key={n}>{i.row ? `${i.row}行目: ` : ''}{i.message}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
          <button type="button" onClick={() => setShowWarnings(s => !s)} className="font-medium text-amber-800">注意 {warnings.length}件 {showWarnings ? '▲' : '▼'}</button>
          {showWarnings && <ul className="mt-1 space-y-0.5 text-amber-800 text-xs max-h-64 overflow-y-auto">{warnings.map((i, n) => <li key={n}>{i.row ? `${i.row}行目: ` : ''}{i.message}</li>)}</ul>}
        </div>
      )}
      {result.changes.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-600">対象一覧（{result.changes.length}件）</summary>
          <ul className="mt-1 text-xs text-gray-600 max-h-64 overflow-y-auto divide-y divide-gray-50">
            {result.changes.map((c, n) => (
              <li key={n} className="py-1"><span className={`mr-2 px-1.5 rounded ${c.action === 'create' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{c.action === 'create' ? '新規' : '更新'}</span>{c.label}{c.detail ? <span className="text-gray-400">（{c.detail}）</span> : null}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function SheetPanel({ sheet, state, setState, companyId, dir, sourceName, onCommitted }: {
  sheet: ParsedSheet; state: SheetState; setState: (s: SheetState) => void; companyId?: string; dir: Directory; sourceName: string; onCommitted: () => void
}) {
  const kind = state.kind
  const header = state.headerRow >= 0 ? sheet.rows[state.headerRow] ?? [] : []
  const sample = state.headerRow >= 0 ? sheet.rows.slice(state.headerRow + 1).find(r => r.some(Boolean)) ?? [] : []
  const update = (patch: Partial<SheetState>) => setState({ ...state, ...patch, stale: !!state.preview, done: null })
  const request = (): ImportRequest => ({
    kind: kind as ImportKind, sourceName: `${sourceName} / ${sheet.name}`, rows: sheet.rows, headerRow: state.headerRow, mapping: state.mapping,
    clientResolutions: state.clientResolutions, peopleResolutions: state.peopleResolutions, siteClientOverrides: state.siteClientOverrides,
  })
  const preview = useMutation({
    mutationFn: () => api.post('/import/preview', request(), { params: { companyId } }).then(r => r.data as ImportResult),
    onSuccess: r => setState({ ...state, preview: r, stale: false, done: null }),
  })
  const commit = useMutation({
    mutationFn: () => api.post('/import/commit', request(), { params: { companyId } }).then(r => r.data as ImportResult),
    onSuccess: r => { setState({ ...state, done: r, preview: r, stale: false }); onCommitted() },
  })
  const setRes = (field: 'clientResolutions' | 'peopleResolutions', name: string, res: Resolution) =>
    update({ [field]: { ...state[field], [name]: res } } as Partial<SheetState>)
  const errors = state.preview?.issues.filter(i => i.level === 'error').length ?? 0
  const mergedNames = (entries: NameEntry[] | undefined, field: 'clientResolutions' | 'peopleResolutions') =>
    (entries ?? []).map(e => state[field][e.name] ? { ...e, resolution: state[field][e.name], auto: 'manual' as const } : e)
  const mergedSites = (state.preview?.sites ?? []).map(s => state.siteClientOverrides[s.key] ? { ...s, resolution: state.siteClientOverrides[s.key], overridden: true } : s)

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-[14rem]">
            <label className="form-label">取り込む内容</label>
            <select value={kind} onChange={e => {
              const k = e.target.value as ImportKind | ''
              update({ kind: k, headerRow: k === 'companyInsurance' ? -1 : Math.max(0, state.headerRow), mapping: k === 'companyInsurance' || !k ? {} : state.mapping, preview: null })
            }} className="form-input">
              <option value="">取り込まない</option>
              {IMPORT_ORDER.map(k => <option key={k} value={k}>{IMPORT_KINDS[k].label}</option>)}
            </select>
          </div>
          {kind && kind !== 'companyInsurance' && (
            <div className="w-28">
              <label className="form-label">見出しの行</label>
              <input type="number" min={1} max={20} value={state.headerRow + 1} onChange={e => update({ headerRow: Math.max(0, Number(e.target.value) - 1) })} className="form-input" />
            </div>
          )}
        </div>
        {kind === 'guards' && !dir.canEncryptMyNumber && (
          <p className="text-xs text-red-700 bg-red-50 rounded p-2">サーバーの暗号鍵（ENCRYPTION_KEY）が未設定のため、マイナンバーは取り込まれません（他の項目は取り込めます）。</p>
        )}
        {kind && kind !== 'companyInsurance' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left px-3 py-2">項目</th><th className="text-left px-3 py-2">シートの列</th><th className="text-left px-3 py-2">1件目の値</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {IMPORT_FIELDS[kind as TableImportKind].map(f => {
                  const col = state.mapping[f.key]
                  return (
                    <tr key={f.key}>
                      <td className="px-3 py-1.5 whitespace-nowrap">{f.label}{f.required ? <span className="text-red-500"> *</span> : null}</td>
                      <td className="px-3 py-1.5">
                        <select value={col ?? ''} onChange={e => {
                          const m = { ...state.mapping }
                          if (e.target.value === '') delete m[f.key]; else m[f.key] = Number(e.target.value)
                          update({ mapping: m })
                        }} className="form-input text-sm py-1">
                          <option value="">（使わない）</option>
                          {header.map((h, i) => <option key={i} value={i}>{colLabel(i)}: {h.replace(/\n/g, ' ') || '（見出しなし）'}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-gray-500 max-w-[16rem] truncate">{col !== undefined ? maskSample(f.key, sample[col] ?? '') : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {kind && (
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => preview.mutate()} disabled={preview.isPending} className="btn-secondary text-sm disabled:opacity-50">
              {preview.isPending ? '確認中...' : state.preview ? 'もう一度プレビュー' : 'プレビュー（まだ保存されません）'}
            </button>
            {preview.isError && <p className="text-sm text-red-600">{apiError(preview.error, 'プレビューに失敗しました')}</p>}
          </div>
        )}
      </div>

      {state.preview && (
        <div className="space-y-4">
          {kind === 'siteRequests' && (
            <>
              <NameResolutionTable title="依頼主 → 取引先" kind="client" dir={dir} entries={mergedNames(state.preview.clientNames, 'clientResolutions')} onChange={(n, r) => setRes('clientResolutions', n, r)} />
              <NameResolutionTable title="派遣者・再委託先 → 隊員／協力会社" kind="people" dir={dir} entries={mergedNames(state.preview.peopleNames, 'peopleResolutions')} onChange={(n, r) => setRes('peopleResolutions', n, r)} />
              <SiteClientTable sites={mergedSites} dir={dir} onChange={(key, res) => {
                const o = { ...state.siteClientOverrides }
                if (res) o[key] = res; else delete o[key]
                update({ siteClientOverrides: o })
              }} />
            </>
          )}
          <div className="card space-y-3">
            <h4 className="font-semibold text-gray-800 text-sm">{state.done ? '取り込み結果' : 'プレビュー'}{state.stale && <span className="ml-2 text-xs text-amber-700">（指定を変更しました。もう一度プレビューしてください）</span>}</h4>
            <ResultView result={state.preview} />
            {!state.done ? (
              <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                <button type="button" disabled={state.stale || commit.isPending} onClick={() => {
                  const msg = errors ? `エラーの ${errors} 件は取り込まれません。残りを取り込みますか？` : 'この内容で取り込みますか？（同じ内容を後から取り込み直すと更新になります）'
                  if (window.confirm(msg)) commit.mutate()
                }} className="btn-primary text-sm disabled:opacity-50">{commit.isPending ? '取り込み中...' : 'この内容で取り込む'}</button>
                {commit.isError && <p className="text-sm text-red-600">{apiError(commit.error, '取り込みに失敗しました（何も保存されていません）')}</p>}
              </div>
            ) : <p className="text-sm text-green-700 font-medium">✓ 取り込みました</p>}
          </div>
        </div>
      )}
    </div>
  )
}

const initialState = (sheet: ParsedSheet): SheetState => ({
  kind: sheet.detected?.kind ?? '',
  headerRow: sheet.detected?.headerRow ?? 0,
  mapping: sheet.detected?.mapping ?? {},
  clientResolutions: {}, peopleResolutions: {}, siteClientOverrides: {},
  preview: null, stale: false, done: null,
})

export default function ImportPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [companyId, setCompanyId] = useState<string | undefined>(undefined)
  const [url, setUrl] = useState('')
  const [source, setSource] = useState<{ sourceName: string; sheets: ParsedSheet[] } | null>(null)
  const [states, setStates] = useState<SheetState[]>([])
  const [active, setActive] = useState<number | null>(null)

  const { data: companies = [] } = useQuery({
    queryKey: ['super-admin-companies'],
    queryFn: () => api.get('/super-admin/companies').then(r => r.data),
    enabled: !!user?.isSuperAdmin,
  })
  const { data: dir, refetch: refetchDir } = useQuery<Directory>({
    queryKey: ['import-directory', companyId ?? 'self'],
    queryFn: () => api.get('/import/directory', { params: { companyId } }).then(r => r.data),
  })
  const { data: history = [] } = useQuery({
    queryKey: ['import-history', companyId ?? 'self'],
    queryFn: () => api.get('/import/history', { params: { companyId } }).then(r => r.data),
  })

  const loaded = (data: { sourceName: string; sheets: ParsedSheet[] }) => {
    setSource(data)
    setStates(data.sheets.map(initialState))
    const order = (s: ParsedSheet) => (s.detected ? IMPORT_ORDER.indexOf(s.detected.kind) : 99)
    const first = data.sheets.map((s, i) => [order(s), i]).sort((a, b) => a[0] - b[0])[0]
    setActive(first && first[0] < 99 ? first[1] : null)
  }
  const parseFile = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); return api.post('/import/parse', fd, { params: { companyId }, headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data) },
    onSuccess: loaded,
  })
  const parseUrl = useMutation({
    mutationFn: () => api.post('/import/parse-url', { url }, { params: { companyId } }).then(r => r.data),
    onSuccess: loaded,
  })

  const sheetOrder = useMemo(() => (source?.sheets ?? []).map((s, i) => i).sort((a, b) => {
    const k = (i: number) => (states[i]?.kind ? IMPORT_ORDER.indexOf(states[i].kind as ImportKind) : 99)
    return k(a) - k(b)
  }), [source, states])

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-gray-800">データ取り込み</h1>
        <p className="text-sm text-gray-500 mt-1">CSV・Excel・Googleスプレッドシートから、現場・隊員・契約・社保／雇用保険の情報を取り込みます。プレビューで内容を確認してから保存されます。同じデータを取り込み直すと、重複せずに更新されます。</p>
      </div>

      {user?.isSuperAdmin && (
        <div className="card">
          <label className="form-label">取り込み先の会社（スーパー管理者）</label>
          <select value={companyId ?? ''} onChange={e => { setCompanyId(e.target.value || undefined); setSource(null); setStates([]); setActive(null) }} className="form-input">
            <option value="">自社（{user.company?.name}）</option>
            {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}（{c.code}）</option>)}
          </select>
        </div>
      )}

      <div className="card space-y-3">
        <p className="text-sm text-gray-700">取り込み先: <strong>{dir?.company?.name ?? '…'}</strong></p>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="form-label">ファイルを選択（CSV・Excel .xlsx）</label>
            <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => { const f = e.target.files?.[0]; if (f) parseFile.mutate(f); e.target.value = '' }} className="form-input" />
          </div>
          <div>
            <label className="form-label">GoogleスプレッドシートのURL</label>
            <div className="flex gap-2">
              <input value={url} onChange={e => setUrl(e.target.value)} className="form-input flex-1" placeholder="https://docs.google.com/spreadsheets/d/…" />
              <button type="button" onClick={() => parseUrl.mutate()} disabled={!url || parseUrl.isPending} className="btn-secondary text-sm whitespace-nowrap disabled:opacity-50">読み込む</button>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">共有が「リンクを知っている全員」の場合に読み込めます。制限付きの場合は「ファイル → ダウンロード → Microsoft Excel」で保存したファイルを選択してください。</p>
          </div>
        </div>
        {(parseFile.isPending || parseUrl.isPending) && <p className="text-sm text-gray-500">読み込み中...</p>}
        {(parseFile.isError || parseUrl.isError) && <p className="text-sm text-red-600">{apiError(parseFile.error ?? parseUrl.error, '読み込みに失敗しました')}</p>}
      </div>

      {source && dir && (
        <div className="space-y-4">
          <div className="card space-y-2">
            <h3 className="font-semibold text-gray-800">{source.sourceName} のシート</h3>
            <p className="text-xs text-gray-500">上から順に取り込んでください（取引先・協力会社・隊員を先に登録すると、現場管理の名寄せが正確になります）。</p>
            <div className="space-y-1">
              {sheetOrder.map(i => {
                const s = source.sheets[i], st = states[i]
                return (
                  <button key={i} type="button" onClick={() => setActive(i)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left text-sm ${active === i ? 'border-[#1e3a5f] bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <span><span className="font-medium text-gray-800">{s.name}</span> <span className="text-gray-400 text-xs">{s.rows.length}行</span></span>
                    <span className="text-xs">
                      {st.kind ? <span className="text-gray-600">{IMPORT_KINDS[st.kind as ImportKind].label}</span> : <span className="text-gray-400">取り込まない</span>}
                      {st.done ? <span className="ml-2 text-green-700">✓ 取り込み済</span> : st.preview ? <span className="ml-2 text-blue-700">プレビュー済</span> : null}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          {active !== null && (
            <SheetPanel
              key={active}
              sheet={source.sheets[active]}
              state={states[active]}
              setState={s => setStates(prev => prev.map((x, i) => (i === active ? s : x)))}
              companyId={companyId}
              dir={dir}
              sourceName={source.sourceName}
              onCommitted={() => { refetchDir(); qc.invalidateQueries({ queryKey: ['import-history'] }) }}
            />
          )}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100"><h3 className="font-semibold text-gray-800 text-sm">取り込み履歴</h3></div>
        {history.length === 0 ? <p className="text-sm text-gray-400 px-4 py-4">まだ取り込みはありません</p> : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {history.map((h: any) => (
                <tr key={h.id}>
                  <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{new Date(h.createdAt).toLocaleString('ja-JP')}</td>
                  <td className="px-4 py-2">{IMPORT_KINDS[h.kind as ImportKind]?.label ?? h.kind}<p className="text-xs text-gray-400">{h.sourceName}・{h.createdByName}</p></td>
                  <td className="px-4 py-2 text-xs text-gray-600">{Object.entries(h.summary ?? {}).filter(([, v]) => v).map(([k, v]) => `${SUMMARY_LABELS[k] ?? (k === 'warnings' ? '注意' : k)} ${v}`).join('・')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
