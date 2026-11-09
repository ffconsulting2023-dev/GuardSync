import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

import { PARTNER_TYPE } from '../lib/constants'

const TYPE_LABELS = PARTNER_TYPE

// 契約単価（円）の項目
const PRICE_FIELDS = [
  { key: 'unitPriceDay', label: '日勤単価' },
  { key: 'unitPriceNight', label: '夜勤単価' },
  { key: 'unitPriceHolidayDay', label: '土日日勤単価' },
  { key: 'unitPriceHolidayNight', label: '土日夜勤単価' },
  { key: 'overtimeDayRate', label: '日勤時間外' },
  { key: 'overtimeNightRate', label: '夜勤時間外' },
  { key: 'overtimeHolidayDayRate', label: '土日日勤時間外' },
  { key: 'overtimeHolidayNightRate', label: '土日夜勤時間外' },
  { key: 'qualificationAllowance', label: '資格者手当' },
  { key: 'seasonalAllowance', label: '季節手当' },
  { key: 'nominationAllowance', label: '指名料' },
] as const
type PriceKey = typeof PRICE_FIELDS[number]['key']

type PartnerForm = {
  name: string; type: string; contactName: string; phone: string; email: string; priority: string
  isActive: boolean; address: string; website: string; notes: string
  contractDate: string; contractMethod: string
} & Record<PriceKey, string>

const EMPTY_FORM: PartnerForm = {
  name: '', type: 'GENERAL', contactName: '', phone: '', email: '', priority: '0',
  isActive: true, address: '', website: '', notes: '', contractDate: '', contractMethod: '',
  ...Object.fromEntries(PRICE_FIELDS.map(f => [f.key, ''])) as Record<PriceKey, string>,
}

const partnerToForm = (p: any): PartnerForm => ({
  name: p.name || '', type: p.type || 'GENERAL', contactName: p.contactName || '', phone: p.phone || '',
  email: p.email || '', priority: String(p.priority ?? 0), isActive: p.isActive !== false,
  address: p.address || '', website: p.website || '', notes: p.notes || '',
  contractDate: p.contractDate ? String(p.contractDate).split('T')[0] : '', contractMethod: p.contractMethod || '',
  ...Object.fromEntries(PRICE_FIELDS.map(f => [f.key, p[f.key] != null ? String(p[f.key]) : ''])) as Record<PriceKey, string>,
})

// APIへ送る形に変換（空文字はnull、円項目は数値）
const formToPayload = (form: PartnerForm) => {
  const orNull = (v: string) => (v.trim() ? v.trim() : null)
  return {
    name: form.name, type: form.type, priority: Number(form.priority) || 0, isActive: form.isActive,
    contactName: orNull(form.contactName), phone: orNull(form.phone), email: orNull(form.email),
    address: orNull(form.address), website: orNull(form.website), notes: orNull(form.notes),
    contractDate: form.contractDate, contractMethod: orNull(form.contractMethod),
    ...Object.fromEntries(PRICE_FIELDS.map(f => [f.key, form[f.key] === '' ? null : Math.round(Number(form[f.key]))])),
  }
}

const yen = (v: number | null | undefined) => (v != null ? `¥${v.toLocaleString()}` : '—')

