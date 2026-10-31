import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { format } from 'date-fns'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'
import AuthImage from '../components/AuthImage'
import ReportView from '../components/report/ReportView'
import ReportContentForm, { EMPTY_REPORT_CONTENT, toSubmitContent, fromSavedContent } from '../components/report/ReportContentForm'
import {
  REPORT_STATUS, REPORT_REVISION_ACTION, REPORT_FIELD_LABEL, MAX_PHOTOS_PER_REPORT, DEFAULT_REPORT_TEMPLATE,
  reportStatus, validateReportAgainstTemplate,
  type PhotoInput, type ReportTemplate, type ReportRevisionAction,
} from '../../shared/securityReport'
import { resizeImageFile, getCurrentLocation } from '../lib/image'

const EMPTY_FORM = {
  guardId: '', siteId: '', clientEmail: '',
  reportDate: format(new Date(), 'yyyy-MM-dd'),
}
const EDIT_ROLES = ['ADMIN', 'MANAGER', 'OPERATOR']
const apiError = (e: any, fallback: string) => e?.response?.data?.error || fallback

function formatChangeValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '（空）'
  if (typeof v === 'boolean') return v ? 'あり' : 'なし'
  if (Array.isArray(v)) return `${v.length}件`
  return String(v)
}

// 修正履歴
function RevisionList({ reportId }: { reportId: string }) {
  const { data: revisions = [] } = useQuery({
    queryKey: ['security-report-revisions', reportId],
    queryFn: () => api.get(`/security-reports/${reportId}/revisions`).then(r => r.data),
  })
  if (!revisions.length) return <p className="text-xs text-gray-400">履歴はありません</p>
  return (
    <ol className="space-y-2">
      {revisions.map((r: any) => (
        <li key={r.id} className="text-xs border-l-2 border-gray-200 pl-3">
          <p>
            <span className="font-medium text-gray-700">{REPORT_REVISION_ACTION[r.action as ReportRevisionAction] ?? r.action}</span>
            <span className="text-gray-500"> — {r.actorName} / {format(new Date(r.createdAt), 'yyyy/M/d HH:mm')}</span>
          </p>
          {r.action === 'UPDATE' && Array.isArray(r.changes) && (
            <ul className="mt-1 text-gray-500 space-y-0.5">
              {r.changes.map((c: any) => (
                <li key={c.field}>{REPORT_FIELD_LABEL[c.field] ?? c.field}: {formatChangeValue(c.before)} → {formatChangeValue(c.after)}</li>
              ))}
            </ul>
          )}
          {(r.action === 'SHARE' || r.action === 'SHARE_REVOKE') && r.changes?.partner && <p className="text-gray-500">{r.changes.partner}</p>}
        </li>
      ))}
    </ol>
  )
}

