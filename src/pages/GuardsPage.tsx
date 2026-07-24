import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { hasRole } from '../lib/auth'

import {
  EMPLOYMENT_TYPE, GENDER, PREFECTURES, GUARD_CLASSES, SKILL_OPTIONS, PAY_TYPE,
} from '../lib/constants'

const EMPLOYMENT_LABELS = EMPLOYMENT_TYPE
const GENDER_LABELS = GENDER
const PAY_TYPES = PAY_TYPE

// 警備保有資格（チェックボックス）
const SECURITY_CERTS = [
  '交通誘導警備業務検定1級', '交通誘導警備業務検定2級',
  '雑踏警備業務検定1級',    '雑踏警備業務検定2級',
  '施設警備業務検定1級',    '施設警備業務検定2級',
  '空港保安警備業務検定1級', '空港保安警備業務検定2級',
  '貴重品運搬警備業務検定1級', '貴重品運搬警備業務検定2級',
]

// 運転免許証（チェックボックス）
const DRIVER_LICENSE_OPTIONS = [
  '普通自動車免許（AT限定）',
  '普通自動車免許',
  '準中型自動車免許',
  '中型自動車免許',
  '大型自動車免許',
  '普通二輪免許（AT限定）',
  '普通二輪免許',
  '大型二輪免許',
]

// チェックボックス管理の全資格（その他保有資格の残余抽出に使用）
const ALL_CHECKBOX_CERTS = new Set([...SECURITY_CERTS, ...DRIVER_LICENSE_OPTIONS])

interface GuardFormData {
  employeeNumber: string; name: string; nameKana: string; birthDate: string; gender: string
  phone: string; email: string; address: string; employmentType: string; certifications: string[]; otherCertText: string
  dailyPayEnabled: boolean; lineWorksId: string
  // 基本情報拡張
  guardClass: string; skills: string[]; nationality: string; financialIssues: boolean
  mbti: string; dormitory: string; notes: string
  // 住所
  postalCode: string; prefecture: string; city: string; addressDetail: string; buildingName: string
  nearestStation1: string; line1: string; nearestStation2: string; line2: string
  birthplace: string; medicalHistory: string
  // 緊急連絡先
  emergencyName: string; emergencyKana: string; emergencyRelation: string
  emergencyPostal: string; emergencyPrefecture: string; emergencyCity: string; emergencyAddressDetail: string
  // NG設定
  ngGuardIds: Array<{ id?: string; name: string }>; ngCompanies: Array<{ name: string }>; ngConditions: string
  // 給与
  payType: string; monthlyBase: number; hourlyBase: number
  dayShiftRate: number; nightShiftRate: number; holidayDayRate: number; holidayNightRate: number
  dayOvertimeRate: number; nightOvertimeRate: number; holidayDayOtRate: number; holidayNightOtRate: number
  positionAllowance: number; qualificationAllowance: number; leaderAllowance: number; joiningAllowance: number
  otherAllowance1: number; otherAllowance2: number; otherAllowanceName1: string; otherAllowanceName2: string
  // 社会保険
  employmentInsurance: boolean; healthInsurance: boolean; healthInsuranceGrade: number
  pensionInsurance: boolean; pensionInsuranceGrade: number; nursingInsurance: boolean
  // 家族
  spouse: boolean; spouseDeduction: boolean; dependents: number
  // 書類
  docMyNumber: boolean; docIdCard: boolean; docIdentityCert: boolean; docResidenceCard: boolean
  docResume: boolean; docPledge: boolean; docPhoto: boolean; docOther: boolean
  // 銀行口座
  bankName: string; bankBranch: string; bankAccountType: string; bankAccountNumber: string; bankAccountHolder: string
}

const EMPTY_FORM: GuardFormData = {
  employeeNumber: '', name: '', nameKana: '', birthDate: '', gender: 'MALE',
  phone: '', email: '', address: '', employmentType: 'PART_TIME', certifications: [], otherCertText: '', dailyPayEnabled: false,
  lineWorksId: '',
  guardClass: '', skills: [], nationality: '', financialIssues: false, mbti: '', dormitory: '', notes: '',
  postalCode: '', prefecture: '', city: '', addressDetail: '', buildingName: '',
  nearestStation1: '', line1: '', nearestStation2: '', line2: '', birthplace: '', medicalHistory: '',
  emergencyName: '', emergencyKana: '', emergencyRelation: '',
  emergencyPostal: '', emergencyPrefecture: '', emergencyCity: '', emergencyAddressDetail: '',
  ngGuardIds: [], ngCompanies: [], ngConditions: '',
  payType: 'DAY', monthlyBase: 0, hourlyBase: 0,
  dayShiftRate: 0, nightShiftRate: 0, holidayDayRate: 0, holidayNightRate: 0,
  dayOvertimeRate: 0, nightOvertimeRate: 0, holidayDayOtRate: 0, holidayNightOtRate: 0,
  positionAllowance: 0, qualificationAllowance: 0, leaderAllowance: 0, joiningAllowance: 0,
  otherAllowance1: 0, otherAllowance2: 0, otherAllowanceName1: '', otherAllowanceName2: '',
  employmentInsurance: false, healthInsurance: false, healthInsuranceGrade: 0,
  pensionInsurance: false, pensionInsuranceGrade: 0, nursingInsurance: false,
  spouse: false, spouseDeduction: false, dependents: 0,
  docMyNumber: false, docIdCard: false, docIdentityCert: false, docResidenceCard: false,
  docResume: false, docPledge: false, docPhoto: false, docOther: false,
  bankName: '', bankBranch: '', bankAccountType: '普通', bankAccountNumber: '', bankAccountHolder: '',
}

