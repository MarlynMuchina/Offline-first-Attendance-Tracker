// Chronic-absenteeism threshold. Currently stored in localStorage —
// a genuine, deliberate simplification: there's no backend "SchoolConfig"
// model yet to persist this server-side. Worth flagging as a Sprint 4+
// item if a real per-school config table gets added later. For now this
// is a per-device setting, not synced across users — acceptable for a
// single-admin demo, not for multi-admin production use.
const THRESHOLD_KEY = 'csg_chronic_threshold'
const DEFAULT_THRESHOLD = 0.7

export function getChronicThreshold() {
  const stored = localStorage.getItem(THRESHOLD_KEY)
  const value = stored !== null ? parseFloat(stored) : DEFAULT_THRESHOLD
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : DEFAULT_THRESHOLD
}

export function setChronicThreshold(value) {
  localStorage.setItem(THRESHOLD_KEY, String(value))
}

// Exam eligibility dates (YYYY-MM-DD strings). Same localStorage caveat as
// the threshold above: per-device, not synced across admins.
const TERM_START_KEY = 'csg_term_start'
const EXAM_DATE_KEY = 'csg_exam_date'

export function getTermStart() {
  return localStorage.getItem(TERM_START_KEY) || ''
}

export function setTermStart(value) {
  localStorage.setItem(TERM_START_KEY, value)
}

export function getExamDate() {
  return localStorage.getItem(EXAM_DATE_KEY) || ''
}

export function setExamDate(value) {
  localStorage.setItem(EXAM_DATE_KEY, value)
}
