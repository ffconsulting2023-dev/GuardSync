import React, { useEffect, useRef } from 'react'
import SignaturePad from 'signature_pad'

interface Props {
  title?: string
  onCancel: () => void
  onConfirm: (dataUrl: string) => void
}

/** 手書きサインをキャンバスで描画して PNG(dataURL) を返すモーダル */
export default function SignaturePadModal({ title = '署名を描いてください', onCancel, onConfirm }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<SignaturePad | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // 高解像度対応
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    canvas.getContext('2d')?.scale(ratio, ratio)
    const pad = new SignaturePad(canvas, { penColor: '#111827', minWidth: 1, maxWidth: 2.5 })
    padRef.current = pad
    return () => { pad.off() }
  }, [])

  const confirm = () => {
    const pad = padRef.current
    if (!pad || pad.isEmpty()) return
    onConfirm(pad.toDataURL('image/png'))
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-center">{title}</h3>
        <div className="border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
          <canvas ref={canvasRef} className="w-full touch-none" style={{ height: 200 }} />
        </div>
        <p className="text-xs text-gray-400 text-center">枠内に指またはマウスでサインしてください</p>
        <div className="flex gap-2">
          <button onClick={() => padRef.current?.clear()} className="btn-secondary flex-1 text-sm">消去</button>
          <button onClick={onCancel} className="btn-secondary flex-1 text-sm">キャンセル</button>
          <button onClick={confirm} className="btn-primary flex-1 text-sm">確定</button>
        </div>
      </div>
    </div>
  )
}
