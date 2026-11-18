// 隊員評価のデモデータ作成（会社コードが DEMO で始まる会社のみ）
//   node dist/scripts/seed-demo-evaluation.js DEMO001
// 隊員・取引先・現場・配員・出退勤・警備報告書・評価（本人／上司／依頼先／同僚）・指導・定期面談・申し送りを、
// 実行日を基準に過去6週間分作成し、検知と指導後の判定は本番と同じ処理（server/coaching.ts）で計算する。
// 何度実行しても、前回このスクリプトで作ったデータを消してから作り直す。氏名・会社名はすべて架空。
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import {
  CRITERION_KEYS, RATER_CRITERIA, siteEventPairs, detectSiteGaps,
  type CriterionKey, type SiteEvalPoint, type RaterType,
} from '../shared/evaluation'
import { detectSiteCoaching, detectInterviewCoaching, refreshOutcomes, loadRaterOffsets, todayJst, addDays, ymd } from '../server/coaching'

const prisma = new PrismaClient()
const PREFIX = 'DEMO-'          // デモ隊員の社員番号
const MARK = '（デモ）'          // デモの取引先・現場の名前の末尾
const DAYS = 42                 // 過去何日分作るか

// ─── 決まった乱数（毎回同じデータになるように） ───
let seed = 20261118
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rand(); return s - 3 } // 平均0・分散≒0.5
const bucket = (v: number) => (v < 2.2 ? 1 : v < 4.0 ? 3 : 5) // 現場ごとの3段階（1・3・5）
const clamp5 = (v: number) => Math.max(1, Math.min(5, Math.round(v)))

type Q = Partial<Record<CriterionKey, number>>
interface Persona {
  no: string; name: string; kana: string; base: number
  quality?: (c: CriterionKey, d: number) => number | undefined // d = 実行日からの日数（負）
  self?: (c: CriterionKey, d: number) => number | undefined
  reflection?: (d: number) => number
  startDay?: number
  lateRate?: number
}
const P: Persona[] = [
  { no: '01', name: '山田 健一', kana: 'ヤマダ ケンイチ', base: 3.1,
    quality: (c, d) => (c === 'safety' ? (d < -28 ? 1.4 : 4.4) : undefined),
    self: (c, d) => (c === 'safety' ? (d < -28 ? 5 : 4.3) : undefined) },
  { no: '02', name: '佐藤 美咲', kana: 'サトウ ミサキ', base: 4.7,
    quality: c => (c === 'teamwork' ? 4.9 : undefined),
    self: (c, d) => (c === 'teamwork' ? (d < -24 ? 1.3 : 4.7) : undefined) },
  { no: '03', name: '鈴木 大輔', kana: 'スズキ ダイスケ', base: 3.0,
    quality: c => (c === 'discipline' ? 1.2 : undefined),
    self: c => (c === 'discipline' ? 5 : undefined),
    reflection: d => (d < -22 ? 0.8 : 0.1), lateRate: 0.5 },
  { no: '04', name: '高橋 翔', kana: 'タカハシ ショウ', base: 3.1,
    quality: (c, d) => (c === 'communication' && d >= -14 ? 1.3 : undefined),
    self: (c, d) => (c === 'communication' && d >= -14 ? 5 : undefined) },
  { no: '05', name: '田中 優子', kana: 'タナカ ユウコ', base: 4.8 },
  { no: '06', name: '伊藤 拓也', kana: 'イトウ タクヤ', base: 3.0 },
  { no: '07', name: '渡辺 さくら', kana: 'ワタナベ サクラ', base: 3.1, startDay: -14 },
  { no: '08', name: '中村 誠', kana: 'ナカムラ マコト', base: 4.6 },
  { no: '09', name: '小林 勇気', kana: 'コバヤシ ユウキ', base: 3.0, lateRate: 0.3 },
  { no: '10', name: '加藤 陽菜', kana: 'カトウ ヒナ', base: 4.7 },
]
const trueQ = (p: Persona, c: CriterionKey, d: number) => p.quality?.(c, d) ?? p.base
const selfQ = (p: Persona, c: CriterionKey, d: number) => p.self?.(c, d) ?? trueQ(p, c, d)

