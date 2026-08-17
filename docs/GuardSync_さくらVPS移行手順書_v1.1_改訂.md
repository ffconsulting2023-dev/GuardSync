# GuardSync さくらVPS 構築・移行手順書 — v1.1 改訂（レビュー反映）

**改訂日**: 2026-08-17 ／ **対象**: v1.0（2026-08-18作成）へのレビュー指摘反映
**検証方法**: 実コードベース（`server.ts`／`package.json`／`prisma/schema.prisma`／`.env.example`／`vite.config.ts`／`src/`）との突き合わせ

このドキュメントは v1.0 手順書に対するレビュー結果と、**v1.0からの差し替え箇所**をまとめたものです。
併せて、リポジトリ側に移行用の設定ファイル一式と必要なコード修正を追加しています（末尾「リポジトリ変更一覧」）。

---

## 0. 深刻度サマリ

| # | 深刻度 | 指摘 | 対応 |
|---|---|---|---|
| C-1 | 🔴 Critical | アップロード保存先とマウント先の不一致でファイルが永続化されない | コード＋compose修正済み |
| C-2 | 🔴 Critical | 環境変数名3件が実装と不一致（APP_URL / SMTP_FROM / VITE_API_URL） | 手順書修正・.env.example反映 |
| C-3 | 🔴 Critical | フロントエンドがビルド不能（未コミットの必須ファイル欠落） | ソース復元済み |
| D-1 | 🔴 Critical | コミット済みPrismaマイグレーションがゼロ（`migrate deploy`が空振り） | 方針を明記・.gitignore修正 |
| H-1 | 🟠 High | Stripe価格ID env が手順書/.env.exampleから欠落 | .env.example反映 |
| H-2 | 🟠 High | `prisma`がdevDependenciesのまま×`--omit=dev` | package.json修正済み |
| H-3 | 🟠 High | PDF日本語フォントをdistへ含める仕組みが無い | ビルド手順追加 |
| D-2 | 🟠 High | helmet CSPにGoogle Maps未許可で地図が表示されない | server.ts修正済み |
| M-1 | 🟡 Medium | Dockerfileはroot実行なのに§6.6がuid1000前提 | 手順書修正 |
| M-2 | 🟡 Medium | Nginx `/webhook/` はマッチする実ルートなし | nginx設定修正 |
| M-3 | 🟡 Medium | SendGridのenv記載漏れ | .env.example反映 |
| L-1〜5 | 🔵 Low | ヘルスチェック浅め・LINE WORKS過剰記載 等 | 本書に注記 |

---

## 1. Critical 指摘と修正

### C-1. アップロードファイルが永続化されない（データ喪失）

- **実装**（`server.ts`）: `const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads', 'documents')`。
  `node dist/server.js` 実行時、`__dirname = /app/dist` のため既定の保存先は **`/app/dist/uploads/documents`**。
- **v1.0の誤り**: §5.3 compose が `/var/guardsync/uploads:/app/uploads` をマウント。保存先とマウント先が一致せず、
  アップロード文書はコンテナ層に書かれて**再デプロイで消失**する。

**修正（本改訂）**
- `UPLOAD_DIR` を環境変数化（コード対応済み）。
- `.env` に **`UPLOAD_DIR=/app/uploads/documents`** を追加。
- composeのマウントは `/var/guardsync/uploads:/app/uploads` のままで、保存先がその配下（`/app/uploads/documents`）になるよう合わせる。
- Dockerfileで `RUN mkdir -p /app/uploads/documents` を実施済み。

### C-2. 環境変数名が実装と不一致

`grep` で全 `process.env.*` / `import.meta.env.*` を確認した結果、v1.0の記載に誤りがありました。

| v1.0の記載 | 正しい名前（実装） | 使用箇所 |
|---|---|---|
| `APP_BASE_URL`（§5.1, §9） | **`APP_URL`** | CORS許可オリジン・メール内リンク |
| `MAIL_FROM`（§5.1） | **`SMTP_FROM`** | メール送信元 |
| `VITE_API_BASE_URL`（§9 CI） | **`VITE_API_URL`** | フロントのAPIベースURL（ビルド時埋込） |

