import React, { useState, useCallback, useMemo } from 'react'
import { GoogleMap, LoadScript, Marker, InfoWindow } from '@react-google-maps/api'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

// ── 型定義 ──
interface SiteLocation {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  requiredCount: number
  assignedCount: number
  assignedGuards: AssignedGuard[]
}

interface GuardLocation {
  id: string
  name: string
  guardClass: string
  rating: number
  lat: number
  lng: number
  assigned: boolean
  assignedSiteId?: string
  assignedSiteName?: string
}

interface AssignedGuard {
  guardId: string
  guardName: string
  guardClass: string
  rating: number
  distance: number
  score: number
  reason?: string
}

interface UnassignedGuard {
  guardId: string
  guardName: string
  reason: string
}

interface MapData {
  sites: SiteLocation[]
  guards: GuardLocation[]
}

interface OptimizeResult {
  sites: Array<{
    siteId: string
    siteName: string
    requiredCount: number
    assignedGuards: AssignedGuard[]
  }>
  unassigned: UnassignedGuard[]
  stats: {
    totalSites: number
    totalGuards: number
    assignedCount: number
    unfilledSites: number
  }
}

type OptimizeMode = 'distance' | 'skill' | 'balanced'

// ── 定数 ──
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
const mapContainerStyle = { width: '100%', height: '100%' }
const defaultCenter = { lat: 35.6812, lng: 139.7671 }

// マーカー色URL (Google Charts API)
const pinUrl = (color: string) =>
  `https://chart.googleapis.com/chart?chst=d_map_pin_letter&chld=%E2%80%A2|${color}`

