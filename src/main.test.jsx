/** @vitest-environment jsdom */

import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  App,
  buildImmediateLineText,
  buildWorkLineText,
  createDefaultWorkReport,
  formatDateTimeInput,
  getDateKey,
  getRestartRule,
  parseDateTimeInput,
  resolveEditedDateTimeInput,
  shouldRestartForStore,
} from './main.jsx'

const storeConfigs = [
  { id: 'storeA', label: '第一店舗', arrivalText: '現着致しました。', hasCommute: true },
  { id: 'storeB', label: '第二店舗', arrivalText: 'ただいま、第二店舗に到着しました。', hasCommute: false },
]

function makeSettledRecord(overrides = {}) {
  const now = Date.now()
  const settledAt = new Date(now).toISOString()
  return {
    id: 'record-1',
    spot: '1',
    startedSpot: '1',
    unknownLabel: null,
    spotConfirmedAt: new Date(now - 20_000).toISOString(),
    spotSource: 'issue',
    startedAt: new Date(now - 40_000).toISOString(),
    issuedAt: new Date(now - 20_000).toISOString(),
    settledAt,
    exitCompletedAt: settledAt,
    lineReportedAt: null,
    reportType: 'normal',
    reportFlags: {},
    reportMemo: '',
    status: 'settled',
    notePresets: [],
    memo: '',
    ...overrides,
  }
}

function seedApp(record = makeSettledRecord(), { ended = true } = {}) {
  const dateKey = getDateKey()
  const workReport = createDefaultWorkReport()
  if (ended) workReport.schedule.endedAt = new Date().toISOString()
  localStorage.setItem(`parking-assist-records:${dateKey}`, JSON.stringify([record]))
  localStorage.setItem(`parking-assist-work:${dateKey}`, JSON.stringify(workReport))
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('record time editing', () => {
  it('keeps seconds when converting datetime-local values', () => {
    const original = new Date(2026, 7, 21, 10, 11, 12).toISOString()
    const inputValue = formatDateTimeInput(original)

    expect(inputValue).toMatch(/T10:11:12$/)
    expect(parseDateTimeInput(inputValue)).toBe(original)
  })

  it('keeps the exact original timestamp when the time field was not edited', () => {
    const original = '2026-08-21T01:11:12.789Z'
    const unchangedInput = formatDateTimeInput(original)

    expect(resolveEditedDateTimeInput(unchangedInput, original)).toBe(original)
  })
})

describe('work report text', () => {
  it('uses configured store labels and prints the closing only once', () => {
    const report = createDefaultWorkReport()
    report.stores.storeA.arrivalAt = new Date().toISOString()
    report.stores.storeA.inspectionSeconds = '18'
    report.schedule.endedAt = new Date().toISOString()

    const text = buildWorkLineText(report, storeConfigs)

    expect(text).toContain('【第一店舗】')
    expect(text).not.toContain('【undefined】')
    expect(text.match(/お疲れ様でした。/g)).toHaveLength(1)
  })
})

describe('restart schedule', () => {
  it('requires a restart on Wednesday and Sunday', () => {
    expect(getRestartRule(new Date(2026, 7, 19))).toMatchObject({ id: 'wednesday', required: true })
    expect(getRestartRule(new Date(2026, 7, 23))).toMatchObject({ id: 'sunday', required: true })
  })

  it('requires a restart on Saturday only when initial inspection is at least 8 seconds', () => {
    const rule = getRestartRule(new Date(2026, 7, 22))
    expect(rule).toMatchObject({ id: 'saturday', required: false })
    expect(shouldRestartForStore(rule, { inspectionSeconds: '7' })).toBe(false)
    expect(shouldRestartForStore(rule, { inspectionSeconds: '8' })).toBe(true)
    expect(shouldRestartForStore(rule, { inspectionSeconds: '12' })).toBe(true)
    expect(shouldRestartForStore(rule, { inspectionSeconds: '7', restartStartedAt: '2026-08-22T01:00:00.000Z' })).toBe(true)
  })
})

describe('generated LINE report consistency', () => {
  it('labels memo records and puts each memo on its own line after settlement', async () => {
    seedApp(makeSettledRecord({ notePresets: ['料金発生なし', 'サービス券2枚回収'] }))
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /履歴/ })[0])
    await user.click(screen.getByRole('button', { name: /まとめて報告文を生成/ }))
    const text = screen.getByLabelText('LINE用テキスト').value

    expect(text).toContain('1分30秒以内の記録ですが、一部メモあり。')
    expect(text).toContain('精算\n＊料金発生なし\nサービス券2枚回収')
    expect(text).not.toContain('精算＊')
  })

  it('does not add the memo summary when there are no memo records', async () => {
    seedApp()
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /履歴/ })[0])
    await user.click(screen.getByRole('button', { name: /まとめて報告文を生成/ }))
    const text = screen.getByLabelText('LINE用テキスト').value

    expect(text).not.toContain('一部メモあり。')
  })

  it('allows the batch report to be generated before shift end', async () => {
    seedApp(makeSettledRecord(), { ended: false })
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /履歴/ })[0])
    const generateButton = screen.getByRole('button', { name: 'LINE まとめて報告文を生成' })

    expect(generateButton).not.toBeDisabled()
    await user.click(generateButton)
    expect(screen.getByLabelText('LINE用テキスト').value).toContain('駐車位置番号:1番')
  })

  it('also puts immediate-report memo items on separate lines', () => {
    const record = makeSettledRecord({
      startedAt: new Date(Date.now() - 200_000).toISOString(),
      issuedAt: new Date(Date.now() - 100_000).toISOString(),
      notePresets: ['サービス券投入トラブル', '操作ミス'],
    })
    const text = buildImmediateLineText(record, '第二店舗')

    expect(text).toContain('＊サービス券投入トラブル\n操作ミス')
    expect(text).not.toContain('精算＊')
  })

  it('clears stale output after editing and regenerates with the new spot', async () => {
    seedApp()
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /履歴/ })[0])
    await user.click(screen.getByRole('button', { name: /まとめて報告文を生成/ }))
    expect(screen.getByLabelText('LINE用テキスト').value).toContain('駐車位置番号:1番')

    await user.click(screen.getByRole('button', { name: '編集' }))
    const spotInput = screen.getByRole('textbox', { name: '駐車位置番号' })
    await user.clear(spotInput)
    await user.type(spotInput, '2')
    await user.click(screen.getByRole('button', { name: '変更を保存' }))

    await waitFor(() => expect(screen.queryByLabelText('LINE用テキスト')).toBeNull())
    await user.click(screen.getByRole('button', { name: /まとめて報告文を生成/ }))
    expect(screen.getByLabelText('LINE用テキスト').value).toContain('駐車位置番号:2番')
  })

  it('keeps settlement metadata and resets reported state when a note changes', async () => {
    const exitCompletedAt = new Date().toISOString()
    seedApp(makeSettledRecord({ exitCompletedAt, lineReportedAt: new Date().toISOString() }))
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /履歴/ })[0])
    expect(screen.getByText('報告済み')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'メモ' }))
    await user.click(screen.getByRole('button', { name: '操作ミス' }))
    await user.click(screen.getByRole('button', { name: 'メモを保存' }))

    await waitFor(() => expect(screen.queryByText('報告済み')).toBeNull())
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(`parking-assist-records:${getDateKey()}`))
      expect(saved[0].exitCompletedAt).toBe(exitCompletedAt)
      expect(saved[0].lineReportedAt).toBeNull()
    })
  })
})