export default function PartnersPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<PartnerForm>(EMPTY_FORM)
  const [editTarget, setEditTarget] = useState<any>(null)

  const { data: partners = [], isLoading } = useQuery({
    queryKey: ['partners'],
    queryFn: () => api.get('/partners').then(r => r.data),
  })

  const closeForm = () => { setShowForm(false); setEditTarget(null); setForm(EMPTY_FORM) }

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/partners', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['partners'] }); closeForm() },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/partners/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['partners'] }); closeForm() },
  })

  const canEdit = hasRole(user, 'ADMIN')
  const saving = createMutation.isPending || updateMutation.isPending
  const saveError: any = createMutation.error || updateMutation.error

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setShowForm(true) }
  const openEdit = (p: any) => { setEditTarget(p); setForm(partnerToForm(p)); setShowForm(true) }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data = formToPayload(form)
    if (editTarget) updateMutation.mutate({ id: editTarget.id, data })
    else createMutation.mutate(data)
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">協力会社管理</h1>
        {canEdit && <button onClick={openCreate} className="btn-primary text-sm">+ 会社登録</button>}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
        <p className="font-medium">優先人員融通フロー</p>
        <p className="text-xs mt-0.5">グループ会社 → 優先協力会社 → 一般協力会社 の順で自動エスカレーション</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {['GROUP', 'PREFERRED', 'GENERAL'].map(type => {
            const typePartners = partners.filter((p: any) => p.type === type)
            const { label, className, desc } = TYPE_LABELS[type]
            return (
              <div key={type} className="card space-y-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`badge ${className}`}>{label}</span>
                    <span className="text-xs text-gray-400">{typePartners.length}社</span>
                  </div>
                  <p className="text-xs text-gray-400">{desc}</p>
                </div>
                {typePartners.length === 0 ? (
                  <p className="text-xs text-gray-300">登録なし</p>
                ) : (
                  typePartners.map((p: any) => (
                    <div key={p.id}
                      onClick={canEdit ? () => openEdit(p) : undefined}
                      className={`bg-gray-50 rounded-lg p-3 ${canEdit ? 'cursor-pointer hover:bg-gray-100' : ''}`}>
                      <p className="font-medium text-gray-800 text-sm">{p.name}</p>
                      {p.contactName && <p className="text-xs text-gray-500">担当: {p.contactName}</p>}
                      {p.phone && <p className="text-xs text-gray-500">📞 {p.phone}</p>}
                      {p.email && <p className="text-xs text-gray-500">✉️ {p.email}</p>}
                      {(p.unitPriceDay != null || p.unitPriceNight != null) && (
                        <p className="text-xs text-gray-500">単価: 日勤 {yen(p.unitPriceDay)} / 夜勤 {yen(p.unitPriceNight)}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">優先度: {p.priority}</p>
                    </div>
                  ))
                )}
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">{editTarget ? '協力会社編集' : '協力会社登録'}</h2>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="form-label">会社名 *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="form-input" required />
              </div>
              <div>
                <label className="form-label">種別</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="form-input">
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">担当者名</label>
                <input type="text" value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} className="form-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">電話番号</label>
                  <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="form-input" />
                </div>
                <div>
                  <label className="form-label">優先度（数値）</label>
                  <input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="form-input" min="0" />
                </div>
              </div>
              <div>
                <label className="form-label">メールアドレス</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="form-input" />
              </div>
              <div>
                <label className="form-label">住所</label>
                <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="form-input" />
              </div>
              <div>
                <label className="form-label">Webサイト</label>
                <input type="url" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} className="form-input" placeholder="https://" />
              </div>
              <div>
                <label className="form-label">備考</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="form-input" rows={3} />
              </div>

              {/* 契約単価 */}
              <h4 className="text-sm font-semibold text-gray-700 border-b pb-1 mt-2">契約単価</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">契約締結日</label>
                  <input type="date" value={form.contractDate} onChange={e => setForm(f => ({ ...f, contractDate: e.target.value }))} className="form-input" />
                </div>
                <div>
                  <label className="form-label">契約方法</label>
                  <input type="text" value={form.contractMethod} onChange={e => setForm(f => ({ ...f, contractMethod: e.target.value }))} className="form-input" placeholder="GMO / 郵送 など" />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {PRICE_FIELDS.map(({ key, label }) => (
                  <div key={key}>
                    <label className="form-label">{label}</label>
                    <input type="number" min="0" step="1" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="form-input text-right" />
                  </div>
                ))}
              </div>

              {editTarget && (
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="w-4 h-4 rounded border-gray-300" />
                  有効（オフにすると一覧に表示されなくなります）
                </label>
              )}

              {saveError && (
                <p className="text-sm text-red-600">{saveError.response?.data?.error || '保存に失敗しました'}</p>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={closeForm} className="btn-secondary flex-1">キャンセル</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-50">{editTarget ? '保存' : '登録'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
