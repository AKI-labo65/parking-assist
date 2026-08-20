import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App.jsx'
import { STORAGE_PREFIX, WORK_STORAGE_PREFIX } from '../lib/constants.js'
import { getDateKey } from '../lib/time.js'
import { createDefaultWorkReport } from '../lib/storage.js'

const dateKey = getDateKey()
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString()

const seedRecords = (records) => localStorage.setItem(`${STORAGE_PREFIX}${dateKey}`, JSON.stringify(records))
const readRecords = () => JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${dateKey}`) || '[]')

const settledRecord = (overrides = {}) => ({
  id: 'seed-1',
  spot: '17',
  startedSpot: '17',
  startedAt: minutesAgo(30),
  issuedAt: new Date(Date.parse(minutesAgo(30)) + 40000).toISOString(),
  settledAt: minutesAgo(20),
  status: 'settled',
  notePresets: [],
  memo: '',
  reportType: 'normal',
  reportMemo: '',
  lineReportedAt: null,
  ...overrides,
})

const openTab = async (user, name) => user.click(screen.getAllByRole('button', { name })[0])

// user-event の setup() がクリップボードを差し替えるため、その後にモックを入れる。
const setupUser = ({ copyFails = false } = {}) => {
  const user = userEvent.setup()
  const writeText = copyFails ? vi.fn().mockRejectedValue(new Error('denied')) : vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  document.execCommand = vi.fn().mockReturnValue(!copyFails)
  return user
}

beforeEach(() => {
  localStorage.clear()
})

describe('記録の基本フロー', () => {
  it('番号タップ→証明書発行→精算まで記録できる', async () => {
    const user = setupUser()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '17番・新しく記録開始' }))
    expect(screen.getByText('タイマー動作中（発行時に番号入力）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '17番・対応中・詳細を開く' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /証明書発行＋番号入力/ }))
    expect(await screen.findByRole('dialog', { name: '番号を入力して発行' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '17番で発行確定' }))

    await waitFor(() => expect(readRecords()[0].status).toBe('issued'))

    await openTab(user, /発行済み・精算待ち/)
    await user.click(screen.getByRole('button', { name: '精算' }))
    await waitFor(() => expect(readRecords()[0].status).toBe('settled'))

    await openTab(user, /履歴/)
    expect(screen.getByText('本日の履歴')).toBeInTheDocument()
    expect(screen.getAllByText('精算済み').length).toBeGreaterThan(0)
  })

  it('番号未入力で開始し、発行時に番号を確定できる', async () => {
    const user = setupUser()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /番号未入力でタイマー開始/ }))
    expect(screen.getByText('番号未入力 #1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /証明書発行＋番号入力/ }))
    await user.type(screen.getByLabelText(/駐車位置番号（入力必須/), '9')
    await user.click(screen.getByRole('button', { name: '9番で発行確定' }))

    await waitFor(() => expect(readRecords()[0]).toMatchObject({ spot: '9', status: 'issued', spotSource: 'issue' }))
  })

  it('番号未入力の連番は、精算済みがあっても重複しない', async () => {
    seedRecords([settledRecord({ id: 'old', spot: null, unknownLabel: '1' })])
    const user = setupUser()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /番号未入力でタイマー開始/ }))
    expect(screen.getByText('番号未入力 #2')).toBeInTheDocument()
  })

  it('対応中の番号は発行時に確定できない', async () => {
    seedRecords([settledRecord({ id: 'active', settledAt: null, status: 'issued' })])
    const user = setupUser()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /番号未入力でタイマー開始/ }))
    await user.click(screen.getByRole('button', { name: /証明書発行＋番号入力/ }))
    await user.type(screen.getByLabelText(/駐車位置番号（入力必須/), '17')

    expect(screen.getByRole('alert')).toHaveTextContent('17番は別の記録で対応中です')
    expect(screen.getByRole('button', { name: '17番で発行確定' })).toBeDisabled()
  })
})

describe('削除と取り消し', () => {
  it('確認ダイアログを経て削除し、元に戻せる', async () => {
    seedRecords([settledRecord()])
    const user = setupUser()
    render(<App />)

    await openTab(user, /履歴/)
    await user.click(screen.getByRole('button', { name: '削除' }))

    const dialog = await screen.findByRole('dialog', { name: /記録を削除しますか/ })
    await user.click(within(dialog).getByRole('button', { name: /削除する/ }))
    await waitFor(() => expect(readRecords()).toHaveLength(0))

    await user.click(screen.getByRole('button', { name: '元に戻す' }))
    await waitFor(() => expect(readRecords()).toHaveLength(1))
  })

  it('キャンセルすると記録は残る', async () => {
    seedRecords([settledRecord()])
    const user = setupUser()
    render(<App />)

    await openTab(user, /履歴/)
    await user.click(screen.getByRole('button', { name: '削除' }))
    const dialog = await screen.findByRole('dialog', { name: /記録を削除しますか/ })
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))

    expect(readRecords()).toHaveLength(1)
  })
})

describe('LINE報告', () => {
  it('勤務終了前はまとめ報告を生成できない', async () => {
    seedRecords([settledRecord()])
    const user = setupUser()
    render(<App />)

    await openTab(user, /履歴/)
    expect(screen.getByRole('button', { name: /18:00終了後に生成/ })).toBeDisabled()
  })

  it('勤務終了後はまとめ報告を生成し、コピーで報告済みにする', async () => {
    const workReport = createDefaultWorkReport()
    workReport.schedule.endedAt = minutesAgo(5)
    localStorage.setItem(`${WORK_STORAGE_PREFIX}${dateKey}`, JSON.stringify(workReport))
    seedRecords([settledRecord()])
    const user = setupUser()
    render(<App />)

    await openTab(user, /履歴/)
    await user.click(screen.getByRole('button', { name: /まとめて報告文を生成/ }))

    expect(screen.getByLabelText('LINE用テキスト').value).toContain('・駐車位置番号:17番')

    await user.click(screen.getByRole('button', { name: 'コピー' }))
    await waitFor(() => expect(readRecords()[0].lineReportedAt).toBeTruthy())
    expect(navigator.clipboard.writeText).toHaveBeenCalled()
  })

  it('コピーできなかった記録は報告済みにしない', async () => {
    const workReport = createDefaultWorkReport()
    workReport.schedule.endedAt = minutesAgo(5)
    localStorage.setItem(`${WORK_STORAGE_PREFIX}${dateKey}`, JSON.stringify(workReport))
    seedRecords([settledRecord()])
    const user = setupUser({ copyFails: true })
    render(<App />)

    await openTab(user, /履歴/)
    await user.click(screen.getByRole('button', { name: /まとめて報告文を生成/ }))
    await user.click(screen.getByRole('button', { name: 'コピー' }))

    expect(await screen.findByText(/コピーできませんでした/)).toBeInTheDocument()
    expect(readRecords()[0].lineReportedAt).toBeNull()
  })

  it('90秒を超えた記録は都度報告になる', async () => {
    const startedAt = minutesAgo(30)
    seedRecords([settledRecord({ issuedAt: new Date(Date.parse(startedAt) + 120000).toISOString(), startedAt })])
    const user = setupUser()
    render(<App />)

    await openTab(user, /履歴/)
    expect(screen.getByText('90秒超')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '都度報告' }))
    expect(screen.getByLabelText('LINE用テキスト').value).toContain('90秒を超えた件です')
  })

  it('未発行のまま精算した記録は都度報告にしない', async () => {
    seedRecords([settledRecord({ issuedAt: null, startedAt: minutesAgo(40) })])
    const user = setupUser()
    render(<App />)

    await openTab(user, /履歴/)
    expect(screen.queryByText('90秒超')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '都度報告' })).not.toBeInTheDocument()
  })
})

describe('シートの操作性', () => {
  it('Escapeキーでシートを閉じられる', async () => {
    const user = setupUser()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '店舗名設定を開く' }))
    expect(await screen.findByRole('dialog', { name: '店舗名設定' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '店舗名設定' })).not.toBeInTheDocument())
  })

  it('店舗名は端末内に保存され、報告文の宛先になる', async () => {
    const user = setupUser()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '店舗名設定を開く' }))
    const dialog = await screen.findByRole('dialog', { name: '店舗名設定' })
    const storeBInput = within(dialog).getByPlaceholderText('例：店舗B')
    await user.clear(storeBInput)
    await user.type(storeBInput, 'テスト店')
    await user.click(within(dialog).getByRole('button', { name: '店舗名を保存' }))

    await waitFor(() => expect(JSON.parse(localStorage.getItem('parking-assist-settings')).storeLabels.storeB).toBe('テスト店'))
  })

  it('メモを保存しても精算済みの記録が壊れない', async () => {
    seedRecords([settledRecord({ exitCompletedAt: minutesAgo(20) })])
    const user = setupUser()
    render(<App />)

    await openTab(user, /履歴/)
    await user.click(screen.getByRole('button', { name: /メモ/ }))
    const dialog = await screen.findByRole('dialog', { name: '例外メモを選択' })
    await user.click(within(dialog).getByRole('button', { name: '操作ミス' }))
    await user.click(within(dialog).getByRole('button', { name: 'メモを保存' }))

    await waitFor(() => {
      const [record] = readRecords()
      expect(record.notePresets).toEqual(['操作ミス'])
      expect(record.status).toBe('settled')
      expect(record.exitCompletedAt).toBeTruthy()
    })
  })
})

describe('勤務報告', () => {
  it('到着と勤務時間を記録して報告文を生成する', async () => {
    const user = setupUser()
    render(<App />)

    await openTab(user, '勤務報告')
    await user.click(screen.getByRole('button', { name: /店舗Aに到着/ }))
    await user.click(screen.getByRole('button', { name: /10:00 勤務開始/ }))
    await user.click(screen.getByRole('button', { name: /報告文を生成/ }))

    const output = screen.getByLabelText('勤務報告用テキスト').value
    expect(output).toContain('【店舗A】')
    expect(output).toContain('10:00配置つきました。')
    expect(output).not.toContain('undefined')
  })
})