// 協力会社への共有
function SharePanel({ reportId, canEdit }: { reportId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const [partnerId, setPartnerId] = useState('')
  const [days, setDays] = useState(30)
  const [result, setResult] = useState<{ shareUrl: string; emailed: boolean } | null>(null)
  const { data: partners = [] } = useQuery({ queryKey: ['partners'], queryFn: () => api.get('/partners').then(r => r.data), enabled: canEdit })
  const { data: shares = [] } = useQuery({
    queryKey: ['security-report-shares', reportId],
    queryFn: () => api.get(`/security-reports/${reportId}/shares`).then(r => r.data),
  })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['security-report-shares', reportId] })
    qc.invalidateQueries({ queryKey: ['security-report-revisions', reportId] })
  }
  const create = useMutation({
    mutationFn: () => api.post(`/security-reports/${reportId}/shares`, { partnerId, expiresInDays: days }).then(r => r.data),
    onSuccess: d => { setResult(d); setPartnerId(''); refresh() },
  })
  const revoke = useMutation({
    mutationFn: (shareId: string) => api.delete(`/security-reports/${reportId}/shares/${shareId}`),
    onSuccess: refresh,
  })

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[10rem]">
            <label className="form-label">協力会社</label>
            <select value={partnerId} onChange={e => setPartnerId(e.target.value)} className="form-input">
              <option value="">選択してください</option>
              {partners.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.email ? '' : '（メール未登録）'}</option>)}
            </select>
          </div>
          <div className="w-24">
            <label className="form-label">有効日数</label>
            <input type="number" min={1} max={90} value={days} onChange={e => setDays(Math.min(90, Math.max(1, Number(e.target.value) || 1)))} className="form-input" />
          </div>
          <button type="button" disabled={!partnerId || create.isPending} onClick={() => create.mutate()} className="btn-primary text-sm disabled:opacity-50">共有</button>
        </div>
      )}
      {create.isError && <p className="text-xs text-red-600">{apiError(create.error, '共有に失敗しました')}</p>}
      {result && (
        <div className="bg-green-50 border border-green-200 rounded p-2 text-xs space-y-1">
          <p>{result.emailed ? '協力会社へメールで送信しました。' : 'メール未送信です。下のリンクを協力会社へお伝えください。'}</p>
          <div className="flex gap-2">
            <input readOnly value={result.shareUrl} className="form-input text-xs py-1 flex-1" onFocus={e => e.target.select()} />
            <button type="button" onClick={() => navigator.clipboard?.writeText(result.shareUrl)} className="btn-secondary text-xs">コピー</button>
          </div>
        </div>
      )}
      {shares.length > 0 && (
        <ul className="divide-y divide-gray-100 text-xs">
          {shares.map((s: any) => {
            const active = !s.revokedAt && new Date(s.expiresAt) > new Date()
            return (
              <li key={s.id} className="py-2 flex items-center gap-2">
                <div className="flex-1">
                  <p className="font-medium text-gray-700">{s.partner?.name}</p>
                  <p className="text-gray-500">
                    {s.revokedAt ? '取消済' : active ? `${format(new Date(s.expiresAt), 'yyyy/M/d')}まで有効` : '期限切れ'}
                    {' / '}閲覧{s.viewCount}回{s.lastViewedAt ? `（最終 ${format(new Date(s.lastViewedAt), 'M/d HH:mm')}）` : ''}
                  </p>
                </div>
                {canEdit && active && (
                  <button type="button" onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending} className="text-red-600">取消</button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// 既存報告書の写真追加・削除（サイン前のみ）
function PhotoManager({ report, onChanged }: { report: any; onChanged: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const remove = useMutation({
    mutationFn: (photoId: string) => api.delete(`/security-reports/${report.id}/photos/${photoId}`),
    onSuccess: onChanged,
    onError: e => setError(apiError(e, '削除に失敗しました')),
  })
  const add = async (files: File[]) => {
    if (!files.length) return
    setError('')
    setBusy(true)
    try {
      const loc = await getCurrentLocation()
      const room = MAX_PHOTOS_PER_REPORT - report.photos.length
      const photos: PhotoInput[] = []
      for (const f of files.slice(0, room)) photos.push({ dataUrl: await resizeImageFile(f), caption: '', ...loc })
      if (photos.length) await api.post(`/security-reports/${report.id}/photos`, { photos })
      onChanged()
    } catch (e: any) {
      setError(apiError(e, e.message || '追加に失敗しました'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        {report.photos.map((p: any) => (
          <div key={p.id} className="relative">
            <AuthImage path={`/security-reports/${report.id}/photos/${p.id}`} alt={p.caption || '現場写真'} className="w-full aspect-square object-cover rounded border" />
            <button type="button" onClick={() => remove.mutate(p.id)} className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-6 h-6 text-xs" aria-label="写真を削除">✕</button>
          </div>
        ))}
        {report.photos.length < MAX_PHOTOS_PER_REPORT && (
          <label className="aspect-square border-2 border-dashed border-gray-300 rounded flex flex-col items-center justify-center text-gray-400 text-xs cursor-pointer">
            <span className="text-xl">📷</span>{busy ? '処理中...' : '追加'}
            <input type="file" accept="image/*" multiple className="hidden" disabled={busy} onChange={e => { add(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          </label>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

export default function SecurityReportsPage() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const canEdit = hasRole(user, ...EDIT_ROLES)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [content, setContent] = useState(EMPTY_REPORT_CONTENT)
  const [photos, setPhotos] = useState<PhotoInput[]>([])
  const [formError, setFormError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'report' | 'history' | 'share'>('report')
  const [editing, setEditing] = useState(false)
  const [editDate, setEditDate] = useState('')
  const [editContent, setEditContent] = useState(EMPTY_REPORT_CONTENT)

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['security-reports'],
    queryFn: () => api.get('/security-reports').then(r => r.data),
  })
  const { data: selected } = useQuery({
    queryKey: ['security-report', selectedId],
    queryFn: () => api.get(`/security-reports/${selectedId}`).then(r => r.data),
    enabled: !!selectedId,
  })

  const { data: guards = [] } = useQuery({ queryKey: ['guards'], queryFn: () => api.get('/guards?isActive=true').then(r => r.data) })
  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: () => api.get('/sites').then(r => r.data) })
  const { data: formTemplate = DEFAULT_REPORT_TEMPLATE } = useQuery<ReportTemplate>({
    queryKey: ['site-report-template', form.siteId],
    queryFn: () => api.get(`/sites/${form.siteId}/report-template`).then(r => r.data),
    enabled: showForm && !!form.siteId,
  })

  const refreshSelected = () => {
    qc.invalidateQueries({ queryKey: ['security-reports'] })
    qc.invalidateQueries({ queryKey: ['security-report', selectedId] })
    qc.invalidateQueries({ queryKey: ['security-report-revisions', selectedId] })
  }

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/security-reports', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security-reports'] })
      setShowForm(false)
      setForm(EMPTY_FORM)
      setContent(EMPTY_REPORT_CONTENT)
      setPhotos([])
    },
    onError: e => setFormError(apiError(e, '提出に失敗しました')),
  })

  const updateMutation = useMutation({
    mutationFn: () => api.put(`/security-reports/${selectedId}`, {
      reportDate: editDate, content: toSubmitContent(editContent, selected?.template ?? DEFAULT_REPORT_TEMPLATE),
    }),
    onSuccess: () => { setEditing(false); refreshSelected() },
  })

  const openDetail = (id: string) => { setSelectedId(id); setDetailTab('report'); setEditing(false) }
  const startEdit = () => {
    setEditDate(format(new Date(selected.reportDate), 'yyyy-MM-dd'))
    setEditContent(fromSavedContent(selected.content))
    updateMutation.reset()
    setEditing(true)
  }
  const locked = !!(selected?.signedAt || selected?.approvedAt)

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">警備報告書</h1>
        <button onClick={() => { setFormError(''); setShowForm(true) }} className="btn-primary text-sm">+ 報告書作成</button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
        <p className="font-medium">📋 承認方式について</p>
        <p className="text-xs mt-0.5">隊員が現場でスマートフォンを現場監督に渡し、タッチパネルでサインを取得します。発注元へのメールURLによる承認も併用できます。サイン・承認後の報告書は修正できません。</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="space-y-2">
          {reports.length === 0 ? (
            <div className="card text-center py-12 text-gray-400">警備報告書がありません</div>
          ) : (
            reports.map((r: any) => (
              <div key={r.id} className="card cursor-pointer hover:shadow-md transition-shadow" onClick={() => openDetail(r.id)}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-800">{r.guard?.name}</p>
                      <span className="text-gray-400">→</span>
                      <p className="text-sm text-gray-600">{r.site?.name}</p>
                      {(r.site?.client?.name || r.site?.clientName) && <p className="text-xs text-gray-400">（{r.site?.client?.name || r.site?.clientName}）</p>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {format(new Date(r.reportDate), 'yyyy年M月d日')}
                      {r._count?.photos ? ` / 📷${r._count.photos}` : ''}
                      {r.content?.hasIncident ? ' / ⚠️ 異常あり' : ''}
                    </p>
                  </div>
                  <span className={`badge flex-shrink-0 ${r.approvedAt || r.signedAt ? 'badge-success' : 'badge-warning'}`}>
                    {REPORT_STATUS[reportStatus(r)]}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 詳細モーダル */}
      {selectedId && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="report-print bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 pt-4 border-b border-gray-100 print:hidden">
              <div className="flex items-center justify-between">
                <span className={`badge ${selected.approvedAt || selected.signedAt ? 'badge-success' : 'badge-warning'}`}>{REPORT_STATUS[reportStatus(selected)]}</span>
                <div className="flex items-center gap-3">
                  {canEdit && !locked && !editing && detailTab === 'report' && <button onClick={startEdit} className="text-sm text-blue-600">✏️ 修正</button>}
                  <button onClick={() => { setDetailTab('report'); setEditing(false); setTimeout(() => window.print(), 0) }} className="text-sm text-blue-600">🖨 印刷/PDF</button>
                  <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>
              </div>
              <div className="flex gap-4 mt-3 text-sm">
                {([['report', '報告内容'], ['history', '修正履歴'], ['share', '協力会社共有']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => { setDetailTab(k); setEditing(false) }}
                    className={`pb-2 border-b-2 ${detailTab === k ? 'border-[#1e3a5f] text-[#1e3a5f] font-medium' : 'border-transparent text-gray-500'}`}>{label}</button>
                ))}
              </div>
            </div>
            <div className="p-6">
              {detailTab === 'report' && !editing && (
                <div className="space-y-4">
                  <ReportView
                    report={selected}
                    template={selected.template ?? DEFAULT_REPORT_TEMPLATE}
                    companyName={user?.company?.name}
                    renderPhoto={p => (
                      <AuthImage path={`/security-reports/${selected.id}/photos/${p.id}`} alt={p.caption || '現場写真'} className="w-full aspect-square object-cover rounded border" />
                    )}
                  />
                  {canEdit && !locked && (
                    <div className="border-t border-gray-100 pt-3 print:hidden">
                      <p className="text-xs font-medium text-gray-500 mb-2">写真の追加・削除</p>
                      <PhotoManager report={selected} onChanged={refreshSelected} />
                    </div>
                  )}
                </div>
              )}
              {detailTab === 'report' && editing && (
                <div className="space-y-4">
                  <div>
                    <label className="form-label">報告日</label>
                    <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="form-input" />
                  </div>
                  <ReportContentForm value={editContent} onChange={setEditContent} template={selected.template ?? DEFAULT_REPORT_TEMPLATE} />
                  {updateMutation.isError && <p className="text-sm text-red-600">{apiError(updateMutation.error, '保存に失敗しました')}</p>}
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setEditing(false)} className="btn-secondary flex-1">キャンセル</button>
                    <button type="button" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">保存（履歴に記録）</button>
                  </div>
                </div>
              )}
              {detailTab === 'history' && <RevisionList reportId={selected.id} />}
              {detailTab === 'share' && <SharePanel reportId={selected.id} canEdit={canEdit} />}
            </div>
          </div>
        </div>
      )}

      {/* 作成フォーム */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between z-10">
              <h2 className="font-semibold text-gray-800">{formTemplate.title} 作成</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={e => {
              e.preventDefault()
              const submitContent = toSubmitContent(content, formTemplate)
              const errors = validateReportAgainstTemplate(submitContent, formTemplate, photos.length)
              if (errors.length) { setFormError(errors.join(' / ')); return }
              setFormError('')
              createMutation.mutate({ ...form, clientEmail: form.clientEmail || undefined, content: submitContent, photos })
            }} className="p-6 space-y-4">
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
              <div>
                <label className="form-label">報告日 *</label>
                <input type="date" value={form.reportDate} onChange={e => setForm(f => ({ ...f, reportDate: e.target.value }))} className="form-input" required />
              </div>

              <ReportContentForm value={content} onChange={setContent} template={formTemplate} photos={photos} onPhotosChange={setPhotos} />

              <div>
                <label className="form-label">発注元へ承認依頼メールを送る（任意）</label>
                <input type="email" value={form.clientEmail} onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))} className="form-input" placeholder="client@example.com" />
              </div>

              {formError && <p className="text-sm text-red-600">{formError}</p>}
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
