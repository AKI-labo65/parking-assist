import { afterEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_PREFIX, WORK_STORAGE_PREFIX } from '../constants.js'
import {
  copyToClipboard,
  createDefaultWorkReport,
  loadRecords,
  loadSettings,
  loadWorkReport,
  saveRecords,
  saveSettings,
  saveWorkReport,
} from '../storage.js'

const dateKey = '2026-08-20'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('records の保存と復元', () => {
  it('保存した記録を正規化して読み戻す', () => {
    expect(saveRecords(dateKey, [{ id: 'a', spot: ' 7 ', startedAt: '2026-08-20T01:00:00.000Z', status: 'parking' }])).toBe(true)
    const [record] = loadRecords(dateKey)
    expect(record.spot).toBe('7')
    expect(record.notePresets).toEqual([])
    expect(record.reportType).toBe('normal')
  })

  it('保存が無い日は空配列を返す', () => {
    expect(loadRecords('2000-01-01')).toEqual([])
  })

  it('壊れた保存データでも落ちない', () => {
    localStorage.setItem(`${STORAGE_PREFIX}${dateKey}`, '{壊れたJSON')
    expect(loadRecords(dateKey)).toEqual([])
  })

  it('配列以外が保存されていても空配列を返す', () => {
    localStorage.setItem(`${STORAGE_PREFIX}${dateKey}`, '{"a":1}')
    expect(loadRecords(dateKey)).toEqual([])
  })

  it('保存できない端末では false を返し、例外を投げない', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError') },
    })
    expect(saveRecords(dateKey, [])).toBe(false)
  })
})

describe('勤務報告の保存と復元', () => {
  it('保存した内容を既定値とあわせて復元する', () => {
    const report = createDefaultWorkReport()
    report.stores.storeA.arrivalAt = '2026-08-20T00:00:00.000Z'
    saveWorkReport(dateKey, report)
    const loaded = loadWorkReport(dateKey)
    expect(loaded.stores.storeA.arrivalAt).toBe('2026-08-20T00:00:00.000Z')
    expect(loaded.schedule.parkingTickets).toBe('20')
  })

  it('知らない移動手段は車に戻す', () => {
    const report = createDefaultWorkReport()
    report.stores.storeA.commute = 'ヘリコプター'
    saveWorkReport(dateKey, report)
    expect(loadWorkReport(dateKey).stores.storeA.commute).toBe('車')
  })

  it('壊れた保存データでも既定値を返す', () => {
    localStorage.setItem(`${WORK_STORAGE_PREFIX}${dateKey}`, 'not json')
    expect(loadWorkReport(dateKey)).toEqual(createDefaultWorkReport())
  })
})

describe('店舗名設定', () => {
  it('保存した店舗名を読み戻す', () => {
    saveSettings({ storeLabels: { storeA: 'AA店', storeB: 'BB店' } })
    expect(loadSettings().storeLabels).toEqual({ storeA: 'AA店', storeB: 'BB店' })
  })

  it('片方だけ保存されていても既定値で補う', () => {
    localStorage.setItem('parking-assist-settings', JSON.stringify({ storeLabels: { storeA: 'AA店' } }))
    expect(loadSettings().storeLabels).toEqual({ storeA: 'AA店', storeB: '店舗B' })
  })
})

describe('copyToClipboard', () => {
  it('クリップボードAPIが使えるときは true を返す', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await copyToClipboard('報告文')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('報告文')
  })

  it('APIが失敗したらフォールバックの結果を返す', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } })
    document.execCommand = vi.fn().mockReturnValue(true)
    expect(await copyToClipboard('報告文')).toBe(true)
  })

  it('フォールバックも失敗したら false を返す', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } })
    document.execCommand = vi.fn().mockReturnValue(false)
    expect(await copyToClipboard('報告文')).toBe(false)
  })
})
