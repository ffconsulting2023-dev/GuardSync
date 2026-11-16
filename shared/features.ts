// 利用者ごとに使える機能 SSOT（ID発行・アカウント編集で選び、サイドメニュー・隊員アプリ・API の制限に使う）
// User.disabledFeatures に「使えなくした機能のキー」を保存する。既定は空（ロールで使える機能はすべて使える）。
// ロールによる制限（管理者のみの画面など）はこれとは別に従来どおりかかる。

export type FeatureMethod = 'all' | 'write' // write = GET 以外（一覧・参照は他の画面と共用のため止めない）
export interface ApiRule { pattern: RegExp; methods: FeatureMethod }
export interface FeatureDef {
  key: string
  label: string
  group: string
  path?: string        // 管理画面の画面パス（サイドメニュー・直接アクセスの制限）
  guardTab?: string    // 隊員アプリのタブ
  api: ApiRule[]       // その機能だけが使う API（他の画面と共用の参照系は含めない）
}

const all = (pattern: RegExp): ApiRule => ({ pattern, methods: 'all' })
const write = (pattern: RegExp): ApiRule => ({ pattern, methods: 'write' })

// ─── 管理画面（隊員以外のロール） ───
export const ADMIN_FEATURES: FeatureDef[] = [
  { key: 'guards', label: '隊員管理', group: '人事管理', path: '/guards', api: [write(/^\/api\/guards(?!\/[^/]+\/(my-number|evaluations|confidential-notes))/)] },
  { key: 'partners', label: '協力会社', group: '人事管理', path: '/partners', api: [write(/^\/api\/partners/)] },
  { key: 'recruitmentReport', label: '採用経路別 稼働実績', group: '人事管理', path: '/recruitment-report', api: [all(/^\/api\/recruitment\/report/)] },
  {
    key: 'evaluations', label: '隊員評価', group: '人事管理', path: '/evaluations',
    api: [
      all(/^\/api\/evaluations\/(pending|growth|counts)/), all(/^\/api\/guards\/[^/]+\/(evaluations|confidential-notes)/), all(/^\/api\/confidential-notes/),
      all(/^\/api\/coaching-tasks(?!\/[^/]+\/acknowledge)/), all(/^\/api\/interviews(?!\/[^/]+\/self)/),
      write(/^\/api\/security-reports\/[^/]+\/evaluations\/supervisor/),
    ],
  },
  { key: 'vehicles', label: '車両管理', group: '人事管理', path: '/vehicles', api: [all(/^\/api\/vehicles/)] },
  { key: 'equipment', label: '備品管理', group: '人事管理', path: '/equipment', api: [all(/^\/api\/equipment/)] },
  { key: 'schedule', label: '管制・配員', group: '勤怠管理', path: '/schedule', api: [all(/^\/api\/schedules\/(monthly|dispatch-board)/)] },
  { key: 'attendance', label: '出退勤', group: '勤怠管理', path: '/attendance', api: [write(/^\/api\/attendance/)] },
  { key: 'dispatch', label: '管制', group: '勤怠管理', path: '/dispatch', api: [all(/^\/api\/dispatch\/(attendance$|\d{4}-\d{2}-\d{2})/)] },
  { key: 'dispatchMap', label: '配置マップ', group: '勤怠管理', path: '/dispatch-map', api: [all(/^\/api\/dispatch\/map-data/)] },
  { key: 'shiftSurveys', label: 'シフト調査', group: '勤怠管理', path: '/shift-surveys', api: [all(/^\/api\/shift-surveys/)] },
  { key: 'payroll', label: '給与管理', group: '給与計算', path: '/payroll', api: [all(/^\/api\/(payroll|bonus-payroll|year-end-adjustment)/)] },
  { key: 'dailyPay', label: '日払い', group: '給与計算', path: '/daily-pay', api: [all(/^\/api\/daily-pay/)] },
  { key: 'insuranceRates', label: '社保マスタ', group: '社会保険事務', path: '/insurance-rates', api: [all(/^\/api\/admin\/(master-data|import)/), all(/^\/api\/insurance/)] },
  { key: 'residentTax', label: '住民税', group: '社会保険事務', path: '/resident-tax', api: [all(/^\/api\/admin\/resident-tax/)] },
  { key: 'myNumber', label: 'マイナンバー', group: '社会保険事務', path: '/my-number', api: [all(/^\/api\/my-number/), all(/^\/api\/guards\/[^/]+\/my-number/)] },
  { key: 'clients', label: '取引先', group: '取引管理', path: '/clients', api: [write(/^\/api\/clients/)] },
  { key: 'sites', label: '現場管理', group: '取引管理', path: '/sites', api: [write(/^\/api\/sites/)] },
  { key: 'siteRequests', label: '受注実績', group: '取引管理', path: '/site-requests', api: [all(/^\/api\/site-requests/)] },
  { key: 'contracts', label: '契約管理', group: '取引管理', path: '/contracts', api: [write(/^\/api\/contracts/)] },
  { key: 'invoices', label: '請求管理', group: '取引管理', path: '/invoices', api: [all(/^\/api\/invoices/)] },
  { key: 'subcontractorPayments', label: '支払管理', group: '取引管理', path: '/subcontractor-payments', api: [all(/^\/api\/subcontractor-payments/)] },
  { key: 'eContracts', label: '電子契約', group: '取引管理', path: '/e-contracts', api: [all(/^\/api\/e-contracts(?!\/sign\/)/)] },
  { key: 'reports', label: '警備報告書', group: 'その他', path: '/reports', api: [write(/^\/api\/security-reports(?!\/[^/]+\/evaluations\/supervisor)/)] },
  { key: 'notifications', label: '通知管理', group: 'その他', path: '/notifications', api: [all(/^\/api\/notifications/)] },
  { key: 'autoReceipts', label: '自動受付', group: 'その他', path: '/auto-receipts', api: [all(/^\/api\/auto-receipts/)] },
  { key: 'import', label: 'データ取り込み', group: 'その他', path: '/import', api: [all(/^\/api\/import/)] },
]

