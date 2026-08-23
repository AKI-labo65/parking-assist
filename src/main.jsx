import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './styles.css'

const STORAGE_PREFIX = 'parking-assist-records:'
const WORK_STORAGE_PREFIX = 'parking-assist-work:'
const SETTINGS_STORAGE_KEY = 'parking-assist-settings'
const COMMON_NOTES = ['サービス券1枚使用', '料金未発生', '操作ミス', '発行できず', '精算時間不明']
const REPORT_TYPES = [
  { id: 'normal', label: '通常', description: '1分30秒以内・問題なく発行' },
  { id: 'entryNoCertificate', label: '入店時：証明書未発行', description: '入店時に証明書が出ていなかった' },
  { id: 'issuanceDefect', label: '発行不具合', description: '1分30秒以内だが一度発行できなかった' },
  { id: 'entryMisoperation', label: '入店時：誤操作', description: '駐車証明・精算の誤操作があった' },
  { id: 'serviceTicket', label: '未発行＋サービス券', description: '証明書未発行でもサービス券で精算' },
  { id: 'custom', label: '自由入力', description: '定型文を使わず補足する' },
]
const REPORT_FLAGS = [
  { id: 'misoperationOnce', label: '駐車証明と精算の誤操作(1度のみ)' },
  { id: 'certificateIssued', label: '駐車証明発行済' },
  { id: 'issuanceFailedOnce', label: '1度発行不可' },
]
const COMMUTE_OPTIONS = ['車', '電車']
const RESTART_MESSAGES = ['只今から次の店舗の方に向かいます。', '現場離れます。']
const COMMON_WORK_MESSAGES = ['合流済み、現地にてオリエン完了しました。']
const WORK_STORES = [
  { id: 'storeA', defaultLabel: '店舗A', arrivalText: '現着致しました。', hasCommute: true },
  { id: 'storeB', defaultLabel: '店舗B', arrivalText: 'ただいま、店舗Bに到着しました。', hasCommute: false },
]
const DEFAULT_SETTINGS = { storeLabels: { storeA: '店舗A', storeB: '店舗B' } }
const PARKING_SPOT_COLUMNS = [
  ['1', '2', '3', '4', '5', '6', '7', '8'],
  ['21', '20', '19', '18', '17', '16', '15', '14', '13', '12', '10', '9'],
]
const STATUS = {
  parking: { label: '駐車中', tone: 'parking' },
  issued: { label: '証明書発行済み', tone: 'issued' },
  settled: { label: '精算済み', tone: 'settled' },
}

function getDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateLabel(date = new Date()) {
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  return `${date.getMonth() + 1}/${date.getDate()}（${weekdays[date.getDay()]}）`
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatDateTimeInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 19)
}

function parseDateTimeInput(value) {
  return value ? new Date(value).toISOString() : null
}

function resolveEditedDateTimeInput(value, originalValue) {
  if (value === formatDateTimeInput(originalValue)) return originalValue || null
  return parseDateTimeInput(value)
}

function getElapsedSeconds(record, now = Date.now()) {
  const started = new Date(record.startedAt).getTime()
  const ended = record.issuedAt ? new Date(record.issuedAt).getTime() : now
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0
  return Math.max(0, Math.floor((ended - started) / 1000))
}

function getSettlementDelayMinutes(record) {
  const from = new Date(record.issuedAt || record.startedAt).getTime()
  const settled = new Date(record.settledAt).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(settled)) return null
  return Math.max(0, Math.floor((settled - from) / 60000))
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0)
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`
}

function getNotes(record) {
  return [...(record.notePresets || []), record.memo?.trim()].filter(Boolean).join('、')
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeSpot(value) {
  const spot = String(value ?? '').trim()
  return spot || null
}

function normalizeReportFlags(flags) {
  return REPORT_FLAGS.reduce((result, flag) => ({ ...result, [flag.id]: Boolean(flags?.[flag.id]) }), {})
}

function formatSpotLabel(value, fallback = '番号未入力') {
  const spot = normalizeSpot(value)
  if (!spot) return fallback
  return /^\d+$/.test(spot) ? `${spot}番` : spot
}

function getRecordSpot(record) {
  return normalizeSpot(record.spot)
}

function getRecordSpotLabel(record) {
  const spot = getRecordSpot(record)
  if (spot) return formatSpotLabel(spot)
  return record.unknownLabel ? `番号未入力 #${record.unknownLabel}` : '番号未入力'
}

function withReportMemo(lines, record) {
  const memo = record.reportMemo?.trim()
  return memo ? [...lines, '', memo].join('\n') : lines.join('\n')
}

function buildDetailedReportText(record, storeLabel) {
  const reportType = record.reportType || 'normal'
  const spotLine = `駐車位置番号:${formatSpotLabel(getRecordSpot(record), '番号未入力')}`
  const issueTime = formatTime(record.issuedAt || record.startedAt)
  const settleLine = record.settledAt ? `${formatTime(record.settledAt)}…精算` : '精算時間不明'
  const delayMinutes = getSettlementDelayMinutes(record)
  const delayNote = delayMinutes !== null && delayMinutes >= 9 ? '※9分以上経過しているため問題なく精算できております。' : ''
  const flags = normalizeReportFlags(record.reportFlags)

  if (reportType === 'issuanceDefect') {
    const issueDetail = flags.issuanceFailedOnce || reportType === 'issuanceDefect' ? '証明書発行済(1度発行不可)' : '証明書発行済'
    return withReportMemo([
      `【${storeLabel}】`,
      'お疲れ様です。',
      '1分30秒以内の件、発行不具合のケースです。',
      '',
      spotLine,
      record.issuedAt ? `駐車→証明書発行${getElapsedSeconds(record)}秒` : '駐車→証明書発行できず',
      '',
      `${issueTime}…${issueDetail}`,
      settleLine,
      '',
      delayMinutes !== null && delayMinutes > 0 ? `${delayMinutes}分` : '',
    ].filter((line, index, lines) => line || (index > 0 && lines[index - 1])), record)
  }

  if (reportType === 'serviceTicket') {
    return withReportMemo([
      `【${storeLabel}】`,
      'お疲れ様です。',
      '駐車証明未発行ですが、店内でサービス券を受け取られていたため問題なく精算完了しております。',
      '',
      spotLine,
      '',
      `${formatTime(record.startedAt)}…駐車証明未発行`,
      settleLine,
      delayNote,
    ].filter((line, index, lines) => line || (index > 0 && lines[index - 1])), record)
  }

  if (reportType === 'custom') {
    return [
      `【${storeLabel}】`,
      'お疲れ様です。',
      record.reportMemo?.trim() || '補足報告です。',
      '',
      spotLine,
      '',
      `${issueTime}…${record.issuedAt ? '証明書発行済' : '駐車証明未発行'}`,
      settleLine,
    ].join('\n')
  }

  const header = reportType === 'entryMisoperation' ? '入店時誤操作のお客様です。' : '入店時駐車証明未発行のお客様です。'
  const details = []
  if (flags.misoperationOnce) details.push('駐車証明と精算の誤操作(1度のみ)')
  if (record.issuedAt || flags.certificateIssued) details.push('駐車証明発行済')
  if (details.length === 0) details.push(record.issuedAt ? '駐車証明発行済' : '駐車証明未発行')
  return withReportMemo([
    `【${storeLabel}】`,
    'お疲れ様です。',
    header,
    '精算完了しております。念のためご報告させていただきます。',
    '',
    spotLine,
    '',
    `${issueTime}…${details.join('、')}`,
    settleLine,
    '',
    delayNote,
  ].filter((line, index, lines) => line || (index > 0 && lines[index - 1])), record)
}

function buildImmediateLineText(record, storeLabel) {
  const issueTime = formatTime(record.issuedAt || record.startedAt)
  const settleLine = record.settledAt ? `${formatTime(record.settledAt)}…精算` : '精算時間不明'
  const delayMinutes = getSettlementDelayMinutes(record)
  const notes = [getNotes(record), record.reportMemo?.trim()].filter(Boolean).join('、')
  return [
    `【${storeLabel}】`,
    'お疲れ様です。',
    '90秒を超えた件です。念のためご報告させていただきます。',
    '',
    `駐車位置番号:${formatSpotLabel(getRecordSpot(record), '番号未入力')}`,
    record.issuedAt ? `駐車→証明書発行${getElapsedSeconds(record)}秒` : '駐車→証明書発行できず',
    '',
    `${issueTime}…${record.issuedAt ? '証明書発行' : '駐車証明発行できず'}`,
    settleLine,
    delayMinutes !== null && delayMinutes > 0 ? `${delayMinutes}分` : '',
    notes ? `＊${notes}` : '',
  ].filter((line, index, lines) => line || (index > 0 && lines[index - 1])).join('\n')
}

