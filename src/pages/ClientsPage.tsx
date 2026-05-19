import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

// ─────────────────────────────────────────────
// 定数・型定義
// ─────────────────────────────────────────────

export const CATEGORIES: Record<string, { label: string; color: string }> = {
  GOVERNMENT:   { label: '官公庁',     color: 'bg-purple-100 text-purple-700' },
  PRIVATE:      { label: '民間企業',   color: 'bg-blue-100 text-blue-700' },
  CONSTRUCTION: { label: '建設・工事', color: 'bg-orange-100 text-orange-700' },
  COMMERCIAL:   { label: '商業施設',   color: 'bg-green-100 text-green-700' },
  INDIVIDUAL:   { label: '個人',       color: 'bg-gray-100 text-gray-600' },
  OTHER:        { label: 'その他',     color: 'bg-gray-100 text-gray-500' },
}

export const EMPTY_CLIENT_FORM = {
  name: '', nameKana: '', category: 'OTHER', positionTitle: '', contactName: '',
  phone: '', fax: '', email: '', website: '', industry: '', relationship: '',
  accountingContactName: '', accountingPhone: '', accountingEmail: '', notes: '',
  subContacts: [
    { name: '', phone: '', email: '' }, { name: '', phone: '', email: '' },
    { name: '', phone: '', email: '' }, { name: '', phone: '', email: '' },
  ],
  postalCode: '', prefecture: '', city: '', addressDetail: '', buildingName: '', addressee: '',
  billingSameAsCompany: true,
  billingPostalCode: '', billingPrefecture: '', billingCity: '', billingAddressDetail: '', billingBuildingName: '', billingAddressee: '',
  documents: { unitPriceContract: false, otherContract: false, invoiceSend: false, invoiceReceive: false, securityLog: false, securityCommission: false, other: false },
  bankName: '', bankBranch: '', bankAccountType: '普通', bankAccountNumber: '', bankAccountHolder: '',
  contractDate: '', unitPriceDay: '', unitPriceNight: '', unitPriceHolidayDay: '', unitPriceHolidayNight: '',
  overtimeDayRate: '', overtimeNightRate: '', overtimeHolidayDayRate: '', overtimeHolidayNightRate: '',
  qualificationAllowance: '', radioAllowance: '', otherAllowance1: '', otherAllowance2: '',
  invoiceRegistrationNumber: '',
}

// ─────────────────────────────────────────────
// カラム設定
// ─────────────────────────────────────────────

interface ColDef {
  key: string
  label: string
  visible: boolean
  width: number
  minWidth: number
  required?: boolean   // 非表示にできない
}

const CONFIGURABLE_DEFAULTS: ColDef[] = [
  { key: 'clientCode',       label: '取引先コード', visible: true,  width: 110, minWidth: 80 },
  { key: 'name',             label: '取引先名',    visible: true,  width: 180, minWidth: 100, required: true },
  { key: 'nameKana',         label: 'フリガナ',    visible: true,  width: 120, minWidth: 70 },
  { key: 'category',         label: '区分',        visible: false, width: 100, minWidth: 70 },
  { key: 'prefecture',       label: '都道府県',    visible: true,  width: 90,  minWidth: 70 },
  { key: 'city',             label: '市区町村',    visible: true,  width: 100, minWidth: 70 },
  { key: 'contactName',      label: '代表者名',    visible: true,  width: 110, minWidth: 80 },
  { key: 'phone',            label: '代表電話',    visible: true,  width: 130, minWidth: 90 },
  { key: 'fax',              label: 'FAX番号',     visible: false, width: 130, minWidth: 90 },
  { key: 'email',            label: 'メール',      visible: false, width: 160, minWidth: 100 },
  { key: 'subContact1Name',  label: '担当者1',     visible: false, width: 100, minWidth: 80 },
  { key: 'subContact1Phone', label: '連絡先1',     visible: false, width: 120, minWidth: 80 },
  { key: 'notes',            label: '備考',        visible: false, width: 150, minWidth: 80 },
  { key: 'sites',            label: '現場一覧',    visible: true,  width: 80,  minWidth: 60,  required: true },
]

const STORAGE_KEY = 'guardSync_clientColumns_v2'

