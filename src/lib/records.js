import { OVER_LIMIT_SECONDS, REPORT_FLAGS, REPORT_TYPES } from './constants.js'

export function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function normalizeSpot(value) {
  const spot = String(value ?? '').trim()
  return spot || null
}

export function normalizeReportFlags(flags) {
  return REPORT_FLAGS.reduce((result, flag) => ({ ...result, [flag.id]: Boolean(flags?.[flag.id]) }), {})
}

export function formatSpotLabel(value, fallback = '番号未入力') {
  const spot = normalizeSpot(value)
  if (!spot) return fallback
  return /^\d+$/.test(spot) ? `${spot}番` : spot
}

export function getRecordSpot(record) {
  return normalizeSpot(record?.spot)
}

export function getRecordSpotLabel(record) {
  const spot = getRecordSpot(record)
  if (spot) return formatSpotLabel(spot)
  return record?.unknownLabel ? `番号未入力 #${record.unknownLabel}` : '番号未入力'
}

// 駐車開始から証明書発行までの秒数。発行できなかった記録は精算時刻で確定させ、
// 画面を開いたままでも数字が伸び続けないようにする。
export function getElapsedSeconds(record, now = Date.now()) {
  const started = new Date(record?.startedAt).getTime()
  const endValue = record?.issuedAt || record?.settledAt
  const ended = endValue ? new Date(endValue).getTime() : now
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0
  return Math.max(0, Math.floor((ended - started) / 1000))
}

// 90秒ルールは証明書を発行できた記録だけが対象。未発行の記録は都度報告ではなく、
// シフト終了後のまとめ報告で定型文を使って報告する。
export function isOverLimit(record, now = Date.now()) {
  return Boolean(record?.issuedAt) && getElapsedSeconds(record, now) > OVER_LIMIT_SECONDS
}

export function getSettlementDelayMinutes(record) {
  // 精算前は「経過分数なし」。new Date(null)が1970年になり0分と誤解されるのを防ぐ。
  if (!record?.settledAt) return null
  const from = new Date(record.issuedAt || record.startedAt).getTime()
  const settled = new Date(record.settledAt).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(settled)) return null
  return Math.max(0, Math.floor((settled - from) / 60000))
}

export function getNotes(record) {
  return [...(record?.notePresets || []), record?.memo?.trim()].filter(Boolean).join('、')
}

export function normalizeRecord(record) {
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

export function createRecord({ spot = null, unknownLabel = null, startedAt = new Date().toISOString() } = {}) {
  const normalizedSpot = normalizeSpot(spot)
  return {
    id: makeId(),
    spot: normalizedSpot,
    startedSpot: normalizedSpot,
    unknownLabel: normalizedSpot ? null : unknownLabel,
    spotConfirmedAt: null,
    spotSource: normalizedSpot ? 'start' : 'unknown',
    startedAt,
    issuedAt: null,
    settledAt: null,
    exitCompletedAt: null,
    lineReportedAt: null,
    reportType: 'normal',
    reportFlags: normalizeReportFlags(),
    reportMemo: '',
    status: 'parking',
    notePresets: [],
    memo: '',
  }
}

// 「番号未入力 #n」の連番。精算済みも含めた当日の最大値+1にして、
// 対応中の件数が減っても番号が重複しないようにする。
export function nextUnknownLabel(records) {
  const maxLabel = records.reduce((max, record) => {
    const label = Number(record.unknownLabel)
    return Number.isFinite(label) && label > max ? label : max
  }, 0)
  return String(maxLabel + 1)
}

// 同じ駐車位置番号を精算前に二重で使っていないか。
export function findActiveSpotConflict(records, spot, excludeId = null) {
  const target = normalizeSpot(spot)
  if (!target) return null
  return records.find((record) => record.id !== excludeId && record.status !== 'settled' && getRecordSpot(record) === target) || null
}

export function sortRecords(records, key, direction = 'asc') {
  const sign = direction === 'desc' ? -1 : 1
  return [...records].sort((a, b) => sign * (new Date(a[key] || a.startedAt) - new Date(b[key] || b.startedAt)))
}
