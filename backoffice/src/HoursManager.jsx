import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Pencil, Plus, Printer } from 'lucide-react'
import {
  fetchHours, saveEntry, deleteEntry, TZ,
  groupByDay, formatDay, formatTime, formatHm, decimalHours, formatRanges,
  dayBounds, dayBreakSeconds,
  dateKey, monthRange, monthTitle, shiftMonth, hoursToCsv, hoursFileName,
  idleStaff, EN_DOW, HEBREW_DOW,
  filterHoursStaff, HOURS_SEARCH_FROM, HOURS_PAGE,
} from './timesheet'
import { fetchStaff } from './team'
import { Panel, SearchField } from './ui/Layout'
import { Button, IconButton } from './ui/Button'
import Drawer from './ui/Drawer'
import FormDialog from './ui/FormDialog'
import ConfirmDialog from './ui/ConfirmDialog'
import useNarrow from './ui/useNarrow'

/**
 * Часы сотрудников за месяц — то, по чему считают зарплату.
 *
 * Отметки делает касса (личный PIN на терминале), кабинет их читает и
 * правит: сотрудник забыл отметиться — владелец добавляет смену задним
 * числом, не подходя к терминалу. Записи не удаляются физически, правка
 * помечается автором (аудит-инвариант кассы 022/027/143).
 *
 * Месяц — период по умолчанию, потому что зарплату считают месяцем.
 * Стрелки листают месяцы, дни внутри карточки идут в порядке календаря,
 * а не «свежие сверху»: табель читают сверху вниз, как в ведомости.
 */

/** Локальные дата+время → Date; «уход» раньше «прихода» = ночная смена */
function combine(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm)
}

function toTimeInput(iso) {
  return formatTime(iso, TZ)
}

/** Диалог правки: добавить смену задним числом или исправить время */
function EntryEditor({ staff, entry, locations, defaultLocationId, onCancel, onSaved, onRemove }) {
  const isNew = !entry
  const [date, setDate] = useState(() => (entry ? entry.day : dateKey(new Date())))
  const [inTime, setInTime] = useState(() => (entry ? toTimeInput(entry.clock_in) : ''))
  const [outTime, setOutTime] = useState(() => (entry?.clock_out ? toTimeInput(entry.clock_out) : ''))
  const [note, setNote] = useState(entry?.note || '')
  // Смена принадлежит точке: у сети «где отработал» — часть табеля, и
  // угадывать её за владельца нельзя
  const [location, setLocation] = useState(() => entry?.location_id || defaultLocationId || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const clockIn = combine(date, inTime)
      let clockOut = null
      if (outTime) {
        clockOut = combine(date, outTime)
        // Смена «через полночь» — следующий день, иначе уход раньше прихода
        if (clockOut <= clockIn) clockOut.setDate(clockOut.getDate() + 1)
      }
      await saveEntry({
        entryId: entry?.id ?? null,
        staffId: staff.staff_id,
        clockIn,
        clockOut,
        note: note.trim() || null,
        locationId: location || null,
      })
      onSaved()
    } catch (saveError) {
      setError(saveError.message)
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title={isNew ? 'Add shift' : 'Edit shift'}
      description={staff.name}
      submitLabel="Save"
      error={error}
      busy={busy}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <label className="qr-field">
        <span>Date</span>
        <input type="date" value={date} max={dateKey(new Date())} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <div className="field-row">
        <label className="qr-field">
          <span>In</span>
          <input type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} required />
        </label>
        <label className="qr-field">
          <span>Out</span>
          <input type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} />
        </label>
      </div>
      <p className="hrs-hint">Leave “Out” empty if the shift is still open.</p>
      {isNew && locations.length > 1 && (
        <label className="qr-field">
          <span>Location</span>
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      )}
      <label className="qr-field">
        <span>Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it was corrected" />
      </label>
      {/* Удаление живёт в теле диалога: у общей формы в строке действий
          только «Отмена» и «Сохранить», и трогать их ради табеля нельзя */}
      {!isNew && (
        <button type="button" className="text-button hrs-remove" onClick={onRemove}>
          Remove this shift
        </button>
      )}
    </FormDialog>
  )
}

