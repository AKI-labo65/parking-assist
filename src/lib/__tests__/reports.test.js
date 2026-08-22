import { describe, expect, it } from 'vitest'
import {
  buildBulkReportText,
  buildDetailedReportText,
  buildImmediateLineText,
  buildStoreConfigs,
  buildWorkLineText,
  compactLines,
  getMainStoreLabel,
  selectBulkReportRecords,
} from '../reports.js'
import { createDefaultWorkReport } from '../storage.js'

const at = (time, seconds = 0) => new Date(`2026-08-20T${time}:${String(seconds).padStart(2, '0')}.000+09:00`).toISOString()

const record = (overrides = {}) => ({
  id: overrides.id || 'r1',
  spot: '17',
  startedAt: at('10:00'),
  issuedAt: at('10:00', 40),
  settledAt: at('10:03'),
  status: 'settled',
  notePresets: [],
  memo: '',
  reportType: 'normal',
  reportFlags: { misoperationOnce: false, certificateIssued: false, issuanceFailedOnce: false },
  reportMemo: '',
  lineReportedAt: null,
  ...overrides,
})

describe('compactLines', () => {
  it('先頭・末尾・連続した空行だけを取り除く', () => {
    expect(compactLines(['', 'a', '', '', 'b', '', ''])).toEqual(['a', '', 'b'])
  })
})

describe('buildStoreConfigs / getMainStoreLabel', () => {
  it('設定した店舗名を到着文にも反映する', () => {
    const configs = buildStoreConfigs({ storeLabels: { storeA: 'AA店', storeB: 'BB店' } })
    expect(configs.map((config) => config.label)).toEqual(['AA店', 'BB店'])
    expect(configs[1].arrivalText).toBe('ただいま、BB店に到着しました。')
    expect(getMainStoreLabel(configs)).toBe('BB店')
  })

  it('設定が無いときは既定の店舗名を使う', () => {
    expect(getMainStoreLabel(buildStoreConfigs(undefined))).toBe('店舗B')
    expect(getMainStoreLabel([])).toBe('店舗B')
  })
})

describe('buildBulkReportText', () => {
  it('通常記録をまとめて1つの見出しにする', () => {
    const text = buildBulkReportText([record({ id: 'a' }), record({ id: 'b', spot: '5', startedAt: at('10:10'), issuedAt: at('10:10', 20), settledAt: at('10:13') })], 'BB店')
    expect(text).toContain('【BB店】')
    expect(text).toContain('1分30秒以内の件ですが問題なく発行されております。')
    expect(text).toContain('・駐車位置番号:17番')
    expect(text).toContain('駐車→証明書発行40秒')
    expect(text).toContain('10：00…証明書発行')
    expect(text.indexOf('・駐車位置番号:17番')).toBeLessThan(text.indexOf('・駐車位置番号:5番'))
  })

  it('例外メモがある場合は見出しを変える', () => {
    const text = buildBulkReportText([record({ notePresets: ['操作ミス'] })], 'BB店')
    expect(text).toContain('1分30秒以内の記録ですが、例外メモがあります。')
    expect(text).toContain('＊操作ミス')
  })

  it('報告パターンを選んだ記録は個別の定型文になる', () => {
    const text = buildBulkReportText([record({ id: 'a' }), record({ id: 'b', reportType: 'serviceTicket', issuedAt: null })], 'BB店')
    expect(text).toContain('1分30秒以内の件ですが問題なく発行されております。')
    expect(text).toContain('駐車証明未発行ですが、店内でサービス券を受け取られていたため問題なく精算完了しております。')
  })

  it('対象が無いときも報告文になる', () => {
    expect(buildBulkReportText([], 'BB店')).toContain('報告待ちの1分30秒以内の記録はありません。')
  })

  it('末尾に余分な空行を残さない', () => {
    expect(buildBulkReportText([record()], 'BB店').endsWith('\n')).toBe(false)
  })
})

describe('selectBulkReportRecords', () => {
  it('未報告・90秒以内の精算済みだけを対象にする', () => {
    const records = [
      record({ id: 'ok' }),
      record({ id: 'reported', lineReportedAt: at('18:10') }),
      record({ id: 'over', issuedAt: at('10:02') }),
      record({ id: 'noCertificate', issuedAt: null }),
    ]
    expect(selectBulkReportRecords(records, Date.parse(at('18:00'))).map((item) => item.id)).toEqual(['ok', 'noCertificate'])
  })
})

