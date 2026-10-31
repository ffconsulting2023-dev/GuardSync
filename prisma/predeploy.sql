-- デプロイ時に `prisma db push` の直前に実行する冪等SQL（.github/workflows/deploy*.yml・scripts/setup-local.sh）。
-- 既存テーブルへの一意制約の追加は、値が全て NULL でも db push がデータ損失警告で停止するため、
-- 列と一意インデックスを Prisma と同じ名前で先に作っておき、db push 側では差分なしにする。
-- 何度実行しても結果は同じ（IF NOT EXISTS）。テーブルがまだ無い新規DBでは何もしない（db push が作成する）。

-- 2026-11: ログインID・隊員アカウント紐付け（schema.prisma の User.loginId / User.guardId）
DO $$
BEGIN
  IF to_regclass('"User"') IS NOT NULL THEN
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loginId" TEXT;
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "guardId" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS "User_loginId_key" ON "User"("loginId");
    CREATE UNIQUE INDEX IF NOT EXISTS "User_guardId_key" ON "User"("guardId");
  END IF;
END $$;
