import React, { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const NAV_ITEMS = [
  { path: '/',            label: 'ダッシュボード', icon: '🏠' },
  { path: '/schedule',    label: '管制・配員',     icon: '📋' },
  { path: '/attendance',  label: '出退勤',         icon: '⏰' },
  { path: '/guards',      label: '隊員管理',       icon: '👷' },
  { path: '/sites',       label: '現場管理',       icon: '📍' },
  { path: '/contracts',   label: '契約管理',       icon: '📄' },
  { path: '/invoices',    label: '請求管理',       icon: '💴' },
  { path: '/daily-pay',   label: '日払い',         icon: '💵' },
  { path: '/e-contracts', label: '電子契約',       icon: '✍️' },
  { path: '/partners',    label: '協力会社',       icon: '🤝' },
  { path: '/reports',     label: '警備報告書',     icon: '📝' },
  { path: '/vehicles',      label: '車両管理',       icon: '🚗' },
  { path: '/auto-receipts',  label: '自動受付',       icon: '📨' },
  { path: '/notifications',  label: '通知管理',       icon: '🔔' },
  { path: '/settings',       label: '設定',           icon: '⚙️' },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <div className="flex h-screen bg-gray-50">
      {/* サイドバー（PC） */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-[#1e3a5f] text-white transform transition-transform duration-200
        md:relative md:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* ロゴ */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-[#2d5282]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#e67e22] rounded-lg flex items-center justify-center font-bold text-sm">GS</div>
            <span className="font-bold text-lg">GuardSync</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-white/60 hover:text-white">✕</button>
        </div>

        {/* 会社名 */}
        <div className="px-4 py-3 border-b border-[#2d5282]">
          <p className="text-xs text-white/60">会社</p>
          <p className="text-sm font-medium truncate">{user?.company?.name}</p>
          <span className="text-xs bg-[#e67e22] px-1.5 py-0.5 rounded">{user?.company?.plan}</span>
        </div>

        {/* ナビゲーション */}
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isActive ? 'bg-[#2d5282] text-white font-medium' : 'text-white/70 hover:bg-[#2d5282]/50 hover:text-white'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
          {user?.isSuperAdmin && (
            <NavLink
              to="/super-admin"
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors mt-2 border-t border-[#2d5282] ${
                  isActive ? 'bg-red-800 text-white font-medium' : 'text-red-300 hover:bg-red-900/30 hover:text-white'
                }`
              }
            >
              <span className="text-base">🔒</span>
              スーパー管理者
            </NavLink>
          )}
        </nav>

        {/* ユーザー情報 */}
        <div className="border-t border-[#2d5282] p-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#2d5282] rounded-full flex items-center justify-center text-sm font-medium">
              {user?.name?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
              <p className="text-xs text-white/60 truncate">{user?.role}</p>
            </div>
            <button onClick={logout} className="text-white/60 hover:text-white text-xs">
              ログアウト
            </button>
          </div>
        </div>
      </aside>

      {/* オーバーレイ（モバイル） */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* メインコンテンツ */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* トップバー */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-4 gap-4 shadow-sm">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden text-gray-500 hover:text-gray-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex-1" />
          <div className="text-sm text-gray-500">
            {new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
          </div>
        </header>

        {/* ページコンテンツ */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