function normalizeRecord(record) {
  const spot = normalizeSpot(record.spot)
  return {
    ...record,
    spot,
    startedSpot: normalizeSpot(record.startedSpot) || spot,
    unknownLabel: record.unknownLabel || null,
    spotConfirmedAt: record.spotConfirmedAt || null,
    spotSource: record.spotSource || (spot ? 'legacy' : 'unknown'),
    notePresets: Array.isArray(record.notePresets) ? record.notePresets : [],
    memo: record.memo || '',
    exitCompletedAt: record.exitCompletedAt || (record.status === 'settled' ? record.settledAt || null : null),
    lineReportedAt: record.lineReportedAt || null,
    reportType: REPORT_TYPES.some((type) => type.id === record.reportType) ? record.reportType : 'normal',
    reportFlags: normalizeReportFlags(record.reportFlags),
    reportMemo: record.reportMemo || '',
  }
}

function loadRecords(dateKey) {
  try {
    const value = localStorage.getItem(`${STORAGE_PREFIX}${dateKey}`)
    const parsed = value ? JSON.parse(value) : []
    return Array.isArray(parsed) ? parsed.map(normalizeRecord) : []
  } catch {
    return []
  }
}

function loadSettings() {
  try {
    const value = localStorage.getItem(SETTINGS_STORAGE_KEY)
    const parsed = value ? JSON.parse(value) : {}
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      storeLabels: { ...DEFAULT_SETTINGS.storeLabels, ...(parsed.storeLabels || {}) },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function createDefaultWorkReport() {
  const createStore = () => ({
    arrivalAt: null,
    inspectionSeconds: '',
    commute: '車',
    restartStartedAt: null,
    restartBeforeSeconds: '',
    restartAfterSeconds: '',
    qrMinutes: '',
    creditMinutes: '',
    restartCompletedAt: null,
    restartNote: '',
    greetingAt: null,
    serviceTickets: '20',
  })
  return {
    stores: Object.fromEntries(WORK_STORES.map(({ id }) => [id, createStore()])),
    schedule: {
      startedAt: null,
      breakAt: null,
      resumedAt: null,
      endedAt: null,
      parkingTickets: '20',
      returnedTickets: '1',
      distributedTickets: '1',
      finishMemo: '',
      extraMessage: '',
    },
  }
}

function loadWorkReport(dateKey) {
  const defaults = createDefaultWorkReport()
  try {
    const value = localStorage.getItem(`${WORK_STORAGE_PREFIX}${dateKey}`)
    const parsed = value ? JSON.parse(value) : {}
    const parsedStores = Object.values(parsed.stores || {})
    const report = {
      ...defaults,
      ...parsed,
      stores: Object.fromEntries(WORK_STORES.map(({ id }, index) => [id, { ...defaults.stores[id], ...(parsed.stores?.[id] || parsedStores[index] || {}) }])),
      schedule: { ...defaults.schedule, ...(parsed.schedule || {}) },
    }
    Object.values(report.stores).forEach((store) => {
      if (!COMMUTE_OPTIONS.includes(store.commute)) store.commute = '車'
    })
    return report
  } catch {
    return defaults
  }
}

function getRestartRule(date = new Date()) {
  const day = date.getDay()
  if (day === 3) return { id: 'wednesday', required: true, label: '水曜日は再起動対象日です' }
  if (day === 0) return { id: 'sunday', required: true, label: '日曜日は再起動対象日です' }
  if (day === 6) return { id: 'saturday', required: false, label: '土曜日は初期点検8秒以上で再起動します' }
  return { id: 'none', required: false, label: '今日は再起動なしの勤務日です' }
}

function shouldRestartForStore(rule, store) {
  if (rule.required) return true
  if (rule.id !== 'saturday') return false
  return Number(store?.inspectionSeconds) >= 8 || Boolean(store?.restartStartedAt || store?.restartCompletedAt)
}

function workValue(value) {
  return value === '' || value === null || value === undefined ? '—' : value
}

function joinWorkSections(sections) {
  return sections.filter(Boolean).join('\n\n-----\n\n')
}

function buildWorkLineText(report, storeConfigs) {
  const sections = []
  const storeB = report.stores.storeB

  storeConfigs.forEach((storeConfig) => {
    const store = report.stores[storeConfig.id]
    if (!store.arrivalAt && !store.restartStartedAt) return
    const inspectionText = storeConfig.id === 'storeB' ? `初期点検　${workValue(store.inspectionSeconds)}秒` : `初期点検...${workValue(store.inspectionSeconds)}秒`
    sections.push([`【${storeConfig.label}】`, '', storeConfig.arrivalText, '', inspectionText].join('\n'))
  })

  storeConfigs.forEach((storeConfig) => {
    const store = report.stores[storeConfig.id]
    if (!store.restartCompletedAt) return
    sections.push([
      `【${storeConfig.label}】`,
      `再起動前...${workValue(store.restartBeforeSeconds)}秒`,
      `再起動後...${workValue(store.restartAfterSeconds)}秒`,
      `QRリーダー...${workValue(store.qrMinutes)}分`,
      `クレカ立ち上がり...${workValue(store.creditMinutes)}分`,
      '',
      '問題なく復旧しました。',
      store.restartNote.trim(),
    ].join('\n'))
  })

  if (report.schedule.extraMessage.trim()) sections.push(report.schedule.extraMessage.trim())

  if (storeB.greetingAt) {
    sections.push([
      `【${storeConfigs.find((config) => config.id === 'storeB').label}】`,
      '店舗様へのご挨拶完了',
      '本日もよろしくお願いいたします。',
      `サービス券　預かり${workValue(storeB.serviceTickets)}枚`,
    ].join('\n'))
  }

  const storeBLabel = storeConfigs.find((config) => config.id === 'storeB').label
  if (report.schedule.startedAt) sections.push([`【${storeBLabel}】`, '10:00配置つきました。', '業務開始いたします。'].join('\n'))
  if (report.schedule.breakAt) sections.push([`【${storeBLabel}】`, '12:00になりましたので', '配置一時解除します。'].join('\n'))
  if (report.schedule.resumedAt) sections.push([`【${storeBLabel}】`, '15:00配置つきました。', '業務再開いたします。'].join('\n'))
  if (report.schedule.endedAt) {
    const finishMemo = report.schedule.finishMemo.trim()
    sections.push([
      `【${storeBLabel}】`,
      '18:00…配置解除,店舗挨拶完了',
      '',
      `店舗駐車券預り${workValue(report.schedule.parkingTickets)}枚`,
      `お客様から駐車券返却 ${workValue(report.schedule.returnedTickets)}枚`,
      `お客様への配布 ${workValue(report.schedule.distributedTickets)}枚`,
      '',
      'お疲れ様でした。',
      finishMemo ? `\n${finishMemo}` : '',
    ].join('\n'))
  }

  return sections.length > 0 ? joinWorkSections(sections) : '勤務報告の記録はありません。'
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function useDialogFocus(onClose) {
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined

    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    const backdrop = dialog.closest('.modal-backdrop')
    const siblings = []
    let branch = backdrop
    while (branch?.parentElement) {
      siblings.push(...[...branch.parentElement.children].filter((element) => element !== branch))
      if (branch.parentElement === document.body) break
      branch = branch.parentElement
    }
    const siblingState = [...new Set(siblings)].map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute('aria-hidden'),
    }))

    siblingState.forEach(({ element }) => {
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    })
    document.body.style.overflow = 'hidden'

    const initialFocus = dialog.querySelector('[data-dialog-initial-focus]') || dialog
    initialFocus.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)]
        .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      siblingState.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert
        if (ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
      })
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  return dialogRef
}

