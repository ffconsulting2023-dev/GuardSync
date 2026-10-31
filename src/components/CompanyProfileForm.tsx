import React, { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { COMPANY_INSURANCE_FIELDS } from '../../shared/import'

const PROFILE_FIELDS = {
  name: '会社名',
  nameKana: '会社名（カナ）',
  nameOrigin: '社名の由来',
  representative: '代表者',
  establishedOn: '設立',
  capital: '資本金',
  businessDescription: '事業内容',
  vision: 'ビジョン',
  postalCode: '郵便番号',
  address: '所在地',
  phone: '電話番号',
  email: 'メールアドレス',
  website: 'ホームページ',
} as const

// 警備業の認定（警備業法4条・5条）
const LICENSE_TEXT_FIELDS = {
  securityLicenseNumber: '認定番号',
  securityLicenseAuthority: '認定公安委員会',
  securityServiceCategories: '警備業務の区分',
  securityEducationManager: '警備員指導教育責任者',
} as const
const DATE_FIELDS = ['securityLicenseDate', 'securityLicenseExpiry'] as const
const LICENSE_YEARS = 5 // 認定の有効期間
const EXPIRY_WARNING_DAYS = 90 // 更新申請の目安（有効期間満了の30日前までに申請）

// 認定年月日から有効期限（5年後の前日）を求める
function licenseExpiryFrom(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCFullYear(d.getUTCFullYear() + LICENSE_YEARS)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
const daysUntil = (date: string) => Math.ceil((new Date(`${date}T00:00:00Z`).getTime() - Date.now()) / 86_400_000)

// 会社概要と社保・雇用保険の事業所情報（設定画面・スーパー管理者の会社管理で共通利用）
export default function CompanyProfileForm({ companyId, canEdit }: { companyId?: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const key = ['company-profile', companyId ?? 'self']
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get('/company/profile', { params: { companyId } }).then(r => r.data) })
  const [form, setForm] = useState<Record<string, string>>({})
  useEffect(() => {
    if (data) setForm(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, (DATE_FIELDS as readonly string[]).includes(k) && v ? String(v).slice(0, 10) : (v as string) ?? ''])))
  }, [data])
  const save = useMutation({
    mutationFn: () => {
      const keys = [...Object.keys(PROFILE_FIELDS), ...Object.keys(LICENSE_TEXT_FIELDS), ...DATE_FIELDS, ...Object.keys(COMPANY_INSURANCE_FIELDS)]
      return api.put('/company/profile', Object.fromEntries(keys.map(k => [k, form[k] ?? ''])), { params: { companyId } })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })
  const field = (k: string, label: string) => (
    <div key={k}>
      <label className="form-label">{label}</label>
      <input value={form[k] ?? ''} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className="form-input" disabled={!canEdit} />
    </div>
  )
  if (!data) return <div className="card text-center py-6 text-gray-400">読み込み中...</div>
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h3 className="font-semibold text-gray-800">会社概要 <span className="text-xs text-gray-400 font-normal">会社コード: {data.code}</span></h3>
        <div className="grid md:grid-cols-2 gap-3">{Object.entries(PROFILE_FIELDS).map(([k, l]) => field(k, l))}</div>
      </div>
      <div className="card space-y-3">
        <h3 className="font-semibold text-gray-800">警備業の認定</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {field('securityLicenseNumber', LICENSE_TEXT_FIELDS.securityLicenseNumber)}
          {field('securityLicenseAuthority', LICENSE_TEXT_FIELDS.securityLicenseAuthority)}
          <div>
            <label className="form-label">認定年月日</label>
            <input type="date" value={form.securityLicenseDate ?? ''} disabled={!canEdit} className="form-input"
              onChange={e => {
                const date = e.target.value
                // 有効期限が空、または前の認定年月日から計算した値のままなら、新しい認定年月日から計算し直す
                setForm(f => {
                  const autoExpiry = !f.securityLicenseExpiry || (f.securityLicenseDate && f.securityLicenseExpiry === licenseExpiryFrom(f.securityLicenseDate))
                  return { ...f, securityLicenseDate: date, ...(date && autoExpiry ? { securityLicenseExpiry: licenseExpiryFrom(date) } : {}) }
                })
              }} />
          </div>
          <div>
            <label className="form-label">有効期限</label>
            <input type="date" value={form.securityLicenseExpiry ?? ''} disabled={!canEdit} className="form-input"
              onChange={e => setForm(f => ({ ...f, securityLicenseExpiry: e.target.value }))} />
            {form.securityLicenseExpiry && (() => {
              const days = daysUntil(form.securityLicenseExpiry)
              return (
                <p className={`text-xs mt-1 ${days <= EXPIRY_WARNING_DAYS ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                  {days < 0 ? `有効期限が ${-days} 日過ぎています` : `残り ${days} 日`}
                  {days >= 0 && days <= EXPIRY_WARNING_DAYS && '（更新申請は有効期間満了の30日前までに公安委員会へ）'}
                </p>
              )
            })()}
            <p className="text-[11px] text-gray-400 mt-0.5">認定年月日を入れると5年後の前日が自動で入ります</p>
          </div>
          {field('securityServiceCategories', LICENSE_TEXT_FIELDS.securityServiceCategories)}
          {field('securityEducationManager', LICENSE_TEXT_FIELDS.securityEducationManager)}
        </div>
      </div>
      <div className="card space-y-3">
        <h3 className="font-semibold text-gray-800">社会保険・労働保険（事業所情報）</h3>
        <div className="grid md:grid-cols-2 gap-3">{Object.entries(COMPANY_INSURANCE_FIELDS).map(([k, l]) => field(k, l))}</div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary text-sm disabled:opacity-50">保存</button>
          {save.isSuccess && <span className="text-sm text-green-700">保存しました</span>}
          {save.isError && <span className="text-sm text-red-600">{(save.error as any)?.response?.data?.error || '保存に失敗しました'}</span>}
        </div>
      )}
    </div>
  )
}