function loadColumns(): ColDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return CONFIGURABLE_DEFAULTS
    const saved: { key: string; visible: boolean; width: number }[] = JSON.parse(raw)
    // 保存順を維持しつつデフォルトとマージ
    const merged = saved
      .map(s => { const def = CONFIGURABLE_DEFAULTS.find(d => d.key === s.key); return def ? { ...def, visible: s.visible, width: s.width } : null })
      .filter(Boolean) as ColDef[]
    // 保存にない新しいカラムを末尾に追加
    CONFIGURABLE_DEFAULTS.forEach(d => { if (!merged.find(m => m.key === d.key)) merged.push(d) })
    return merged
  } catch {
    return CONFIGURABLE_DEFAULTS
  }
}

function saveColumns(cols: ColDef[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cols.map(c => ({ key: c.key, visible: c.visible, width: c.width }))))
}

// ─────────────────────────────────────────────
// 表示設定パネル
// ─────────────────────────────────────────────

function SettingsPanel({ columns, onChange, onReset, onClose }: {
  columns: ColDef[]
  onChange: (cols: ColDef[]) => void
  onReset: () => void
  onClose: () => void
}) {
  const dragIdx = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const handleDragStart = (i: number) => { dragIdx.current = i }
  const handleDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOver(i) }
  const handleDrop = (i: number) => {
    const from = dragIdx.current
    if (from === null || from === i) { setDragOver(null); return }
    const next = [...columns]
    const [moved] = next.splice(from, 1)
    next.splice(i, 0, moved)
    onChange(next)
    dragIdx.current = null
    setDragOver(null)
  }
  const handleDragEnd = () => { dragIdx.current = null; setDragOver(null) }

  const toggle = (i: number) => {
    if (columns[i].required) return
    onChange(columns.map((c, idx) => idx === i ? { ...c, visible: !c.visible } : c))
  }

  const setWidth = (i: number, w: number) => {
    onChange(columns.map((c, idx) => idx === i ? { ...c, width: Math.max(c.minWidth, Math.min(400, w)) } : c))
  }

  return (
    <div className="absolute right-0 top-10 z-40 bg-white border border-gray-200 rounded-xl shadow-2xl w-80">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <p className="font-semibold text-gray-800 text-sm">表示設定</p>
          <p className="text-xs text-gray-400 mt-0.5">ドラッグで並び替え・幅を変更</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onReset} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">リセット</button>
          <button onClick={onClose} className="w-6 h-6 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 flex items-center justify-center text-sm">✕</button>
        </div>
      </div>

      {/* カラムリスト */}
      <div className="max-h-96 overflow-y-auto py-2">
        {/* 固定ヘッダー行 */}
        <div className="flex items-center px-4 py-1 mb-1">
          <span className="w-5" />
          <span className="w-5" />
          <span className="flex-1 text-xs text-gray-400">列名</span>
          <span className="text-xs text-gray-400 w-20 text-center">幅 (px)</span>
        </div>

        {columns.map((col, i) => (
          <div
            key={col.key}
            draggable
            onDragStart={() => handleDragStart(i)}
            onDragOver={e => handleDragOver(e, i)}
            onDrop={() => handleDrop(i)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-2 px-4 py-1.5 transition-colors cursor-grab active:cursor-grabbing select-none ${
              dragIdx.current === i ? 'opacity-40 bg-gray-50' : dragOver === i ? 'bg-blue-50 border-t-2 border-blue-400' : 'hover:bg-gray-50'
            }`}
          >
            {/* ドラッグハンドル */}
            <svg className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" fill="currentColor" viewBox="0 0 16 16">
              <circle cx="5" cy="4" r="1.2" /><circle cx="5" cy="8" r="1.2" /><circle cx="5" cy="12" r="1.2" />
              <circle cx="11" cy="4" r="1.2" /><circle cx="11" cy="8" r="1.2" /><circle cx="11" cy="12" r="1.2" />
            </svg>

            {/* 表示チェック */}
            <input
              type="checkbox"
              checked={col.visible}
              onChange={() => toggle(i)}
              disabled={col.required}
              className="w-4 h-4 flex-shrink-0 cursor-pointer"
              title={col.required ? '必須列は非表示にできません' : ''}
            />

            {/* 列名 */}
            <span className={`flex-1 text-sm truncate ${col.required ? 'text-gray-400' : col.visible ? 'text-gray-700' : 'text-gray-400 line-through'}`}>
              {col.label}
            </span>

            {/* 幅入力 */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => setWidth(i, col.width - 10)} className="w-5 h-5 rounded border border-gray-200 text-gray-400 hover:bg-gray-100 text-xs flex items-center justify-center">−</button>
              <input
                type="number"
                value={col.width}
                onChange={e => setWidth(i, Number(e.target.value))}
                className="w-14 text-xs border border-gray-200 rounded px-1 py-0.5 text-center focus:outline-none focus:border-blue-400"
                min={col.minWidth}
                max={400}
                onClick={e => e.stopPropagation()}
              />
              <button onClick={() => setWidth(i, col.width + 10)} className="w-5 h-5 rounded border border-gray-200 text-gray-400 hover:bg-gray-100 text-xs flex items-center justify-center">+</button>
            </div>
          </div>
        ))}
      </div>

      {/* フッター */}
      <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
        <p className="text-xs text-gray-400">
          表示中: {columns.filter(c => c.visible).length} / {columns.length} 列
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// メインページ
// ─────────────────────────────────────────────

export default function ClientsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('ALL')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  // カラム設定状態
  const [columns, setColumns] = useState<ColDef[]>(loadColumns)

  // 設定変更時にlocalStorageへ保存
  const handleColumnsChange = useCallback((next: ColDef[]) => {
    setColumns(next)
    saveColumns(next)
  }, [])

  const handleReset = () => handleColumnsChange(CONFIGURABLE_DEFAULTS)

  // 設定パネル外クリックで閉じる
  useEffect(() => {
    if (!showSettings) return
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setShowSettings(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSettings])

  // カラムヘッダードラッグリサイズ
  const startResize = useCallback((e: React.MouseEvent, key: string, startWidth: number) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      const diff = ev.clientX - startX
      setColumns(prev => {
        const next = prev.map(c => {
          if (c.key !== key) return c
          return { ...c, width: Math.max(c.minWidth, startWidth + diff) }
        })
        saveColumns(next)
        return next
      })
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/clients/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  })

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients', activeCategory, search],
    queryFn: () => api.get(`/clients?category=${activeCategory}&search=${encodeURIComponent(search)}`).then(r => r.data),
  })

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')
  const CATEGORY_TABS = [{ key: 'ALL', label: '全て' }, ...Object.entries(CATEGORIES).map(([k, v]) => ({ key: k, label: v.label }))]

  // 表示カラム（NO.と操作列は固定）
  const visibleCols = columns.filter(c => c.visible)
  const NO_COL: ColDef  = { key: 'no',     label: 'NO.',  visible: true, width: 52,  minWidth: 40, required: true }
  const ACT_COL: ColDef = { key: 'action', label: '',     visible: true, width: 44,  minWidth: 44, required: true }
  const allVisible = [NO_COL, ...visibleCols, ACT_COL]
  const totalWidth = allVisible.reduce((s, c) => s + c.width, 0)

  const getCellValue = (client: any, key: string, index: number) => {
    const sub = Array.isArray(client.subContacts) ? client.subContacts : []
    switch (key) {
      case 'no':            return <span className="text-gray-400 text-xs">{index + 1}</span>
      case 'clientCode':    return <span className="font-mono text-xs text-gray-500">{client.clientCode || '—'}</span>
      case 'name':          return <span className="font-semibold text-[#1e3a5f]">{client.name}</span>
      case 'nameKana':      return <span className="text-gray-500 text-xs">{client.nameKana || ''}</span>
      case 'category':      return client.category ? <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORIES[client.category]?.color}`}>{CATEGORIES[client.category]?.label}</span> : null
      case 'prefecture':    return <span className="text-gray-600 text-xs">{client.prefecture || ''}</span>
      case 'city':          return <span className="text-gray-600 text-xs">{client.city || ''}</span>
      case 'contactName':   return <span className="text-gray-700 text-xs">{client.contactName || ''}</span>
      case 'phone':         return <span className="text-gray-600 text-xs">{client.phone || ''}</span>
      case 'fax':           return <span className="text-gray-500 text-xs">{client.fax || ''}</span>
      case 'email':         return <span className="text-gray-500 text-xs truncate block">{client.email || ''}</span>
      case 'subContact1Name':  return <span className="text-gray-600 text-xs">{sub[0]?.name || ''}</span>
      case 'subContact1Phone': return <span className="text-gray-500 text-xs">{sub[0]?.phone || ''}</span>
      case 'notes':         return <span className="text-gray-400 text-xs truncate block">{client.notes || ''}</span>
      case 'sites':         return (
        <button onClick={e => { e.stopPropagation(); navigate(`/clients/${client.id}?tab=history`) }}
          className="text-xs text-blue-600 hover:text-blue-800 hover:underline">
          現場({client._count?.sites ?? 0})
        </button>
      )
      case 'action':        return canEdit ? (
        <div className="relative">
          <button onClick={e => { e.stopPropagation(); setMenuOpenId(menuOpenId === client.id ? null : client.id) }}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
              <circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" />
            </svg>
          </button>
          {menuOpenId === client.id && (
            <div className="absolute right-0 top-7 z-20 bg-white border border-gray-200 rounded-lg shadow-lg min-w-28 py-1">
              <button onClick={() => navigate(`/clients/${client.id}`)} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">編集</button>
              <button onClick={() => { if (window.confirm(`${client.name}を削除しますか？`)) { deleteMutation.mutate(client.id); setMenuOpenId(null) } }} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">削除</button>
            </div>
          )}
        </div>
      ) : null
      default: return null
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4" onClick={() => setMenuOpenId(null)}>
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#1e3a5f] rounded-lg flex items-center justify-center text-white font-bold text-sm">取引</div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">取引先管理</h1>
            <p className="text-xs text-[#1e3a5f] font-medium">{clients.length}件の取引先</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="取引先名、コード、担当者で検索..."
              className="form-input pl-9 w-56 text-sm"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button onClick={() => qc.invalidateQueries({ queryKey: ['clients'] })} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50" title="更新">
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* 表示設定ボタン */}
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setShowSettings(s => !s)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${
                showSettings ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
              表示設定
            </button>
            {showSettings && (
              <SettingsPanel
                columns={columns}
                onChange={handleColumnsChange}
                onReset={handleReset}
                onClose={() => setShowSettings(false)}
              />
            )}
          </div>

          {canEdit && (
            <button onClick={() => navigate('/clients/new')} className="btn-primary text-sm flex items-center gap-1">
              <span>+</span><span>新規登録</span>
            </button>
          )}
        </div>
      </div>

      {/* 区分フィルタ */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-xs text-gray-400 mr-1">絞り込み:</span>
        {CATEGORY_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveCategory(tab.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeCategory === tab.key ? 'bg-[#1e3a5f] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* テーブル */}
      {isLoading ? (
        <div className="text-center py-16 text-gray-400">読み込み中...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table style={{ tableLayout: 'fixed', width: totalWidth, minWidth: '100%' }}>
              <colgroup>
                {allVisible.map(col => <col key={col.key} style={{ width: col.width }} />)}
              </colgroup>
              <thead>
                <tr className="bg-[#1e3a5f]">
                  {allVisible.map(col => (
                    <th
                      key={col.key}
                      className="relative px-3 py-3 text-left text-xs font-semibold text-white select-none whitespace-nowrap overflow-hidden"
                      style={{ width: col.width }}
                    >
                      <span className="truncate block pr-2">{col.label}</span>
                      {/* リサイズハンドル */}
                      {col.key !== 'action' && (
                        <div
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize group"
                          onMouseDown={e => startResize(e, col.key, col.width)}
                        >
                          <div className="h-full w-0.5 mx-auto opacity-0 group-hover:opacity-100 bg-white/40 transition-opacity" />
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clients.length === 0 ? (
                  <tr>
                    <td colSpan={allVisible.length} className="text-center py-16 text-gray-400">
                      取引先が登録されていません
                    </td>
                  </tr>
                ) : (
                  clients.map((client: any, index: number) => (
                    <tr
                      key={client.id}
                      className="hover:bg-blue-50/30 cursor-pointer transition-colors"
                      onClick={() => navigate(`/clients/${client.id}`)}
                    >
                      {allVisible.map(col => (
                        <td
                          key={col.key}
                          className="px-3 py-3 overflow-hidden"
                          style={{ width: col.width, maxWidth: col.width }}
                          onClick={col.key === 'sites' || col.key === 'action' ? e => e.stopPropagation() : undefined}
                        >
                          <div className="truncate">
                            {getCellValue(client, col.key, index)}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* フッター */}
          {clients.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
              <p className="text-xs text-gray-400">{clients.length}件</p>
              <p className="text-xs text-gray-400">表示列: {visibleCols.length}列 / 列幅はヘッダー右端をドラッグで変更</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
