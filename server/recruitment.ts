// 採用経路マスタの既定値の用意（server.ts と取り込みで共通）
import type { PrismaClient, Prisma } from '@prisma/client'
import { DEFAULT_RECRUITMENT_CHANNELS } from '../shared/recruitment'

// 会社のマスタが空なら既定の媒体（Indeed・ギガバイト）を用意する
export async function ensureRecruitmentChannels(db: PrismaClient | Prisma.TransactionClient, companyId: string) {
  if (await db.recruitmentChannel.count({ where: { companyId } })) return
  await db.recruitmentChannel.createMany({
    data: DEFAULT_RECRUITMENT_CHANNELS.map((name, i) => ({ companyId, name, sortOrder: i })),
    skipDuplicates: true,
  })
}