describe('work schedule recovery', () => {
  it('warns on out-of-order input and lets a completed checkpoint be removed', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: '勤務報告' })[0])
    await user.click(screen.getByRole('button', { name: '18:00 勤務終了' }))
    expect(screen.getByRole('heading', { name: '18:00 勤務終了を先に記録しますか？' })).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.getByRole('button', { name: '18:00 勤務終了' })).not.toBeNull()

    await user.click(screen.getByRole('button', { name: '18:00 勤務終了' }))
    await user.click(screen.getByRole('button', { name: 'このまま記録' }))
    const removeButton = await screen.findByRole('button', { name: '18:00 勤務終了の記録を取り消す' })

    await user.click(removeButton)
    await user.click(screen.getByRole('button', { name: '記録を取り消す' }))
    expect(await screen.findByRole('button', { name: '18:00 勤務終了' })).not.toBeNull()
  })
})

describe('date rollover', () => {
  it('loads the new day without copying the previous day records over it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 21, 23, 59, 59, 500))
    const firstDateKey = getDateKey()
    const nextDate = new Date(2026, 7, 22, 0, 0, 0)
    const nextDateKey = getDateKey(nextDate)
    const firstRecord = makeSettledRecord({ id: 'first-day', spot: '1', status: 'parking', issuedAt: null, settledAt: null, exitCompletedAt: null })
    const nextRecord = makeSettledRecord({ id: 'next-day', spot: '2', status: 'parking', issuedAt: null, settledAt: null, exitCompletedAt: null })
    localStorage.setItem(`parking-assist-records:${firstDateKey}`, JSON.stringify([firstRecord]))
    localStorage.setItem(`parking-assist-records:${nextDateKey}`, JSON.stringify([nextRecord]))

    render(<App />)
    expect(screen.getByRole('button', { name: '1番・対応中・詳細を開く' })).not.toBeNull()

    await act(async () => vi.advanceTimersByTime(1_500))

    expect(screen.getByRole('button', { name: '2番・対応中・詳細を開く' })).not.toBeNull()
    const savedNextDay = JSON.parse(localStorage.getItem(`parking-assist-records:${nextDateKey}`))
    expect(savedNextDay[0].id).toBe('next-day')
  })
})
