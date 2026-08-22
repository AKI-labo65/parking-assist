export function getDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatDateLabel(date = new Date()) {
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  return `${date.getMonth() + 1}/${date.getDate()}（${weekdays[date.getDay()]}）`
}

export function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// datetime-localの入力欄は秒まで扱う（step="1"）。分までに丸めると、
// 90秒ルールに使う証明書発行時刻が編集のたびにずれてしまう。
export function formatDateTimeInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 19)
}

export function parseDateTimeInput(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// 触っていない時刻欄は、保存された値（ミリ秒まで）をそのまま残す。
export function resolveEditedDateTimeInput(value, originalValue) {
  if (value === formatDateTimeInput(originalValue)) return originalValue || null
  return parseDateTimeInput(value)
}

export function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0)
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`
}
