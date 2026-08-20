import { describe, expect, it } from 'vitest'
import { formatDateLabel, formatDateTimeInput, formatDuration, formatTime, getDateKey, isRestartDay, parseDateTimeInput } from '../time.js'

describe('日付と時刻の表示', () => {
  it('保存キー用の日付を0埋めで作る', () => {
    expect(getDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('曜日付きの見出しを作る', () => {
    expect(formatDateLabel(new Date(2026, 7, 20))).toBe('8/20（木）')
  })

  it('時刻が無いときは—を返す', () => {
    expect(formatTime(null)).toBe('—')
    expect(formatTime('壊れた値')).toBe('—')
  })

  it('分までの表示にする', () => {
    expect(formatTime(new Date(2026, 7, 20, 9, 5).toISOString())).toBe('09:05')
  })

  it('秒を mm:ss にする', () => {
    expect(formatDuration(95)).toBe('01:35')
    expect(formatDuration(-5)).toBe('00:00')
    expect(formatDuration('abc')).toBe('00:00')
  })
})

describe('datetime-local の入出力', () => {
  it('入力欄用の文字列と ISO を相互変換する', () => {
    const iso = new Date(2026, 7, 20, 10, 30).toISOString()
    const inputValue = formatDateTimeInput(iso)
    expect(inputValue).toBe('2026-08-20T10:30')
    expect(parseDateTimeInput(inputValue)).toBe(iso)
  })

  it('未入力や壊れた値では null / 空文字を返す', () => {
    expect(formatDateTimeInput(null)).toBe('')
    expect(formatDateTimeInput('壊れた値')).toBe('')
    expect(parseDateTimeInput('')).toBeNull()
    expect(parseDateTimeInput('壊れた値')).toBeNull()
  })
})

describe('isRestartDay', () => {
  it('水曜と土曜だけ再起動日にする', () => {
    expect(isRestartDay(new Date(2026, 7, 19))).toBe(true)
    expect(isRestartDay(new Date(2026, 7, 22))).toBe(true)
    expect(isRestartDay(new Date(2026, 7, 20))).toBe(false)
  })
})
