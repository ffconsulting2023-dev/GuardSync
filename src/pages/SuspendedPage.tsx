import React from 'react'
import { clearToken } from '../lib/auth'

export default function SuspendedPage() {
  return (
    <div className="min-h-screen bg-[#1e3a5f] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-2xl mb-4">
          <span className="text-red-600 text-3xl">⚠️</span>
        </div>
        <h1 className="text-xl font-bold text-gray-800">アカウントが停止されています</h1>
        <p className="text-gray-600 text-sm mt-3 leading-relaxed">
          ご利用中のアカウントは現在停止されています。<br />
          お支払い状況をご確認のうえ、送付済みのお支払いリンクよりお手続きください。<br />
          ご不明な点はご担当者までお問い合わせください。
        </p>
        <button
          onClick={() => { clearToken(); window.location.href = '/login' }}
          className="mt-6 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm hover:bg-[#16304d]"
        >
          ログイン画面に戻る
        </button>
      </div>
    </div>
  )
}
