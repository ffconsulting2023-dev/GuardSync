import React, { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  REPORT_SECTION, CUSTOM_FIELD_TYPE, MAX_PHOTOS_PER_REPORT, DEFAULT_REPORT_TEMPLATE,
  type ReportTemplate, type ReportSection, type CustomFieldDef, type CustomFieldType,
} from '../../../shared/securityReport'

const newFieldKey = (fields: CustomFieldDef[]) => {
  let i = fields.length + 1
  while (fields.some(f => f.key === `field_${i}`)) i++
  return `field_${i}`
}

// 顧客別の警備報告書 帳票設定
export default function ReportTemplateEditor({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const [t, setT] = useState<ReportTemplate>(DEFAULT_REPORT_TEMPLATE)
  const [saved, setSaved] = useState(false)
  const { data } = useQuery({
    queryKey: ['client-report-template', clientId],
    queryFn: () => api.get(`/clients/${clientId}/report-template`).then(r => r.data),
  })
  useEffect(() => { if (data?.settings) setT(data.settings) }, [data])

  const save = useMutation({
    mutationFn: () => api.put(`/clients/${clientId}/report-template`, { settings: t }),
    onSuccess: () => {
      setSaved(true)
      qc.invalidateQueries({ queryKey: ['client-report-template', clientId] })
      qc.invalidateQueries({ queryKey: ['site-report-template'] })
    },
  })

  const set = (patch: Partial<ReportTemplate>) => { setSaved(false); setT(v => ({ ...v, ...patch })) }
  const setField = (i: number, patch: Partial<CustomFieldDef>) =>
    set({ customFields: t.customFields.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const toggleSection = (s: ReportSection) =>
    set({ hiddenSections: t.hiddenSections.includes(s) ? t.hiddenSections.filter(x => x !== s) : [...t.hiddenSections, s] })

  return (
    // 顧客情報フォームの内側に置かれるため、Enterでの誤送信を防ぐ
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5"
      onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault() }}>
      <div>
        <h3 className="font-semibold text-gray-700">警備報告書の帳票設定</h3>
        <p className="text-xs text-gray-500 mt-0.5">この顧客の現場で作成する報告書の項目・表示を設定します。{data?.isDefault ? '（現在は標準設定）' : ''}</p>
      </div>
      <fieldset disabled={!canEdit} className="space-y-5">
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="form-label">帳票タイトル</label>
            <input value={t.title} onChange={e => set({ title: e.target.value })} className="form-input" maxLength={40} />
          </div>
          <div>
            <label className="form-label">現場写真の必須枚数</label>
            <input type="number" min={0} max={MAX_PHOTOS_PER_REPORT} value={t.minPhotos}
              onChange={e => set({ minPhotos: Math.min(MAX_PHOTOS_PER_REPORT, Math.max(0, Number(e.target.value) || 0)) })} className="form-input" />
          </div>
          <div>
            <label className="form-label">ヘッダー注記</label>
            <textarea value={t.headerNote} onChange={e => set({ headerNote: e.target.value })} className="form-input" rows={2} maxLength={300} placeholder="例: 本報告書は○○建設様指定様式です" />
          </div>
          <div>
            <label className="form-label">フッター注記</label>
            <textarea value={t.footerNote} onChange={e => set({ footerNote: e.target.value })} className="form-input" rows={2} maxLength={300} />
          </div>
        </div>

        <div>
          <p className="form-label">表示する項目</p>
          <div className="flex flex-wrap gap-4">
            {(Object.entries(REPORT_SECTION) as [ReportSection, string][]).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={!t.hiddenSections.includes(k)} onChange={() => toggleSection(k)} />{label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="form-label mb-0">顧客独自の項目（最大20）</p>
            {t.customFields.length < 20 && (
              <button type="button" onClick={() => set({ customFields: [...t.customFields, { key: newFieldKey(t.customFields), label: '', type: 'text', options: [], required: false }] })}
                className="text-blue-600 text-xs">+ 項目追加</button>
            )}
          </div>
          {t.customFields.length === 0 && <p className="text-xs text-gray-400">例: 交通誘導の誘導台数、KY活動実施、立入者数 など</p>}
          <div className="space-y-2">
            {t.customFields.map((f, i) => (
              <div key={f.key} className="border border-gray-200 rounded-lg p-3 grid md:grid-cols-[1fr_10rem_auto_auto] gap-2 items-center">
                <input value={f.label} onChange={e => setField(i, { label: e.target.value })} className="form-input" placeholder="項目名" maxLength={40} />
                <select value={f.type} onChange={e => setField(i, { type: e.target.value as CustomFieldType })} className="form-input">
                  {Object.entries(CUSTOM_FIELD_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                  <input type="checkbox" checked={f.required} onChange={e => setField(i, { required: e.target.checked })} />必須
                </label>
                <button type="button" onClick={() => set({ customFields: t.customFields.filter((_, j) => j !== i) })} className="text-red-600 text-xs">削除</button>
                {f.type === 'select' && (
                  <input value={f.options.join(',')} onChange={e => setField(i, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    className="form-input md:col-span-4" placeholder="選択肢をカンマ区切りで入力（例: 良好,注意,不良）" />
                )}
              </div>
            ))}
          </div>
        </div>
      </fieldset>

      {save.isError && <p className="text-sm text-red-600">{(save.error as any)?.response?.data?.error || '保存に失敗しました'}</p>}
      {canEdit && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending || t.customFields.some(f => !f.label)} className="btn-primary text-sm disabled:opacity-50">帳票設定を保存</button>
          {saved && <span className="text-xs text-green-600">保存しました</span>}
          {t.customFields.some(f => !f.label) && <span className="text-xs text-gray-500">項目名を入力してください</span>}
        </div>
      )}
    </div>
  )
}
