import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { format } from 'date-fns'

const SOURCE_LABELS: Record<string, { label: string; icon: string }> = {
  FAX:        { label: 'FAX',        icon: '📠' },
  EMAIL:      { label: 'メール',     icon: '✉️' },
  LINE_WORKS: { label: 'LINE Works', icon: '💬' },
}

export default function AutoReceiptPage() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<any>(null)
  const [scheduleForm, setScheduleForm] = useState({ guardId: '', siteId: '', date: '', startTime: '09:00', endTime: '17:00' })

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['auto-receipts'],
    queryFn: () => api.get('/auto-receipts').then(r => r.data),
    refetchInterval: 30000,
  })

  const { data: guards = [] } = useQuery({ queryKey: ['guards'], queryFn: () => api.get('/guards?isActive=true').then(r => r.data) })
  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: () => api.get('/sites').then(r => r.data) })

  const acceptMutation = useMutation({
    mutationFn: ({ id, scheduleData }: any) => api.post(`/auto-receipts/${id}/accept`, { scheduleData }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['auto-receipts'] }); setSelected(null) },
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/auto-receipts/${id}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auto-receipts'] }),
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">自動受付</h1>
        <span className="badge badge-warning">{receipts.length}件 未処理</span>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
        <p className="font-medium">📨 自動受付エンジン</p>
        <p className="text-xs mt-0.5">FAX・メール・LINE Worksから受信した配員依頼を確認し、承認または却下してください。</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : receipts.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-3xl mb-3">✅</p>
          <p className="text-gray-400">未処理の受付はありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {receipts.map((r: any) => {
            const src = SOURCE_LABELS[r.source] || { label: r.source, icon: '📋' }
            return (
              <div key={r.id} className="card cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelected(r)}>
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{src.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="badge badge-warning">{src.label}</span>
                      <span className="text-xs text-gray-400">{format(new Date(r.createdAt), 'M/d HH:mm')}</span>
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-2">{r.rawContent}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 受付詳細・承認モーダル */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">受付内容確認</h2>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-xs text-gray-500">受信元</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-lg">{SOURCE_LABELS[selected.source]?.icon}</span>
                  <span className="font-medium">{SOURCE_LABELS[selected.source]?.label}</span>
                  <span className="text-xs text-gray-400">{format(new Date(selected.createdAt), 'yyyy/M/d HH:mm')}</span>
                </div>
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-1">受信内容（原文）</p>
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {selected.rawContent}
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm font-medium text-gray-700 mb-3">配員登録（承認する場合）</p>
                <div className="space-y-3">
                  <div>
                    <label className="form-label">隊員</label>
                    <select value={scheduleForm.guardId} onChange={e => setScheduleForm(f => ({ ...f, guardId: e.target.value }))} className="form-input">
                      <option value="">選択しない</option>
                      {guards.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">現場</label>
                    <select value={scheduleForm.siteId} onChange={e => setScheduleForm(f => ({ ...f, siteId: e.target.value }))} className="form-input">
                      <option value="">選択しない</option>
                      {sites.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="form-label">日付</label>
                      <input type="date" value={scheduleForm.date} onChange={e => setScheduleForm(f => ({ ...f, date: e.target.value }))} className="form-input" />
                    </div>
                    <div>
                      <label className="form-label">開始</label>
                      <input type="time" value={scheduleForm.startTime} onChange={e => setScheduleForm(f => ({ ...f, startTime: e.target.value }))} className="form-input" />
                    </div>
                    <div>
                      <label className="form-label">終了</label>
                      <input type="time" value={scheduleForm.endTime} onChange={e => setScheduleForm(f => ({ ...f, endTime: e.target.value }))} className="form-input" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { if (window.confirm('却下しますか？')) rejectMutation.mutate(selected.id) }}
                  className="btn-danger flex-1"
                >
                  却下
                </button>
                <button
                  onClick={() => acceptMutation.mutate({
                    id: selected.id,
                    scheduleData: scheduleForm.guardId && scheduleForm.siteId && scheduleForm.date
                      ? scheduleForm : undefined,
                  })}
                  disabled={acceptMutation.isPending}
                  className="btn-primary flex-1 disabled:opacity-50"
                >
                  {scheduleForm.guardId && scheduleForm.siteId && scheduleForm.date ? '承認・配員登録' : '承認のみ'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
