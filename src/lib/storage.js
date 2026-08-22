import { COMMUTE_OPTIONS, DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, STORAGE_PREFIX, WORK_STORAGE_PREFIX, WORK_STORES } from './constants.js'
import { normalizeRecord } from './records.js'

function readItem(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

// 保存に失敗（プライベートモード・容量超過など）しても画面が落ちないようにし、
// 呼び出し側が利用者へ知らせられるよう成否を返す。
function writeItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function loadRecords(dateKey) {
  try {
    const value = readItem(`${STORAGE_PREFIX}${dateKey}`)
    const parsed = value ? JSON.parse(value) : []
    return Array.isArray(parsed) ? parsed.map(normalizeRecord) : []
  } catch {
    return []
  }
}

export function saveRecords(dateKey, records) {
  return writeItem(`${STORAGE_PREFIX}${dateKey}`, records)
}

export function loadSettings() {
  try {
    const value = readItem(SETTINGS_STORAGE_KEY)
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

export function saveSettings(settings) {
  return writeItem(SETTINGS_STORAGE_KEY, settings)
}

export function createDefaultWorkReport() {
  const createStore = () => ({
    arrivalAt: null,
    inspectionSeconds: '',
    commute: COMMUTE_OPTIONS[0],
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

export function loadWorkReport(dateKey) {
  const defaults = createDefaultWorkReport()
  try {
    const value = readItem(`${WORK_STORAGE_PREFIX}${dateKey}`)
    const parsed = value ? JSON.parse(value) : {}
    const parsedStores = Object.values(parsed.stores || {})
    const report = {
      ...defaults,
      ...parsed,
      stores: Object.fromEntries(WORK_STORES.map(({ id }, index) => [id, { ...defaults.stores[id], ...(parsed.stores?.[id] || parsedStores[index] || {}) }])),
      schedule: { ...defaults.schedule, ...(parsed.schedule || {}) },
    }
    Object.values(report.stores).forEach((store) => {
      if (!COMMUTE_OPTIONS.includes(store.commute)) store.commute = COMMUTE_OPTIONS[0]
    })
    return report
  } catch {
    return defaults
  }
}

export function saveWorkReport(dateKey, report) {
  return writeItem(`${WORK_STORAGE_PREFIX}${dateKey}`, report)
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // iOSのWebViewなど、クリップボードAPIが使えない環境向けのフォールバック。
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand('copy')
      textarea.remove()
      return copied
    } catch {
      return false
    }
  }
}
