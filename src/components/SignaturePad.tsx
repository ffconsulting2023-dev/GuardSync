import React, { useEffect, useRef, useState } from 'react'
import { getCurrentLocation } from '../lib/image'

interface Props {
  onSubmit: (v: { signerName: string; signerTitle: string; signatureImage: string; lat?: number; lng?: number }) => void
  onCancel: () => void
  submitting?: boolean
  error?: string
}

// 現場監督がスマートフォンのタッチパネルで直接サインするための全画面パッド
export default function SignaturePad({ onSubmit, onCancel, submitting, error }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [signerTitle, setSignerTitle] = useState('')

  const setup = () => {
    const c = canvasRef.current
    if (!c) return
    const ratio = window.devicePixelRatio || 1
    const rect = c.getBoundingClientRect()
    c.width = rect.width * ratio
    c.height = rect.height * ratio
    const ctx = c.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
    setHasInk(false)
  }

  useEffect(() => {
    setup()
    // 画面回転でキャンバスが変形するため再初期化
    window.addEventListener('orientationchange', setup)
    return () => window.removeEventListener('orientationchange', setup)
  }, [])

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    canvasRef.current!.setPointerCapture(e.pointerId)
    drawing.current = true
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = pos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 0.01, y)
    ctx.stroke()
    setHasInk(true)
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }
  const up = () => { drawing.current = false }

  const submit = async () => {
    const c = canvasRef.current!
    // 透明背景のままだと閲覧環境で黒潰れするため白背景に合成して出力
    const out = document.createElement('canvas')
    out.width = c.width
    out.height = c.height
    const octx = out.getContext('2d')!
    octx.fillStyle = '#fff'
    octx.fillRect(0, 0, out.width, out.height)
    octx.drawImage(c, 0, 0)
    const loc = await getCurrentLocation()
    onSubmit({ signerName: signerName.trim(), signerTitle: signerTitle.trim(), signatureImage: out.toDataURL('image/png'), ...loc })
  }

  const canSubmit = hasInk && signerName.trim().length > 0 && !submitting

  return (
    <div className="fixed inset-0 z-[60] bg-white flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">現場監督 サイン</h3>
        <button type="button" onClick={onCancel} className="text-gray-400 text-lg" aria-label="閉じる">✕</button>
      </div>
      <div className="p-4 space-y-3 flex-1 overflow-y-auto">
        <p className="text-xs text-gray-500">この端末を現場監督にお渡しください。内容をご確認のうえ、下の枠内に指でご署名ください。</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="form-label">氏名 *</label>
            <input value={signerName} onChange={e => setSignerName(e.target.value)} className="form-input" placeholder="例: 山田 太郎" maxLength={50} />
          </div>
          <div>
            <label className="form-label">役職・会社名</label>
            <input value={signerTitle} onChange={e => setSignerTitle(e.target.value)} className="form-input" placeholder="例: 現場監督" maxLength={50} />
          </div>
        </div>
        <div className="relative border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
          <canvas
            ref={canvasRef}
            className="w-full h-56 block rounded-lg"
            style={{ touchAction: 'none' }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
          {!hasInk && <p className="absolute inset-0 flex items-center justify-center text-gray-300 pointer-events-none select-none">ここにサイン</p>}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 pb-4">
          <button type="button" onClick={setup} className="btn-secondary flex-1">書き直す</button>
          <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary flex-1 disabled:opacity-50">
            {submitting ? '送信中...' : 'サインを確定'}
          </button>
        </div>
      </div>
    </div>
  )
}
