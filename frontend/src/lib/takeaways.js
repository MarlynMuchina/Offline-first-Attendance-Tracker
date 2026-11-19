// One plain sentence above each chart, saying what it shows, so nobody has
// to read the chart to get the point.

const pct = (r) => `${Math.round(r * 100)}%`

// Weekly trend: first week against last week, and the weakest week.
export function trendTakeaway(weekly, formatWeek = (w) => w) {
  if (weekly.length === 0) return ''
  if (weekly.length === 1) return `Only one week in this range, at ${pct(weekly[0].rate)}.`
  const first = weekly[0]
  const last = weekly[weekly.length - 1]
  const lowest = weekly.reduce((low, w) => (w.rate < low.rate ? w : low))
  const diff = Math.round(last.rate * 100) - Math.round(first.rate * 100)
  const direction = diff > 0 ? `Up from ${pct(first.rate)} to ${pct(last.rate)}` : diff < 0
    ? `Down from ${pct(first.rate)} to ${pct(last.rate)}`
    : `Steady at about ${pct(last.rate)}`
  return `${direction} between the first and last week. Weakest week: ${formatWeek(lowest.weekStart)} (${pct(lowest.rate)}).`
}

// Day of the week: the weakest and strongest school day.
export function weekdayTakeaway(weekdays) {
  const days = weekdays.filter((d) => d.rate !== null)
  if (days.length < 2) return ''
  const low = days.reduce((a, d) => (d.rate < a.rate ? d : a))
  const high = days.reduce((a, d) => (d.rate > a.rate ? d : a))
  if (Math.round(high.rate * 100) - Math.round(low.rate * 100) < 2) {
    return `Attendance is about the same every day of the week (around ${pct(high.rate)}).`
  }
  return `${low.day} is the weakest day (${pct(low.rate)}) and ${high.day} the strongest (${pct(high.rate)}).`
}

// Present, late and absent: shares of all marks.
export function splitTakeaway(split) {
  const share = Object.fromEntries(split.map((x) => [x.status, x.share]))
  const total = split.reduce((sum, x) => sum + x.count, 0)
  if (total === 0) return ''
  return `${pct(share.PRESENT)} of marks are present, ${pct(share.LATE)} late and ${pct(share.ABSENT)} absent.`
}

// Classes or schools ranked: the strongest, the weakest, and the warning line.
export function rankTakeaway(rows, warningLine, noun = 'class') {
  const ranked = rows.filter((r) => r.value !== null).sort((a, b) => b.value - a.value)
  if (ranked.length === 0) return ''
  const below = ranked.filter((r) => r.value < warningLine)
  const lineText = below.length === 0
    ? `Every ${noun} is above the ${pct(warningLine)} warning line.`
    : `${below.length} ${below.length === 1 ? `${noun} is` : `${noun === 'class' ? 'classes' : `${noun}s`} are`} below the ${pct(warningLine)} warning line.`
  if (ranked.length === 1) return `${ranked[0].label} is at ${pct(ranked[0].value)}. ${lineText}`
  const top = ranked[0]
  const bottom = ranked[ranked.length - 1]
  return `${top.label} is highest (${pct(top.value)}) and ${bottom.label} lowest (${pct(bottom.value)}). ${lineText}`
}
