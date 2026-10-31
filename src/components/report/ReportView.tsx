import React from 'react'
import { format } from 'date-fns'
import { REPORT_PATROL_RESULT, PROXY_SUBMISSION_LABEL, type ReportContent, type ReportTemplate } from '../../../shared/securityReport'

export interface ReportViewData {
  reportDate: string
  content: Partial<ReportContent> | null
  guard?: { name: string } | null
  site?: { name: string; clientName?: string | null; client?: { name: string } | null } | null
  signerName?: string | null
  signerTitle?: string | null
  signatureImage?: string | null
  signedAt?: string | null
  signedLat?: number | null
  signedLng?: number | null
  approvedAt?: string | null
  approvedBy?: string | null
  submittedByName?: string | null
  submittedAsProxy?: boolean
  submissionNote?: string | null
  photos?: { id: string; caption: string | null }[]
}

interface Props {
  report: ReportViewData
  template: ReportTemplate
  companyName?: string
  renderPhoto: (photo: { id: string; caption: string | null }) => React.ReactNode
}

// 警備報告書の閲覧・印刷用表示（管理画面・協力会社共有ページで共通利用）
export default function ReportView({ report, template, companyName, renderPhoto }: Props) {
  const c = report.content ?? {}
  const shown = (s: ReportTemplate['hiddenSections'][number]) => !template.hiddenSections.includes(s)
  const clientName = report.site?.client?.name || report.site?.clientName
  return (
    <div className="space-y-4 text-sm">
      <div className="text-center">
        <h2 className="text-lg font-bold text-gray-800">{template.title}</h2>
        {companyName && <p className="text-xs text-gray-500">{companyName}</p>}
      </div>
      {template.headerNote && <p className="text-xs text-gray-600 whitespace-pre-wrap">{template.headerNote}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div><p className="text-xs text-gray-500">報告日</p><p>{format(new Date(report.reportDate), 'yyyy/M/d')}</p></div>
        <div><p className="text-xs text-gray-500">天候</p><p>{c.weather ?? '-'}</p></div>
        <div><p className="text-xs text-gray-500">現場</p><p className="font-medium">{report.site?.name}</p></div>
        <div><p className="text-xs text-gray-500">発注元</p><p>{clientName || '-'}</p></div>
        {report.guard && <div><p className="text-xs text-gray-500">担当隊員</p><p className="font-medium">{report.guard.name}</p></div>}
        {shown('workTime') && (c.workStart || c.workEnd) && (
          <div><p className="text-xs text-gray-500">実働</p><p>{c.workStart ?? '--:--'}〜{c.workEnd ?? '--:--'}（休憩{c.breakMinutes ?? 0}分）</p></div>
        )}
      </div>

      {shown('patrol') && !!c.patrolRecords?.length && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">巡回記録</p>
          <div className="space-y-1">
            {c.patrolRecords.map((rec, i) => (
              <div key={i} className="bg-gray-50 rounded px-3 py-2">
                <span className="text-gray-500 text-xs">{rec.time}</span>
                <span className="mx-2 text-gray-700">{rec.location}</span>
                {rec.result && <span className={`text-xs mr-2 ${rec.result === 'ABNORMAL' ? 'text-red-600 font-medium' : 'text-gray-400'}`}>{REPORT_PATROL_RESULT[rec.result]}</span>}
                {rec.note && <span className="text-gray-500 text-xs">— {rec.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {shown('incident') && (c.hasIncident || c.incidents) && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">異常・インシデント{c.hasIncident ? '（あり）' : ''}</p>
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-gray-700 whitespace-pre-wrap">{c.incidents || '-'}</div>
        </div>
      )}

      {shown('notes') && c.specialNotes && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">引継・連絡事項</p>
          <div className="bg-gray-50 rounded-lg p-3 text-gray-700 whitespace-pre-wrap">{c.specialNotes}</div>
        </div>
      )}

      {!!c.customFields?.length && (
        <div className="grid grid-cols-2 gap-3">
          {c.customFields.map(f => (
            <div key={f.key}>
              <p className="text-xs text-gray-500">{f.label}</p>
              <p className="whitespace-pre-wrap">{typeof f.value === 'boolean' ? (f.value ? '✓' : '—') : String(f.value)}</p>
            </div>
          ))}
        </div>
      )}

      {shown('photos') && !!report.photos?.length && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">現場写真（{report.photos.length}枚）</p>
          <div className="grid grid-cols-3 gap-2">
            {report.photos.map(p => (
              <figure key={p.id} className="break-inside-avoid">
                {renderPhoto(p)}
                {p.caption && <figcaption className="text-xs text-gray-500 mt-0.5">{p.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </div>
      )}

      {report.signatureImage && (
        <div className="break-inside-avoid">
          <p className="text-xs font-medium text-gray-500 mb-1">現場監督サイン</p>
          <img src={report.signatureImage} alt="監督サイン" className="h-24 border rounded bg-white" />
          <p className="text-xs text-gray-500 mt-1">
            {report.signerName}{report.signerTitle ? `（${report.signerTitle}）` : ''}
            {report.signedAt && ` / ${format(new Date(report.signedAt), 'yyyy/M/d HH:mm')}`}
            {report.signedLat != null && report.signedLng != null && (
              <> / <a className="text-blue-600 underline print:no-underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${report.signedLat},${report.signedLng}`}>取得場所</a></>
            )}
          </p>
        </div>
      )}
      {report.approvedAt && (
        <p className="text-xs text-gray-500">発注元承認: {report.approvedBy}（{format(new Date(report.approvedAt), 'yyyy/M/d HH:mm')}）</p>
      )}
      {report.submittedAsProxy && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 break-inside-avoid">
          <p className="font-medium">{PROXY_SUBMISSION_LABEL}</p>
          <p>提出者: {report.submittedByName ?? '-'}{report.guard ? ` ／ 報告対象の隊員: ${report.guard.name}` : ''}</p>
          {report.submissionNote && <p className="whitespace-pre-wrap">備考: {report.submissionNote}</p>}
        </div>
      )}
      {template.footerNote && <p className="text-xs text-gray-600 whitespace-pre-wrap border-t border-gray-100 pt-2">{template.footerNote}</p>}
    </div>
  )
}
