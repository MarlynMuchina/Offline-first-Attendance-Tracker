import { getCurrentUserContext, getClassesForSchool } from '../lib/auth'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateClient } from 'aws-amplify/api'
import { signOut } from 'aws-amplify/auth'
import jsPDF from 'jspdf'
import { NETWORK_SCHOOL_ID } from '../lib/schools'
import { db } from '../lib/db'
import { fetchClassAttendance } from '../lib/classAttendance'
import { getChronicThreshold, getTermStart, getExamDate, defaultDateRange } from '../lib/settings'
import { countSchoolDaysBetween, projectEligibility, EXAM_ATTENDANCE_REQUIRED } from '../lib/examEligibility'
import { schoolName } from '../lib/schools'
import { greetingFor, formatDay, weeklyRates } from '../lib/display'
import AppShell, { ADMIN_NAV, Ring, LoadingScreen } from '../components/AppShell'

const client = generateClient()



const listStudentsQuery = /* GraphQL */ `
  query ListStudentsByClass($classId: ID, $nextToken: String) {
    listStudents(filter: { class_id: { eq: $classId } }, limit: 100, nextToken: $nextToken) {
      items {
        id
        first_name
        last_name
      }
      nextToken
    }
  }
`

const generateSummaryQuery = /* GraphQL */ `
  query GenerateAttendanceSummary($input: GenerateAttendanceSummaryInput!) {
    generateAttendanceSummary(input: $input) {
      summary
      generated_at
    }
  }
`

const predictRiskQuery = /* GraphQL */ `
  query PredictAttendanceRisk($input: PredictAttendanceRiskInput!) {
    predictAttendanceRisk(input: $input) {
      student_id
      risk_score
      risk_level
      reason
    }
  }
`

const predictClassRiskQuery = /* GraphQL */ `
  query PredictAttendanceRiskForClass($input: PredictClassRiskInput!) {
    predictAttendanceRiskForClass(input: $input) {
      student_id
      risk_score
      risk_level
      reason
    }
  }
`


const getAdminSessionQuery = /* GraphQL */ `
  query GetAdminSession($id: ID!) {
    getAdminSessionTracker(id: $id) {
      id
      admin_phone
      signed_in_at
    }
  }
`

const createAdminSessionMutation = /* GraphQL */ `
  mutation CreateAdminSession($input: CreateAdminSessionTrackerInput!) {
    createAdminSessionTracker(input: $input) {
      id
    }
  }
`

const updateAdminSessionMutation = /* GraphQL */ `
  mutation UpdateAdminSession($input: UpdateAdminSessionTrackerInput!) {
    updateAdminSessionTracker(input: $input) {
      id
    }
  }
`

// Walks through every page of a paginated Amplify list query, using
// nextToken, until the full result set has been collected. Without this,
// any query result over its per-page limit (1000 for attendance, 100 for
// students) silently truncates -- no error, just incomplete data. This
// matters at scale: a single class over one term can already exceed 1000
// attendance records, and this project needs to handle many classes across
// many schools.
async function fetchAllPages(query, baseVariables, resultKey) {
  let items = []
  let nextToken = null
  do {
    const res = await client.graphql({
      query,
      variables: { ...baseVariables, nextToken },
    })
    const page = res.data[resultKey]
    items = items.concat(page.items)
    nextToken = page.nextToken
  } while (nextToken)
  return items
}



function computeStats(students, records, threshold) {
  const byStudent = {}
  for (const s of students) {
    byStudent[s.id] = { student: s, total: 0, attended: 0, absent: 0 }
  }
  for (const r of records) {
    const bucket = byStudent[r.student_id]
    if (!bucket) continue
    bucket.total += 1
    if (r.status === 'ABSENT') {
      bucket.absent += 1
    } else {
      bucket.attended += 1
    }
  }

  const perStudent = Object.values(byStudent).map((b) => ({
    ...b,
    rate: b.total > 0 ? b.attended / b.total : null,
  }))

  const withData = perStudent.filter((p) => p.rate !== null)
  const overallRate =
    withData.length > 0
      ? withData.reduce((sum, p) => sum + p.rate, 0) / withData.length
      : null

  const chronic = perStudent
    .filter((p) => p.rate !== null && p.rate < threshold)
    .sort((a, b) => a.rate - b.rate)

  return { perStudent, overallRate, chronic, weekly: weeklyRates(records) }
}

