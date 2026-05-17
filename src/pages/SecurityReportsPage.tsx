import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { format } from 'date-fns'

interface ReportContent {
  patrolRecords: { time: string; location: string; note: string }[]
  incidents: string
  specialNotes: string
  weather: string
}

const EMPTY_CONTENT: ReportContent = {
  patrolRecords: [{ time: '', location: '', note: '' }],
  incidents: '',
  specialNotes: '',
  weather: '晴れ',
}

const EMPTY_FORM = {
  guardId: '', siteId: '',
  reportDate: format(new Date(), 'yyyy-MM-dd'),
}

export default function SecurityReportsPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [content, setContent] = useState<ReportContent>(EMPTY_CONTENT)
  const [selected, setSelected] = useState<any>(null)

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['security-reports'],
    queryFn: () => api.get('/security-reports').then(r => r.data),
  })

  const { data: guards = [] } = useQuery({ queryKey: ['guards'], queryFn: () => api.get('/guards?isActive=true').then(r => r.data) })
  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: () => api.get('/sites').then(r => r.data) })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/security-reports', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security-reports'] })
      setShowForm(false)
      setForm(EMPTY_FORM)
      setContent(EMPTY_CONTENT)
    },
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">警備報告書</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ 報告書作成</button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
        <p className="font-medium">📋 承認方式について</p>
        <p className="text-xs mt-0.5">発注元へのメールにURLリンクを送付し、クリックで承認。特許回避のため手書き署名を使用しない設計です。</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="space-y-2">
          {reports.length === 0 ? (
            <div className="card text-center py-12 text-gray-400">警備報告書がありません</div>
          ) : (
            reports.map((r: any) => (
              <div key={r.id} className="card cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelected(r)}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-800">{r.guard?.name}</p>
                      <span className="text-gray-400">→</span>
                      <p className="text-sm text-gray-600">{r.site?.name}</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{format(new Date(r.reportDate), 'yyyy年M月d日')}</p>
                  </div>
                  <span className={`badge flex-shrink-0 ${r.approvedAt ? 'badge-success' : 'badge-warning'}`}>
                    {r.approvedAt ? '承認済み' : '承認待ち'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 詳細モーダル */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">警備報告書</h2>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-gray-500">隊員</p><p className="font-medium">{selected.guard?.name}</p></div>
                <div><p className="text-xs text-gray-500">現場</p><p className="font-medium">{selected.site?.name}</p></div>
                <div><p className="text-xs text-gray-500">報告日</p><p>{format(new Date(selected.reportDate), 'yyyy/M/d')}</p></div>
                <div>
                  <p className="text-xs text-gray-500">承認状況</p>
                  <span className={`badge ${selected.approvedAt ? 'badge-success' : 'badge-warning'}`}>
                    {selected.approvedAt ? `承認済み（${selected.approvedBy}）` : '承認待ち'}
                  </span>
                </div>
              </div>

              {selected.content && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">巡回記録</p>
                  <div className="space-y-1">
                    {(selected.content.patrolRecords || []).map((rec: any, i: number) => (
                      <div key={i} className="bg-gray-50 rounded px-3 py-2 text-sm">
                        <span className="text-gray-500 text-xs">{rec.time}</span>
                        <span className="mx-2 text-gray-700">{rec.location}</span>
                        {rec.note && <span className="text-gray-500 text-xs">— {rec.note}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selected.content?.incidents && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">インシデント・特記事項</p>
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-gray-700">{selected.content.incidents}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 作成フォーム */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">警備報告書 作成</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={e => { e.preventDefault(); createMutation.mutate({ ...form, content }) }} className="p-6 space-y-4">
              <div>
                <label className="form-label">隊員 *</label>
                <select value={form.guardId} onChange={e => setForm(f => ({ ...f, guardId: e.target.value }))} className="form-input" required>
                  <option value="">選択してください</option>
                  {guards.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">現場 *</label>
                <select value={form.siteId} onChange={e => setForm(f => ({ ...f, siteId: e.target.value }))} className="form-input" required>
                  <option value="">選択してください</option>
                  {sites.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">報告日 *</label>
                  <input type="date" value={form.reportDate} onChange={e => setForm(f => ({ ...f, reportDate: e.target.value }))} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">天気</label>
                  <select value={content.weather} onChange={e => setContent(c => ({ ...c, weather: e.target.value }))} className="form-input">
                    {['晴れ', '曇り', '雨', '雪', '霧'].map(w => <option key={w}>{w}</option>)}
                  </select>
                </div>
              </div>

              {/* 巡回記録 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="form-label mb-0">巡回記録 *</label>
                  <button type="button" onClick={() => setContent(c => ({ ...c, patrolRecords: [...c.patrolRecords, { time: '', location: '', note: '' }] }))} className="text-blue-600 text-xs hover:underline">+ 行追加</button>
                </div>
                <div className="space-y-2">
                  {content.patrolRecords.map((rec, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2">
                      <input type="time" value={rec.time} onChange={e => setContent(c => ({ ...c, patrolRecords: c.patrolRecords.map((r, j) => j === i ? { ...r, time: e.target.value } : r) }))} className="form-input" placeholder="時刻" required />
                      <input type="text" value={rec.location} onChange={e => setContent(c => ({ ...c, patrolRecords: c.patrolRecords.map((r, j) => j === i ? { ...r, location: e.target.value } : r) }))} className="form-input" placeholder="場所" required />
                      <input type="text" value={rec.note} onChange={e => setContent(c => ({ ...c, patrolRecords: c.patrolRecords.map((r, j) => j === i ? { ...r, note: e.target.value } : r) }))} className="form-input" placeholder="備考" />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="form-label">インシデント・特記事項</label>
                <textarea value={content.incidents} onChange={e => setContent(c => ({ ...c, incidents: e.target.value }))} className="form-input" rows={3} placeholder="異常なし、または内容を記載" />
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">キャンセル</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">提出</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
