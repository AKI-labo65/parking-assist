import { describe, expect, it } from 'vitest'
import { getRestartRule, shouldRestartForStore } from '../workRules.js'

describe('getRestartRule', () => {
  it('水曜と日曜は再起動対象日にする', () => {
    expect(getRestartRule(new Date(2026, 7, 19))).toMatchObject({ id: 'wednesday', required: true })
    expect(getRestartRule(new Date(2026, 7, 23))).toMatchObject({ id: 'sunday', required: true })
  })

  it('土曜は初期点検の結果で判定する日にする', () => {
    expect(getRestartRule(new Date(2026, 7, 22))).toMatchObject({ id: 'saturday', required: false })
  })

  it('それ以外の曜日は再起動なしにする', () => {
    expect(getRestartRule(new Date(2026, 7, 20))).toMatchObject({ id: 'none', required: false })
  })
})

describe('shouldRestartForStore', () => {
  const saturday = getRestartRule(new Date(2026, 7, 22))

  it('対象日は初期点検の秒数によらず再起動する', () => {
    expect(shouldRestartForStore(getRestartRule(new Date(2026, 7, 19)), { inspectionSeconds: '3' })).toBe(true)
  })

  it('土曜は初期点検8秒以上のときだけ再起動する', () => {
    expect(shouldRestartForStore(saturday, { inspectionSeconds: '7' })).toBe(false)
    expect(shouldRestartForStore(saturday, { inspectionSeconds: '8' })).toBe(true)
    expect(shouldRestartForStore(saturday, { inspectionSeconds: '12' })).toBe(true)
    expect(shouldRestartForStore(saturday, {})).toBe(false)
  })

  it('すでに再起動を記録していれば、秒数を直しても入力欄を残す', () => {
    expect(shouldRestartForStore(saturday, { inspectionSeconds: '7', restartStartedAt: '2026-08-22T01:00:00.000Z' })).toBe(true)
    expect(shouldRestartForStore(saturday, { inspectionSeconds: '', restartCompletedAt: '2026-08-22T01:20:00.000Z' })).toBe(true)
  })

  it('再起動なしの日は再起動しない', () => {
    expect(shouldRestartForStore(getRestartRule(new Date(2026, 7, 20)), { inspectionSeconds: '30' })).toBe(false)
  })
})
