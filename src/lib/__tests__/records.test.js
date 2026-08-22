import { describe, expect, it } from 'vitest'
import {
  createRecord,
  findActiveSpotConflict,
  formatSpotLabel,
  getElapsedSeconds,
  getNotes,
  getRecordSpotLabel,
  getSettlementDelayMinutes,
  isOverLimit,
  nextUnknownLabel,
  normalizeRecord,
  normalizeSpot,
  sortRecords,
} from '../records.js'

const at = (isoMinutes, seconds = 0) => new Date(`2026-08-20T${isoMinutes}:${String(seconds).padStart(2, '0')}.000+09:00`).toISOString()

describe('normalizeSpot / formatSpotLabel', () => {
  it('空白だけの入力は番号なしとして扱う', () => {
    expect(normalizeSpot('  ')).toBeNull()
    expect(normalizeSpot(null)).toBeNull()
    expect(normalizeSpot(' 17 ')).toBe('17')
  })

  it('数字には「番」を付け、枝番はそのまま表示する', () => {
    expect(formatSpotLabel('17')).toBe('17番')
    expect(formatSpotLabel('7-2')).toBe('7-2')
    expect(formatSpotLabel('')).toBe('番号未入力')
    expect(formatSpotLabel('', '—')).toBe('—')
  })

  it('番号未入力の記録には連番付きのラベルを出す', () => {
    expect(getRecordSpotLabel({ spot: null, unknownLabel: '2' })).toBe('番号未入力 #2')
    expect(getRecordSpotLabel({ spot: '3' })).toBe('3番')
  })
})

describe('getElapsedSeconds', () => {
  it('発行済みの記録は発行時刻で確定する', () => {
    const record = { startedAt: at('10:00'), issuedAt: at('10:00', 45) }
    expect(getElapsedSeconds(record, Date.parse(at('18:00')))).toBe(45)
  })

  it('未発行のまま精算した記録は、画面を開いたままでも秒数が伸びない', () => {
    const record = { startedAt: at('10:00'), issuedAt: null, settledAt: at('10:05') }
    expect(getElapsedSeconds(record, Date.parse(at('10:06')))).toBe(300)
    expect(getElapsedSeconds(record, Date.parse(at('17:00')))).toBe(300)
  })

  it('駐車中の記録は現在時刻までの経過を返す', () => {
    const record = { startedAt: at('10:00'), issuedAt: null, settledAt: null }
    expect(getElapsedSeconds(record, Date.parse(at('10:00', 30)))).toBe(30)
  })

  it('時刻が壊れている記録でも0を返す', () => {
    expect(getElapsedSeconds({ startedAt: 'invalid' })).toBe(0)
  })
})

describe('isOverLimit', () => {
  it('90秒ちょうどは超過にしない', () => {
    expect(isOverLimit({ startedAt: at('10:00'), issuedAt: at('10:01', 30) })).toBe(false)
    expect(isOverLimit({ startedAt: at('10:00'), issuedAt: at('10:01', 31) })).toBe(true)
  })

  it('証明書を発行できなかった記録は90秒超に含めない', () => {
    const record = { startedAt: at('10:00'), issuedAt: null, settledAt: at('10:30') }
    expect(isOverLimit(record, Date.parse(at('11:00')))).toBe(false)
  })
})

describe('getSettlementDelayMinutes', () => {
  it('発行から精算までの分数を返す', () => {
    expect(getSettlementDelayMinutes({ startedAt: at('10:00'), issuedAt: at('10:01'), settledAt: at('10:12') })).toBe(11)
  })

  it('精算前はnullを返す', () => {
    expect(getSettlementDelayMinutes({ startedAt: at('10:00'), issuedAt: at('10:01'), settledAt: null })).toBeNull()
  })
})

describe('nextUnknownLabel', () => {
  it('精算済みの番号未入力があっても連番が重複しない', () => {
    const records = [
      { unknownLabel: '1', status: 'settled', spot: null },
      { unknownLabel: '2', status: 'parking', spot: null },
    ]
    expect(nextUnknownLabel(records)).toBe('3')
  })

  it('最初の1件は#1になる', () => {
    expect(nextUnknownLabel([])).toBe('1')
  })
})

describe('findActiveSpotConflict', () => {
  const records = [
    { id: 'a', spot: '17', status: 'issued' },
    { id: 'b', spot: '18', status: 'settled' },
  ]

  it('精算前の同じ番号を見つける', () => {
    expect(findActiveSpotConflict(records, '17')?.id).toBe('a')
  })

  it('精算済みの番号は再利用できる', () => {
    expect(findActiveSpotConflict(records, '18')).toBeNull()
  })

  it('自分自身は重複としない', () => {
    expect(findActiveSpotConflict(records, '17', 'a')).toBeNull()
  })

  it('番号未入力は重複判定しない', () => {
    expect(findActiveSpotConflict(records, '')).toBeNull()
  })
})

describe('normalizeRecord', () => {
  it('古い保存データに不足している項目を補う', () => {
    const record = normalizeRecord({ id: 'x', spot: ' 5 ', startedAt: at('10:00'), status: 'settled', settledAt: at('10:10') })
    expect(record.spot).toBe('5')
    expect(record.startedSpot).toBe('5')
    expect(record.notePresets).toEqual([])
    expect(record.reportType).toBe('normal')
    expect(record.reportFlags).toEqual({ misoperationOnce: false, certificateIssued: false, issuanceFailedOnce: false })
    expect(record.exitCompletedAt).toBe(at('10:10'))
  })

  it('知らない報告パターンは通常に戻す', () => {
    expect(normalizeRecord({ reportType: 'unknown-type' }).reportType).toBe('normal')
  })
})

describe('createRecord', () => {
  it('番号ありで開始した記録は駐車中になる', () => {
    const record = createRecord({ spot: '9' })
    expect(record).toMatchObject({ spot: '9', startedSpot: '9', status: 'parking', spotSource: 'start', unknownLabel: null })
    expect(record.id).toBeTruthy()
  })

  it('番号未入力の記録には連番が入る', () => {
    expect(createRecord({ unknownLabel: '2' })).toMatchObject({ spot: null, unknownLabel: '2', spotSource: 'unknown' })
  })
})

describe('getNotes / sortRecords', () => {
  it('定型メモと自由メモをまとめる', () => {
    expect(getNotes({ notePresets: ['操作ミス'], memo: ' 追記 ' })).toBe('操作ミス、追記')
    expect(getNotes({ notePresets: [], memo: '' })).toBe('')
  })

  it('指定したキーで並び替える', () => {
    const records = [{ id: 'b', startedAt: at('10:05') }, { id: 'a', startedAt: at('10:00') }]
    expect(sortRecords(records, 'startedAt').map((record) => record.id)).toEqual(['a', 'b'])
    expect(sortRecords(records, 'startedAt', 'desc').map((record) => record.id)).toEqual(['b', 'a'])
  })
})
