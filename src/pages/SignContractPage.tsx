import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '../lib/api'

export default function SignContractPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [agreed, setAgreed] = useState(false)
  const [done, setDone] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['sign-contract', token],
    queryFn: () => api.get(`/e-contracts/sign/${token}`).then(r => r.data),
    retry: false,
  })

  const signMutation = useMutation({
    mutationFn: () => api.post(`/e-contracts/sign/${token}`),
    onSuccess: () => setDone(true),
  })

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center"><div className="w-8 h-8 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin mx-auto mb-2" /><p className="text-gray-500 text-sm">読み込み中...</p></div>
      </div>
    )
  }

  if (error || !data) {
    const errMsg = (error as any)?.response?.data?.error || '無効な署名リンクです'
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-2xl p-8 text-center max-w-sm w-full shadow">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-red-600 font-medium">{errMsg}</p>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-2xl p-8 text-center max-w-sm w-full shadow">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">署名が完了しました</h2>
          <p className="text-gray-500 text-sm">「{data.title}」への電子署名が記録されました。</p>
          <p className="text-xs text-gray-400 mt-2">このページを閉じて構いません。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto">
        {/* ヘッダー */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-[#e67e22] rounded-xl mb-3">
            <span className="text-white font-bold">GS</span>
          </div>
          <h1 className="text-lg font-bold text-gray-800">電子契約署名</h1>
          <p className="text-sm text-gray-500">GuardSync 電子契約システム</p>
        </div>

        <div className="bg-white rounded-2xl shadow p-6 space-y-4">
          <div>
            <p className="text-xs text-gray-500">署名者</p>
            <p className="font-semibold text-gray-800">{data.signerName} 様</p>
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-1">契約書タイトル</p>
            <p className="font-medium text-gray-800">{data.title}</p>
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-1">契約内容</p>
            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap max-h-64 overflow-y-auto border border-gray-200">
              {data.content}
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 w-4 h-4" />
              <span className="text-sm text-gray-700">
                上記の契約内容を確認し、同意します。この署名は電子署名として法的効力を持ちます。
              </span>
            </label>

            <button
              onClick={() => signMutation.mutate()}
              disabled={!agreed || signMutation.isPending}
              className="w-full btn-primary py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {signMutation.isPending ? '署名中...' : '署名する（確定）'}
            </button>

            {signMutation.isError && (
              <p className="text-red-600 text-sm text-center">{(signMutation.error as any)?.response?.data?.error || '署名に失敗しました'}</p>
            )}
          </div>

          <p className="text-xs text-gray-400 text-center">
            署名時のIPアドレス・ブラウザ情報が記録されます。<br />
            本署名はRFC 3161タイムスタンプにより時刻を証明します。
          </p>
        </div>
      </div>
    </div>
  )
}
