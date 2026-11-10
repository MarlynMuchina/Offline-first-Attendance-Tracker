// Small helpers for what the pages show: the greeting, readable dates,
// initials for the sidebar and the weekly attendance bars.

export function greetingFor(date = new Date()) {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

// '2026-05-04' -> '4 May 2026'. Empty values come back as 'Not set'.
export function formatDay(isoDate) {
  if (!isoDate) return 'Not set'
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

// Monday of the week a 'YYYY-MM-DD' date falls in, as 'YYYY-MM-DD'.
function weekStart(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d))
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day.toISOString().split('T')[0]
}

// Attendance rate for each week in the records, oldest first. Late counts
// as attended, the same as the dashboard average.
export function weeklyRates(records) {
  const weeks = {}
  for (const r of records) {
    if (!r.date) continue
    const key = weekStart(r.date)
    const w = weeks[key] || (weeks[key] = { weekStart: key, total: 0, attended: 0 })
    w.total += 1
    if (r.status !== 'ABSENT') w.attended += 1
  }
  return Object.values(weeks)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((w) => ({ ...w, rate: w.attended / w.total }))
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

// Attendance rate for each school day of the week, Monday to Friday, so a
// pattern such as low Fridays shows up. Days with no records have rate null.
export function weekdayRates(records) {
  const days = WEEKDAYS.map((name) => ({ day: name, total: 0, attended: 0 }))
  for (const r of records) {
    if (!r.date) continue
    const [y, m, d] = r.date.split('-').map(Number)
    const index = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
    if (index > 4) continue
    days[index].total += 1
    if (r.status !== 'ABSENT') days[index].attended += 1
  }
  return days.map((d) => ({ ...d, rate: d.total > 0 ? d.attended / d.total : null }))
}

// How many marks were Present, Late and Absent, with each one's share.
export function statusSplit(records) {
  const counts = { PRESENT: 0, LATE: 0, ABSENT: 0 }
  for (const r of records) if (r.status in counts) counts[r.status] += 1
  const total = counts.PRESENT + counts.LATE + counts.ABSENT
  return ['PRESENT', 'LATE', 'ABSENT'].map((status) => ({
    status,
    count: counts[status],
    share: total > 0 ? counts[status] / total : 0,
  }))
}
