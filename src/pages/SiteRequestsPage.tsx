import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, addMonths, subMonths } from 'date-fns'
import { ja } from 'date-fns/locale'
import { api } from '../lib/api'
import { SITE_REQUEST_STATUS, type SiteRequestStatus } from '../../shared/siteRequest'

interface SiteRequestRow {
  id: string
  date: string
  timeLabel: string | null
  startTime: string | null
  endTime: string | null
  shiftType: string
  status: SiteRequestStatus
  requestedCount: number
  qualifiedCount: number
  unitPrice: number | null
  transportFee: number | null
  subcontractCount: number
  subcontractUnitPrice: number | null
  notes: string | null
  billingEstimate: number
  site: { id: string; name: string; nearestStation: string | null; client: { id: string; name: string } | null }
  subcontractPartner: { id: string; name: string } | null
  schedules: { id: string; guard: { id: string; name: string } }[]
}

const yen = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString()}円`)

// 現場依頼（受注実績）: 日ごとの依頼・配員・再委託・請求見込み（スプレッドシート「現場管理」の移行先）
export default function SiteRequestsPage() {
  const [month, setMonth] = useState(new Date())
  const [clientId, setClientId] = useState('')
  const monthKey = format(month, 'yyyy-MM')
  const { data: rows = [], isLoading } = useQuery<SiteRequestRow[]>({
    queryKey: ['site-requests', monthKey],
    queryFn: () => api.get('/site-requests', { params: { month: monthKey } }).then(r => r.data),
  })

  const clients = useMemo(() => {
    const m = new Map<string, string>()
    rows.forEach(r => r.site.client && m.set(r.site.client.id, r.site.client.name))
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'ja'))
  }, [rows])
  const list = clientId ? rows.filter(r => r.site.client?.id === clientId) : rows
  // 中止は件数のみ数え、人数・請求には含めない。予定（稼働日数が未確定）は請求を分けて表示する
  const totals = list.reduce((t, r) => {
    if (r.status === 'CANCELLED') return { ...t, cancelled: t.cancelled + 1 }
    return {
      ...t,
      requests: t.requests + 1,
      people: t.people + r.requestedCount,
      assigned: t.assigned + r.schedules.length,
      subcontracted: t.subcontracted + r.subcontractCount,
      billing: t.billing + (r.status === 'CONFIRMED' ? r.billingEstimate : 0),
      planned: t.planned + (r.status === 'PLANNED' ? r.billingEstimate : 0),
    }
  }, { requests: 0, people: 0, assigned: 0, subcontracted: 0, billing: 0, planned: 0, cancelled: 0 })
  const byClient = useMemo(() => {
    const m = new Map<string, { name: string; count: number; billing: number }>()
    for (const r of rows) {
      if (r.status !== 'CONFIRMED') continue
      const k = r.site.client?.id ?? '-'
      const e = m.get(k) ?? { name: r.site.client?.name ?? '（取引先なし）', count: 0, billing: 0 }
      e.count++; e.billing += r.billingEstimate
      m.set(k, e)
    }
    return [...m.values()].sort((a, b) => b.billing - a.billing)
  }, [rows])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-800">受注実績（現場依頼）</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(m => subMonths(m, 1))} className="btn-secondary text-sm px-3">‹</button>
          <span className="font-medium text-gray-700 w-32 text-center whitespace-nowrap">{format(month, 'yyyy年M月', { locale: ja })}</span>
          <button onClick={() => setMonth(m => addMonths(m, 1))} className="btn-secondary text-sm px-3">›</button>
          <select value={clientId} onChange={e => setClientId(e.target.value)} className="form-input text-sm w-56">
            <option value="">すべての取引先</option>
            {clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          ['依頼', `${totals.requests}件${totals.cancelled ? `（中止 ${totals.cancelled}件）` : ''}`], ['依頼人数', `${totals.people}名`], ['自社配員', `${totals.assigned}名`],
          ['再委託', `${totals.subcontracted}名`], ['請求見込み（稼働・税別）', yen(totals.billing)], ['予定分（未確定）', yen(totals.planned)],
        ].map(([label, value]) => (
          <div key={label} className="card py-3"><p className="text-xs text-gray-500">{label}</p><p className="text-lg font-bold text-gray-800">{value}</p></div>
        ))}
      </div>

      {!clientId && byClient.length > 0 && (
        <div className="card">
          <p className="text-xs font-medium text-gray-500 mb-2">取引先別</p>
          <div className="flex flex-wrap gap-2 text-sm">
            {byClient.map(c => <span key={c.name} className="px-2 py-1 bg-gray-100 rounded">{c.name}: {c.count}件・{yen(c.billing)}</span>)}
          </div>
        </div>
      )}

      <div className="card p-0 overflow-x-auto">
        {isLoading ? <p className="text-center py-10 text-gray-400">読み込み中...</p> : list.length === 0 ? (
          <p className="text-center py-10 text-gray-400 text-sm">この月の依頼はありません（スプレッドシートからは「データ取り込み」で取り込めます）</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-3 py-2">日付</th>
                <th className="text-left px-3 py-2">取引先 / 現場</th>
                <th className="text-left px-3 py-2">時間</th>
                <th className="text-right px-3 py-2">人数</th>
                <th className="text-right px-3 py-2">単価</th>
                <th className="text-left px-3 py-2">配員</th>
                <th className="text-right px-3 py-2">請求見込み</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {list.map(r => (
                <tr key={r.id} className={`align-top ${r.status === 'CANCELLED' ? 'text-gray-400 line-through decoration-gray-300' : ''}`}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {format(new Date(r.date), 'M/d（E）', { locale: ja })}
                    {r.status !== 'CONFIRMED' && <span className={`ml-1 px-1 rounded text-xs no-underline ${r.status === 'CANCELLED' ? 'bg-gray-100 text-gray-500' : 'bg-sky-100 text-sky-700'}`}>{SITE_REQUEST_STATUS[r.status]}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <p className="text-gray-800">{r.site.name}</p>
                    <p className="text-xs text-gray-400">{r.site.client?.name ?? '—'}{r.site.nearestStation ? `・${r.site.nearestStation}` : ''}</p>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {r.startTime ? `${r.startTime}〜${r.endTime}` : r.timeLabel ?? '—'}
                    {r.shiftType === 'NIGHT' && <span className="ml-1 px-1 rounded bg-indigo-100 text-indigo-700">夜</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{r.requestedCount}名{r.qualifiedCount ? <span className="text-xs text-gray-500">（資格{r.qualifiedCount}）</span> : null}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{yen(r.unitPrice)}{r.transportFee ? <p className="text-xs text-gray-400">交通費 {yen(r.transportFee)}</p> : null}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.schedules.map(s => s.guard.name).join('、') || (r.subcontractCount ? '' : '未配員')}
                    {r.subcontractPartner && <p className="text-amber-700">再委託: {r.subcontractPartner.name} {r.subcontractCount}名{r.subcontractUnitPrice ? ` @${r.subcontractUnitPrice.toLocaleString()}` : ''}</p>}
                    {r.notes && <p className="text-gray-400">{r.notes}</p>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-medium">{yen(r.billingEstimate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-400">請求見込み =（依頼単価＋交通費）× 依頼人数 ＋ 資格者手当 × 資格者数 ＋ 残業代。稼働の依頼のみ集計し、中止は除き、予定（稼働日数が未確定）は別に表示します。消費税・指名料・季節手当などの個別請求は含みません。</p>
    </div>
  )
}