// Backup summary written on the device from the dashboard figures, used when
// Claude via Bedrock can't be reached (no internet, or the AI call fails).
// Same four headings as the Bedrock prompt so the two read alike.
function buildDeviceSummary(stats, threshold, startDate, endDate) {
  const pct = (r) => `${Math.round(r * 100)}%`
  const name = (p) => `${p.student.first_name} ${p.student.last_name}`
  const withData = stats.perStudent.filter((p) => p.rate !== null)
  const belowExam = withData.filter((p) => p.rate < EXAM_ATTENDANCE_REQUIRED)
  const lowest = [...withData].sort((a, b) => a.rate - b.rate).slice(0, 3)
  const perfect = withData.filter((p) => p.absent === 0).length
  const totalAbsences = withData.reduce((sum, p) => sum + p.absent, 0)

  if (withData.length === 0) {
    return `## Summary\nNo attendance has been marked for this class between ${startDate} and ${endDate}.`
  }

  const lines = [
    '## Summary',
    `Between ${startDate} and ${endDate}, the ${withData.length} students with records averaged ${pct(stats.overallRate)} attendance, with ${totalAbsences} absences in total.`,
    '',
    '## Key trends',
    `- ${perfect} student${perfect === 1 ? ' was' : 's were'} never absent.`,
    `- ${stats.chronic.length} student${stats.chronic.length === 1 ? ' is' : 's are'} below ${pct(threshold)}.`,
    `- Lowest attendance: ${lowest.map((p) => `${name(p)} (${pct(p.rate)})`).join(', ')}.`,
    '',
    '## Risks',
    belowExam.length > 0
      ? `- ${belowExam.length} student${belowExam.length === 1 ? ' is' : 's are'} below the ${pct(EXAM_ATTENDANCE_REQUIRED)} exam line: ${belowExam.map(name).join(', ')}.`
      : `- No student is below the ${pct(EXAM_ATTENDANCE_REQUIRED)} exam line.`,
    '',
    '## Recommended actions',
    stats.chronic.length > 0
      ? `- Contact the guardians of the ${stats.chronic.length} student${stats.chronic.length === 1 ? '' : 's'} below ${pct(threshold)}, starting with those below the exam line.`
      : '- Keep monitoring; no follow-up is needed right now.',
    '- Check the exam eligibility section for how many more days each student can miss.',
  ]
  return lines.join('\n')
}

// Offline, cloud calls can hang instead of failing, which left the
// dashboard stuck on "Loading". Fail fast offline and give up after `ms`
// otherwise, so the copy saved on the device can be shown instead.
function cloudCall(promise, ms) {
  if (!navigator.onLine) return Promise.reject(new Error('This device is offline'))
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('The server took too long to answer')), ms)),
  ])
}

// Long per-student lists show this many rows until expanded.
const RISK_PREVIEW_ROWS = 5
const RISK_BATCH_SIZE = 5

const ELIGIBILITY_ORDER = { INELIGIBLE: 0, AT_RISK: 1, ON_TRACK: 2, SECURED: 3, NO_DATA: 4 }

const ELIGIBILITY_LABELS = {
  INELIGIBLE: { text: 'NOT ELIGIBLE', tone: 'pill-red' },
  AT_RISK: { text: 'AT RISK', tone: 'pill-amber' },
  ON_TRACK: { text: 'ON TRACK', tone: 'pill-green' },
  SECURED: { text: 'ELIGIBLE', tone: 'pill-green' },
  NO_DATA: { text: 'NO DATA', tone: 'pill-gray' },
}

const RISK_TONES = { HIGH: 'pill-red', MEDIUM: 'pill-amber', LOW: 'pill-green' }

function describeEligibility(r) {
  const pct = Math.round(r.projectedBestRate * 100)
  switch (r.status) {
    case 'INELIGIBLE':
      return `Cannot reach the threshold. Best possible is ${pct}% even with full attendance.`
    case 'AT_RISK':
    case 'ON_TRACK':
      return `Can miss at most ${r.maxMoreAbsences} more day${r.maxMoreAbsences === 1 ? '' : 's'} before the exam.`
    case 'SECURED':
      return 'Already meets the threshold for the exam.'
    default:
      return 'No attendance recorded this term.'
  }
}

