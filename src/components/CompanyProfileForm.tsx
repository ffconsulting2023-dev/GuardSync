import React, { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { COMPANY_INSURANCE_FIELDS } from '../../shared/import'

const PROFILE_FIELDS = {
  name: '会社名',
  nameKana: '会社名（カナ）',
  representative: '代表者',
  postalCode: '郵便番号',
  address: '所在地',
  phone: '電話番号',
  email: 'メールアドレス',
  website: 'ホームページ',
  securityLicenseNumber: '警備業認定番号',
} as const

// 会社概要と社保・雇用保険の事業所情報（設定画面・スーパー管理者の会社管理で共通利用）
export default function CompanyProfileForm({ companyId, canEdit }: { companyId?: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const key = ['company-profile', companyId ?? 'self']
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get('/company/profile', { params: { companyId } }).then(r => r.data) })
  const [form, setForm] = useState<Record<string, string>>({})
  useEffect(() => { if (data) setForm(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, (v as string) ?? '']))) }, [data])
  const save = useMutation({
    mutationFn: () => {
      const keys = [...Object.keys(PROFILE_FIELDS), ...Object.keys(COMPANY_INSURANCE_FIELDS)]
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
