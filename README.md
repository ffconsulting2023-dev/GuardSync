# GuardSync

警備会社向けの統合管理システムです。隊員・現場・配員（管制）・出退勤・警備報告書・請求・給与などを一元管理し、隊員はスマートフォンの隊員アプリ（PWA）から出退勤や報告書の提出を行います。

| 環境 | URL | 反映方法 |
|---|---|---|
| 本番 | https://guardsync.jp | `main` へのマージ（push）で自動デプロイ |
| ステージング | https://staging.guardsync.jp | `staging` ブランチへの push で自動デプロイ（本番とは別DB） |
| ローカル | http://localhost:5173 | 手元のPCで `npm run dev`（このREADMEの手順） |

---

## 目次

1. [ローカル開発のはじめ方](#1-ローカル開発のはじめ方)
2. [よく使うコマンド](#2-よく使うコマンド)
3. [開発から本番反映までの流れ](#3-開発から本番反映までの流れ)
4. [データベースの変更ルール](#4-データベースの変更ルール)
5. [コードの決まりごと（SSOT）](#5-コードの決まりごとssot)
6. [構成](#6-構成)
7. [環境変数](#7-環境変数)
8. [トラブルシューティング](#8-トラブルシューティング)

---

## 1. ローカル開発のはじめ方

### 必要なもの

- **Node.js 22**（最低 20）: https://nodejs.org/
- **Docker Desktop**: ローカル用の PostgreSQL を動かすために使います。Docker を使わず自前の PostgreSQL 16 を使うこともできます（後述）。
- Git

### セットアップ（初回のみ・約3〜5分）

```bash
git clone https://github.com/ffconsulting2023-dev/GuardSync.git
```

```bash
cd GuardSync
```

Docker Desktop を起動してから、次を実行します。

```bash
npm run setup -- --sample
```

これだけで次の処理がすべて行われます。

1. `.env` を作成（`.env.development.example` をコピーし、`JWT_SECRET`・`ENCRYPTION_KEY` をこのPC専用に自動生成）
2. 依存パッケージのインストール（`npm ci`）
3. Docker で PostgreSQL を起動（`docker-compose.dev.yml`）
4. テーブル作成（本番デプロイと同じ手順: `prisma/predeploy.sql` → `prisma db push`）
5. 初期データ投入（スーパー管理者・デモ会社）
6. `--sample` を付けた場合は、デモ会社にサンプルデータ（取引先・現場・隊員・契約・車両・配員）を投入

`--sample` を付けなければ、空のデモ会社だけが作られます。セットアップは何度実行しても安全です（依存パッケージやスキーマが変わったときも同じコマンドで最新にできます）。

> **安全装置:** `.env` の `DATABASE_URL` が localhost 以外を指していると、セットアップは中断します。本番・ステージングのDBを誤って書き換えないためです。

### 起動

```bash
npm run dev
```

- 画面: http://localhost:5173
- API: http://localhost:3001/api/health

サーバー（`server.ts`）と画面（`src/`）の両方が起動し、ファイルを保存すると自動で再読み込みされます。終了は `Ctrl + C` です。

### ログイン（ローカル専用の初期アカウント）

| ロール | ログインID（メールアドレス） | パスワード |
|---|---|---|
| スーパー管理者（運営） | admin@guardsync.jp | GuardSync2026! |
| デモ会社の管理者 | demo@demo-security.co.jp | demo1234 |

隊員アプリを試すには、デモ会社の管理者でログインし、**設定 → ユーザー・ID発行** から隊員のログインIDを発行します。表示された認証用URLを開いてパスワードを設定し、そのログインIDでログインすると隊員アプリ（`/guard`）が開きます。スマートフォン幅の表示は、ブラウザの開発者ツールで確認できます。

> メール送信の設定（`SMTP_*`）が空の場合、メールは送られず画面に「未送信」と表示されます。認証用URLはコピーかQRコードで確認してください。

### Docker を使わない場合

自前の PostgreSQL 16 を使う場合は、先に `.env` を作って `DATABASE_URL` を書き換えます。

```bash
cp .env.development.example .env
```

`.env` の `DATABASE_URL` を手元のDBに合わせます（例: `postgresql://postgres:password@localhost:5432/guardsync_dev`）。データベース自体はまだ無くても、セットアップが作成します。`JWT_SECRET=__GENERATE__` のままだと起動できないため、32文字以上の任意の文字列にしてください。

```bash
npm run setup -- --no-docker --sample
```

---

## 2. よく使うコマンド

| やりたいこと | コマンド |
|---|---|
| 開発サーバーを起動 | `npm run dev` |
| セットアップ／依存とスキーマを最新にする | `npm run setup` |
| サンプルデータを入れ直す（デモ会社のデータは置き換え） | `npm run db:seed:sample` |
| ローカルDBを空にして作り直す | `npm run setup -- --reset --sample` |
| DBの中身をブラウザで見る | `npm run db:studio` |
| ローカルDB（Docker）の起動／停止 | `npm run db:up` ／ `npm run db:down` |
| 型チェック（サーバー） | `npx tsc --noEmit -p tsconfig.server.json` |
| 型チェック（画面） | `npx tsc --noEmit -p tsconfig.json` |
| 本番と同じビルド（CI と同じ確認） | `npm run build` |

ローカルDBのデータを完全に消したい場合（Docker のボリュームごと削除）:

```bash
docker compose -f docker-compose.dev.yml down -v
```

---

## 3. 開発から本番反映までの流れ

```
作業ブランチで修正 → ローカルで確認 → staging に push して確認 → PR を作って main にマージ（＝本番に自動デプロイ）
```

1. **最新の main から作業ブランチを作る**

   ```bash
   git checkout main && git pull origin main && git checkout -b fix/修正内容
   ```

2. **修正してローカルで確認する**（`npm run dev`）。コミット前に CI と同じ確認をします。

   ```bash
   npx tsc --noEmit -p tsconfig.server.json && npm run build
   ```

3. **ステージングで確認する。** 作業ブランチを `staging` に push すると、2〜3分で https://staging.guardsync.jp に反映されます。

   ```bash
   git push origin HEAD:staging --force-with-lease
   ```

   `staging` ブランチは確認用なので上書きして構いません。ただし複数人で使う場合は、他の人の確認中に上書きしないよう声をかけてください。

4. **本番に反映する。** 作業ブランチを push し、GitHub で `main` 宛ての PR を作ってマージします。マージすると本番に自動デプロイされます（GitHub の Actions タブで進行状況を確認できます）。

   ```bash
   git push -u origin fix/修正内容
   ```

> **main に直接コミットしないでください。** main へのマージ＝本番反映です。
>
> 変更内容は `context/修正履歴.md` に追記する運用です。

### デプロイの仕組み

| ワークフロー | きっかけ | 内容 |
|---|---|---|
| `.github/workflows/ci.yml` | main への push・PR | 型チェックとビルド |
| `.github/workflows/deploy-staging.yml` | `staging` への push | ビルド → さくらVPS へ転送 → `predeploy.sql` → `prisma db push` → 再起動 → ヘルスチェック |
| `.github/workflows/deploy.yml` | `main` への push（手動実行も可） | 同上（本番） |

---

## 4. データベースの変更ルール

- スキーマは `prisma/schema.prisma` が正です。本番・ステージングにはデプロイ時に `prisma db push` で反映されます（マイグレーションファイルは使っていません）。
- デプロイ時の `db push` は `--accept-data-loss` なしで実行されるため、**データが失われうる変更はデプロイが失敗して止まります**（安全のため）。
- **既存テーブルに一意制約（`@unique`）を追加する場合**は、値が全て空でも警告が出てデプロイが止まります。`prisma/predeploy.sql` に、列と一意インデックスを Prisma と同じ名前で先に作る冪等な SQL（`IF NOT EXISTS`）を追記してください。デプロイとローカルのセットアップは、`db push` の前にこのファイルを実行します。
- 列の削除・型変更などデータが消える変更は、移行手順を別途検討してください。
- 変更後は `npm run setup` でローカルDBに反映し、動作を確認してから push してください。

---

## 5. コードの決まりごと（SSOT）

同じ定義を複数箇所に書かず、1か所に置いて参照します（Single Source of Truth）。

| 内容 | 置き場所 |
|---|---|
| サーバーと画面の両方で使う定義・入力チェック | `shared/`（例: `shared/securityReport.ts` 警備報告書、`shared/account.ts` ログインID・パスワード規則・ロール） |
| 画面で使うラベル・ステータス・選択肢 | `src/lib/constants.ts` |
| データの正（どのテーブルが正か） | `prisma/schema.prisma`（スナップショット列にはコメントで明記） |

---

## 6. 構成

| 区分 | 技術 |
|---|---|
| 画面 | React 18 / TypeScript / Vite 6 / Tailwind CSS / TanStack Query / React Router / PWA（vite-plugin-pwa） |
| サーバー | Node.js / Express 4（`server.ts`）/ zod |
| DB | PostgreSQL 16 / Prisma 6 |
| 本番 | さくらVPS（Docker）、GitHub Actions で自動デプロイ |

```
.
├── server.ts                 # APIサーバー（Express）
├── shared/                   # サーバーと画面で共有する定義（SSOT）
├── src/
│   ├── pages/                # 管理画面の各ページ（pages/guard/ は隊員アプリ）
│   ├── components/           # 共通コンポーネント
│   ├── lib/                  # API クライアント・認証・定数（constants.ts）
│   └── hooks/
├── prisma/
│   ├── schema.prisma         # DBスキーマ（正）
│   ├── predeploy.sql         # db push の前に実行する冪等SQL
│   ├── seed.ts               # 初期データ（スーパー管理者・デモ会社）
│   └── seed-sample.ts        # サンプルデータ（開発・デモ用）
├── scripts/setup-local.sh    # ローカル環境のセットアップ（npm run setup）
├── docker-compose.dev.yml    # ローカル用 PostgreSQL
├── .env.development.example  # ローカル用の環境変数テンプレート
├── .env.example              # 本番用の環境変数一覧
├── Dockerfile                # 本番イメージ
└── context/修正履歴.md        # 変更履歴
```

---

## 7. 環境変数

ローカルは `npm run setup` が `.env` を作るので、通常は編集不要です。`.env` は Git に含まれません（本番の値を書かないでください）。

| 変数 | 用途 | ローカルの値 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL の接続先 | `postgresql://guardsync:guardsync@localhost:5432/guardsync_dev` |
| `JWT_SECRET` | ログイントークンの署名（32文字以上必須） | 自動生成 |
| `ENCRYPTION_KEY` | LINE Works の機密情報の暗号化 | 自動生成 |
| `PORT` | サーバーのポート | `3001`（画面の開発サーバーが 3001 に転送するため） |
| `APP_URL` | メールや認証用URLに使う画面のURL | `http://localhost:5173` |
| `VITE_API_URL` | 画面から見たAPIのURL | 空（開発サーバーの転送を使う） |
| `SMTP_*` | メール送信 | 空（送信しない） |
| `LINE_WORKS_*`・`INBOUND_*`・`GOOGLE_MAPS_API_KEY`・`VITE_GOOGLE_MAPS_API_KEY` | 各連携機能 | 試すときだけ設定 |

本番の環境変数は `.env.example` を参照してください。

---

## 8. トラブルシューティング

| 症状 | 対処 |
|---|---|
| `Docker が起動していません` | Docker Desktop を起動してから再実行。Docker を使わない場合は「Docker を使わない場合」の手順へ |
| `DATABASE_URL がローカル以外を指しています` | `.env` の `DATABASE_URL` を localhost の PostgreSQL にする（安全装置） |
| `port 5432 is already allocated` | 手元の PostgreSQL が 5432 を使用中。それを止めるか、その PostgreSQL を `--no-docker` で使う |
| サーバーが `JWT_SECRET` のエラーで起動しない | `.env` の `JWT_SECRET` を32文字以上にする（`.env` を削除して `npm run setup` で再作成も可） |
| 画面は出るがログインできない／API が `ECONNREFUSED 127.0.0.1:3001` | `.env` の `PORT=3001` を確認。起動直後はサーバーの準備に数秒かかる |
| 「パスワードが未設定です」と出る | 発行直後のアカウントは、認証用URLでパスワード設定が必要（設定 → ユーザー・ID発行 → 認証URL） |
| `リクエストが多すぎます`（429） | APIの回数制限（15分100回など）。少し待つか、`npm run dev` を再起動 |
| `--reset` が `Prisma Migrate detected that it was invoked by ...` で止まる | AI エージェント経由でDBを消す操作を Prisma が止めています。自分のターミナルから直接実行してください |
| `MODULE_TYPELESS_PACKAGE_JSON` の警告 | 動作に影響なし（`postcss.config.js` の形式に関する警告） |
| セットアップ後に画面が古い／おかしい | `npm run setup` を再実行し、ブラウザを再読み込み（PWAのキャッシュが残る場合はシークレットウィンドウで確認） |
