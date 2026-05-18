import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

type ContactType = 'SITE' | 'ACCOUNTING'
type Contact = {
  id?: string
  type: ContactType
  name: string
  title?: string
  phone?: string
  email?: string
  notes?: string
}

const EMPTY_FORM = {
  name: '', contactName: '', phone: '', email: '', address: '', notes: '',
  representativeName: '', representativeTitle: '', representativePhone: '', representativeEmail: '',
}

export default function ClientsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [contacts, setContacts] = useState<Contact[]>([])

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/clients', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clients'] }); closeForm() },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => api.put(`/clients/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clients'] }); closeForm() },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/clients/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  })

  const closeForm = () => {
    setShowForm(false)
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setContacts([])
  }

  const openCreate = () => {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setContacts([])
    setShowForm(true)
  }

  const openEdit = (c: any) => {
    setEditTarget(c)
    setForm({
      name: c.name,
      contactName: c.contactName || '',
      phone: c.phone || '',
      email: c.email || '',
      address: c.address || '',
      notes: c.notes || '',
      representativeName: c.representativeName || '',
      representativeTitle: c.representativeTitle || '',
      representativePhone: c.representativePhone || '',
      representativeEmail: c.representativeEmail || '',
    })
    setContacts((c.contacts || []).map((x: any) => ({
      id: x.id, type: x.type, name: x.name,
      title: x.title || '', phone: x.phone || '', email: x.email || '', notes: x.notes || '',
    })))
    setShowForm(true)
  }

  const addContact = (type: ContactType) => {
    setContacts(cs => [...cs, { type, name: '', title: '', phone: '', email: '', notes: '' }])
  }

  const updateContact = (idx: number, patch: Partial<Contact>) => {
    setContacts(cs => cs.map((c, i) => i === idx ? { ...c, ...patch } : c))
  }

  const removeContact = (idx: number) => {
    setContacts(cs => cs.filter((_, i) => i !== idx))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const payload = { ...form, contacts: contacts.filter(c => c.name.trim()) }
    if (editTarget) updateMutation.mutate({ id: editTarget.id, data: payload })
    else createMutation.mutate(payload)
  }

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')
  const canDelete = hasRole(user, 'ADMIN')

  const siteContacts = contacts.map((c, i) => ({ c, i })).filter(x => x.c.type === 'SITE')
  const acctContacts = contacts.map((c, i) => ({ c, i })).filter(x => x.c.type === 'ACCOUNTING')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">取引先管理</h1>
        {canEdit && (
          <button onClick={openCreate} className="btn-primary text-sm">+ 取引先登録</button>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
        <p className="font-medium">取引先（発注元）マスタ</p>
        <p className="text-xs mt-0.5">代表者情報・現場担当・経理担当を複数登録できます。現場や請求書から参照されます。</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {clients.length === 0 ? (
            <div className="col-span-2 text-center py-12 text-gray-400">取引先が登録されていません</div>
          ) : (
            clients.map((c: any) => {
              const sc = (c.contacts || []).filter((x: any) => x.type === 'SITE')
              const ac = (c.contacts || []).filter((x: any) => x.type === 'ACCOUNTING')
              return (
                <div key={c.id} className="card space-y-2">
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold text-gray-800">{c.name}</h3>
                    <div className="flex gap-2 flex-shrink-0">
                      {canEdit && <button onClick={() => openEdit(c)} className="text-blue-600 hover:text-blue-800 text-xs">編集</button>}
                      {canDelete && (
                        <button
                          onClick={() => { if (window.confirm(`${c.name}を削除しますか？`)) deleteMutation.mutate(c.id) }}
                          className="text-red-500 hover:text-red-700 text-xs"
                        >削除</button>
                      )}
                    </div>
                  </div>
                  {c.address && <p className="text-xs text-gray-500">📍 {c.address}</p>}
                  {c.phone && <p className="text-xs text-gray-500">📞 {c.phone}</p>}
                  {c.representativeName && (
                    <div className="text-xs bg-gray-50 rounded p-2">
                      <p className="text-gray-500">代表者</p>
                      <p className="text-gray-800 font-medium">
                        {c.representativeName}{c.representativeTitle && <span className="text-gray-500 font-normal"> （{c.representativeTitle}）</span>}
                      </p>
                      {c.representativePhone && <p className="text-gray-500">📞 {c.representativePhone}</p>}
                      {c.representativeEmail && <p className="text-gray-500">✉️ {c.representativeEmail}</p>}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-xs">
                      <p className="text-gray-500">現場担当 ({sc.length})</p>
                      {sc.length === 0 ? <p className="text-gray-300">—</p> : sc.map((x: any) => (
                        <p key={x.id} className="text-gray-700">{x.name}{x.title && ` (${x.title})`}</p>
                      ))}
                    </div>
                    <div className="text-xs">
                      <p className="text-gray-500">経理担当 ({ac.length})</p>
                      {ac.length === 0 ? <p className="text-gray-300">—</p> : ac.map((x: any) => (
                        <p key={x.id} className="text-gray-700">{x.name}{x.title && ` (${x.title})`}</p>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">{editTarget ? '取引先編集' : '取引先登録'}</h2>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* 基本情報 */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-1">基本情報</h3>
                <div>
                  <label className="form-label">取引先名 *</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="form-input" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">代表電話</label>
                    <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">代表メール</label>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="form-input" />
                  </div>
                </div>
                <div>
                  <label className="form-label">住所</label>
                  <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="form-input" />
                </div>
              </section>

              {/* 代表者 */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-1">代表者情報</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">代表者名</label>
                    <input type="text" value={form.representativeName} onChange={e => setForm(f => ({ ...f, representativeName: e.target.value }))} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">役職</label>
                    <input type="text" value={form.representativeTitle} onChange={e => setForm(f => ({ ...f, representativeTitle: e.target.value }))} className="form-input" placeholder="例: 代表取締役" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">代表者電話</label>
                    <input type="tel" value={form.representativePhone} onChange={e => setForm(f => ({ ...f, representativePhone: e.target.value }))} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">代表者メール</label>
                    <input type="email" value={form.representativeEmail} onChange={e => setForm(f => ({ ...f, representativeEmail: e.target.value }))} className="form-input" />
                  </div>
                </div>
              </section>

              {/* 現場担当 */}
              <ContactSection
                label="現場担当"
                items={siteContacts}
                onAdd={() => addContact('SITE')}
                onUpdate={updateContact}
                onRemove={removeContact}
              />

              {/* 経理担当 */}
              <ContactSection
                label="経理担当"
                items={acctContacts}
                onAdd={() => addContact('ACCOUNTING')}
                onUpdate={updateContact}
                onRemove={removeContact}
              />

              <div>
                <label className="form-label">備考</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="form-input" rows={2} />
              </div>

              <div className="flex gap-3 sticky bottom-0 bg-white pt-3 border-t border-gray-100">
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

function ContactSection(props: {
  label: string
  items: { c: Contact; i: number }[]
  onAdd: () => void
  onUpdate: (idx: number, patch: Partial<Contact>) => void
  onRemove: (idx: number) => void
}) {
  const { label, items, onAdd, onUpdate, onRemove } = props
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between border-b border-gray-100 pb-1">
        <h3 className="text-sm font-semibold text-gray-700">{label} <span className="text-xs text-gray-400 font-normal">({items.length})</span></h3>
        <button type="button" onClick={onAdd} className="text-blue-600 hover:text-blue-800 text-xs">+ 追加</button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">登録なし</p>
      ) : (
        <div className="space-y-2">
          {items.map(({ c, i }) => (
            <div key={i} className="bg-gray-50 rounded p-3 space-y-2 relative">
              <button type="button" onClick={() => onRemove(i)} className="absolute top-2 right-2 text-red-400 hover:text-red-600 text-xs">✕</button>
              <div className="grid grid-cols-2 gap-2 pr-6">
                <input type="text" value={c.name} onChange={e => onUpdate(i, { name: e.target.value })} placeholder="氏名 *" className="form-input text-sm" required />
                <input type="text" value={c.title || ''} onChange={e => onUpdate(i, { title: e.target.value })} placeholder="役職" className="form-input text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="tel" value={c.phone || ''} onChange={e => onUpdate(i, { phone: e.target.value })} placeholder="電話" className="form-input text-sm" />
                <input type="email" value={c.email || ''} onChange={e => onUpdate(i, { email: e.target.value })} placeholder="メール" className="form-input text-sm" />
              </div>
              <input type="text" value={c.notes || ''} onChange={e => onUpdate(i, { notes: e.target.value })} placeholder="備考" className="form-input text-sm" />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