// ─── 隊員アプリ（隊員ロール） ───
export const GUARD_FEATURES: FeatureDef[] = [
  { key: 'guard.schedule', label: 'シフトの確認', group: '隊員アプリ', guardTab: 'schedule', api: [] },
  { key: 'guard.attendance', label: '出退勤の打刻', group: '隊員アプリ', guardTab: 'attendance', api: [all(/^\/api\/attendance\/clock-(in|out)/)] },
  { key: 'guard.reports', label: '警備報告書の提出・監督サイン', group: '隊員アプリ', guardTab: 'reports', api: [write(/^\/api\/security-reports(?!\/[^/]+\/(evaluations|peers))/)] },
  {
    key: 'guard.evaluation', label: '評価（振り返り・同僚評価・面談・指導・成長スコア）', group: '隊員アプリ',
    api: [
      all(/^\/api\/security-reports\/[^/]+\/(evaluations\/(self|client|peer)|peers)/), all(/^\/api\/evaluations\/mine/),
      all(/^\/api\/guard-app\/(interviews|coaching|my-score)/), all(/^\/api\/interviews\/[^/]+\/self/), all(/^\/api\/coaching-tasks\/[^/]+\/acknowledge/),
    ],
  },
]

// ダッシュボード・設定は常に使える（自分で設定画面に入れなくなるのを防ぐ）
export const ALWAYS_AVAILABLE_PATHS = ['/', '/settings']

export const isGuardRole = (role: string) => role === 'GUARD'
export const featuresForRole = (role: string): FeatureDef[] => (isGuardRole(role) ? GUARD_FEATURES : ADMIN_FEATURES)
export const ALL_FEATURE_KEYS = [...ADMIN_FEATURES, ...GUARD_FEATURES].map(f => f.key)
export const featureLabel = (key: string) => [...ADMIN_FEATURES, ...GUARD_FEATURES].find(f => f.key === key)?.label ?? key

// 保存前の正規化：未知のキーを除き、そのロールで選べる機能だけを残す
export function normalizeDisabledFeatures(keys: unknown, role: string): string[] {
  if (!Array.isArray(keys)) return []
  const allowed = new Set(featuresForRole(role).map(f => f.key))
  return [...new Set(keys.filter((k): k is string => typeof k === 'string' && allowed.has(k)))]
}

// API の要求が、使えなくした機能に当たるか（当たった機能を返す）
export function blockedFeatureFor(path: string, method: string, role: string, disabled: string[]): FeatureDef | null {
  if (!disabled.length) return null
  const isWrite = method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD'
  for (const f of featuresForRole(role)) {
    if (!disabled.includes(f.key)) continue
    if (f.api.some(r => r.pattern.test(path) && (r.methods === 'all' || isWrite))) return f
  }
  return null
}

// 管理画面のパスが使えなくした機能に当たるか
export function disabledFeatureForPath(pathname: string, disabled: string[]): FeatureDef | null {
  if (!disabled.length) return null
  return ADMIN_FEATURES.find(f => f.path && disabled.includes(f.key) && (pathname === f.path || pathname.startsWith(f.path + '/'))) ?? null
}
