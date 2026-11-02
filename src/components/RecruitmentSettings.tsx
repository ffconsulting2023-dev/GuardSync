import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { FEE_BASIS, withTax, type FeeBasis } from '../../shared/recruitment'

const apiError = (e: any, fallback: string) => e?.response?.data?.error || fallback
const yen = (n: number) => `${n.toLocaleString()}円`

interface Channel { id: string; name: string; sortOrder: number; isActive: boolean; _count: { guards: number } }
interface Agency { id: string; name: string; _count: { recruitedGuards: number } }
interface Rule {
  id: string; agencyId: string; effectiveFrom: string; effectiveTo: string | null; amountPerShift: number
  nightAmountPerShift: number | null; maxMonthsFromHire: number | null; basis: FeeBasis; notes: string | null
}
const EMPTY_RULE = { effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '', amountPerShift: '1000', nightAmountPerShift: '', maxMonthsFromHire: '', basis: 'SCHEDULE' as FeeBasis, notes: '' }

// 媒体マスタ（追加・名称変更・並び替え・使用停止）
function ChannelMaster({ channels, canEdit }: { channels: Channel[]; canEdit: boolean }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['recruitment-channels'] })
  const add = useMutation({ mutationFn: () => api.post('/recruitment-channels', { name }), onSuccess: () => { setName(''); refresh() } })
  const update = useMutation({ mutationFn: ({ id, data }: { id: string; data: object }) => api.put(`/recruitment-channels/${id}`, data), onSuccess: () => { setEditing(null); refresh() } })
  // 隣と並び順を入れ替える（並び順は 0..n に振り直して保存）
  const move = (i: number, dir: -1 | 1) => {
    const list = [...channels]
    const j = i + dir
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    list.forEach((c, k) => { if (c.sortOrder !== k) update.mutate({ id: c.id, data: { sortOrder: k } }) })
  }
  const error = add.error ?? update.error
  return (
    <div className="card space-y-3">
      <div>
        <h3 className="font-semibold text-gray-800">採用経路の媒体</h3>
        <p className="text-xs text-gray-500">隊員の「採用経路」に出す求人媒体です。使わなくなった媒体は削除せず「停止」にすると、登録済みの隊員の採用経路は残ったまま選択肢から外れます。</p>
      </div>
      <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
        {channels.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            {editing?.id === c.id ? (
              <>
                <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="form-input text-sm flex-1" maxLength={50} />
                <button type="button" onClick={() => update.mutate({ id: c.id, data: { name: editing.name } })} className="btn-primary text-xs">保存</button>
                <button type="button" onClick={() => setEditing(null)} className="text-xs text-gray-500">取消</button>
              </>
            ) : (
              <>
                <span className={`flex-1 ${c.isActive ? 'text-gray-800' : 'text-gray-400 line-through'}`}>{c.name}</span>
                <span className="text-xs text-gray-400">{c._count.guards}名</span>
                {canEdit && (
                  <>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-400 px-1 disabled:opacity-30" aria-label="上へ">▲</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === channels.length - 1} className="text-gray-400 px-1 disabled:opacity-30" aria-label="下へ">▼</button>
                    <button type="button" onClick={() => setEditing({ id: c.id, name: c.name })} className="text-xs text-blue-600">名称変更</button>
                    <button type="button" onClick={() => update.mutate({ id: c.id, data: { isActive: !c.isActive } })} className="text-xs text-gray-600">{c.isActive ? '停止' : '再開'}</button>
                  </>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex gap-2">
          <input value={name} onChange={e => setName(e.target.value)} className="form-input text-sm flex-1" placeholder="媒体名（例: バイトル、知人紹介）" maxLength={50} />
          <button type="button" onClick={() => add.mutate()} disabled={!name.trim() || add.isPending} className="btn-primary text-sm disabled:opacity-50">追加</button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{apiError(error, '保存に失敗しました')}</p>}
    </div>
  )
}

function RuleForm({ agencyId, rule, onDone }: { agencyId: string; rule?: Rule; onDone: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState(rule ? {
    effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo ?? '', amountPerShift: String(rule.amountPerShift),
    nightAmountPerShift: rule.nightAmountPerShift == null ? '' : String(rule.nightAmountPerShift),
    maxMonthsFromHire: rule.maxMonthsFromHire == null ? '' : String(rule.maxMonthsFromHire), basis: rule.basis, notes: rule.notes ?? '',
  } : EMPTY_RULE)
  const set = (patch: Partial<typeof f>) => setF(v => ({ ...v, ...patch }))
  const num = (v: string) => (v === '' ? null : Number(v))
  const save = useMutation({
    mutationFn: () => {
      const body = { agencyId, effectiveFrom: f.effectiveFrom, effectiveTo: f.effectiveTo || null, amountPerShift: Number(f.amountPerShift || 0), nightAmountPerShift: num(f.nightAmountPerShift), maxMonthsFromHire: num(f.maxMonthsFromHire), basis: f.basis, notes: f.notes || null }
      return rule ? api.put(`/recruitment/fee-rules/${rule.id}`, body) : api.post('/recruitment/fee-rules', body)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recruitment-fee-rules'] }); onDone() },
  })
  return (
    <div className="bg-gray-50 rounded-lg p-3 space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div><label className="form-label">適用開始日 *</label><input type="date" value={f.effectiveFrom} onChange={e => set({ effectiveFrom: e.target.value })} className="form-input text-sm" /></div>
        <div><label className="form-label">適用終了日</label><input type="date" value={f.effectiveTo} onChange={e => set({ effectiveTo: e.target.value })} className="form-input text-sm" /></div>
        <div><label className="form-label">1勤務あたり（税別）*</label><input type="number" min={0} value={f.amountPerShift} onChange={e => set({ amountPerShift: e.target.value })} className="form-input text-sm" /></div>
        <div><label className="form-label">夜勤1勤務（税別）</label><input type="number" min={0} value={f.nightAmountPerShift} onChange={e => set({ nightAmountPerShift: e.target.value })} className="form-input text-sm" placeholder="空欄=日勤と同じ" /></div>
        <div><label className="form-label">対象期間（入社から）</label>
          <div className="flex items-center gap-1"><input type="number" min={1} max={120} value={f.maxMonthsFromHire} onChange={e => set({ maxMonthsFromHire: e.target.value })} className="form-input text-sm" placeholder="空欄=期限なし" /><span className="text-xs text-gray-500">か月</span></div>
        </div>
        <div className="md:col-span-2"><label className="form-label">数える勤務</label>
          <select value={f.basis} onChange={e => set({ basis: e.target.value as FeeBasis })} className="form-input text-sm">
            {Object.entries(FEE_BASIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div><label className="form-label">メモ</label><input value={f.notes} onChange={e => set({ notes: e.target.value })} className="form-input text-sm" maxLength={300} /></div>
      </div>
      {save.isError && <p className="text-sm text-red-600">{apiError(save.error, '保存に失敗しました')}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => save.mutate()} disabled={!f.effectiveFrom || f.amountPerShift === '' || save.isPending} className="btn-primary text-sm disabled:opacity-50">保存</button>
        <button type="button" onClick={onDone} className="btn-secondary text-sm">キャンセル</button>
      </div>
    </div>
  )
}

// 人材紹介会社ごとの紹介料の単価ルール
function AgencyFees({ agencies, canEdit }: { agencies: Agency[]; canEdit: boolean }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<{ agencyId: string; rule?: Rule } | null>(null)
  const { data: rules = [] } = useQuery<Rule[]>({ queryKey: ['recruitment-fee-rules'], queryFn: () => api.get('/recruitment/fee-rules').then(r => r.data), enabled: canEdit })
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/recruitment/fee-rules/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['recruitment-fee-rules'] }) })
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="card space-y-3">
      <div>
        <h3 className="font-semibold text-gray-800">人材紹介会社と紹介料</h3>
        <p className="text-xs text-gray-500">取引先の種別を「人材紹介会社」にした会社が、隊員の採用経路の選択肢になります（<Link to="/clients" className="text-blue-600 underline">取引先</Link>で登録）。紹介料は、その会社経由で採用した隊員の勤務数 × 単価で計算し、「採用経路別 稼働実績」で集計できます。単価を改定するときは、新しい適用開始日のルールを追加してください。</p>
      </div>
      {agencies.length === 0 && <p className="text-sm text-gray-400">人材紹介会社の取引先がまだありません。</p>}
      {agencies.map(a => {
        const list = rules.filter(r => r.agencyId === a.id)
        return (
          <div key={a.id} className="border border-gray-100 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-medium text-gray-800">{a.name} <span className="text-xs text-gray-400 font-normal">紹介で採用 {a._count.recruitedGuards}名</span></p>
              {canEdit && <button type="button" onClick={() => setEditing({ agencyId: a.id })} className="text-xs text-blue-600">+ 単価ルール</button>}
            </div>
            {list.length === 0 && <p className="text-xs text-amber-700">単価ルールが未設定のため、紹介料は0円で集計されます。</p>}
            {list.map(r => {
              const current = r.effectiveFrom <= today && (!r.effectiveTo || r.effectiveTo >= today)
              return (
                <div key={r.id} className="text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                  {current && <span className="badge badge-success">適用中</span>}
                  <span className="text-gray-600">{r.effectiveFrom} 〜 {r.effectiveTo ?? ''}</span>
                  <span className="font-medium">1勤務 {yen(r.amountPerShift)}（税込 {yen(withTax(r.amountPerShift))}）</span>
                  {r.nightAmountPerShift != null && <span>夜勤 {yen(r.nightAmountPerShift)}</span>}
                  <span className="text-xs text-gray-500">{r.maxMonthsFromHire ? `入社から${r.maxMonthsFromHire}か月` : '期限なし'}・{FEE_BASIS[r.basis]}</span>
                  {r.notes && <span className="text-xs text-gray-400">{r.notes}</span>}
                  {canEdit && <button type="button" onClick={() => setEditing({ agencyId: a.id, rule: r })} className="text-xs text-blue-600">編集</button>}
                  {canEdit && <button type="button" onClick={() => window.confirm('この単価ルールを削除しますか？') && remove.mutate(r.id)} className="text-xs text-red-600">削除</button>}
                </div>
              )
            })}
            {editing?.agencyId === a.id && <RuleForm agencyId={a.id} rule={editing.rule} onDone={() => setEditing(null)} />}
          </div>
        )
      })}
    </div>
  )
}

export default function RecruitmentSettings({ canEdit }: { canEdit: boolean }) {
  const { data } = useQuery<{ channels: Channel[]; agencies: Agency[] }>({ queryKey: ['recruitment-channels'], queryFn: () => api.get('/recruitment-channels').then(r => r.data) })
  if (!data) return <div className="card text-center py-6 text-gray-400">読み込み中...</div>
  return (
    <div className="space-y-4">
      <ChannelMaster channels={data.channels} canEdit={canEdit} />
      <AgencyFees agencies={data.agencies} canEdit={canEdit} />
    </div>
  )
}
