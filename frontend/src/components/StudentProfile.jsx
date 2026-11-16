import { useEffect, useRef } from 'react'
import { studentProfile } from '../lib/studentProfile'
import { reasonLabel, notGivenLabel } from '../lib/reasons'
import { formatDay } from '../lib/display'
import { EXAM_ATTENDANCE_REQUIRED } from '../lib/examEligibility'
import { Ring } from './AppShell'
import { SplitBar } from './Charts'

const STATUS_WORD = { PRESENT: 'Present', LATE: 'Late', ABSENT: 'Absent' }
const pct = (r) => (r === null ? '—' : `${Math.round(r * 100)}%`)

function reasonText(record) {
  if (record.status === 'PRESENT') return ''
  const label = reasonLabel(record.status, record.reason_code)
  return label === 'Not given' ? notGivenLabel(record.status) : label
}

/**
 * One student's attendance over the dashboard's dates: rate, counts, a
 * Monday-to-Friday calendar, reasons, risk and guardian SMS settings.
 * Drawn from data the dashboard already has, so it opens offline too.
 */
export default function StudentProfile({ student, records, className, risk, threshold, range, onClose }) {
  const closeRef = useRef(null)
  const p = studentProfile(records, student.id)
  const name = `${student.first_name} ${student.last_name}`
  const status =
    p.rate === null ? null : p.rate < EXAM_ATTENDANCE_REQUIRED ? 'exam' : p.rate < threshold ? 'warn' : 'ok'
  const missed = p.days.filter((d) => d.status !== 'PRESENT').slice(-8).reverse()

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="profile-backdrop" onClick={onClose}>
      <div
        className="card profile"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-head">
          <div>
            <h2 id="profile-title" style={{ margin: 0 }}>{name}</h2>
            <p className="subtext" style={{ margin: '4px 0 0' }}>
              {className} · {formatDay(range.startDate)} to {formatDay(range.endDate)}
            </p>
          </div>
          <button ref={closeRef} onClick={onClose} className="btn-small">Close</button>
        </div>

        {p.total === 0 ? (
          <p className="subtext">No attendance marked for this student in these dates.</p>
        ) : (
          <>
            <div className="profile-top">
              <Ring value={p.rate} label={pct(p.rate)} caption="attendance" size={120} />
              <div className="profile-facts">
                <span className={`pill ${status === 'exam' ? 'pill-red' : status === 'warn' ? 'pill-amber' : 'pill-green'}`}>
                  {status === 'exam'
                    ? `Below the ${(EXAM_ATTENDANCE_REQUIRED * 100).toFixed(1)}% exam line`
                    : status === 'warn'
                      ? `Below ${Math.round(threshold * 100)}%`
                      : 'On track'}
                </span>
                <span>{p.total} marked days · longest run of absences: {p.longestAbsentRun} day{p.longestAbsentRun === 1 ? '' : 's'}</span>
                {risk && (
                  <span>
                    Predicted risk: <strong>{risk.risk_level}</strong>
                    {risk.risk_score !== null && risk.risk_score !== undefined ? ` (${Math.round(risk.risk_score * 100)}%)` : ''}
                  </span>
                )}
                <span>
                  Guardian: {student.guardian_phone || 'no number saved'}
                  {student.guardian_phone && ` · SMS ${student.sms_preference === 'EVERY_ABSENCE' ? 'on every absence' : 'at the warning lines'}`}
                </span>
              </div>
            </div>

            <SplitBar
              title={`${name}'s marks`}
              segments={['PRESENT', 'LATE', 'ABSENT'].map((s) => ({
                key: s,
                label: STATUS_WORD[s],
                count: p.counts[s],
                share: p.counts[s] / p.total,
                tone: s.toLowerCase(),
              }))}
            />

            <h3 className="reason-title" style={{ marginTop: 22 }}>Calendar</h3>
            <div className="cal" role="table" aria-label={`${name}'s attendance by day`}>
              <div className="cal-row cal-head" role="row">
                <span role="columnheader">Week of</span>
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => <span key={d} role="columnheader">{d}</span>)}
              </div>
              {p.weeks.map((w) => (
                <div key={w.weekStart} className="cal-row" role="row">
                  <span role="rowheader" className="subtext" style={{ margin: 0 }}>{formatDay(w.weekStart).replace(/ \d{4}$/, '')}</span>
                  {w.cells.map((c) => (
                    <span
                      key={c.date}
                      role="cell"
                      className={`cal-day${c.record ? ` cal-${c.record.status.toLowerCase()}` : ''}`}
                      title={c.record
                        ? `${formatDay(c.date)}: ${STATUS_WORD[c.record.status]}${reasonText(c.record) ? ` (${reasonText(c.record)})` : ''}`
                        : `${formatDay(c.date)}: not marked`}
                    >
                      {c.record ? c.record.status[0] : ''}
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <p className="subtext" style={{ margin: '8px 0 0' }}>P present · L late · A absent · blank not marked. Hover a day for its reason.</p>

            {missed.length > 0 && (
              <>
                <h3 className="reason-title" style={{ marginTop: 22 }}>Recent absences and late arrivals</h3>
                <ul className="profile-list">
                  {missed.map((d) => (
                    <li key={d.date}>
                      <span>{formatDay(d.date)}</span>
                      <span>{STATUS_WORD[d.status]}</span>
                      <span className="subtext" style={{ margin: 0 }}>{reasonText(d)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
