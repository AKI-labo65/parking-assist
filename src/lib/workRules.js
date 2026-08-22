// 精算機の再起動は水曜・日曜が対象日。土曜は初期点検が8秒以上かかったときだけ実施する。
export function getRestartRule(date = new Date()) {
  const day = date.getDay()
  if (day === 3) return { id: 'wednesday', required: true, label: '水曜日は再起動対象日です' }
  if (day === 0) return { id: 'sunday', required: true, label: '日曜日は再起動対象日です' }
  if (day === 6) return { id: 'saturday', required: false, label: '土曜日は初期点検8秒以上で再起動します' }
  return { id: 'none', required: false, label: '今日は再起動なしの勤務日です' }
}

// 土曜は初期点検の秒数で判定する。すでに再起動を記録していれば、あとから
// 秒数を書き換えても入力欄が消えないようにする。
export function shouldRestartForStore(rule, store) {
  if (rule.required) return true
  if (rule.id !== 'saturday') return false
  return Number(store?.inspectionSeconds) >= 8 || Boolean(store?.restartStartedAt || store?.restartCompletedAt)
}
