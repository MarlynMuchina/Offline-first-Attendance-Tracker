import { getCurrentUserContext, getClassIdForSchool } from '../lib/auth'
import ReactMarkdown from 'react-markdown'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateClient } from 'aws-amplify/api'
import { signOut } from 'aws-amplify/auth'
import jsPDF from 'jspdf'
import { getChronicThreshold, getTermStart, setTermStart, getExamDate, setExamDate } from '../lib/settings'
import { countSchoolDaysBetween, projectEligibility, EXAM_ATTENDANCE_REQUIRED } from '../lib/examEligibility'

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

const listAttendanceQuery = /* GraphQL */ `
  query ListAttendanceByClassAndRange($classId: ID, $startDate: String, $endDate: String, $nextToken: String) {
    listAttendanceRecords(
      filter: {
        class_id: { eq: $classId }
        date: { between: [$startDate, $endDate] }
      }
      limit: 1000
      nextToken: $nextToken
    ) {
      items {
        id
        student_id
        date
        status
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


function defaultDateRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 30)
  const fmt = (d) => d.toISOString().split('T')[0]
  return { startDate: fmt(start), endDate: fmt(end) }
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

  return { perStudent, overallRate, chronic }
}

const ELIGIBILITY_ORDER = { INELIGIBLE: 0, AT_RISK: 1, ON_TRACK: 2, SECURED: 3, NO_DATA: 4 }

const ELIGIBILITY_LABELS = {
  INELIGIBLE: { text: 'NOT ELIGIBLE', color: '#c00' },
  AT_RISK: { text: 'AT RISK', color: '#c80' },
  ON_TRACK: { text: 'ON TRACK', color: '#080' },
  SECURED: { text: 'ELIGIBLE', color: '#080' },
  NO_DATA: { text: 'NO DATA', color: '#888' },
}

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
const [contextError, setContextError] = useState('')
  const [{ startDate, endDate }] = useState(defaultDateRange)
  const [adminWarning, setAdminWarning] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState(null)

  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
    const [summaryError, setSummaryError] = useState('')

  const [riskResults, setRiskResults] = useState({}) // { studentId: { risk_level, risk_score, reason } }
  const [riskLoading, setRiskLoading] = useState(false)
  const [riskError, setRiskError] = useState('')

  const [termStart, setTermStartState] = useState(getTermStart)
  const [examDate, setExamDateState] = useState(getExamDate)
  const [eligibility, setEligibility] = useState(null) // { remainingDays, threshold, rows }
  const [eligibilityLoading, setEligibilityLoading] = useState(false)
  const [eligibilityError, setEligibilityError] = useState('')

const loadData = useCallback(async () => {
  if (!classId) return   // ← add this guard
  setLoading(true)
  setError('')
  try {
    const [students, records] = await Promise.all([
      fetchAllPages(listStudentsQuery, { classId }, 'listStudents'),
      fetchAllPages(
        listAttendanceQuery,
        { classId, startDate, endDate },
        'listAttendanceRecords'
      ),
    ])
    setStats(computeStats(students, records, getChronicThreshold()))
  } catch (err) {
    console.error('Failed to load dashboard data:', err)
    const detail = err.errors?.map((e) => e.message).join('; ') || err.message || JSON.stringify(err)
    setError(detail)
  } finally {
    setLoading(false)
  }
}, [classId, startDate, endDate])  // ← add classId to deps

useEffect(() => {
  async function resolveContext() {
    try {
      const { schoolId: sid, phoneNumber } = await getCurrentUserContext()
      const cid = await getClassIdForSchool(sid)
      setSchoolId(sid)
      setClassId(cid)
      checkAndClaimAdminSession(sid, phoneNumber)
    } catch (err) {
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

  async function handleGenerateSummary() {
    setSummaryLoading(true)
    setSummaryError('')
    try {
      const res = await client.graphql({
        query: generateSummaryQuery,
        variables: {
          input: { school_id: schoolId, class_id: classId, start_date: startDate, end_date: endDate },
        },
      })
      setSummary(res.data.generateAttendanceSummary)
    } catch (err) {
      console.error('AI summary failed:', err)
      const detail = err.errors?.map((e) => e.message).join('; ') || err.message || JSON.stringify(err)
      setSummaryError(detail)
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
      const results = await Promise.all(
        studentIds.map((id) =>
          client
            .graphql({ query: predictRiskQuery, variables: { input: { student_id: id } } })
            .then((res) => ({ id, data: res.data.predictAttendanceRisk }))
            .catch((err) => ({ id, error: err.message || 'Failed to score' }))
        )
      )
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

  // Exam eligibility uses the whole term (term start to today), not the
  // dashboard's 30-day window, so it fetches its own attendance records.
  async function handleCheckEligibility() {
    if (!stats || !classId) return
    if (!termStart || !examDate) {
      setEligibilityError('Set the term start date and the exam date first.')
      return
    }
    setTermStart(termStart)
    setExamDate(examDate)
    setEligibilityLoading(true)
    setEligibilityError('')
    try {
      const today = new Date().toISOString().split('T')[0]
      const records = await fetchAllPages(
        listAttendanceQuery,
        { classId, startDate: termStart, endDate: today < examDate ? today : examDate },
        'listAttendanceRecords'
      )
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



  function handleExportPDF() {
    if (!stats) return

    const doc = new jsPDF()
    let y = 20

    doc.setFontSize(16)
    doc.text(`Attendance Report — ${schoolId}`, 14, y)
    y += 8

    doc.setFontSize(10)
    doc.setTextColor(120)
    doc.text(`Date range: ${startDate} to ${endDate}`, 14, y)
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, y + 5)
    y += 16

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
    return <div className="page" style={{ textAlign: 'center', marginTop: 80 }}>Loading dashboard…</div>
  }

  if (contextError) {
  return (
    <div className="page" style={{ textAlign: 'center', marginTop: 80 }}>
      <h3>Couldn't determine your school/class</h3>
      <p className="text-error">{contextError}</p>
      {signOutButton}
    </div>
  )
}

  if (error) {
    return (
      <div className="page" style={{ textAlign: 'center', marginTop: 80 }}>
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
    return <div className="page" style={{ textAlign: 'center', marginTop: 80 }}>No data available.</div>
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Administrator Dashboard</h2>
        <div className="button-group">
          <button onClick={handleExportPDF} className="btn btn-small">Export PDF</button>
          <button onClick={() => navigate('/admin/classes')} className="btn btn-small">Classes</button>
          <button onClick={() => navigate('/admin/settings')} className="btn btn-small">Settings</button>
          {signOutButton}
        </div>
      </div>
      {adminWarning && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', border: '1px solid #c80',
          borderRadius: 6, background: '#fff8ec', fontSize: 13, color: '#8a5a00',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>⚠ {adminWarning}</span>
          <button onClick={() => setAdminWarning('')} style={{ fontSize: 12, padding: '2px 8px' }}>Dismiss</button>
        </div>
      )}
      <p className="subtext">Showing data from {startDate} to {endDate}</p>

      <div className="card-row">
        <div className="card">
          <h4>Attendance Trend</h4>
          <p className="big-stat">
            {stats.overallRate !== null ? `${Math.round(stats.overallRate * 100)}%` : '—'}
          </p>
          <p className="subtext">Average over selected range</p>
        </div>

        <div className="card card-dashed">
          <h4>AI Summary (Claude via Bedrock)</h4>
          {!summary && !summaryLoading && (
            <button onClick={handleGenerateSummary} className="btn btn-small">Generate Summary</button>
          )}
          {summaryLoading && <p className="subtext">Generating…</p>}
          {summaryError && <p className="text-error">{summaryError}</p>}
          {summary && (
            <>
              <div style={{ fontSize: 13 }} className="markdown-body">
                <ReactMarkdown>{summary.summary}</ReactMarkdown>
              </div>
              <p className="subtext" style={{ fontSize: 10 }}>
                Generated at {new Date(summary.generated_at).toLocaleString()}
              </p>
              <button onClick={handleGenerateSummary} className="btn btn-small">Regenerate</button>
            </>
          )}
        </div>
      </div>

            <h4>Students Below {Math.round(getChronicThreshold() * 100)}% Attendance ({stats.chronic.length})</h4>
      <table>
        <thead>
          <tr>
            <th>Student</th>
            <th>Attendance rate</th>
            <th>Absences</th>
          </tr>
        </thead>
        <tbody>
              {stats.chronic.map((c) => (
            <tr key={c.student.id}>
              <td>{c.student.first_name} {c.student.last_name}</td>
              <td>{Math.round(c.rate * 100)}%</td>
              <td>{c.absent}</td>
            </tr>
          ))}
                    {stats.chronic.length === 0 && (
            <tr>
              <td colSpan={3} className="subtext" style={{ padding: '12px 6px' }}>
                No students currently below the threshold.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="section-divider">
        <h4>Predicted Attendance Risk ({stats.perStudent.length} students)</h4>
        <p className="subtext" style={{ marginBottom: 10 }}>
          Forward-looking estimate based on each student's recent attendance trend.
        </p>
        <button onClick={handleLoadRiskScores} disabled={riskLoading} className="btn btn-small" style={{ marginBottom: 12 }}>
          {riskLoading ? 'Scoring…' : 'Run Risk Prediction'}
        </button>
        {riskError && <p className="text-error">{riskError}</p>}
        {Object.keys(riskResults).length > 0 && (
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
              {[...stats.perStudent]
                .filter((p) => riskResults[p.student.id])
                .sort((a, b) => (riskResults[b.student.id]?.risk_score ?? 0) - (riskResults[a.student.id]?.risk_score ?? 0))
                .map((p) => {
                  const risk = riskResults[p.student.id]
                  return (
                    <tr key={p.student.id}>
                      <td>{p.student.first_name} {p.student.last_name}</td>
                      <td>{p.rate !== null ? `${Math.round(p.rate * 100)}%` : '—'}</td>
                      <td>
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 10,
                          color: risk.risk_level === 'HIGH' ? '#c00' : risk.risk_level === 'MEDIUM' ? '#c80' : '#080',
                          border: '1px solid currentColor',
                        }}>
                          {risk.risk_level}
                        </span>
                      </td>
                      <td className="subtext" style={{ fontSize: 12 }}>{risk.reason}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-divider">
        <h4>Exam Eligibility</h4>
        <p className="subtext" style={{ marginBottom: 10 }}>
          A student who misses more than a third of school days (below {(EXAM_ATTENDANCE_REQUIRED * 100).toFixed(1)}%
          attendance) cannot sit the exam. This projects each student's position by the exam date, counting
          attendance from the start of term. Assumes school runs Monday to
          Friday and does not skip public holidays.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <label className="subtext">
            Term started{' '}
            <input type="date" value={termStart} onChange={(e) => setTermStartState(e.target.value)} />
          </label>
          <label className="subtext">
            Exam date{' '}
            <input type="date" value={examDate} onChange={(e) => setExamDateState(e.target.value)} />
          </label>
          <button onClick={handleCheckEligibility} disabled={eligibilityLoading} className="btn btn-small">
            {eligibilityLoading ? 'Checking…' : 'Check Exam Eligibility'}
          </button>
        </div>
        {eligibilityError && <p className="text-error">{eligibilityError}</p>}
        {eligibility && (
          <>
            <p className="subtext" style={{ marginBottom: 8 }}>
              {eligibility.remainingDays} school day{eligibility.remainingDays === 1 ? '' : 's'} left before the exam.{' '}
              {eligibility.rows.filter((r) => r.status === 'INELIGIBLE').length} cannot reach the threshold,{' '}
              {eligibility.rows.filter((r) => r.status === 'AT_RISK').length} at risk.
            </p>
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
                  .map((r) => {
                    const label = ELIGIBILITY_LABELS[r.status]
                    return (
                      <tr key={r.student.id}>
                        <td>{r.student.first_name} {r.student.last_name}</td>
                        <td>{r.recorded > 0 ? `${r.attended}/${r.recorded} (${Math.round((r.attended / r.recorded) * 100)}%)` : '—'}</td>
                        <td>
                          <span style={{
                            fontSize: 11, padding: '2px 8px', borderRadius: 10,
                            color: label.color, border: '1px solid currentColor',
                          }}>
                            {label.text}
                          </span>
                        </td>
                        <td className="subtext" style={{ fontSize: 12 }}>{describeEligibility(r)}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
