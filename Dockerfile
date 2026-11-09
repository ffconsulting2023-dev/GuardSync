# GuardSync 本番イメージ（CIでビルド済み dist を取り込む）
FROM node:22-bookworm-slim

# Prisma は OpenSSL を必要とする
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Tokyo

# prisma が devDependencies にあってもコンテナで generate/db push できるよう明示導入。
# postinstall(prisma generate) がスキーマ未配置で失敗しないよう --ignore-scripts で抑止し、
# prisma/ を先に COPY してから明示的に generate する。
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts \
 && npm install prisma@6 --no-save --ignore-scripts \
 && npx prisma generate

# ビルド済み成果物（dist/public, dist/server.js, dist/fonts など）
COPY dist ./dist

# アップロード保存先（UPLOAD_DIR=/app/uploads/documents をボリュームにマウント）
RUN mkdir -p /app/uploads/documents

EXPOSE 3000
CMD ["node", "dist/server.js"]
