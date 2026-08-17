import { useAuth } from '../hooks/useAuth'

// アカウント（契約）停止中に表示する案内ページ。
// ルーティング: /suspended（App.tsx）。プラン停止・支払い未完了の会社向け。
export default function SuspendedPage() {
  const { logout } = useAuth()

  return (
    <div className="min-h-screen bg-[#1e3a5f] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* ロゴ */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[#e67e22] rounded-2xl mb-4">
            <span className="text-white text-2xl font-bold">GS</span>
          </div>
          <h1 className="text-white text-2xl font-bold">GuardSync</h1>
          <p className="text-white/60 text-sm mt-1">警備会社向け統合管理システム</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-xl text-center space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-amber-100 rounded-full">
            <span className="text-amber-600 text-2xl">⏸</span>
          </div>
          <h2 className="text-lg font-bold text-gray-800">サービスは現在ご利用いただけません</h2>
          <p className="text-sm text-gray-500 leading-relaxed">
            ご契約が停止されているため、機能をご利用いただけません。<br />
            ご利用の再開については、管理者またはサポート窓口までお問い合わせください。
          </p>
          <div className="pt-2">
            <button
              onClick={logout}
              className="w-full px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:opacity-90"
            >
              ログイン画面へ戻る
            </button>
          </div>
        </div>

        <p className="text-white/40 text-xs text-center mt-6">
          お問い合わせ: サポート窓口までご連絡ください。
        </p>
      </div>
    </div>
  )
}
