import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

const CATEGORIES = [
  { value: 'RADIO', label: 'トランシーバー' },
  { value: 'LIGHT', label: '誘導灯・LED' },
  { value: 'SAFETY', label: 'ヘルメット・安全装備' },
  { value: 'SIGN', label: 'コーン・バリケード' },
  { value: 'UNIFORM', label: '制服・雨具' },
  { value: 'VEHICLE_EQUIP', label: '車載備品' },
  { value: 'OFFICE', label: '事務用品' },
  { value: 'SIGNAGE', label: 'サイネージ' },
  { value: 'OTHER', label: 'その他' },
]

const categoryLabel = (cat: string) => CATEGORIES.find(c => c.value === cat)?.label || cat

interface EquipmentForm {
  name: string; category: string; totalQuantity: number
  unitCost: string; manufacturer: string; modelNumber: string; notes: string
}

const EMPTY_FORM: EquipmentForm = {
  name: '', category: 'RADIO', totalQuantity: 1,
  unitCost: '', manufacturer: '', modelNumber: '', notes: '',
}

type TabType = 'list' | 'guards' | 'sites'

export default function EquipmentPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')

  const [activeTab, setActiveTab] = useState<TabType>('list')
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [form, setForm] = useState<EquipmentForm>(EMPTY_FORM)

  // 貸出フォーム
  const [assignEquipId, setAssignEquipId] = useState<string | null>(null)
  const [assignType, setAssignType] = useState<'GUARD' | 'SITE'>('GUARD')
  const [assignTargetId, setAssignTargetId] = useState('')
  const [assignQty, setAssignQty] = useState(1)
  const [assignNotes, setAssignNotes] = useState('')

  // データ取得
  const { data: equipment = [], isLoading } = useQuery({
    queryKey: ['equipment'],
    queryFn: () => api.get('/equipment').then(r => r.data),
  })

  const { data: guardHoldings = [] } = useQuery({
    queryKey: ['equipment-guard-holdings'],
    queryFn: () => api.get('/equipment/guard-holdings').then(r => r.data),
    enabled: activeTab === 'guards',
  })

  const { data: siteShortage = [] } = useQuery({
    queryKey: ['equipment-site-shortage'],
    queryFn: () => api.get('/equipment/site-shortage').then(r => r.data),
    enabled: activeTab === 'sites',
  })

  const { data: guards = [] } = useQuery({
    queryKey: ['guards-for-equip'],
    queryFn: () => api.get('/guards?isActive=true').then(r => r.data),
  })

  const { data: sites = [] } = useQuery({
    queryKey: ['sites-for-equip'],
    queryFn: () => api.get('/sites').then(r => r.data),
  })

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/equipment', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['equipment'] }); setShowForm(false); setForm(EMPTY_FORM) },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/equipment/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['equipment'] }); setShowForm(false); setEditTarget(null) },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/equipment/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['equipment'] }),
  })
  const assignMutation = useMutation({
    mutationFn: ({ eqId, data }: { eqId: string; data: any }) => api.post(`/equipment/${eqId}/assign`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['equipment'] })
      qc.invalidateQueries({ queryKey: ['equipment-guard-holdings'] })
      qc.invalidateQueries({ queryKey: ['equipment-site-shortage'] })
      setAssignEquipId(null); setAssignTargetId(''); setAssignQty(1); setAssignNotes('')
    },
  })
  const returnMutation = useMutation({
    mutationFn: (assignmentId: string) => api.post(`/equipment/assignments/${assignmentId}/return`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['equipment'] })
      qc.invalidateQueries({ queryKey: ['equipment-guard-holdings'] })
      qc.invalidateQueries({ queryKey: ['equipment-site-shortage'] })
    },
  })

  const openEdit = (eq: any) => {
    setEditTarget(eq)
    setForm({
      name: eq.name, category: eq.category, totalQuantity: eq.totalQuantity,
      unitCost: eq.unitCost?.toString() || '', manufacturer: eq.manufacturer || '',
      modelNumber: eq.modelNumber || '', notes: eq.notes || '',
    })
    setShowForm(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data = { ...form, totalQuantity: Number(form.totalQuantity), unitCost: form.unitCost ? Number(form.unitCost) : null }
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">備品管理</h1>
        {canEdit && (
          <button onClick={() => { setEditTarget(null); setForm(EMPTY_FORM); setShowForm(true) }}
            className="btn-primary text-sm">+ 備品登録</button>
        )}
      </div>

      {/* タブ */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
        {([
          { key: 'list' as TabType, label: '備品一覧・在庫' },
          { key: 'guards' as TabType, label: '隊員別 保有状況' },
          { key: 'sites' as TabType, label: '現場別 過不足' },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2 text-sm rounded-md transition-colors ${activeTab === tab.key ? 'bg-white shadow text-blue-700 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── タブ: 備品一覧 ── */}
      {activeTab === 'list' && (
        <div className="space-y-3">
          {isLoading ? <p className="text-gray-400">読み込み中...</p> : equipment.length === 0 ? (
            <p className="text-gray-400 text-center py-8">備品が登録されていません</p>
          ) : equipment.map((eq: any) => (
            <div key={eq.id} className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{categoryLabel(eq.category)}</span>
                    <h3 className="font-semibold text-gray-800">{eq.name}</h3>
                    {eq.modelNumber && <span className="text-xs text-gray-400">{eq.modelNumber}</span>}
                  </div>
                  {eq.manufacturer && <p className="text-xs text-gray-500">メーカー: {eq.manufacturer}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {canEdit && (
                    <>
                      <button onClick={() => setAssignEquipId(assignEquipId === eq.id ? null : eq.id)}
                        className="text-xs bg-green-50 text-green-700 px-3 py-1 rounded-lg hover:bg-green-100">
                        貸出・配備
                      </button>
                      <button onClick={() => openEdit(eq)} className="text-xs text-blue-600 hover:underline">編集</button>
                      <button onClick={() => { if (confirm(`${eq.name} を削除しますか？`)) deleteMutation.mutate(eq.id) }}
                        className="text-xs text-red-400 hover:text-red-600">削除</button>
                    </>
                  )}
                </div>
              </div>

              {/* 在庫バー */}
              <div className="mt-3 grid grid-cols-5 gap-2 text-center">
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-xs text-gray-500">保有数</p>
                  <p className="text-lg font-bold text-gray-800">{eq.stockSummary.total}</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-2">
                  <p className="text-xs text-blue-500">隊員貸出</p>
                  <p className="text-lg font-bold text-blue-700">{eq.stockSummary.lentToGuards}</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-2">
                  <p className="text-xs text-purple-500">現場配備</p>
                  <p className="text-lg font-bold text-purple-700">{eq.stockSummary.deployedToSites}</p>
                </div>
                <div className="bg-orange-50 rounded-lg p-2">
                  <p className="text-xs text-orange-500">使用中</p>
                  <p className="text-lg font-bold text-orange-700">{eq.stockSummary.inUse}</p>
                </div>
                <div className={`rounded-lg p-2 ${eq.stockSummary.available > 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                  <p className={`text-xs ${eq.stockSummary.available > 0 ? 'text-green-500' : 'text-red-500'}`}>在庫</p>
                  <p className={`text-lg font-bold ${eq.stockSummary.available > 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {eq.stockSummary.available}
                  </p>
                </div>
              </div>

              {/* 貸出フォーム */}
              {assignEquipId === eq.id && (
                <div className="mt-3 bg-gray-50 rounded-lg p-3 border">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
                    <div>
                      <label className="text-xs text-gray-500">種別</label>
                      <select value={assignType} onChange={e => setAssignType(e.target.value as 'GUARD' | 'SITE')} className="form-input text-sm">
                        <option value="GUARD">隊員に貸出</option>
                        <option value="SITE">現場に配備</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">{assignType === 'GUARD' ? '隊員' : '現場'}</label>
                      <select value={assignTargetId} onChange={e => setAssignTargetId(e.target.value)} className="form-input text-sm">
                        <option value="">選択...</option>
                        {assignType === 'GUARD'
                          ? guards.map((g: any) => <option key={g.id} value={g.id}>{g.name}（{g.employeeNumber}）</option>)
                          : sites.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)
                        }
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">数量</label>
                      <input type="number" min={1} value={assignQty} onChange={e => setAssignQty(Number(e.target.value))} className="form-input text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">備考</label>
                      <input type="text" value={assignNotes} onChange={e => setAssignNotes(e.target.value)}
                        className="form-input text-sm" placeholder="S/N等" />
                    </div>
                  </div>
                  <button disabled={!assignTargetId} onClick={() => assignMutation.mutate({
                    eqId: eq.id,
                    data: { assigneeType: assignType, guardId: assignType === 'GUARD' ? assignTargetId : undefined, siteId: assignType === 'SITE' ? assignTargetId : undefined, quantity: assignQty, notes: assignNotes || undefined }
                  })} className="btn-primary text-sm px-4 py-1 disabled:opacity-50">
                    {assignType === 'GUARD' ? '貸出実行' : '配備実行'}
                  </button>
                </div>
              )}

              {/* 貸出中一覧 */}
              {eq.assignments && eq.assignments.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-gray-500 mb-1">貸出・配備中</p>
                  <div className="space-y-1">
                    {eq.assignments.map((a: any) => (
                      <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5 text-sm">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${a.assigneeType === 'GUARD' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                            {a.assigneeType === 'GUARD' ? '隊員' : '現場'}
                          </span>
                          <span>{a.guard?.name || a.site?.name}</span>
                          <span className="text-gray-400">x{a.quantity}</span>
                          {a.notes && <span className="text-xs text-gray-400">({a.notes})</span>}
                        </div>
                        {canEdit && (
                          <button onClick={() => returnMutation.mutate(a.id)}
                            className="text-xs text-orange-600 hover:underline">返却</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── タブ: 隊員別保有状況 ── */}
      {activeTab === 'guards' && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">社員番号</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">隊員名</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">保有備品</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {guardHoldings.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">隊員に貸出中の備品はありません</td></tr>
              ) : guardHoldings.map((g: any) => (
                <tr key={g.guardId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500">{g.employeeNumber}</td>
                  <td className="px-4 py-3 font-medium">{g.guardName}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {g.holdings.map((h: any) => (
                        <span key={h.assignmentId} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full">
                          {h.equipmentName} x{h.quantity}
                          {h.notes && <span className="text-blue-400">({h.notes})</span>}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit && g.holdings.map((h: any) => (
                      <button key={h.assignmentId} onClick={() => returnMutation.mutate(h.assignmentId)}
                        className="text-xs text-orange-600 hover:underline ml-2">
                        {h.equipmentName}返却
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── タブ: 現場別過不足 ── */}
      {activeTab === 'sites' && (
        <div className="space-y-3">
          {siteShortage.length === 0 ? (
            <p className="text-gray-400 text-center py-8">データがありません</p>
          ) : siteShortage.map((site: any) => (
            <div key={site.siteId} className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-800">{site.siteName}</h3>
                <span className="text-xs text-gray-400">必要隊員数: {site.requiredGuards}名</span>
              </div>
              {site.items.length === 0 ? (
                <p className="text-xs text-gray-400">この現場に配備済み備品はありません</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b">
                      <th className="text-left py-1">備品名</th>
                      <th className="text-center py-1">配備数</th>
                      <th className="text-center py-1">必要数</th>
                      <th className="text-center py-1">過不足</th>
                    </tr>
                  </thead>
                  <tbody>
                    {site.items.map((item: any) => (
                      <tr key={item.equipmentId} className="border-b last:border-0">
                        <td className="py-1.5">
                          <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded mr-1">{categoryLabel(item.category)}</span>
                          {item.equipmentName}
                        </td>
                        <td className="text-center py-1.5">{item.deployed}</td>
                        <td className="text-center py-1.5">
                          {item.trackShortage ? item.needed : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="text-center py-1.5">
                          {!item.trackShortage ? (
                            <span className="text-gray-400 text-xs">追跡対象外</span>
                          ) : item.shortage > 0 ? (
                            <span className="text-red-600 font-bold">-{item.shortage}</span>
                          ) : item.deployed > 0 ? (
                            <span className="text-green-600">OK</span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 備品登録・編集モーダル ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-4">{editTarget ? '備品編集' : '備品登録'}</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="form-label">備品名 *</label>
                <input type="text" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="form-input" placeholder="例: トランシーバー IC-4310" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">カテゴリ *</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="form-input">
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">保有数 *</label>
                  <input type="number" min={0} required value={form.totalQuantity} onChange={e => setForm(f => ({ ...f, totalQuantity: Number(e.target.value) }))} className="form-input" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">メーカー</label>
                  <input type="text" value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))} className="form-input" placeholder="ICOM" />
                </div>
                <div>
                  <label className="form-label">型番</label>
                  <input type="text" value={form.modelNumber} onChange={e => setForm(f => ({ ...f, modelNumber: e.target.value }))} className="form-input" placeholder="IC-4310" />
                </div>
              </div>
              <div>
                <label className="form-label">単価（円）</label>
                <input type="number" min={0} value={form.unitCost} onChange={e => setForm(f => ({ ...f, unitCost: e.target.value }))} className="form-input" placeholder="15000" />
              </div>
              <div>
                <label className="form-label">備考</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="form-input" rows={2} />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditTarget(null) }} className="btn-secondary flex-1">キャンセル</button>
                <button type="submit" className="btn-primary flex-1">{editTarget ? '更新' : '登録'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
