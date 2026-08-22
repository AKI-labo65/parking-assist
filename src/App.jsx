import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  COMMON_NOTES,
  COMMON_WORK_MESSAGES,
  COMMUTE_OPTIONS,
  MAIN_STORE_ID,
  OVER_LIMIT_SECONDS,
  PARKING_SPOTS,
  PARKING_SPOT_COLUMNS,
  REPORT_FLAGS,
  REPORT_TYPES,
  RESTART_MESSAGES,
  STATUS,
  WARNING_SECONDS,
} from './lib/constants.js'
import {
  formatDateLabel,
  formatDateTimeInput,
  formatDuration,
  formatTime,
  getDateKey,
  resolveEditedDateTimeInput,
} from './lib/time.js'
import { getRestartRule, shouldRestartForStore } from './lib/workRules.js'
import {
  createRecord,
  findActiveSpotConflict,
  formatSpotLabel,
  getElapsedSeconds,
  getNotes,
  getRecordSpot,
  getRecordSpotLabel,
  isOverLimit,
  nextUnknownLabel,
  normalizeReportFlags,
  normalizeSpot,
  sortRecords,
} from './lib/records.js'
import {
  buildBulkReportText,
  buildImmediateLineText,
  buildShiftNotEndedText,
  buildStoreConfigs,
  buildWorkLineText,
  getMainStoreLabel,
  selectBulkReportRecords,
} from './lib/reports.js'
import {
  copyToClipboard,
  loadRecords,
  loadSettings,
  loadWorkReport,
  saveRecords,
  saveSettings,
  saveWorkReport,
} from './lib/storage.js'

function Icon({ name, size = 20 }) {
  const paths = {
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
    check: <><path d="m5 12.5 4.2 4.2L19 7" /></>,
    edit: <><path d="M4 20h4l10.8-10.8a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="m14.5 7.5 3 3" /></>,
    trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></>,
    copy: <><rect x="8" y="8" width="10" height="11" rx="1.5" /><path d="M6 15H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h7A1.5 1.5 0 0 1 13.5 5v1" /></>,
    note: <><path d="M5 3.5h10l3 3V20H5z" /><path d="M15 3.5V7h3M8 11h7M8 14.5h7M8 18h4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.8-4L3 10" /><path d="M3 5v5h5M4 13a8 8 0 0 0 14.8 4L21 14" /><path d="M21 19v-5h-5" /></>,
    undo: <><path d="M4 9h11a5 5 0 0 1 0 10H9" /><path d="M8 5 4 9l4 4" /></>,
    arrow: <path d="m9 18 6-6-6-6" />,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
// 重ねて開いたときに、一番手前のダイアログだけがEscapeとTabを受け取るようにする。
const modalStack = []

// すべてのシート・モーダル共通の土台。Escapeで閉じる／開いた時にフォーカスを移す／
// 背面のスクロールを止める／閉じたら元の要素へフォーカスを戻す、をまとめて行う。
function ModalShell({ labelledBy, className = 'bottom-sheet', onClose, children }) {
  const dialogRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    const token = {}
    modalStack.push(token)
    const previouslyFocused = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.body.classList.add('modal-open')
    // 背面の内容は読み上げ・タブ移動の対象から外す。
    const backdrop = dialog?.closest('.modal-backdrop')
    const hidden = (backdrop?.parentElement ? [...backdrop.parentElement.children] : []).filter((element) => element !== backdrop).map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute('aria-hidden'),
    }))
    hidden.forEach(({ element }) => {
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    })
    const autoFocus = dialog?.querySelector('[data-autofocus]')
    ;(autoFocus || dialog)?.focus?.({ preventScroll: true })

    const onKeyDown = (event) => {
      if (modalStack[modalStack.length - 1] !== token) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      const index = modalStack.indexOf(token)
      if (index >= 0) modalStack.splice(index, 1)
      if (modalStack.length === 0) document.body.classList.remove('modal-open')
      document.removeEventListener('keydown', onKeyDown)
      hidden.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert
        if (ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
      })
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [])

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className={className} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>{children}</section>
  </div>
}

function SheetHeading({ eyebrow, title, titleId, onClose }) {
  return <div className="sheet-heading"><div><span className="eyebrow">{eyebrow}</span><h2 id={titleId}>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button></div>
}

function ConfirmDialog({ request, onClose }) {
  return <ModalShell className="edit-modal confirm-modal" labelledBy="confirm-dialog-title" onClose={onClose}>
    <div className="modal-heading"><div><span className="eyebrow">{request.eyebrow || '確認'}</span><h2 id="confirm-dialog-title">{request.title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button></div>
    <p className="spot-confirm-help">{request.description}</p>
    <div className="modal-footer confirm-footer">
      <button type="button" className="secondary-button" onClick={onClose}>キャンセル</button>
      <button type="button" className={request.danger === false ? 'primary-button' : 'delete-all-confirm-button'} onClick={() => { request.onConfirm(); onClose() }}>{request.danger === false ? null : <Icon name="trash" size={17} />}{request.confirmLabel || '削除する'}</button>
    </div>
  </ModalShell>
}

function NavigationTab({ tab, activeView, onSelect, mobile = false }) {
  const iconName = { record: 'note', issued: 'check', history: 'clock' }[tab.id]
  return <button type="button" className={`${activeView === tab.id ? 'active ' : ''}${mobile ? 'mobile-tab' : ''}`} onClick={() => onSelect(tab.id)} aria-current={activeView === tab.id ? 'page' : undefined}>
    {mobile && <Icon name={iconName} size={18} />}
    <span>{mobile ? tab.mobileLabel || tab.label : tab.label}</span>
    {tab.count > 0 && <span className={mobile ? 'mobile-tab-count' : 'tab-count'}>{tab.count}</span>}
  </button>
}

function StatusBadge({ status, children }) {
  const meta = STATUS[status] || STATUS.parking
  return <span className={`status-badge ${meta.tone}`}>{children || meta.label}</span>
}

function EmptyState({ title, detail }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name="clock" size={24} /></div><strong>{title}</strong><span>{detail}</span></div>
}

function WorkNumberField({ label, value, suffix, onChange }) {
  return <label className="work-field"><span>{label}</span><div><input type="number" min="0" inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} placeholder="—" /><small>{suffix}</small></div></label>
}