→ §5.1 チェックリスト・§9 CI の環境変数を上記の正しい名前へ置換すること。
本改訂の `.env.example` と `.github/workflows/deploy.yml` は修正済み。

### C-3. フロントエンドがビルド不能（未コミットファイル欠落）

`npm run build`（＝§9 CI の中核）が **`vite build` で失敗**していました。原因は未コミットの必須ソース2点:

1. `src/pages/SuspendedPage.tsx`（`src/App.tsx` が `/suspended` ルートで import）
2. `src/lib/constants.ts`（`ContractsPage` / `GuardsPage` / `InvoicesPage` / `SchedulePage` が import）

→ **両ファイルを復元済み**（`constants.ts` のキーは `prisma/schema.prisma` の enum と一致させて再構成）。
ビルドが緑（サーバ/クライアント両typecheck＋`npm run build` 成功）になることを確認済み。
※ `SuspendedPage.tsx` は最小実装の暫定版のため、UX文言は要レビュー。

### D-1. コミット済みPrismaマイグレーションがゼロ

- `.gitignore` に `prisma/migrations/` があり、マイグレーションが**1件もコミットされていない**。
- 本プロジェクトは `prisma db push`（スキーマ同期）運用（`package.json` の `db:push`）。
- 一方 v1.0（§6.4／§9）と `railway.toml` は `prisma migrate deploy` に依存 → **空振り**（何も適用されない）。
  初回移行はDBダンプ復元でスキーマが入るため露見しにくいが、**将来デプロイでスキーマ差分が反映されない**。

**方針（どちらかを選択）**
- **推奨: マイグレーション運用へ移行** — `.gitignore` から `prisma/migrations/` を除外（本改訂で対応済み）。
  ローカルで `npx prisma migrate dev --name init` を実行して初期マイグレーションを作成・コミット →
  以降 `migrate deploy` が正しく機能する。
- **db push を継続** — Dockerfile/compose/CI（§6.4, §9）の `prisma migrate deploy` を **`prisma db push`** に置換する。
  ロールバック履歴は持てない点に留意。

> 初回カットオーバー（§13）はRailwayダンプ復元でスキーマが入るため、上記いずれでも成立する。
> ただし**運用開始後の継続デプロイ**のために、移行前にどちらかを確定させること。

---

## 2. High 指摘

### H-1. Stripe価格ID env の欠落
実装は `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_STANDARD` / `STRIPE_PRICE_ENTERPRISE` を使用（プランID解決）。
v1.0 §5.1・旧 `.env.example` の両方に無く、**チェックアウトが機能しない**。→ `.env.example` に追加済み。§5.1 にも追記のこと。

### H-2. `prisma` の依存区分
`prisma`（CLI）が devDependencies にあり `npm ci --omit=dev` で除外されると `prisma generate` / `migrate deploy` が不安定。
→ **`prisma` を dependencies に移動済み**（`package.json`）。v1.0 §5.2 の注記どおりの対応。

### H-3. PDF日本語フォントのdist同梱
実装は `dist/fonts/NotoSansJP-Regular.ttf`（`FONT_DIR` で上書き可）を参照し、無ければ英語フォールバック。
`npm run build` はフォントをdistへコピーしないため、**常に文字化け**していた。

**修正**
- `scripts/copy-assets.mjs` を追加し、`build` に `copy:assets`（`fonts/` → `dist/fonts/`）を組み込み済み。
- リポジトリに `fonts/NotoSansJP-Regular.ttf` を配置（`fonts/README.md` 参照）。CIのビルド前にダウンロードする方式でも可。

### D-2. CSPでGoogle Mapsが遮断され地図が出ない
`server.ts` の helmet CSP が `scriptSrc: 'self' 'unsafe-inline'` のみで、`<LoadScript>` が読む `maps.googleapis.com` を許可せず、
本番で**配車マップが表示されない**（v1.0 §8.2/§12.2 の指摘の実体）。
→ CSP に `maps.googleapis.com` / `maps.gstatic.com` / `chart.googleapis.com` 等を追加済み。

