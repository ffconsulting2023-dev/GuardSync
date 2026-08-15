import React, { useEffect, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
// Vite が worker を配信できるよう URL として取り込む
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export interface PageInfo {
  num: number
  src: string // レンダリング済みページ画像(dataURL)
  width: number
  height: number
}

interface Props {
  url: string
  scale?: number
  /** 各ページ上に重ねるオーバーレイ（署名欄など）を返す */
  renderOverlay?: (page: number, size: { width: number; height: number }) => React.ReactNode
  onLoaded?: (pageCount: number) => void
}

/**
 * PDF を pdf.js で描画し、ページ画像として縦に並べる。
 * renderOverlay で各ページ上に絶対配置のUIを重ねられる。
 */
export default function PdfViewer({ url, scale = 1.3, renderOverlay, onLoaded }: Props) {
  const [pages, setPages] = useState<PageInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const pdf = await pdfjsLib.getDocument({ url }).promise
        const out: PageInfo[] = []
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return
          const page = await pdf.getPage(i)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          const ctx = canvas.getContext('2d')!
          await page.render({ canvas, canvasContext: ctx, viewport } as any).promise
          out.push({ num: i, src: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height })
        }
        if (!cancelled) { setPages(out); setLoading(false); onLoaded?.(out.length) }
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || 'PDFの表示に失敗しました'); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, scale])

  if (loading) return <div className="text-center py-8 text-gray-400 text-sm">PDFを読み込み中...</div>
  if (error) return <div className="text-center py-8 text-red-500 text-sm">{error}</div>

  return (
    <div className="space-y-4">
      {pages.map(p => (
        <div key={p.num} className="relative mx-auto shadow border border-gray-200" style={{ width: p.width, height: p.height }}>
          <img src={p.src} width={p.width} height={p.height} alt={`page ${p.num}`} draggable={false} className="select-none" />
          {renderOverlay && (
            <div className="absolute inset-0" style={{ width: p.width, height: p.height }}>
              {renderOverlay(p.num, { width: p.width, height: p.height })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