function WorkStoreCard({ config, data, restartRequired, restartRule, onPatch, onNotify }) {
  const hasArrival = Boolean(data.arrivalAt)
  const hasRestartStarted = Boolean(data.restartStartedAt)
  const hasRestartCompleted = Boolean(data.restartCompletedAt)
  const markArrival = () => {
    if (hasArrival) return
    onPatch({ arrivalAt: new Date().toISOString() })
    onNotify(`${config.label}の到着を記録しました`)
  }
  const markRestartStart = () => {
    if (!hasArrival || hasRestartStarted) return
    onPatch({ restartStartedAt: new Date().toISOString() })
    onNotify(`${config.label}の再起動開始を記録しました`)
  }
  const markRestartComplete = () => {
    if (!hasRestartStarted || hasRestartCompleted) return
    onPatch({ restartCompletedAt: new Date().toISOString() })
    onNotify(`${config.label}の復旧結果を記録しました`)
  }
  const markGreeting = () => {
    if (!hasArrival || data.greetingAt) return
    onPatch({ greetingAt: new Date().toISOString() })
    onNotify('店舗挨拶を記録しました')
  }

  return <article className={`work-store-card ${hasArrival ? 'is-started' : ''}`}>
    <div className="work-card-heading"><div><span className="work-step">{config.id === MAIN_STORE_ID ? '2' : '1'}</span><div><h2>{config.label}</h2><span>{hasArrival ? `到着 ${formatTime(data.arrivalAt)}` : '未到着'}</span></div></div><StatusBadge status={hasArrival ? 'settled' : 'parking'}>{hasArrival ? '到着済み' : '待機中'}</StatusBadge></div>
    <button type="button" className={`work-main-button ${hasArrival ? 'completed' : ''}`} disabled={hasArrival} onClick={markArrival}>{hasArrival ? <><Icon name="check" size={19} />到着を記録済み</> : <><Icon name="plus" size={19} />{config.label}に到着</>}</button>
    {hasArrival && <div className="work-details">
      <div className="work-detail-grid">
        <WorkNumberField label="初期点検" value={data.inspectionSeconds} suffix="秒" onChange={(value) => onPatch({ inspectionSeconds: value })} />
        {config.hasCommute && <div className="work-choice"><span>移動手段</span><div>{COMMUTE_OPTIONS.map((choice) => <button key={choice} type="button" className={data.commute === choice ? 'selected' : ''} aria-pressed={data.commute === choice} onClick={() => onPatch({ commute: choice })}>{choice}</button>)}</div></div>}
      </div>
      <section className={`work-restart ${hasRestartCompleted ? 'complete' : ''}`}>
        <div className="work-subheading"><strong>精算機の再起動</strong><span>{restartRequired ? (restartRule.id === 'saturday' ? '初期点検8秒以上' : '本日の対象日') : restartRule.id === 'saturday' ? '初期点検8秒未満' : '今日は対象外'}</span></div>
        {!restartRequired ? <p className="work-muted">{restartRule.id === 'saturday' ? '初期点検が8秒以上になった場合のみ再起動します。' : '今日は再起動の報告はありません。'}</p> : <>
          <button type="button" className="secondary-button work-wide-button" disabled={!hasArrival || hasRestartStarted} onClick={markRestartStart}>{hasRestartStarted ? '再起動開始を記録済み' : '再起動開始を記録'}</button>
          {hasRestartStarted && <><div className="work-restart-fields"><WorkNumberField label="再起動前" value={data.restartBeforeSeconds} suffix="秒" onChange={(value) => onPatch({ restartBeforeSeconds: value })} /><WorkNumberField label="再起動後" value={data.restartAfterSeconds} suffix="秒" onChange={(value) => onPatch({ restartAfterSeconds: value })} /><WorkNumberField label="QRリーダー" value={data.qrMinutes} suffix="分" onChange={(value) => onPatch({ qrMinutes: value })} /><WorkNumberField label="クレカ立ち上がり" value={data.creditMinutes} suffix="分" onChange={(value) => onPatch({ creditMinutes: value })} /><button type="button" className="primary-button work-wide-button" disabled={hasRestartCompleted} onClick={markRestartComplete}>{hasRestartCompleted ? <><Icon name="check" size={19} />復旧結果を記録済み</> : '復旧結果を記録'}</button></div><div className="work-message-options"><span>再起動後の一言（任意）</span><div>{RESTART_MESSAGES.map((message) => <button key={message} type="button" className={data.restartNote === message ? 'selected' : ''} aria-pressed={data.restartNote === message} onClick={() => onPatch({ restartNote: message })}>{message}</button>)}</div><input className="text-input" value={data.restartNote} onChange={(event) => onPatch({ restartNote: event.target.value })} placeholder="自由入力もできます" aria-label="再起動後の一言" /></div></>}
        </>}
      </section>
      {config.id === MAIN_STORE_ID && <section className="work-greeting"><div className="work-subheading"><strong>店舗挨拶・サービス券</strong><span>{data.greetingAt ? `完了 ${formatTime(data.greetingAt)}` : '未完了'}</span></div><button type="button" className="secondary-button work-wide-button" disabled={Boolean(data.greetingAt)} onClick={markGreeting}>{data.greetingAt ? '店舗挨拶を記録済み' : '店舗挨拶を記録'}</button>{data.greetingAt && <WorkNumberField label="サービス券預かり" value={data.serviceTickets} suffix="枚" onChange={(value) => onPatch({ serviceTickets: value })} />}</section>}
    </div>}
  </article>
}