/** Карточка сотрудника: дни месяца, печать, выгрузка, правка */
function StaffCard({ person, from, to, locations, locationId, onClose, onChanged }) {
  const days = useMemo(() => groupByDay(person.entries), [person.entries])
  const breakSeconds = useMemo(
    () => days.reduce((sum, day) => sum + dayBreakSeconds(day), 0),
    [days],
  )
  const locationName = person.entries[0]?.location_name || null
  const [editing, setEditing] = useState(null) // { entry } | {} = новая смена
  const [removing, setRemoving] = useState(null)
  const [removeError, setRemoveError] = useState('')
  const [busy, setBusy] = useState(false)

  function exportOne() {
    download(hoursToCsv([person], TZ), hoursFileName(from, to, person.name))
  }

  async function confirmRemove() {
    setBusy(true)
    setRemoveError('')
    try {
      await deleteEntry(removing.id)
      setRemoving(null)
      setBusy(false)
      onChanged()
    } catch (error) {
      setRemoveError(error.message)
      setBusy(false)
    }
  }

  return (
    <>
      <Drawer
        labelledBy="hours-card-title"
        title={person.name}
        subtitle={[
          `${formatDay(dateKey(from))} — ${formatDay(dateKey(to))}`,
          locationName,
          // Часы и десятичные рядом: первое читает сотрудник, второе идёт
          // в зарплату, и пересчитывать «8:30 → 8.5» руками никто не должен
          `${formatHm(person.seconds)} worked · ${decimalHours(person.seconds)} decimal hours`,
        ].filter(Boolean).join(' · ')}
        onClose={onClose}
        /* Панель стоит рядом с таблицей: щелчок по соседнему сотруднику
           обязан открыть его, а не закрыть карточку. */
        modal={false}
        actions={(
          <>
            <Button size="compact" onClick={() => window.print()}>
              <Printer aria-hidden /> Print
            </Button>
            <Button size="compact" onClick={exportOne}>
              <Download aria-hidden /> Excel
            </Button>
          </>
        )}
      >
        {days.length === 0 ? (
          <p className="empty-state">No punches in this period.</p>
        ) : (
          <div className="hrs-days">
            {/* Колонки те же, что в отчёте, к которому привык владелец:
                приход, уход, перерыв, итог */}
            <div className="hrs-day hrs-day-head">
              <span>Date</span>
              <span />
              <span>In</span>
              <span>Out</span>
              <span>Break</span>
              <span>Total</span>
              <span />
            </div>
            {days.map((day) => {
              const bounds = dayBounds(day)
              const gap = dayBreakSeconds(day)
              return (
                <div
                  className="hrs-day"
                  key={day.day}
                  // Разбитый день: интервалы целиком — подсказкой, чтобы строка
                  // осталась одной, а правда о дне не потерялась
                  title={day.entries.length > 1 ? formatRanges(day, TZ) : undefined}
                >
                  <span className="hrs-day-date">{formatDay(day.day)}</span>
                  <span className="hrs-day-dow">{EN_DOW[day.dow]}</span>
                  <span className="hrs-day-time">{formatTime(bounds.in, TZ)}</span>
                  <span className="hrs-day-time">{bounds.out ? formatTime(bounds.out, TZ) : '…'}</span>
                  <span className={gap > 0 ? 'hrs-day-time' : 'hrs-day-time is-none'}>{formatHm(gap)}</span>
                  <span className={day.hasOpen ? 'hrs-day-hours is-open' : 'hrs-day-hours'}>
                    {formatHm(day.seconds)}
                    <small>{decimalHours(day.seconds)} decimal</small>
                  </span>
                  <span className="hrs-day-actions">
                    {day.entries.map((entry) => (
                      <IconButton
                        key={entry.id}
                        label={`Edit shift on ${formatDay(day.day)}`}
                        title={entry.edited_at
                          ? `Corrected${entry.edited_by_name ? ` by ${entry.edited_by_name}` : ''}`
                          : 'Edit'}
                        onClick={() => setEditing({ entry })}
                      >
                        <Pencil />
                      </IconButton>
                    ))}
                  </span>
                </div>
              )
            })}
            <div className="hrs-day hrs-day-total">
              <span>Total</span>
              <span />
              <span />
              <span />
              <span>{breakSeconds > 0 ? formatHm(breakSeconds) : ''}</span>
              <span className="hrs-day-hours">
                {formatHm(person.seconds)}
                <small>{decimalHours(person.seconds)} decimal</small>
              </span>
              <span />
            </div>
          </div>
        )}

        <div className="hrs-card-actions">
          <Button size="compact" onClick={() => setEditing({})}>
            <Plus aria-hidden /> Add shift
          </Button>
        </div>

        <p className="hrs-hint">
          Punches come from the register. Times are shown in the venue clock ({TZ}).
        </p>
      </Drawer>

      {editing && (
        <EntryEditor
          staff={person}
          entry={editing.entry}
          locations={locations}
          /* Точка по умолчанию: выбранная фильтром, иначе та, где человек
             уже отмечался — а не первая в списке организации */
          defaultLocationId={locationId || person.entries[0]?.location_id || locations[0]?.id || ''}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged() }}
          onRemove={() => { setRemoving(editing.entry); setEditing(null) }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Remove this shift?"
          description="The record stays in the audit trail, it just stops counting towards hours."
          confirmLabel="Remove"
          tone="danger"
          error={removeError}
          busy={busy}
          onConfirm={confirmRemove}
          onCancel={() => { setRemoving(null); setRemoveError('') }}
        />
      )}

      {/* Источник печати: на экране скрыт, в печать уходит только он */}
      <div className="hrs-print">
        <h1>{person.name}</h1>
        {locationName && <p>{locationName}</p>}
        <p>{formatDay(dateKey(from))} — {formatDay(dateKey(to))}</p>
        <table>
          <tbody>
            {days.map((day) => {
              const bounds = dayBounds(day)
              return (
                <tr key={day.day}>
                  <td>{formatDay(day.day)}</td>
                  <td>{HEBREW_DOW[day.dow]}</td>
                  <td>{formatTime(bounds.in, TZ)}</td>
                  <td>{bounds.out ? formatTime(bounds.out, TZ) : '…'}</td>
                  <td>{formatHm(dayBreakSeconds(day))}</td>
                  <td>{formatHm(day.seconds)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="hrs-print-total">
          Days {person.days} · Shifts {person.shifts}
          {breakSeconds > 0 ? ` · Breaks ${formatHm(breakSeconds)}` : ''}
          {' · Total '}{formatHm(person.seconds)} ({decimalHours(person.seconds)})
        </p>
      </div>
    </>
  )
}

function download(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export default function HoursManager({ context, initialStaffId = null }) {
  const locations = context.locations || []
  const now = new Date()
  const narrow = useNarrow()
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [locationId, setLocationId] = useState('')
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(HOURS_PAGE)
  const [report, setReport] = useState(null)
  const [roster, setRoster] = useState([])
  const [error, setError] = useState('')
  /*
   * Кого открыть сразу — приходит из карточки человека («Open hours»).
   * Дальше выбором распоряжается сам экран: закрыв карточку, владелец не
   * должен получать её обратно при первой же смене месяца.
   */
  const [selected, setSelected] = useState(initialStaffId)

  const { from, to } = useMemo(() => monthRange(cursor.year, cursor.month), [cursor])

  const load = useCallback(async () => {
    setError('')
    try {
      setReport(await fetchHours({
        from,
        to,
        locationIds: locationId ? [locationId] : null,
      }))
    } catch (loadError) {
      setReport({ staff: [], totals: { seconds: 0, shifts: 0, days: 0, staff: 0 } })
      setError(loadError.message)
    }
  }, [from, to, locationId])

  useEffect(() => { load() }, [load])

  /*
   * Штат нужен отдельно от часов: отчёт отвечает «кто сколько отработал»,
   * и человека в отпуске, в выходной или забывшего отметиться в нём нет.
   * А открыть надо именно его — посмотреть другой месяц или дописать
   * пропущенную смену.
   */
  useEffect(() => {
    let alive = true
    fetchStaff()
      .then((list) => { if (alive) setRoster(list) })
      // Часы важнее списка: без штата раздел работает, просто без нулевых строк
      .catch(() => { if (alive) setRoster([]) })
    return () => { alive = false }
  }, [])

  /*
   * Отработавшие сверху, остальной штат — следом с прочерком. Уволенных не
   * добавляем, но со сменами периода они остаются: часы отработаны, из
   * табеля их не вычёркивают.
   */
  const staff = useMemo(() => {
    const worked = report?.staff || []
    const rest = idleStaff(worked, roster, locationId || null).map((s) => ({
      staff_id: s.id, name: s.name, role: s.role, is_active: true,
      seconds: 0, days: 0, shifts: 0, has_open: false, entries: [],
    }))
    return [...worked, ...rest]
  }, [report?.staff, roster, locationId])

  /*
   * Отбор идёт по СОБРАННОМУ списку: отчёт за месяц и штат приезжают
   * целиком, отработавшие и нулевые уже сведены вместе. Поэтому «нашёлся
   * один» здесь значит «один во всей организации».
   */
  const rows = useMemo(() => filterHoursStaff(staff, search), [staff, search])
  useEffect(() => { setShown(HOURS_PAGE) }, [search, locationId, cursor, narrow])
  const visible = narrow ? rows.slice(0, shown) : rows
  const searchable = staff.length >= HOURS_SEARCH_FROM

  const person = staff.find((s) => s.staff_id === selected) || null
  const totalSeconds = report?.totals?.seconds ?? 0

  return (
    <>
      <div className="hrs-toolbar">
        <div className="hrs-month">
          <IconButton label="Previous month" onClick={() => setCursor(shiftMonth(cursor, -1))}>
            <ChevronLeft />
          </IconButton>
          <strong>{monthTitle(cursor.year, cursor.month)}</strong>
          <IconButton label="Next month" onClick={() => setCursor(shiftMonth(cursor, 1))}>
            <ChevronRight />
          </IconButton>
        </div>

        {searchable && (
          <SearchField
            label="Search the timesheet"
            value={search}
            onChange={setSearch}
            placeholder="Search employee"
            className="order-search hrs-search"
          />
        )}

        {locations.length > 1 && (
          <label className="hrs-select">
            <span className="visually-hidden">Location</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">All locations</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        )}

        <Button
          size="compact"
          disabled={(report?.staff || []).length === 0}
          /* В файл идут только отработавшие: строка «0:00» в зарплатной
             выгрузке читается как «не заплатили», а не «не работал» */
          onClick={() => download(hoursToCsv(report?.staff || [], TZ), hoursFileName(from, to))}
        >
          <Download aria-hidden /> Excel
        </Button>

        <p className="hrs-total">
          <strong>{formatHm(totalSeconds)} worked in total</strong>
          <span>{decimalHours(totalSeconds)} decimal for payroll</span>
        </p>
      </div>

      <p className="hrs-format-note">
        Time is shown as hours:minutes. Decimal hours are included for payroll and Excel
        (for example, 8:30 equals 8,50).
      </p>

      {error && <p className="form-error" role="alert">{error}</p>}

      <Panel className="hrs-panel">
        {report === null ? (
          <p className="empty-state">Loading…</p>
        ) : staff.length === 0 ? (
          <p className="empty-state">Nobody has been added to the team yet.</p>
        ) : rows.length === 0 ? (
          <p className="empty-state">Nobody matches this search.</p>
        ) : (
          <>
            {/* Прокрутка живёт внутри табеля, а не под всей страницей:
                иначе итог месяца и стрелки уезжают за верхний край */}
            <div
              className="hrs-scroll"
              role={narrow ? undefined : 'region'}
              aria-label={narrow ? undefined : 'Timesheet'}
              tabIndex={!narrow && rows.length > 10 ? 0 : undefined}
            >
              <div className="hrs-list">
                <div className="hrs-head">
                  <span>Employee</span>
                  <span>Days</span>
                  <span>Shifts</span>
                  <span>Hours</span>
                </div>
                {visible.map((row) => (
                  <button
                    type="button"
                    key={row.staff_id}
                    className={[
                      'hrs-row',
                      row.staff_id === selected ? 'is-selected' : '',
                      // Не работал в этом месяце — строка тише, но открывается
                      row.shifts ? '' : 'is-idle',
                    ].filter(Boolean).join(' ')}
                    aria-expanded={row.staff_id === selected}
                    onClick={() => setSelected(row.staff_id === selected ? null : row.staff_id)}
                  >
                    <span className="hrs-cell-name">
                      {row.name}
                      {row.has_open && <small> · on shift</small>}
                    </span>
                    <span className="hrs-cell-num">{row.shifts ? row.days : '—'}</span>
                    <span className="hrs-cell-num">{row.shifts || '—'}</span>
                    <span className={row.shifts ? 'hrs-cell-num is-strong' : 'hrs-cell-num'}>
                      {row.shifts ? formatHm(row.seconds) : '—'}
                      {row.shifts > 0 && <small>{decimalHours(row.seconds)} decimal</small>}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {visible.length < rows.length && (
              <div className="hrs-more">
                <Button size="compact" onClick={() => setShown((n) => n + HOURS_PAGE)}>
                  Load more
                </Button>
                <span className="hrs-more-count">{visible.length} of {rows.length}</span>
              </div>
            )}
          </>
        )}
      </Panel>

      {person && (
        <StaffCard
          person={person}
          from={from}
          to={to}
          locations={locations}
          locationId={locationId}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </>
  )
}
