import React, { useState } from 'react'
import {
  REPORT_WEATHER, REPORT_PATROL_RESULT, MAX_PHOTOS_PER_REPORT,
  type ReportContent, type ReportTemplate, type PhotoInput, type CustomFieldDef,
} from '../../../shared/securityReport'
import { resizeImageFile, getCurrentLocation } from '../../lib/image'

export type ReportFormValue = ReportContent
export const EMPTY_PATROL: ReportContent['patrolRecords'][number] = { time: '', location: '', result: 'NORMAL', note: '' }
export const EMPTY_REPORT_CONTENT: ReportFormValue = {
  weather: '晴れ', breakMinutes: 0, patrolRecords: [EMPTY_PATROL],
  hasIncident: false, incidents: '', specialNotes: '', customFields: [],
}

// 入力途中の空行・空欄を落とし、帳票設定の項目名をスナップショットとして付与して送信形式にする
export function toSubmitContent(v: ReportFormValue, template: ReportTemplate): ReportContent {
  const values = new Map(v.customFields.map(f => [f.key, f.value]))
  return {
    ...v,
    workStart: v.workStart || undefined,
    workEnd: v.workEnd || undefined,
    patrolRecords: v.patrolRecords.filter(p => p.time && p.location),
    customFields: template.customFields
      .filter(d => values.has(d.key) && values.get(d.key) !== '')
      .map(d => ({ key: d.key, label: d.label, value: values.get(d.key)! })),
  }
}

// 既存報告書の content をフォーム値に戻す（巡回記録が空なら入力用の1行を出す）
export function fromSavedContent(c: Partial<ReportContent> | null | undefined): ReportFormValue {
  const v = { ...EMPTY_REPORT_CONTENT, ...(c ?? {}) } as ReportFormValue
  return { ...v, patrolRecords: v.patrolRecords?.length ? v.patrolRecords : [EMPTY_PATROL], customFields: v.customFields ?? [] }
}

interface Props {
  value: ReportFormValue
  onChange: (v: ReportFormValue) => void
  template: ReportTemplate
  // 写真ピッカーを出す場合のみ指定（既存報告書の写真管理は呼び出し側で行う）
  photos?: PhotoInput[]
  onPhotosChange?: (p: PhotoInput[]) => void
}

function CustomFieldInput({ def, value, onChange }: { def: CustomFieldDef; value: unknown; onChange: (v: string | number | boolean | undefined) => void }) {
  const label = <label className="form-label">{def.label}{def.required ? ' *' : ''}</label>
  switch (def.type) {
    case 'textarea':
      return <div>{label}<textarea value={String(value ?? '')} onChange={e => onChange(e.target.value)} className="form-input" rows={3} maxLength={1000} /></div>
    case 'number':
      return <div>{label}<input type="number" inputMode="decimal" value={value === undefined ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} className="form-input" /></div>
    case 'select':
      return (
        <div>{label}
          <select value={String(value ?? '')} onChange={e => onChange(e.target.value || undefined)} className="form-input">
            <option value="">選択してください</option>
            {def.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      )
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} />
          {def.label}{def.required ? ' *' : ''}
        </label>
      )
    default:
      return <div>{label}<input value={String(value ?? '')} onChange={e => onChange(e.target.value)} className="form-input" maxLength={1000} /></div>
  }
}

