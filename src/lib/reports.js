import { MAIN_STORE_ID, WORK_STORES } from './constants.js'
import { formatTime } from './time.js'
import {
  formatSpotLabel,
  getElapsedSeconds,
  getNotes,
  getRecordSpot,
  getSettlementDelayMinutes,
  isOverLimit,
  normalizeReportFlags,
} from './records.js'

// 空行は残しつつ、先頭・末尾・連続した空行だけを取り除く。
export function compactLines(lines) {
  const result = []
  lines.forEach((line) => {
    const text = typeof line === 'string' ? line : ''
    if (!text.trim()) {
      if (result.length === 0) return
      if (!result[result.length - 1].trim()) return
      result.push('')
      return
    }
    result.push(text)
  })
  while (result.length > 0 && !result[result.length - 1].trim()) result.pop()
  return result
}

function joinLines(lines, record) {
  const memo = record?.reportMemo?.trim()
  return compactLines(memo ? [...lines, '', memo] : lines).join('\n')
}

export function buildStoreConfigs(settings) {
  return WORK_STORES.map((config) => {
    const label = settings?.storeLabels?.[config.id] || config.defaultLabel
    return { ...config, label, arrivalText: config.id === MAIN_STORE_ID ? `ただいま、${label}に到着しました。` : '現着致しました。' }
  })
}

export function getMainStoreLabel(storeConfigs) {
  const main = storeConfigs?.find((config) => config.id === MAIN_STORE_ID)
  return main?.label || WORK_STORES.find((config) => config.id === MAIN_STORE_ID).defaultLabel
}

export function buildDetailedReportText(record, storeLabel) {
  const reportType = record.reportType || 'normal'
  const spotLine = `駐車位置番号:${formatSpotLabel(getRecordSpot(record), '番号未入力')}`
  const issueTime = formatTime(record.issuedAt || record.startedAt)
  const settleLine = record.settledAt ? `${formatTime(record.settledAt)}…精算` : '精算時間不明'
  const delayMinutes = getSettlementDelayMinutes(record)
  const delayNote = delayMinutes !== null && delayMinutes >= 9 ? '※9分以上経過しているため問題なく精算できております。' : ''
  const flags = normalizeReportFlags(record.reportFlags)

  if (reportType === 'issuanceDefect') {
    return joinLines([
      `【${storeLabel}】`,
      'お疲れ様です。',
      '1分30秒以内の件、発行不具合のケースです。',
      '',
      spotLine,
      record.issuedAt ? `駐車→証明書発行${getElapsedSeconds(record)}秒` : '駐車→証明書発行できず',
      '',
      `${issueTime}…証明書発行済(1度発行不可)`,
      settleLine,
      '',
      delayMinutes !== null && delayMinutes > 0 ? `${delayMinutes}分` : '',
    ], record)
  }

  if (reportType === 'serviceTicket') {
    return joinLines([
      `【${storeLabel}】`,
      'お疲れ様です。',
      '駐車証明未発行ですが、店内でサービス券を受け取られていたため問題なく精算完了しております。',
      '',
      spotLine,
      '',
      `${formatTime(record.startedAt)}…駐車証明未発行`,
      settleLine,
      delayNote,
    ], record)
  }

  if (reportType === 'custom') {
    return compactLines([
      `【${storeLabel}】`,
      'お疲れ様です。',
      record.reportMemo?.trim() || '補足報告です。',
      '',
      spotLine,
      '',
      `${issueTime}…${record.issuedAt ? '証明書発行済' : '駐車証明未発行'}`,
      settleLine,
    ]).join('\n')
  }

  const header = reportType === 'entryMisoperation' ? '入店時誤操作のお客様です。' : '入店時駐車証明未発行のお客様です。'
  const details = []
  if (flags.misoperationOnce) details.push('駐車証明と精算の誤操作(1度のみ)')
  if (record.issuedAt || flags.certificateIssued) details.push('駐車証明発行済')
  if (details.length === 0) details.push(record.issuedAt ? '駐車証明発行済' : '駐車証明未発行')
  return joinLines([
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
  ], record)
}

export function buildImmediateLineText(record, storeLabel) {
  const issueTime = formatTime(record.issuedAt || record.startedAt)
  const settleLine = record.settledAt ? `${formatTime(record.settledAt)}…精算` : '精算時間不明'
  const delayMinutes = getSettlementDelayMinutes(record)
  const notes = [getNotes(record), record.reportMemo?.trim()].filter(Boolean).join('、')
  return compactLines([
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
  ]).join('\n')
}

// シフト終了後にまとめて報告する対象（精算済み・90秒以内・未報告）。
export function selectBulkReportRecords(settledRecords, now = Date.now()) {
  return settledRecords.filter((record) => !isOverLimit(record, now) && !record.lineReportedAt)
}