function WorkScheduleCard({ schedule, onPatch, onNotify, onConfirm }) {
  const items = [
    { key: 'startedAt', label: '10:00 勤務開始', detail: '配置につきました' },
    { key: 'breakAt', label: '12:00 休憩開始', detail: '配置一時解除' },
    { key: 'resumedAt', label: '15:00 業務再開', detail: '配置につきました' },
    { key: 'endedAt', label: '18:00 勤務終了', detail: '配置解除・店舗挨拶完了' },
  ]
  const applyAction = (item, action) => {
    if (action === 'remove') {
      onPatch({ [item.key]: null })
      onNotify(`${item.label}の記録を取り消しました`)
      return
    }
    onPatch({ [item.key]: new Date().toISOString() })
    onNotify(`${item.label}を記録しました`)
  }
  // 押し間違えても取り消せるようにし、順番が飛んだときは確認してから記録する。
  const mark = (item) => {
    if (schedule[item.key]) {
      onConfirm({
        eyebrow: '勤務時間の記録',
        title: `${item.label}を取り消しますか？`,
        description: '記録した時刻が削除され、勤務報告にも含まれなくなります。',
        confirmLabel: '記録を取り消す',
        onConfirm: () => applyAction(item, 'remove'),
      })
      return
    }
    const missingPrevious = items.slice(0, items.findIndex(({ key }) => key === item.key)).filter(({ key }) => !schedule[key])
    if (missingPrevious.length > 0) {
      onConfirm({
        eyebrow: '勤務時間の記録',
        title: `${item.label}を先に記録しますか？`,
        description: `${missingPrevious.map(({ label }) => label).join('、')}が未記録です。順番を確認してから進めてください。`,
        confirmLabel: 'このまま記録',
        danger: false,
        onConfirm: () => applyAction(item, 'record'),
      })
      return
    }
    applyAction(item, 'record')
  }
  return <article className="work-schedule-card"><div className="section-heading work-heading"><div><h2>勤務時間</h2><p>現場で押した時刻を保存し、報告文に反映します。</p></div></div><div className="work-schedule-grid">{items.map((item) => <button key={item.key} type="button" className={`work-schedule-button ${schedule[item.key] ? 'completed' : ''}`} onClick={() => mark(item)} aria-label={schedule[item.key] ? `${item.label}の記録を取り消す` : item.label}><span>{schedule[item.key] ? <Icon name="check" size={19} /> : <span className="schedule-time">{item.label.slice(0, 5)}</span>}</span><strong>{schedule[item.key] ? `${item.label} 済` : item.label}</strong><small>{schedule[item.key] ? `記録 ${formatTime(schedule[item.key])}・タップで取り消し` : item.detail}</small></button>)}</div><div className="work-counts"><WorkNumberField label="店舗駐車券預り" value={schedule.parkingTickets} suffix="枚" onChange={(value) => onPatch({ parkingTickets: value })} /><WorkNumberField label="お客様から返却" value={schedule.returnedTickets} suffix="枚" onChange={(value) => onPatch({ returnedTickets: value })} /><WorkNumberField label="お客様へ配布" value={schedule.distributedTickets} suffix="枚" onChange={(value) => onPatch({ distributedTickets: value })} /></div><div className="work-message-options work-general-message"><span>途中の報告（任意）</span><div>{COMMON_WORK_MESSAGES.map((message) => <button key={message} type="button" className={schedule.extraMessage === message ? 'selected' : ''} aria-pressed={schedule.extraMessage === message} onClick={() => onPatch({ extraMessage: message })}>{message}</button>)}</div><input className="text-input" value={schedule.extraMessage} onChange={(event) => onPatch({ extraMessage: event.target.value })} placeholder="自由入力もできます" aria-label="途中の報告" /></div><label className="field-label work-memo-label" htmlFor="work-finish-memo">終了時の補足（任意）</label><textarea id="work-finish-memo" className="text-input memo-input" value={schedule.finishMemo} onChange={(event) => onPatch({ finishMemo: event.target.value })} rows="2" placeholder="例：サービス券受取が少なかったため配布数が増加" /></article>
}

function WorkReportView({ report, storeConfigs, restartRule, lineText, onStorePatch, onSchedulePatch, onNotify, onConfirm, onGenerate, onCopy }) {
  const restartRequiredByStore = storeConfigs.map((config) => shouldRestartForStore(restartRule, report.stores[config.id]))
  const hasRestartTarget = restartRequiredByStore.some(Boolean)
  return <section className="view-section" aria-labelledby="work-heading"><div className="section-heading"><div><h1 id="work-heading">勤務報告</h1><p>店舗の到着・再起動・休憩・終了を順番に記録します。</p></div><span className={`section-count ${hasRestartTarget ? 'restart-day-label' : ''}`}>{restartRule.required ? '本日は再起動日' : restartRule.id === 'saturday' ? (hasRestartTarget ? '再起動対象あり' : '初期点検で判定') : '再起動なし'}</span></div><div className={`work-rule-banner ${hasRestartTarget ? 'restart' : ''}`}><span className="tip-icon">!</span><span><strong>{restartRule.label}</strong><br />{storeConfigs.map((config) => config.label).join(' → ')} → 10:00開始 → 12:00休憩 → 15:00再開 → 18:00終了</span></div><div className="work-store-list">{storeConfigs.map((config, index) => <WorkStoreCard key={config.id} config={config} data={report.stores[config.id]} restartRequired={restartRequiredByStore[index]} restartRule={restartRule} onPatch={(patch) => onStorePatch(config.id, patch)} onNotify={onNotify} />)}</div><WorkScheduleCard schedule={report.schedule} onPatch={onSchedulePatch} onNotify={onNotify} onConfirm={onConfirm} /><div className="line-tools work-line-tools"><div><strong>勤務報告を作成</strong><span>現在記録されている内容だけで文章をまとめます。</span></div><button type="button" className="line-button" onClick={onGenerate}><span className="line-mark">LINE</span>報告文を生成</button></div>{lineText && <div className="line-output work-line-output"><div className="line-output-heading"><strong>生成された勤務報告</strong><button type="button" className="copy-button" onClick={onCopy}><Icon name="copy" size={17} />コピー</button></div><textarea readOnly value={lineText} aria-label="勤務報告用テキスト" /></div>}</section>
}

function SettingsSheet({ settings, onSave, onClose }) {
  const [form, setForm] = useState({ storeA: settings.storeLabels.storeA, storeB: settings.storeLabels.storeB })
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const submit = (event) => {
    event.preventDefault()
    onSave({ storeLabels: { storeA: form.storeA.trim() || '店舗A', storeB: form.storeB.trim() || '店舗B' } })
  }
  return <ModalShell labelledBy="settings-sheet-title" onClose={onClose}>
    <div className="sheet-handle" />
    <SheetHeading eyebrow="端末内に保存" title="店舗名設定" titleId="settings-sheet-title" onClose={onClose} />
    <p className="spot-confirm-help">店舗名は公開ページやコードには保存されず、この端末のブラウザ内だけに保存されます。</p>
    <form onSubmit={submit}>
      <div className="form-grid"><label className="field-label">1店舗目<input className="text-input" type="text" value={form.storeA} onChange={(event) => update('storeA', event.target.value)} placeholder="例：店舗A" /></label><label className="field-label">2店舗目<input className="text-input" type="text" value={form.storeB} onChange={(event) => update('storeB', event.target.value)} placeholder="例：店舗B" /></label></div>
      <div className="sheet-footer"><button type="button" className="secondary-button" onClick={onClose}>キャンセル</button><button type="submit" className="primary-button">店舗名を保存</button></div>
    </form>
  </ModalShell>
}

