import React, { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { ACCOUNT_ROLES, LOGIN_ID_RULE_TEXT, SETUP_LINK_TTL_DAYS, normalizeLoginId, type AccountRole } from '../../shared/account'

interface Account {
  id: string
  name: string
  loginId: string | null
  email: string | null
  role: AccountRole
  isActive: boolean
  canIssueAccounts: boolean
  mustSetPassword: boolean
  lastLoginAt: string | null
  guardId: string | null
  guard: { id: string; name: string; employeeNumber: string } | null
  pendingSetupExpiresAt: string | null
}
interface GuardOption { id: string; name: string; employeeNumber: string; email: string | null; linkedUserId: string | null }
interface AccountsResponse { company: { id: string; name: string }; actor: { isCompanyAdmin: boolean }; users: Account[]; guards: GuardOption[] }
interface SetupLink { url: string; expiresAt: string; emailSent: boolean; loginId: string | null; name: string }

const apiError = (e: any, fallback: string) => e?.response?.data?.error || fallback
const fmt = (d: string) => new Date(d).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function statusOf(a: Account) {
  if (!a.isActive) return { label: '無効', className: 'badge-danger' }
  if (a.mustSetPassword) return { label: 'PW未設定', className: 'badge-warning' }
  return { label: '利用中', className: 'badge-success' }
}

// ─── ログインIDの重複チェック（入力中に問い合わせ） ───
function useLoginIdAvailability(loginId: string, companyId: string | undefined, excludeUserId?: string, original?: string | null) {
  const [state, setState] = useState<{ checking: boolean; ok: boolean | null; message: string }>({ checking: false, ok: null, message: '' })
  useEffect(() => {
    const v = normalizeLoginId(loginId)
    if (!v || v === original) { setState({ checking: false, ok: v ? true : null, message: '' }); return }
    setState(s => ({ ...s, checking: true }))
    const t = setTimeout(() => {
      api.get('/accounts/login-id-availability', { params: { loginId: v, excludeUserId, companyId } })
        .then(r => setState({ checking: false, ok: r.data.valid && r.data.available, message: r.data.message }))
        .catch(() => setState({ checking: false, ok: null, message: '確認できませんでした' }))
    }, 400)
    return () => clearTimeout(t)
  }, [loginId, companyId, excludeUserId, original])
  return state
}

// ─── アカウント作成・編集 ───
function AccountForm({ data, companyId, account, onClose, onSaved }: {
  data: AccountsResponse; companyId?: string; account: Account | null
  onClose: () => void; onSaved: (a: Account, created: boolean) => void
}) {
  const [f, setF] = useState({
    name: account?.name ?? '',
    loginId: account?.loginId ?? '',
    email: account?.email ?? '',
    role: (account?.role ?? 'GUARD') as AccountRole,
    guardId: account?.guardId ?? '',
    canIssueAccounts: account?.canIssueAccounts ?? false,
    isActive: account?.isActive ?? true,
  })
  const avail = useLoginIdAvailability(f.loginId, companyId, account?.id, account?.loginId)
  const isAdmin = data.actor.isCompanyAdmin
  const set = (patch: Partial<typeof f>) => setF(v => ({ ...v, ...patch }))
  const guardChoices = data.guards.filter(g => !g.linkedUserId || g.linkedUserId === account?.id)
  const roleChoices = (Object.entries(ACCOUNT_ROLES) as [AccountRole, string][]).filter(([k]) => isAdmin || k !== 'ADMIN')

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        // 編集時に空欄にした場合は null を送ってメールアドレスを削除する
        name: f.name, loginId: f.loginId, email: account ? (f.email.trim() || null) : f.email,
        role: f.role, guardId: f.guardId || null,
        ...(isAdmin && f.role !== 'GUARD' ? { canIssueAccounts: f.role === 'ADMIN' ? false : f.canIssueAccounts } : {}),
        ...(account ? { isActive: f.isActive } : {}),
        companyId,
      }
      const r = account ? await api.patch(`/accounts/${account.id}`, body, { params: { companyId } }) : await api.post('/accounts', body, { params: { companyId } })
      return r.data as Account
    },
    onSuccess: a => onSaved(a, !account),
  })

  const pickGuard = (id: string) => {
    const g = data.guards.find(x => x.id === id)
    set({ guardId: id, ...(g && !f.name ? { name: g.name } : {}), ...(g?.email && !f.email ? { email: g.email } : {}) })
  }
  const canSave = !!f.name.trim() && !!f.loginId.trim() && avail.ok !== false && !avail.checking && (f.role !== 'GUARD' || !!f.guardId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">{account ? 'アカウント編集' : 'ログインID発行'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">✕</button>
        </div>
        <form onSubmit={e => { e.preventDefault(); if (canSave) save.mutate() }} className="p-6 space-y-4">
          <div>
            <label className="form-label">ロール *</label>
            <select value={f.role} onChange={e => set({ role: e.target.value as AccountRole })} className="form-input" disabled={account?.role === 'ADMIN' && !isAdmin}>
              {roleChoices.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {(
            <div>
              <label className="form-label">紐付ける隊員{f.role === 'GUARD' ? ' *' : '（任意・隊員を兼ねる班長など）'}</label>
              <select value={f.guardId} onChange={e => pickGuard(e.target.value)} className="form-input" required={f.role === 'GUARD'}>
                <option value="">{f.role === 'GUARD' ? '選択してください' : '紐付けない'}</option>
                {guardChoices.map(g => <option key={g.id} value={g.id}>{g.employeeNumber} {g.name}</option>)}
              </select>
              {guardChoices.length === 0 && <p className="text-xs text-amber-600 mt-1">アカウント未発行の在籍隊員がいません</p>}
            </div>
          )}
          <div>
            <label className="form-label">氏名 *</label>
            <input value={f.name} onChange={e => set({ name: e.target.value })} className="form-input" maxLength={50} required />
          </div>
          <div>
            <label className="form-label">ログインID *</label>
            <input value={f.loginId} onChange={e => set({ loginId: e.target.value })} className="form-input font-mono"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={32} placeholder="例: yamada01" required />
            <p className={`text-xs mt-1 ${avail.ok === false ? 'text-red-600' : avail.ok ? 'text-green-600' : 'text-gray-400'}`}>
              {avail.checking ? '重複を確認中...' : avail.message || LOGIN_ID_RULE_TEXT}
            </p>
          </div>
          <div>
            <label className="form-label">メールアドレス（任意）</label>
            <input type="email" value={f.email} onChange={e => set({ email: e.target.value })} className="form-input" placeholder="設定用URLをメールで送る場合に入力" />
          </div>
          {isAdmin && f.role !== 'GUARD' && f.role !== 'ADMIN' && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={f.canIssueAccounts} onChange={e => set({ canIssueAccounts: e.target.checked })} />
              ID発行権限を付与する（この会社のログインID発行・設定用URL発行ができます）
            </label>
          )}
          {account && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={f.isActive} onChange={e => set({ isActive: e.target.checked })} />
              有効（外すとログインできなくなり、未使用の設定用URLも無効になります）
            </label>
          )}
          {save.isError && <p className="text-sm text-red-600">{apiError(save.error, '保存に失敗しました')}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">キャンセル</button>
            <button type="submit" disabled={!canSave || save.isPending} className="btn-primary flex-1 disabled:opacity-50">{account ? '保存' : '発行'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// QRコードの下に氏名・ログインID・有効期限を入れた画像を作る（印刷して手渡しできるように）
async function buildQrCard(link: SetupLink, companyName: string): Promise<string> {
  const qr = await QRCode.toDataURL(link.url, { width: 480, margin: 2, errorCorrectionLevel: 'M' })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = qr })
  const canvas = document.createElement('canvas')
  canvas.width = 560
  canvas.height = 760
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#111827'
  ctx.textAlign = 'center'
  ctx.font = 'bold 26px sans-serif'
  ctx.fillText('GuardSync パスワード設定', 280, 50)
  ctx.drawImage(img, 40, 70, 480, 480)
  ctx.font = '22px sans-serif'
  ctx.fillText(companyName, 280, 590)
  ctx.font = 'bold 26px sans-serif'
  ctx.fillText(`${link.name} 様`, 280, 630)
  ctx.font = '22px monospace'
  ctx.fillText(`ログインID: ${link.loginId ?? ''}`, 280, 670)
  ctx.font = '18px sans-serif'
  ctx.fillStyle = '#6b7280'
  ctx.fillText(`有効期限: ${new Date(link.expiresAt).toLocaleString('ja-JP')}`, 280, 710)
  return canvas.toDataURL('image/png')
}