---

## 3. Medium / Low（手順書の修正のみ）

### M-1. §6.6 の chown 修正
Dockerfileは `USER node` を持たず **root(uid 0)** で動作する。§6.6 の `chown -R 1000:1000 /var/guardsync/uploads` は不整合。
→ **`sudo chown -R root:root /var/guardsync/uploads`**（またはDockerfileに `USER node` を追加して1000で統一）に読み替える。

### M-2. Nginx `/webhook/` ブロックの削除
Webhookは全て `/api` 配下（`/api/stripe/webhook`, `/api/webhook/line-works`, `/api/inbound/`）。独立した `/webhook/` は存在しない。
→ §7.1 の `location /webhook/ { … }` は削除。Stripe署名のための `proxy_request_buffering on` は **`location /api/`** 側に置く
（本改訂 `deploy/nginx/guardsync.conf` は修正済み）。

### M-3. SendGrid env
`server.ts` は `SENDGRID_API_KEY` を使用（付録A-6のリレー）。§5.1 に任意項目として追加（`.env.example` 反映済み）。

### Low（注記のみ）
- **L-1**: `/api/health` は固定JSONでDB接続を検査しない（死活監視のみ）。要件次第でDB pingを追加検討。
- **L-2**: §5.1 の `LINE_WORKS_*` は過剰記載（実装は `LINE_WORKS_BOT_ID` / `LINE_WORKS_BOT_SECRET` のみ）。`INBOUND_COMPANY_CODE` は記載漏れ。
- **L-3**: `client_max_body_size` は実Multer上限（10MB）に合わせ **12m** 目安（本改訂nginx反映）。
- **L-4**: server.js難読化のためSentryのスタックトレースが判読不能。source map運用 or 難読化除外を検討。
- **L-5**: `express.static` の参照パスは疑わしいが、NginxがSPA配信するVPS構成では未使用（実害なし）。

---

## 4. v1.0 で正しく機能している指摘（変更不要）
- **`app.set('trust proxy', 1)`（§7.2）**: 実装に未設定だったため**本改訂でコード追加**。指摘は正確。
- **Stripe raw body（A-3）**: `server.ts` は `express.json()` 前に `/api/stripe/webhook` へ `express.raw` 適用済み。
- **node-cron 単一プロセス（§5.3, A-2）**: 妥当。app はレプリカ1で運用。
- **PWA no-cache（§7.1）** / **ENCRYPTION_KEY不変（§5.1）** / **PostgreSQL 16・Node 22**: いずれも妥当。

---

## 5. リポジトリ変更一覧（本改訂で追加・修正）

**コード修正**
- `server.ts`: `trust proxy` 追加、CSPにGoogle Maps許可、`UPLOAD_DIR`/`FONT_DIR` 環境変数化。
- `package.json`: `prisma` を dependencies へ、`engines` を `>=22`、`build` に `copy:assets` 追加。
- `src/pages/SuspendedPage.tsx`（復元・暫定）、`src/lib/constants.ts`（復元）。
- `.gitignore`: `prisma/migrations/` を管理対象化。
- `.env.example`: Stripe価格ID・SendGrid・UPLOAD_DIR・TZ を追加、正しい変数名で整理。

**追加ファイル（移行用）**
- `Dockerfile`, `.dockerignore`
- `deploy/docker-compose.yml`
- `deploy/nginx/guardsync.conf`
- `.github/workflows/deploy.yml`
- `scripts/copy-assets.mjs`
- `fonts/README.md`

**移行前に人手で必要な作業**
1. `fonts/NotoSansJP-Regular.ttf` の配置（H-3）。
2. マイグレーション方針の確定（D-1）。
3. GitHub Secrets: `SSH_PRIVATE_KEY` / `VPS_HOST` / `VITE_GOOGLE_MAPS_API_KEY` の登録。
4. `.env`（本番）へ全キーを設定（`.env.example` 準拠）。
