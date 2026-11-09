import React, { useEffect, useState } from 'react'
import { api } from '../lib/api'

// 認証ヘッダーが必要な画像を取得して表示する（<img src> では Bearer を付けられないため）
export default function AuthImage({ path, alt, className, onClick }: { path: string; alt: string; className?: string; onClick?: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let url: string | null = null
    let alive = true
    api.get(path, { responseType: 'blob' }).then(r => {
      if (!alive) return
      url = URL.createObjectURL(r.data)
      setSrc(url)
    }).catch(() => {})
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [path])
  if (!src) return <div className={`${className ?? ''} bg-gray-100 animate-pulse`} />
  return <img src={src} alt={alt} className={className} onClick={onClick} />
}
