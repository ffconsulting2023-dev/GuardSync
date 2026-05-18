import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

const EMPTY_FORM = {
  clientId: '', siteContactId: '',
  name: '', address: '',
  clientName: '', clientPhone: '',
  siteContactName: '', siteContactPhone: '', siteContactEmail: '',
  notes: '',
}

export default function SitesPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.get('/sites').then(r => r.data),
  })

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
  })

  const selectedClient = clients.find((c: any) => c.id === form.clientId)
  const siteContactCandidates: any[] = (selectedClient?.contacts || []).filter((c: any) => c.type === 'SITE')

  const handleClientChange = (clientId: string) => {
    const c = clients.find((x: any) => x.id === clientId)
    setForm(f => ({
      ...f,
      clientId,
      // 取引先を変えたら現場担当のFK選択はリセット（手入力値は保持）
      siteContactId: '',
      clientName: c?.name ?? f.clientName,
      clientPhone: c?.phone ?? f.clientPhone,
    }))
  }

  const handleSiteContactChange = (siteContactId: string) => {
    const sc = siteContactCandidates.find((x: any) => x.id === siteContactId)
    setForm(f => ({
      ...f,
      siteContactId,
      // マスタから自動入力（後で自由記述で上書き可能）
      siteContactName: sc?.name ?? f.siteContactName,
      siteContactPhone: sc?.phone ?? f.siteContactPhone,
      siteContactEmail: sc?.email ?? f.siteContactEmail,
    }))
  }

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/sites', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sites'] }); closeForm() },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => api.put(`/sites/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sites'] }); closeForm() },
  })

  const closeForm = () => {
    setShowForm(false)
    setEditTarget(null)
    setForm(EMPTY_FORM)
  }

  const openCreate = () => {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  const openEdit = (site: any) => {
    setEditTarget(site)
    setForm({
      clientId: site.clientId || '',
      siteContactId: site.siteContactId || '',
      name: site.name,
      address: site.address,
      clientName: site.clientName || '',
      clientPhone: site.clientPhone || '',
      siteContactName: site.siteContactName || '',
      siteContactPhone: site.siteContactPhone || '',
      siteContactEmail: site.siteContactEmail || '',
      notes: site.notes || '',
    })
    setShowForm(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editTarget) updateMutation.mutate({ id: editTarget.id, data: form })
    else createMutation.mutate(form)
  }

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">現場管理</h1>
        {canEdit && <button onClick={openCreate} className="btn-primary text-sm">+ 現場登録</button>}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {sites.length === 0 ? (
            <div className="col-span-3 text-center py-12 text-gray-400">現場が登録されていません</div>
          ) : (
            sites.map((site: any) => (
              <div key={site.id} className="card space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-gray-800">{site.name}</h3>
                  {canEdit && <button onClick={() => openEdit(site)} className="text-blue-600 hover:text-blue-800 text-xs flex-shrink-0">編集</button>}
                </div>
                <p className="text-sm text-gray-500 flex items-start gap-1">
                  <span>📍</span><span className="leading-tight">{site.address}</span>
                </p>
                {site.clientName && <p className="text-sm text-gray-600">発注元: {site.clientName}</p>}
                {site.clientPhone && <p className="text-sm text-gray-600">📞 {site.clientPhone}</p>}
                {site.siteContactName && (
                  <div className="text-xs bg-gray-50 rounded p-2">
                    <p className="text-gray-500">現場担当</p>
                    <p className="text-gray-800 font-medium">{site.siteContactName}</p>
                    {site.siteContactPhone && <p className="text-gray-500">📞 {site.siteContactPhone}</p>}
                    {site.siteContactEmail && <p className="text-gray-500">✉️ {site.siteContactEmail}</p>}
                  </div>
                )}
                {site.notes && <p className="text-xs text-gray-400 border-t border-gray-100 pt-2">{site.notes}</p>}
              </div>
            ))
          )}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">{editTarget ? '現場編集' : '現場登録'}</h2>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="form-label">現場名 *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="form-input" required />
              </div>
              <div>
                <label className="form-label">住所 *</label>
                <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="form-input" required />
              </div>

              <section className="space-y-3 pt-2 border-t border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">取引先（発注元）</h3>
                <div>
                  <select value={form.clientId} onChange={e => handleClientChange(e.target.value)} className="form-input">
                    <option value="">— 未指定（手入力） —</option>
                    {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">発注元名</label>
                  <input type="text" value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} className="form-input" disabled={!!form.clientId} />
                </div>
                <div>
                  <label className="form-label">発注元電話番号</label>
                  <input type="tel" value={form.clientPhone} onChange={e => setForm(f => ({ ...f, clientPhone: e.target.value }))} className="form-input" disabled={!!form.clientId} />
                </div>
              </section>

              <section className="space-y-3 pt-2 border-t border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">現場担当者</h3>
                {form.clientId ? (
                  <div>
                    <label className="form-label">担当者を選択</label>
                    <select value={form.siteContactId} onChange={e => handleSiteContactChange(e.target.value)} className="form-input">
                      <option value="">— 選択しない（自由記述） —</option>
                      {siteContactCandidates.map((c: any) => (
                        <option key={c.id} value={c.id}>{c.name}{c.title ? `（${c.title}）` : ''}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">取引先マスタの現場担当から選択、または下欄で自由記述（マスタ値を上書きできます）。</p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">取引先を選ぶとマスタから選択できます。下欄は常に自由記述可能です。</p>
                )}
                <div>
                  <label className="form-label">担当者名</label>
                  <input type="text" value={form.siteContactName} onChange={e => setForm(f => ({ ...f, siteContactName: e.target.value }))} className="form-input" placeholder="自由記述で上書き可" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">電話</label>
                    <input type="tel" value={form.siteContactPhone} onChange={e => setForm(f => ({ ...f, siteContactPhone: e.target.value }))} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">メール</label>
                    <input type="email" value={form.siteContactEmail} onChange={e => setForm(f => ({ ...f, siteContactEmail: e.target.value }))} className="form-input" />
                  </div>
                </div>
              </section>

              <div className="pt-2 border-t border-gray-100">
                <label className="form-label">備考</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="form-input" rows={3} />
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={closeForm} className="btn-secondary flex-1">キャンセル</button>
                <button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">
                  {editTarget ? '更新' : '登録'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
