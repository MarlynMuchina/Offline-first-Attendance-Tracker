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
