import { PHOTO_MAX_DATAURL_LENGTH } from '../../shared/securityReport'

// 撮影写真を縮小してJPEGのdata URLにする（通信量とDB容量を抑える）
export async function resizeImageFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('画像を読み込めませんでした'))
      i.src = url
    })
    for (const [maxDim, quality] of [[1600, 0.8], [1280, 0.7], [960, 0.6], [720, 0.5]] as const) {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      if (dataUrl.length <= PHOTO_MAX_DATAURL_LENGTH) return dataUrl
    }
    throw new Error('画像サイズが大きすぎます')
  } finally {
    URL.revokeObjectURL(url)
  }
}

// 位置情報は任意。拒否・タイムアウト時は空で返す
// geolocation の timeout は許可後からしか数えないため、許可ダイアログ放置でも止まらないよう全体にも上限を設ける
export function getCurrentLocation(): Promise<{ lat?: number; lng?: number }> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({})
    setTimeout(() => resolve({}), 6000)
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({}),
      { timeout: 5000, maximumAge: 60000 },
    )
  })
}