const CLIENTS = [
  { name: `東和建設株式会社${MARK}`, kana: 'トウワケンセツ', category: 'CONSTRUCTION' as const },
  { name: `みらい都市開発株式会社${MARK}`, kana: 'ミライトシカイハツ', category: 'CONSTRUCTION' as const },
  { name: `さくら商業施設管理株式会社${MARK}`, kana: 'サクラショウギョウシセツカンリ', category: 'OTHER' as const },
]
const SITES = [
  { name: `湾岸ビル新築工事${MARK}`, address: '東京都江東区（デモ）', client: 0, signer: '青木 現場所長', start: '08:00', end: '17:00' },
  { name: `駅前再開発 道路工事${MARK}`, address: '東京都品川区（デモ）', client: 1, signer: '森 工事主任', start: '08:30', end: '17:30' },
  { name: `ショッピングモール駐車場${MARK}`, address: '東京都練馬区（デモ）', client: 2, signer: '西村 施設長', start: '10:00', end: '19:00' },
]
const WEATHER = ['晴れ', '晴れ', '曇り', '雨'] as const

async function reset(companyId: string) {
  const guards = await prisma.guard.findMany({ where: { companyId, employeeNumber: { startsWith: PREFIX } }, select: { id: true } })
  const gids = guards.map(g => g.id)
  const sites = await prisma.site.findMany({ where: { companyId, name: { endsWith: MARK } }, select: { id: true } })
  const sids = sites.map(s => s.id)
  const reports = await prisma.securityReport.findMany({ where: { companyId, OR: [{ guardId: { in: gids } }, { siteId: { in: sids } }] }, select: { id: true } })
  const rids = reports.map(r => r.id)
  await prisma.coachingTask.deleteMany({ where: { companyId, guardId: { in: gids } } })
  await prisma.confidentialNoteAccessLog.deleteMany({ where: { companyId, guardId: { in: gids } } })
  await prisma.confidentialNote.deleteMany({ where: { companyId, guardId: { in: gids } } })
  await prisma.evaluation.deleteMany({ where: { companyId, OR: [{ guardId: { in: gids } }, { securityReportId: { in: rids } }] } })
  await prisma.interview.deleteMany({ where: { companyId, guardId: { in: gids } } })
  await prisma.securityReportRevision.deleteMany({ where: { reportId: { in: rids } } })
  await prisma.securityReport.deleteMany({ where: { id: { in: rids } } })
  await prisma.attendance.deleteMany({ where: { companyId, guardId: { in: gids } } })
  await prisma.schedule.deleteMany({ where: { companyId, OR: [{ guardId: { in: gids } }, { siteId: { in: sids } }] } })
  await prisma.user.updateMany({ where: { guardId: { in: gids } }, data: { guardId: null } })
  await prisma.guard.deleteMany({ where: { id: { in: gids } } })
  await prisma.site.deleteMany({ where: { id: { in: sids } } })
  await prisma.client.deleteMany({ where: { companyId, name: { endsWith: MARK } } })
}

async function demoUser(companyId: string, code: string, key: string, name: string, role: 'ADMIN' | 'MANAGER') {
  const loginId = `${code.toLowerCase()}-${key}`
  const existing = await prisma.user.findUnique({ where: { loginId } })
  if (existing) return existing
  // 本人がログインする想定はない（パスワード未設定のまま）。評価者として記録するためのアカウント
  return prisma.user.create({ data: { companyId, loginId, name, role, password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10), mustSetPassword: true } })
}

