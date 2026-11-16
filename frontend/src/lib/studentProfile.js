// One student's attendance for the profile on the admin dashboard, and the
// CSV export of the class list. Plain functions so they can be tested.

// Monday of the week a 'YYYY-MM-DD' date falls in.
function mondayOf(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d))
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day
}

function iso(date) {
  return date.toISOString().split('T')[0]
}

/**
 * The student's marked days in the records, oldest first, with counts, the
 * longest run of absences in a row, and a calendar of school weeks
 * (Monday to Friday; null where nothing was marked).
 */
export function studentProfile(records, studentId) {
  const days = records
    .filter((r) => r.student_id === studentId && r.date)
    .sort((a, b) => a.date.localeCompare(b.date))
  const counts = { PRESENT: 0, LATE: 0, ABSENT: 0 }
  let run = 0
  let longestAbsentRun = 0
  for (const d of days) {
    if (d.status in counts) counts[d.status] += 1
    run = d.status === 'ABSENT' ? run + 1 : 0
    longestAbsentRun = Math.max(longestAbsentRun, run)
  }
  const total = days.length
  const rate = total > 0 ? (counts.PRESENT + counts.LATE) / total : null

  const byDate = new Map(days.map((d) => [d.date, d]))
  const weeks = []
  if (days.length) {
    const last = mondayOf(days[days.length - 1].date)
    for (let w = mondayOf(days[0].date); w <= last; w.setUTCDate(w.getUTCDate() + 7)) {
      const cells = []
      for (let i = 0; i < 5; i += 1) {
        const day = new Date(w)
        day.setUTCDate(w.getUTCDate() + i)
        const key = iso(day)
        cells.push({ date: key, record: byDate.get(key) || null })
      }
      weeks.push({ weekStart: iso(w), cells })
    }
  }
  return { days, counts, total, rate, longestAbsentRun, weeks }
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  // Quote anything with a comma, quote or line break; and stop a cell that
  // starts with = + - @ being read as a formula by Excel.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** rows: array of arrays. Returns CSV text with a header row first. */
export function toCsv(header, rows) {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
