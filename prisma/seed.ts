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

  // 2026年度 給与マスタデータ投入
  await seedPayrollMasterData()

  console.log('✓ Seed completed')
  console.log('  スーパー管理者: admin@guardsync.jp / GuardSync2026!')
  console.log('  デモ管理者: demo@demo-security.co.jp / demo1234')
}

// ─────────────────────────────────────────────
// 2026年度 給与マスタデータ投入
// ─────────────────────────────────────────────
async function seedPayrollMasterData() {
  const FISCAL_YEAR = 2026
  console.log(`  給与マスタデータ投入中 (${FISCAL_YEAR}年度)...`)

  // ═══════════════════════════════════════════
  // 1. HealthInsGradeTable（東京都 全50等級）
  // ═══════════════════════════════════════════
  // 2026年度 協会けんぽ東京都 料率目安
  // 健康保険料率: 9.98%（被保険者 4.99%, 事業主 4.99%）
  // 介護保険料率: 1.60%（被保険者 0.80%, 事業主 0.80%）
  const HEALTH_EMPLOYEE_RATE = 0.0499
  const HEALTH_EMPLOYER_RATE = 0.0499
  const NURSING_EMPLOYEE_RATE = 0.008
  const NURSING_EMPLOYER_RATE = 0.008

  // 協会けんぽ 標準報酬月額表（全50等級）
  const healthGradeMonthly: number[] = [
    58000,   // 等級1
    68000,   // 等級2
    78000,   // 等級3
    88000,   // 等級4
    98000,   // 等級5
    104000,  // 等級6
    110000,  // 等級7
    118000,  // 等級8
    126000,  // 等級9
    134000,  // 等級10
    142000,  // 等級11
    150000,  // 等級12
    160000,  // 等級13
    170000,  // 等級14
    180000,  // 等級15
    190000,  // 等級16
    200000,  // 等級17
    220000,  // 等級18
    240000,  // 等級19
    260000,  // 等級20
    280000,  // 等級21
    300000,  // 等級22
    320000,  // 等級23
    340000,  // 等級24
    360000,  // 等級25
    380000,  // 等級26
    410000,  // 等級27
    440000,  // 等級28
    470000,  // 等級29
    500000,  // 等級30
    530000,  // 等級31
    560000,  // 等級32
    590000,  // 等級33
    620000,  // 等級34
    650000,  // 等級35
    680000,  // 等級36
    710000,  // 等級37
    750000,  // 等級38
    790000,  // 等級39
    830000,  // 等級40
    880000,  // 等級41
    930000,  // 等級42
    980000,  // 等級43
    1030000, // 等級44
    1090000, // 等級45
    1150000, // 等級46
    1210000, // 等級47
    1270000, // 等級48
    1330000, // 等級49
    1390000, // 等級50
  ]

  for (let i = 0; i < healthGradeMonthly.length; i++) {
    const grade = i + 1
    const standardMonthly = healthGradeMonthly[i]
    const employeeShare = Math.round(standardMonthly * HEALTH_EMPLOYEE_RATE)
    const employerShare = Math.round(standardMonthly * HEALTH_EMPLOYER_RATE)
    const nursingEmployee = Math.round(standardMonthly * NURSING_EMPLOYEE_RATE)
    const nursingEmployer = Math.round(standardMonthly * NURSING_EMPLOYER_RATE)

    await prisma.healthInsGradeTable.upsert({
      where: {
        fiscalYear_prefecture_grade: {
          fiscalYear: FISCAL_YEAR,
          prefecture: '東京都',
          grade,
        },
      },
      update: {
        standardMonthly,
        employeeShare,
        employerShare,
        nursingEmployee,
        nursingEmployer,
      },
      create: {
        fiscalYear: FISCAL_YEAR,
        prefecture: '東京都',
        grade,
        standardMonthly,
        employeeShare,
        employerShare,
        nursingEmployee,
        nursingEmployer,
      },
    })
  }
  console.log('    ✓ 健康保険等級表（東京都 50等級）')

  // ═══════════════════════════════════════════
  // 2. PensionGradeTable（厚生年金 全32等級）
  // ═══════════════════════════════════════════
  // 厚生年金保険料率: 18.3%（被保険者 9.15%, 事業主 9.15%）
  const PENSION_RATE = 0.0915

  const pensionGradeMonthly: number[] = [
    88000,   // 等級1
    98000,   // 等級2
    104000,  // 等級3
    110000,  // 等級4
    118000,  // 等級5
    126000,  // 等級6
    134000,  // 等級7
    142000,  // 等級8
    150000,  // 等級9
    160000,  // 等級10
    170000,  // 等級11
    180000,  // 等級12
    190000,  // 等級13
    200000,  // 等級14
    220000,  // 等級15
    240000,  // 等級16
    260000,  // 等級17
    280000,  // 等級18
    300000,  // 等級19
    320000,  // 等級20
    340000,  // 等級21
    360000,  // 等級22
    380000,  // 等級23
    410000,  // 等級24
    440000,  // 等級25
    470000,  // 等級26
    500000,  // 等級27
    530000,  // 等級28
    560000,  // 等級29
    590000,  // 等級30
    620000,  // 等級31
    650000,  // 等級32
  ]

  for (let i = 0; i < pensionGradeMonthly.length; i++) {
    const grade = i + 1
    const standardMonthly = pensionGradeMonthly[i]
    const employeeShare = Math.round(standardMonthly * PENSION_RATE)
    const employerShare = Math.round(standardMonthly * PENSION_RATE)

    await prisma.pensionGradeTable.upsert({
      where: {
        fiscalYear_grade: {
          fiscalYear: FISCAL_YEAR,
          grade,
        },
      },
      update: {
        standardMonthly,
        employeeShare,
        employerShare,
      },
      create: {
        fiscalYear: FISCAL_YEAR,
        grade,
        standardMonthly,
        employeeShare,
        employerShare,
      },
    })
  }
  console.log('    ✓ 厚生年金等級表（32等級）')

  // ═══════════════════════════════════════════
  // 3. EmploymentInsRate（雇用保険料率）
  // ═══════════════════════════════════════════
  const employmentInsRates = [
    { businessType: '一般の事業',   employeeRate: 0.006, employerRate: 0.0095 },
    { businessType: '建設の事業',   employeeRate: 0.007, employerRate: 0.0105 },
    { businessType: '農林水産の事業', employeeRate: 0.007, employerRate: 0.0095 },
  ]

  for (const rate of employmentInsRates) {
    await prisma.employmentInsRate.upsert({
      where: {
        fiscalYear_businessType: {
          fiscalYear: FISCAL_YEAR,
          businessType: rate.businessType,
        },
      },
      update: {
        employeeRate: rate.employeeRate,
        employerRate: rate.employerRate,
      },
      create: {
        fiscalYear: FISCAL_YEAR,
        businessType: rate.businessType,
        employeeRate: rate.employeeRate,
        employerRate: rate.employerRate,
      },
    })
  }
  console.log('    ✓ 雇用保険料率（3事業種類）')

  // ═══════════════════════════════════════════
  // 4. IncomeTaxTable（源泉徴収税額表・甲欄）
  // ═══════════════════════════════════════════
  // 2025年版ベースの月額源泉徴収税額表（主要レンジ、扶養0〜7人）
  // salaryFrom - salaryTo（以上〜未満）
  const incomeTaxRows: {
    salaryFrom: number; salaryTo: number;
    dep0: number; dep1: number; dep2: number; dep3: number;
    dep4: number; dep5: number; dep6: number; dep7: number;
  }[] = [
    { salaryFrom: 0,      salaryTo: 88000,   dep0: 0,     dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 88000,  salaryTo: 89000,   dep0: 130,   dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 89000,  salaryTo: 90000,   dep0: 180,   dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 90000,  salaryTo: 91000,   dep0: 230,   dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 91000,  salaryTo: 92000,   dep0: 290,   dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 92000,  salaryTo: 93000,   dep0: 340,   dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 93000,  salaryTo: 94000,   dep0: 390,   dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 94000,  salaryTo: 95000,   dep0: 440,   dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 95000,  salaryTo: 96000,   dep0: 500,   dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 96000,  salaryTo: 97000,   dep0: 550,   dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 97000,  salaryTo: 98000,   dep0: 600,   dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 98000,  salaryTo: 99000,   dep0: 650,   dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 99000,  salaryTo: 101000,  dep0: 720,   dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 101000, salaryTo: 103000,  dep0: 830,   dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 103000, salaryTo: 105000,  dep0: 930,   dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 105000, salaryTo: 107000,  dep0: 1030,  dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 107000, salaryTo: 109000,  dep0: 1130,  dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 109000, salaryTo: 111000,  dep0: 1240,  dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 111000, salaryTo: 113000,  dep0: 1340,  dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 113000, salaryTo: 115000,  dep0: 1440,  dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 115000, salaryTo: 117000,  dep0: 1540,  dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 117000, salaryTo: 119000,  dep0: 1640,  dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 119000, salaryTo: 121000,  dep0: 1750,  dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 121000, salaryTo: 123000,  dep0: 1850,  dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 123000, salaryTo: 125000,  dep0: 1950,  dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 125000, salaryTo: 127000,  dep0: 2050,  dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 127000, salaryTo: 129000,  dep0: 2150,  dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 129000, salaryTo: 131000,  dep0: 2260,  dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 131000, salaryTo: 133000,  dep0: 2360,  dep1: 0,     dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 133000, salaryTo: 135000,  dep0: 2460,  dep1: 530,   dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 135000, salaryTo: 137000,  dep0: 2550,  dep1: 630,   dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 137000, salaryTo: 139000,  dep0: 2610,  dep1: 720,   dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 139000, salaryTo: 141000,  dep0: 2680,  dep1: 810,   dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 141000, salaryTo: 143000,  dep0: 2740,  dep1: 910,   dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 143000, salaryTo: 145000,  dep0: 2800,  dep1: 1000,  dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 145000, salaryTo: 147000,  dep0: 2860,  dep1: 1090,  dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 147000, salaryTo: 149000,  dep0: 2920,  dep1: 1180,  dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 149000, salaryTo: 151000,  dep0: 2980,  dep1: 1270,  dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 151000, salaryTo: 153000,  dep0: 3050,  dep1: 1360,  dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 153000, salaryTo: 155000,  dep0: 3120,  dep1: 1460,  dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 155000, salaryTo: 157000,  dep0: 3200,  dep1: 1560,  dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 157000, salaryTo: 159000,  dep0: 3270,  dep1: 1660,  dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 159000, salaryTo: 161000,  dep0: 3340,  dep1: 1760,  dep2: 0,     dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 161000, salaryTo: 163000,  dep0: 3410,  dep1: 1860,  dep2: 170,   dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 163000, salaryTo: 165000,  dep0: 3480,  dep1: 1960,  dep2: 270,   dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 165000, salaryTo: 167000,  dep0: 3550,  dep1: 2060,  dep2: 370,   dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 167000, salaryTo: 169000,  dep0: 3620,  dep1: 2160,  dep2: 470,   dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 169000, salaryTo: 171000,  dep0: 3700,  dep1: 2260,  dep2: 570,   dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 171000, salaryTo: 173000,  dep0: 3770,  dep1: 2360,  dep2: 670,   dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 173000, salaryTo: 175000,  dep0: 3840,  dep1: 2460,  dep2: 760,   dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 175000, salaryTo: 177000,  dep0: 3910,  dep1: 2550,  dep2: 860,   dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 177000, salaryTo: 179000,  dep0: 3980,  dep1: 2610,  dep2: 960,   dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 179000, salaryTo: 181000,  dep0: 4050,  dep1: 2680,  dep2: 1060,  dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 181000, salaryTo: 183000,  dep0: 4120,  dep1: 2740,  dep2: 1160,  dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 183000, salaryTo: 185000,  dep0: 4200,  dep1: 2800,  dep2: 1260,  dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 185000, salaryTo: 187000,  dep0: 4270,  dep1: 2860,  dep2: 1360,  dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 187000, salaryTo: 189000,  dep0: 4340,  dep1: 2920,  dep2: 1460,  dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 189000, salaryTo: 191000,  dep0: 4410,  dep1: 2980,  dep2: 1560,  dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 191000, salaryTo: 193000,  dep0: 4480,  dep1: 3050,  dep2: 1660,  dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 193000, salaryTo: 195000,  dep0: 4550,  dep1: 3120,  dep2: 1760,  dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 195000, salaryTo: 197000,  dep0: 4630,  dep1: 3200,  dep2: 1860,  dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 197000, salaryTo: 199000,  dep0: 4700,  dep1: 3270,  dep2: 1930,  dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 199000, salaryTo: 201000,  dep0: 5200,  dep1: 3570,  dep2: 1930,  dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 201000, salaryTo: 203000,  dep0: 5320,  dep1: 3690,  dep2: 2050,  dep3: 0,     dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 203000, salaryTo: 205000,  dep0: 5430,  dep1: 3800,  dep2: 2160,  dep3: 530,   dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 205000, salaryTo: 210000,  dep0: 5560,  dep1: 3920,  dep2: 2290,  dep3: 650,   dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 210000, salaryTo: 215000,  dep0: 5890,  dep1: 4250,  dep2: 2610,  dep3: 980,   dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 215000, salaryTo: 220000,  dep0: 6210,  dep1: 4580,  dep2: 2940,  dep3: 1310,  dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 220000, salaryTo: 225000,  dep0: 6530,  dep1: 4900,  dep2: 3270,  dep3: 1640,  dep4: 0,     dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 225000, salaryTo: 230000,  dep0: 6860,  dep1: 5230,  dep2: 3590,  dep3: 1960,  dep4: 330,   dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 230000, salaryTo: 235000,  dep0: 7190,  dep1: 5550,  dep2: 3920,  dep3: 2280,  dep4: 650,   dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 235000, salaryTo: 240000,  dep0: 7510,  dep1: 5880,  dep2: 4240,  dep3: 2610,  dep4: 980,   dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 240000, salaryTo: 245000,  dep0: 7780,  dep1: 6110,  dep2: 4460,  dep3: 2830,  dep4: 1200,  dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 245000, salaryTo: 250000,  dep0: 7780,  dep1: 6110,  dep2: 4460,  dep3: 2830,  dep4: 1200,  dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 250000, salaryTo: 255000,  dep0: 7780,  dep1: 6110,  dep2: 4460,  dep3: 2830,  dep4: 1200,  dep5: 0,     dep6: 0,     dep7: 0 },
    { salaryFrom: 255000, salaryTo: 260000,  dep0: 8420,  dep1: 6750,  dep2: 5100,  dep3: 3470,  dep4: 1840,  dep5: 200,   dep6: 0,     dep7: 0 },
    { salaryFrom: 260000, salaryTo: 265000,  dep0: 8670,  dep1: 7000,  dep2: 5340,  dep3: 3710,  dep4: 2070,  dep5: 440,   dep6: 0,     dep7: 0 },
    { salaryFrom: 265000, salaryTo: 270000,  dep0: 8910,  dep1: 7240,  dep2: 5570,  dep3: 3940,  dep4: 2310,  dep5: 670,   dep6: 0,     dep7: 0 },
    { salaryFrom: 270000, salaryTo: 275000,  dep0: 9160,  dep1: 7490,  dep2: 5810,  dep3: 4180,  dep4: 2540,  dep5: 910,   dep6: 0,     dep7: 0 },
    { salaryFrom: 275000, salaryTo: 280000,  dep0: 9400,  dep1: 7730,  dep2: 6050,  dep3: 4420,  dep4: 2780,  dep5: 1140,  dep6: 0,     dep7: 0 },
    { salaryFrom: 280000, salaryTo: 285000,  dep0: 9640,  dep1: 7970,  dep2: 6290,  dep3: 4660,  dep4: 3020,  dep5: 1380,  dep6: 0,     dep7: 0 },
    { salaryFrom: 285000, salaryTo: 290000,  dep0: 9890,  dep1: 8210,  dep2: 6530,  dep3: 4890,  dep4: 3260,  dep5: 1620,  dep6: 0,     dep7: 0 },
    { salaryFrom: 290000, salaryTo: 295000,  dep0: 10130, dep1: 8460,  dep2: 6780,  dep3: 5130,  dep4: 3490,  dep5: 1860,  dep6: 230,   dep7: 0 },
    { salaryFrom: 295000, salaryTo: 300000,  dep0: 10370, dep1: 8700,  dep2: 7020,  dep3: 5370,  dep4: 3730,  dep5: 2100,  dep6: 460,   dep7: 0 },
    { salaryFrom: 300000, salaryTo: 305000,  dep0: 10420, dep1: 8750,  dep2: 7060,  dep3: 5420,  dep4: 3780,  dep5: 2140,  dep6: 510,   dep7: 0 },
    { salaryFrom: 305000, salaryTo: 310000,  dep0: 10860, dep1: 9190,  dep2: 7510,  dep3: 5860,  dep4: 4220,  dep5: 2590,  dep6: 950,   dep7: 0 },
    { salaryFrom: 310000, salaryTo: 315000,  dep0: 11300, dep1: 9630,  dep2: 7950,  dep3: 6300,  dep4: 4660,  dep5: 3030,  dep6: 1390,  dep7: 0 },
    { salaryFrom: 315000, salaryTo: 320000,  dep0: 11750, dep1: 10070, dep2: 8390,  dep3: 6740,  dep4: 5100,  dep5: 3470,  dep6: 1830,  dep7: 200 },
    { salaryFrom: 320000, salaryTo: 325000,  dep0: 12190, dep1: 10510, dep2: 8830,  dep3: 7180,  dep4: 5540,  dep5: 3910,  dep6: 2270,  dep7: 640 },
    { salaryFrom: 325000, salaryTo: 330000,  dep0: 12630, dep1: 10950, dep2: 9270,  dep3: 7620,  dep4: 5980,  dep5: 4340,  dep6: 2710,  dep7: 1080 },
    { salaryFrom: 330000, salaryTo: 335000,  dep0: 13060, dep1: 11380, dep2: 9700,  dep3: 8060,  dep4: 6420,  dep5: 4780,  dep6: 3150,  dep7: 1510 },
    { salaryFrom: 335000, salaryTo: 340000,  dep0: 13280, dep1: 11600, dep2: 9920,  dep3: 8280,  dep4: 6640,  dep5: 5000,  dep6: 3370,  dep7: 1730 },
    { salaryFrom: 340000, salaryTo: 345000,  dep0: 13500, dep1: 11820, dep2: 10150, dep3: 8500,  dep4: 6860,  dep5: 5230,  dep6: 3590,  dep7: 1960 },
    { salaryFrom: 345000, salaryTo: 350000,  dep0: 13730, dep1: 12050, dep2: 10370, dep3: 8720,  dep4: 7090,  dep5: 5450,  dep6: 3810,  dep7: 2180 },
    { salaryFrom: 350000, salaryTo: 355000,  dep0: 13580, dep1: 11900, dep2: 10210, dep3: 8560,  dep4: 6920,  dep5: 5280,  dep6: 3640,  dep7: 2010 },
    { salaryFrom: 355000, salaryTo: 360000,  dep0: 14170, dep1: 12490, dep2: 10810, dep3: 9160,  dep4: 7530,  dep5: 5890,  dep6: 4250,  dep7: 2620 },
    { salaryFrom: 360000, salaryTo: 365000,  dep0: 14610, dep1: 12930, dep2: 11250, dep3: 9600,  dep4: 7960,  dep5: 6330,  dep6: 4690,  dep7: 3060 },
    { salaryFrom: 365000, salaryTo: 370000,  dep0: 15050, dep1: 13370, dep2: 11690, dep3: 10040, dep4: 8400,  dep5: 6770,  dep6: 5130,  dep7: 3500 },
    { salaryFrom: 370000, salaryTo: 375000,  dep0: 15490, dep1: 13810, dep2: 12130, dep3: 10480, dep4: 8840,  dep5: 7210,  dep6: 5570,  dep7: 3940 },
    { salaryFrom: 375000, salaryTo: 380000,  dep0: 15930, dep1: 14250, dep2: 12570, dep3: 10920, dep4: 9280,  dep5: 7650,  dep6: 6010,  dep7: 4380 },
    { salaryFrom: 380000, salaryTo: 385000,  dep0: 16370, dep1: 14690, dep2: 13010, dep3: 11360, dep4: 9720,  dep5: 8090,  dep6: 6450,  dep7: 4810 },
    { salaryFrom: 385000, salaryTo: 390000,  dep0: 16590, dep1: 14910, dep2: 13230, dep3: 11580, dep4: 9940,  dep5: 8310,  dep6: 6670,  dep7: 5040 },
    { salaryFrom: 390000, salaryTo: 395000,  dep0: 16810, dep1: 15140, dep2: 13460, dep3: 11810, dep4: 10170, dep5: 8530,  dep6: 6900,  dep7: 5260 },
    { salaryFrom: 395000, salaryTo: 400000,  dep0: 17040, dep1: 15360, dep2: 13680, dep3: 12030, dep4: 10390, dep5: 8760,  dep6: 7120,  dep7: 5490 },
    { salaryFrom: 400000, salaryTo: 405000,  dep0: 17050, dep1: 15360, dep2: 13680, dep3: 12040, dep4: 10400, dep5: 8770,  dep6: 7130,  dep7: 5490 },
    { salaryFrom: 405000, salaryTo: 410000,  dep0: 17490, dep1: 15800, dep2: 14120, dep3: 12480, dep4: 10840, dep5: 9200,  dep6: 7570,  dep7: 5930 },
    { salaryFrom: 410000, salaryTo: 420000,  dep0: 17930, dep1: 16240, dep2: 14560, dep3: 12920, dep4: 11280, dep5: 9640,  dep6: 8010,  dep7: 6370 },
    { salaryFrom: 420000, salaryTo: 430000,  dep0: 18810, dep1: 17120, dep2: 15440, dep3: 13790, dep4: 12160, dep5: 10520, dep6: 8880,  dep7: 7250 },
    { salaryFrom: 430000, salaryTo: 440000,  dep0: 19690, dep1: 18010, dep2: 16320, dep3: 14680, dep4: 13040, dep5: 11400, dep6: 9770,  dep7: 8130 },
    { salaryFrom: 440000, salaryTo: 450000,  dep0: 20570, dep1: 18890, dep2: 17200, dep3: 15560, dep4: 13920, dep5: 12280, dep6: 10650, dep7: 9010 },
    { salaryFrom: 450000, salaryTo: 460000,  dep0: 21450, dep1: 19770, dep2: 18090, dep3: 16440, dep4: 14800, dep5: 13160, dep6: 11530, dep7: 9890 },
    { salaryFrom: 460000, salaryTo: 470000,  dep0: 22330, dep1: 20650, dep2: 18970, dep3: 17320, dep4: 15680, dep5: 14050, dep6: 12410, dep7: 10770 },
    { salaryFrom: 470000, salaryTo: 480000,  dep0: 23210, dep1: 21530, dep2: 19850, dep3: 18200, dep4: 16560, dep5: 14930, dep6: 13290, dep7: 11660 },
    { salaryFrom: 480000, salaryTo: 490000,  dep0: 24100, dep1: 22410, dep2: 20730, dep3: 19080, dep4: 17440, dep5: 15810, dep6: 14170, dep7: 12540 },
    { salaryFrom: 490000, salaryTo: 500000,  dep0: 24980, dep1: 23290, dep2: 21610, dep3: 19960, dep4: 18320, dep5: 16690, dep6: 15050, dep7: 13420 },
    { salaryFrom: 500000, salaryTo: 510000,  dep0: 26040, dep1: 24130, dep2: 22210, dep3: 20560, dep4: 18920, dep5: 17280, dep6: 15650, dep7: 14010 },
    { salaryFrom: 510000, salaryTo: 520000,  dep0: 27020, dep1: 25100, dep2: 23190, dep3: 21540, dep4: 19900, dep5: 18260, dep6: 16630, dep7: 14990 },
    { salaryFrom: 520000, salaryTo: 530000,  dep0: 27990, dep1: 26080, dep2: 24160, dep3: 22520, dep4: 20880, dep5: 19240, dep6: 17610, dep7: 15970 },
    { salaryFrom: 530000, salaryTo: 540000,  dep0: 28960, dep1: 27050, dep2: 25140, dep3: 23490, dep4: 21860, dep5: 20220, dep6: 18580, dep7: 16950 },
    { salaryFrom: 540000, salaryTo: 550000,  dep0: 29940, dep1: 28030, dep2: 26110, dep3: 24470, dep4: 22830, dep5: 21200, dep6: 19560, dep7: 17930 },
    { salaryFrom: 550000, salaryTo: 560000,  dep0: 30920, dep1: 29000, dep2: 27090, dep3: 25450, dep4: 23810, dep5: 22170, dep6: 20540, dep7: 18900 },
    { salaryFrom: 560000, salaryTo: 570000,  dep0: 31890, dep1: 29980, dep2: 28060, dep3: 26430, dep4: 24790, dep5: 23150, dep6: 21510, dep7: 19880 },
    { salaryFrom: 570000, salaryTo: 580000,  dep0: 32860, dep1: 30950, dep2: 29040, dep3: 27400, dep4: 25770, dep5: 24130, dep6: 22490, dep7: 20860 },
    { salaryFrom: 580000, salaryTo: 590000,  dep0: 33840, dep1: 31930, dep2: 30010, dep3: 28380, dep4: 26740, dep5: 25110, dep6: 23470, dep7: 21840 },
    { salaryFrom: 590000, salaryTo: 600000,  dep0: 34820, dep1: 32900, dep2: 30990, dep3: 29360, dep4: 27720, dep5: 26080, dep6: 24450, dep7: 22810 },
  ]

  for (const row of incomeTaxRows) {
    // IncomeTaxTableには@@uniqueがないため、既存レコードを検索してupsert相当の処理を行う
    const existing = await prisma.incomeTaxTable.findFirst({
      where: {
        fiscalYear: FISCAL_YEAR,
        salaryFrom: row.salaryFrom,
        salaryTo: row.salaryTo,
      },
    })

    if (existing) {
      await prisma.incomeTaxTable.update({
        where: { id: existing.id },
        data: {
          dep0: row.dep0, dep1: row.dep1, dep2: row.dep2, dep3: row.dep3,
          dep4: row.dep4, dep5: row.dep5, dep6: row.dep6, dep7: row.dep7,
        },
      })
    } else {
      await prisma.incomeTaxTable.create({
        data: {
          fiscalYear: FISCAL_YEAR,
          salaryFrom: row.salaryFrom,
          salaryTo: row.salaryTo,
          dep0: row.dep0, dep1: row.dep1, dep2: row.dep2, dep3: row.dep3,
          dep4: row.dep4, dep5: row.dep5, dep6: row.dep6, dep7: row.dep7,
        },
      })
    }
  }
  console.log(`    ✓ 源泉徴収税額表（${incomeTaxRows.length}レンジ）`)

  console.log(`  ✓ 給与マスタデータ投入完了 (${FISCAL_YEAR}年度)`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