// ─── 認証用（パスワード設定）URLの発行：メール送信／URLコピー／QRコード ───
function SetupLinkPanel({ account, companyId, companyName, onClose, onIssued }: {
  account: Account; companyId?: string; companyName: string; onClose: () => void; onIssued: () => void
}) {
  const [link, setLink] = useState<SetupLink | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const issue = useMutation({
    mutationFn: (sendEmail: boolean) => api.post(`/accounts/${account.id}/setup-link`, { sendEmail, companyId }, { params: { companyId } }).then(r => r.data as SetupLink),
    onSuccess: async l => {
      setLink(l); setCopied(false); onIssued()
      setQr(await QRCode.toDataURL(l.url, { width: 240, margin: 1 }))
    },
  })
  const copy = async () => {
    if (!link) return
    try { await navigator.clipboard.writeText(link.url); setCopied(true) } catch { setCopied(false) }
  }
  const download = async () => {
    if (!link) return
    const a = document.createElement('a')
    a.href = await buildQrCard(link, companyName)
    a.download = `guardsync-setup-${link.loginId ?? account.id}.png`
    a.click()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">認証用URLの発行</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <p className="font-medium text-gray-800">{account.name}</p>
            <p className="text-gray-600">ログインID: <span className="font-mono">{account.loginId ?? '—'}</span></p>
            <p className="text-gray-500 text-xs">{account.email ?? 'メール未登録'}</p>
          </div>
          <p className="text-xs text-gray-500">本人がこのURLを開いてパスワードを設定します（{SETUP_LINK_TTL_DAYS}日間有効・1回限り）。発行し直すと以前のURL・QRコードは使えなくなります。</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => issue.mutate(true)} disabled={!account.email || issue.isPending} className="btn-secondary text-sm disabled:opacity-50" title={account.email ? '' : 'メールアドレスが未登録です'}>
              ✉️ メールで送信
            </button>
            <button type="button" onClick={() => issue.mutate(false)} disabled={issue.isPending} className="btn-primary text-sm disabled:opacity-50">
              🔗 URL・QRを発行
            </button>
          </div>
          {issue.isError && <p className="text-sm text-red-600">{apiError(issue.error, '発行に失敗しました')}</p>}
          {link && (
            <div className="space-y-3 border-t border-gray-100 pt-4">
              {link.emailSent && <p className="text-sm text-green-700">✉️ {account.email} に送信しました</p>}
              {!link.emailSent && issue.variables === true && <p className="text-sm text-amber-600">メールを送信できませんでした（メール設定を確認してください）。URLまたはQRコードで渡してください。</p>}
              <div>
                <label className="form-label">認証用URL</label>
                <div className="flex gap-2">
                  <input readOnly value={link.url} className="form-input text-xs flex-1" onFocus={e => e.target.select()} />
                  <button type="button" onClick={copy} className="btn-secondary text-sm whitespace-nowrap">{copied ? '✓ コピー済' : 'コピー'}</button>
                </div>
              </div>
              {qr && (
                <div className="text-center space-y-2">
                  <img src={qr} alt="認証用QRコード" className="mx-auto w-48 h-48" />
                  <button type="button" onClick={download} className="btn-secondary text-sm">⬇ QRコードをダウンロード</button>
                </div>
              )}
              <p className="text-xs text-gray-400 text-center">有効期限: {new Date(link.expiresAt).toLocaleString('ja-JP')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ログインID発行・認証用URL発行（会社の設定画面と、スーパー管理者の会社管理で共通利用）
export default function AccountManager({ companyId }: { companyId?: string }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [issuing, setIssuing] = useState<Account | null>(null)
  const [query, setQuery] = useState('')
  const key = ['accounts', companyId ?? 'self']
  const { data, isLoading, error } = useQuery<AccountsResponse>({
    queryKey: key,
    queryFn: () => api.get('/accounts', { params: { companyId } }).then(r => r.data),
  })
  const refresh = () => qc.invalidateQueries({ queryKey: key })

  if (isLoading) return <div className="text-center py-8 text-gray-400">読み込み中...</div>
  if (error || !data) return <div className="card text-sm text-red-600">{apiError(error, 'アカウントを取得できませんでした')}</div>

  const q = query.trim().toLowerCase()
  const users = data.users.filter(u => !q || [u.name, u.loginId, u.email, u.guard?.name].some(v => v?.toLowerCase().includes(q)))

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">ログインID発行・アカウント管理</h3>
            <p className="text-xs text-gray-500">{data.company.name}　発行後、認証用URL（メール・URLコピー・QRコード）を本人に渡してパスワードを設定してもらいます。</p>
          </div>
          <button onClick={() => setEditing('new')} className="btn-primary text-sm">+ ログインID発行</button>
        </div>
        <input value={query} onChange={e => setQuery(e.target.value)} className="form-input" placeholder="氏名・ログインID・メール・隊員名で検索" />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="border-b border-gray-100">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">氏名</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">ログインID</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">ロール</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">紐付け隊員</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">状態</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users.map(u => {
              const st = statusOf(u)
              return (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800">{u.name}{u.id === user?.id ? '（自分）' : ''}</p>
                    <p className="text-xs text-gray-400">{u.email ?? 'メール未登録'}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{u.loginId ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="badge badge-info">{ACCOUNT_ROLES[u.role] ?? u.role}</span>
                    {(u.role === 'ADMIN' || u.canIssueAccounts) && <span className="badge badge-success ml-1">ID発行</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 hidden md:table-cell">{u.guard ? `${u.guard.employeeNumber} ${u.guard.name}` : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${st.className}`}>{st.label}</span>
                    {u.pendingSetupExpiresAt && <p className="text-[11px] text-gray-400 mt-0.5">URL有効〜{fmt(u.pendingSetupExpiresAt)}</p>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {u.isActive && <button onClick={() => setIssuing(u)} className="text-blue-600 text-xs mr-3">認証URL</button>}
                    <button onClick={() => setEditing(u)} className="text-gray-600 text-xs">編集</button>
                  </td>
                </tr>
              )
            })}
            {users.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-400">アカウントがありません</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <AccountForm
          data={data}
          companyId={companyId}
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(a, created) => {
            setEditing(null)
            refresh()
            if (created) setIssuing(a) // 発行直後にそのまま認証用URLを渡せるようにする
          }}
        />
      )}
      {issuing && (
        <SetupLinkPanel account={issuing} companyId={companyId} companyName={data.company.name} onClose={() => setIssuing(null)} onIssued={refresh} />
      )}
    </div>
  )
}
