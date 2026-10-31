import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const COMPANY_ID = '52af056f-31df-4d6e-976e-62fe7f475317' // 株式会社デモ警備

async function main() {
  console.log('サンプルデータ投入開始...')

  // ─── 既存データのクリーンアップ（関連テーブルの順序に注意）───
  console.log('  既存データをクリーンアップ中...')
  await prisma.guardCompatibility.deleteMany({ where: { companyId: COMPANY_ID } })
  await prisma.schedule.deleteMany({ where: { companyId: COMPANY_ID } })
  await prisma.attendance.deleteMany({ where: { companyId: COMPANY_ID } })
  await prisma.contract.deleteMany({ where: { companyId: COMPANY_ID } })
  await prisma.vehicle.deleteMany({ where: { companyId: COMPANY_ID } })
  await prisma.guard.deleteMany({ where: { companyId: COMPANY_ID } })
  await prisma.site.deleteMany({ where: { companyId: COMPANY_ID } })
  await prisma.client.deleteMany({ where: { companyId: COMPANY_ID } })
  console.log('  クリーンアップ完了')

  // ─── 取引先（Client）───
  const clients = await Promise.all([
    prisma.client.create({
      data: {
        companyId: COMPANY_ID, name: '大成建設株式会社', nameKana: 'タイセイケンセツ',
        contactName: '山田太郎', phone: '03-1234-5678', email: 'yamada@taisei.example.jp',
        prefecture: '東京都', city: '新宿区', addressDetail: '西新宿1-25-1', postalCode: '163-0606',
        notes: '大手ゼネコン。月間10現場以上の取引あり', isActive: true,
      },
    }),
    prisma.client.create({
      data: {
        companyId: COMPANY_ID, name: '鹿島建設株式会社', nameKana: 'カジマケンセツ',
        contactName: '佐藤花子', phone: '03-2345-6789', email: 'sato@kajima.example.jp',
        prefecture: '東京都', city: '港区', addressDetail: '元赤坂1-3-1', postalCode: '107-8388',
        notes: '大型現場が多い', isActive: true,
      },
    }),
    prisma.client.create({
      data: {
        companyId: COMPANY_ID, name: '株式会社竹中工務店', nameKana: 'タケナカコウムテン',
        contactName: '田中一郎', phone: '06-6252-1201', email: 'tanaka@takenaka.example.jp',
        prefecture: '大阪府', city: '大阪市中央区', addressDetail: '本町4-1-13', postalCode: '541-0053',
        notes: '関西エリア中心', isActive: true,
      },
    }),
    prisma.client.create({
      data: {
        companyId: COMPANY_ID, name: 'ABCイベント株式会社', nameKana: 'エービーシーイベント',
        contactName: '鈴木次郎', phone: '03-9876-5432', email: 'suzuki@abc-event.example.jp',
        prefecture: '東京都', city: '渋谷区', addressDetail: '神宮前3-1-1', postalCode: '150-0001',
        notes: 'イベント警備が多い。土日祝メイン', isActive: true,
      },
    }),
    prisma.client.create({
      data: {
        companyId: COMPANY_ID, name: '東京都市開発株式会社', nameKana: 'トウキョウトシカイハツ',
        contactName: '高橋美咲', phone: '03-5555-1234', email: 'takahashi@toshikaihatsu.example.jp',
        prefecture: '東京都', city: '千代田区', addressDetail: '丸の内1-1-1', postalCode: '100-0005',
        notes: '再開発プロジェクト多数', isActive: true,
      },
    }),
  ])
  console.log(`  取引先: ${clients.length}件作成`)

  // ─── 現場（Site）───
  const sites = await Promise.all([
    prisma.site.create({
      data: {
        companyId: COMPANY_ID, clientId: clients[0].id, name: '新宿駅前再開発工事',
        address: '東京都新宿区西新宿1丁目', lat: 35.6896, lng: 139.6997,
        clientName: '大成建設株式会社', requiredCount: 4, requiredQualifiedA: 1,
        defaultStartTime: '08:00', defaultEndTime: '17:00', assemblyTime: '07:30',
        assemblyPlace: '現場事務所前', cautions: '車両出入り多し。交通誘導に注意', isActive: true,
      },
    }),
    prisma.site.create({
      data: {
        companyId: COMPANY_ID, clientId: clients[0].id, name: '渋谷スクランブル跡地ビル建設',
        address: '東京都渋谷区道玄坂2丁目', lat: 35.6580, lng: 139.7016,
        clientName: '大成建設株式会社', requiredCount: 3, requiredQualifiedA: 1,
        defaultStartTime: '08:00', defaultEndTime: '17:00', assemblyTime: '07:45',
        assemblyPlace: 'A棟入口', cautions: '歩行者が非常に多い。声掛け重要', isActive: true,
      },
    }),
    prisma.site.create({
      data: {
        companyId: COMPANY_ID, clientId: clients[1].id, name: '品川駅南口再開発',
        address: '東京都港区港南2丁目', lat: 35.6284, lng: 139.7387,
        clientName: '鹿島建設株式会社', requiredCount: 5, requiredQualifiedA: 2,
        defaultStartTime: '07:30', defaultEndTime: '16:30', assemblyTime: '07:00',
        assemblyPlace: '南口ロータリー前', cautions: '大型車両多数。必ずヘルメット着用', isActive: true,
      },
    }),
    prisma.site.create({
      data: {
        companyId: COMPANY_ID, clientId: clients[1].id, name: '豊洲マンション建設現場',
        address: '東京都江東区豊洲3丁目', lat: 35.6531, lng: 139.7967,
        clientName: '鹿島建設株式会社', requiredCount: 2, requiredQualifiedA: 0,
        defaultStartTime: '08:30', defaultEndTime: '17:30', assemblyTime: '08:00',
        assemblyPlace: '正面ゲート', cautions: '住宅地隣接。騒音注意', isActive: true,
      },
    }),
    prisma.site.create({
      data: {
        companyId: COMPANY_ID, clientId: clients[3].id, name: '代々木公園イベント会場',
        address: '東京都渋谷区代々木神園町2', lat: 35.6717, lng: 139.6949,
        clientName: 'ABCイベント株式会社', requiredCount: 6, requiredQualifiedA: 0,
        defaultStartTime: '09:00', defaultEndTime: '21:00', assemblyTime: '08:30',
        assemblyPlace: '南門入口', cautions: '来場者誘導。雑踏警備経験者推奨', isActive: true,
      },
    }),
    prisma.site.create({
      data: {
        companyId: COMPANY_ID, clientId: clients[4].id, name: '丸の内オフィスビル改修',
        address: '東京都千代田区丸の内2-4-1', lat: 35.6812, lng: 139.7649,
        clientName: '東京都市開発株式会社', requiredCount: 2, requiredQualifiedA: 1,
        defaultStartTime: '20:00', defaultEndTime: '06:00', assemblyTime: '19:30',
        assemblyPlace: 'B1F搬入口', cautions: '夜間工事。近隣テナントへの配慮必須', isActive: true,
      },
    }),
    prisma.site.create({
      data: {
        companyId: COMPANY_ID, clientId: clients[2].id, name: '横浜みなとみらい商業施設',
        address: '神奈川県横浜市西区みなとみらい2丁目', lat: 35.4577, lng: 139.6327,
        clientName: '株式会社竹中工務店', requiredCount: 3, requiredQualifiedA: 1,
        defaultStartTime: '08:00', defaultEndTime: '17:00', assemblyTime: '07:30',
        assemblyPlace: '現場入口ゲート', cautions: '観光客多い。丁寧な対応を', isActive: true,
      },
    }),
  ])
  console.log(`  現場: ${sites.length}件作成`)

  // ─── 隊員（Guard）───
  const guardsData = [
    { employeeNumber: 'G001', name: '佐藤健太', nameKana: 'サトウケンタ', gender: 'MALE', phone: '090-1111-0001',
      prefecture: '東京都', city: '新宿区', addressDetail: '西新宿3-1-1', lat: 35.6890, lng: 139.6920,
      certifications: ['交通誘導警備業務検定1級'], guardClass: 'S', skills: ['隊長', '方交'], overallRating: 5,
      employmentType: 'FULL_TIME', dayShiftRate: 13000, nightShiftRate: 15000, payType: 'DAY',
      workConditions: { preferredDays: ['月', '火', '水', '木', '金'], maxHours: 10 },
      notes: 'ベテラン。どの現場でも安定した仕事ぶり' },
    { employeeNumber: 'G002', name: '田中誠', nameKana: 'タナカマコト', gender: 'MALE', phone: '090-1111-0002',
      prefecture: '東京都', city: '渋谷区', addressDetail: '道玄坂1-2-3', lat: 35.6585, lng: 139.7005,
      certifications: ['交通誘導警備業務検定2級'], guardClass: 'A', skills: ['方交'], overallRating: 4,
      employmentType: 'FULL_TIME', dayShiftRate: 12000, nightShiftRate: 14000, payType: 'DAY',
      workConditions: { preferredDays: ['月', '火', '水', '木', '金'] },
      notes: '渋谷周辺の現場に強い' },
    { employeeNumber: 'G003', name: '鈴木大輔', nameKana: 'スズキダイスケ', gender: 'MALE', phone: '090-1111-0003',
      prefecture: '東京都', city: '品川区', addressDetail: '大井町1-5-10', lat: 35.6070, lng: 139.7345,
      certifications: ['交通誘導警備業務検定2級', '施設警備業務検定2級'], guardClass: 'A', skills: ['隊長', '方交'], overallRating: 4,
      employmentType: 'FULL_TIME', dayShiftRate: 12500, nightShiftRate: 14500, payType: 'DAY',
      workConditions: { preferredDays: ['月', '火', '水', '木', '金', '土'] },
      notes: '資格複数保有。現場のまとめ役' },
    { employeeNumber: 'G004', name: '山本翔太', nameKana: 'ヤマモトショウタ', gender: 'MALE', phone: '090-1111-0004',
      prefecture: '東京都', city: '江東区', addressDetail: '豊洲4-10-1', lat: 35.6530, lng: 139.7950,
      certifications: [], guardClass: 'B', skills: ['方交'], overallRating: 3,
      employmentType: 'PART_TIME', dayShiftRate: 11000, nightShiftRate: 13000, payType: 'DAY',
      workConditions: { preferredDays: ['月', '水', '金', '土', '日'] },
      notes: '豊洲周辺居住。地元現場に配置推奨' },
    { employeeNumber: 'G005', name: '高橋真由美', nameKana: 'タカハシマユミ', gender: 'FEMALE', phone: '090-1111-0005',
      prefecture: '東京都', city: '世田谷区', addressDetail: '三軒茶屋2-1-1', lat: 35.6437, lng: 139.6713,
      certifications: ['施設警備業務検定2級'], guardClass: 'B', skills: [], overallRating: 3,
      employmentType: 'PART_TIME', dayShiftRate: 11000, nightShiftRate: 13000, payType: 'DAY',
      workConditions: { preferredDays: ['火', '木', '土'] },
      notes: '施設警備経験豊富。イベント対応可' },
    { employeeNumber: 'G006', name: '伊藤慎一', nameKana: 'イトウシンイチ', gender: 'MALE', phone: '090-1111-0006',
      prefecture: '東京都', city: '港区', addressDetail: '芝公園4-2-8', lat: 35.6556, lng: 139.7472,
      certifications: ['交通誘導警備業務検定1級'], guardClass: 'A', skills: ['隊長', '方交'], overallRating: 5,
      employmentType: 'FULL_TIME', dayShiftRate: 13000, nightShiftRate: 15000, payType: 'DAY',
      workConditions: { preferredDays: ['月', '火', '水', '木', '金'] },
      notes: '大型現場経験多数。リーダーシップあり' },
    { employeeNumber: 'G007', name: '渡辺拓海', nameKana: 'ワタナベタクミ', gender: 'MALE', phone: '090-1111-0007',
      prefecture: '東京都', city: '中野区', addressDetail: '中野5-1-1', lat: 35.7054, lng: 139.6638,
      certifications: [], guardClass: 'C', skills: [], overallRating: 2,
      employmentType: 'PART_TIME', dayShiftRate: 10500, nightShiftRate: 12500, payType: 'DAY',
      workConditions: { preferredDays: ['月', '火', '水', '木', '金', '土', '日'] },
      notes: '新人。研修中。佐藤(G001)との組み合わせ推奨' },
    { employeeNumber: 'G008', name: '小林美咲', nameKana: 'コバヤシミサキ', gender: 'FEMALE', phone: '090-1111-0008',
      prefecture: '東京都', city: '目黒区', addressDetail: '自由が丘1-8-2', lat: 35.6085, lng: 139.6680,
      certifications: ['雑踏警備業務検定2級'], guardClass: 'B', skills: [], overallRating: 3,
      employmentType: 'PART_TIME', dayShiftRate: 11500, nightShiftRate: 13500, payType: 'DAY',
      workConditions: { preferredDays: ['土', '日'] },
      notes: '土日メインのシフト希望。イベント警備得意' },
    { employeeNumber: 'G009', name: '中村健一', nameKana: 'ナカムラケンイチ', gender: 'MALE', phone: '090-1111-0009',
      prefecture: '神奈川県', city: '横浜市西区', addressDetail: 'みなとみらい1-1-1', lat: 35.4585, lng: 139.6330,
      certifications: ['交通誘導警備業務検定2級'], guardClass: 'A', skills: ['方交'], overallRating: 4,
      employmentType: 'FULL_TIME', dayShiftRate: 12000, nightShiftRate: 14000, payType: 'DAY',
      workConditions: { preferredDays: ['月', '火', '水', '木', '金'] },
      notes: '横浜エリア担当。みなとみらい現場に最適' },
    { employeeNumber: 'G010', name: '加藤龍之介', nameKana: 'カトウリュウノスケ', gender: 'MALE', phone: '090-1111-0010',
      prefecture: '東京都', city: '千代田区', addressDetail: '丸の内1-1-1', lat: 35.6815, lng: 139.7660,
      certifications: ['交通誘導警備業務検定1級', '施設警備業務検定1級'], guardClass: 'S', skills: ['隊長', '方交'], overallRating: 5,
      employmentType: 'FULL_TIME', dayShiftRate: 14000, nightShiftRate: 16000, payType: 'DAY',
      workConditions: { preferredDays: ['月', '火', '水', '木', '金'] },
      notes: '最上位資格保有。夜間工事の隊長経験多数' },
    { employeeNumber: 'G011', name: 'グエン・バン・ミン', nameKana: 'グエンバンミン', gender: 'MALE', phone: '090-1111-0011',
      prefecture: '東京都', city: '足立区', addressDetail: '千住1-3-5', lat: 35.7497, lng: 139.8049,
      certifications: [], guardClass: 'C', skills: [], overallRating: 2, nationality: 'ベトナム',
      employmentType: 'PART_TIME', dayShiftRate: 10500, nightShiftRate: 12500, payType: 'DAY',
      residenceStatus: '特定技能', weeklyHoursLimit: 40,
      workConditions: { preferredDays: ['月', '火', '水', '木', '金'] },
      notes: '日本語N3レベル。真面目で遅刻なし' },
    { employeeNumber: 'G012', name: '松田一馬', nameKana: 'マツダカズマ', gender: 'MALE', phone: '090-1111-0012',
      prefecture: '東京都', city: '板橋区', addressDetail: '大山町10-5', lat: 35.7510, lng: 139.7057,
      certifications: ['交通誘導警備業務検定2級'], guardClass: 'B', skills: ['方交'], overallRating: 3,
      employmentType: 'FULL_TIME', dayShiftRate: 11500, nightShiftRate: 13500, payType: 'DAY',
      workConditions: { preferredDays: ['月', '火', '水', '木', '金', '土'] },
      notes: '協調性あり。チームワーク重視' },
  ]

  const guards = []
  for (const g of guardsData) {
    const guard = await prisma.guard.create({
      data: {
        companyId: COMPANY_ID,
        employeeNumber: g.employeeNumber,
        name: g.name,
        nameKana: g.nameKana,
        gender: g.gender as any,
        phone: g.phone,
        prefecture: g.prefecture,
        city: g.city,
        addressDetail: g.addressDetail,
        lat: g.lat,
        lng: g.lng,
        certifications: g.certifications,
        guardClass: g.guardClass,
        skills: g.skills,
        overallRating: g.overallRating,
        employmentType: g.employmentType as any,
        dayShiftRate: g.dayShiftRate,
        nightShiftRate: g.nightShiftRate,
        payType: g.payType,
        workConditions: g.workConditions as any,
        nationality: g.nationality || null,
        residenceStatus: (g as any).residenceStatus || null,
        weeklyHoursLimit: (g as any).weeklyHoursLimit || null,
        notes: g.notes,
        isActive: true,
      },
    })
    guards.push(guard)
  }
  console.log(`  隊員: ${guards.length}件作成`)

  // ─── 相性設定（GuardCompatibility）───
  const compatData = [
    // GOOD: 一緒に組むと良い
    { guardIdx: 0, targetIdx: 2, type: 'GOOD', reason: 'ベテラン同士。連携が抜群' },         // 佐藤 ↔ 鈴木
    { guardIdx: 0, targetIdx: 6, type: 'GOOD', reason: '佐藤がメンター。新人教育に最適' },     // 佐藤 ↔ 渡辺
    { guardIdx: 5, targetIdx: 9, type: 'GOOD', reason: '大型現場のコンビ。息が合う' },         // 伊藤 ↔ 加藤
    { guardIdx: 1, targetIdx: 7, type: 'GOOD', reason: '渋谷エリアで何度も一緒。チームワーク良好' }, // 田中 ↔ 小林
    { guardIdx: 3, targetIdx: 10, type: 'GOOD', reason: '山本が面倒見良く、グエンの日本語サポート' }, // 山本 ↔ グエン

    // BAD: なるべく避けたい
    { guardIdx: 1, targetIdx: 3, type: 'BAD', reason: '過去に口論あり。極力別現場に' },        // 田中 ↔ 山本
    { guardIdx: 6, targetIdx: 11, type: 'BAD', reason: '性格が合わない。作業効率が落ちる' },    // 渡辺 ↔ 松田

    // NG: 絶対に同じ現場に配置不可
    { guardIdx: 2, targetIdx: 5, type: 'NG', reason: '過去のトラブルにより配置不可（管理者判断）' }, // 鈴木 ↔ 伊藤
    { guardIdx: 4, targetIdx: 7, type: 'NG', reason: '私的関係のトラブル。同一現場禁止' },     // 高橋 ↔ 小林
  ]

  for (const c of compatData) {
    await prisma.guardCompatibility.create({
      data: {
        companyId: COMPANY_ID,
        guardId: guards[c.guardIdx].id,
        targetGuardId: guards[c.targetIdx].id,
        type: c.type as any,
        reason: c.reason,
      },
    })
  }
  console.log(`  相性設定: ${compatData.length}件作成`)

  // ─── 契約（Contract）───
  const USER_ID = '872bf72f-bae8-42d6-bfb6-30f48baca455'
  const contractsData = [
    { siteIdx: 0, clientName: '大成建設株式会社', unitPrice: 13000, guardCount: 4, num: 'CT-2026-001' },
    { siteIdx: 1, clientName: '大成建設株式会社', unitPrice: 12500, guardCount: 3, num: 'CT-2026-002' },
    { siteIdx: 2, clientName: '鹿島建設株式会社', unitPrice: 14000, guardCount: 5, num: 'CT-2026-003' },
    { siteIdx: 3, clientName: '鹿島建設株式会社', unitPrice: 11000, guardCount: 2, num: 'CT-2026-004' },
    { siteIdx: 4, clientName: 'ABCイベント株式会社', unitPrice: 12000, guardCount: 6, num: 'CT-2026-005' },
    { siteIdx: 5, clientName: '東京都市開発株式会社', unitPrice: 15000, guardCount: 2, num: 'CT-2026-006' },
    { siteIdx: 6, clientName: '株式会社竹中工務店', unitPrice: 13000, guardCount: 3, num: 'CT-2026-007' },
  ]

  for (const c of contractsData) {
    await prisma.contract.create({
      data: {
        companyId: COMPANY_ID,
        siteId: sites[c.siteIdx].id,
        contractNumber: c.num,
        clientName: c.clientName,
        startDate: new Date('2026-07-01'),
        endDate: new Date('2026-12-31'),
        unitPrice: c.unitPrice,
        guardCount: c.guardCount,
        status: 'ACTIVE',
        createdById: USER_ID,
      },
    })
  }
  console.log(`  契約: ${contractsData.length}件作成`)

  // ─── 車両（Vehicle）───
  const vehiclesData = [
    { plateNumber: '品川 300 あ 1234', model: 'ハイエース（機材搬送用）', year: 2024 },
    { plateNumber: '品川 500 い 5678', model: 'プリウス（巡回用）', year: 2025 },
    { plateNumber: '品川 480 う 9012', model: 'N-VAN（コーン搬送用）', year: 2023 },
  ]

  for (const v of vehiclesData) {
    await prisma.vehicle.create({
      data: {
        companyId: COMPANY_ID,
        plateNumber: v.plateNumber,
        model: v.model,
        year: v.year,
        isActive: true,
      },
    })
  }
  console.log(`  車両: ${vehiclesData.length}件作成`)

  // ─── スケジュール（本日・明日・明後日分）───
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const dayAfter = new Date(today)
  dayAfter.setDate(dayAfter.getDate() + 2)

  const scheduleData = [
    // 今日: 新宿駅前 → 佐藤, 田中（一部配置済み）
    { date: today, siteIdx: 0, guardIdx: 0, startTime: '08:00', endTime: '17:00', status: 'CONFIRMED' },
    { date: today, siteIdx: 0, guardIdx: 1, startTime: '08:00', endTime: '17:00', status: 'ASSIGNED' },
    // 今日: 品川駅南口 → 鈴木, 伊藤
    { date: today, siteIdx: 2, guardIdx: 2, startTime: '07:30', endTime: '16:30', status: 'CONFIRMED' },
    { date: today, siteIdx: 2, guardIdx: 5, startTime: '07:30', endTime: '16:30', status: 'ASSIGNED' },
    // 明日: いくつか配置（自動配置テスト用に未充足を残す）
    { date: tomorrow, siteIdx: 0, guardIdx: 0, startTime: '08:00', endTime: '17:00', status: 'ASSIGNED' },
    { date: tomorrow, siteIdx: 2, guardIdx: 5, startTime: '07:30', endTime: '16:30', status: 'ASSIGNED' },
    // 明後日: 空（自動配置テストに最適）
  ]

  let schedCount = 0
  for (const s of scheduleData) {
    await prisma.schedule.create({
      data: {
        companyId: COMPANY_ID,
        date: s.date,
        siteId: sites[s.siteIdx].id,
        guardId: guards[s.guardIdx].id,
        startTime: s.startTime,
        endTime: s.endTime,
        status: s.status as any,
        shiftType: s.startTime >= '18:00' ? 'NIGHT' : 'DAY',
      },
    })
    schedCount++
  }
  console.log(`  スケジュール: ${schedCount}件作成`)

  // ─── サマリー ───
  console.log('\n=== サンプルデータ投入完了 ===')
  console.log(`  取引先:     ${clients.length}社`)
  console.log(`  現場:       ${sites.length}件`)
  console.log(`  隊員:       ${guards.length}名`)
  console.log(`  相性設定:   ${compatData.length}件 (GOOD:5, BAD:2, NG:2)`)
  console.log(`  契約:       ${contractsData.length}件`)
  console.log(`  車両:       ${vehiclesData.length}台`)
  console.log(`  スケジュール: ${schedCount}件`)
  console.log('\n自動配置テスト手順:')
  console.log(`  1. 管制マップ画面で明後日(${dayAfter.toISOString().split('T')[0]})を選択`)
  console.log('  2. 全現場が未充足の状態。「最適化」ボタンで自動配置を実行')
  console.log('  3. 相性NG（鈴木↔伊藤, 高橋↔小林）が同じ現場に配置されないことを確認')
  console.log('  4. 相性GOOD（佐藤↔渡辺, 伊藤↔加藤等）が同じ現場に配置される傾向を確認')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