export default function Admin() {
  const navigate = useNavigate()
  const [schoolId, setSchoolId] = useState(null)
const [classId, setClassId] = useState(null)
const [classes, setClasses] = useState([])
const [contextError, setContextError] = useState('')
  const [{ startDate, endDate }, setDateRange] = useState(defaultDateRange)
  const [adminWarning, setAdminWarning] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState(null)
  const [chronicExpanded, setChronicExpanded] = useState(false)
  const [savedCopy, setSavedCopy] = useState(null) // { saved_at, startDate, endDate } when showing device data

  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
    const [summaryError, setSummaryError] = useState('')
  const [summaryExpanded, setSummaryExpanded] = useState(false)

  const [riskResults, setRiskResults] = useState({}) // { studentId: { risk_level, risk_score, reason } }
  const [riskLoading, setRiskLoading] = useState(false)
  const [riskError, setRiskError] = useState('')
  const [riskExpanded, setRiskExpanded] = useState(false)

  // Set on the Settings page; read once here since leaving for Settings remounts this page.
  const [termStart] = useState(getTermStart)
  const [examDate] = useState(getExamDate)
  const [eligibility, setEligibility] = useState(null) // { remainingDays, threshold, rows }
  const [eligibilityLoading, setEligibilityLoading] = useState(false)
  const [eligibilityError, setEligibilityError] = useState('')
  const [eligibilityExpanded, setEligibilityExpanded] = useState(false)

const loadData = useCallback(async () => {
  if (!classId) return   // ← add this guard
  setLoading(true)
  setError('')
  try {
    const [students, records] = await cloudCall(Promise.all([
      fetchAllPages(listStudentsQuery, { classId }, 'listStudents'),
      fetchClassAttendance((request) => client.graphql(request), { classId, startDate, endDate }),
    ]), 20000)
    setStats(computeStats(students, records, getChronicThreshold()))
    setSavedCopy(null)
    db.dashboardCache
      .put({ key: `class:${classId}`, students, records, startDate, endDate, saved_at: new Date().toISOString() })
      .catch((err) => console.warn('Could not save dashboard data on this device:', err))
  } catch (err) {
    console.error('Failed to load dashboard data:', err)
    // Offline or the server can't be reached: show the last copy saved on
    // this device for the class, if there is one.
    const saved = await db.dashboardCache.get(`class:${classId}`).catch(() => null)
    if (saved) {
      setStats(computeStats(saved.students, saved.records, getChronicThreshold()))
      setSavedCopy({ saved_at: saved.saved_at, startDate: saved.startDate, endDate: saved.endDate })
    } else {
      const detail = err.errors?.map((e) => e.message).join('; ') || err.message || JSON.stringify(err)
      setError(detail)
    }
  } finally {
    setLoading(false)
  }
}, [classId, startDate, endDate])  // ← add classId to deps

useEffect(() => {
  async function resolveContext() {
    try {
      const { schoolId: sid, phoneNumber } = await cloudCall(getCurrentUserContext(), 10000)
      if (sid === NETWORK_SCHOOL_ID) {
        navigate('/network', { replace: true })
        return
      }
      const schoolClasses = await cloudCall(getClassesForSchool(sid), 10000)
      setSchoolId(sid)
      setClasses(schoolClasses)
      setClassId(schoolClasses[0].id)
      db.dashboardCache
        .put({ key: 'context', schoolId: sid, classes: schoolClasses })
        .catch((err) => console.warn('Could not save class list on this device:', err))
      checkAndClaimAdminSession(sid, phoneNumber)
    } catch (err) {
      // Offline: fall back to the school and classes saved on this device.
      const saved = await db.dashboardCache.get('context').catch(() => null)
      if (saved?.classes?.length) {
        setSchoolId(saved.schoolId)
        setClasses(saved.classes)
        setClassId(saved.classes[0].id)
        return
      }
      setContextError(err.message)
      setLoading(false)
    }
  }
  resolveContext()
}, [])

  // "Warn, don't block" concurrent-admin check: looks up who last signed
  // in as admin for this school, warns if it's someone else, then claims
  // the slot for the current session. Deliberately fire-and-forget (not
  // awaited by resolveContext) -- this is a courtesy notice, not a
  // security gate, so it should never delay or block the real dashboard
  // from loading even if this check is slow or fails.
  async function checkAndClaimAdminSession(schoolId, phoneNumber) {
    try {
      const res = await client.graphql({ query: getAdminSessionQuery, variables: { id: schoolId } })
      const existing = res.data.getAdminSessionTracker

      if (existing && existing.admin_phone !== phoneNumber) {
        setAdminWarning(
          `${existing.admin_phone} was also signed in as admin for this school, as of ${new Date(existing.signed_in_at).toLocaleString()}.`
        )
      }

      const now = new Date().toISOString()
      if (existing) {
        await client.graphql({
          query: updateAdminSessionMutation,
          variables: { input: { id: schoolId, admin_phone: phoneNumber, signed_in_at: now } },
        })
      } else {
        await client.graphql({
          query: createAdminSessionMutation,
          variables: { input: { id: schoolId, admin_phone: phoneNumber, signed_in_at: now } },
        })
      }
    } catch (err) {
      // Never let this block or error out the real dashboard -- it's a
      // courtesy notice, not core functionality.
      console.warn('Admin session check failed (non-blocking):', err)
    }
  }

  useEffect(() => {
    loadData()
  }, [loadData])

  // Swap a saved copy for live data as soon as the connection comes back.
  useEffect(() => {
    window.addEventListener('online', loadData)
    return () => window.removeEventListener('online', loadData)
  }, [loadData])

  // Summary and risk scores belong to one class and date range, so clear
  // them whenever the admin picks a different one.
  function changeView({ nextClassId = classId, nextStart = startDate, nextEnd = endDate }) {
    setSummary(null)
    setSummaryError('')
    setRiskResults({})
    setRiskError('')
    setClassId(nextClassId)
    setDateRange({ startDate: nextStart, endDate: nextEnd })
  }

  // Show the summary last saved on this device for the class, if any, so it
  // opens offline and without another Bedrock call. A fresh one replaces it.
  useEffect(() => {
    if (!classId) return
    let cancelled = false
    db.aiSummaries.get(classId)
      .then((saved) => {
        if (!cancelled && saved) setSummary((current) => current ?? saved)
      })
      .catch((err) => console.warn('Could not read saved AI summary:', err))
    return () => { cancelled = true }
  }, [classId, startDate, endDate])

  // The dates the figures on screen actually cover (a saved copy may be older).
  const shownRange = savedCopy || { startDate, endDate }

  async function handleGenerateSummary() {
    setSummaryLoading(true)
    setSummaryError('')
    try {
      // Don't leave the admin waiting on a slow AI call; after 25 seconds
      // the device summary is shown instead.
      const res = await cloudCall(client.graphql({
        query: generateSummaryQuery,
        variables: {
          input: { school_id: schoolId, class_id: classId, start_date: startDate, end_date: endDate },
        },
      }), 25000)
      const fresh = {
        ...res.data.generateAttendanceSummary,
        class_id: classId,
        start_date: startDate,
        end_date: endDate,
      }
      setSummary(fresh)
      setSummaryExpanded(false)
      db.aiSummaries.put(fresh).catch((err) => console.warn('Could not save AI summary on this device:', err))
    } catch (err) {
      console.error('AI summary failed:', err)
      const detail = err.errors?.map((e) => e.message).join('; ') || err.message || JSON.stringify(err)
      if (!stats) {
        setSummaryError(detail)
        return
      }
      // Fall back to a summary written on the device so the admin always
      // gets one. The last Claude summary stays saved and comes back on reload.
      setSummary({
        source: 'device',
        summary: buildDeviceSummary(stats, getChronicThreshold(), shownRange.startDate, shownRange.endDate),
        generated_at: new Date().toISOString(),
        class_id: classId,
        start_date: shownRange.startDate,
        end_date: shownRange.endDate,
      })
      setSummaryExpanded(false)
    } finally {
      setSummaryLoading(false)
    }
  }


    async function handleLoadRiskScores() {
    if (!stats) return
    setRiskLoading(true)
    setRiskError('')
    try {
      const studentIds = stats.perStudent.map((p) => p.student.id)
      const scoreOne = (id) => client
        .graphql({ query: predictRiskQuery, variables: { input: { student_id: id } } })
        .then((res) => ({ id, data: res.data.predictAttendanceRisk }))
        .catch((err) => ({ id, error: err.errors?.map((e) => e.message).join('; ') || err.message || 'Failed to score' }))
      // A few at a time, with one retry, so a whole class doesn't hit the
      // account's Lambda concurrency limit at once.
      const results = []
      for (let i = 0; i < studentIds.length; i += RISK_BATCH_SIZE) {
        const batch = await Promise.all(studentIds.slice(i, i + RISK_BATCH_SIZE).map(scoreOne))
        for (const r of batch) results.push(r.error ? await scoreOne(r.id) : r)
      }
      const byId = {}
      for (const r of results) {
        byId[r.id] = r.data || { risk_level: 'ERROR', reason: r.error }
      }
      setRiskResults(byId)
    } catch (err) {
      console.error('Risk scoring failed:', err)
      setRiskError(err.message || 'Failed to load risk scores')
    } finally {
      setRiskLoading(false)
    }
  }

  // Exam eligibility always uses the whole term (term start to today),
  // whatever range the dashboard is showing, so it fetches its own records.
  async function handleCheckEligibility() {
    if (!stats || !classId) return
    if (!termStart || !examDate) {
      setEligibilityError('Set the term start date and the exam date on the Settings page first.')
      return
    }
    setEligibilityLoading(true)
    setEligibilityError('')
    try {
      const today = new Date().toISOString().split('T')[0]
      const records = await fetchClassAttendance((request) => client.graphql(request), {
        classId,
        startDate: termStart,
        endDate: today < examDate ? today : examDate,
      })
      const counts = {}
      for (const r of records) {
        const c = counts[r.student_id] || (counts[r.student_id] = { recorded: 0, attended: 0 })
        c.recorded += 1
        if (r.status !== 'ABSENT') c.attended += 1
      }
      const threshold = EXAM_ATTENDANCE_REQUIRED
      const remainingDays = countSchoolDaysBetween(today, examDate)
      const rows = stats.perStudent.map((p) => {
        const c = counts[p.student.id] || { recorded: 0, attended: 0 }
        return {
          student: p.student,
          ...c,
          ...projectEligibility({ ...c, remainingDays, threshold }),
        }
      })
      setEligibility({ remainingDays, threshold, rows })
    } catch (err) {
      console.error('Eligibility check failed:', err)
      const detail = err.errors?.map((e) => e.message).join('; ') || err.message || JSON.stringify(err)
      setEligibilityError(detail)
    } finally {
      setEligibilityLoading(false)
    }
  }



  // Scored students, highest risk first.
  const riskRows = stats
    ? stats.perStudent
      .filter((p) => riskResults[p.student.id])
      .map((p) => ({ ...p, risk: riskResults[p.student.id] }))
      .sort((a, b) => (b.risk.risk_score ?? 0) - (a.risk.risk_score ?? 0))
    : []
  const riskCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 }
  for (const r of riskRows) {
    if (r.risk.risk_level in riskCounts) riskCounts[r.risk.risk_level] += 1
  }

  function handleExportPDF() {
    if (!stats) return

    const doc = new jsPDF()
    let y = 20

    doc.setFontSize(16)
    doc.text(`Attendance Report — ${schoolId}`, 14, y)
    y += 8

    doc.setFontSize(10)
    doc.setTextColor(120)
    doc.text(`Class: ${classes.find((c) => c.id === classId)?.name || classId}`, 14, y)
    doc.text(`Date range: ${startDate} to ${endDate}`, 14, y + 5)
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, y + 10)
    y += 21

    doc.setTextColor(0)
    doc.setFontSize(13)
    doc.text('Attendance Trend', 14, y)
    y += 7
    doc.setFontSize(11)
    doc.text(
      stats.overallRate !== null ? `${Math.round(stats.overallRate * 100)}% average` : 'No data available',
      14,
      y
    )
    y += 14

    doc.setFontSize(13)
    doc.text(`Students Below ${Math.round(getChronicThreshold() * 100)}% Attendance (${stats.chronic.length})`, 14, y)
    y += 8
    doc.setFontSize(10)

    if (stats.chronic.length === 0) {
      doc.text('No students currently below the threshold.', 14, y)
      y += 8
    } else {
      for (const c of stats.chronic) {
        doc.text(
          `${c.student.first_name} ${c.student.last_name} — ${Math.round(c.rate * 100)}% (${c.absent} absences)`,
          14,
          y
        )
        y += 6
        if (y > 270) {
          doc.addPage()
          y = 20
        }
      }
      y += 6
    }

    // Lines that run past the page start a new one.
    const writeLine = (text) => {
      if (y > 270) {
        doc.addPage()
        y = 20
      }
      doc.text(text, 14, y)
      y += 6
    }

    if (riskRows.length > 0) {
      doc.setFontSize(13)
      writeLine('Predicted Attendance Risk')
      y += 2
      doc.setFontSize(10)
      writeLine(`${riskCounts.HIGH} high, ${riskCounts.MEDIUM} medium, ${riskCounts.LOW} low risk`)
      for (const r of riskRows) {
        const rate = r.rate !== null ? `${Math.round(r.rate * 100)}%` : 'no records'
        writeLine(`${r.student.first_name} ${r.student.last_name} — ${r.risk.risk_level} (currently ${rate})`)
      }
      y += 6
    }

    if (eligibility) {
      const flagged = eligibility.rows
        .filter((r) => r.status === 'INELIGIBLE' || r.status === 'AT_RISK')
        .sort((a, b) => ELIGIBILITY_ORDER[a.status] - ELIGIBILITY_ORDER[b.status] || a.maxMoreAbsences - b.maxMoreAbsences)
      doc.setFontSize(13)
      writeLine(`Exam Eligibility (exam on ${examDate})`)
      y += 2
      doc.setFontSize(10)
      if (flagged.length === 0) writeLine('Every student can still reach the exam threshold.')
      for (const r of flagged) {
        writeLine(`${r.student.first_name} ${r.student.last_name} — ${ELIGIBILITY_LABELS[r.status].text}`)
      }
      y += 6
    }

    if (summary) {
      doc.setFontSize(13)
      doc.text('AI-Generated Summary', 14, y)
      y += 8
      doc.setFontSize(10)
      const lines = doc.splitTextToSize(summary.summary, 180)
      for (const line of lines) {
        if (y > 270) {
          doc.addPage()
          y = 20
        }
        doc.text(line, 14, y)
        y += 6
      }
    }

    doc.save(`attendance-report-${startDate}-to-${endDate}.pdf`)
  }

  const signOutButton = (
    <button onClick={async () => { await signOut(); navigate('/login') }} className="btn btn-small">
      Sign Out
    </button>
  )

  if (loading) {
    return <LoadingScreen message="Loading dashboard…" />
  }

  if (contextError) {
  return (
    <div className="state-screen">
      <h3>Couldn't determine your school/class</h3>
      <p className="text-error">{contextError}</p>
      {signOutButton}
    </div>
  )
}

  if (error) {
    return (
      <div className="state-screen">
        <h3>Couldn't load dashboard data</h3>
        <p className="text-error">{error}</p>
        <div className="button-group" style={{ justifyContent: 'center' }}>
          <button onClick={loadData} className="btn">Retry</button>
          {signOutButton}
        </div>
      </div>
    )
  }

  if (!stats) {
    return <div className="state-screen subtext">No data available.</div>
  }

  const thresholdPct = Math.round(getChronicThreshold() * 100)
  const className = classes.find((c) => c.id === classId)?.name || 'This class'
  const recentWeeks = stats.weekly.slice(-8)
  const showResultsFullWidth = riskRows.length > 0 || eligibility !== null

  return (
    <AppShell nav={ADMIN_NAV} user={{ name: 'School admin', role: schoolName(schoolId) }}>
      <p className="eyebrow">Administrator dashboard · {schoolName(schoolId)}</p>

      {savedCopy && (
        <div className="notice">
          <span>
            Offline: showing the copy saved on this device on {new Date(savedCopy.saved_at).toLocaleString()},
            covering {savedCopy.startDate} to {savedCopy.endDate}. It refreshes when you're back online.
          </span>
        </div>
      )}
      {adminWarning && (
        <div className="notice">
          <span>⚠ {adminWarning}</span>
          <button onClick={() => setAdminWarning('')} className="btn-small">Dismiss</button>
        </div>
      )}

      <div className="hero-row">
        <section className="card hero">
          <Ring value={stats.overallRate} caption="average" />
          <div className="hero-body">
            <h1>{greetingFor()}, Admin</h1>
            <p>
              {stats.overallRate !== null
                ? `${className} averages ${Math.round(stats.overallRate * 100)}% over the selected range. `
                : `No attendance has been marked for ${className} in this range. `}
              {stats.chronic.length === 1
                ? `1 student is below ${thresholdPct}%.`
                : `${stats.chronic.length} students are below ${thresholdPct}%.`}
            </p>
            <div className="filters">
              <label className="filter">
                Class
                <select value={classId || ''} onChange={(e) => changeView({ nextClassId: e.target.value })}>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="filter">
                From
                <input
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(e) => e.target.value && changeView({ nextStart: e.target.value })}
                />
              </label>
              <label className="filter">
                To
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => e.target.value && changeView({ nextEnd: e.target.value })}
                />
              </label>
            </div>
            <p className="subtext" style={{ margin: 0 }}>Showing data from {startDate} to {endDate}</p>
            <div className="button-group">
              <button onClick={handleExportPDF} className="btn">Export PDF</button>
            </div>
          </div>
        </section>

        <section className="card card-dark">
          <h2>Term calendar</h2>
          <div className="info-rows">
            <div className="info-row"><span>Term started</span><strong>{formatDay(termStart)}</strong></div>
            <div className="info-row"><span>Exams begin</span><strong>{formatDay(examDate)}</strong></div>
            <div className="info-row">
              <span>Exam eligibility</span>
              <strong>{(EXAM_ATTENDANCE_REQUIRED * 100).toFixed(1)}%</strong>
            </div>
          </div>
        </section>
      </div>

      <div className="card-grid">
        <section className="card">
          <h2>Attendance trend</h2>
          {recentWeeks.length === 0 ? (
            <p className="subtext">No attendance recorded in this range.</p>
          ) : (
            <div className="week-bars">
              {recentWeeks.map((w) => (
                <div key={w.weekStart} className="week-bar">
                  <span className="subtext" style={{ margin: 0 }}>w/c {formatDay(w.weekStart).replace(/ \d{4}$/, '')}</span>
                  <div className="week-bar-track">
                    <div
                      className={`week-bar-fill${w.rate < getChronicThreshold() ? ' is-low' : ''}`}
                      style={{ width: `${Math.round(w.rate * 100)}%` }}
                    />
                  </div>
                  <strong style={{ textAlign: 'right' }}>{Math.round(w.rate * 100)}%</strong>
                </div>
              ))}
            </div>
          )}
          <p className="subtext" style={{ margin: '14px 0 0' }}>
            Weekly attendance{stats.weekly.length > recentWeeks.length ? ', last 8 weeks of the range' : ''}. Amber weeks are below {thresholdPct}%.
          </p>
        </section>

        <section className="card card-dashed">
          <h2>AI summary <span className="count">(Claude via Bedrock)</span></h2>
          {!summary && !summaryLoading && (
            <>
              <p className="subtext">A short written summary of {className}'s attendance for the dates above.</p>
              <button onClick={handleGenerateSummary} className="btn btn-primary">Generate Summary</button>
            </>
          )}
          {summaryLoading && <p className="subtext">Generating…</p>}
          {summaryError && <p className="text-error">{summaryError}</p>}
          {summary && (
            <>
              {/* Collapsed to a short preview so a long summary doesn't push
                  the rest of the dashboard down. */}
              <div
                style={{
                  fontSize: 14,
                  maxHeight: summaryExpanded ? 'none' : '8em',
                  overflow: 'hidden',
                  ...(summaryExpanded ? {} : {
                    maskImage: 'linear-gradient(to bottom, black 60%, transparent)',
                    WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent)',
                  }),
                }}
                className="markdown-body"
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary.summary}</ReactMarkdown>
              </div>
              {summary.source === 'device' ? (
                <p className="subtext" style={{ fontSize: 11 }}>
                  Claude via Bedrock couldn't be reached, so this summary was written on this device from the
                  attendance figures. Click Regenerate when you're online for the AI version.
                </p>
              ) : (
                <p className="subtext" style={{ fontSize: 11 }}>
                  Generated at {new Date(summary.generated_at).toLocaleString()}, saved on this device
                  {summary.start_date && (summary.start_date !== startDate || summary.end_date !== endDate) &&
                    `. Covers ${summary.start_date} to ${summary.end_date}; regenerate for the dates above.`}
                </p>
              )}
              <div className="button-group">
                <button onClick={() => setSummaryExpanded((v) => !v)} className="btn-small">
                  {summaryExpanded ? 'Show less' : 'Read full summary'}
                </button>
                <button onClick={handleGenerateSummary} disabled={summaryLoading} className="btn-small">
                  {summaryLoading ? 'Generating…' : 'Regenerate'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Students below {thresholdPct}% <span className="count">({stats.chronic.length})</span></h2>
          {stats.chronic.length > RISK_PREVIEW_ROWS && (
            <button onClick={() => setChronicExpanded((v) => !v)} className="btn-small">
              {chronicExpanded ? 'Show less' : 'Show all'}
            </button>
          )}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Attendance rate</th>
                <th style={{ textAlign: 'right' }}>Absences</th>
              </tr>
            </thead>
            <tbody>
              {(chronicExpanded ? stats.chronic : stats.chronic.slice(0, RISK_PREVIEW_ROWS)).map((c) => (
                <tr key={c.student.id}>
                  <td style={{ fontWeight: 600 }}>{c.student.first_name} {c.student.last_name}</td>
                  <td>
                    <span className={`pill ${c.rate < EXAM_ATTENDANCE_REQUIRED ? 'pill-red' : 'pill-amber'}`}>
                      {Math.round(c.rate * 100)}%
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{c.absent}</td>
                </tr>
              ))}
              {stats.chronic.length === 0 && (
                <tr>
                  <td colSpan={3} className="subtext">
                    No students currently below the threshold.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {stats.chronic.length > 0 && (
          <p className="subtext" style={{ margin: '12px 0 0' }}>
            Red is below the {(EXAM_ATTENDANCE_REQUIRED * 100).toFixed(1)}% exam line; amber is between that and {thresholdPct}%.
          </p>
        )}
      </section>

      <div className={`card-grid${showResultsFullWidth ? ' card-grid-stack' : ''}`}>
        <section className="card">
          <h2>Predicted attendance risk <span className="count">({stats.perStudent.length} students)</span></h2>
          <p className="subtext" style={{ marginBottom: 14 }}>
            Forward-looking estimate based on each student's recent attendance trend.
          </p>
          <button onClick={handleLoadRiskScores} disabled={riskLoading} className="btn-accent btn-small">
            {riskLoading ? 'Scoring…' : 'Run Risk Prediction'}
          </button>
          {riskError && <p className="text-error">{riskError}</p>}
          {riskRows.length > 0 && (
            <>
            <p className="subtext" style={{ margin: '16px 0 8px' }}>
              {riskCounts.HIGH} high, {riskCounts.MEDIUM} medium and {riskCounts.LOW} low risk. Highest risk first.
            </p>
            <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Current rate</th>
                  <th>Predicted risk</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {/* Only the top few until expanded, so a full class doesn't
                    push the rest of the dashboard down. */}
                {(riskExpanded ? riskRows : riskRows.slice(0, RISK_PREVIEW_ROWS))
                  .map((p) => {
                    const risk = p.risk
                    return (
                      <tr key={p.student.id}>
                        <td style={{ fontWeight: 600 }}>{p.student.first_name} {p.student.last_name}</td>
                        <td>{p.rate !== null ? `${Math.round(p.rate * 100)}%` : '—'}</td>
                        <td>
                          <span className={`pill ${RISK_TONES[risk.risk_level] || 'pill-gray'}`}>
                            {risk.risk_level}
                          </span>
                        </td>
                        <td className="subtext" style={{ fontSize: 13 }}>{risk.reason}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
            </div>
            {riskRows.length > RISK_PREVIEW_ROWS && (
              <button onClick={() => setRiskExpanded((v) => !v)} className="btn-small" style={{ marginTop: 12 }}>
                {riskExpanded ? 'Show less' : `Show all ${riskRows.length} students`}
              </button>
            )}
            </>
          )}
        </section>

        <section className="card">
          <h2>Exam eligibility</h2>
          <p className="subtext" style={{ marginBottom: 14 }}>
            A student who misses more than a third of school days (below {(EXAM_ATTENDANCE_REQUIRED * 100).toFixed(1)}%
            attendance) cannot sit the exam. This projects each student's position by the exam date, counting
            attendance from the start of term. Assumes school runs Monday to
            Friday and does not skip public holidays.
          </p>
          <button onClick={handleCheckEligibility} disabled={eligibilityLoading} className="btn-accent btn-small">
            {eligibilityLoading ? 'Checking…' : 'Check Exam Eligibility'}
          </button>
          {eligibilityError && <p className="text-error">{eligibilityError}</p>}
          {eligibility && (
            <>
              <p className="subtext" style={{ margin: '16px 0 8px' }}>
                {eligibility.remainingDays} school day{eligibility.remainingDays === 1 ? '' : 's'} left before the exam.{' '}
                {eligibility.rows.filter((r) => r.status === 'INELIGIBLE').length} cannot reach the threshold,{' '}
                {eligibility.rows.filter((r) => r.status === 'AT_RISK').length} at risk.
              </p>
              <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Attended so far</th>
                    <th>Status</th>
                    <th>What it means</th>
                  </tr>
                </thead>
                <tbody>
                  {[...eligibility.rows]
                    .sort((a, b) => ELIGIBILITY_ORDER[a.status] - ELIGIBILITY_ORDER[b.status] || a.maxMoreAbsences - b.maxMoreAbsences)
                    .slice(0, eligibilityExpanded ? undefined : RISK_PREVIEW_ROWS)
                    .map((r) => {
                      const label = ELIGIBILITY_LABELS[r.status]
                      return (
                        <tr key={r.student.id}>
                          <td style={{ fontWeight: 600 }}>{r.student.first_name} {r.student.last_name}</td>
                          <td>{r.recorded > 0 ? `${r.attended}/${r.recorded} (${Math.round((r.attended / r.recorded) * 100)}%)` : '—'}</td>
                          <td>
                            <span className={`pill ${label.tone}`}>{label.text}</span>
                          </td>
                          <td className="subtext" style={{ fontSize: 13 }}>{describeEligibility(r)}</td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
              </div>
              {eligibility.rows.length > RISK_PREVIEW_ROWS && (
                <button onClick={() => setEligibilityExpanded((v) => !v)} className="btn-small" style={{ marginTop: 12 }}>
                  {eligibilityExpanded ? 'Show less' : `Show all ${eligibility.rows.length} students`}
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </AppShell>
  )
}
