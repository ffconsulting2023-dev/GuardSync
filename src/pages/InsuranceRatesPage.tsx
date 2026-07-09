import React, { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

type TabKey = 'health' | 'pension' | 'employment' | 'income-tax'

const TABS: { key: TabKey; label: string; apiPath: string }[] = [
  { key: 'health', label: '健康保険', apiPath: 'health-insurance' },
  { key: 'pension', label: '厚生年金', apiPath: 'pension' },
  { key: 'employment', label: '雇用保険', apiPath: 'employment-insurance' },
  { key: 'income-tax', label: '源泉徴収', apiPath: 'income-tax' },
]

const CSV_TEMPLATES: Record<TabKey, { filename: string; headers: string[] }> = {
  health: {
    filename: 'health_insurance_template.csv',
    headers: ['grade', 'monthlyFrom', 'monthlyTo', 'standardMonthly', 'healthRate', 'healthHalf', 'careRate', 'careHalf'],
  },
  pension: {
    filename: 'pension_template.csv',
    headers: ['grade', 'monthlyFrom', 'monthlyTo', 'standardMonthly', 'pensionRate', 'pensionHalf'],
  },
  employment: {
    filename: 'employment_insurance_template.csv',
    headers: ['category', 'employeeRate', 'employerRate', 'totalRate'],
  },
  'income-tax': {
    filename: 'income_tax_template.csv',
    headers: ['salaryFrom', 'salaryTo', 'dependents0', 'dependents1', 'dependents2', 'dependents3', 'dependents4', 'dependents5', 'dependents6', 'dependents7'],
  },
}

interface MasterDataSummary {
  healthInsurance: number
  pension: number
  employmentInsurance: number
  incomeTax: number
}

function parseCSV(text: string): Record<string, unknown>[] {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim())
    const obj: Record<string, unknown> = {}
    headers.forEach((h, i) => {
      const val = values[i] ?? ''
      obj[h] = val !== '' && !isNaN(Number(val)) ? Number(val) : val
    })
    return obj
  })
}

export default function InsuranceRatesPage() {
  const qc = useQueryClient()
  const [fiscalYear, setFiscalYear] = useState(2026)
  const [activeTab, setActiveTab] = useState<TabKey>('health')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: summary, isLoading } = useQuery<MasterDataSummary>({
    queryKey: ['master-data', fiscalYear],
    queryFn: () => api.get(`/admin/master-data/${fiscalYear}`).then(r => r.data),
  })

  const handleImport = async (file: File, type: string) => {
    setImporting(true)
    setImportResult(null)
    try {
      const text = await file.text()
      const data = parseCSV(text)
      if (data.length === 0) {
        setImportResult('CSVにデータ行がありません')
        return
      }
      await api.post(`/admin/import/${type}`, { fiscalYear, data })
      setImportResult(`${data.length}件のデータをインポートしました`)
      qc.invalidateQueries({ queryKey: ['master-data', fiscalYear] })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'インポートに失敗しました'
      setImportResult(`エラー: ${message}`)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const tab = TABS.find(t => t.key === activeTab)
    if (tab) handleImport(file, tab.apiPath)
  }

  const downloadTemplate = () => {
    const tmpl = CSV_TEMPLATES[activeTab]
    const csvContent = tmpl.headers.join(',') + '\n'
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = tmpl.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const summaryCards = [
    { label: '健康保険', count: summary?.healthInsurance ?? 0, color: 'bg-blue-50 text-blue-700' },
    { label: '厚生年金', count: summary?.pension ?? 0, color: 'bg-green-50 text-green-700' },
    { label: '雇用保険', count: summary?.employmentInsurance ?? 0, color: 'bg-yellow-50 text-yellow-700' },
    { label: '源泉徴収', count: summary?.incomeTax ?? 0, color: 'bg-red-50 text-red-700' },
  ]

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">社会保険マスタ管理</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">年度:</label>
          <select
            value={fiscalYear}
            onChange={e => setFiscalYear(Number(e.target.value))}
            className="form-select text-sm rounded-lg border-gray-300"
          >
            {[2024, 2025, 2026, 2027].map(y => (
              <option key={y} value={y}>{y}年度</option>
            ))}
          </select>
        </div>
      </div>

      {/* サマリーカード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summaryCards.map(card => (
          <div key={card.label} className={`rounded-xl p-4 ${card.color}`}>
            <p className="text-xs font-medium opacity-70">{card.label}</p>
            <p className="text-2xl font-bold mt-1">
              {isLoading ? '-' : card.count}
              <span className="text-sm font-normal ml-1">件</span>
            </p>
          </div>
        ))}
      </div>

      {/* タブ */}
      <div className="border-b border-gray-200">
        <div className="flex gap-0">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setImportResult(null) }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* タブコンテンツ */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-4">
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="btn-primary text-sm px-4 py-2 rounded-lg"
          >
            {importing ? 'インポート中...' : 'CSVインポート'}
          </button>
          <button
            onClick={downloadTemplate}
            className="btn-secondary text-sm px-4 py-2 rounded-lg"
          >
            テンプレートDL
          </button>
        </div>

        {importResult && (
          <div className={`text-sm px-4 py-2 rounded-lg ${
            importResult.startsWith('エラー') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
          }`}>
            {importResult}
          </div>
        )}

        {/* データテーブル（サマリー情報のみ） */}
        <div className="text-sm text-gray-500">
          <p>
            {TABS.find(t => t.key === activeTab)?.label}のマスタデータ:
            <span className="font-semibold text-gray-800 ml-1">
              {isLoading ? '読込中...' : `${summaryCards.find(c => c.label === TABS.find(t => t.key === activeTab)?.label)?.count ?? 0}件`}
            </span>
          </p>
          <p className="mt-2 text-xs text-gray-400">
            CSVインポートでデータを登録・更新してください。テンプレートDLボタンでヘッダー行のみのCSVを取得できます。
          </p>
        </div>
      </div>
    </div>
  )
}