export default function GuardsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [form, setForm] = useState<GuardFormData>(EMPTY_FORM)
  const [activeSection, setActiveSection] = useState(0)
  const [ngGuardInput, setNgGuardInput] = useState('')
  const [ngCompanyInput, setNgCompanyInput] = useState('')
  const [compatTargetId, setCompatTargetId] = useState('')
  const [compatType, setCompatType] = useState<'GOOD' | 'BAD' | 'NG'>('GOOD')
  const [compatReason, setCompatReason] = useState('')

  const { data: guards = [], isLoading } = useQuery({
    queryKey: ['guards', search],
    queryFn: () => api.get(`/guards?isActive=true${search ? `&search=${encodeURIComponent(search)}` : ''}`).then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/guards', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['guards'] }); setShowForm(false); setForm(EMPTY_FORM) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/guards/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['guards'] }); setShowForm(false); setEditTarget(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/guards/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guards'] }),
  })

  // 相性データ
  const { data: compatibilities = [] } = useQuery({
    queryKey: ['guard-compatibility', editTarget?.id],
    queryFn: () => api.get(`/guards/${editTarget.id}/compatibility`).then(r => r.data),
    enabled: !!editTarget?.id,
  })

  const addCompatMutation = useMutation({
    mutationFn: ({ guardId, data }: { guardId: string; data: any }) =>
      api.post(`/guards/${guardId}/compatibility`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['guard-compatibility'] }); setCompatTargetId(''); setCompatReason('') },
  })

  const deleteCompatMutation = useMutation({
    mutationFn: ({ guardId, targetId }: { guardId: string; targetId: string }) =>
      api.delete(`/guards/${guardId}/compatibility/${targetId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guard-compatibility'] }),
  })

  // 書類ファイルデータ
  const { data: guardDocuments = [] } = useQuery({
    queryKey: ['guard-documents', editTarget?.id],
    queryFn: () => api.get(`/guards/${editTarget.id}/documents`).then(r => r.data),
    enabled: !!editTarget?.id,
  })

  const uploadDocMutation = useMutation({
    mutationFn: ({ guardId, formData }: { guardId: string; formData: FormData }) =>
      api.post(`/guards/${guardId}/documents/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guard-documents'] })
      qc.invalidateQueries({ queryKey: ['guards'] })
    },
  })

  const deleteDocMutation = useMutation({
    mutationFn: (docId: string) => api.delete(`/guards/documents/${docId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guard-documents'] }),
  })

  const handleDocUpload = (docType: string) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,.jpg,.jpeg,.png,.gif,.webp'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file || !editTarget) return
      const fd = new FormData()
      fd.append('file', file)
      fd.append('docType', docType)
      uploadDocMutation.mutate({ guardId: editTarget.id, formData: fd })
    }
    input.click()
  }

  const getDocForType = (docType: string) =>
    guardDocuments.find((d: any) => d.docType === docType)

  const openEdit = (guard: any) => {
    setEditTarget(guard)
    const bank = guard.bankAccount || {}
    setForm({
      employeeNumber: guard.employeeNumber, name: guard.name, nameKana: guard.nameKana,
      birthDate: guard.birthDate ? guard.birthDate.split('T')[0] : '', gender: guard.gender || 'MALE',
      phone: guard.phone || '', email: guard.email || '', address: guard.address || '',
      employmentType: guard.employmentType,
      certifications: (guard.certifications || []).filter((c: string) => ALL_CHECKBOX_CERTS.has(c)),
      otherCertText: (guard.certifications || []).filter((c: string) => !ALL_CHECKBOX_CERTS.has(c)).join('、'),
      dailyPayEnabled: guard.dailyPayEnabled, lineWorksId: guard.lineWorksId || '',
      guardClass: guard.guardClass || '', skills: guard.skills || [], nationality: guard.nationality || '',
      financialIssues: guard.financialIssues || false, mbti: guard.mbti || '',
      dormitory: guard.dormitory || '', notes: guard.notes || '',
      postalCode: guard.postalCode || '', prefecture: guard.prefecture || '',
      city: guard.city || '', addressDetail: guard.addressDetail || '', buildingName: guard.buildingName || '',
      nearestStation1: guard.nearestStation1 || '', line1: guard.line1 || '',
      nearestStation2: guard.nearestStation2 || '', line2: guard.line2 || '',
      birthplace: guard.birthplace || '', medicalHistory: guard.medicalHistory || '',
      emergencyName: guard.emergencyName || '', emergencyKana: guard.emergencyKana || '',
      emergencyRelation: guard.emergencyRelation || '', emergencyPostal: guard.emergencyPostal || '',
      emergencyPrefecture: guard.emergencyPrefecture || '', emergencyCity: guard.emergencyCity || '',
      emergencyAddressDetail: guard.emergencyAddressDetail || '',
      ngGuardIds: guard.ngGuardIds || [], ngCompanies: guard.ngCompanies || [], ngConditions: guard.ngConditions || '',
      payType: guard.payType || 'DAY', monthlyBase: guard.monthlyBase || 0, hourlyBase: guard.hourlyBase || 0,
      dayShiftRate: guard.dayShiftRate || 0, nightShiftRate: guard.nightShiftRate || 0,
      holidayDayRate: guard.holidayDayRate || 0, holidayNightRate: guard.holidayNightRate || 0,
      dayOvertimeRate: guard.dayOvertimeRate || 0, nightOvertimeRate: guard.nightOvertimeRate || 0,
      holidayDayOtRate: guard.holidayDayOtRate || 0, holidayNightOtRate: guard.holidayNightOtRate || 0,
      positionAllowance: guard.positionAllowance || 0, qualificationAllowance: guard.qualificationAllowance || 0,
      leaderAllowance: guard.leaderAllowance || 0, joiningAllowance: guard.joiningAllowance || 0,
      otherAllowance1: guard.otherAllowance1 || 0, otherAllowance2: guard.otherAllowance2 || 0,
      otherAllowanceName1: guard.otherAllowanceName1 || '', otherAllowanceName2: guard.otherAllowanceName2 || '',
      employmentInsurance: guard.employmentInsurance || false, healthInsurance: guard.healthInsurance || false,
      healthInsuranceGrade: guard.healthInsuranceGrade || 0,
      pensionInsurance: guard.pensionInsurance || false, pensionInsuranceGrade: guard.pensionInsuranceGrade || 0,
      nursingInsurance: guard.nursingInsurance || false,
      spouse: guard.spouse || false, spouseDeduction: guard.spouseDeduction || false, dependents: guard.dependents || 0,
      docMyNumber: guard.docMyNumber || false, docIdCard: guard.docIdCard || false,
      docIdentityCert: guard.docIdentityCert || false, docResidenceCard: guard.docResidenceCard || false,
      docResume: guard.docResume || false, docPledge: guard.docPledge || false,
      docPhoto: guard.docPhoto || false, docOther: guard.docOther || false,
      bankName: bank.bank || bank.bankName || '', bankBranch: bank.branch || bank.bankBranch || '',
      bankAccountType: bank.type || bank.bankAccountType || '普通',
      bankAccountNumber: bank.number || bank.bankAccountNumber || '',
      bankAccountHolder: bank.holder || bank.bankAccountHolder || '',
    })
    setShowForm(true)
    setActiveSection(0)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const { bankName, bankBranch, bankAccountType, bankAccountNumber, bankAccountHolder, otherCertText, ...rest } = form
    const otherCerts = otherCertText ? otherCertText.split(/[,、\n]/).map(s => s.trim()).filter(Boolean) : []
    const data: any = {
      ...rest,
      certifications: [...rest.certifications, ...otherCerts],
      bankAccount: bankName ? { bank: bankName, branch: bankBranch, type: bankAccountType, number: bankAccountNumber, holder: bankAccountHolder } : undefined,
      ngGuardIds: form.ngGuardIds.length > 0 ? form.ngGuardIds : undefined,
      ngCompanies: form.ngCompanies.length > 0 ? form.ngCompanies : undefined,
    }
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const canEdit = hasRole(user, 'ADMIN', 'MANAGER')

  const sections = [
    { label: '基本情報', icon: '1' },
    { label: '現住所', icon: '2' },
    { label: '緊急連絡先', icon: '3' },
    { label: 'NG・相性', icon: '4' },
    { label: '給与・社保', icon: '5' },
    { label: '書類', icon: '6' },
    { label: '振込先', icon: '7' },
  ]

  const toggleSkill = (skill: string) => {
    setForm(f => ({
      ...f,
      skills: f.skills.includes(skill) ? f.skills.filter(s => s !== skill) : [...f.skills, skill],
    }))
  }

  const addNgGuard = () => {
    if (!ngGuardInput.trim()) return
    setForm(f => ({ ...f, ngGuardIds: [...f.ngGuardIds, { name: ngGuardInput.trim() }] }))
    setNgGuardInput('')
  }

  const addNgCompany = () => {
    if (!ngCompanyInput.trim()) return
    setForm(f => ({ ...f, ngCompanies: [...f.ngCompanies, { name: ngCompanyInput.trim() }] }))
    setNgCompanyInput('')
  }

  const numInput = (label: string, key: keyof GuardFormData) => (
    <div>
      <label className="form-label">{label}</label>
      <input type="number" value={(form[key] as number) || 0}
        onChange={e => setForm(f => ({ ...f, [key]: Number(e.target.value) }))}
        className="form-input text-right" />
    </div>
  )

  const checkInput = (label: string, key: keyof GuardFormData) => (
    <div className="flex items-center gap-2">
      <input type="checkbox" checked={form[key] as boolean} onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} className="w-4 h-4" />
      <span className="text-sm text-gray-700">{label}</span>
    </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">隊員管理</h1>
        <div className="flex gap-2">
          <a href={`${import.meta.env.VITE_API_URL || ''}/api/export/guards`} download className="btn-secondary text-sm">CSV</a>
          {canEdit && (
            <button onClick={() => { setEditTarget(null); setForm(EMPTY_FORM); setActiveSection(0); setShowForm(true) }} className="btn-primary text-sm">
              + 隊員登録
            </button>
          )}
        </div>
      </div>

      <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
        className="form-input" placeholder="名前・読み・社員番号で検索..." />

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">社員番号</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">名前</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">雇用形態</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">電話番号</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">クラス</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">日払い</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {guards.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">隊員が登録されていません</td></tr>
              ) : (
                guards.map((g: any) => (
                  <tr key={g.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{g.employeeNumber}</td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-800">{g.name}</p>
                        <p className="text-xs text-gray-400">{g.nameKana}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="badge badge-info">{EMPLOYMENT_LABELS[g.employmentType]}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{g.phone || '-'}</td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {g.guardClass ? <span className="badge badge-info">{g.guardClass}</span> : '-'}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {g.dailyPayEnabled ? <span className="badge badge-success">対象</span> : <span className="badge badge-gray">対象外</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canEdit && (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => openEdit(g)} className="text-blue-600 hover:text-blue-800 text-xs">編集</button>
                          <button onClick={() => { if (window.confirm(`${g.name}を無効化しますか？`)) deleteMutation.mutate(g.id) }} className="text-red-500 hover:text-red-700 text-xs">削除</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* フォームモーダル */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[95vh] overflow-hidden flex flex-col">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between z-10">
              <h2 className="font-semibold text-gray-800">{editTarget ? '隊員編集' : '隊員登録'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">X</button>
            </div>

            {/* セクションタブ */}
            <div className="flex gap-1 px-4 pt-3 pb-0 overflow-x-auto border-b border-gray-100">
              {sections.map((s, i) => (
                <button key={i} onClick={() => setActiveSection(i)}
                  className={`flex items-center gap-1 px-3 py-2 text-xs rounded-t-lg whitespace-nowrap border-b-2 ${
                    activeSection === i ? 'border-blue-600 text-blue-600 bg-blue-50 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>
                  <span className="w-5 h-5 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-[10px] font-bold">{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* セクション1: 基本情報 */}
              {activeSection === 0 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">社員番号 *</label>
                      <input type="text" value={form.employeeNumber} onChange={e => setForm(f => ({ ...f, employeeNumber: e.target.value }))} className="form-input" required />
                    </div>
                    <div>
                      <label className="form-label">雇用形態</label>
                      <select value={form.employmentType} onChange={e => setForm(f => ({ ...f, employmentType: e.target.value }))} className="form-input">
                        {Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">氏名 *</label>
                      <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="form-input" required />
                    </div>
                    <div>
                      <label className="form-label">フリガナ *</label>
                      <input type="text" value={form.nameKana} onChange={e => setForm(f => ({ ...f, nameKana: e.target.value }))} className="form-input" required />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">生年月日</label>
                      <input type="date" value={form.birthDate} onChange={e => setForm(f => ({ ...f, birthDate: e.target.value }))} className="form-input" />
                    </div>
                    <div>
                      <label className="form-label">性別</label>
                      <select value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))} className="form-input">
                        {Object.entries(GENDER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">電話番号</label>
                      <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="form-input" />
                    </div>
                    <div>
                      <label className="form-label">メールアドレス</label>
                      <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="form-input" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">クラス</label>
                      <select value={form.guardClass} onChange={e => setForm(f => ({ ...f, guardClass: e.target.value }))} className="form-input">
                        <option value="">未設定</option>
                        {GUARD_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">国籍</label>
                      <input type="text" value={form.nationality} onChange={e => setForm(f => ({ ...f, nationality: e.target.value }))} className="form-input" />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">スキル</label>
                    <div className="flex flex-wrap gap-2">
                      {SKILL_OPTIONS.map(skill => (
                        <label key={skill} className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm cursor-pointer border ${
                          form.skills.includes(skill) ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-600'
                        }`}>
                          <input type="checkbox" checked={form.skills.includes(skill)} onChange={() => toggleSkill(skill)} className="sr-only" />
                          {skill}
                        </label>
                      ))}
                    </div>
                  </div>
                  {/* 警備保有資格 */}
                  <div>
                    <label className="form-label">警備保有資格</label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-1">
                      {SECURITY_CERTS.map(cert => (
                        <label key={cert} className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={form.certifications.includes(cert)}
                            onChange={e => {
                              const next = e.target.checked
                                ? [...form.certifications, cert]
                                : form.certifications.filter(c => c !== cert)
                              setForm(f => ({ ...f, certifications: next }))
                            }}
                            className="w-4 h-4 accent-[#1e3a5f] flex-shrink-0"
                          />
                          <span className="text-sm text-gray-700">{cert}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* 運転免許証 */}
                  <div>
                    <label className="form-label">運転免許証</label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-1">
                      {DRIVER_LICENSE_OPTIONS.map(lic => (
                        <label key={lic} className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={form.certifications.includes(lic)}
                            onChange={e => {
                              const next = e.target.checked
                                ? [...form.certifications, lic]
                                : form.certifications.filter(c => c !== lic)
                              setForm(f => ({ ...f, certifications: next }))
                            }}
                            className="w-4 h-4 accent-[#1e3a5f] flex-shrink-0"
                          />
                          <span className="text-sm text-gray-700">{lic}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* その他保有資格 */}
                  <div>
                    <label className="form-label">その他保有資格</label>
                    <input
                      type="text"
                      value={form.otherCertText}
                      onChange={e => setForm(f => ({ ...f, otherCertText: e.target.value }))}
                      className="form-input"
                      placeholder="例: 危険物取扱者乙種4類、フォークリフト（読点・カンマ区切りで複数入力）"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">MBTI</label>
                      <input type="text" value={form.mbti} onChange={e => setForm(f => ({ ...f, mbti: e.target.value }))} className="form-input" placeholder="例: ESTJ" maxLength={4} />
                    </div>
                    <div>
                      <label className="form-label">寮利用</label>
                      <input type="text" value={form.dormitory} onChange={e => setForm(f => ({ ...f, dormitory: e.target.value }))} className="form-input" placeholder="寮名を入力（利用しない場合は空欄）" />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {checkInput('日払い対象', 'dailyPayEnabled')}
                    {checkInput('金銭問題あり', 'financialIssues')}
                  </div>
                  <div>
                    <label className="form-label">LINE Works メンバーID</label>
                    <input type="text" value={form.lineWorksId} onChange={e => setForm(f => ({ ...f, lineWorksId: e.target.value }))} className="form-input" placeholder="例: user@example.com" />
                  </div>
                  <div>
                    <label className="form-label">備考</label>
                    <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="form-input" rows={3} />
                  </div>
                </>
              )}

              {/* セクション2: 現住所 */}
              {activeSection === 1 && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="form-label">郵便番号</label>
                      <input type="text" value={form.postalCode} onChange={e => setForm(f => ({ ...f, postalCode: e.target.value }))} className="form-input" placeholder="123-4567" />
                    </div>
                    <div>
                      <label className="form-label">都道府県</label>
                      <select value={form.prefecture} onChange={e => setForm(f => ({ ...f, prefecture: e.target.value }))} className="form-input">
                        <option value="">選択</option>
                        {PREFECTURES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">市区町村</label>
                      <input type="text" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} className="form-input" />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">地域以下</label>
                    <input type="text" value={form.addressDetail} onChange={e => setForm(f => ({ ...f, addressDetail: e.target.value }))} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">建物名</label>
                    <input type="text" value={form.buildingName} onChange={e => setForm(f => ({ ...f, buildingName: e.target.value }))} className="form-input" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">最寄駅1</label>
                      <input type="text" value={form.nearestStation1} onChange={e => setForm(f => ({ ...f, nearestStation1: e.target.value }))} className="form-input" />
                    </div>
                    <div>
                      <label className="form-label">路線1</label>
                      <input type="text" value={form.line1} onChange={e => setForm(f => ({ ...f, line1: e.target.value }))} className="form-input" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">最寄駅2</label>
                      <input type="text" value={form.nearestStation2} onChange={e => setForm(f => ({ ...f, nearestStation2: e.target.value }))} className="form-input" />
                    </div>
                    <div>
                      <label className="form-label">路線2</label>
                      <input type="text" value={form.line2} onChange={e => setForm(f => ({ ...f, line2: e.target.value }))} className="form-input" />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">本籍地</label>
                    <input type="text" value={form.birthplace} onChange={e => setForm(f => ({ ...f, birthplace: e.target.value }))} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">既往症</label>
                    <textarea value={form.medicalHistory} onChange={e => setForm(f => ({ ...f, medicalHistory: e.target.value }))} className="form-input" rows={2} />
                  </div>
                </>
              )}

              {/* セクション3: 緊急連絡先 */}
              {activeSection === 2 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">氏名</label>
                      <input type="text" value={form.emergencyName} onChange={e => setForm(f => ({ ...f, emergencyName: e.target.value }))} className="form-input" />
                    </div>
                    <div>
                      <label className="form-label">フリガナ</label>
                      <input type="text" value={form.emergencyKana} onChange={e => setForm(f => ({ ...f, emergencyKana: e.target.value }))} className="form-input" />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">続柄</label>
                    <input type="text" value={form.emergencyRelation} onChange={e => setForm(f => ({ ...f, emergencyRelation: e.target.value }))} className="form-input" placeholder="例: 妻、父 等" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="form-label">郵便番号</label>
                      <input type="text" value={form.emergencyPostal} onChange={e => setForm(f => ({ ...f, emergencyPostal: e.target.value }))} className="form-input" />
                    </div>
                    <div>
                      <label className="form-label">都道府県</label>
                      <select value={form.emergencyPrefecture} onChange={e => setForm(f => ({ ...f, emergencyPrefecture: e.target.value }))} className="form-input">
                        <option value="">選択</option>
                        {PREFECTURES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">市区町村</label>
                      <input type="text" value={form.emergencyCity} onChange={e => setForm(f => ({ ...f, emergencyCity: e.target.value }))} className="form-input" />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">地域以下</label>
                    <input type="text" value={form.emergencyAddressDetail} onChange={e => setForm(f => ({ ...f, emergencyAddressDetail: e.target.value }))} className="form-input" />
                  </div>
                </>
              )}

              {/* セクション4: NG設定 */}
              {activeSection === 3 && (
                <>
                  <div>
                    <label className="form-label">NG隊員</label>
                    <div className="flex gap-2 mb-2">
                      <input type="text" value={ngGuardInput} onChange={e => setNgGuardInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNgGuard() } }}
                        className="form-input flex-1" placeholder="名前を入力してEnter" />
                      <button type="button" onClick={addNgGuard} className="btn-secondary text-sm px-3">追加</button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {form.ngGuardIds.map((ng, i) => (
                        <span key={i} className="bg-red-50 text-red-700 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                          {ng.name}
                          <button type="button" onClick={() => setForm(f => ({ ...f, ngGuardIds: f.ngGuardIds.filter((_, idx) => idx !== i) }))} className="text-red-400 hover:text-red-600">x</button>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="form-label">NG会社</label>
                    <div className="flex gap-2 mb-2">
                      <input type="text" value={ngCompanyInput} onChange={e => setNgCompanyInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNgCompany() } }}
                        className="form-input flex-1" placeholder="会社名を入力してEnter" />
                      <button type="button" onClick={addNgCompany} className="btn-secondary text-sm px-3">追加</button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {form.ngCompanies.map((ng, i) => (
                        <span key={i} className="bg-orange-50 text-orange-700 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                          {ng.name}
                          <button type="button" onClick={() => setForm(f => ({ ...f, ngCompanies: f.ngCompanies.filter((_, idx) => idx !== i) }))} className="text-orange-400 hover:text-orange-600">x</button>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="form-label">NG条件</label>
                    <textarea value={form.ngConditions} onChange={e => setForm(f => ({ ...f, ngConditions: e.target.value }))} className="form-input" rows={3} placeholder="その他のNG条件を記載" />
                  </div>

                  {/* 相性設定（編集時のみ表示） */}
                  {editTarget && (
                    <div className="mt-4 border-t pt-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">隊員間の相性設定</h4>

                      {/* 登録フォーム */}
                      <div className="bg-gray-50 rounded-lg p-3 mb-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                          <div>
                            <label className="text-xs text-gray-500">対象隊員</label>
                            <select value={compatTargetId} onChange={e => setCompatTargetId(e.target.value)} className="form-input text-sm">
                              <option value="">選択...</option>
                              {guards.filter((g: any) => g.id !== editTarget.id).map((g: any) => (
                                <option key={g.id} value={g.id}>{g.name}（{g.employeeNumber}）</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">種別</label>
                            <select value={compatType} onChange={e => setCompatType(e.target.value as 'GOOD' | 'BAD' | 'NG')} className="form-input text-sm">
                              <option value="GOOD">良好（GOOD）</option>
                              <option value="BAD">悪い（BAD）</option>
                              <option value="NG">配置不可（NG）</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">理由</label>
                            <input type="text" value={compatReason} onChange={e => setCompatReason(e.target.value)}
                              className="form-input text-sm" placeholder="理由（任意）" />
                          </div>
                        </div>
                        <button type="button" disabled={!compatTargetId}
                          onClick={() => addCompatMutation.mutate({ guardId: editTarget.id, data: { targetGuardId: compatTargetId, type: compatType, reason: compatReason } })}
                          className="btn-primary text-sm px-4 py-1 disabled:opacity-50">
                          相性を登録
                        </button>
                      </div>

                      {/* 登録済み一覧 */}
                      {compatibilities.length > 0 ? (
                        <div className="space-y-1">
                          {compatibilities.map((c: any) => {
                            const isFrom = c.guardId === editTarget.id
                            const other = isFrom ? c.targetGuard : c.guard
                            const typeLabel = c.type === 'GOOD' ? '良好' : c.type === 'BAD' ? '悪い' : '配置不可'
                            const typeColor = c.type === 'GOOD' ? 'bg-green-50 text-green-700' : c.type === 'BAD' ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'
                            return (
                              <div key={c.id} className="flex items-center justify-between bg-white border rounded px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${typeColor}`}>{typeLabel}</span>
                                  <span className="text-sm">{other.name}</span>
                                  {other.guardClass && <span className="text-xs text-gray-400">{other.guardClass}クラス</span>}
                                  {c.reason && <span className="text-xs text-gray-400 ml-2">({c.reason})</span>}
                                </div>
                                <button type="button"
                                  onClick={() => deleteCompatMutation.mutate({ guardId: editTarget.id, targetId: other.id })}
                                  className="text-red-400 hover:text-red-600 text-xs">削除</button>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">相性設定はまだありません</p>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* セクション5: 給与・社会保険 */}
              {activeSection === 4 && (
                <>
                  <h4 className="text-sm font-semibold text-gray-700 border-b pb-1">給与体系</h4>
                  <div className="flex gap-4">
                    {PAY_TYPES.map(pt => (
                      <label key={pt.value} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="payType" value={pt.value} checked={form.payType === pt.value}
                          onChange={e => setForm(f => ({ ...f, payType: e.target.value }))} className="w-4 h-4" />
                        <span className="text-sm">{pt.label}</span>
                      </label>
                    ))}
                  </div>

                  {form.payType === 'MONTH' && numInput('基本給（月給）', 'monthlyBase')}
                  {form.payType === 'HOUR' && numInput('時給', 'hourlyBase')}

                  {(form.payType === 'DAY' || form.payType === 'HOUR') && (
                    <>
                      <h4 className="text-sm font-semibold text-gray-700 border-b pb-1 mt-4">勤務単価</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {numInput('日勤単価', 'dayShiftRate')}
                        {numInput('夜勤単価', 'nightShiftRate')}
                        {numInput('休日日勤', 'holidayDayRate')}
                        {numInput('休日夜勤', 'holidayNightRate')}
                        {numInput('(日)残業', 'dayOvertimeRate')}
                        {numInput('(夜)残業', 'nightOvertimeRate')}
                        {numInput('(休日)残業', 'holidayDayOtRate')}
                        {numInput('(休夜)残業', 'holidayNightOtRate')}
                      </div>
                    </>
                  )}

                  <h4 className="text-sm font-semibold text-gray-700 border-b pb-1 mt-4">手当</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {numInput('役職手当', 'positionAllowance')}
                    {numInput('資格手当', 'qualificationAllowance')}
                    {numInput('隊長手当', 'leaderAllowance')}
                    {numInput('入社手当', 'joiningAllowance')}
                    <div>
                      <label className="form-label">その他手当1</label>
                      <div className="flex gap-1">
                        <input type="text" value={form.otherAllowanceName1} onChange={e => setForm(f => ({ ...f, otherAllowanceName1: e.target.value }))} className="form-input flex-1" placeholder="名称" />
                        <input type="number" value={form.otherAllowance1 || 0} onChange={e => setForm(f => ({ ...f, otherAllowance1: Number(e.target.value) }))} className="form-input w-24 text-right" />
                      </div>
                    </div>
                    <div>
                      <label className="form-label">その他手当2</label>
                      <div className="flex gap-1">
                        <input type="text" value={form.otherAllowanceName2} onChange={e => setForm(f => ({ ...f, otherAllowanceName2: e.target.value }))} className="form-input flex-1" placeholder="名称" />
                        <input type="number" value={form.otherAllowance2 || 0} onChange={e => setForm(f => ({ ...f, otherAllowance2: Number(e.target.value) }))} className="form-input w-24 text-right" />
                      </div>
                    </div>
                  </div>

                  <h4 className="text-sm font-semibold text-gray-700 border-b pb-1 mt-4">社会保険</h4>
                  <div className="space-y-3">
                    {checkInput('雇用保険', 'employmentInsurance')}
                    <div className="flex items-center gap-4">
                      {checkInput('健康保険', 'healthInsurance')}
                      {form.healthInsurance && (
                        <div className="flex items-center gap-1">
                          <label className="text-xs text-gray-500">等級:</label>
                          <input type="number" value={form.healthInsuranceGrade || ''} onChange={e => setForm(f => ({ ...f, healthInsuranceGrade: Number(e.target.value) }))} className="form-input w-20 text-sm" />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      {checkInput('厚生年金', 'pensionInsurance')}
                      {form.pensionInsurance && (
                        <div className="flex items-center gap-1">
                          <label className="text-xs text-gray-500">等級:</label>
                          <input type="number" value={form.pensionInsuranceGrade || ''} onChange={e => setForm(f => ({ ...f, pensionInsuranceGrade: Number(e.target.value) }))} className="form-input w-20 text-sm" />
                        </div>
                      )}
                    </div>
                    {checkInput('介護保険', 'nursingInsurance')}
                  </div>

                  <h4 className="text-sm font-semibold text-gray-700 border-b pb-1 mt-4">家族構成</h4>
                  <div className="space-y-3">
                    {checkInput('配偶者あり', 'spouse')}
                    {form.spouse && checkInput('配偶者控除あり', 'spouseDeduction')}
                    <div>
                      <label className="form-label">扶養人数</label>
                      <input type="number" min={0} value={form.dependents} onChange={e => setForm(f => ({ ...f, dependents: Number(e.target.value) }))} className="form-input w-24" />
                    </div>
                  </div>
                </>
              )}

              {/* セクション6: 書類 */}
              {activeSection === 5 && (
                <>
                  <p className="text-sm text-gray-500 mb-2">提出済みの書類にチェックを入れてください</p>
                  <div className="space-y-2">
                    {([
                      { label: 'マイナンバー', key: 'docMyNumber' },
                      { label: '身分証明書', key: 'docIdCard' },
                      { label: '身元証明書', key: 'docIdentityCert' },
                      { label: '住民票', key: 'docResidenceCard' },
                      { label: '履歴書', key: 'docResume' },
                      { label: '誓約書', key: 'docPledge' },
                      { label: '顔写真', key: 'docPhoto' },
                      { label: 'その他', key: 'docOther' },
                    ] as { label: string; key: keyof GuardFormData }[]).map(({ label, key }) => {
                      const doc = getDocForType(key)
                      return (
                        <div key={key} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                          <label className="flex items-center gap-2 cursor-pointer flex-1">
                            <input type="checkbox" checked={!!form[key]}
                              onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                              className="w-4 h-4 rounded border-gray-300" />
                            <span className="text-sm">{label}</span>
                          </label>
                          <div className="flex items-center gap-2">
                            {doc ? (
                              <>
                                <a href={`${(import.meta as any).env?.VITE_API_URL || ''}/api/guards/documents/${doc.id}/download`}
                                  target="_blank" rel="noopener noreferrer"
                                  className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded hover:bg-blue-100 flex items-center gap-1">
                                  <span>📄</span>
                                  <span className="max-w-[120px] truncate">{doc.fileName}</span>
                                </a>
                                {canEdit && (
                                  <button type="button" onClick={() => { if (confirm('ファイルを削除しますか？')) deleteDocMutation.mutate(doc.id) }}
                                    className="text-xs text-red-400 hover:text-red-600">✕</button>
                                )}
                              </>
                            ) : null}
                            {canEdit && editTarget && (
                              <button type="button" onClick={() => handleDocUpload(key)}
                                disabled={uploadDocMutation.isPending}
                                className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded hover:bg-green-100 disabled:opacity-50">
                                {doc ? '差替' : 'アップロード'}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {uploadDocMutation.isPending && (
                    <p className="text-xs text-blue-500 mt-2">アップロード中...</p>
                  )}
                </>
              )}

              {/* セクション7: 振込先 */}
              {activeSection === 6 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">銀行名</label>
                      <input type="text" value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} className="form-input" />
                    </div>
                    <div>
                      <label className="form-label">支店名</label>
                      <input type="text" value={form.bankBranch} onChange={e => setForm(f => ({ ...f, bankBranch: e.target.value }))} className="form-input" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="form-label">口座種別</label>
                      <select value={form.bankAccountType} onChange={e => setForm(f => ({ ...f, bankAccountType: e.target.value }))} className="form-input">
                        <option value="普通">普通</option>
                        <option value="当座">当座</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label">口座番号</label>
                      <input type="text" value={form.bankAccountNumber} onChange={e => setForm(f => ({ ...f, bankAccountNumber: e.target.value }))} className="form-input" />
                    </div>
                    <div>
                      <label className="form-label">口座名義</label>
                      <input type="text" value={form.bankAccountHolder} onChange={e => setForm(f => ({ ...f, bankAccountHolder: e.target.value }))} className="form-input" />
                    </div>
                  </div>
                </>
              )}

              {/* ナビゲーション & 送信 */}
              <div className="flex gap-3 pt-4 border-t border-gray-100">
                {activeSection > 0 && (
                  <button type="button" onClick={() => setActiveSection(s => s - 1)} className="btn-secondary text-sm">前へ</button>
                )}
                <div className="flex-1" />
                {activeSection < sections.length - 1 ? (
                  <button type="button" onClick={() => setActiveSection(s => s + 1)} className="btn-primary text-sm">次へ</button>
                ) : (
                  <>
                    <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm">キャンセル</button>
                    <button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="btn-primary text-sm disabled:opacity-50">
                      {editTarget ? '更新' : '登録'}
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
