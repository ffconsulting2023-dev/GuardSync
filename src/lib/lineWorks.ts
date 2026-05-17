/**
 * LINE Works Bot API v2 連携ライブラリ
 * サーバーサイドから呼び出す
 */

export interface LineWorksMessage {
  content: {
    type: 'text'
    text: string
  }
}

export interface LineWorksConfig {
  botId: string
  channelId: string
  accessToken: string
}

/**
 * LINE Works Bot APIでメッセージ送信
 * チャンネルに送信（グループへの一斉送信）
 */
export async function sendLineWorksMessage(config: LineWorksConfig, text: string): Promise<boolean> {
  const url = `https://www.worksapis.com/v1.0/bots/${config.botId}/channels/${config.channelId}/messages`

  const body: LineWorksMessage = {
    content: { type: 'text', text },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[LINE Works] メッセージ送信失敗:', err)
    return false
  }
  return true
}

/**
 * LINE Works OAuth 2.0 アクセストークン取得
 */
export async function getLineWorksToken(clientId: string, clientSecret: string): Promise<string | null> {
  const url = 'https://auth.worksmobile.com/oauth2/v2.0/token'
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'bot',
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[LINE Works] トークン取得失敗:', err)
    return null
  }

  const data = await res.json()
  return data.access_token
}
