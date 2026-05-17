import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'
import { format } from 'date-fns'

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  DRAFT:             { label: '下書き',     className: 'badge-gray' },
  SENT:              { label: '署名依頼中', className: 'badge-warning' },
  PARTIALLY_SIGNED:  { label: '署名中',     className: 'badge-info' },
  COMPLETED:         { label: '締結完了',   className: 'badge-success' },
  EXPIRED:           { label: '期限切れ',   className: 'badge-danger' },
  CANCELLED:         { label: 'キャンセル', className: 'badge-danger' },
}

interface Signer { email: string; name: string }

export default function EContractsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', content: '', expiresAt: '' })
  const [signers, setSigners] = useState<Signer[]>([{ email: '', name: '' }])
  const [selected, setSelected] = useState<any>(null)

  const { data: eContracts = [], isLoading } = useQuery({
    queryKey: ['e-contracts'],
    queryFn: () => api.get('/e-contracts').then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/e-contracts', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['e-contracts'] }); setShowForm(false); setForm({ title: '', content: '', expiresAt: '' }); setSigners([{ email: '', name: '' }]) },
  })

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">電子契約</h1>
        {canEdit && <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ 契約書作成</button>}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="space-y-3">
          {eContracts.length === 0 ? (
            <div className="card text-center py-12 text-gray-400">電子契約書がありません</div>
          ) : (
            eContracts.map((ec: any) => (
              <div key={ec.id} className="card cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelected(ec)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-800">{ec.title}</p>
                      <span className={`badge ${STATUS_LABELS[ec.status]?.className}`}>{STATUS_LABELS[ec.status]?.label}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      署名者 {ec.signatures?.filter((s: any) => s.signedAt).length}/{ec.signatures?.length}名 完了
                      {ec.expiresAt && ` / 期限: ${format(new Date(ec.expiresAt), 'M/d')}`}
                    </p>
                    <p className="text-xs text-gray-400">{format(new Date(ec.createdAt), 'yyyy/M/d HH:mm')} 作成</p>
                  </div>
                  {ec.timestampAt && <span className="badge badge-success text-xs flex-shrink-0">🔒 TSA認証済み</span>}
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
              <h2 className="font-semibold text-gray-800">{selected.title}</h2>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <span className={`badge ${STATUS_LABELS[selected.status]?.className}`}>{STATUS_LABELS[selected.status]?.label}</span>
                {selected.timestampAt && <span className="badge badge-success">🔒 タイムスタンプ認証済み</span>}
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">契約内容</p>
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {selected.content}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">署名者一覧</p>
                <div className="space-y-2">
                  {selected.signatures?.map((sig: any) => (
                    <div key={sig.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-2">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{sig.signerName}</p>
                        <p className="text-xs text-gray-500">{sig.signerEmail}</p>
                      </div>
                      {sig.signedAt ? (
                        <div className="text-right">
                          <span className="badge badge-success">署名済み</span>
                          <p className="text-xs text-gray-400 mt-0.5">{format(new Date(sig.signedAt), 'M/d HH:mm')}</p>
                        </div>
                      ) : (
                        <span className="badge badge-warning">未署名</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">操作ログ</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {selected.auditLog?.map((log: any, i: number) => (
                    <div key={i} className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded">
                      {log.action} — {log.at} {log.by ? `by ${log.by}` : ''} {log.ip ? `(${log.ip})` : ''}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 作成フォームモーダル */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">契約書作成・署名依頼</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={e => { e.preventDefault(); createMutation.mutate({ ...form, signers }) }} className="p-6 space-y-4">
              <div>
                <label className="form-label">契約書タイトル *</label>
                <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="form-input" required placeholder="警備業務委託契約書" />
              </div>
              <div>
                <label className="form-label">契約内容 *</label>
                <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} className="form-input" rows={8} required placeholder="契約条文を入力..." />
              </div>
              <div>
                <label className="form-label">署名期限</label>
                <input type="date" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} className="form-input" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="form-label mb-0">署名者 *</label>
                  <button type="button" onClick={() => setSigners(ss => [...ss, { email: '', name: '' }])} className="text-blue-600 hover:text-blue-800 text-xs">+ 追加</button>
                </div>
                <div className="space-y-2">
                  {signers.map((signer, i) => (
                    <div key={i} className="grid grid-cols-2 gap-2 items-center">
                      <input type="text" value={signer.name} placeholder="氏名" onChange={e => setSigners(ss => ss.map((s, j) => j === i ? { ...s, name: e.target.value } : s))} className="form-input" required />
                      <input type="email" value={signer.email} placeholder="メールアドレス" onChange={e => setSigners(ss => ss.map((s, j) => j === i ? { ...s, email: e.target.value } : s))} className="form-input" required />
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-xs text-gray-400">※ 各署名者にメールでURLを送付します（Week 3で実装予定）</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">キャンセル</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">作成・送付</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
