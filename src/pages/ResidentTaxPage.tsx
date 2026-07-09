import React, { useState, useCallback } from 'react'

interface GuardTaxRow {
  guardId: string
  guardName: string
  months: Record<string, number>
}

const MONTHS = ['4', '5', '6', '7', '8', '9', '10', '11', '12', '1', '2', '3']
const MONTH_LABELS = ['4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月']

// モックデータ（将来的にAPIから取得）
const MOCK_GUARDS: GuardTaxRow[] = [
  { guardId: 'g1', guardName: '山田 太郎', months: {} },
  { guardId: 'g2', guardName: '佐藤 花子', months: {} },
  { guardId: 'g3', guardName: '鈴木 一郎', months: {} },
  { guardId: 'g4', guardName: '田中 美咲', months: {} },
  { guardId: 'g5', guardName: '高橋 健太', months: {} },
]

export default function ResidentTaxPage() {
  const [fiscalYear, setFiscalYear] = useState(2026)
  const [rows, setRows] = useState<GuardTaxRow[]>(() =>
    MOCK_GUARDS.map(g => ({
      ...g,
      months: Object.fromEntries(MONTHS.map(m => [m, 0])),
    }))
  )
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<string | null>(null)

  const handleCellChange = useCallback((guardId: string, month: string, value: string) => {
    const numValue = value === '' ? 0 : Number(value)
    if (isNaN(numValue)) return
    setRows(prev =>
      prev.map(r =>
        r.guardId === guardId
          ? { ...r, months: { ...r.months, [month]: numValue } }
          : r
      )
    )
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaveResult(null)
    try {
      // 将来的にAPIへPOST
      // const payload = rows.map(r => ({
      //   guardId: r.guardId,
      //   fiscalYear,
      //   monthlyAmounts: r.months,
      // }))
      // await api.post('/admin/resident-tax/bulk', payload)
      await new Promise(resolve => setTimeout(resolve, 500))
      setSaveResult('保存しました（モック）')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '保存に失敗しました'
      setSaveResult(`エラー: ${message}`)
    } finally {
      setSaving(false)
    }
  }

  const getRowTotal = (row: GuardTaxRow): number =>
    MONTHS.reduce((sum, m) => sum + (row.months[m] || 0), 0)

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">住民税 特別徴収管理</h1>
        <div className="flex items-center gap-3">
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
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary text-sm px-4 py-2 rounded-lg"
          >
            {saving ? '保存中...' : '一括保存'}
          </button>
        </div>
      </div>

      {/* 保存結果 */}
      {saveResult && (
        <div className={`text-sm px-4 py-2 rounded-lg ${
          saveResult.startsWith('エラー') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
        }`}>
          {saveResult}
        </div>
      )}

      {/* テーブル */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[120px]">
                隊員名
              </th>
              {MONTH_LABELS.map(label => (
                <th key={label} className="text-right px-2 py-3 font-medium text-gray-600 min-w-[80px]">
                  {label}
                </th>
              ))}
              <th className="text-right px-4 py-3 font-medium text-gray-600 min-w-[100px]">
                年間合計
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.guardId} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 font-medium text-gray-800 sticky left-0 bg-white">
                  {row.guardName}
                </td>
                {MONTHS.map(month => (
                  <td key={month} className="px-1 py-1">
                    <input
                      type="number"
                      value={row.months[month] || ''}
                      onChange={e => handleCellChange(row.guardId, month, e.target.value)}
                      placeholder="0"
                      className="w-full text-right text-sm px-2 py-1.5 border border-gray-200 rounded focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                    />
                  </td>
                ))}
                <td className="px-4 py-2 text-right font-semibold text-gray-800">
                  {getRowTotal(row).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 border-t border-gray-200">
              <td className="px-4 py-3 font-medium text-gray-600 sticky left-0 bg-gray-50">月計</td>
              {MONTHS.map(month => (
                <td key={month} className="px-2 py-3 text-right font-semibold text-gray-700">
                  {rows.reduce((sum, r) => sum + (r.months[month] || 0), 0).toLocaleString()}
                </td>
              ))}
              <td className="px-4 py-3 text-right font-bold text-gray-800">
                {rows.reduce((sum, r) => sum + getRowTotal(r), 0).toLocaleString()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        各隊員の住民税（特別徴収）月額を入力してください。年度は6月〜翌5月が通常ですが、表示は4月〜翌3月としています。
      </p>
    </div>
  )
}
