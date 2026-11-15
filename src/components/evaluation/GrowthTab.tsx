import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { GROWTH_WEIGHTS, GROWTH_WINDOW_DAYS, type GrowthResult } from '../../../shared/evaluation'

interface Row extends GrowthResult { id: string; name: string; employeeNumber: string; evaluationCount: number; previous: number | null; activeTasks: number }

const errorOf = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || fallback
const pct = (n: number) => `${Math.round(n * 100)}%`

export function ScoreBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-300">—</span>
  const color = value >= 70 ? 'bg-green-500' : value >= 40 ? 'bg-sky-500' : 'bg-amber-500'
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden"><span className={`block h-full ${color}`} style={{ width: `${value}%` }} /></span>
      <span className="w-7 text-right">{value}</span>
    </span>
  )
}

export const GROWTH_EXPLANATION = `成長スコア（0〜100）= 評価 ${pct(GROWTH_WEIGHTS.evaluation)}（直近${GROWTH_WINDOW_DAYS}日の上司・依頼先・同僚の評価。評価者の甘い・辛いを補正）＋ 自己認識 ${pct(GROWTH_WEIGHTS.awareness)}（本人と他者の評価の差の小ささ）＋ 指導の結果 ${pct(GROWTH_WEIGHTS.coaching)}（直近180日に確定した結果。改善 +20、改善が見られない −25 を 50 から加減）。データのない要素は除いて按分します。`

// 成長スコアの一覧
export default function GrowthTab() {
  const [sort, setSort] = useState<'score' | 'diff' | 'no'>('score')
  const { data = [], isLoading, error } = useQuery<Row[]>({ queryKey: ['evaluation-growth'], queryFn: () => api.get('/evaluations/growth').then(r => r.data) })
  const diff = (r: Row) => (r.score != null && r.previous != null ? r.score - r.previous : null)
  const rows = [...data].sort((a, b) =>
    sort === 'no' ? a.employeeNumber.localeCompare(b.employeeNumber, 'ja', { numeric: true })
      : sort === 'diff' ? (diff(b) ?? -999) - (diff(a) ?? -999)
        : (b.score ?? -1) - (a.score ?? -1))
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">{GROWTH_EXPLANATION}</p>
      <div className="flex gap-2 text-xs">
        {[{ k: 'score', l: 'スコア順' }, { k: 'diff', l: '30日前からの伸び順' }, { k: 'no', l: '社員番号順' }].map(o => (
          <button key={o.k} onClick={() => setSort(o.k as typeof sort)} className={`px-3 py-1.5 rounded-full border ${sort === o.k ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]' : 'bg-white text-gray-600 border-gray-200'}`}>{o.l}</button>
        ))}
      </div>
      {error && <div className="card text-sm text-red-600">{errorOf(error, '読み込めませんでした')}</div>}
      {isLoading && <div className="card text-center py-8 text-gray-400">集計中...</div>}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-4 py-2">隊員</th>
              <th className="text-left px-4 py-2">成長スコア</th>
              <th className="text-right px-4 py-2 whitespace-nowrap">30日前比</th>
              <th className="text-left px-4 py-2 hidden md:table-cell">評価</th>
              <th className="text-left px-4 py-2 hidden md:table-cell">自己認識</th>
              <th className="text-left px-4 py-2 hidden md:table-cell">指導の結果</th>
              <th className="text-right px-4 py-2 whitespace-nowrap">評価件数</th>
              <th className="text-right px-4 py-2 whitespace-nowrap">指導中</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => {
              const d = diff(r)
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 whitespace-nowrap"><Link to={`/evaluations?guard=${r.id}`} className="hover:underline"><span className="text-gray-400 mr-2">{r.employeeNumber}</span>{r.name}</Link></td>
                  <td className="px-4 py-2 font-medium"><ScoreBar value={r.score} /></td>
                  <td className={`px-4 py-2 text-right ${d == null ? 'text-gray-300' : d > 0 ? 'text-green-700' : d < 0 ? 'text-red-600' : 'text-gray-500'}`}>{d == null ? '—' : `${d > 0 ? '+' : ''}${d}`}</td>
                  <td className="px-4 py-2 hidden md:table-cell"><ScoreBar value={r.parts.evaluation} /></td>
                  <td className="px-4 py-2 hidden md:table-cell"><ScoreBar value={r.parts.awareness} /></td>
                  <td className="px-4 py-2 hidden md:table-cell"><ScoreBar value={r.parts.coaching} /></td>
                  <td className="px-4 py-2 text-right text-gray-500">{r.evaluationCount}</td>
                  <td className="px-4 py-2 text-right">{r.activeTasks ? <span className="text-amber-700">{r.activeTasks}</span> : <span className="text-gray-300">0</span>}</td>
                </tr>
              )
            })}
            {!isLoading && rows.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-gray-400">在籍中の隊員がいません</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