export default function DispatchMapPage() {
  const queryClient = useQueryClient()
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date()
    return d.toISOString().slice(0, 10)
  })
  const [optimizeMode, setOptimizeMode] = useState<OptimizeMode>('balanced')
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null)
  const [selectedMarker, setSelectedMarker] = useState<{ type: 'site' | 'guard'; id: string } | null>(null)
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set())

  // ── データ取得 ──
  const { data: mapData, isLoading: mapLoading } = useQuery<MapData>({
    queryKey: ['dispatch-map', selectedDate],
    queryFn: () => api.get(`/dispatch/map-data/${selectedDate}`).then(r => r.data),
  })

  // ── 最適化実行 ──
  const optimizeMutation = useMutation({
    mutationFn: () =>
      api.post('/dispatch/optimize', { date: selectedDate, mode: optimizeMode }).then(r => r.data),
    onSuccess: (data: OptimizeResult) => {
      setOptimizeResult(data)
    },
  })

  // ── スケジュール登録 ──
  const applyMutation = useMutation({
    mutationFn: () =>
      api.post('/dispatch/optimize/apply', { date: selectedDate, result: optimizeResult }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dispatch-map', selectedDate] })
      alert('スケジュールを登録しました')
    },
  })

  // ── 折り畳みトグル ──
  const toggleSite = useCallback((siteId: string) => {
    setExpandedSites(prev => {
      const next = new Set(prev)
      if (next.has(siteId)) next.delete(siteId)
      else next.add(siteId)
      return next
    })
  }, [])

  // ── 統計 ──
  const stats = useMemo(() => {
    if (optimizeResult?.stats) return optimizeResult.stats
    if (!mapData) return { totalSites: 0, totalGuards: 0, assignedCount: 0, unfilledSites: 0 }
    const totalSites = mapData.sites.length
    const totalGuards = mapData.guards.length
    const assignedCount = mapData.guards.filter(g => g.assigned).length
    const unfilledSites = mapData.sites.filter(s => s.assignedCount < s.requiredCount).length
    return { totalSites, totalGuards, assignedCount, unfilledSites }
  }, [mapData, optimizeResult])

  // ── マップ中心 ──
  const mapCenter = useMemo(() => {
    if (!mapData?.sites.length) return defaultCenter
    const lats = mapData.sites.map(s => s.lat)
    const lngs = mapData.sites.map(s => s.lng)
    return {
      lat: lats.reduce((a, b) => a + b, 0) / lats.length,
      lng: lngs.reduce((a, b) => a + b, 0) / lngs.length,
    }
  }, [mapData])

  // ── InfoWindow の内容 ──
  const renderInfoWindow = () => {
    if (!selectedMarker || !mapData) return null

    if (selectedMarker.type === 'site') {
      const site = mapData.sites.find(s => s.id === selectedMarker.id)
      if (!site) return null
      const isFull = site.assignedCount >= site.requiredCount
      return (
        <InfoWindow
          position={{ lat: site.lat, lng: site.lng }}
          onCloseClick={() => setSelectedMarker(null)}
        >
          <div className="p-1 min-w-[180px]">
            <p className="font-bold text-sm">{site.name}</p>
            <p className="text-xs text-gray-500 mt-1">{site.address}</p>
            <p className={`text-xs mt-1 font-medium ${isFull ? 'text-green-600' : 'text-red-600'}`}>
              配置: {site.assignedCount} / {site.requiredCount}名
            </p>
          </div>
        </InfoWindow>
      )
    }

    const guard = mapData.guards.find(g => g.id === selectedMarker.id)
    if (!guard) return null
    return (
      <InfoWindow
        position={{ lat: guard.lat, lng: guard.lng }}
        onCloseClick={() => setSelectedMarker(null)}
      >
        <div className="p-1 min-w-[160px]">
          <p className="font-bold text-sm">{guard.name}</p>
          <p className="text-xs text-gray-500 mt-1">
            クラス: {guard.guardClass} / 評価: {'★'.repeat(Math.round(guard.rating))}{guard.rating}
          </p>
          {guard.assignedSiteName && (
            <p className="text-xs text-blue-600 mt-1">担当: {guard.assignedSiteName}</p>
          )}
        </div>
      </InfoWindow>
    )
  }

  // ── 配置結果パネル ──
  const renderResultPanel = () => {
    if (!optimizeResult) {
      // 最適化前: mapData ベースの表示
      if (!mapData) return <p className="text-sm text-gray-400 p-4">日付を選択してデータを読み込んでください</p>
      return (
        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-500">最適化を実行すると配置結果が表示されます</p>
          {mapData.sites.map(site => {
            const isFull = site.assignedCount >= site.requiredCount
            return (
              <div key={site.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{site.name}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isFull ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {site.assignedCount}/{site.requiredCount}名
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )
    }

    return (
      <div className="p-4 space-y-3">
        {optimizeResult.sites.map(site => {
          const isExpanded = expandedSites.has(site.siteId)
          const isFull = site.assignedGuards.length >= site.requiredCount
          return (
            <div key={site.siteId} className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleSite(site.siteId)}
                className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{isExpanded ? '▼' : '▶'}</span>
                  <span className="font-medium text-sm">{site.siteName}</span>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isFull ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {site.assignedGuards.length}/{site.requiredCount}名
                </span>
              </button>
              {isExpanded && (
                <div className="border-t bg-gray-50 px-3 py-2 space-y-2">
                  {site.assignedGuards.map(g => (
                    <div key={g.guardId} className="flex items-start gap-2 text-sm">
                      <span className="text-green-500 mt-0.5">├</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-1">
                          <span className="font-medium">{g.guardName}</span>
                          <span className="text-xs bg-blue-100 text-blue-700 px-1 rounded">{g.guardClass}</span>
                          <span className="text-xs text-yellow-600">★{g.rating}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {g.distance.toFixed(1)}km / スコア{g.score}
                          {g.reason && <span className="ml-1 text-gray-400">({g.reason})</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                  {site.assignedGuards.length === 0 && (
                    <p className="text-xs text-gray-400">配置隊員なし</p>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* 未割当隊員 */}
        {optimizeResult.unassigned.length > 0 && (
          <div className="border-t pt-3 mt-3">
            <p className="text-xs font-bold text-gray-500 mb-2">── 未割当隊員 ──</p>
            {optimizeResult.unassigned.map(g => (
              <div key={g.guardId} className="flex items-center justify-between text-sm py-1">
                <span>{g.guardName}</span>
                <span className="text-xs text-red-500">({g.reason})</span>
              </div>
            ))}
          </div>
        )}

        {/* スケジュール登録ボタン */}
        <button
          onClick={() => applyMutation.mutate()}
          disabled={applyMutation.isPending}
          className="w-full mt-4 bg-[#1e3a5f] text-white py-2.5 rounded-lg text-sm font-medium hover:bg-[#2d5282] disabled:opacity-50 transition-colors"
        >
          {applyMutation.isPending ? '登録中...' : 'スケジュール登録'}
        </button>
      </div>
    )
  }

  // ── テーブルフォールバック（API キーなし時） ──
  const renderFallbackTable = () => {
    if (!mapData) return null
    return (
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-2">現場名</th>
              <th className="text-left p-2">住所</th>
              <th className="text-center p-2">必要人数</th>
              <th className="text-center p-2">配置済み</th>
              <th className="text-center p-2">状態</th>
            </tr>
          </thead>
          <tbody>
            {mapData.sites.map(site => (
              <tr key={site.id} className="border-t">
                <td className="p-2 font-medium">{site.name}</td>
                <td className="p-2 text-gray-500">{site.address}</td>
                <td className="p-2 text-center">{site.requiredCount}</td>
                <td className="p-2 text-center">{site.assignedCount}</td>
                <td className="p-2 text-center">
                  {site.assignedCount >= site.requiredCount ? (
                    <span className="text-green-600 text-xs font-medium">充足</span>
                  ) : (
                    <span className="text-red-600 text-xs font-medium">不足</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const hasApiKey = !!GOOGLE_MAPS_API_KEY

  return (
    <div className="h-full flex flex-col">
      {/* ヘッダー */}
      <div className="bg-white border-b px-4 py-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold text-gray-800">最適配置マップ</h1>
        <div className="flex-1" />
        <input
          type="date"
          value={selectedDate}
          onChange={e => {
            setSelectedDate(e.target.value)
            setOptimizeResult(null)
          }}
          className="border rounded-lg px-3 py-1.5 text-sm"
        />

        {/* 最適化モード */}
        <div className="flex items-center gap-2 text-sm">
          {([
            ['distance', '距離優先'],
            ['skill', 'スキル優先'],
            ['balanced', 'バランス'],
          ] as [OptimizeMode, string][]).map(([val, label]) => (
            <label key={val} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="optimize-mode"
                value={val}
                checked={optimizeMode === val}
                onChange={() => setOptimizeMode(val)}
                className="accent-[#1e3a5f]"
              />
              <span className={optimizeMode === val ? 'font-medium text-[#1e3a5f]' : 'text-gray-500'}>
                {label}
              </span>
            </label>
          ))}
        </div>

        <button
          onClick={() => optimizeMutation.mutate()}
          disabled={optimizeMutation.isPending || mapLoading}
          className="bg-[#e67e22] text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-[#d35400] disabled:opacity-50 transition-colors"
        >
          {optimizeMutation.isPending ? '計算中...' : '最適化実行'}
        </button>
      </div>

      {/* 統計バー */}
      <div className="bg-white border-b px-4 py-2 flex gap-4">
        {[
          { label: '現場数', value: stats.totalSites, color: 'text-blue-600' },
          { label: '隊員数', value: stats.totalGuards, color: 'text-green-600' },
          { label: '配置済み', value: stats.assignedCount, color: 'text-indigo-600' },
          { label: '未充足現場', value: stats.unfilledSites, color: stats.unfilledSites > 0 ? 'text-red-600' : 'text-gray-400' },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-1.5 text-sm">
            <span className="text-gray-500">{s.label}:</span>
            <span className={`font-bold ${s.color}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* エラー表示 */}
      {optimizeMutation.isError && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-600">
          最適化エラー: {(optimizeMutation.error as Error).message}
        </div>
      )}

      {/* メインエリア */}
      <div className="flex-1 flex overflow-hidden">
        {/* 地図エリア */}
        <div className="flex-1 relative">
          {!hasApiKey ? (
            <div className="h-full flex flex-col items-center justify-center bg-gray-100 p-8">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 max-w-md text-center">
                <p className="text-yellow-800 font-medium mb-2">Google Maps API キーが未設定です</p>
                <p className="text-sm text-yellow-700">
                  <code className="bg-yellow-100 px-1 py-0.5 rounded text-xs">VITE_GOOGLE_MAPS_API_KEY</code> を
                  <code className="bg-yellow-100 px-1 py-0.5 rounded text-xs">.env</code> に設定してください
                </p>
              </div>
              <div className="mt-6 w-full max-w-2xl">
                {renderFallbackTable()}
              </div>
            </div>
          ) : mapLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
            </div>
          ) : (
            <LoadScript googleMapsApiKey={GOOGLE_MAPS_API_KEY}>
              <GoogleMap
                mapContainerStyle={mapContainerStyle}
                center={mapCenter}
                zoom={12}
              >
                {/* 現場マーカー */}
                {mapData?.sites.map(site => {
                  const isShort = site.assignedCount < site.requiredCount
                  return (
                    <Marker
                      key={`site-${site.id}`}
                      position={{ lat: site.lat, lng: site.lng }}
                      icon={pinUrl(isShort ? 'FF0000' : '4A90D9')}
                      title={site.name}
                      onClick={() => setSelectedMarker({ type: 'site', id: site.id })}
                    />
                  )
                })}

                {/* 隊員マーカー */}
                {mapData?.guards.map(guard => (
                  <Marker
                    key={`guard-${guard.id}`}
                    position={{ lat: guard.lat, lng: guard.lng }}
                    icon={pinUrl(guard.assigned ? '4CAF50' : 'FF9800')}
                    title={guard.name}
                    onClick={() => setSelectedMarker({ type: 'guard', id: guard.id })}
                  />
                ))}

                {/* InfoWindow */}
                {renderInfoWindow()}
              </GoogleMap>
            </LoadScript>
          )}
        </div>

        {/* 右サイドパネル */}
        <div className="w-80 border-l bg-white flex flex-col overflow-hidden">
          <div className="border-b px-4 py-2.5">
            <h2 className="font-bold text-sm text-gray-700">配置結果パネル</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {renderResultPanel()}
          </div>
        </div>
      </div>
    </div>
  )
}
