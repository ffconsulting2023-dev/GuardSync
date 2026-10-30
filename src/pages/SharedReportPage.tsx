import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import ReportView from '../components/report/ReportView'
import { DEFAULT_REPORT_TEMPLATE } from '../../shared/securityReport'

const API_URL = import.meta.env.VITE_API_URL || ''

// 協力会社向けの閲覧専用ページ（ログイン不要・期限付きリンク）
export default function SharedReportPage() {
  const { token } = useParams<{ token: string }>()
  const [report, setReport] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API_URL}/api/public/report-shares/${encodeURIComponent(token ?? '')}`)
      .then(async r => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error || '報告書を表示できません')
        setReport(body)
      })
      .catch(e => setError(e.message))
  }, [token])

  if (error) return <div className="min-h-screen flex items-center justify-center p-6 text-center text-gray-600">{error}</div>
  if (!report) return <div className="min-h-screen flex items-center justify-center text-gray-400">読み込み中...</div>

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className="report-print max-w-2xl mx-auto bg-white rounded-xl shadow-sm p-6">
        <div className="flex justify-between items-center mb-4 print:hidden">
          <p className="text-xs text-gray-400">閲覧期限: {new Date(report.expiresAt).toLocaleDateString('ja-JP')}</p>
          <button onClick={() => window.print()} className="text-sm text-blue-600">🖨 印刷/PDF</button>
        </div>
        <ReportView
          report={report}
          template={report.template ?? DEFAULT_REPORT_TEMPLATE}
          companyName={report.company?.name}
          renderPhoto={p => (
            <img
              src={`${API_URL}/api/public/report-shares/${encodeURIComponent(token ?? '')}/photos/${p.id}`}
              alt={p.caption || '現場写真'}
              className="w-full aspect-square object-cover rounded border"
              loading="lazy"
            />
          )}
        />
      </div>
    </div>
  )
}