describe('buildDetailedReportText', () => {
  it('発行不具合は「1度発行不可」を必ず含める', () => {
    const text = buildDetailedReportText(record({ reportType: 'issuanceDefect' }), 'BB店')
    expect(text).toContain('1分30秒以内の件、発行不具合のケースです。')
    expect(text).toContain('…証明書発行済(1度発行不可)')
    expect(text).toContain('駐車→証明書発行40秒')
  })

  it('入店時誤操作はフラグの内容を並べる', () => {
    const text = buildDetailedReportText(record({ reportType: 'entryMisoperation', reportFlags: { misoperationOnce: true, certificateIssued: true, issuanceFailedOnce: false } }), 'BB店')
    expect(text).toContain('入店時誤操作のお客様です。')
    expect(text).toContain('駐車証明と精算の誤操作(1度のみ)、駐車証明発行済')
  })

  it('9分以上の精算には補足を付ける', () => {
    const text = buildDetailedReportText(record({ reportType: 'serviceTicket', issuedAt: null, settledAt: at('10:12') }), 'BB店')
    expect(text).toContain('※9分以上経過しているため問題なく精算できております。')
  })

  it('9分未満では補足を付けない', () => {
    const text = buildDetailedReportText(record({ reportType: 'serviceTicket', issuedAt: null, settledAt: at('10:05') }), 'BB店')
    expect(text).not.toContain('※9分以上経過しているため')
  })

  it('自由入力は入力した文章を本文にする', () => {
    const text = buildDetailedReportText(record({ reportType: 'custom', reportMemo: '店舗様と確認済みです。' }), 'BB店')
    expect(text).toContain('店舗様と確認済みです。')
    expect(text.match(/店舗様と確認済みです。/g)).toHaveLength(1)
  })

  it('補足メモは末尾に追加する', () => {
    const text = buildDetailedReportText(record({ reportType: 'entryNoCertificate', reportMemo: 'サービス券をお持ちでした' }), 'BB店')
    expect(text.endsWith('サービス券をお持ちでした')).toBe(true)
  })
})

describe('buildImmediateLineText', () => {
  it('90秒超の報告文に秒数とメモを載せる', () => {
    const text = buildImmediateLineText(record({ issuedAt: at('10:02'), notePresets: ['サービス券1枚使用'] }), 'BB店')
    expect(text).toContain('90秒を超えた件です。念のためご報告させていただきます。')
    expect(text).toContain('駐車→証明書発行120秒')
    expect(text).toContain('＊サービス券1枚使用')
  })

  it('未発行のまま精算した場合も文章になる', () => {
    const text = buildImmediateLineText(record({ issuedAt: null }), 'BB店')
    expect(text).toContain('駐車→証明書発行できず')
    expect(text).not.toContain('undefined')
  })
})

describe('buildWorkLineText', () => {
  const configs = buildStoreConfigs({ storeLabels: { storeA: 'AA店', storeB: 'BB店' } })

  it('記録が無いときは案内文を返す', () => {
    expect(buildWorkLineText(createDefaultWorkReport(), configs)).toBe('勤務報告の記録はありません。')
  })

  it('設定した店舗名を見出しに使う', () => {
    const report = createDefaultWorkReport()
    report.stores.storeA.arrivalAt = at('09:00')
    report.stores.storeA.inspectionSeconds = '30'
    report.stores.storeB.arrivalAt = at('09:40')
    const text = buildWorkLineText(report, configs)
    expect(text).toContain('【AA店】')
    expect(text).toContain('【BB店】')
    expect(text).not.toContain('undefined')
    expect(text).toContain('現着致しました。')
    expect(text).toContain('ただいま、BB店に到着しました。')
    expect(text).toContain('初期点検...30秒')
  })

  it('未入力の項目は—で埋める', () => {
    const report = createDefaultWorkReport()
    report.stores.storeA.arrivalAt = at('09:00')
    expect(buildWorkLineText(report, configs)).toContain('初期点検...—秒')
  })

  it('再起動の復旧結果を記録した店舗だけ報告に出す', () => {
    const report = createDefaultWorkReport()
    report.stores.storeA.arrivalAt = at('09:00')
    report.stores.storeA.restartStartedAt = at('09:05')
    report.stores.storeA.restartCompletedAt = at('09:20')
    report.stores.storeA.restartBeforeSeconds = '40'
    const text = buildWorkLineText(report, configs)
    expect(text).toContain('再起動前...40秒')
    expect(text).toContain('問題なく復旧しました。')
  })

  it('勤務終了の報告に挨拶を重複させない', () => {
    const report = createDefaultWorkReport()
    report.schedule.endedAt = at('18:00')
    const text = buildWorkLineText(report, configs)
    expect(text).toContain('18:00…配置解除,店舗挨拶完了')
    expect(text.match(/お疲れ様でした。/g)).toHaveLength(1)
    expect(text).not.toContain('\n\n\n')
  })

  it('終了時の補足を報告文に含める', () => {
    const report = createDefaultWorkReport()
    report.schedule.endedAt = at('18:00')
    report.schedule.finishMemo = '配布数が増加しました'
    expect(buildWorkLineText(report, configs)).toContain('配布数が増加しました')
  })
})
