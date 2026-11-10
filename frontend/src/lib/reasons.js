// Why a student was absent or late. A late reason is picked at roll call,
// when the student walks in. An absence reason is added later, from the
// "Absences to follow up" list, once the student or a parent explains.
// Both are optional.
// The codes are stored on the attendance record as reason_code, and the
// markAttendance Lambda accepts the same lists.

export const REASONS = {
  ABSENT: [
    { code: 'SICK', label: 'Sick' },
    { code: 'FEES', label: 'School fees' },
    { code: 'HOME_DUTIES', label: 'Home duties' },
    { code: 'TRANSPORT', label: 'Distance or transport' },
    { code: 'WEATHER', label: 'Weather' },
    { code: 'OTHER', label: 'Other' },
  ],
  LATE: [
    { code: 'TRANSPORT', label: 'Distance or transport' },
    { code: 'CHORES', label: 'Morning chores' },
    { code: 'WEATHER', label: 'Weather' },
    { code: 'OTHER', label: 'Other' },
  ],
}

export const NOT_GIVEN = 'NOT_GIVEN'

// Older records carry these codes from the imported data; they only say the
// student was absent or late, so they count as no reason given.
const NO_REASON_CODES = new Set([null, undefined, '', 'NONE', 'UNEXCUSED', 'LATE_ARRIVING'])

export function reasonsFor(status) {
  return REASONS[status] || []
}

/** A reason code that fits the status, or null. */
export function cleanReason(status, code) {
  return reasonsFor(status).some((r) => r.code === code) ? code : null
}

// Absences usually get their reason later, so a missing one is "not known
// yet" rather than refused.
export function notGivenLabel(status) {
  return status === 'ABSENT' ? 'Not known yet' : 'Not given'
}

export function reasonLabel(status, code) {
  if (NO_REASON_CODES.has(code)) return 'Not given'
  return reasonsFor(status).find((r) => r.code === code)?.label || 'Not given'
}

/**
 * Counts the reasons on a set of attendance records, split into absences
 * and lates. Each list holds every reason for that status (zeros included,
 * so the chart keeps the same rows), plus "Not given", sorted by count.
 * Returns { ABSENT: { total, given, rows }, LATE: { total, given, rows } }.
 */
export function summarizeReasons(records) {
  const result = {}
  for (const status of ['ABSENT', 'LATE']) {
    const counts = new Map(reasonsFor(status).map((r) => [r.code, 0]))
    counts.set(NOT_GIVEN, 0)
    let total = 0
    for (const r of records) {
      if (r.status !== status) continue
      total += 1
      const code = cleanReason(status, r.reason_code) || NOT_GIVEN
      counts.set(code, counts.get(code) + 1)
    }
    const rows = [...counts.entries()]
      .map(([code, count]) => ({
        code,
        label: code === NOT_GIVEN ? notGivenLabel(status) : reasonLabel(status, code),
        count,
        share: total > 0 ? count / total : 0,
      }))
      .sort((a, b) => b.count - a.count || (a.code === NOT_GIVEN) - (b.code === NOT_GIVEN))
    result[status] = { total, given: total - counts.get(NOT_GIVEN), rows }
  }
  return result
}

// How far back the teacher page lists absences that still need a reason.
export const FOLLOW_UP_DAYS = 14

/**
 * Absences that still have no reason, newest first, for the "Absences to
 * follow up" list. A teacher rarely knows why a student is away at roll
 * call; the reason is added when the student returns or a parent calls.
 * local: records on this device (attendanceQueue); remote: records from the
 * server (may be empty offline). Where both have the same student and day,
 * the device's copy wins, since it holds the latest change.
 * students: the class roster, so names show and students who left drop out.
 */
export function absencesToFollowUp({ local = [], remote = [], students = [], since }) {
  const byKey = new Map()
  for (const r of remote) byKey.set(`${r.student_id}|${r.date}`, { ...r, local: false })
  for (const r of local) byKey.set(`${r.student_id}|${r.date}`, { ...r, local: true })
  const names = new Map(students.map((s) => [s.id, `${s.first_name} ${s.last_name}`]))
  return [...byKey.values()]
    .filter((r) => r.date >= since && r.status === 'ABSENT' && !cleanReason('ABSENT', r.reason_code))
    .filter((r) => names.has(r.student_id))
    .map((r) => ({ ...r, name: names.get(r.student_id) }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
}