function RecordRow({ record, now, action, actionLabel, actionTone = 'primary', onNote, onReport, onEdit, onDelete }) {
  const elapsed = getElapsedSeconds(record, now)
  const overLimit = isOverLimit(record, now)
  const notes = getNotes(record)
  return <article className={`record-row ${overLimit ? 'is-over-limit' : ''}`}>
    <div className="row-main">
      <div className={`spot-number ${getRecordSpot(record) ? '' : 'unknown'}`}><span>{getRecordSpotLabel(record)}</span></div>
      <div className="row-data">
        <div className="row-topline"><StatusBadge status={record.status} />{record.lineReportedAt && <span className="result-label completed-result">報告済み {formatTime(record.lineReportedAt)}</span>}{overLimit && <span className="result-label warning">90秒超</span>}</div>
        <div className="metric-line"><span><small>経過</small><strong>{record.issuedAt ? `${elapsed}秒` : '未発行'}</strong></span><span><small>証明書発行</small><strong>{formatTime(record.issuedAt)}</strong></span>{record.status !== 'parking' && <span><small>精算</small><strong>{formatTime(record.settledAt)}</strong></span>}</div>
        {notes && <div className="row-note"><Icon name="note" size={15} />{notes}</div>}
      </div>
      {action && <button type="button" className={`action-button ${actionTone}`} onClick={() => action(record)}>{actionLabel}</button>}
    </div>
    {(onNote || onReport || onEdit || onDelete) && <div className="row-actions">
      {onNote && <button type="button" className="subtle-button" onClick={() => onNote(record)}><Icon name="note" size={16} />メモ</button>}
      {onReport && <button type="button" className="subtle-button" onClick={() => onReport(record)}><Icon name="note" size={16} />報告設定</button>}
      {onEdit && <button type="button" className="subtle-button" onClick={() => onEdit(record)}><Icon name="edit" size={16} />編集</button>}
      {onDelete && <button type="button" className="subtle-button danger" onClick={() => onDelete(record)}><Icon name="trash" size={16} />削除</button>}
    </div>}
  </article>
}

function ParkingGrid({ records, onStart, onOpenRecord }) {
  const occupied = useMemo(() => new Map(records.filter((record) => record.status !== 'settled' && getRecordSpot(record)).map((record) => [getRecordSpot(record), record])), [records])
  return <div className="parking-layout" aria-label="駐車位置番号の実際の配置">
    {PARKING_SPOT_COLUMNS.map((column, columnIndex) => <div key={columnIndex} className={`parking-column ${columnIndex === 0 ? 'left' : 'right'}`}>
      {column.map((spot) => {
        const record = occupied.get(spot)
        const statusLabel = record ? (record.status === 'parking' ? '対応中' : '待ち') : null
        return <button key={spot} type="button" className={`spot-button ${record?.status === 'parking' ? 'active' : ''} ${record?.status === 'issued' ? 'waiting' : ''}`} onClick={() => record ? onOpenRecord(record) : onStart(spot)} aria-label={`${spot}番${record ? `・${statusLabel}・詳細を開く` : '・新しく記録開始'}`}>
          <strong>{spot}</strong>
          {record && <small>{statusLabel}</small>}
        </button>
      })}
    </div>)}
  </div>
}

function SpotConfirmSheet({ record, occupiedSpots, onConfirm, onClose }) {
  const initialSpot = getRecordSpot(record)
  const [spot, setSpot] = useState(initialSpot || '')
  const hasKnownSpot = Boolean(initialSpot)
  const trimmedSpot = normalizeSpot(spot)
  const conflicted = Boolean(trimmedSpot && occupiedSpots.has(trimmedSpot))
  return <ModalShell className="bottom-sheet spot-confirm-sheet" labelledBy="spot-confirm-title" onClose={onClose}>
    <div className="sheet-handle" />
    <SheetHeading eyebrow="証明書発行と同時に確定" title="番号を入力して発行" titleId="spot-confirm-title" onClose={onClose} />
    <p className="spot-confirm-help">利用者さまに駐車位置番号を確認し、入力してから発行を確定してください。開始時の番号が違っていても修正できます。</p>
    {hasKnownSpot && <p className="spot-confirm-started">開始時の番号：<strong>{formatSpotLabel(initialSpot)}</strong></p>}
    <label className="field-label" htmlFor="certificate-spot">駐車位置番号（入力必須・数字／英字）</label>
    <input id="certificate-spot" className="text-input spot-confirm-input" type="text" inputMode="numeric" data-autofocus value={spot} onChange={(event) => setSpot(event.target.value)} placeholder="例：17（直接入力する場合）" />
    {conflicted && <p className="spot-conflict-warning" role="alert">{formatSpotLabel(trimmedSpot)}は別の記録で対応中です。番号を確認してください。</p>}
    <div className="spot-quick-grid" aria-label="駐車位置番号の候補">{PARKING_SPOTS.map((quickSpot) => <button key={quickSpot} type="button" className={`${spot === quickSpot ? 'selected' : ''} ${occupiedSpots.has(quickSpot) ? 'occupied' : ''}`} aria-label={`${quickSpot}番${occupiedSpots.has(quickSpot) ? '・対応中' : ''}`} onClick={() => setSpot(quickSpot)}>{quickSpot}</button>)}</div>
    <div className="spot-confirm-actions"><button type="button" className="primary-button" disabled={!trimmedSpot || conflicted} onClick={() => onConfirm(record.id, spot)}>{trimmedSpot ? `${formatSpotLabel(trimmedSpot)}で発行確定` : '番号を入力してください'}</button><button type="button" className="exception-button" onClick={() => onConfirm(record.id, '')}>番号不明のまま発行（例外）</button></div>
  </ModalShell>
}

function NoteSheet({ record, onSave, onClose }) {
  const [presets, setPresets] = useState(record.notePresets || [])
  const [memo, setMemo] = useState(record.memo || '')
  const togglePreset = (note) => setPresets((current) => current.includes(note) ? current.filter((item) => item !== note) : [...current, note])
  return <ModalShell labelledBy="note-sheet-title" onClose={onClose}>
    <div className="sheet-handle" />
    <SheetHeading eyebrow={`${getRecordSpotLabel(record)}の記録`} title="例外メモを選択" titleId="note-sheet-title" onClose={onClose} />
    <div className="note-options">{COMMON_NOTES.map((note) => <button key={note} type="button" className={`note-option ${presets.includes(note) ? 'selected' : ''}`} aria-pressed={presets.includes(note)} onClick={() => togglePreset(note)}>{presets.includes(note) && <Icon name="check" size={18} />}{note}</button>)}</div>
    <label className="field-label" htmlFor="free-memo">自由メモ（任意）</label>
    <textarea id="free-memo" className="text-input memo-input" value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="メモを入力してください" rows="3" />
    <div className="sheet-footer"><button type="button" className="secondary-button" onClick={onClose}>キャンセル</button><button type="button" className="primary-button" onClick={() => onSave(record.id, { notePresets: presets, memo })}>メモを保存</button></div>
  </ModalShell>
}

