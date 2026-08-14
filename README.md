# GuardSync

警備会社向け統合管理システム。

- **フロントエンド**: React 18 + Vite + TypeScript + Tailwind CSS（PWA対応）
- **バックエンド**: Express + TypeScript
- **DB**: PostgreSQL（Prisma ORM）

---

## ローカルでの起動手順

### 前提ソフトウェア

- **Node.js 20 以上**（`node -v` で確認）
- **Docker** / **Docker Compose**（ローカル PostgreSQL 用）
  - Docker を使わない場合は、別途 PostgreSQL を用意し `.env` の `DATABASE_URL` を書き換えてください。

### かんたんセットアップ（推奨）

```bash
# 1. 環境変数ファイルを用意
cp .env.example .env

# 2. 依存インストール → DB起動 → スキーマ反映 → 初期データ投入 を一括実行
npm run setup

# 3. 開発サーバ起動（APIサーバ:3001 と Vite:5173 が同時に立ち上がる）
npm run dev
```

起動後、ブラウザで **http://localhost:5173** を開きます。

### 手動セットアップ（各ステップを個別に実行する場合）

```bash
cp .env.example .env        # 環境変数
npm install                 # 依存インストール（postinstall で prisma generate も実行）
npm run db:up               # PostgreSQL を Docker で起動（docker compose up -d）
npm run db:push            # Prisma スキーマを DB に反映
npm run db:seed            # 初期データ（管理者・デモ会社）を投入
npm run dev                # 開発サーバ起動
```

### ログイン情報（seed 実行後）

| 種別 | メールアドレス | パスワード |
| --- | --- | --- |
| スーパー管理者 | `admin@guardsync.jp` | `GuardSync2026!` |
| デモ会社ユーザー | `demo@demo-security.co.jp` | `demo1234` |

---

## 仕組み（ローカル構成）

- 開発時は **2 プロセス** が動きます。
  - `dev:client`（Vite）: `http://localhost:5173` で配信。`/api` へのリクエストを `http://localhost:3001` にプロキシします（`vite.config.ts`）。
  - `dev:server`（Express）: `http://localhost:3001` で API を提供します。`.env` の `PORT=3001` に合わせてあります。
- フロントの API ベース URL は `VITE_API_URL`（dev では空 → Vite プロキシ経由 `/api`）で切り替わります。
- 本番（`npm run build && npm start`）では Express が 1 プロセスでビルド済みフロント（`dist/public`）と API の両方を配信します。

---

## 主なスクリプト

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | API サーバ（3001）と Vite（5173）を同時起動 |
| `npm run setup` | インストール〜DB起動〜スキーマ反映〜seed まで一括 |
| `npm run db:up` / `npm run db:down` | ローカル PostgreSQL の起動 / 停止 |
| `npm run db:push` | Prisma スキーマを DB に反映（マイグレーション不要な開発向け） |
| `npm run db:seed` | 初期データ投入 |
| `npm run db:studio` | Prisma Studio（DB 閲覧 GUI）を起動 |
| `npm run build` | 本番ビルド（サーバ TS コンパイル + フロントビルド + 難読化） |
| `npm start` | ビルド済みアプリを起動 |

---

## 環境変数

`.env.example` を参照してください。ローカル起動に最低限必要なのは以下です。

- `DATABASE_URL` — PostgreSQL 接続文字列（既定は docker-compose の DB に対応）
- `JWT_SECRET` — 32 文字以上の署名鍵（本番は `openssl rand -hex 32` で生成した値に変更）
- `PORT` — API サーバのポート（dev は `3001`）
- `NODE_ENV` — `development` / `production`

LINE Works・SMTP・Stripe・Google Maps などの連携は任意で、未設定でもローカル起動できます。

---

## トラブルシューティング

- **`JWT_SECRET が未設定または短すぎます`** … `.env` の `JWT_SECRET` を 32 文字以上に設定してください。
- **API に接続できない / 画面が真っ白** … API サーバが `3001` で起動しているか確認してください（`PORT=3001`）。
- **DB 接続エラー** … `npm run db:up` で PostgreSQL が起動しているか、`DATABASE_URL` が正しいか確認してください。
- **Docker が使えない環境** … 任意の PostgreSQL を用意し、`.env` の `DATABASE_URL` を書き換えたうえで `npm run db:push && npm run db:seed` を実行してください。
