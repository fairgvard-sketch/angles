import { useState } from 'react'
import { Download } from 'lucide-react'
import { runUfExport } from './settings'
import { ErrorText } from './ui/Layout'

/**
 * Выгрузка Единого формата 1.31 (מבנה אחיד) для налоговой Израиля.
 *
 * Переехала из настроек точки в отчёты без единой правки в генерации:
 * набор по-прежнему собирает Edge Function `uniform-format-export` из
 * фискальных документов, а кабинет только называет период, показывает
 * контрольный отчёт и отдаёт два файла. Ни одного числа здесь не
 * считается.
 *
 * Почему это отчёт, а не настройка: у действия есть период и результат,
 * его повторяют каждый месяц и уносят бухгалтеру. В настройках точки его
 * искали последним.
 *
 * Точка обязательна и выбирается ЗДЕСЬ, даже если она одна: набор
 * подаётся за конкретный бизнес с конкретным ח.פ, и «какая точка
 * выгружена» не должно оставаться на догадку.
 */

/** Названия типов документов Единого формата — всегда на иврите, как в документах. */
const DOC_TYPE_NAMES = {
  305: 'חשבונית מס',
  320: 'חשבונית מס/קבלה',
  330: 'חשבונית מס זיכוי',
  400: 'קבלה',
}

/** Прошлый календарный месяц — типовой отчётный период по умолчанию. */
export function previousMonthRange(now = new Date()) {
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const last = new Date(now.getFullYear(), now.getMonth(), 0)
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { from: iso(first), to: iso(last) }
}

function shekels(agorot) {
  return `₪${(agorot / 100).toLocaleString('he-IL', { minimumFractionDigits: 2 })}`
}

function downloadBase64(filename, base64, mime) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function FiscalExport({ locations = [], locationId, onLocationChange, onOpenReceiptSettings }) {
  const defaults = previousMonthRange()
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Отдельно от текста ошибки: «нет ח.פ» — не сбой выгрузки, а незаполненная
  // настройка, и чинится она в другом разделе.
  const [missingTaxId, setMissingTaxId] = useState(false)
  const [result, setResult] = useState(null)

  const activeId = locationId || locations[0]?.id || null
  const active = locations.find((l) => l.id === activeId)

  async function generate() {
    setBusy(true)
    setError('')
    setMissingTaxId(false)
    setResult(null)
    try {
      setResult(await runUfExport(activeId, from, to))
    } catch (e) {
      if (e.message === 'missing_tax_id') {
        setMissingTaxId(true)
        setError(`Tax ID is missing for ${active?.name ?? 'this location'} — fill it in first.`)
      } else if (e.message === 'issuer_changed_in_period') {
        /*
         * Реквизиты бизнеса менялись внутри периода. Заголовок набора
         * несёт один ח.פ, поэтому такой период невозможно отдать одним
         * файлом — и «усреднить» его нельзя. Владельцу нужно не
         * «попробовать ещё раз», а сузить даты до отрезка с одними
         * реквизитами, поэтому текст говорит именно это.
         */
        setError(
          'The business details changed during this period, so it cannot be '
          + 'exported as one set — each set carries a single Tax ID. Split the '
          + 'period at the date the details changed and export each part.',
        )
      } else {
        setError('Export failed. Try again or narrow the period.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!activeId) {
    return <p className="empty-state">No locations are linked to this account.</p>
  }

  return (
    <section className="panel form-panel">
      <div className="settings-form">
        <p className="hint">
          Uniform Format 1.31 (מבנה אחיד) for the Israeli Tax Authority: INI.TXT and
          BKMVDATA.zip for the selected period, generated server-side from fiscal
          documents. ANGLE prepares the files — filing them stays with you or your
          accountant.
        </p>

        {/*
          Точка называется первой и всегда, даже когда она одна: набор
          подаётся за конкретный бизнес с конкретным ח.פ, и «чей это
          набор» не должно оставаться на догадку.

          У одной точки это утверждение, а не поле: выпадающий список из
          одного пункта и поле только для чтения одинаково выглядят как
          обещание выбора, которого нет.
        */}
        {locations.length > 1 ? (
          <label className="qr-field">
            <span>Location</span>
            <select
              value={activeId}
              onChange={(e) => onLocationChange?.(e.target.value)}
            >
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <small>
              One set covers one location. Each location is filed under its own Tax ID.
            </small>
          </label>
        ) : (
          <p className="settings-scope">
            Covers <strong>{active?.name}</strong> — the only location on this account.
          </p>
        )}

        <label className="qr-field">
          <span>From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="qr-field">
          <span>To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>

        <div className="form-actions">
          {error && <ErrorText>{error}</ErrorText>}
          {/* Незаполненный ח.פ чинится в реквизитах ТОЙ ЖЕ точки — уводим
              туда прямой ссылкой, а не советом «поищите в настройках». */}
          {missingTaxId && onOpenReceiptSettings && (
            <button
              type="button"
              className="text-button"
              onClick={() => onOpenReceiptSettings(activeId)}
            >
              Open Receipts &amp; tax for {active?.name}
            </button>
          )}
          <button
            type="button"
            className="primary-button narrow"
            disabled={busy || !from || !to || from > to}
            onClick={generate}
          >
            {busy ? 'Generating…' : 'Generate export'}
          </button>
        </div>

        {result && (
          <>
            <div className="form-actions export-downloads">
              <button
                type="button"
                className="secondary-button"
                onClick={() => downloadBase64('INI.TXT', result.ini_base64, 'text/plain')}
              >
                <Download aria-hidden /> INI.TXT
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => downloadBase64('BKMVDATA.zip', result.bkmvdata_zip_base64, 'application/zip')}
              >
                <Download aria-hidden /> BKMVDATA.zip
              </button>
              <span className="hint">
                Records: {result.total_records} · {result.range?.from} — {result.range?.to}
              </span>
            </div>

            <table className="export-report">
              <thead>
                <tr><th>Document type</th><th>Count</th><th>Total inc. VAT</th></tr>
              </thead>
              <tbody>
                {result.control_report.map((row) => (
                  <tr key={row.docTypeCode}>
                    <td>{row.docTypeCode} · {DOC_TYPE_NAMES[row.docTypeCode] ?? ''}</td>
                    <td>{row.count}</td>
                    <td>{shekels(row.totalIncVat)}</td>
                  </tr>
                ))}
                {result.control_report.length === 0 && (
                  <tr><td colSpan={3}>No fiscal documents in this period.</td></tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  )
}