async function main() {
  const code = (process.argv[2] || '').trim()
  if (!/^DEMO/i.test(code)) throw new Error('会社コードが DEMO で始まる会社のみ作成できます（例: DEMO001）')
  const company = await prisma.company.findFirst({ where: { code: { equals: code, mode: 'insensitive' } } })
  if (!company) throw new Error(`会社コード ${code} の会社が見つかりません`)
  const companyId = company.id
  console.log(`対象: ${company.name}（${company.code}）`)
  await reset(companyId)
  await prisma.company.update({ where: { id: companyId }, data: { evaluationEnabled: true } })

  const owner = (await prisma.user.findFirst({ where: { companyId, role: 'ADMIN', isSuperAdmin: false }, orderBy: { createdAt: 'asc' } }))
    ?? await demoUser(companyId, company.code, 'owner', '代表 デモ', 'ADMIN')
  const ota = await demoUser(companyId, company.code, 'ota', '太田 隊長', 'MANAGER')
  const ishii = await demoUser(companyId, company.code, 'ishii', '石井 主任', 'MANAGER') // 評価が甘い上司（補正の例）

  const today = todayJst()
  const day = (d: number) => addDays(today, d)
  const clients: { id: string }[] = []
  for (const c of CLIENTS) clients.push(await prisma.client.create({ data: { companyId, name: c.name, nameKana: c.kana, category: c.category } }))
  const sites: { id: string }[] = []
  for (const s of SITES) sites.push(await prisma.site.create({ data: { companyId, name: s.name, address: s.address, clientId: clients[s.client].id } }))
  const guards: { id: string }[] = []
  for (const p of P) {
    guards.push(await prisma.guard.create({
      data: { companyId, employeeNumber: PREFIX + p.no, name: p.name, nameKana: p.kana, joinedAt: day((p.startDay ?? -400) - 1), certifications: p.base >= 4 ? ['交通誘導警備業務2級'] : [] },
    }))
  }
  const gid = (i: number) => guards[i].id

  // ─── 配員・出退勤・報告書・評価（6週間） ───
  let reportCount = 0, evalCount = 0
  for (let d = -DAYS; d <= -1; d++) {
    const date = day(d)
    const available = P.map((p, i) => i).filter(i => (P[i].startDay ?? -999) <= d)
    const offset = ((d + DAYS) * 3) % available.length
    const todays = [...available.slice(offset), ...available.slice(0, offset)].slice(0, SITES.length * 2)
    for (let s = 0; s < SITES.length; s++) {
      const pair = [todays[s * 2], todays[s * 2 + 1]].filter(x => x !== undefined)
      const site = SITES[s]
      const reportIds: Record<number, string> = {}
      for (const gi of pair) {
        const p = P[gi]
        const sch = await prisma.schedule.create({ data: { companyId, guardId: gid(gi), siteId: sites[s].id, date, startTime: site.start, endTime: site.end, status: 'CONFIRMED' } })
        const late = rand() < (p.lateRate ?? 0.03)
        const inAt = new Date(`${ymd(date)}T${site.start}:00+09:00`); inAt.setMinutes(inAt.getMinutes() + (late ? 12 : -10))
        const outAt = new Date(`${ymd(date)}T${site.end}:00+09:00`); outAt.setMinutes(outAt.getMinutes() + 5)
        await prisma.attendance.create({ data: { companyId, scheduleId: sch.id, guardId: gid(gi), clockInAt: inAt, clockOutAt: outAt, breakMinutes: 60, status: late ? 'LATE' : 'COMPLETED' } })
        const signed = rand() < 0.75
        const rep = await prisma.securityReport.create({
          data: {
            companyId, guardId: gid(gi), siteId: sites[s].id, reportDate: date,
            content: { weather: WEATHER[Math.floor(rand() * WEATHER.length)], workStart: site.start, workEnd: site.end, breakMinutes: 60, patrolRecords: [], hasIncident: false, incidents: '', specialNotes: '', customFields: [] },
            submittedByName: p.name, signerName: signed ? site.signer : null, signedAt: signed ? outAt : null,
          },
        })
        reportIds[gi] = rep.id
        reportCount++
        const base = { companyId, guardId: gid(gi), securityReportId: rep.id, siteId: sites[s].id, evalDate: date }
        const scores = (rater: RaterType, f: (c: CriterionKey) => number) => Object.fromEntries(RATER_CRITERIA[rater].map(c => [c, f(c)]))
        // 本人の振り返り
        if (rand() < (p.reflection?.(d) ?? 0.9)) {
          await prisma.evaluation.create({ data: { ...base, raterType: 'SELF', raterKey: 'self', raterName: p.name, scores: scores('SELF', c => bucket(selfQ(p, c, d) + gauss() * 0.3)) } }); evalCount++
        }
        // 上司（ショッピングモールは評価が甘い石井主任）
        if (rand() < 0.85) {
          const lenient = s === 2
          const sup = lenient ? ishii : ota
          await prisma.evaluation.create({ data: { ...base, raterType: 'SUPERVISOR', raterKey: sup.id, raterUserId: sup.id, raterName: sup.name, scores: scores('SUPERVISOR', c => bucket(trueQ(p, c, d) + (lenient ? 1.2 : 0) + gauss() * 0.5)) } }); evalCount++
        }
        // 依頼先（サイン後）
        if (signed && rand() < 0.7) {
          const avg = CRITERION_KEYS.reduce((a, c) => a + trueQ(p, c, d), 0) / CRITERION_KEYS.length
          await prisma.evaluation.create({ data: { ...base, raterType: 'CLIENT', raterKey: 'client', raterName: site.signer, scores: scores('CLIENT', c => bucket(trueQ(p, c, d) + gauss() * 0.5)), repeatWish: avg >= 3.0 && rand() < 0.9 } }); evalCount++
        }
      }
      // 同僚（一緒に勤務した隊員を評価。評価した隊員の報告書に紐付く）
      if (pair.length === 2) {
        for (const [a, b] of [[pair[0], pair[1]], [pair[1], pair[0]]]) {
          if (rand() > 0.7) continue
          await prisma.evaluation.create({
            data: {
              companyId, guardId: gid(b), securityReportId: reportIds[a], siteId: sites[s].id, evalDate: date, raterType: 'PEER',
              raterKey: `${gid(a)}:${gid(b)}`, raterName: P[a].name,
              scores: Object.fromEntries(RATER_CRITERIA.PEER.map(c => [c, bucket(trueQ(P[b], c, d) + gauss() * 0.5)])),
            },
          }); evalCount++
        }
      }
    }
  }
  console.log(`報告書 ${reportCount}件・評価 ${evalCount}件`)

  // ─── 指導（山田・佐藤・鈴木）：指導前の評価から検知した根拠をつけ、指導日を過去にする ───
  const offsets = await loadRaterOffsets(prisma, companyId)
  const pointsOf = async (guardId: string): Promise<SiteEvalPoint[]> =>
    (await prisma.evaluation.findMany({ where: { companyId, guardId, interviewId: null }, select: { evalDate: true, siteId: true, raterType: true, raterKey: true, scores: true } }))
      .map(e => ({ date: ymd(e.evalDate), siteId: e.siteId, raterType: e.raterType as RaterType, raterKey: e.raterKey, scores: e.scores as Record<string, number> }))
  const coachings = [
    { gi: 0, c: 'safety' as CriterionKey, dir: 'OVER' as const, at: -28, ack: -27, commitment: '車両が見えた時点で合図を出し、声出し確認を徹底する',
      content: '「安全・業務の的確さ」について、本人の自己評価（良い）に比べ、上司・依頼先・同僚の評価が「要改善」の現場が続いています。\n具体的な場面: 車両の出入りで合図が遅れ、監督から2回指摘がありました。\n次の現場から取り組むこと: 車両が見えた時点で合図を出し、相番と声出し確認をする。' },
    { gi: 1, c: 'teamwork' as CriterionKey, dir: 'UNDER' as const, at: -24, ack: -23, commitment: '相番への声かけを続け、気づいたことは班長に伝える',
      content: '「協調性・チームワーク」について、周り（上司・依頼先・同僚）は「良い」と評価しています。自分では「要改善」と付けていますが、相番への声かけや交代の段取りは高く評価されています。自信を持って続けてください。' },
    { gi: 2, c: 'discipline' as CriterionKey, dir: 'OVER' as const, at: -22, ack: null, commitment: null,
      content: '「時間・規律」について、本人の自己評価（良い）に比べて、上司・依頼先・同僚の評価が「要改善」の現場が続いています。\n具体的な場面: 集合時間に遅れる日が続いています（出勤打刻が開始時刻より後）。\n次の現場から取り組むこと: 開始15分前に現場に着く。' },
  ]
  for (const k of coachings) {
    const before = (await pointsOf(gid(k.gi))).filter(x => x.date < ymd(day(k.at - 2)))
    const found = detectSiteGaps(before, offsets).find(g => g.criterionKey === k.c)
    const evidence = found?.evidence ?? siteEventPairs(before, k.c, offsets).filter(x => x.self != null && x.others != null).slice(0, 5)
    const gap = found?.gap ?? (evidence.length ? Math.round((evidence.reduce((a, x) => a + (x.self! - x.others!), 0) / evidence.length) * 10) / 10 : 0)
    await prisma.coachingTask.create({
      data: {
        companyId, guardId: gid(k.gi), criterionKey: k.c, direction: k.dir, gap, trigger: 'SITE', evidence: evidence as object[],
        detectedAt: day(k.at - 2), dueDate: day(k.at + 5), status: 'COACHED',
        coachedAt: day(k.at), coachUserId: ota.id, coachName: ota.name, method: '面談', content: k.content, followUpDate: day(k.at + 30),
        acknowledgedAt: k.ack != null ? new Date(day(k.ack).getTime() + 10 * 3600_000) : null, guardCommitment: k.commitment,
      },
    })
  }
  for (const gi of [0, 1, 2]) await refreshOutcomes(prisma, companyId, gid(gi))
  // 改善した2人は上司が結果を確定（鈴木はシステムの判定のまま確定待ち）
  for (const gi of [0, 1]) {
    const t = await prisma.coachingTask.findFirst({ where: { companyId, guardId: gid(gi) } })
    if (t?.outcomeVerdict === 'IMPROVED' || t?.outcomeVerdict === 'CONTINUE') {
      await prisma.coachingTask.update({ where: { id: t.id }, data: { status: 'CLOSED', confirmedVerdict: t.outcomeVerdict, confirmedNote: t.outcomeVerdict === 'IMPROVED' ? '指導後、周りの評価が上がり、本人の自己評価も現実に近づいた' : null, confirmedByUserId: ota.id, confirmedByName: ota.name, confirmedAt: day(-2) } })
    }
  }

  // ─── 定期面談 ───
  const interviewEval = async (ivId: string, guardId: string, date: Date, rater: 'SELF' | 'MANAGEMENT', scores: Q, name: string, key: string) =>
    prisma.evaluation.create({ data: { companyId, guardId, interviewId: ivId, evalDate: date, raterType: rater, raterKey: key, raterName: name, scores } })
  const full = (v: number, over: Q = {}) => ({ ...Object.fromEntries(CRITERION_KEYS.map(c => [c, v])), ...over }) as Q
  {
    const iv = await prisma.interview.create({ data: { companyId, guardId: gid(0), scheduledDate: day(-30), periodFrom: day(-120), periodTo: day(-30), interviewerUserId: owner.id, interviewerName: owner.name, status: 'COMPLETED', completedAt: day(-30), guardWish: '交通誘導2級を取りたい', goal: '現場ごとの安全確認を声に出して行う', managementComment: '安全面の自己評価が高すぎる。指導で様子を見る' } })
    await interviewEval(iv.id, gid(0), day(-30), 'SELF', full(4, { safety: 5 }), P[0].name, 'self')
    await interviewEval(iv.id, gid(0), day(-30), 'MANAGEMENT', full(4, { safety: 2 }), owner.name, owner.id)
  }
  {
    const iv = await prisma.interview.create({ data: { companyId, guardId: gid(2), scheduledDate: day(-8), periodFrom: day(-98), periodTo: day(-8), interviewerUserId: owner.id, interviewerName: owner.name, status: 'COMPLETED', guardWish: '夜勤を増やしたい', goal: '開始15分前の到着を毎回守る', managementComment: '指導後も遅刻が続いている。本人の受け止めが弱い' } })
    await interviewEval(iv.id, gid(2), day(-8), 'SELF', full(4, { discipline: 5, initiative: 5 }), P[2].name, 'self')
    await interviewEval(iv.id, gid(2), day(-8), 'MANAGEMENT', full(3, { discipline: 1, initiative: 2 }), owner.name, owner.id)
    await prisma.interview.update({ where: { id: iv.id }, data: { completedAt: day(-8) } })
    await detectInterviewCoaching(prisma, companyId, { id: iv.id, guardId: gid(2), scheduledDate: day(-8) })
  }
  {
    const iv = await prisma.interview.create({ data: { companyId, guardId: gid(4), scheduledDate: day(6), periodFrom: day(-84), periodTo: day(6), interviewerUserId: owner.id, interviewerName: owner.name, guardWish: '隊長を目指したい。後輩の指導もしてみたい' } })
    await interviewEval(iv.id, gid(4), day(6), 'SELF', full(4, { manner: 5, teamwork: 5 }), P[4].name, 'self')
  }
  await prisma.interview.create({ data: { companyId, guardId: gid(5), scheduledDate: day(10), periodFrom: day(-80), periodTo: day(10), interviewerUserId: owner.id, interviewerName: owner.name } })

  // ─── 申し送り ───
  await prisma.confidentialNote.create({ data: { companyId, guardId: gid(2), authorUserId: ota.id, authorName: ota.name, tags: ['顧客クレーム'], body: `${ymd(day(-12))} 湾岸ビルの青木所長から、集合時間の遅れについて連絡あり。本人には面談で伝える。` } })
  await prisma.confidentialNote.create({ data: { companyId, guardId: gid(8), authorUserId: ota.id, authorName: ota.name, tags: ['体調'], body: '腰痛のため長時間の立哨が続く現場は避けたいと相談あり。配員で考慮する。' } })

  // ─── 最後に全員の検知と判定を、本番と同じ処理で更新 ───
  for (const g of guards) await detectSiteCoaching(prisma, companyId, g.id)
  const tasks = await prisma.coachingTask.findMany({ where: { companyId, guardId: { in: guards.map(g => g.id) } }, include: { guard: { select: { name: true } } }, orderBy: { detectedAt: 'asc' } })
  for (const t of tasks) console.log(`指導: ${t.guard.name} ${t.criterionKey} ${t.direction} ${t.status} 判定=${t.outcomeVerdict ?? '-'} 確定=${t.confirmedVerdict ?? '-'}`)
  console.log('完了')
}

main().then(() => prisma.$disconnect()).catch(async e => { console.error(e.message || e); await prisma.$disconnect(); process.exit(1) })
