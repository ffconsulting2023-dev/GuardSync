import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { format } from 'date-fns'
import {
  SUBSCRIPTION_STATUS, PLAN_TYPE, BILLING_LOG_TYPE,
} from '../lib/constants'

// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────
interface BillingCompany {
  id: string; name: string; code: string; plan: string; planType: string
  subscriptionStatus: string; billingEmail: string | null
  trialEndsAt: string | null; suspendedAt: string | null; lastPaymentAt: string | null
  stripeCustomerId: string | null; isActive: boolean; createdAt: string
  billingLogs: BillingLog[]
  _count: { users: number; guards: number }
}
interface BillingLog {
  id: string; type: string; amount: number; description: string | null; occurredAt: string
}

// ─────────────────────────────────────────────
// Payment Link送付モーダル
// ─────────────────────────────────────────────
function PaymentLinkModal({ company, onClose }: { company: BillingCompany; onClose: () => void }) {
  const qc = useQueryClient()
  const [email, setEmail] = useState(company.billingEmail || '')
  const [planType, setPlanType] = useState(company.planType || 'STARTER')
  const [result, setResult] = useState<{ paymentLinkUrl: string; message: string } | null>(null)

  const sendMut = useMutation({
    mutationFn: () => api.post(`/super-admin/companies/${company.id}/send-payment-link`, { email, planType }),
    onSuccess: (res) => {
      setResult(res.data)
      qc.invalidateQueries({ queryKey: ['super-admin-billing'] })
    },
  })

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800">Payment Link送付</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          <span className="font-medium">{company.name}</span> 向けにStripe Payment Linkを生成してメール送付します。
        </p>

        {!result ? (
          <div className="space-y-4">
            <div>
              <label className="form-label">送付先メールアドレス *</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="form-input" placeholder="billing@example.com" />
            </div>
            <div>
              <label className="form-label">課金プラン</label>
              <select value={planType} onChange={e => setPlanType(e.target.value)} className="form-input">
                {Object.entries(PLAN_TYPE).map(([k, v]) => (
                  <option key={k} value={k}>{v.label} - {v.price}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={onClose} className="btn-secondary flex-1">キャンセル</button>
              <button
                onClick={() => sendMut.mutate()}
                disabled={!email || sendMut.isPending}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                {sendMut.isPending ? '送付中...' : 'Payment Link送付'}
              </button>
            </div>
            {sendMut.isError && (
              <p className="text-sm text-red-600">{(sendMut.error as any)?.response?.data?.error || '送付に失敗しました'}</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-green-800 font-medium text-sm">送付完了</p>
              <p className="text-green-600 text-xs mt-1">{email} にメールを送付しました</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Payment Link URL（コピー用）</p>
              <div className="flex gap-2">
                <input readOnly value={result.paymentLinkUrl}
                  className="form-input text-xs flex-1 bg-gray-50" />
                <button onClick={() => navigator.clipboard.writeText(result.paymentLinkUrl)}
                  className="btn-secondary text-xs px-3">コピー</button>
              </div>
            </div>
            <button onClick={onClose} className="btn-primary w-full">閉じる</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// プラン変更モーダル
// ─────────────────────────────────────────────
function PlanModal({ company, onClose }: { company: BillingCompany; onClose: () => void }) {
  const qc = useQueryClient()
  const [planType, setPlanType] = useState(company.planType || 'STARTER')
  const [plan, setPlan] = useState(company.plan || 'MIN')
  const [trialEndsAt, setTrialEndsAt] = useState(
    company.trialEndsAt ? company.trialEndsAt.split('T')[0] : ''
  )
  const [billingEmail, setBillingEmail] = useState(company.billingEmail || '')

  const updateMut = useMutation({
    mutationFn: () => api.patch(`/super-admin/companies/${company.id}/plan`, {
      planType, plan, trialEndsAt: trialEndsAt || undefined, billingEmail: billingEmail || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['super-admin-billing'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800">プラン設定</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <p className="text-sm text-gray-600 mb-4 font-medium">{company.name}</p>
        <div className="space-y-3">
          <div>
            <label className="form-label">課金プラン</label>
            <select value={planType} onChange={e => setPlanType(e.target.value)} className="form-input">
              {Object.entries(PLAN_TYPE).map(([k, v]) => (
                <option key={k} value={k}>{v.label} - {v.price}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">機能プラン（MIN/MAX）</label>
            <select value={plan} onChange={e => setPlan(e.target.value)} className="form-input">
              <option value="MIN">MIN</option>
              <option value="MAX">MAX</option>
            </select>
          </div>
          <div>
            <label className="form-label">トライアル終了日</label>
            <input type="date" value={trialEndsAt} onChange={e => setTrialEndsAt(e.target.value)}
              className="form-input" />
          </div>
          <div>
            <label className="form-label">請求先メールアドレス</label>
            <input type="email" value={billingEmail} onChange={e => setBillingEmail(e.target.value)}
              className="form-input" />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="btn-secondary flex-1">キャンセル</button>
            <button onClick={() => updateMut.mutate()} disabled={updateMut.isPending}
              className="btn-primary flex-1 disabled:opacity-50">
              {updateMut.isPending ? '更新中...' : '更新'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 停止確認モーダル
// ─────────────────────────────────────────────
function SuspendModal({ company, onClose }: { company: BillingCompany; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const suspendMut = useMutation({
    mutationFn: () => api.post(`/super-admin/companies/${company.id}/suspend`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['super-admin-billing'] }); onClose() },
  })
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h3 className="text-lg font-bold text-red-700 mb-2">利用停止</h3>
        <p className="text-sm text-gray-600 mb-4">
          <span className="font-medium">{company.name}</span> のサービスを停止しますか？<br />
          停止後、テナントのAPIアクセスが全て拒否されます。
        </p>
        <input type="text" value={reason} onChange={e => setReason(e.target.value)}
          placeholder="停止理由（任意）" className="form-input mb-4" />
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">キャンセル</button>
          <button onClick={() => suspendMut.mutate()} disabled={suspendMut.isPending}
            className="flex-1 bg-red-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-red-700 disabled:opacity-50">
            {suspendMut.isPending ? '停止中...' : '停止する'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 請求管理タブ
// ─────────────────────────────────────────────
function BillingTab() {
  const qc = useQueryClient()
  const [paymentModal, setPaymentModal] = useState<BillingCompany | null>(null)
  const [planModal, setPlanModal] = useState<BillingCompany | null>(null)
  const [suspendModal, setSuspendModal] = useState<BillingCompany | null>(null)
  const [expandedLog, setExpandedLog] = useState<string | null>(null)

  const { data: companies = [], isLoading } = useQuery<BillingCompany[]>({
    queryKey: ['super-admin-billing'],
    queryFn: () => api.get('/super-admin/billing').then(r => r.data),
    refetchInterval: 60000,
  })

  const reactivateMut = useMutation({
    mutationFn: (id: string) => api.post(`/super-admin/companies/${id}/reactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super-admin-billing'] }),
  })

  const statusCounts = companies.reduce((acc, c) => {
    acc[c.subscriptionStatus] = (acc[c.subscriptionStatus] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-4">
      {/* ステータスサマリ */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(SUBSCRIPTION_STATUS).map(([key, def]) => (
          <div key={key} className="card text-center py-3">
            <p className="text-2xl font-bold text-gray-800">{statusCounts[key] || 0}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full ${def.className}`}>{def.label}</span>
          </div>
        ))}
      </div>

      {/* 会社一覧テーブル */}
      <div className="card overflow-x-auto p-0">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">請求管理一覧</h2>
          <span className="text-xs text-gray-400">{companies.length}社</span>
        </div>
        {isLoading ? (
          <div className="text-center py-8 text-gray-400">読み込み中...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">会社名</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">ステータス</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">課金プラン</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">最終支払日</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">請求先</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {companies.map((c) => {
                const status = SUBSCRIPTION_STATUS[c.subscriptionStatus]
                return (
                  <React.Fragment key={c.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800">{c.name}</p>
                        <p className="text-xs text-gray-400 font-mono">{c.code}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${status?.className}`}>
                          {status?.label || c.subscriptionStatus}
                        </span>
                        {c.trialEndsAt && c.subscriptionStatus === 'TRIAL' && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            {format(new Date(c.trialEndsAt), 'M/d')}まで
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center hidden md:table-cell">
                        <p className="text-xs font-medium">{PLAN_TYPE[c.planType]?.label || c.planType}</p>
                        <p className="text-xs text-gray-400">{PLAN_TYPE[c.planType]?.price}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 hidden lg:table-cell">
                        {c.lastPaymentAt ? format(new Date(c.lastPaymentAt), 'yyyy/M/d') : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 hidden lg:table-cell">
                        {c.billingEmail || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 justify-center">
                          <button onClick={() => setPaymentModal(c)}
                            className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200">
                            決済Link
                          </button>
                          <button onClick={() => setPlanModal(c)}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
                            プラン
                          </button>
                          {c.subscriptionStatus !== 'SUSPENDED' ? (
                            <button onClick={() => setSuspendModal(c)}
                              className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200">
                              停止
                            </button>
                          ) : (
                            <button onClick={() => reactivateMut.mutate(c.id)}
                              disabled={reactivateMut.isPending}
                              className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50">
                              再開
                            </button>
                          )}
                          <button onClick={() => setExpandedLog(expandedLog === c.id ? null : c.id)}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded hover:bg-gray-200">
                            ログ {expandedLog === c.id ? '▲' : '▼'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedLog === c.id && (
                      <tr>
                        <td colSpan={6} className="px-6 py-3 bg-gray-50">
                          <p className="text-xs font-medium text-gray-600 mb-2">直近の請求ログ</p>
                          {c.billingLogs.length === 0 ? (
                            <p className="text-xs text-gray-400">ログがありません</p>
                          ) : (
                            <div className="space-y-1">
                              {c.billingLogs.map(log => (
                                <div key={log.id} className="flex items-center gap-3 text-xs">
                                  <span className="text-gray-400 w-32 shrink-0">
                                    {format(new Date(log.occurredAt), 'M/d HH:mm')}
                                  </span>
                                  <span className="text-gray-600">{BILLING_LOG_TYPE[log.type] || log.type}</span>
                                  {log.amount > 0 && (
                                    <span className="text-green-600 font-medium">¥{log.amount.toLocaleString()}</span>
                                  )}
                                  {log.description && (
                                    <span className="text-gray-400 truncate">{log.description}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {paymentModal && <PaymentLinkModal company={paymentModal} onClose={() => setPaymentModal(null)} />}
      {planModal && <PlanModal company={planModal} onClose={() => setPlanModal(null)} />}
      {suspendModal && <SuspendModal company={suspendModal} onClose={() => setSuspendModal(null)} />}
    </div>
  )
}

// ─────────────────────────────────────────────
// 会社管理タブ（既存のコンテンツ）
// ─────────────────────────────────────────────
function CompaniesTab() {
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteResult, setInviteResult] = useState<any>(null)

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['super-admin-companies'],
    queryFn: () => api.get('/super-admin/companies').then(r => r.data),
  })

  const inviteMutation = useMutation({
    mutationFn: (email: string) => api.post('/super-admin/invite', { email }),
    onSuccess: (res) => { setInviteResult(res.data); setInviteEmail('') },
  })

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="font-semibold text-gray-800 mb-3">新規会社招待</h2>
        <div className="flex gap-2">
          <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
            placeholder="会社管理者のメールアドレス" className="form-input flex-1" />
          <button onClick={() => inviteMutation.mutate(inviteEmail)}
            disabled={!inviteEmail || inviteMutation.isPending}
            className="btn-primary disabled:opacity-50 whitespace-nowrap">
            招待送信
          </button>
        </div>
        {inviteResult && (
          <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
            <p className="text-green-800 font-medium">招待リンク生成完了</p>
            <p className="text-green-600 mt-1 break-all">{window.location.origin}{inviteResult.registrationUrl}</p>
            <p className="text-xs text-green-500 mt-1">このURLを新規会社の担当者に送付してください（7日間有効）</p>
          </div>
        )}
      </div>
      <div className="card overflow-x-auto p-0">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">登録会社一覧</h2>
        </div>
        {isLoading ? (
          <div className="text-center py-8 text-gray-400">読み込み中...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">会社名</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">コード</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">プラン</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">ユーザー</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">隊員</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">登録日</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">状態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {companies.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{c.code}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`badge ${c.plan === 'MAX' ? 'badge-success' : 'badge-info'}`}>{c.plan}</span>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600 hidden md:table-cell">{c._count.users}</td>
                  <td className="px-4 py-3 text-center text-gray-600 hidden md:table-cell">{c._count.guards}</td>
                  <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">{format(new Date(c.createdAt), 'yyyy/M/d')}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`badge ${c.isActive ? 'badge-success' : 'badge-danger'}`}>{c.isActive ? '有効' : '停止'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// メインページ
// ─────────────────────────────────────────────
export default function SuperAdminPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'dashboard' | 'billing' | 'companies'>('dashboard')

  if (!user?.isSuperAdmin) {
    return <div className="p-8 text-center text-red-600 font-medium">アクセス権限がありません</div>
  }

  const { data: stats } = useQuery({
    queryKey: ['super-admin-stats'],
    queryFn: () => api.get('/super-admin/stats').then(r => r.data),
    refetchInterval: 30000,
  })

  const tabs = [
    { key: 'dashboard', label: 'ダッシュボード', icon: '📊' },
    { key: 'billing',   label: '請求管理',       icon: '💳' },
    { key: 'companies', label: '会社管理',       icon: '🏢' },
  ] as const

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-xl">🔒</span>
        <h1 className="text-xl font-bold text-gray-800">スーパー管理者ダッシュボード</h1>
      </div>

      {/* タブナビゲーション */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ダッシュボードタブ */}
      {activeTab === 'dashboard' && (
        <div className="space-y-4">
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: '会社数', value: stats.companies, icon: '🏢' },
                { label: 'ユーザー数', value: stats.users, icon: '👤' },
                { label: '隊員総数', value: stats.guards, icon: '👷' },
                { label: 'シフト総数', value: stats.schedules, icon: '📋' },
              ].map(({ label, value, icon }) => (
                <div key={label} className="card text-center py-3">
                  <p className="text-3xl mb-1">{icon}</p>
                  <p className="text-2xl font-bold text-gray-800">{value}</p>
                  <p className="text-xs text-gray-500">{label}</p>
                </div>
              ))}
            </div>
          )}
          <div className="card">
            <p className="text-sm text-gray-600">
              請求管理・会社ごとのサービス停止/再開は「請求管理」タブから操作できます。
            </p>
          </div>
        </div>
      )}

      {activeTab === 'billing' && <BillingTab />}
      {activeTab === 'companies' && <CompaniesTab />}
    </div>
  )
}