function Icon({ name, size = 20 }) {
  const paths = {
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
    check: <><path d="m5 12.5 4.2 4.2L19 7" /></>,
    edit: <><path d="M4 20h4l10.8-10.8a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="m14.5 7.5 3 3" /></>,
    trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></>,
    copy: <><rect x="8" y="8" width="10" height="11" rx="1.5" /><path d="M6 15H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h7A1.5 1.5 0 0 1 13.5 5v1" /></>,
    note: <><path d="M5 3.5h10l3 3V20H5z" /><path d="M15 3.5V7h3M8 11h7M8 14.5h7M8 18h4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.8-4L3 10" /><path d="M3 5v5h5M4 13a8 8 0 0 0 14.8 4L21 14" /><path d="M21 19v-5h-5" /></>,
    arrow: <path d="m9 18 6-6-6-6" />,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function NavigationTab({ tab, activeView, onSelect, mobile = false }) {
  const iconName = { record: 'note', issued: 'check', history: 'clock' }[tab.id]
  return <button type="button" className={`${activeView === tab.id ? 'active ' : ''}${mobile ? 'mobile-tab' : ''}`} onClick={() => onSelect(tab.id)} aria-current={activeView === tab.id ? 'page' : undefined}>
    {mobile && <Icon name={iconName} size={18} />}
    <span>{mobile ? tab.mobileLabel || tab.label : tab.label}</span>
    {tab.count > 0 && <span className={mobile ? 'mobile-tab-count' : 'tab-count'}>{tab.count}</span>}
  </button>
}

function StatusBadge({ status, children }) {
  const meta = STATUS[status] || STATUS.parking
  return <span className={`status-badge ${meta.tone}`}>{children || meta.label}</span>
}

function EmptyState({ title, detail }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name="clock" size={24} /></div><strong>{title}</strong><span>{detail}</span></div>
}

function WorkNumberField({ label, value, suffix, onChange }) {
  return <label className="work-field"><span>{label}</span><div><input type="number" min="0" inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} placeholder="—" /><small>{suffix}</small></div></label>
}

function ConfirmActionDialog({ title, detail, confirmLabel, danger = false, onConfirm, onClose }) {
  const dialogRef = useDialogFocus(onClose)
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="edit-modal confirm-action-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-action-title" tabIndex="-1">
      <div className="modal-heading"><div><span className="eyebrow">勤務時間の記録</span><h2 id="confirm-action-title">{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button></div>
      <p className="spot-confirm-help">{detail}</p>
      <div className="sheet-footer"><button type="button" className="secondary-button" onClick={onClose}>キャンセル</button><button type="button" className={danger ? 'delete-all-confirm-button' : 'primary-button'} onClick={onConfirm}>{confirmLabel}</button></div>
    </section>
  </div>
}

function WorkStoreCard({ config, data, restartRequired, restartRule, onPatch, onNotify }) {
  const hasArrival = Boolean(data.arrivalAt)
  const hasRestartStarted = Boolean(data.restartStartedAt)
  const hasRestartCompleted = Boolean(data.restartCompletedAt)
  const markArrival = () => {
    if (hasArrival) return
    onPatch({ arrivalAt: new Date().toISOString() })
    onNotify(`${config.label}の到着を記録しました`)
  }
  const markRestartStart = () => {
    if (!hasArrival || hasRestartStarted) return
    onPatch({ restartStartedAt: new Date().toISOString() })
    onNotify(`${config.label}の再起動開始を記録しました`)
  }
  const markRestartComplete = () => {
    if (!hasRestartStarted || hasRestartCompleted) return
    onPatch({ restartCompletedAt: new Date().toISOString() })
    onNotify(`${config.label}の復旧結果を記録しました`)
  }
  const markGreeting = () => {
    if (!hasArrival || data.greetingAt) return
    onPatch({ greetingAt: new Date().toISOString() })
    onNotify('店舗挨拶を記録しました')
  }

  return <article className={`work-store-card ${hasArrival ? 'is-started' : ''}`}>
    <div className="work-card-heading"><div><span className="work-step">{config.id === 'storeA' ? '1' : '2'}</span><div><h2>{config.label}</h2><span>{hasArrival ? `到着 ${formatTime(data.arrivalAt)}` : '未到着'}</span></div></div><StatusBadge status={hasArrival ? 'settled' : 'parking'}>{hasArrival ? '到着済み' : '待機中'}</StatusBadge></div>
    <button type="button" className={`work-main-button ${hasArrival ? 'completed' : ''}`} disabled={hasArrival} onClick={markArrival}>{hasArrival ? <><Icon name="check" size={19} />到着を記録済み</> : <><Icon name="plus" size={19} />{config.label}に到着</>}</button>
    {hasArrival && <div className="work-details">
      <div className="work-detail-grid">
        <WorkNumberField label="初期点検" value={data.inspectionSeconds} suffix="秒" onChange={(value) => onPatch({ inspectionSeconds: value })} />
        {config.hasCommute && <div className="work-choice"><span>移動手段</span><div>{COMMUTE_OPTIONS.map((choice) => <button key={choice} type="button" className={data.commute === choice ? 'selected' : ''} onClick={() => onPatch({ commute: choice })}>{choice}</button>)}</div></div>}
      </div>
      <section className={`work-restart ${hasRestartCompleted ? 'complete' : ''}`}>
        <div className="work-subheading"><strong>精算機の再起動</strong><span>{restartRequired ? (restartRule.id === 'saturday' ? '初期点検8秒以上' : '本日の対象日') : restartRule.id === 'saturday' ? '初期点検8秒未満' : '今日は対象外'}</span></div>
        {!restartRequired ? <p className="work-muted">{restartRule.id === 'saturday' ? '初期点検が8秒以上になった場合のみ再起動します。' : '今日は再起動の報告はありません。'}</p> : <>
          <button type="button" className="secondary-button work-wide-button" disabled={!hasArrival || hasRestartStarted} onClick={markRestartStart}>{hasRestartStarted ? '再起動開始を記録済み' : '再起動開始を記録'}</button>
          {hasRestartStarted && <><div className="work-restart-fields"><WorkNumberField label="再起動前" value={data.restartBeforeSeconds} suffix="秒" onChange={(value) => onPatch({ restartBeforeSeconds: value })} /><WorkNumberField label="再起動後" value={data.restartAfterSeconds} suffix="秒" onChange={(value) => onPatch({ restartAfterSeconds: value })} /><WorkNumberField label="QRリーダー" value={data.qrMinutes} suffix="分" onChange={(value) => onPatch({ qrMinutes: value })} /><WorkNumberField label="クレカ立ち上がり" value={data.creditMinutes} suffix="分" onChange={(value) => onPatch({ creditMinutes: value })} /><button type="button" className="primary-button work-wide-button" disabled={hasRestartCompleted} onClick={markRestartComplete}>{hasRestartCompleted ? <><Icon name="check" size={19} />復旧結果を記録済み</> : '復旧結果を記録'}</button></div><div className="work-message-options"><span>再起動後の一言（任意）</span><div>{RESTART_MESSAGES.map((message) => <button key={message} type="button" className={data.restartNote === message ? 'selected' : ''} onClick={() => onPatch({ restartNote: message })}>{message}</button>)}</div><input className="text-input" value={data.restartNote} onChange={(event) => onPatch({ restartNote: event.target.value })} placeholder="自由入力もできます" /></div></>}
        </>}
      </section>
      {config.id === 'storeB' && <section className="work-greeting"><div className="work-subheading"><strong>店舗挨拶・サービス券</strong><span>{data.greetingAt ? `完了 ${formatTime(data.greetingAt)}` : '未完了'}</span></div><button type="button" className="secondary-button work-wide-button" disabled={Boolean(data.greetingAt)} onClick={markGreeting}>{data.greetingAt ? '店舗挨拶を記録済み' : '店舗挨拶を記録'}</button>{data.greetingAt && <WorkNumberField label="サービス券預かり" value={data.serviceTickets} suffix="枚" onChange={(value) => onPatch({ serviceTickets: value })} />}</section>}
    </div>}
  </article>
}

function WorkScheduleCard({ schedule, onPatch, onNotify }) {
  const [pendingAction, setPendingAction] = useState(null)
  const items = [
    { key: 'startedAt', label: '10:00 勤務開始', detail: '配置につきました' },
    { key: 'breakAt', label: '12:00 休憩開始', detail: '配置一時解除' },
    { key: 'resumedAt', label: '15:00 業務再開', detail: '配置につきました' },
    { key: 'endedAt', label: '18:00 勤務終了', detail: '配置解除・店舗挨拶完了' },
  ]
  const applyAction = (item, action) => {
    if (action === 'remove') {
      onPatch({ [item.key]: null })
      onNotify(`${item.label}の記録を取り消しました`)
    } else {
      onPatch({ [item.key]: new Date().toISOString() })
      onNotify(`${item.label}を記録しました`)
    }
    setPendingAction(null)
  }
  const mark = (item) => {
    if (schedule[item.key]) {
      setPendingAction({
        item,
        action: 'remove',
        title: `${item.label}を取り消しますか？`,
        detail: '記録した時刻が削除され、勤務報告にも含まれなくなります。',
        confirmLabel: '記録を取り消す',
        danger: true,
      })
      return
    }

    const itemIndex = items.findIndex(({ key }) => key === item.key)
    const missingPrevious = items.slice(0, itemIndex).filter(({ key }) => !schedule[key])
    if (missingPrevious.length > 0) {
      const missingLabels = missingPrevious.map(({ label }) => label).join('、')
      setPendingAction({
        item,
        action: 'record',
        title: `${item.label}を先に記録しますか？`,
        detail: `${missingLabels}が未記録です。順番を確認してから進めてください。`,
        confirmLabel: 'このまま記録',
        danger: false,
      })
      return
    }

    applyAction(item, 'record')
  }
  return <>
    <article className="work-schedule-card"><div className="section-heading work-heading"><div><h2>勤務時間</h2><p>現場で押した時刻を保存し、報告文に反映します。</p></div></div><div className="work-schedule-grid">{items.map((item) => <button key={item.key} type="button" className={`work-schedule-button ${schedule[item.key] ? 'completed' : ''}`} onClick={() => mark(item)} aria-label={schedule[item.key] ? `${item.label}の記録を取り消す` : item.label}><span>{schedule[item.key] ? <Icon name="check" size={19} /> : <span className="schedule-time">{item.label.slice(0, 5)}</span>}</span><strong>{schedule[item.key] ? `${item.label} 済` : item.label}</strong><small>{schedule[item.key] ? `記録 ${formatTime(schedule[item.key])}・タップで取り消し` : item.detail}</small></button>)}</div><div className="work-counts"><WorkNumberField label="店舗駐車券預り" value={schedule.parkingTickets} suffix="枚" onChange={(value) => onPatch({ parkingTickets: value })} /><WorkNumberField label="お客様から返却" value={schedule.returnedTickets} suffix="枚" onChange={(value) => onPatch({ returnedTickets: value })} /><WorkNumberField label="お客様へ配布" value={schedule.distributedTickets} suffix="枚" onChange={(value) => onPatch({ distributedTickets: value })} /></div><div className="work-message-options work-general-message"><span>途中の報告（任意）</span><div>{COMMON_WORK_MESSAGES.map((message) => <button key={message} type="button" className={schedule.extraMessage === message ? 'selected' : ''} onClick={() => onPatch({ extraMessage: message })}>{message}</button>)}</div><input className="text-input" value={schedule.extraMessage} onChange={(event) => onPatch({ extraMessage: event.target.value })} placeholder="自由入力もできます" /></div><label className="field-label work-memo-label" htmlFor="work-finish-memo">終了時の補足（任意）</label><textarea id="work-finish-memo" className="text-input memo-input" value={schedule.finishMemo} onChange={(event) => onPatch({ finishMemo: event.target.value })} rows="2" placeholder="例：サービス券受取が少なかったため配布数が増加" /></article>
    {pendingAction && <ConfirmActionDialog title={pendingAction.title} detail={pendingAction.detail} confirmLabel={pendingAction.confirmLabel} danger={pendingAction.danger} onConfirm={() => applyAction(pendingAction.item, pendingAction.action)} onClose={() => setPendingAction(null)} />}
  </>
}

function WorkReportView({ report, storeConfigs, restartRule, lineText, onStorePatch, onSchedulePatch, onNotify, onGenerate, onCopy }) {
  const restartRequiredByStore = storeConfigs.map((config) => shouldRestartForStore(restartRule, report.stores[config.id]))
  const hasRestartTarget = restartRequiredByStore.some(Boolean)
  return <section className="view-section" aria-labelledby="work-heading"><div className="section-heading"><div><h1 id="work-heading">勤務報告</h1><p>店舗の到着・再起動・休憩・終了を順番に記録します。</p></div><span className={`section-count ${hasRestartTarget ? 'restart-day-label' : ''}`}>{restartRule.required ? '本日は再起動日' : restartRule.id === 'saturday' ? (hasRestartTarget ? '再起動対象あり' : '初期点検で判定') : '再起動なし'}</span></div><div className={`work-rule-banner ${hasRestartTarget ? 'restart' : ''}`}><span className="tip-icon">!</span><span><strong>{restartRule.label}</strong><br />{storeConfigs.map((config) => config.label).join(' → ')} → 10:00開始 → 12:00休憩 → 15:00再開 → 18:00終了</span></div><div className="work-store-list">{storeConfigs.map((config, index) => <WorkStoreCard key={config.id} config={config} data={report.stores[config.id]} restartRequired={restartRequiredByStore[index]} restartRule={restartRule} onPatch={(patch) => onStorePatch(config.id, patch)} onNotify={onNotify} />)}</div><WorkScheduleCard schedule={report.schedule} onPatch={onSchedulePatch} onNotify={onNotify} /><div className="line-tools work-line-tools"><div><strong>勤務報告を作成</strong><span>現在記録されている内容だけで文章をまとめます。</span></div><button type="button" className="line-button" onClick={onGenerate}><span className="line-mark">LINE</span>報告文を生成</button></div>{lineText && <div className="line-output work-line-output"><div className="line-output-heading"><strong>生成された勤務報告</strong><button type="button" className="copy-button" onClick={onCopy}><Icon name="copy" size={17} />コピー</button></div><textarea readOnly value={lineText} aria-label="勤務報告用テキスト" /></div>}</section>
}

function SettingsSheet({ settings, onSave, onClose }) {
  const dialogRef = useDialogFocus(onClose)
  const [form, setForm] = useState({
    storeA: settings.storeLabels.storeA,
    storeB: settings.storeLabels.storeB,
  })
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const submit = (event) => {
    event.preventDefault()
    onSave({ storeLabels: { storeA: form.storeA.trim() || '店舗A', storeB: form.storeB.trim() || '店舗B' } })
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-sheet-title" tabIndex="-1">
      <div className="sheet-handle" />
      <div className="sheet-heading"><div><span className="eyebrow">端末内に保存</span><h2 id="settings-sheet-title">店舗名設定</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button></div>
      <p className="spot-confirm-help">店舗名は公開ページやコードには保存されず、この端末のブラウザ内だけに保存されます。</p>
      <form onSubmit={submit}>
        <div className="form-grid"><label className="field-label">1店舗目<input data-dialog-initial-focus className="text-input" type="text" value={form.storeA} onChange={(event) => update('storeA', event.target.value)} placeholder="例：店舗A" /></label><label className="field-label">2店舗目<input className="text-input" type="text" value={form.storeB} onChange={(event) => update('storeB', event.target.value)} placeholder="例：店舗B" /></label></div>
        <div className="sheet-footer"><button type="button" className="secondary-button" onClick={onClose}>キャンセル</button><button type="submit" className="primary-button">店舗名を保存</button></div>
      </form>
    </section>
  </div>
}

function RecordRow({ record, now, action, actionLabel, actionTone = 'primary', onNote, onReport, onEdit, onDelete }) {
  const elapsed = getElapsedSeconds(record, now)
  const overLimit = elapsed > 90
  const notes = getNotes(record)
  return <article className={`record-row ${overLimit ? 'is-over-limit' : ''}`}>
    <div className="row-main">
      <div className={`spot-number ${getRecordSpot(record) ? '' : 'unknown'}`}><span>{getRecordSpotLabel(record)}</span></div>
      <div className="row-data">
        <div className="row-topline"><StatusBadge status={record.status} />{record.lineReportedAt && <span className="result-label completed-result">報告済み</span>}{overLimit && <span className="result-label warning">90秒超</span>}</div>
        <div className="metric-line"><span><small>経過</small><strong>{elapsed}秒</strong></span><span><small>証明書発行</small><strong>{formatTime(record.issuedAt)}</strong></span>{record.status !== 'parking' && <span><small>精算</small><strong>{formatTime(record.settledAt)}</strong></span>}</div>
        {notes && <div className="row-note"><Icon name="note" size={15} />{notes}</div>}
      </div>
      {action && <button type="button" className={`action-button ${actionTone}`} onClick={() => action(record)}>{actionLabel}</button>}
    </div>
    {(onNote || onReport || onEdit || onDelete) && <div className="row-actions">
      {onNote && <button type="button" className="subtle-button" onClick={() => onNote(record)}><Icon name="note" size={16} />メモ</button>}
      {onReport && <button type="button" className="subtle-button" onClick={() => onReport(record)}><Icon name="note" size={16} />報告設定</button>}
      {onEdit && <button type="button" className="subtle-button" onClick={() => onEdit(record)}><Icon name="edit" size={16} />編集</button>}
      {onDelete && <button type="button" className="subtle-button danger" onClick={() => onDelete(record)}><Icon name="trash" size={16} />削除</button>}
    </div>}
  </article>
}

function ParkingGrid({ records, onStart, onOpenRecord }) {
  const occupied = new Map(records.filter((record) => record.status !== 'settled' && getRecordSpot(record)).map((record) => [getRecordSpot(record), record]))
  return <div className="parking-layout" aria-label="駐車位置番号の実際の配置">
    {PARKING_SPOT_COLUMNS.map((column, columnIndex) => <div key={columnIndex} className={`parking-column ${columnIndex === 0 ? 'left' : 'right'}`}>
      {column.map((spot) => {
        const record = occupied.get(spot)
        const statusLabel = record ? (record.status === 'parking' ? '対応中' : '待ち') : null
        return <button key={spot} type="button" className={`spot-button ${record?.status === 'parking' ? 'active' : ''} ${record?.status === 'issued' ? 'waiting' : ''}`} onClick={() => record ? onOpenRecord(record) : onStart(spot)} aria-label={`${spot}番${record ? `・${statusLabel}・詳細を開く` : '・新しく記録開始'}`}>
          <strong>{spot}</strong>
          {record && <small>{statusLabel}</small>}
        </button>
      })}
    </div>)}
  </div>
}

function SpotConfirmSheet({ record, onConfirm, onClose }) {
  const dialogRef = useDialogFocus(onClose)
  const initialSpot = getRecordSpot(record)
  const [spot, setSpot] = useState(initialSpot || '')
  if (!record) return null
  const hasKnownSpot = Boolean(initialSpot)
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="bottom-sheet spot-confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="spot-confirm-title" tabIndex="-1">
      <div className="sheet-handle" />
      <div className="sheet-heading"><div><span className="eyebrow">証明書発行と同時に確定</span><h2 id="spot-confirm-title">番号を入力して発行</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button></div>
      <p className="spot-confirm-help">利用者さまに駐車位置番号を確認し、入力してから発行を確定してください。開始時の番号が違っていても修正できます。</p>
      {hasKnownSpot && <p className="spot-confirm-started">開始時の番号：<strong>{formatSpotLabel(initialSpot)}</strong></p>}
      <label className="field-label" htmlFor="certificate-spot">駐車位置番号（入力必須・数字／英字）</label>
      <input id="certificate-spot" data-dialog-initial-focus className="text-input spot-confirm-input" type="text" inputMode="numeric" value={spot} onChange={(event) => setSpot(event.target.value)} placeholder="例：17（直接入力する場合）" />
      <div className="spot-quick-layout" aria-label="駐車位置番号の候補">{PARKING_SPOT_COLUMNS.map((column, columnIndex) => <div key={columnIndex} className="spot-quick-column"><span className="spot-quick-column-label">{columnIndex === 0 ? '左側 1〜8' : '右側 21〜9'}</span><div className="spot-quick-column-buttons">{column.map((quickSpot) => <button key={quickSpot} type="button" className={spot === quickSpot ? 'selected' : ''} onClick={() => setSpot(quickSpot)}>{quickSpot}</button>)}</div></div>)}</div>
      <div className="spot-confirm-actions"><button type="button" className="primary-button" disabled={!normalizeSpot(spot)} onClick={() => onConfirm(record.id, spot)}>{spot ? `${formatSpotLabel(spot)}で発行確定` : '番号を入力してください'}</button><button type="button" className="exception-button" onClick={() => onConfirm(record.id, '')}>番号不明のまま発行（例外）</button></div>
    </section>
  </div>
}

function NoteSheet({ record, onSave, onClose }) {
  const dialogRef = useDialogFocus(onClose)
  const [presets, setPresets] = useState(record?.notePresets || [])
  const [memo, setMemo] = useState(record?.memo || '')
  if (!record) return null
  const togglePreset = (note) => setPresets((current) => current.includes(note) ? current.filter((item) => item !== note) : [...current, note])
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="note-sheet-title" tabIndex="-1">
      <div className="sheet-handle" />
      <div className="sheet-heading"><div><span className="eyebrow">{getRecordSpotLabel(record)}の記録</span><h2 id="note-sheet-title">例外メモを選択</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button></div>
      <div className="note-options">{COMMON_NOTES.map((note) => <button key={note} type="button" className={`note-option ${presets.includes(note) ? 'selected' : ''}`} onClick={() => togglePreset(note)}>{presets.includes(note) && <Icon name="check" size={18} />}{note}</button>)}</div>
      <label className="field-label" htmlFor="free-memo">自由メモ（任意）</label>
      <textarea id="free-memo" className="text-input memo-input" value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="メモを入力してください" rows="3" />
      <div className="sheet-footer"><button type="button" className="secondary-button" onClick={onClose}>キャンセル</button><button type="button" className="primary-button" onClick={() => onSave(record.id, { notePresets: presets, memo })}>メモを保存</button></div>
    </section>
  </div>
}

function ReportSheet({ record, onSave, onClose }) {
  const dialogRef = useDialogFocus(onClose)
  const [reportType, setReportType] = useState(record?.reportType || 'normal')
  const [flags, setFlags] = useState(normalizeReportFlags(record?.reportFlags))
  const [reportMemo, setReportMemo] = useState(record?.reportMemo || '')
  if (!record) return null
  const toggleFlag = (flag) => setFlags((current) => ({ ...current, [flag]: !current[flag] }))
  const visibleFlags = reportType === 'issuanceDefect' ? REPORT_FLAGS.filter((flag) => flag.id === 'issuanceFailedOnce') : REPORT_FLAGS.filter((flag) => flag.id !== 'issuanceFailedOnce')
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="report-sheet-title" tabIndex="-1">
      <div className="sheet-handle" />
      <div className="sheet-heading"><div><span className="eyebrow">{getRecordSpotLabel(record)}の退店後報告</span><h2 id="report-sheet-title">LINE報告パターン</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button></div>
      <p className="spot-confirm-help">精算後、必要に応じて選択してください。選んだ形式と補足は、この記録のLINE報告に反映されます。</p>
      <div className="report-options" aria-label="LINE報告パターン">
        {REPORT_TYPES.map((type) => <button key={type.id} type="button" className={`report-type-option ${reportType === type.id ? 'selected' : ''}`} aria-pressed={reportType === type.id} onClick={() => setReportType(type.id)}><strong>{type.label}</strong><small>{type.description}</small></button>)}
      </div>
      {reportType !== 'normal' && reportType !== 'serviceTicket' && <>
        <div className="field-label">報告に含める内容</div>
        <div className="report-flag-options">{visibleFlags.map((flag) => <button key={flag.id} type="button" className={`report-flag-option ${flags[flag.id] ? 'selected' : ''}`} aria-pressed={Boolean(flags[flag.id])} onClick={() => toggleFlag(flag.id)}>{flags[flag.id] && <Icon name="check" size={16} />}{flag.label}</button>)}</div>
      </>}
      <label className="field-label" htmlFor="report-memo">報告に追加する補足（任意）</label>
      <textarea id="report-memo" className="text-input memo-input" value={reportMemo} onChange={(event) => setReportMemo(event.target.value)} rows="3" placeholder="例：店内でサービス券を受け取られていました" />
      <div className="sheet-footer"><button type="button" className="secondary-button" onClick={onClose}>キャンセル</button><button type="button" className="primary-button" onClick={() => onSave(record.id, { reportType, reportFlags: flags, reportMemo })}>報告設定を保存</button></div>
    </section>
  </div>
}

function EditModal({ record, onSave, onDelete, onClose }) {
  const dialogRef = useDialogFocus(onClose)
  const [form, setForm] = useState({
    spot: record.spot,
    startedAt: formatDateTimeInput(record.startedAt),
    issuedAt: formatDateTimeInput(record.issuedAt),
    settledAt: formatDateTimeInput(record.settledAt),
    notePresets: record.notePresets || [],
    memo: record.memo || '',
  })
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const togglePreset = (note) => update('notePresets', form.notePresets.includes(note) ? form.notePresets.filter((item) => item !== note) : [...form.notePresets, note])
  const submit = (event) => {
    event.preventDefault()
    const spot = normalizeSpot(form.spot)
    const startedAt = resolveEditedDateTimeInput(form.startedAt, record.startedAt) || record.startedAt
    const issuedAt = resolveEditedDateTimeInput(form.issuedAt, record.issuedAt)
    const settledAt = resolveEditedDateTimeInput(form.settledAt, record.settledAt)
    onSave(record.id, { spot, startedSpot: record.startedSpot || spot, spotConfirmedAt: issuedAt ? (record.spotConfirmedAt || issuedAt) : null, spotSource: spot ? 'edit' : 'unknown', startedAt, issuedAt, settledAt, exitCompletedAt: settledAt ? record.exitCompletedAt : null, lineReportedAt: settledAt ? record.lineReportedAt : null, status: settledAt ? 'settled' : issuedAt ? 'issued' : 'parking', notePresets: form.notePresets, memo: form.memo })
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title" tabIndex="-1">
      <div className="modal-heading"><div><span className="eyebrow">記録を修正</span><h2 id="edit-modal-title">{getRecordSpotLabel(record)}の詳細</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button></div>
      <form onSubmit={submit}>
        <div className="form-grid"><label className="field-label">駐車位置番号<input data-dialog-initial-focus className="text-input" type="text" inputMode="numeric" placeholder="未入力でも可" value={form.spot || ''} onChange={(event) => update('spot', event.target.value)} /></label><label className="field-label">駐車開始<input className="text-input" type="datetime-local" step="1" value={form.startedAt} onChange={(event) => update('startedAt', event.target.value)} /></label><label className="field-label">証明書発行<input className="text-input" type="datetime-local" step="1" value={form.issuedAt} onChange={(event) => update('issuedAt', event.target.value)} /></label><label className="field-label">精算時刻<input className="text-input" type="datetime-local" step="1" value={form.settledAt} onChange={(event) => update('settledAt', event.target.value)} /></label></div>
        <div className="field-label">例外メモ</div><div className="note-options compact">{COMMON_NOTES.map((note) => <button key={note} type="button" className={`note-option ${form.notePresets.includes(note) ? 'selected' : ''}`} onClick={() => togglePreset(note)}>{form.notePresets.includes(note) && <Icon name="check" size={16} />}{note}</button>)}</div>
        <label className="field-label" htmlFor="edit-memo">自由メモ</label><textarea id="edit-memo" className="text-input memo-input" value={form.memo} onChange={(event) => update('memo', event.target.value)} rows="3" placeholder="メモを入力してください" />
        <div className="modal-footer"><button type="button" className="subtle-button danger delete-record" onClick={() => onDelete(record)}>この記録を削除</button><div className="footer-right"><button type="button" className="secondary-button" onClick={onClose}>キャンセル</button><button type="submit" className="primary-button">変更を保存</button></div></div>
      </form>
    </section>
  </div>
}

function DeleteAllDialog({ count, onConfirm, onClose }) {
  const dialogRef = useDialogFocus(onClose)
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="edit-modal delete-all-modal" role="dialog" aria-modal="true" aria-labelledby="delete-all-title" tabIndex="-1">
      <div className="modal-heading"><div><span className="eyebrow">当日の履歴</span><h2 id="delete-all-title">履歴を全件削除しますか？</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button></div>
      <p className="spot-confirm-help">精算済みの履歴{count}件を削除します。駐車中・精算待ちの記録は残ります。</p>
      <div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>キャンセル</button><button type="button" className="delete-all-confirm-button" onClick={onConfirm}><Icon name="trash" size={17} />削除する</button></div>
    </section>
  </div>
}

function App() {
  const [todayKey, setTodayKey] = useState(() => getDateKey())
  const todayKeyRef = useRef(todayKey)
  const [now, setNow] = useState(Date.now())
  const restartRule = getRestartRule(new Date(now))
  const [settings, setSettings] = useState(() => loadSettings())
  const [records, setRecords] = useState(() => loadRecords(todayKey))
  const [workReport, setWorkReport] = useState(() => loadWorkReport(todayKey))
  const [activeView, setActiveView] = useState('record')
  const [noteRecord, setNoteRecord] = useState(null)
  const [reportRecord, setReportRecord] = useState(null)
  const [editRecord, setEditRecord] = useState(null)
  const [issueRecord, setIssueRecord] = useState(null)
  const [lineText, setLineText] = useState('')
  const [lineReportTargetIds, setLineReportTargetIds] = useState([])
  const [workLineText, setWorkLineText] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deleteAllOpen, setDeleteAllOpen] = useState(false)
  const [toast, setToast] = useState('')

  const storeConfigs = useMemo(() => WORK_STORES.map((config) => {
    const label = settings.storeLabels[config.id] || config.defaultLabel
    return { ...config, label, arrivalText: config.id === 'storeB' ? `ただいま、${label}に到着しました。` : config.arrivalText }
  }), [settings])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextNow = Date.now()
      const nextDateKey = getDateKey(new Date(nextNow))
      setNow(nextNow)
      if (nextDateKey === todayKeyRef.current) return

      todayKeyRef.current = nextDateKey
      setTodayKey(nextDateKey)
      setRecords(loadRecords(nextDateKey))
      setWorkReport(loadWorkReport(nextDateKey))
      setToast('日付が変わったため、新しい日の記録へ切り替えました')
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}${todayKey}`, JSON.stringify(records))
  }, [records, todayKey])

  useEffect(() => {
    localStorage.setItem(`${WORK_STORAGE_PREFIX}${todayKey}`, JSON.stringify(workReport))
  }, [todayKey, workReport])

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    setLineText('')
    setLineReportTargetIds([])
  }, [records])

  useEffect(() => {
    setWorkLineText('')
  }, [workReport])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    // Native Android builds use the bundled files directly. Keeping a Service
    // Worker there can make an app update continue serving the previous bundle.
    if (!import.meta.env.PROD) return
    if (Capacitor.isNativePlatform()) return
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  }, [])

  const parkingRecords = useMemo(() => records.filter((record) => record.status === 'parking').sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt)), [records])
  const issuedRecords = useMemo(() => records.filter((record) => record.status === 'issued').sort((a, b) => new Date(a.issuedAt) - new Date(b.issuedAt)), [records])
  const settledRecords = useMemo(() => records.filter((record) => record.status === 'settled').sort((a, b) => new Date(b.settledAt || b.startedAt) - new Date(a.settledAt || a.startedAt)), [records])

  const notify = (message) => setToast(message)
  const updateRecord = (id, patch) => setRecords((current) => current.map((record) => record.id === id ? { ...record, ...patch } : record))
  const updateWorkStore = (storeId, patch) => setWorkReport((current) => ({ ...current, stores: { ...current.stores, [storeId]: { ...current.stores[storeId], ...patch } } }))
  const updateWorkSchedule = (patch) => setWorkReport((current) => ({ ...current, schedule: { ...current.schedule, ...patch } }))

  const startRecord = (spot) => {
    const normalizedSpot = normalizeSpot(spot)
    const occupied = records.some((record) => getRecordSpot(record) === normalizedSpot && record.status !== 'settled')
    if (occupied) return notify(`${formatSpotLabel(normalizedSpot)}は現在対応中です`)
    const record = { id: makeId(), spot: normalizedSpot, startedSpot: normalizedSpot, unknownLabel: null, spotConfirmedAt: null, spotSource: normalizedSpot ? 'start' : 'unknown', startedAt: new Date().toISOString(), issuedAt: null, settledAt: null, exitCompletedAt: null, lineReportedAt: null, reportType: 'normal', reportFlags: normalizeReportFlags(), reportMemo: '', status: 'parking', notePresets: [], memo: '' }
    setRecords((current) => [...current, record])
    notify(`${formatSpotLabel(normalizedSpot, '番号未入力')}のタイマーを開始しました`)
  }

  const startUnknownRecord = () => {
    const unknownLabel = String(records.filter((record) => !getRecordSpot(record) && record.status !== 'settled').length + 1)
    const record = { id: makeId(), spot: null, startedSpot: null, unknownLabel, spotConfirmedAt: null, spotSource: 'unknown', startedAt: new Date().toISOString(), issuedAt: null, settledAt: null, exitCompletedAt: null, lineReportedAt: null, reportType: 'normal', reportFlags: normalizeReportFlags(), reportMemo: '', status: 'parking', notePresets: [], memo: '' }
    setRecords((current) => [...current, record])
    notify(`番号未入力 #${unknownLabel}のタイマーを開始しました`)
  }

  const issueCertificate = (record) => {
    setIssueRecord(record)
  }

  const confirmCertificateIssue = (id, rawSpot) => {
    const current = records.find((record) => record.id === id)
    if (!current) return
    const inputSpot = normalizeSpot(rawSpot)
    const nextSpot = inputSpot || getRecordSpot(current)
    const duplicated = nextSpot && records.some((record) => record.id !== id && record.status !== 'settled' && getRecordSpot(record) === nextSpot)
    if (duplicated) {
      notify(`${formatSpotLabel(nextSpot)}は現在対応中です。番号を確認してください`)
      return
    }
    const issuedAt = new Date().toISOString()
    updateRecord(id, { spot: nextSpot, spotConfirmedAt: nextSpot ? issuedAt : null, spotSource: nextSpot ? 'issue' : 'unknown', issuedAt, status: 'issued' })
    setIssueRecord(null)
    notify(`${formatSpotLabel(nextSpot)}・${getElapsedSeconds({ ...current, issuedAt }, Date.now())}秒で発行を記録しました`)
  }

  const settleRecord = (record) => {
    const settledAt = new Date().toISOString()
    updateRecord(record.id, { settledAt, exitCompletedAt: settledAt, lineReportedAt: null, status: 'settled' })
    notify(`${getRecordSpotLabel(record)}の精算を記録しました`)
  }

  const saveNotes = (id, patch) => {
    const current = records.find((record) => record.id === id)
    if (!current) return
    updateRecord(id, { ...patch, exitCompletedAt: current.exitCompletedAt, lineReportedAt: null })
    setNoteRecord(null)
    notify('メモを保存しました')
  }

  const saveReportSettings = (id, patch) => {
    updateRecord(id, { reportType: patch.reportType || 'normal', reportFlags: normalizeReportFlags(patch.reportFlags), reportMemo: patch.reportMemo || '', lineReportedAt: null })
    setReportRecord(null)
    notify('LINE報告の形式を保存しました')
  }

  const saveEdit = (id, patch) => {
    const current = records.find((record) => record.id === id)
    const nextSpot = normalizeSpot(patch.spot)
    const duplicated = current && patch.status !== 'settled' && nextSpot && records.some((record) => record.id !== id && record.status !== 'settled' && getRecordSpot(record) === nextSpot)
    if (duplicated) {
      notify(`${formatSpotLabel(nextSpot)}は現在対応中です。番号を確認してください`)
      return
    }
    updateRecord(id, { ...patch, lineReportedAt: null })
    setEditRecord(null)
    notify(`${formatSpotLabel(nextSpot, '番号未入力')}の記録を更新しました`)
  }

  const deleteRecord = (record) => {
    if (!window.confirm(`${getRecordSpotLabel(record)}の記録を削除しますか？\nこの操作は元に戻せません。`)) return
    setRecords((current) => current.filter((item) => item.id !== record.id))
    setEditRecord(null)
    setNoteRecord(null)
    setReportRecord(null)
    setIssueRecord(null)
    setLineText('')
    setLineReportTargetIds([])
    notify('記録を削除しました。LINE報告を再生成してください')
  }

  const deleteAllSettledRecords = () => {
    if (settledRecords.length === 0) {
      setDeleteAllOpen(false)
      return
    }
    const count = settledRecords.length
    const settledIds = new Set(settledRecords.map((record) => record.id))
    setRecords((current) => current.filter((record) => !settledIds.has(record.id)))
    setDeleteAllOpen(false)
    setEditRecord(null)
    setNoteRecord(null)
    setReportRecord(null)
    setIssueRecord(null)
    setLineText('')
    setLineReportTargetIds([])
    notify(`${count}件の履歴を削除しました`)
  }

  const generateLineText = () => {
    if (!workReport.schedule.endedAt) {
      const storeLabel = storeConfigs.find((config) => config.id === 'storeB').label
      setLineReportTargetIds([])
      setLineText([`【${storeLabel}】`, 'お疲れ様です。', '1分30秒以内の件は、シフト終了後にまとめて報告します。', '18:00勤務終了を記録してから生成してください。'].join('\n'))
      notify('90秒以内の一括報告はシフト終了後です')
      return
    }
    // 90秒以内は、シフト終了後に未報告分をまとめて対象にする。
    const reportRecords = settledRecords.filter((record) => getElapsedSeconds(record, now) <= 90 && !record.lineReportedAt)
    const storeLabel = storeConfigs.find((config) => config.id === 'storeB').label
    const sortedRecords = [...reportRecords].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
    const normalRecords = sortedRecords.filter((record) => !record.reportType || record.reportType === 'normal')
    const detailedRecords = sortedRecords.filter((record) => record.reportType && record.reportType !== 'normal')
    const recordsText = normalRecords.map((record) => {
      const elapsedText = record.issuedAt ? `駐車→証明書発行${getElapsedSeconds(record, now)}秒` : '駐車→証明書発行できず'
      const issuedText = record.issuedAt ? `${formatTime(record.issuedAt).replace(':', '：')}…証明書発行` : `${formatTime(record.startedAt).replace(':', '：')}…証明書発行できず`
      const settledText = record.settledAt ? `${formatTime(record.settledAt).replace(':', '：')}…精算` : '精算時間不明'
      const noteText = getNotes(record) ? `＊${getNotes(record)}` : ''
      return [`・駐車位置番号:${formatSpotLabel(getRecordSpot(record), '番号未入力')}`, elapsedText, issuedText, `${settledText}${noteText}`].join('\n')
    }).join('\n\n')
    const sections = []
    if (normalRecords.length > 0) {
      const hasException = normalRecords.some((record) => Boolean(getNotes(record)))
      const reportHeader = [`【${storeLabel}】`, 'お疲れ様です。', hasException ? '1分30秒以内の記録ですが、例外メモがあります。' : '1分30秒以内の件ですが問題なく発行されております。'].join('\n')
      sections.push(`${reportHeader}${recordsText ? `\n\n${recordsText}` : ''}`)
    }
    detailedRecords.forEach((record) => sections.push(buildDetailedReportText(record, storeLabel)))
    if (sections.length === 0) {
      sections.push([`【${storeLabel}】`, 'お疲れ様です。', '報告待ちの1分30秒以内の記録はありません。'].join('\n'))
    }
    setLineReportTargetIds(reportRecords.map((record) => record.id))
    setLineText(sections.join('\n\n\n'))
    notify(reportRecords.length > 0 ? `${reportRecords.length}件のシフト終了後報告を生成しました` : '報告待ちの記録はありません')
  }

  const generateImmediateLineText = (record) => {
    if (getElapsedSeconds(record, now) <= 90) return notify('90秒以内の件はシフト終了後にまとめて報告します')
    if (record.lineReportedAt) return notify('この記録はすでに報告済みです')
    const storeLabel = storeConfigs.find((config) => config.id === 'storeB').label
    setLineReportTargetIds([record.id])
    setLineText(buildImmediateLineText(record, storeLabel))
    notify(`${getRecordSpotLabel(record)}の都度報告用テキストを生成しました`)
  }

  const copyLineText = async () => {
    await copyToClipboard(lineText)
    if (lineReportTargetIds.length > 0) {
      const reportedAt = new Date().toISOString()
      setRecords((current) => current.map((record) => lineReportTargetIds.includes(record.id) ? { ...record, lineReportedAt: reportedAt } : record))
      setLineReportTargetIds([])
      notify('コピーしました。報告済みにしました')
      return
    }
    notify('クリップボードにコピーしました')
  }

  const generateWorkLineText = () => {
    setWorkLineText(buildWorkLineText(workReport, storeConfigs))
    notify('勤務報告を生成しました')
  }

  const saveSettings = (nextSettings) => {
    setSettings(nextSettings)
    setSettingsOpen(false)
    setLineText('')
    setLineReportTargetIds([])
    setWorkLineText('')
    notify('店舗名を端末内に保存しました')
  }

  const copyWorkLineText = async () => {
    await copyToClipboard(workLineText)
    notify('クリップボードにコピーしました')
  }

  const tabItems = [
    { id: 'record', label: '記録' },
    { id: 'work', label: '勤務報告' },
    { id: 'issued', label: '発行済み・精算待ち', mobileLabel: '精算待ち', count: issuedRecords.length },
    { id: 'history', label: '履歴', count: settledRecords.length },
  ]
  const primaryTabItems = tabItems.filter((tab) => tab.id !== 'work')

  return <div className="app-shell">
    <header className="app-header"><div className="brand-mark"><span className="brand-dot" /><span>精算機補助</span></div><div className="header-date">{formatDateLabel()}</div><button type="button" className="help-button" aria-label="店舗名設定を開く" onClick={() => setSettingsOpen(true)}>⚙</button></header>
    <nav className="tab-nav" aria-label="メインメニュー">{tabItems.map((tab) => <NavigationTab key={tab.id} tab={tab} activeView={activeView} onSelect={setActiveView} />)}</nav>
    <main className="main-content">
      <div className="day-banner"><span><Icon name="clock" size={18} />本日 {formatDateLabel()}</span><div className="day-banner-actions"><button type="button" onClick={() => { setRecords(loadRecords(todayKey)); setWorkReport(loadWorkReport(todayKey)); notify('保存データを読み込みました') }}><Icon name="refresh" size={17} />更新</button><button type="button" className={`secondary-nav-button ${activeView === 'work' ? 'active' : ''}`} onClick={() => setActiveView('work')}><Icon name="note" size={15} />勤務報告</button></div></div>

      {activeView === 'record' && <section className="view-section" aria-labelledby="record-heading">
        <div className="section-heading"><div><h1 id="record-heading">駐車番号を選択</h1><p>番号が分かるときはタップ。分からないときは発行時に入力できます。</p></div><span className="section-count">対応中 {parkingRecords.length}件</span></div>
        {parkingRecords.length > 0 && <div className="active-panel"><div className="active-panel-heading"><span className="live-dot" />タイマー動作中（発行時に番号入力）</div>{parkingRecords.map((record) => <div className="active-record" key={record.id}><div className="active-summary"><strong className={!getRecordSpot(record) ? 'unknown' : ''}>{getRecordSpotLabel(record)}</strong><div><StatusBadge status="parking" /><div className="active-time">{getElapsedSeconds(record, now)}<small>秒</small><span>{formatDuration(getElapsedSeconds(record, now))}</span></div></div></div><div className="active-actions"><button type="button" className="primary-button issue-button" onClick={() => issueCertificate(record)}><Icon name="check" size={20} /><span>証明書発行＋番号入力</span></button><div className="active-more-actions"><button type="button" className="secondary-button note-button" onClick={() => setNoteRecord(record)}><Icon name="note" size={16} />メモ</button><button type="button" className="secondary-button note-button" onClick={() => setEditRecord(record)}><Icon name="edit" size={16} />編集</button><button type="button" className="secondary-button note-button danger" onClick={() => deleteRecord(record)}><Icon name="trash" size={16} />削除</button></div></div></div>)}</div>}
        <div className="parking-area"><div className="area-heading"><h2>駐車位置番号</h2><span>左 1〜8　右 21〜9</span></div><button type="button" className="unknown-start-button" onClick={startUnknownRecord}><Icon name="plus" size={20} /><span><strong>番号未入力でタイマー開始</strong><small>駐車証明発行時に番号を入力</small></span></button><ParkingGrid records={records} onStart={startRecord} onOpenRecord={setEditRecord} /></div>
        {parkingRecords.length === 0 && <EmptyState title="タイマー動作中の車両はありません" detail="車が駐車したら、番号ボタンまたは番号未入力で開始を押してください。" />}
      </section>}

      {activeView === 'work' && <WorkReportView report={workReport} storeConfigs={storeConfigs} restartRule={restartRule} lineText={workLineText} onStorePatch={updateWorkStore} onSchedulePatch={updateWorkSchedule} onNotify={notify} onGenerate={generateWorkLineText} onCopy={copyWorkLineText} />}

      {activeView === 'issued' && <section className="view-section" aria-labelledby="issued-heading"><div className="section-heading"><div><h1 id="issued-heading">発行済み・精算待ち</h1><p>証明書を発行した車両の精算を記録します。番号の編集・削除もここから行えます。</p></div><span className="section-count">{issuedRecords.length}件</span></div>{issuedRecords.length === 0 ? <EmptyState title="精算待ちの車両はありません" detail="証明書発行後の車両がここに表示されます。" /> : <div className="record-list">{issuedRecords.map((record) => <RecordRow key={record.id} record={record} now={now} action={settleRecord} actionLabel="精算" onNote={setNoteRecord} onEdit={setEditRecord} onDelete={deleteRecord} />)}</div>}</section>}

      {activeView === 'history' && <section className="view-section" aria-labelledby="history-heading"><div className="section-heading"><div><h1 id="history-heading">本日の履歴</h1><p>精算済みの記録を確認・修正できます。90秒以内は終了後、90秒超は都度報告します。</p></div><div className="section-heading-actions"><span className="section-count">{settledRecords.length}件</span><button type="button" className="subtle-button danger history-clear-button" disabled={settledRecords.length === 0} onClick={() => setDeleteAllOpen(true)}><Icon name="trash" size={16} />履歴を全件削除</button></div></div><div className="line-tools"><div><strong>シフト終了後のまとめ報告</strong><span>{workReport.schedule.endedAt ? '精算済み・90秒以内の未報告記録をまとめます。' : '90秒以内の記録は18:00勤務終了後にまとめて報告します。'}</span></div><button type="button" className="line-button" disabled={!workReport.schedule.endedAt} onClick={generateLineText}><span className="line-mark">LINE</span>{workReport.schedule.endedAt ? 'まとめて報告文を生成' : '18:00終了後に生成'}</button></div>{lineText && <div className="line-output"><div className="line-output-heading"><strong>生成されたテキスト</strong><button type="button" className="copy-button" onClick={copyLineText}><Icon name="copy" size={17} />コピー</button></div><textarea readOnly value={lineText} aria-label="LINE用テキスト" /></div>}{settledRecords.length === 0 ? <EmptyState title="完了した記録はありません" detail="精算ボタンを押した記録がここに表示されます。" /> : <div className="record-list history-list">{settledRecords.map((record) => { const needsImmediateReport = getElapsedSeconds(record, now) > 90 && !record.lineReportedAt; return <RecordRow key={record.id} record={record} now={now} action={needsImmediateReport ? generateImmediateLineText : undefined} actionLabel="都度報告" onNote={setNoteRecord} onReport={setReportRecord} onEdit={setEditRecord} onDelete={deleteRecord} /> })}</div>}</section>}
    </main>
    <footer className="app-footer">端末内に自動保存中 · {todayKey}</footer>
    <nav className="mobile-bottom-nav" aria-label="主要メニュー">{primaryTabItems.map((tab) => <NavigationTab key={tab.id} tab={tab} activeView={activeView} onSelect={setActiveView} mobile />)}</nav>
    {noteRecord && <NoteSheet record={records.find((record) => record.id === noteRecord.id) || noteRecord} onSave={saveNotes} onClose={() => setNoteRecord(null)} />}
    {reportRecord && <ReportSheet record={records.find((record) => record.id === reportRecord.id) || reportRecord} onSave={saveReportSettings} onClose={() => setReportRecord(null)} />}
    {issueRecord && <SpotConfirmSheet record={records.find((record) => record.id === issueRecord.id) || issueRecord} onConfirm={confirmCertificateIssue} onClose={() => setIssueRecord(null)} />}
    {editRecord && <EditModal record={records.find((record) => record.id === editRecord.id) || editRecord} onSave={saveEdit} onDelete={deleteRecord} onClose={() => setEditRecord(null)} />}
    {deleteAllOpen && <DeleteAllDialog count={settledRecords.length} onConfirm={deleteAllSettledRecords} onClose={() => setDeleteAllOpen(false)} />}
    {settingsOpen && <SettingsSheet settings={settings} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>
}

export {
  App,
  buildDetailedReportText,
  buildImmediateLineText,
  buildWorkLineText,
  createDefaultWorkReport,
  formatDateTimeInput,
  getDateKey,
  getElapsedSeconds,
  getRestartRule,
  normalizeRecord,
  parseDateTimeInput,
  resolveEditedDateTimeInput,
  shouldRestartForStore,
}

if (typeof document !== 'undefined') {
  const rootElement = document.getElementById('root')
  if (rootElement) createRoot(rootElement).render(<React.StrictMode><App /></React.StrictMode>)
}