function buildNormalRecordText(record) {
  const elapsedText = record.issuedAt ? `駐車→証明書発行${getElapsedSeconds(record)}秒` : '駐車→証明書発行できず'
  const issuedText = record.issuedAt ? `${formatTime(record.issuedAt).replace(':', '：')}…証明書発行` : `${formatTime(record.startedAt).replace(':', '：')}…証明書発行できず`
  const settledText = record.settledAt ? `${formatTime(record.settledAt).replace(':', '：')}…精算` : '精算時間不明'
  const notes = getNotes(record)
  return [`・駐車位置番号:${formatSpotLabel(getRecordSpot(record), '番号未入力')}`, elapsedText, issuedText, `${settledText}${notes ? `＊${notes}` : ''}`].join('\n')
}

export function buildBulkReportText(records, storeLabel) {
  const sorted = [...records].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
  const normalRecords = sorted.filter((record) => !record.reportType || record.reportType === 'normal')
  const detailedRecords = sorted.filter((record) => record.reportType && record.reportType !== 'normal')
  const sections = []

  if (normalRecords.length > 0) {
    const hasException = normalRecords.some((record) => Boolean(getNotes(record)))
    const header = [`【${storeLabel}】`, 'お疲れ様です。', hasException ? '1分30秒以内の記録ですが、例外メモがあります。' : '1分30秒以内の件ですが問題なく発行されております。'].join('\n')
    sections.push(`${header}\n\n${normalRecords.map(buildNormalRecordText).join('\n\n')}`)
  }
  detailedRecords.forEach((record) => sections.push(buildDetailedReportText(record, storeLabel)))
  if (sections.length === 0) {
    sections.push([`【${storeLabel}】`, 'お疲れ様です。', '報告待ちの1分30秒以内の記録はありません。'].join('\n'))
  }
  return sections.join('\n\n\n')
}

export function buildShiftNotEndedText(storeLabel) {
  return [`【${storeLabel}】`, 'お疲れ様です。', '1分30秒以内の件は、シフト終了後にまとめて報告します。', '18:00勤務終了を記録してから生成してください。'].join('\n')
}

function workValue(value) {
  return value === '' || value === null || value === undefined ? '—' : value
}

function joinWorkSections(sections) {
  return sections.filter(Boolean).join('\n\n-----\n\n')
}

export function buildWorkLineText(report, storeConfigs) {
  const sections = []
  const mainStoreLabel = getMainStoreLabel(storeConfigs)

  storeConfigs.forEach((storeConfig) => {
    const store = report.stores[storeConfig.id]
    if (!store?.arrivalAt) return
    const inspectionText = storeConfig.id === MAIN_STORE_ID ? `初期点検　${workValue(store.inspectionSeconds)}秒` : `初期点検...${workValue(store.inspectionSeconds)}秒`
    sections.push([`【${storeConfig.label}】`, '', storeConfig.arrivalText, '', inspectionText].join('\n'))
  })

  storeConfigs.forEach((storeConfig) => {
    const store = report.stores[storeConfig.id]
    if (!store?.restartCompletedAt) return
    sections.push(compactLines([
      `【${storeConfig.label}】`,
      `再起動前...${workValue(store.restartBeforeSeconds)}秒`,
      `再起動後...${workValue(store.restartAfterSeconds)}秒`,
      `QRリーダー...${workValue(store.qrMinutes)}分`,
      `クレカ立ち上がり...${workValue(store.creditMinutes)}分`,
      '',
      '問題なく復旧しました。',
      store.restartNote?.trim() || '',
    ]).join('\n'))
  })

  if (report.schedule.extraMessage?.trim()) sections.push(report.schedule.extraMessage.trim())

  const mainStore = report.stores[MAIN_STORE_ID]
  if (mainStore?.greetingAt) {
    sections.push([
      `【${mainStoreLabel}】`,
      '店舗様へのご挨拶完了',
      '本日もよろしくお願いいたします。',
      `サービス券　預かり${workValue(mainStore.serviceTickets)}枚`,
    ].join('\n'))
  }

  if (report.schedule.startedAt) sections.push([`【${mainStoreLabel}】`, '10:00配置つきました。', '業務開始いたします。'].join('\n'))
  if (report.schedule.breakAt) sections.push([`【${mainStoreLabel}】`, '12:00になりましたので', '配置一時解除します。'].join('\n'))
  if (report.schedule.resumedAt) sections.push([`【${mainStoreLabel}】`, '15:00配置つきました。', '業務再開いたします。'].join('\n'))
  if (report.schedule.endedAt) {
    sections.push(compactLines([
      `【${mainStoreLabel}】`,
      '18:00…配置解除,店舗挨拶完了',
      '',
      `店舗駐車券預り${workValue(report.schedule.parkingTickets)}枚`,
      `お客様から駐車券返却 ${workValue(report.schedule.returnedTickets)}枚`,
      `お客様への配布 ${workValue(report.schedule.distributedTickets)}枚`,
      '',
      report.schedule.finishMemo?.trim() || '',
      '',
      'お疲れ様でした。',
    ]).join('\n'))
  }

  return sections.length > 0 ? joinWorkSections(sections) : '勤務報告の記録はありません。'
}
