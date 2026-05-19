import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'
import { CATEGORIES, EMPTY_CLIENT_FORM } from './ClientsPage'

const LOG_TYPES: Record<string, { label: string; icon: string }> = {
  NOTE:    { label: 'メモ',   icon: '📝' },
  CALL:    { label: '電話',   icon: '📞' },
  MEETING: { label: '訪問',   icon: '🤝' },
  EMAIL:   { label: 'メール', icon: '✉️' },
}

const DOC_LABELS: Record<string, string> = {
  unitPriceContract: '単価契約書', otherContract: 'その他契約書',
  invoiceSend: '請求書(送付)', invoiceReceive: '請求書(受領)',
  securityLog: '警備日誌', securityCommission: '警備委託', other: 'その他',
}

type TabKey = 'basic' | 'contacts' | 'accounting' | 'history'

function clientToForm(c: any) {
  const base = { ...EMPTY_CLIENT_FORM }
  const subContacts = Array.isArray(c.subContacts) && c.subContacts.length
    ? [...c.subContacts, ...Array(4).fill({ name: '', phone: '', email: '' })].slice(0, 4)
    : base.subContacts
  return {
    ...base, ...c,
    contractDate: c.contractDate ? c.contractDate.split('T')[0] : '',
    unitPriceDay: c.unitPriceDay ?? '', unitPriceNight: c.unitPriceNight ?? '',
    unitPriceHolidayDay: c.unitPriceHolidayDay ?? '', unitPriceHolidayNight: c.unitPriceHolidayNight ?? '',
    overtimeDayRate: c.overtimeDayRate ?? '', overtimeNightRate: c.overtimeNightRate ?? '',
    overtimeHolidayDayRate: c.overtimeHolidayDayRate ?? '', overtimeHolidayNightRate: c.overtimeHolidayNightRate ?? '',
    qualificationAllowance: c.qualificationAllowance ?? '', radioAllowance: c.radioAllowance ?? '',
    otherAllowance1: c.otherAllowance1 ?? '', otherAllowance2: c.otherAllowance2 ?? '',
    documents: c.documents ?? base.documents,
    subContacts,
    billingSameAsCompany: c.billingSameAsCompany !== false,
  }
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<TabKey>((searchParams.get('tab') as TabKey) || 'basic')
  const [editMode, setEditMode] = useState(isNew)
  const [form, setForm] = useState<any>(EMPTY_CLIENT_FORM)
  const [showLogForm, setShowLogForm] = useState(false)
  const [logForm, setLogForm] = useState({ logType: 'NOTE', content: '' })

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: () => api.get(`/clients/${id}`).then(r => r.data),
    enabled: !isNew,
  })

  useEffect(() => {
    if (client) setForm(clientToForm(client))
  }, [client])

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/clients', data),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['clients'] }); navigate(`/clients/${res.data.id}`) },
  })

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.put(`/clients/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['client', id] }); qc.invalidateQueries({ queryKey: ['clients'] }); setEditMode(false) },
  })

  const logMutation = useMutation({
    mutationFn: (data: any) => api.post(`/clients/${id}/logs`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['client', id] }); setShowLogForm(false); setLogForm({ logType: 'NOTE', content: '' }) },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data = {
      ...form,
      subContacts: form.subContacts.filter((c: any) => c.name || c.phone || c.email),
    }
    if (isNew) createMutation.mutate(data)
    else updateMutation.mutate(data)
  }

  const setSubContact = (i: number, field: string, value: string) => {
    setForm((f: any) => {
      const sc = [...f.subContacts]
      sc[i] = { ...sc[i], [field]: value }
      return { ...f, subContacts: sc }
    })
  }

  const setDoc = (key: string, value: boolean) => {
    setForm((f: any) => ({ ...f, documents: { ...f.documents, [key]: value } }))
  }

  const copyAddressToBilling = () => {
    setForm((f: any) => ({
      ...f,
      billingPostalCode: f.postalCode, billingPrefecture: f.prefecture, billingCity: f.city,
      billingAddressDetail: f.addressDetail, billingBuildingName: f.buildingName, billingAddressee: f.addressee,
    }))
  }

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')
  const cat = CATEGORIES[form.category] || CATEGORIES.OTHER

  if (!isNew && isLoading) return <div className="flex items-center justify-center h-full text-gray-400">読み込み中...</div>

  return (
    <div className="flex flex-col h-full">
      {/* ページヘッダー */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate('/clients')} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          {!isNew && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{client?.clientCode || '—'}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cat.color}`}>{cat.label}</span>
            </div>
          )}
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-[#1e3a5f] rounded-xl flex items-center justify-center text-white font-bold text-lg">
              {isNew ? '+' : (form.name?.[0] || '?')}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {isNew ? '取引先 新規登録' : (form.name || '—')}
              </h1>
              {form.nameKana && <p className="text-sm text-gray-400">{form.nameKana}</p>}
            </div>
          </div>
          {canEdit && (
            <div className="flex gap-2 flex-shrink-0">
              {!isNew && !editMode && (
                <>
                  <button onClick={() => setShowLogForm(true)} className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                    + 連絡ログ
                  </button>
                  <button onClick={() => setEditMode(true)} className="flex items-center gap-1.5 px-4 py-2 bg-[#1e3a5f] rounded-lg text-sm text-white hover:bg-[#2d5282]">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    編集
                  </button>
                </>
              )}
              {editMode && (
                <>
                  {!isNew && <button onClick={() => { setEditMode(false); if (client) setForm(clientToForm(client)) }} className="btn-secondary text-sm">キャンセル</button>}
                  <button form="client-form" type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="btn-primary text-sm disabled:opacity-50">
                    {isNew ? '登録' : '保存'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* タブ */}
        {!isNew && (
          <div className="flex gap-0 mt-4 -mb-4">
            {([
              { key: 'basic',       label: '基本情報・連絡先' },
              { key: 'contacts',    label: `担当者（${client?.subContacts?.filter((c: any) => c.name)?.length ?? 0}）` },
              { key: 'accounting',  label: '経理情報' },
              { key: 'history',     label: `取引履歴（${client?._count?.sites ?? 0}件）` },
            ] as { key: TabKey; label: string }[]).map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.key ? 'border-[#1e3a5f] text-[#1e3a5f]' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* メインコンテンツ */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <form id="client-form" onSubmit={handleSubmit}>
          <div className="flex gap-4 items-start">
            {/* 左：詳細 */}
            <div className="flex-1 min-w-0 space-y-4">

              {/* 新規登録は全セクション表示、詳細はタブ表示 */}
              {(isNew || tab === 'basic') && (
                <>
                  {/* ①基本情報 */}
                  <Section title="①基本情報">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {!isNew && <Field label="取引先コード" value={client?.clientCode} />}
                      <div className={isNew ? 'col-span-2' : 'col-span-2 md:col-span-3'}>
                        <FormField label="取引先名 *" edit={editMode}>
                          <input type="text" value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} className="form-input" required />
                          <span>{form.name || '—'}</span>
                        </FormField>
                      </div>
                      <div>
                        <FormField label="フリガナ" edit={editMode}>
                          <input type="text" value={form.nameKana} onChange={e => setForm((f: any) => ({ ...f, nameKana: e.target.value }))} className="form-input" />
                          <span>{form.nameKana || '—'}</span>
                        </FormField>
                      </div>
                      <div>
                        <FormField label="代表役職" edit={editMode}>
                          <input type="text" value={form.positionTitle} onChange={e => setForm((f: any) => ({ ...f, positionTitle: e.target.value }))} className="form-input" />
                          <span>{form.positionTitle || '—'}</span>
                        </FormField>
                      </div>
                      <div>
                        <FormField label="代表者名" edit={editMode}>
                          <input type="text" value={form.contactName} onChange={e => setForm((f: any) => ({ ...f, contactName: e.target.value }))} className="form-input" />
                          <span>{form.contactName || '—'}</span>
                        </FormField>
                      </div>
                      <div>
                        <FormField label="電話番号" edit={editMode}>
                          <input type="tel" value={form.phone} onChange={e => setForm((f: any) => ({ ...f, phone: e.target.value }))} className="form-input" />
                          <span>{form.phone || '—'}</span>
                        </FormField>
                      </div>
                      <div>
                        <FormField label="FAX番号" edit={editMode}>
                          <input type="tel" value={form.fax} onChange={e => setForm((f: any) => ({ ...f, fax: e.target.value }))} className="form-input" />
                          <span>{form.fax || '—'}</span>
                        </FormField>
                      </div>
                      <div className="col-span-2">
                        <FormField label="メール" edit={editMode}>
                          <input type="email" value={form.email} onChange={e => setForm((f: any) => ({ ...f, email: e.target.value }))} className="form-input" />
                          <span>{form.email ? <a href={`mailto:${form.email}`} className="text-blue-600 hover:underline">{form.email}</a> : '—'}</span>
                        </FormField>
                      </div>
                      <div className="col-span-2">
                        <FormField label="HP（ウェブサイト）" edit={editMode}>
                          <input type="url" value={form.website} onChange={e => setForm((f: any) => ({ ...f, website: e.target.value }))} className="form-input" placeholder="https://" />
                          <span>{form.website ? <a href={form.website} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{form.website}</a> : '—'}</span>
                        </FormField>
                      </div>
                      <div>
                        <FormField label="関係性" edit={editMode}>
                          <input type="text" value={form.relationship} onChange={e => setForm((f: any) => ({ ...f, relationship: e.target.value }))} className="form-input" placeholder="依頼主・協力会社等" />
                          <span>{form.relationship || '—'}</span>
                        </FormField>
                      </div>
                      <div>
                        <FormField label="業種" edit={editMode}>
                          <input type="text" value={form.industry} onChange={e => setForm((f: any) => ({ ...f, industry: e.target.value }))} className="form-input" placeholder="ハウスメーカー等" />
                          <span>{form.industry || '—'}</span>
                        </FormField>
                      </div>
                      <div>
                        <FormField label="区分" edit={editMode}>
                          <select value={form.category} onChange={e => setForm((f: any) => ({ ...f, category: e.target.value }))} className="form-input">
                            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select>
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cat.color}`}>{cat.label}</span>
                        </FormField>
                      </div>
                      <div className="col-span-2 md:col-span-4">
                        <FormField label="経理担当" edit={editMode}>
                          <div className="grid grid-cols-3 gap-2">
                            <input type="text" value={form.accountingContactName} onChange={e => setForm((f: any) => ({ ...f, accountingContactName: e.target.value }))} className="form-input" placeholder="担当者名" />
                            <input type="tel" value={form.accountingPhone} onChange={e => setForm((f: any) => ({ ...f, accountingPhone: e.target.value }))} className="form-input" placeholder="電話番号" />
                            <input type="email" value={form.accountingEmail} onChange={e => setForm((f: any) => ({ ...f, accountingEmail: e.target.value }))} className="form-input" placeholder="メール" />
                          </div>
                          <span>{[form.accountingContactName, form.accountingPhone, form.accountingEmail].filter(Boolean).join(' / ') || '—'}</span>
                        </FormField>
                      </div>
                      <div className="col-span-2 md:col-span-4">
                        <FormField label="備考" edit={editMode}>
                          <textarea value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="form-input" rows={2} />
                          <span className="whitespace-pre-wrap">{form.notes || '—'}</span>
                        </FormField>
                      </div>
                    </div>
                  </Section>

                  {/* ③会社住所 */}
                  <Section title="③会社住所">
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                      <div className="col-span-2">
                        <FormField label="郵便番号" edit={editMode}>
                          <input type="text" value={form.postalCode} onChange={e => setForm((f: any) => ({ ...f, postalCode: e.target.value }))} className="form-input" placeholder="157-0036" />
                          <span>{form.postalCode || '—'}</span>
                        </FormField>
                      </div>
                      <div className="col-span-2">
                        <FormField label="都道府県" edit={editMode}>
                          <input type="text" value={form.prefecture} onChange={e => setForm((f: any) => ({ ...f, prefecture: e.target.value }))} className="form-input" placeholder="東京都" />
                          <span>{form.prefecture || '—'}</span>
                        </FormField>
                      </div>
                      <div className="col-span-2">
                        <FormField label="市区町村" edit={editMode}>
                          <input type="text" value={form.city} onChange={e => setForm((f: any) => ({ ...f, city: e.target.value }))} className="form-input" placeholder="世田谷区" />
                          <span>{form.city || '—'}</span>
                        </FormField>
                      </div>
                      <div className="col-span-2 md:col-span-4">
                        <FormField label="地域以下" edit={editMode}>
                          <input type="text" value={form.addressDetail} onChange={e => setForm((f: any) => ({ ...f, addressDetail: e.target.value }))} className="form-input" />
                          <span>{form.addressDetail || '—'}</span>
                        </FormField>
                      </div>
                      <div className="col-span-2">
                        <FormField label="建物名" edit={editMode}>
                          <input type="text" value={form.buildingName} onChange={e => setForm((f: any) => ({ ...f, buildingName: e.target.value }))} className="form-input" />
                          <span>{form.buildingName || '—'}</span>
                        </FormField>
                      </div>
                      <div className="col-span-2">
                        <FormField label="宛名" edit={editMode}>
                          <input type="text" value={form.addressee} onChange={e => setForm((f: any) => ({ ...f, addressee: e.target.value }))} className="form-input" />
                          <span>{form.addressee || '—'}</span>
                        </FormField>
                      </div>
                    </div>
                  </Section>

                  {/* ④請求先住所 */}
                  <Section title="④請求先住所">
                    {editMode ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="checkbox" checked={form.billingSameAsCompany} onChange={e => setForm((f: any) => ({ ...f, billingSameAsCompany: e.target.checked }))} className="w-4 h-4" />
                            会社住所と同じ
                          </label>
                          {!form.billingSameAsCompany && (
                            <button type="button" onClick={copyAddressToBilling} className="text-xs text-blue-600 hover:underline">会社住所をコピー</button>
                          )}
                        </div>
                        {!form.billingSameAsCompany && (
                          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                            <div className="col-span-2"><label className="form-label">郵便番号</label><input type="text" value={form.billingPostalCode} onChange={e => setForm((f: any) => ({ ...f, billingPostalCode: e.target.value }))} className="form-input" /></div>
                            <div className="col-span-2"><label className="form-label">都道府県</label><input type="text" value={form.billingPrefecture} onChange={e => setForm((f: any) => ({ ...f, billingPrefecture: e.target.value }))} className="form-input" /></div>
                            <div className="col-span-2"><label className="form-label">市区町村</label><input type="text" value={form.billingCity} onChange={e => setForm((f: any) => ({ ...f, billingCity: e.target.value }))} className="form-input" /></div>
                            <div className="col-span-2 md:col-span-4"><label className="form-label">地域以下</label><input type="text" value={form.billingAddressDetail} onChange={e => setForm((f: any) => ({ ...f, billingAddressDetail: e.target.value }))} className="form-input" /></div>
                            <div className="col-span-2"><label className="form-label">建物名</label><input type="text" value={form.billingBuildingName} onChange={e => setForm((f: any) => ({ ...f, billingBuildingName: e.target.value }))} className="form-input" /></div>
                            <div className="col-span-2"><label className="form-label">宛名</label><input type="text" value={form.billingAddressee} onChange={e => setForm((f: any) => ({ ...f, billingAddressee: e.target.value }))} className="form-input" /></div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-600">
                        {form.billingSameAsCompany ? '会社住所と同じ' : [form.billingPostalCode, form.billingPrefecture, form.billingCity, form.billingAddressDetail, form.billingBuildingName].filter(Boolean).join(' ') || '—'}
                      </p>
                    )}
                  </Section>

                  {/* ④書類 */}
                  <Section title="④書類">
                    <div className="flex flex-wrap gap-3">
                      {Object.entries(DOC_LABELS).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!(form.documents?.[key])}
                            onChange={e => editMode && setDoc(key, e.target.checked)}
                            disabled={!editMode}
                            className="w-4 h-4"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </Section>
                </>
              )}

              {(isNew || tab === 'contacts') && (
                /* ②担当者 */
                <Section title="②担当者">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-2 pr-3 text-xs text-gray-500 font-medium">担当者</th>
                          <th className="text-left py-2 pr-3 text-xs text-gray-500 font-medium">電話</th>
                          <th className="text-left py-2 text-xs text-gray-500 font-medium">メール</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {form.subContacts.map((sc: any, i: number) => (
                          <tr key={i}>
                            <td className="py-2 pr-3">
                              {editMode ? (
                                <input type="text" value={sc.name} onChange={e => setSubContact(i, 'name', e.target.value)} className="form-input" placeholder={`担当者${i + 1}`} />
                              ) : (
                                <span className="text-gray-700">{sc.name || <span className="text-gray-300">—</span>}</span>
                              )}
                            </td>
                            <td className="py-2 pr-3">
                              {editMode ? (
                                <input type="tel" value={sc.phone} onChange={e => setSubContact(i, 'phone', e.target.value)} className="form-input" />
                              ) : (
                                <span className="text-gray-600">{sc.phone || <span className="text-gray-300">—</span>}</span>
                              )}
                            </td>
                            <td className="py-2">
                              {editMode ? (
                                <input type="email" value={sc.email} onChange={e => setSubContact(i, 'email', e.target.value)} className="form-input" />
                              ) : (
                                <span className="text-gray-500">{sc.email || <span className="text-gray-300">—</span>}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {(isNew || tab === 'accounting') && (
                <>
                  {/* ⑤振込先 */}
                  <Section title="⑤振込先">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div>
                        <FormField label="銀行名" edit={editMode}>
                          <input type="text" value={form.bankName} onChange={e => setForm((f: any) => ({ ...f, bankName: e.target.value }))} className="form-input" />
                          <span>{form.bankName || '—'}</span>
                        </FormField>
                      </div>
                      <div>
                        <FormField label="支店名" edit={editMode}>
                          <input type="text" value={form.bankBranch} onChange={e => setForm((f: any) => ({ ...f, bankBranch: e.target.value }))} className="form-input" />
                          <span>{form.bankBranch || '—'}</span>
                        </FormField>
                      </div>
                      <div>
                        <FormField label="口座種類" edit={editMode}>
                          <select value={form.bankAccountType} onChange={e => setForm((f: any) => ({ ...f, bankAccountType: e.target.value }))} className="form-input">
                            <option value="普通">普通</option><option value="当座">当座</option>
                          </select>
                          <span>{form.bankAccountType || '—'}</span>
                        </FormField>
                      </div>
                      <div>
                        <FormField label="口座番号" edit={editMode}>
                          <input type="text" value={form.bankAccountNumber} onChange={e => setForm((f: any) => ({ ...f, bankAccountNumber: e.target.value }))} className="form-input" />
                          <span>{form.bankAccountNumber || '—'}</span>
                        </FormField>
                      </div>
                      <div>
                        <FormField label="口座名義" edit={editMode}>
                          <input type="text" value={form.bankAccountHolder} onChange={e => setForm((f: any) => ({ ...f, bankAccountHolder: e.target.value }))} className="form-input" />
                          <span>{form.bankAccountHolder || '—'}</span>
                        </FormField>
                      </div>
                    </div>
                  </Section>

                  {/* ⑥契約単価 */}
                  <Section title="⑥契約単価">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div>
                          <FormField label="契約日" edit={editMode}>
                            <input type="date" value={form.contractDate} onChange={e => setForm((f: any) => ({ ...f, contractDate: e.target.value }))} className="form-input" />
                            <span>{form.contractDate || '—'}</span>
                          </FormField>
                        </div>
                        {[
                          { key: 'unitPriceDay', label: '日勤単価' },
                          { key: 'unitPriceNight', label: '夜勤単価' },
                          { key: 'unitPriceHolidayDay', label: '休日日勤単価' },
                          { key: 'unitPriceHolidayNight', label: '休日夜勤単価' },
                        ].map(({ key, label }) => (
                          <div key={key}>
                            <FormField label={label} edit={editMode}>
                              <input type="number" value={form[key]} onChange={e => setForm((f: any) => ({ ...f, [key]: e.target.value }))} className="form-input" />
                              <span>{form[key] ? `¥${Number(form[key]).toLocaleString()}` : '—'}</span>
                            </FormField>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { key: 'overtimeDayRate', label: '(日)残業単価' },
                          { key: 'overtimeNightRate', label: '(夜)残業単価' },
                          { key: 'overtimeHolidayDayRate', label: '(休日)残業単価' },
                          { key: 'overtimeHolidayNightRate', label: '(休夜)残業単価' },
                        ].map(({ key, label }) => (
                          <div key={key}>
                            <FormField label={label} edit={editMode}>
                              <input type="number" value={form[key]} onChange={e => setForm((f: any) => ({ ...f, [key]: e.target.value }))} className="form-input" />
                              <span>{form[key] ? `¥${Number(form[key]).toLocaleString()}` : '—'}</span>
                            </FormField>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { key: 'qualificationAllowance', label: '資格手当' },
                          { key: 'radioAllowance', label: '無線機/台' },
                          { key: 'otherAllowance1', label: 'その他手当1' },
                          { key: 'otherAllowance2', label: 'その他手当2' },
                        ].map(({ key, label }) => (
                          <div key={key}>
                            <FormField label={label} edit={editMode}>
                              <input type="number" value={form[key]} onChange={e => setForm((f: any) => ({ ...f, [key]: e.target.value }))} className="form-input" />
                              <span>{form[key] ? `¥${Number(form[key]).toLocaleString()}` : '—'}</span>
                            </FormField>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Section>

                  {/* インボイス */}
                  <Section title="インボイス情報">
                    <FormField label="インボイス登録番号" edit={editMode}>
                      <input type="text" value={form.invoiceRegistrationNumber} onChange={e => setForm((f: any) => ({ ...f, invoiceRegistrationNumber: e.target.value }))} className="form-input" placeholder="T1234567890123" />
                      <span>{form.invoiceRegistrationNumber || '—'}</span>
                    </FormField>
                  </Section>
                </>
              )}

              {!isNew && tab === 'history' && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h3 className="font-semibold text-gray-700">紐付き現場一覧</h3>
                  </div>
                  {!client?.sites?.length ? (
                    <p className="text-center py-10 text-gray-400 text-sm">現場が登録されていません</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr className="border-b border-gray-100">
                          <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">現場名</th>
                          <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">住所</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {client.sites.map((site: any) => (
                          <tr key={site.id} className="hover:bg-gray-50">
                            <td className="px-5 py-3 font-medium text-gray-800">📍 {site.name}</td>
                            <td className="px-5 py-3 text-gray-500 hidden md:table-cell">{site.address}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>

            {/* 右サイドバー（詳細表示時のみ） */}
            {!isNew && (
              <div className="w-56 flex-shrink-0 space-y-4 hidden lg:block">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h4 className="text-sm font-semibold text-gray-600 mb-3">取引概要</h4>
                  <div>
                    <p className="text-xs text-gray-400">現場数</p>
                    <p className="text-2xl font-bold text-gray-800">{client?._count?.sites ?? 0}<span className="text-sm font-normal text-gray-400 ml-1">件</span></p>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h4 className="text-sm font-semibold text-gray-600 mb-3">最近の活動</h4>
                  {!client?.logs?.length ? (
                    <p className="text-xs text-gray-400">活動ログがありません</p>
                  ) : (
                    <div className="space-y-3">
                      {client.logs.slice(0, 5).map((log: any) => {
                        const lt = LOG_TYPES[log.logType] || LOG_TYPES.NOTE
                        return (
                          <div key={log.id} className="flex gap-2">
                            <span className="text-sm mt-0.5">{lt.icon}</span>
                            <div className="min-w-0">
                              <p className="text-xs text-gray-400">{new Date(log.createdAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}{log.createdByName ? ` · ${log.createdByName}` : ''}</p>
                              <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{log.content}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </form>
      </div>

      {/* 連絡ログフォーム */}
      {showLogForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">連絡ログ追加</h2>
              <button onClick={() => setShowLogForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="form-label">種別</label>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(LOG_TYPES).map(([k, v]) => (
                    <button key={k} type="button" onClick={() => setLogForm(f => ({ ...f, logType: k }))}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${logForm.logType === k ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      <span>{v.icon}</span><span>{v.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="form-label">内容 *</label>
                <textarea value={logForm.content} onChange={e => setLogForm(f => ({ ...f, content: e.target.value }))} className="form-input" rows={4} placeholder="連絡内容・メモを入力..." />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowLogForm(false)} className="btn-secondary flex-1">キャンセル</button>
                <button onClick={() => { if (!logForm.content) return; logMutation.mutate(logForm) }} disabled={!logForm.content || logMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">追加</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── ユーティリティコンポーネント ───

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-800">{value ?? <span className="text-gray-300 font-normal">—</span>}</p>
    </div>
  )
}

function FormField({ label, edit, children }: { label: string; edit: boolean; children: [React.ReactElement, React.ReactElement] }) {
  const [editEl, viewEl] = React.Children.toArray(children) as React.ReactElement[]
  return (
    <div>
      <label className="form-label">{label}</label>
      {edit ? editEl : <div className="text-sm font-medium text-gray-800 py-1">{viewEl}</div>}
    </div>
  )
}