// 警備報告書の本文入力（隊員アプリ・管理画面で共通利用）
export default function ReportContentForm({ value, onChange, template, photos, onPhotosChange }: Props) {
  const [photoError, setPhotoError] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const shown = (s: ReportTemplate['hiddenSections'][number]) => !template.hiddenSections.includes(s)
  const set = (patch: Partial<ReportFormValue>) => onChange({ ...value, ...patch })
  const setPatrol = (i: number, patch: Partial<ReportFormValue['patrolRecords'][number]>) =>
    set({ patrolRecords: value.patrolRecords.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const customValue = (key: string) => value.customFields.find(f => f.key === key)?.value
  const setCustom = (def: CustomFieldDef, v: string | number | boolean | undefined) => {
    const rest = value.customFields.filter(f => f.key !== def.key)
    set({ customFields: v === undefined ? rest : [...rest, { key: def.key, label: def.label, value: v }] })
  }

  // input の FileList は value クリアで空になるため、呼び出し側で配列にコピーしてから渡す
  const addPhotos = async (files: File[]) => {
    if (!files.length || !photos || !onPhotosChange) return
    setPhotoError('')
    const room = MAX_PHOTOS_PER_REPORT - photos.length
    if (files.length > room) setPhotoError(`写真は${MAX_PHOTOS_PER_REPORT}枚までです`)
    setPhotoBusy(true)
    try {
      const loc = await getCurrentLocation()
      const added: PhotoInput[] = []
      for (const f of files.slice(0, room)) {
        try { added.push({ dataUrl: await resizeImageFile(f), caption: '', ...loc }) }
        catch (e: any) { setPhotoError(e.message) }
      }
      onPhotosChange([...photos, ...added])
    } finally {
      setPhotoBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {template.headerNote && <p className="text-xs text-gray-600 bg-gray-50 rounded p-2 whitespace-pre-wrap">{template.headerNote}</p>}
      <div>
        <label className="form-label">天候</label>
        <select value={value.weather} onChange={e => set({ weather: e.target.value as ReportFormValue['weather'] })} className="form-input">
          {REPORT_WEATHER.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>

      {shown('workTime') && (
        <div className="grid grid-cols-3 gap-2">
          <div><label className="form-label">開始</label><input type="time" value={value.workStart ?? ''} onChange={e => set({ workStart: e.target.value || undefined })} className="form-input" /></div>
          <div><label className="form-label">終了</label><input type="time" value={value.workEnd ?? ''} onChange={e => set({ workEnd: e.target.value || undefined })} className="form-input" /></div>
          <div><label className="form-label">休憩(分)</label><input type="number" min={0} max={480} value={value.breakMinutes} onChange={e => set({ breakMinutes: Math.min(480, Math.max(0, Number(e.target.value) || 0)) })} className="form-input" /></div>
        </div>
      )}

      {shown('patrol') && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="form-label mb-0">巡回記録</label>
            <button type="button" onClick={() => set({ patrolRecords: [...value.patrolRecords, EMPTY_PATROL] })} className="text-blue-600 text-xs">+ 行追加</button>
          </div>
          <div className="space-y-2">
            {value.patrolRecords.map((p, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-2 space-y-2">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <input type="time" value={p.time} onChange={e => setPatrol(i, { time: e.target.value })} className="form-input" />
                  <select value={p.result} onChange={e => setPatrol(i, { result: e.target.value as 'NORMAL' | 'ABNORMAL' })} className="form-input">
                    {Object.entries(REPORT_PATROL_RESULT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <button type="button" onClick={() => set({ patrolRecords: value.patrolRecords.filter((_, j) => j !== i) })} className="text-gray-400 px-1" aria-label="行を削除">✕</button>
                </div>
                <input value={p.location} onChange={e => setPatrol(i, { location: e.target.value })} className="form-input" placeholder="巡回場所" maxLength={100} />
                <input value={p.note} onChange={e => setPatrol(i, { note: e.target.value })} className="form-input" placeholder="備考" maxLength={500} />
              </div>
            ))}
          </div>
        </div>
      )}

      {shown('incident') && (
        <>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={value.hasIncident} onChange={e => set({ hasIncident: e.target.checked })} />
            異常・インシデントあり
          </label>
          <div>
            <label className="form-label">異常・インシデントの内容と対応</label>
            <textarea value={value.incidents} onChange={e => set({ incidents: e.target.value })} className="form-input" rows={4} maxLength={3000} placeholder="異常なし、または発生した事象を記載" />
          </div>
        </>
      )}

      {shown('notes') && (
        <div>
          <label className="form-label">引継・連絡事項</label>
          <textarea value={value.specialNotes} onChange={e => set({ specialNotes: e.target.value })} className="form-input" rows={3} maxLength={3000} placeholder="引き継ぎ事項等" />
        </div>
      )}

      {template.customFields.length > 0 && (
        <div className="space-y-3 border-t border-gray-100 pt-3">
          {template.customFields.map(def => (
            <CustomFieldInput key={def.key} def={def} value={customValue(def.key)} onChange={v => setCustom(def, v)} />
          ))}
        </div>
      )}

      {shown('photos') && photos && onPhotosChange && (
        <div>
          <label className="form-label">現場写真{template.minPhotos > 0 ? `（${template.minPhotos}枚以上必須）` : ''}</label>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div key={i} className="space-y-1">
                <div className="relative">
                  <img src={p.dataUrl} alt={`写真${i + 1}`} className="w-full aspect-square object-cover rounded border" />
                  <button type="button" onClick={() => onPhotosChange(photos.filter((_, j) => j !== i))} className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-6 h-6 text-xs" aria-label="写真を削除">✕</button>
                </div>
                <input value={p.caption} onChange={e => onPhotosChange(photos.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} className="form-input text-xs py-1" placeholder="説明" maxLength={100} />
              </div>
            ))}
            {photos.length < MAX_PHOTOS_PER_REPORT && (
              <label className="aspect-square border-2 border-dashed border-gray-300 rounded flex flex-col items-center justify-center text-gray-400 text-xs cursor-pointer">
                <span className="text-2xl">📷</span>{photoBusy ? '処理中...' : '撮影・選択'}
                <input type="file" accept="image/*" capture="environment" multiple className="hidden" disabled={photoBusy} onChange={e => { addPhotos(Array.from(e.target.files ?? [])); e.target.value = '' }} />
              </label>
            )}
          </div>
          {photoError && <p className="text-xs text-red-600 mt-1">{photoError}</p>}
        </div>
      )}
    </div>
  )
}
