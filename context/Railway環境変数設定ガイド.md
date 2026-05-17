# Railway 環境変数設定ガイド

GuardSync を Railway にデプロイするために必要な環境変数の一覧と設定方法。

---

## 設定手順

1. [Railway Dashboard](https://railway.app) → プロジェクト → Service → Variables タブ
2. 下記の変数を追加する

---

## 必須環境変数

| 変数名 | 説明 | 例 |
|--------|------|----|
| `DATABASE_URL` | PostgreSQL接続URL（Railway自動生成） | `postgresql://...` |
| `JWT_SECRET` | JWTトークン署名キー（ランダム32文字以上） | `openssl rand -hex 32` で生成 |
| `APP_URL` | アプリのURL（HTTPS） | `https://guardsync.up.railway.app` |
| `NODE_ENV` | 環境区分 | `production` |
| `PORT` | サーバーポート（Railway自動設定） | `3000` |

---

## メール送信（SendGrid SMTP）

| 変数名 | 説明 | 例 |
|--------|------|----|
| `SMTP_HOST` | SMTPホスト | `smtp.sendgrid.net` |
| `SMTP_PORT` | SMTPポート | `587` |
| `SMTP_USER` | SMTPユーザー | `apikey` |
| `SMTP_PASS` | SendGrid APIキー | `SG.xxxx...` |
| `SMTP_FROM` | 送信元メールアドレス | `noreply@your-domain.jp` |

### SendGrid Inbound Parse 設定
FAX・メール自動受付を使う場合：
1. SendGrid → Settings → Inbound Parse → Add Host & URL
2. Hostname: `mail.your-domain.jp`（MXレコードをSendGridに向ける）
3. URL: `https://guardsync.up.railway.app/api/inbound/email`

---

## LINE Works Bot API v2

| 変数名 | 説明 | 取得場所 |
|--------|------|---------|
| `LINE_WORKS_CLIENT_ID` | クライアントID | LINE Works Developer Console → App |
| `LINE_WORKS_CLIENT_SECRET` | クライアントシークレット | 同上 |

### LINE Works 設定手順
1. [LINE Works Developer Console](https://developers.worksmobile.com/) にログイン
2. App 作成 → Service Account認証 → OAuth2 Client Credentials を使用
3. Bot 作成 → Bot ID をメモ
4. Channel 作成 → Channel ID をメモ
5. Railway に上記の CLIENT_ID / CLIENT_SECRET を設定
6. GuardSync 設定画面 → LINE Works タブ → Bot ID / Channel ID を入力 → 保存
7. 「テストメッセージ送信」で接続確認

---

## Railway CLI によるデプロイ手順

```bash
# Railway CLI インストール
npm install -g @railway/cli

# ログイン
railway login

# プロジェクトにリンク
railway link [PROJECT_ID]

# データベース初期化（初回のみ）
railway run npx prisma db push
railway run npx tsx prisma/seed.ts

# デプロイ（GitHub連携済みの場合は自動デプロイ）
git push origin main
```

---

## 初期ログイン情報（seed データ）

| ロール | メールアドレス | パスワード |
|--------|--------------|-----------|
| スーパー管理者 | admin@guardsync.jp | GuardSync2026! |
| デモ会社管理者 | demo@demo-security.co.jp | demo1234 |

> **注意**: 本番環境では必ずパスワードを変更してください。

---

## Webhook URL 一覧

| 用途 | URL | 設定場所 |
|------|-----|---------|
| LINE Works受信 | `POST /api/webhook/line-works` | LINE Works Developer Console → Bot → Callback URL |
| メール受信 | `POST /api/inbound/email` | SendGrid Inbound Parse |
| FAX受信 | `POST /api/inbound/fax` | FAXサービス（eFax等）のWebhook設定 |

---

## トラブルシューティング

### DB接続エラー
- `DATABASE_URL` が正しく設定されているか確認
- `railway run npx prisma db push` でスキーマを同期

### LINE Works接続失敗
- 設定画面で接続テストを実行
- `LINE_WORKS_CLIENT_ID` / `LINE_WORKS_CLIENT_SECRET` を確認
- LINE Works Developer Console で Service Account が有効か確認

### メール送信失敗
- SendGrid APIキーの権限（Mail Send が有効）を確認
- `SMTP_FROM` のドメインが SendGrid で認証済みか確認
