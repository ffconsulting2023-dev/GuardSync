import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'
import { format } from 'date-fns'
import EContractCreate from '../components/EContractCreate'

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  DRAFT:             { label: '下書き',     className: 'badge-gray' },
  SENT:              { label: '署名依頼中', className: 'badge-warning' },
  PARTIALLY_SIGNED:  { label: '署名中',     className: 'badge-info' },
  COMPLETED:         { label: '締結完了',   className: 'badge-success' },
  EXPIRED:           { label: '期限切れ',   className: 'badge-danger' },
  CANCELLED:         { label: 'キャンセル', className: 'badge-danger' },
}

export default function EContractsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [prefill, setPrefill] = useState<{ contractId?: string; title?: string } | null>(null)
  const [selected, setSelected] = useState<any>(null)

  // 契約一覧から遷移してきた場合は作成フローを自動で開く
  useEffect(() => {
    const createFor = (location.state as any)?.createFor
    if (createFor) {
      setPrefill(createFor)
      setShowCreate(true)
      navigate(location.pathname, { replace: true, state: {} }) // stateを消費
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: eContracts = [], isLoading } = useQuery({
    queryKey: ['e-contracts'],
    queryFn: () => api.get('/e-contracts').then(r => r.data),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/e-contracts/${id}/cancel`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['e-contracts'] }); setSelected(null) },
  })

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')

  async function viewPdf(url: string) {
    try {
      const res = await api.get(url, { responseType: 'blob' })
      const blobUrl = URL.createObjectURL(res.data)
      window.open(blobUrl, '_blank')
    } catch {
      alert('PDFの取得に失敗しました')
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">電子契約</h1>
        {canEdit && <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">+ 契約書作成</button>}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="space-y-3">
          {eContracts.length === 0 ? (
            <div className="card text-center py-12 text-gray-400">電子契約書がありません</div>
          ) : (
            eContracts.map((ec: any) => {
              const signed = ec.signatures?.filter((s: any) => s.signedAt).length || 0
              const total = ec.signatures?.length || 0
              return (
                <div key={ec.id} className="card cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelected(ec)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-800">{ec.title}</p>
                        <span className={`badge ${STATUS_LABELS[ec.status]?.className}`}>{STATUS_LABELS[ec.status]?.label}</span>
                        {ec.sourcePdfPath && <span className="badge badge-gray text-xs">PDF</span>}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        署名 {signed}/{total}名 完了
                        {ec.expiresAt && ` / 期限: ${format(new Date(ec.expiresAt), 'M/d')}`}
                      </p>
                      <p className="text-xs text-gray-400">{format(new Date(ec.createdAt), 'yyyy/M/d HH:mm')} 作成</p>
                    </div>
                  </div>
                </div>
              )
            })
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
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`badge ${STATUS_LABELS[selected.status]?.className}`}>{STATUS_LABELS[selected.status]?.label}</span>
              </div>

              {/* PDF操作 */}
              <div className="flex flex-wrap gap-2">
                {selected.sourcePdfPath && (
                  <button onClick={() => viewPdf(`/e-contracts/${selected.id}/pdf`)} className="btn-secondary text-xs">原本PDFを表示</button>
                )}
                {selected.signedPdfPath && (
                  <button onClick={() => viewPdf(`/e-contracts/${selected.id}/signed-pdf`)} className="btn-primary text-xs">署名済みPDFを表示</button>
                )}
                {selected.certificatePath && (
                  <button onClick={() => viewPdf(`/e-contracts/${selected.id}/certificate`)} className="btn-secondary text-xs">合意締結証明書</button>
                )}
              </div>

              {selected.content && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">契約内容（メモ）</p>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap max-h-40 overflow-y-auto">{selected.content}</div>
                </div>
              )}

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

              {canEdit && selected.status !== 'COMPLETED' && selected.status !== 'CANCELLED' && (
                <button onClick={() => { if (confirm('この電子契約を取消しますか？')) cancelMutation.mutate(selected.id) }}
                  className="text-red-600 text-sm hover:underline">この契約を取消する</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 作成フロー */}
      {showCreate && (
        <EContractCreate
          initialTitle={prefill?.title || ''}
          contractId={prefill?.contractId}
          onClose={() => { setShowCreate(false); setPrefill(null) }}
          onCreated={() => { setShowCreate(false); setPrefill(null); qc.invalidateQueries({ queryKey: ['e-contracts'] }) }}
        />
      )}
    </div>
  )
}
