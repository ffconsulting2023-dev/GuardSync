# GuardSync 本番イメージ
# CIでビルド済みの dist/ を取り込む構成（VPS上ではビルドしない）。
FROM node:22-bookworm-slim

# Prisma は OpenSSL を必要とする
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Tokyo

# prisma を dependencies に含めているため、--omit=dev でも
# `prisma generate` / `prisma migrate deploy` が利用可能。
COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

# ビルド済み成果物（dist/public, dist/server.js, dist/fonts など）
COPY dist ./dist

# アップロード保存先（UPLOAD_DIR=/app/uploads/documents をボリュームにマウント）
RUN mkdir -p /app/uploads/documents

EXPOSE 3000
CMD ["node", "dist/server.js"]
