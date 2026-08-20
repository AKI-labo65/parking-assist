export const STORAGE_PREFIX = 'parking-assist-records:'
export const WORK_STORAGE_PREFIX = 'parking-assist-work:'
export const SETTINGS_STORAGE_KEY = 'parking-assist-settings'

// 証明書発行までの制限時間。90秒以内はシフト終了後の一括報告、超過は都度報告。
export const OVER_LIMIT_SECONDS = 90
// 90秒に近づいたことを画面上で知らせ始める秒数。
export const WARNING_SECONDS = 60

export const COMMON_NOTES = ['サービス券1枚使用', '料金未発生', '操作ミス', '発行できず', '精算時間不明']

export const REPORT_TYPES = [
  { id: 'normal', label: '通常', description: '1分30秒以内・問題なく発行' },
  { id: 'entryNoCertificate', label: '入店時：証明書未発行', description: '入店時に証明書が出ていなかった' },
  { id: 'issuanceDefect', label: '発行不具合', description: '1分30秒以内だが一度発行できなかった' },
  { id: 'entryMisoperation', label: '入店時：誤操作', description: '駐車証明・精算の誤操作があった' },
  { id: 'serviceTicket', label: '未発行＋サービス券', description: '証明書未発行でもサービス券で精算' },
  { id: 'custom', label: '自由入力', description: '定型文を使わず補足する' },
]

export const REPORT_FLAGS = [
  { id: 'misoperationOnce', label: '駐車証明と精算の誤操作(1度のみ)' },
  { id: 'certificateIssued', label: '駐車証明発行済' },
  { id: 'issuanceFailedOnce', label: '1度発行不可' },
]

export const COMMUTE_OPTIONS = ['車', '電車']
export const RESTART_MESSAGES = ['只今から次の店舗の方に向かいます。', '現場離れます。']
export const COMMON_WORK_MESSAGES = ['合流済み、現地にてオリエン完了しました。']

export const WORK_STORES = [
  { id: 'storeA', defaultLabel: '店舗A', hasCommute: true },
  { id: 'storeB', defaultLabel: '店舗B', hasCommute: false },
]
// 報告文の宛先や10:00〜18:00の勤務報告に使う店舗。
export const MAIN_STORE_ID = 'storeB'

export const DEFAULT_SETTINGS = { storeLabels: { storeA: '店舗A', storeB: '店舗B' } }

export const PARKING_SPOT_COLUMNS = [
  ['1', '2', '3', '4', '5', '6', '7', '8'],
  ['21', '20', '19', '18', '17', '16', '15', '14', '13', '12', '10', '9'],
]
export const PARKING_SPOTS = PARKING_SPOT_COLUMNS.flat()

export const STATUS = {
  parking: { label: '駐車中', tone: 'parking' },
  issued: { label: '証明書発行済み', tone: 'issued' },
  settled: { label: '精算済み', tone: 'settled' },
}
