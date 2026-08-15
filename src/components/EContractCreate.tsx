import React, { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import PdfViewer from './PdfViewer'

interface Signer { email: string; name: string }
type FieldType = 'SIGNATURE' | 'SEAL' | 'DATE' | 'NAME'
type Tool = FieldType | 'COMPANY_SEAL'
interface Seal { id: string; name: string }
interface PlacedField {
  id: string
  signerEmail?: string // 署名者割当（会社印欄はなし）
  sealId?: string      // 会社印の自動押印欄
  type: FieldType
  page: number
  x: number; y: number; width: number; height: number // 正規化(0-1)
}

const SIGNER_COLORS = ['#2563eb', '#e67e22', '#16a34a', '#9333ea', '#dc2626']
const TYPE_LABELS: Record<FieldType, string> = { SIGNATURE: '署名', SEAL: '印影', DATE: '日付', NAME: '氏名' }
// 既定サイズ(px)。配置時にページpxで正規化する
const DEFAULT_SIZE: Record<FieldType, { w: number; h: number }> = {
  SIGNATURE: { w: 170, h: 55 }, SEAL: { w: 72, h: 72 }, DATE: { w: 120, h: 28 }, NAME: { w: 140, h: 28 },
}

export default function EContractCreate({ onClose, onCreated, initialTitle = '', contractId }: { onClose: () => void; onCreated: () => void; initialTitle?: string; contractId?: string }) {
  const [title, setTitle] = useState(initialTitle)
  const [expiresAt, setExpiresAt] = useState('')
  const [sequential, setSequential] = useState(false)
  const [signers, setSigners] = useState<Signer[]>([{ name: '', email: '' }])
  const [file, setFile] = useState<File | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string>('')
  const [uploaded, setUploaded] = useState<{ filename: string; hash: string; pageCount: number } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [fields, setFields] = useState<PlacedField[]>([])
  const [activeSigner, setActiveSigner] = useState(0)
  const [tool, setTool] = useState<Tool>('SIGNATURE')
  const [seals, setSeals] = useState<Seal[]>([])
  const [activeSealId, setActiveSealId] = useState('')
  const [sealName, setSealName] = useState('')
  const [sealUploading, setSealUploading] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const dragRef = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number; pw: number; ph: number } | null>(null)

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])

  const loadSeals = async () => {
    try { const { data } = await api.get('/seals'); setSeals(data) } catch { /* ignore */ }
  }
  useEffect(() => { loadSeals() }, [])

  async function uploadSeal(f: File) {
    if (f.type !== 'image/png' && f.type !== 'image/jpeg') { setError('印影はPNG/JPEG画像を選択してください'); return }
    setSealUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('name', sealName.trim() || '会社印')
      const { data } = await api.post('/seals', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setSeals(ss => [data, ...ss])
      setActiveSealId(data.id)
      setSealName('')
    } catch (e: any) {
      setError(e?.response?.data?.error || '印影の登録に失敗しました')
    } finally {
      setSealUploading(false)
    }
  }

  async function deleteSeal(id: string) {
    try { await api.delete(`/seals/${id}`); setSeals(ss => ss.filter(s => s.id !== id)); if (activeSealId === id) setActiveSealId('') } catch { /* ignore */ }
  }

  const signerColor = (email?: string) => {
    if (!email) return '#334155' // 会社印など署名者なしの欄
    const idx = signers.findIndex(s => s.email === email)
    return SIGNER_COLORS[idx % SIGNER_COLORS.length] || '#666'
  }

  async function handleFile(f: File) {
    if (f.type !== 'application/pdf') { setError('PDFファイルを選択してください'); return }
    setError('')
    setFile(f)
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    setPdfUrl(URL.createObjectURL(f))
    setFields([])
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const { data } = await api.post('/e-contracts/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setUploaded(data)
    } catch (e: any) {
      setError(e?.response?.data?.error || 'アップロードに失敗しました')
      setUploaded(null)
    } finally {
      setUploading(false)
    }
  }

  function placeField(page: number, size: { width: number; height: number }, clientX: number, clientY: number, target: HTMLElement) {
    const isCompanySeal = tool === 'COMPANY_SEAL'
    const fieldType: FieldType = isCompanySeal ? 'SEAL' : tool
    let signerEmail: string | undefined
    let sealId: string | undefined
    if (isCompanySeal) {
      if (!activeSealId) { setError('会社印を選択してください'); return }
      sealId = activeSealId
    } else {
      const signer = signers[activeSigner]
      if (!signer?.email) { setError('先に署名者のメールアドレスを入力してください'); return }
      signerEmail = signer.email
    }
    const rect = target.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const def = DEFAULT_SIZE[fieldType]
    const x = Math.max(0, Math.min(1 - def.w / size.width, (px - def.w / 2) / size.width))
    const y = Math.max(0, Math.min(1 - def.h / size.height, (py - def.h / 2) / size.height))
    setFields(fs => [...fs, {
      id: crypto.randomUUID(), signerEmail, sealId, type: fieldType, page,
      x, y, width: def.w / size.width, height: def.h / size.height,
    }])
  }

  function onFieldPointerDown(e: React.PointerEvent, f: PlacedField, size: { width: number; height: number }) {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { id: f.id, startX: e.clientX, startY: e.clientY, ox: f.x, oy: f.y, pw: size.width, ph: size.height }
  }
  function onFieldPointerMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    const dx = (e.clientX - d.startX) / d.pw
    const dy = (e.clientY - d.startY) / d.ph
    setFields(fs => fs.map(f => f.id === d.id ? { ...f, x: Math.max(0, Math.min(1 - f.width, d.ox + dx)), y: Math.max(0, Math.min(1 - f.height, d.oy + dy)) } : f))
  }
  function onFieldPointerUp() { dragRef.current = null }

  async function submit() {
    setError('')
    if (!title.trim()) { setError('タイトルを入力してください'); return }
    const validSigners = signers.filter(s => s.name.trim() && s.email.trim())
    if (!validSigners.length) { setError('署名者を1名以上入力してください'); return }
    if (!uploaded) { setError('契約書PDFをアップロードしてください'); return }
    const signersWithoutField = validSigners.filter(s => !fields.some(f => f.signerEmail === s.email && (f.type === 'SIGNATURE' || f.type === 'SEAL')))
    if (signersWithoutField.length) {
      setError(`署名/印影欄が未配置の署名者がいます: ${signersWithoutField.map(s => s.name).join(', ')}`)
      return
    }
    setSubmitting(true)
    try {
      await api.post('/e-contracts', {
        title, expiresAt: expiresAt || undefined, sequential, signers: validSigners, contractId,
        sourcePdfFilename: uploaded.filename, sourcePdfHash: uploaded.hash, pageCount: uploaded.pageCount,
        fields: fields.map(({ signerEmail, sealId, type, page, x, y, width, height }) => ({ signerEmail, sealId, type, page, x, y, width, height })),
      })
      onCreated()
    } catch (e: any) {
      setError(e?.response?.data?.error || '作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch justify-center p-0 md:p-4">
      <div className="bg-white w-full md:max-w-5xl md:rounded-2xl flex flex-col max-h-screen">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <h2 className="font-semibold text-gray-800">契約書作成・署名依頼</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 基本情報 */}
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="form-label">契約書タイトル *</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className="form-input" placeholder="警備業務委託契約書" />
            </div>
            <div>
              <label className="form-label">署名期限</label>
              <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="form-input" />
            </div>
          </div>

          {/* 署名者 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="form-label mb-0">署名者 *</label>
              <button type="button" onClick={() => setSigners(ss => [...ss, { name: '', email: '' }])} className="text-blue-600 text-xs">+ 追加</button>
            </div>
            <label className="flex items-center gap-2 mb-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={sequential} onChange={e => setSequential(e.target.checked)} className="w-4 h-4" />
              上から順番に署名を回す（前の署名者が完了すると次の署名者へ依頼メールを送付）
            </label>
            <div className="space-y-2">
              {signers.map((s, i) => (
                <div key={i} className="grid grid-cols-[16px_1fr_1fr_24px] gap-2 items-center">
                  <span className="w-3 h-3 rounded-full flex items-center justify-center text-[8px] text-white" style={{ background: SIGNER_COLORS[i % SIGNER_COLORS.length] }}>{sequential ? i + 1 : ''}</span>
                  <input value={s.name} placeholder="氏名" onChange={e => setSigners(ss => ss.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="form-input" />
                  <input type="email" value={s.email} placeholder="メールアドレス" onChange={e => setSigners(ss => ss.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} className="form-input" />
                  {signers.length > 1 && <button onClick={() => setSigners(ss => ss.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500">✕</button>}
                </div>
              ))}
            </div>
          </div>

          {/* PDFアップロード */}
          <div>
            <label className="form-label">契約書PDF *</label>
            {!pdfUrl ? (
              <label className="block border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400">
                <input type="file" accept="application/pdf" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
                <span className="text-sm text-gray-500">クリックしてPDFを選択</span>
              </label>
            ) : (
              <div className="text-xs text-gray-500 flex items-center gap-2">
                <span>{file?.name}</span>
                {uploading && <span className="text-blue-500">アップロード中...</span>}
                {uploaded && <span className="text-green-600">✓ {uploaded.pageCount}ページ</span>}
                <label className="text-blue-600 cursor-pointer">変更<input type="file" accept="application/pdf" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} /></label>
              </div>
            )}
          </div>

          {/* 署名欄配置 */}
          {pdfUrl && (
            <div>
              <div className="sticky top-0 z-10 bg-white/95 backdrop-blur py-2 border-y border-gray-100 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-500">署名者:</span>
                  {signers.map((s, i) => (
                    <button key={i} onClick={() => { setActiveSigner(i); if (tool === 'COMPANY_SEAL') setTool('SIGNATURE') }} className={`text-xs px-2 py-1 rounded-full border ${activeSigner === i && tool !== 'COMPANY_SEAL' ? 'text-white' : 'text-gray-700'}`}
                      style={{ background: activeSigner === i && tool !== 'COMPANY_SEAL' ? SIGNER_COLORS[i % SIGNER_COLORS.length] : '#fff', borderColor: SIGNER_COLORS[i % SIGNER_COLORS.length] }}>
                      {s.name || `署名者${i + 1}`}
                    </button>
                  ))}
                  <span className="text-xs text-gray-300">|</span>
                  {(['SIGNATURE', 'SEAL', 'DATE', 'NAME'] as FieldType[]).map(t => (
                    <button key={t} onClick={() => setTool(t)} className={`text-xs px-2 py-1 rounded border ${tool === t ? 'bg-gray-800 text-white border-gray-800' : 'text-gray-600 border-gray-300'}`}>{TYPE_LABELS[t]}</button>
                  ))}
                  <button onClick={() => setTool('COMPANY_SEAL')} className={`text-xs px-2 py-1 rounded border ${tool === 'COMPANY_SEAL' ? 'bg-slate-700 text-white border-slate-700' : 'text-slate-600 border-slate-300'}`}>会社印(自動)</button>
                  <span className="text-xs text-gray-400 ml-auto">PDF上をクリックで配置・ドラッグで移動</span>
                </div>

                {/* 会社印の選択・登録 */}
                {tool === 'COMPANY_SEAL' && (
                  <div className="flex flex-wrap items-center gap-2 bg-slate-50 rounded p-2">
                    <span className="text-xs text-slate-600">押印する会社印:</span>
                    {seals.length === 0 && <span className="text-xs text-gray-400">未登録</span>}
                    {seals.map(s => (
                      <span key={s.id} className={`text-xs px-2 py-1 rounded-full border flex items-center gap-1 ${activeSealId === s.id ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-700 border-slate-300'}`}>
                        <button onClick={() => setActiveSealId(s.id)}>{s.name}</button>
                        <button onClick={() => deleteSeal(s.id)} className="opacity-60 hover:opacity-100">✕</button>
                      </span>
                    ))}
                    <span className="text-xs text-gray-300">|</span>
                    <input value={sealName} onChange={e => setSealName(e.target.value)} placeholder="印影名" className="form-input !py-1 !text-xs w-24" />
                    <label className="text-xs text-blue-600 cursor-pointer">
                      {sealUploading ? '登録中...' : '+ 画像登録(PNG/JPEG)'}
                      <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => e.target.files?.[0] && uploadSeal(e.target.files[0])} />
                    </label>
                  </div>
                )}
              </div>

              <div className="bg-gray-100 p-3 rounded-lg overflow-auto max-h-[50vh]">
                <PdfViewer
                  url={pdfUrl}
                  renderOverlay={(page, size) => (
                    <div
                      className="absolute inset-0 cursor-crosshair"
                      onClick={e => placeField(page, size, e.clientX, e.clientY, e.currentTarget)}
                    >
                      {fields.filter(f => f.page === page).map(f => (
                        <div
                          key={f.id}
                          onPointerDown={e => onFieldPointerDown(e, f, size)}
                          onPointerMove={onFieldPointerMove}
                          onPointerUp={onFieldPointerUp}
                          className="absolute rounded flex items-center justify-center text-[10px] font-medium cursor-move group"
                          style={{
                            left: f.x * size.width, top: f.y * size.height, width: f.width * size.width, height: f.height * size.height,
                            border: `2px solid ${signerColor(f.signerEmail)}`, background: `${signerColor(f.signerEmail)}22`, color: signerColor(f.signerEmail),
                          }}
                        >
                          {f.sealId ? '会社印' : TYPE_LABELS[f.type]}
                          <button onClick={e => { e.stopPropagation(); setFields(fs => fs.filter(x => x.id !== f.id)) }}
                            className="absolute -top-2 -right-2 bg-white border border-gray-300 rounded-full w-4 h-4 text-[9px] leading-none text-gray-500 hidden group-hover:flex items-center justify-center">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                />
              </div>
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary flex-1">キャンセル</button>
          <button onClick={submit} disabled={submitting || uploading} className="btn-primary flex-1 disabled:opacity-50">
            {submitting ? '送信中...' : '作成して署名依頼を送信'}
          </button>
        </div>
      </div>
    </div>
  )
}
