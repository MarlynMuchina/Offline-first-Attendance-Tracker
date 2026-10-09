// Exam eligibility projection. A student sits the exam only if their
// attendance for the term (up to the exam) is at or above the threshold.
// This is plain arithmetic, not a trained model: given the days already
// recorded and the school days left before the exam, it works out how many
// more absences the student can afford.
//
// Assumptions: school runs Monday to Friday, public holidays are not
// excluded, and every remaining school day will be marked for the student.

// Parses 'YYYY-MM-DD' as a local date so weekday checks don't shift with
// the browser's timezone.
function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Weekdays strictly after `fromStr` and strictly before `toStr`
// (the exam day itself is not an attendance day that counts).
export function countSchoolDaysBetween(fromStr, toStr) {
  const day = parseDate(fromStr)
  const end = parseDate(toStr)
  let count = 0
  day.setDate(day.getDate() + 1)
  while (day < end) {
    const dow = day.getDay()
    if (dow !== 0 && dow !== 6) count++
    day.setDate(day.getDate() + 1)
  }
  return count
}

// Statuses:
//   SECURED    - already above the threshold even if absent every remaining day
//   ON_TRACK   - can still miss more than `atRiskMargin` days
//   AT_RISK    - can miss only 0..atRiskMargin more days
//   INELIGIBLE - cannot reach the threshold even with perfect attendance
//   NO_DATA    - no attendance recorded yet
export function projectEligibility({ attended, recorded, remainingDays, threshold, atRiskMargin = 2 }) {
  if (recorded === 0 && remainingDays === 0) {
    return { status: 'NO_DATA', maxMoreAbsences: null, projectedBestRate: null }
  }

  const totalDays = recorded + remainingDays
  const daysNeeded = Math.ceil(threshold * totalDays - 1e-9)
  const stillNeeded = daysNeeded - attended
  const maxMoreAbsences = remainingDays - stillNeeded
  const projectedBestRate = (attended + remainingDays) / totalDays

  let status
  if (maxMoreAbsences < 0) status = 'INELIGIBLE'
  else if (stillNeeded <= 0) status = 'SECURED'
  else if (maxMoreAbsences <= atRiskMargin) status = 'AT_RISK'
  else status = 'ON_TRACK'

  return {
    status,
    maxMoreAbsences: Math.min(Math.max(maxMoreAbsences, 0), remainingDays),
    daysNeeded,
    totalDays,
    projectedBestRate,
  }
}
