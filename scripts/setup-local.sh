#!/usr/bin/env bash
# GuardSync ローカル開発環境のセットアップ
#   使い方: npm run setup            （初回・依存やスキーマが変わったとき。何度実行しても安全）
#           npm run setup -- --sample （デモ会社にサンプルデータ（隊員・現場・配員など）も投入）
#           npm run setup -- --reset  （ローカルDBを空にして作り直す）
#           npm run setup -- --no-docker（Docker を使わず、.env の DATABASE_URL の PostgreSQL を使う）
set -euo pipefail

cd "$(dirname "$0")/.."

SAMPLE=0; RESET=0; USE_DOCKER=1
for arg in "$@"; do
  case "$arg" in
    --sample) SAMPLE=1 ;;
    --reset) RESET=1 ;;
    --no-docker) USE_DOCKER=0 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "不明なオプション: $arg（--help で使い方）" >&2; exit 1 ;;
  esac
done

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

# ─── 1. Node.js ───
step "Node.js を確認"
command -v node >/dev/null || fail "Node.js が見つかりません。Node.js 22 をインストールしてください（https://nodejs.org/）"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js $(node -v) は古すぎます。Node.js 22（最低 20）を使ってください"
echo "Node.js $(node -v)"

# ─── 2. .env ───
step ".env を準備"
if [ ! -f .env ]; then
  cp .env.development.example .env
  # 秘密値はこのPC専用にランダム生成する（本番の値は使わない）
  node -e '
    const fs = require("fs"), c = require("crypto")
    let s = fs.readFileSync(".env", "utf8")
    s = s.replace("JWT_SECRET=__GENERATE__", "JWT_SECRET=" + c.randomBytes(48).toString("hex"))
    s = s.replace("ENCRYPTION_KEY=__GENERATE__", "ENCRYPTION_KEY=" + c.randomBytes(32).toString("hex"))
    fs.writeFileSync(".env", s)
  '
  echo ".env を作成しました（.env.development.example から。JWT_SECRET・ENCRYPTION_KEY は自動生成）"
else
  echo "既存の .env を使います（作り直す場合は .env を削除して再実行）"
fi

# ─── 3. 依存パッケージ ───
step "依存パッケージをインストール（npm ci）"
npm ci --no-audit --no-fund

# .env の値を読む（dotenv で解釈を本番サーバーと揃える）
env_get() { node -e 'require("dotenv").config(); process.stdout.write(process.env[process.argv[1]] || "")' "$1"; }
DATABASE_URL=$(env_get DATABASE_URL)
JWT_SECRET=$(env_get JWT_SECRET)
[ -n "$DATABASE_URL" ] || fail ".env に DATABASE_URL がありません"
[ ${#JWT_SECRET} -ge 32 ] || fail ".env の JWT_SECRET は32文字以上にしてください（サーバーが起動しません）"
[ "$(env_get PORT)" = "3001" ] || echo "⚠ PORT が 3001 ではありません。画面（Vite）は /api を 3001 に転送するため、ログインできない場合は PORT=3001 にしてください"

# 本番・ステージングのDBを誤って書き換えないよう、ローカル以外のDBは拒否する
DB_HOST=$(node -e 'try { process.stdout.write(new URL(process.argv[1]).hostname) } catch { process.stdout.write("") }' "$DATABASE_URL")
case "$DB_HOST" in
  localhost|127.0.0.1|::1|\[::1\]) ;;
  *) fail "DATABASE_URL がローカル以外（$DB_HOST）を指しています。ローカル開発では localhost の PostgreSQL を使ってください" ;;
esac
export DATABASE_URL

# ─── 4. PostgreSQL ───
step "PostgreSQL を準備"
COMPOSE_URL="postgresql://guardsync:guardsync@localhost:5432/guardsync_dev"
if [ "$USE_DOCKER" = 1 ] && [ "$DATABASE_URL" = "$COMPOSE_URL" ]; then
  command -v docker >/dev/null && docker info >/dev/null 2>&1 \
    || fail "Docker が起動していません。Docker Desktop を起動するか、自前の PostgreSQL を使う場合は .env の DATABASE_URL を書き換えて --no-docker を付けてください"
  docker compose -f docker-compose.dev.yml up -d --wait
  echo "Docker の PostgreSQL（guardsync-dev-db）を起動しました"
else
  echo "DATABASE_URL の PostgreSQL を使います（${DATABASE_URL%%@*}@…）"
fi

# ─── 5. スキーマ反映（本番デプロイと同じ手順: predeploy.sql → db push）───
step "データベースのスキーマを反映"
if [ "$RESET" = 1 ]; then
  npx prisma db push --force-reset --skip-generate
else
  # DB がまだ作られていない初回は失敗するが、続く db push が DB ごと作成する
  npx prisma db execute --file prisma/predeploy.sql --schema prisma/schema.prisma 2>/dev/null \
    || echo "（初回のため事前SQLはスキップ）"
  npx prisma db push --skip-generate
fi

# ─── 6. 初期データ ───
step "初期データを投入（スーパー管理者・デモ会社）"
npm run db:seed
if [ "$SAMPLE" = 1 ]; then
  step "サンプルデータを投入（デモ会社の既存データは置き換え）"
  npm run db:seed:sample
fi

cat <<'MSG'

✅ セットアップ完了

  起動:   npm run dev
  画面:   http://localhost:5173
  API:    http://localhost:3001/api/health

  ログイン（ローカル専用の初期アカウント）
    スーパー管理者  admin@guardsync.jp / GuardSync2026!
    デモ会社管理者  demo@demo-security.co.jp / demo1234

  詳しくは README.md の「ローカル開発」を参照してください。
MSG
