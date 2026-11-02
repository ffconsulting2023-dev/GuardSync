import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { withTax } from '../../shared/recruitment'

interface Row { id: string; name: string; employeeNumber: string; isActive: boolean; note: string | null; hireDate: string | null; shifts: number; futureShifts: number; fee: number; excluded: Record<string, number> }
interface Group {
  key: string; kind: 'channel' | 'agency' | 'free' | 'none'; name: string; hasRules?: boolean; rows: Row[]
  totals: { guards: number; workingGuards: number; shifts: number; futureShifts: number; fee: number; feeWithTax: number }
}
interface Report { from: string; to: string; today: string; groups: Group[] }

const yen = (n: number) => `${n.toLocaleString()}円`
const KIND_LABEL: Record<Group['kind'], string> = { agency: '人材紹介会社', channel: '媒体', free: 'その他', none: '未設定' }

// 人材紹介会社への紹介料の確認用CSV（Excel で開けるよう BOM 付き UTF-8）
function downloadCsv(report: Report, group: Group) {
  const head = ['社員番号', '氏名', '入社日（初回勤務）', '勤務数', '紹介料（税別）', '紹介料（税込）', '対象外の勤務']
  const lines = group.rows.map(r => [r.employeeNumber, r.name, r.hireDate ?? '', r.shifts, r.fee, withTax(r.fee), Object.entries(r.excluded).map(([k, v]) => `${k}:${v}`).join(' ')])
  lines.push(['', '合計', '', group.totals.shifts, group.totals.fee, group.totals.feeWithTax, ''])
  const csv = [head, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }))
  a.download = `紹介料_${group.name}_${report.from}_${report.to}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // すぐに破棄するとファイル名が付かずに保存されるため、少し待ってから破棄する
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// 採用経路別の稼働実績と、人材紹介会社への紹介料（勤務数 × 単価ルール）
export default function RecruitmentReportPage() {
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const from = custom?.from ?? format(month, 'yyyy-MM-dd')
  const to = custom?.to ?? format(endOfMonth(month), 'yyyy-MM-dd')
  const { data, isLoading, error } = useQuery<Report>({
    queryKey: ['recruitment-report', from, to],
    queryFn: () => api.get('/recruitment/report', { params: { from, to } }).then(r => r.data),
  })
  const agencyTotal = (data?.groups ?? []).filter(g => g.kind === 'agency').reduce((a, g) => a + g.totals.fee, 0)

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">採用経路別 稼働実績</h1>
          <p className="text-xs text-gray-500">勤務数は中止を除く配員の件数です（今日より後の配員は「予定」として別に表示し、紹介料には含めません）。紹介料の単価は <Link to="/settings" className="text-blue-600 underline">設定 → 採用経路</Link> で設定します。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!custom ? (
            <>
              <button onClick={() => setMonth(m => subMonths(m, 1))} className="btn-secondary text-sm px-3">‹</button>
              <span className="font-medium text-gray-700 w-32 text-center whitespace-nowrap">{format(month, 'yyyy年M月', { locale: ja })}</span>
              <button onClick={() => setMonth(m => addMonths(m, 1))} className="btn-secondary text-sm px-3">›</button>
              <button onClick={() => setCustom({ from, to })} className="text-xs text-blue-600">期間を指定</button>
            </>
          ) : (
            <>
              <div className="w-40"><input type="date" value={custom.from} onChange={e => setCustom(c => ({ ...c!, from: e.target.value }))} className="form-input text-sm" /></div>
              <span>〜</span>
              <div className="w-40"><input type="date" value={custom.to} onChange={e => setCustom(c => ({ ...c!, to: e.target.value }))} className="form-input text-sm" /></div>
              <button onClick={() => setCustom(null)} className="text-xs text-blue-600">月で表示</button>
            </>
          )}
        </div>
      </div>

      {error && <div className="card text-sm text-red-600">{(error as any)?.response?.data?.error || '集計できませんでした'}</div>}
      {isLoading && <div className="card text-center py-8 text-gray-400">集計中...</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card py-3"><p className="text-xs text-gray-500">勤務数（実績）</p><p className="text-lg font-bold">{data.groups.reduce((a, g) => a + g.totals.shifts, 0)}件</p></div>
            <div className="card py-3"><p className="text-xs text-gray-500">稼働した隊員</p><p className="text-lg font-bold">{data.groups.reduce((a, g) => a + g.totals.workingGuards, 0)}名</p></div>
            <div className="card py-3"><p className="text-xs text-gray-500">紹介料（税別）</p><p className="text-lg font-bold">{yen(agencyTotal)}</p></div>
            <div className="card py-3"><p className="text-xs text-gray-500">紹介料（税込）</p><p className="text-lg font-bold">{yen(withTax(agencyTotal))}</p></div>
          </div>

          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2">採用経路</th>
                  <th className="text-right px-4 py-2 whitespace-nowrap">隊員（稼働）</th>
                  <th className="text-right px-4 py-2 whitespace-nowrap">勤務数</th>
                  <th className="text-right px-4 py-2 whitespace-nowrap">予定</th>
                  <th className="text-right px-4 py-2 whitespace-nowrap">紹介料（税別）</th>
                  <th className="text-right px-4 py-2 whitespace-nowrap">税込</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.groups.map(g => (
                  <React.Fragment key={g.key}>
                    <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(o => (o === g.key ? null : g.key))}>
                      <td className="px-4 py-2">
                        <span className="text-[11px] text-gray-400 mr-2">{KIND_LABEL[g.kind]}</span>
                        <span className="font-medium text-gray-800">{g.name}</span>
                        {g.kind === 'agency' && !g.hasRules && <span className="ml-2 text-[11px] text-amber-700">単価ルール未設定</span>}
                      </td>
                      <td className="px-4 py-2 text-right">{g.totals.guards}名（{g.totals.workingGuards}）</td>
                      <td className="px-4 py-2 text-right font-medium">{g.totals.shifts}</td>
                      <td className="px-4 py-2 text-right text-gray-400">{g.totals.futureShifts || ''}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{g.kind === 'agency' ? yen(g.totals.fee) : '—'}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{g.kind === 'agency' ? yen(g.totals.feeWithTax) : '—'}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {g.kind === 'agency' && <button type="button" onClick={e => { e.stopPropagation(); downloadCsv(data, g) }} className="text-xs text-blue-600 mr-3">CSV</button>}
                        <span className="text-xs text-gray-400">{open === g.key ? '▲' : '▼'}</span>
                      </td>
                    </tr>
                    {open === g.key && g.rows.map(r => (
                      <tr key={r.id} className="bg-gray-50/60 text-xs">
                        <td className="pl-10 pr-4 py-1.5">
                          <span className="text-gray-400 mr-2">{r.employeeNumber}</span>{r.name}{!r.isActive && <span className="text-gray-400">（退職）</span>}
                          {r.note && <span className="text-gray-400 ml-2">{r.note}</span>}
                          {r.hireDate && <span className="text-gray-400 ml-2">入社 {r.hireDate}</span>}
                          {Object.entries(r.excluded).map(([k, v]) => <span key={k} className="ml-2 text-amber-700">対象外 {v}件（{k}）</span>)}
                        </td>
                        <td className="px-4 py-1.5"></td>
                        <td className="px-4 py-1.5 text-right">{r.shifts}</td>
                        <td className="px-4 py-1.5 text-right text-gray-400">{r.futureShifts || ''}</td>
                        <td className="px-4 py-1.5 text-right whitespace-nowrap">{g.kind === 'agency' ? yen(r.fee) : ''}</td>
                        <td className="px-4 py-1.5 text-right whitespace-nowrap">{g.kind === 'agency' ? yen(withTax(r.fee)) : ''}</td>
                        <td></td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                {data.groups.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-400">対象の隊員がいません</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">紹介料 = 対象期間内の勤務数 × その勤務日に適用される単価（夜勤単価がある場合は夜勤に適用）。税込は消費税10%（円未満切り捨て）。入社日が未登録の隊員は初回勤務日を入社日とみなします。</p>
        </>
      )}
    </div>
  )
}
