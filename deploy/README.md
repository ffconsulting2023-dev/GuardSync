# GuardSync 本番デプロイ（さくらVPS）

このディレクトリは、さくらVPS への本番デプロイ用の構成ファイルです。
詳細な移行手順は `../docs/GuardSync_さくらVPS移行手順書_v1.1_改訂.md` を参照してください。

## 対象環境

| 項目 | 値 |
|---|---|
| プラン | 4Gプラン（東京リージョン） / Docker実行環境 |
| OS | Ubuntu 24.04 LTS (amd64) |
| ホスト名 | `tk2-110-56161.vs.sakura.ne.jp` |
| IPv4 | `153.121.42.165`（GW `153.121.42.1` / mask `255.255.254.0`） |
| IPv6 | `2001:e42:102:1105:153:121:42:165`（GW `fe80::1` / prefix 64 / DNS `2001:e42::1`） |
| ドメイン | `guardsync.jp`（JPRS、利用中） |

## DNS（設定済み）

| エントリー | タイプ | データ |
|---|---|---|
| `@` | A | `153.121.42.165` |
| `@` | MX | `10 @` |
| `www` | CNAME | `@` |
| `mail` | CNAME | `@` |
| `ftp` | CNAME | `@` |

- 正規URLは **apex `https://guardsync.jp`**（`www` は Nginx で apex へ 301 リダイレクト）。
- ネームサーバはさくら管理（`ns1.dns.ne.jp` / `ns2.dns.ne.jp`）。
- カットオーバー前は TTL を 300 秒へ下げておくと切り戻しが速い（手順書 §13.1）。

## ファイル

| ファイル | 配置先 | 用途 |
|---|---|---|
| `../Dockerfile` | `/opt/guardsync/current/Dockerfile` | アプリイメージ（CIが同期） |
| `docker-compose.yml` | `/opt/guardsync/docker-compose.yml` | app + PostgreSQL 16 |
| `nginx/guardsync.conf` | `/etc/nginx/sites-available/guardsync` | TLS終端・静的配信・/api proxy |

## 初回セットアップの要点（実値）

```bash
# TLS証明書（apex + www の2ドメイン）
sudo certbot --nginx -d guardsync.jp -d www.guardsync.jp

# DBダンプ復元後、初回だけ baseline（既存スキーマをマイグレーション適用済みに）
docker compose run --rm app npx prisma migrate resolve --applied 0_init
docker compose run --rm app npx prisma migrate status
```

> **注意**: 「Docker実行環境」プランのため Docker Engine が初期導入済みの可能性がある。
> 手順書 §4.1 の前に `docker --version` / `docker compose version` を確認し、導入済みなら §4.1 はスキップする。

## 本番 `.env` の要点

`/opt/guardsync/.env`（`chmod 600`、Git管理外）で最低限以下を実値に:

```
APP_URL=https://guardsync.jp
UPLOAD_DIR=/app/uploads/documents
DATABASE_URL=postgresql://guardsync:<強固なパスワード>@db:5432/guardsync?schema=public
POSTGRES_PASSWORD=<DATABASE_URL と一致させる>
# JWT_SECRET / ENCRYPTION_KEY(★不変) / STRIPE_* / SMTP_* / LINE_WORKS_* / GOOGLE_MAPS_API_KEY 等
```

CI（`.github/workflows/deploy.yml`）のビルド埋め込み値・Secrets は手順書 §9 を参照。