function ReportSheet({ record, onSave, onClose }) {
  const [reportType, setReportType] = useState(record.reportType || 'normal')
  const [flags, setFlags] = useState(normalizeReportFlags(record.reportFlags))
  const [reportMemo, setReportMemo] = useState(record.reportMemo || '')
  const toggleFlag = (flag) => setFlags((current) => ({ ...current, [flag]: !current[flag] }))
  const visibleFlags = reportType === 'issuanceDefect' ? REPORT_FLAGS.filter((flag) => flag.id === 'issuanceFailedOnce') : REPORT_FLAGS.filter((flag) => flag.id !== 'issuanceFailedOnce')
  return <ModalShell labelledBy="report-sheet-title" onClose={onClose}>
    <div className="sheet-handle" />
    <SheetHeading eyebrow={`${getRecordSpotLabel(record)}の退店後報告`} title="LINE報告パターン" titleId="report-sheet-title" onClose={onClose} />
    <p className="spot-confirm-help">精算後、必要に応じて選択してください。選んだ形式と補足は、この記録のLINE報告に反映されます。</p>
    <div className="report-options" aria-label="LINE報告パターン">
      {REPORT_TYPES.map((type) => <button key={type.id} type="button" className={`report-type-option ${reportType === type.id ? 'selected' : ''}`} aria-pressed={reportType === type.id} onClick={() => setReportType(type.id)}><strong>{type.label}</strong><small>{type.description}</small></button>)}
    </div>
    {reportType !== 'normal' && reportType !== 'serviceTicket' && <>
      <div className="field-label">報告に含める内容</div>
      <div className="report-flag-options">{visibleFlags.map((flag) => <button key={flag.id} type="button" className={`report-flag-option ${flags[flag.id] ? 'selected' : ''}`} aria-pressed={Boolean(flags[flag.id])} onClick={() => toggleFlag(flag.id)}>{flags[flag.id] && <Icon name="check" size={16} />}{flag.label}</button>)}</div>
    </>}
    <label className="field-label" htmlFor="report-memo">報告に追加する補足（任意）</label>
    <textarea id="report-memo" className="text-input memo-input" value={reportMemo} onChange={(event) => setReportMemo(event.target.value)} rows="3" placeholder="例：店内でサービス券を受け取られていました" />
    <div className="sheet-footer"><button type="button" className="secondary-button" onClick={onClose}>キャンセル</button><button type="button" className="primary-button" onClick={() => onSave(record.id, { reportType, reportFlags: flags, reportMemo })}>報告設定を保存</button></div>
  </ModalShell>
}

