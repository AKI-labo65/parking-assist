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
  { id: 'storeA', defaultLabel: '杉栄店', hasCommute: true, arrivalText: '現着致しました。' },
  { id: 'storeB', defaultLabel: '名東本通店', hasCommute: false, arrivalText: 'ただいま、名東本通店に到着しました。' },
]
// 報告文の宛先や10:00〜18:00の勤務報告に使う店舗。
export const MAIN_STORE_ID = 'storeB'

export const OPERATION_STORES = [
  { id: 'storeB', defaultLabel: '名東本通店', description: 'いつもの勤務先', parkingLayout: 'meito' },
  { id: 'storeA', defaultLabel: '杉栄店', description: 'こちらで勤務する日', parkingLayout: 'sugie' },
]

export const DEFAULT_SETTINGS = { storeLabels: { storeA: '杉栄店', storeB: '名東本通店' } }

export const MEITO_SPOT_COLUMNS = [
  ['1', '2', '3', '4', '5', '6', '7', '8'],
  ['21', '20', '19', '18', '17', '16', '15', '14', '13', '12', '10', '9'],
]
export const SUGIE_SPOT_COLUMNS = [
  ['15', '14', '13', '12', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1'],
  ['16', '17', '18', '19', '20', '21', '23'],
]
export const SUGIE_SPOTS = [
  ['15', 1, 1], ['14', 1, 2], ['13', 1, 3], ['12', 1, 4], ['10', 1, 5], ['9', 1, 6], ['8', 1, 7], ['7', 1, 8],
  ['16', 3, 4], ['17', 3, 5], ['18', 3, 6], ['19', 4, 6], ['20', 5, 6], ['21', 6, 6], ['23', 7, 6],
  ['6', 2, 8], ['5', 3, 8], ['4', 4, 8], ['3', 5, 8], ['2', 6, 8], ['1', 8, 8],
].map(([spot, column, row]) => ({ spot, column, row }))
export const PARKING_LAYOUTS = {
  meito: { id: 'meito', label: '名東本通店の配置', quickColumns: MEITO_SPOT_COLUMNS },
  sugie: { id: 'sugie', label: '杉栄店の配置', quickColumns: SUGIE_SPOT_COLUMNS, spots: SUGIE_SPOTS },
}
export const PARKING_SPOT_COLUMNS = MEITO_SPOT_COLUMNS
export const PARKING_SPOTS = MEITO_SPOT_COLUMNS.flat()

export const STATUS = {
  parking: { label: '駐車中', tone: 'parking' },
  issued: { label: '証明書発行済み', tone: 'issued' },
  settled: { label: '精算済み', tone: 'settled' },
}
