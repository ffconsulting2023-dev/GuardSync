import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // スーパー管理者会社
  const superCompany = await prisma.company.upsert({
    where: { code: 'SUPERADMIN' },
    update: {},
    create: {
      name: 'GuardSync 運営',
      code: 'SUPERADMIN',
      plan: 'MAX',
      isSuperAdmin: true,
    },
  })

  // スーパー管理者ユーザー
  const adminHash = await bcrypt.hash('GuardSync2026!', 12)
  await prisma.user.upsert({
    where: { email: 'admin@guardsync.jp' },
    update: { password: adminHash },
    create: {
      email: 'admin@guardsync.jp',
      password: adminHash,
      name: 'システム管理者',
      role: 'SUPER_ADMIN',
      companyId: superCompany.id,
      isSuperAdmin: true,
    },
  })

  // デモ会社
  const demoCompany = await prisma.company.upsert({
    where: { code: 'DEMO001' },
    update: {},
    create: {
      name: '株式会社デモ警備',
      code: 'DEMO001',
      plan: 'MIN',
    },
  })

  // デモ管理者
  const demoHash = await bcrypt.hash('demo1234', 12)
  const demoAdmin = await prisma.user.upsert({
    where: { email: 'demo@demo-security.co.jp' },
    update: { password: demoHash },
    create: {
      email: 'demo@demo-security.co.jp',
      password: demoHash,
      name: '田中 管理者',
      role: 'ADMIN',
      companyId: demoCompany.id,
    },
  })

  // デモ現場
  const site1 = await prisma.site.upsert({
    where: { id: 'demo-site-001' },
    update: {},
    create: {
      id: 'demo-site-001',
      companyId: demoCompany.id,
      name: '東京ビル警備',
      address: '東京都千代田区丸の内1-1-1',
      clientName: '東京ビル管理株式会社',
      clientPhone: '03-1234-5678',
    },
  })

  const site2 = await prisma.site.upsert({
    where: { id: 'demo-site-002' },
    update: {},
    create: {
      id: 'demo-site-002',
      companyId: demoCompany.id,
      name: '渋谷商業施設',
      address: '東京都渋谷区渋谷2-1-1',
      clientName: '渋谷ショッピング株式会社',
      clientPhone: '03-9876-5432',
    },
  })

  // デモ隊員
  const guard1 = await prisma.guard.upsert({
    where: { companyId_employeeNumber: { companyId: demoCompany.id, employeeNumber: 'G001' } },
    update: {},
    create: {
      companyId: demoCompany.id,
      employeeNumber: 'G001',
      name: '鈴木 一郎',
      nameKana: 'スズキ イチロウ',
      gender: 'MALE',
      phone: '090-1234-5678',
      employmentType: 'FULL_TIME',
      certifications: ['施設警備業務検定2級'],
      dailyPayEnabled: true,
    },
  })

  const guard2 = await prisma.guard.upsert({
    where: { companyId_employeeNumber: { companyId: demoCompany.id, employeeNumber: 'G002' } },
    update: {},
    create: {
      companyId: demoCompany.id,
      employeeNumber: 'G002',
      name: '佐藤 花子',
      nameKana: 'サトウ ハナコ',
      gender: 'FEMALE',
      phone: '090-9876-5432',
      employmentType: 'PART_TIME',
      certifications: [],
      dailyPayEnabled: false,
    },
  })

  // デモ契約
  await prisma.contract.upsert({
    where: { contractNumber: 'C2026-001' },
    update: {},
    create: {
      companyId: demoCompany.id,
      siteId: site1.id,
      contractNumber: 'C2026-001',
      clientName: '東京ビル管理株式会社',
      startDate: new Date('2026-04-01'),
      unitPrice: 25000,
      guardCount: 2,
      status: 'ACTIVE',
      createdById: demoAdmin.id,
    },
  })

  // デモ協力会社
  await prisma.partner.createMany({
    skipDuplicates: true,
    data: [
      { companyId: demoCompany.id, name: 'グループ警備株式会社', type: 'GROUP', priority: 100, contactName: '山田 部長', phone: '03-1111-2222' },
      { companyId: demoCompany.id, name: '優先警備サービス', type: 'PREFERRED', priority: 50, phone: '03-3333-4444' },
      { companyId: demoCompany.id, name: '一般協力警備', type: 'GENERAL', priority: 0 },
    ],
  })

  // 今日のシフト（デモ）
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  await prisma.schedule.createMany({
    skipDuplicates: true,
    data: [
      { companyId: demoCompany.id, guardId: guard1.id, siteId: site1.id, date: today, startTime: '09:00', endTime: '17:00', status: 'ASSIGNED' },
      { companyId: demoCompany.id, guardId: guard2.id, siteId: site2.id, date: today, startTime: '10:00', endTime: '18:00', status: 'ASSIGNED' },
    ],
  })

  console.log('✓ Seed completed')
  console.log('  スーパー管理者: admin@guardsync.jp / GuardSync2026!')
  console.log('  デモ管理者: demo@demo-security.co.jp / demo1234')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