function EditModal({ record, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({
    spot: record.spot,
    startedAt: formatDateTimeInput(record.startedAt),
    issuedAt: formatDateTimeInput(record.issuedAt),
    settledAt: formatDateTimeInput(record.settledAt),
    notePresets: record.notePresets || [],
    memo: record.memo || '',
  })
  const [error, setError] = useState('')
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const togglePreset = (note) => update('notePresets', form.notePresets.includes(note) ? form.notePresets.filter((item) => item !== note) : [...form.notePresets, note])
  const submit = (event) => {
    event.preventDefault()
    const spot = normalizeSpot(form.spot)
    const startedAt = resolveEditedDateTimeInput(form.startedAt, record.startedAt) || record.startedAt
    const issuedAt = resolveEditedDateTimeInput(form.issuedAt, record.issuedAt)
    const settledAt = resolveEditedDateTimeInput(form.settledAt, record.settledAt)
    // 時刻の前後が入れ替わった記録は保存させない。
    if (issuedAt && new Date(issuedAt) < new Date(startedAt)) return setError('証明書発行の時刻は、駐車開始より後にしてください。')
    if (settledAt && new Date(settledAt) < new Date(issuedAt || startedAt)) return setError('精算の時刻は、証明書発行（または駐車開始）より後にしてください。')
    setError('')
    onSave(record.id, { spot, startedSpot: record.startedSpot || spot, spotConfirmedAt: issuedAt ? (record.spotConfirmedAt || issuedAt) : null, spotSource: spot ? 'edit' : 'unknown', startedAt, issuedAt, settledAt, exitCompletedAt: settledAt ? (record.exitCompletedAt || settledAt) : null, lineReportedAt: settledAt ? record.lineReportedAt : null, status: settledAt ? 'settled' : issuedAt ? 'issued' : 'parking', notePresets: form.notePresets, memo: form.memo })
  }
  return <ModalShell className="edit-modal" labelledBy="edit-modal-title" onClose={onClose}>
    <div className="modal-heading"><div><span className="eyebrow">記録を修正</span><h2 id="edit-modal-title">{getRecordSpotLabel(record)}の詳細</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button></div>
    <form onSubmit={submit}>
      <div className="form-grid"><label className="field-label">駐車位置番号<input className="text-input" type="text" inputMode="numeric" placeholder="未入力でも可" value={form.spot || ''} onChange={(event) => update('spot', event.target.value)} /></label><label className="field-label">駐車開始<input className="text-input" type="datetime-local" step="1" value={form.startedAt} onChange={(event) => update('startedAt', event.target.value)} /></label><label className="field-label">証明書発行<input className="text-input" type="datetime-local" step="1" value={form.issuedAt} onChange={(event) => update('issuedAt', event.target.value)} /></label><label className="field-label">精算時刻<input className="text-input" type="datetime-local" step="1" value={form.settledAt} onChange={(event) => update('settledAt', event.target.value)} /></label></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="field-label">例外メモ</div><div className="note-options compact">{COMMON_NOTES.map((note) => <button key={note} type="button" className={`note-option ${form.notePresets.includes(note) ? 'selected' : ''}`} aria-pressed={form.notePresets.includes(note)} onClick={() => togglePreset(note)}>{form.notePresets.includes(note) && <Icon name="check" size={16} />}{note}</button>)}</div>
      <label className="field-label" htmlFor="edit-memo">自由メモ</label><textarea id="edit-memo" className="text-input memo-input" value={form.memo} onChange={(event) => update('memo', event.target.value)} rows="3" placeholder="メモを入力してください" />
      <div className="modal-footer"><button type="button" className="subtle-button danger delete-record" onClick={() => onDelete(record)}>この記録を削除</button><div className="footer-right"><button type="button" className="secondary-button" onClick={onClose}>キャンセル</button><button type="submit" className="primary-button">変更を保存</button></div></div>
    </form>
  </ModalShell>
}

function ActiveRecordCard({ record, now, onIssue, onNote, onEdit, onDelete }) {
  const elapsed = getElapsedSeconds(record, now)
  const remaining = OVER_LIMIT_SECONDS - elapsed
  const tone = elapsed > OVER_LIMIT_SECONDS ? 'is-over' : elapsed >= WARNING_SECONDS ? 'is-warning' : ''
  return <div className={`active-record ${tone}`}>
    <div className="active-summary">
      <strong className={!getRecordSpot(record) ? 'unknown' : ''}>{getRecordSpotLabel(record)}</strong>
      <div>
        <StatusBadge status="parking" />
        <div className="active-time">{elapsed}<small>秒</small><span>{formatDuration(elapsed)}</span></div>
        <div className="timer-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, (elapsed / OVER_LIMIT_SECONDS) * 100)}%` }} /></div>
        <div className="timer-remaining">{remaining >= 0 ? `90秒まで残り${remaining}秒` : `90秒を${Math.abs(remaining)}秒超過（都度報告）`}</div>
      </div>
    </div>
    <div className="active-actions">
      <button type="button" className="primary-button issue-button" onClick={() => onIssue(record)}><Icon name="check" size={20} /><span>証明書発行＋番号入力</span></button>
      <div className="active-more-actions">
        <button type="button" className="secondary-button note-button" onClick={() => onNote(record)}><Icon name="note" size={16} />メモ</button>
        <button type="button" className="secondary-button note-button" onClick={() => onEdit(record)}><Icon name="edit" size={16} />編集</button>
        <button type="button" className="secondary-button note-button danger" onClick={() => onDelete(record)}><Icon name="trash" size={16} />削除</button>
      </div>
    </div>
  </div>
}

function Toast({ toast, onAction }) {
  return <div className={`toast ${toast.undo ? 'with-action' : ''}`} role="status">
    <span>{toast.message}</span>
    {toast.undo && <button type="button" className="toast-action" onClick={onAction}><Icon name="undo" size={15} />元に戻す</button>}
  </div>
}

export default function App() {
  const [dateKey, setDateKey] = useState(() => getDateKey())
  const dateKeyRef = useRef(dateKey)
  const restartRule = getRestartRule()
  const [settings, setSettings] = useState(() => loadSettings())
  const [records, setRecords] = useState(() => loadRecords(dateKey))
  const [workReport, setWorkReport] = useState(() => loadWorkReport(dateKey))
  const [activeView, setActiveView] = useState('record')
  const [now, setNow] = useState(Date.now())
  const [noteRecord, setNoteRecord] = useState(null)
  const [reportRecord, setReportRecord] = useState(null)
  const [editRecord, setEditRecord] = useState(null)
  const [issueRecord, setIssueRecord] = useState(null)
  const [lineText, setLineText] = useState('')
  const [lineReportTargetIds, setLineReportTargetIds] = useState([])
  const [workLineText, setWorkLineText] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmRequest, setConfirmRequest] = useState(null)
  const [toast, setToast] = useState(null)

  const storeConfigs = useMemo(() => buildStoreConfigs(settings), [settings])
  const storeLabel = useMemo(() => getMainStoreLabel(storeConfigs), [storeConfigs])

  const notify = useCallback((message, undo = null) => setToast({ message, undo, id: Date.now() }), [])

  const parkingRecords = useMemo(() => sortRecords(records.filter((record) => record.status === 'parking'), 'startedAt'), [records])
  const issuedRecords = useMemo(() => sortRecords(records.filter((record) => record.status === 'issued'), 'issuedAt'), [records])
  const settledRecords = useMemo(() => sortRecords(records.filter((record) => record.status === 'settled'), 'settledAt', 'desc'), [records])
  const activeSpots = useMemo(() => new Set(records.filter((record) => record.status !== 'settled').map(getRecordSpot).filter(Boolean)), [records])

  // 経過秒が動くのは駐車中の記録だけ。対応中が無いときは1秒ごとの再描画を止める。
  useEffect(() => {
    if (parkingRecords.length === 0) return undefined
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [parkingRecords.length])

  // 日付をまたいでもアプリを開いたままにできるよう、日付が変わったらその日の保存データへ切り替える。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextKey = getDateKey()
      if (nextKey === dateKeyRef.current) return
      dateKeyRef.current = nextKey
      setRecords(loadRecords(nextKey))
      setWorkReport(loadWorkReport(nextKey))
      setLineText('')
      setLineReportTargetIds([])
      setWorkLineText('')
      setDateKey(nextKey)
      notify('日付が変わったため、本日の記録に切り替えました')
    }, 20000)
    return () => window.clearInterval(timer)
  }, [notify])

  useEffect(() => {
    if (!saveRecords(dateKey, records)) notify('端末に保存できませんでした。ブラウザの保存設定をご確認ください')
  }, [records, dateKey, notify])

  useEffect(() => {
    saveWorkReport(dateKey, workReport)
  }, [dateKey, workReport])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    setLineText('')
    setLineReportTargetIds([])
  }, [records])

  useEffect(() => {
    setWorkLineText('')
  }, [workReport])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), toast.undo ? 7000 : 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    // Native Android builds use the bundled files directly. Keeping a Service
    // Worker there can make an app update continue serving the previous bundle.
    if (!import.meta.env.PROD) return
    if (Capacitor.isNativePlatform()) return
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  }, [])

  const updateRecord = (id, patch) => setRecords((current) => current.map((record) => record.id === id ? { ...record, ...patch } : record))
  const updateWorkStore = (storeId, patch) => setWorkReport((current) => ({ ...current, stores: { ...current.stores, [storeId]: { ...current.stores[storeId], ...patch } } }))
  const updateWorkSchedule = (patch) => setWorkReport((current) => ({ ...current, schedule: { ...current.schedule, ...patch } }))

  const startRecord = (spot) => {
    const normalizedSpot = normalizeSpot(spot)
    if (findActiveSpotConflict(records, normalizedSpot)) return notify(`${formatSpotLabel(normalizedSpot)}は現在対応中です`)
    setRecords((current) => [...current, createRecord({ spot: normalizedSpot })])
    notify(`${formatSpotLabel(normalizedSpot, '番号未入力')}のタイマーを開始しました`)
  }

  const startUnknownRecord = () => {
    const unknownLabel = nextUnknownLabel(records)
    setRecords((current) => [...current, createRecord({ unknownLabel })])
    notify(`番号未入力 #${unknownLabel}のタイマーを開始しました`)
  }

  const confirmCertificateIssue = (id, rawSpot) => {
    const current = records.find((record) => record.id === id)
    if (!current) return
    const nextSpot = normalizeSpot(rawSpot) || getRecordSpot(current)
    if (findActiveSpotConflict(records, nextSpot, id)) {
      notify(`${formatSpotLabel(nextSpot)}は現在対応中です。番号を確認してください`)
      return
    }
    const issuedAt = new Date().toISOString()
    updateRecord(id, { spot: nextSpot, spotConfirmedAt: nextSpot ? issuedAt : null, spotSource: nextSpot ? 'issue' : 'unknown', issuedAt, status: 'issued' })
    setIssueRecord(null)
    notify(`${formatSpotLabel(nextSpot)}・${getElapsedSeconds({ ...current, issuedAt })}秒で発行を記録しました`)
  }

  const settleRecord = (record) => {
    const settledAt = new Date().toISOString()
    updateRecord(record.id, { settledAt, exitCompletedAt: settledAt, lineReportedAt: null, status: 'settled' })
    notify(`${getRecordSpotLabel(record)}の精算を記録しました`)
  }

  const saveNotes = (id, patch) => {
    // 内容が変われば報告文も変わるため、報告済みの印は外して作り直してもらう。
    updateRecord(id, { ...patch, lineReportedAt: null })
    setNoteRecord(null)
    notify('メモを保存しました')
  }

  const saveReportSettings = (id, patch) => {
    updateRecord(id, { reportType: patch.reportType || 'normal', reportFlags: normalizeReportFlags(patch.reportFlags), reportMemo: patch.reportMemo || '', lineReportedAt: null })
    setReportRecord(null)
    notify('LINE報告の形式を保存しました')
  }

  const saveEdit = (id, patch) => {
    const nextSpot = normalizeSpot(patch.spot)
    if (patch.status !== 'settled' && findActiveSpotConflict(records, nextSpot, id)) {
      notify(`${formatSpotLabel(nextSpot)}は現在対応中です。番号を確認してください`)
      return
    }
    updateRecord(id, { ...patch, lineReportedAt: null })
    setEditRecord(null)
    notify(`${formatSpotLabel(nextSpot, '番号未入力')}の記録を更新しました`)
  }

  const closeAllSheets = () => {
    setEditRecord(null)
    setNoteRecord(null)
    setReportRecord(null)
    setIssueRecord(null)
    setLineText('')
    setLineReportTargetIds([])
  }

  // 削除は取り消せるようにして、現場での誤タップで当日の記録が消えないようにする。
  const removeRecords = (ids, message) => {
    const snapshot = records
    const removing = new Set(ids)
    setRecords((current) => current.filter((record) => !removing.has(record.id)))
    closeAllSheets()
    notify(message, () => {
      setRecords(snapshot)
      notify('削除を取り消しました')
    })
  }

  const requestDeleteRecord = (record) => setConfirmRequest({
    eyebrow: '記録の削除',
    title: `${getRecordSpotLabel(record)}の記録を削除しますか？`,
    description: '削除するとLINE報告の生成内容もクリアされます。直後であれば「元に戻す」で戻せます。',
    confirmLabel: '削除する',
    onConfirm: () => removeRecords([record.id], '記録を削除しました。LINE報告を再生成してください'),
  })

  const requestDeleteAllSettled = () => {
    if (settledRecords.length === 0) return
    setConfirmRequest({
      eyebrow: '当日の履歴',
      title: '履歴を全件削除しますか？',
      description: `精算済みの履歴${settledRecords.length}件を削除します。駐車中・精算待ちの記録は残ります。`,
      confirmLabel: '削除する',
      onConfirm: () => removeRecords(settledRecords.map((record) => record.id), `${settledRecords.length}件の履歴を削除しました`),
    })
  }

  const undoToast = () => {
    const undo = toast?.undo
    setToast(null)
    undo?.()
  }

  const generateLineText = () => {
    if (!workReport.schedule.endedAt) {
      setLineReportTargetIds([])
      setLineText(buildShiftNotEndedText(storeLabel))
      notify('90秒以内の一括報告はシフト終了後です')
      return
    }
    const reportRecords = selectBulkReportRecords(settledRecords, now)
    setLineReportTargetIds(reportRecords.map((record) => record.id))
    setLineText(buildBulkReportText(reportRecords, storeLabel))
    notify(reportRecords.length > 0 ? `${reportRecords.length}件のシフト終了後報告を生成しました` : '報告待ちの記録はありません')
  }

  const generateImmediateLineText = (record) => {
    if (!isOverLimit(record, now)) return notify('90秒以内の件はシフト終了後にまとめて報告します')
    if (record.lineReportedAt) return notify('この記録はすでに報告済みです')
    setLineReportTargetIds([record.id])
    setLineText(buildImmediateLineText(record, storeLabel))
    notify(`${getRecordSpotLabel(record)}の都度報告用テキストを生成しました`)
  }

  // コピーできなかったときに報告済みへ進めてしまうと、報告漏れに気付けなくなる。
  const copyLineText = async () => {
    if (!await copyToClipboard(lineText)) return notify('コピーできませんでした。テキストを長押しして手動でコピーしてください')
    if (lineReportTargetIds.length > 0) {
      const reportedAt = new Date().toISOString()
      const targets = new Set(lineReportTargetIds)
      setRecords((current) => current.map((record) => targets.has(record.id) ? { ...record, lineReportedAt: reportedAt } : record))
      setLineReportTargetIds([])
      notify('コピーしました。報告済みにしました')
      return
    }
    notify('クリップボードにコピーしました')
  }

  const generateWorkLineText = () => {
    setWorkLineText(buildWorkLineText(workReport, storeConfigs))
    notify('勤務報告を生成しました')
  }

  const saveStoreSettings = (nextSettings) => {
    setSettings(nextSettings)
    setSettingsOpen(false)
    setWorkLineText('')
    notify('店舗名を端末内に保存しました')
  }

  const copyWorkLineText = async () => {
    if (!await copyToClipboard(workLineText)) return notify('コピーできませんでした。テキストを長押しして手動でコピーしてください')
    notify('クリップボードにコピーしました')
  }

  const reloadFromStorage = () => {
    setRecords(loadRecords(dateKey))
    setWorkReport(loadWorkReport(dateKey))
    notify('保存データを読み込みました')
  }

  const overLimitCount = settledRecords.filter((record) => isOverLimit(record, now)).length
  const unreportedCount = settledRecords.filter((record) => !record.lineReportedAt).length

  const tabItems = [
    { id: 'record', label: '記録', count: parkingRecords.length },
    { id: 'work', label: '勤務報告' },
    { id: 'issued', label: '発行済み・精算待ち', mobileLabel: '精算待ち', count: issuedRecords.length },
    { id: 'history', label: '履歴', count: settledRecords.length },
  ]
  const primaryTabItems = tabItems.filter((tab) => tab.id !== 'work')
  // シート表示中に記録が更新されても、常に最新の内容を表示する。
  const liveRecord = (target) => records.find((record) => record.id === target?.id) || target

  return <div className="app-shell">
    <header className="app-header"><div className="brand-mark"><span className="brand-dot" /><span>精算機補助</span></div><div className="header-date">{formatDateLabel()}</div><button type="button" className="help-button" aria-label="店舗名設定を開く" onClick={() => setSettingsOpen(true)}>⚙</button></header>
    <nav className="tab-nav" aria-label="メインメニュー">{tabItems.map((tab) => <NavigationTab key={tab.id} tab={tab} activeView={activeView} onSelect={setActiveView} />)}</nav>
    <main className="main-content">
      <div className="day-banner"><span><Icon name="clock" size={18} />本日 {formatDateLabel()}</span><div className="day-banner-actions"><button type="button" onClick={reloadFromStorage}><Icon name="refresh" size={17} />更新</button><button type="button" className={`secondary-nav-button ${activeView === 'work' ? 'active' : ''}`} onClick={() => setActiveView('work')}><Icon name="note" size={15} />勤務報告</button></div></div>

      {activeView === 'record' && <section className="view-section" aria-labelledby="record-heading">
        <div className="section-heading"><div><h1 id="record-heading">駐車番号を選択</h1><p>番号が分かるときはタップ。分からないときは発行時に入力できます。</p></div><span className="section-count">対応中 {parkingRecords.length}件</span></div>
        {parkingRecords.length > 0 && <div className="active-panel"><div className="active-panel-heading"><span className="live-dot" />タイマー動作中（発行時に番号入力）</div>{parkingRecords.map((record) => <ActiveRecordCard key={record.id} record={record} now={now} onIssue={setIssueRecord} onNote={setNoteRecord} onEdit={setEditRecord} onDelete={requestDeleteRecord} />)}</div>}
        <div className="parking-area"><div className="area-heading"><h2>駐車位置番号</h2><span>左 1〜8　右 21〜9</span></div><div className="parking-legend"><span><i className="legend-dot legend-free" />未使用</span><span><i className="legend-dot legend-active" />対応中</span><span><i className="legend-dot legend-waiting" />精算待ち</span></div><button type="button" className="unknown-start-button" onClick={startUnknownRecord}><Icon name="plus" size={20} /><span><strong>番号未入力でタイマー開始</strong><small>駐車証明発行時に番号を入力</small></span></button><ParkingGrid records={records} onStart={startRecord} onOpenRecord={setEditRecord} /></div>
        {parkingRecords.length === 0 && <EmptyState title="タイマー動作中の車両はありません" detail="車が駐車したら、番号ボタンまたは番号未入力で開始を押してください。" />}
      </section>}

      {activeView === 'work' && <WorkReportView report={workReport} storeConfigs={storeConfigs} restartRule={restartRule} lineText={workLineText} onStorePatch={updateWorkStore} onSchedulePatch={updateWorkSchedule} onNotify={notify} onConfirm={setConfirmRequest} onGenerate={generateWorkLineText} onCopy={copyWorkLineText} />}

      {activeView === 'issued' && <section className="view-section" aria-labelledby="issued-heading"><div className="section-heading"><div><h1 id="issued-heading">発行済み・精算待ち</h1><p>証明書を発行した車両の精算を記録します。番号の編集・削除もここから行えます。</p></div><span className="section-count">{issuedRecords.length}件</span></div>{issuedRecords.length === 0 ? <EmptyState title="精算待ちの車両はありません" detail="証明書発行後の車両がここに表示されます。" /> : <div className="record-list">{issuedRecords.map((record) => <RecordRow key={record.id} record={record} now={now} action={settleRecord} actionLabel="精算" onNote={setNoteRecord} onEdit={setEditRecord} onDelete={requestDeleteRecord} />)}</div>}</section>}

      {activeView === 'history' && <section className="view-section" aria-labelledby="history-heading">
        <div className="section-heading"><div><h1 id="history-heading">本日の履歴</h1><p>精算済みの記録を確認・修正できます。90秒以内は終了後、90秒超は都度報告します。</p></div><div className="section-heading-actions"><span className="section-count">{settledRecords.length}件</span><button type="button" className="subtle-button danger history-clear-button" disabled={settledRecords.length === 0} onClick={requestDeleteAllSettled}><Icon name="trash" size={16} />履歴を全件削除</button></div></div>
        {settledRecords.length > 0 && <div className="history-summary"><span>精算済み <strong>{settledRecords.length}</strong>件</span><span className={overLimitCount > 0 ? 'is-warning' : ''}>90秒超 <strong>{overLimitCount}</strong>件</span><span className={unreportedCount > 0 ? 'is-warning' : ''}>未報告 <strong>{unreportedCount}</strong>件</span></div>}
        <div className="line-tools"><div><strong>シフト終了後のまとめ報告</strong><span>{workReport.schedule.endedAt ? '精算済み・90秒以内の未報告記録をまとめます。' : '90秒以内の記録は18:00勤務終了後にまとめて報告します。'}</span></div><button type="button" className="line-button" disabled={!workReport.schedule.endedAt} onClick={generateLineText}><span className="line-mark">LINE</span>{workReport.schedule.endedAt ? 'まとめて報告文を生成' : '18:00終了後に生成'}</button></div>
        {lineText && <div className="line-output"><div className="line-output-heading"><strong>生成されたテキスト</strong><button type="button" className="copy-button" onClick={copyLineText}><Icon name="copy" size={17} />コピー</button></div><textarea readOnly value={lineText} aria-label="LINE用テキスト" /></div>}
        {settledRecords.length === 0 ? <EmptyState title="完了した記録はありません" detail="精算ボタンを押した記録がここに表示されます。" /> : <div className="record-list history-list">{settledRecords.map((record) => { const needsImmediateReport = isOverLimit(record, now) && !record.lineReportedAt; return <RecordRow key={record.id} record={record} now={now} action={needsImmediateReport ? generateImmediateLineText : undefined} actionLabel="都度報告" onNote={setNoteRecord} onReport={setReportRecord} onEdit={setEditRecord} onDelete={requestDeleteRecord} /> })}</div>}
      </section>}
    </main>
    <footer className="app-footer">端末内に自動保存中 · {dateKey}</footer>
    <nav className="mobile-bottom-nav" aria-label="主要メニュー">{primaryTabItems.map((tab) => <NavigationTab key={tab.id} tab={tab} activeView={activeView} onSelect={setActiveView} mobile />)}</nav>
    {noteRecord && <NoteSheet record={liveRecord(noteRecord)} onSave={saveNotes} onClose={() => setNoteRecord(null)} />}
    {reportRecord && <ReportSheet record={liveRecord(reportRecord)} onSave={saveReportSettings} onClose={() => setReportRecord(null)} />}
    {issueRecord && <SpotConfirmSheet record={liveRecord(issueRecord)} occupiedSpots={new Set([...activeSpots].filter((spot) => spot !== getRecordSpot(issueRecord)))} onConfirm={confirmCertificateIssue} onClose={() => setIssueRecord(null)} />}
    {editRecord && <EditModal record={liveRecord(editRecord)} onSave={saveEdit} onDelete={requestDeleteRecord} onClose={() => setEditRecord(null)} />}
    {confirmRequest && <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />}
    {settingsOpen && <SettingsSheet settings={settings} onSave={saveStoreSettings} onClose={() => setSettingsOpen(false)} />}
    {toast && <Toast toast={toast} onAction={undoToast} />}
  </div>
}
