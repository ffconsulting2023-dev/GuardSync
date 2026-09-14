import React from 'react'

export default function SuspendedPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">⏸</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">サービスが停止されています</h1>
        <p className="text-gray-500 mb-6">
          お客様のアカウントは現在ご利用停止中です。<br />
          お支払い状況をご確認の上、担当者までお問い合わせください。
        </p>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-left mb-6">
          <p className="text-sm text-red-700 font-medium mb-1">考えられる原因</p>
          <ul className="text-sm text-red-600 space-y-1 list-disc list-inside">
            <li>お支払いが確認できていない</li>
            <li>トライアル期間が終了した</li>
            <li>管理者によって停止された</li>
          </ul>
        </div>
        <a
          href="mailto:support@guardsync.jp"
          className="inline-block w-full bg-blue-600 text-white font-medium py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors"
        >
          サポートへ問い合わせる
        </a>
        <button
          onClick={() => { localStorage.removeItem('token'); window.location.href = '/login' }}
          className="mt-3 w-full text-sm text-gray-400 hover:text-gray-600"
        >
          ログアウト
        </button>
      </div>
    </div>
  )
}
