import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateClient } from 'aws-amplify/api'
import { signOut } from 'aws-amplify/auth'
import { getCurrentUserContext } from '../lib/auth'
import { getChronicThreshold, defaultDateRange } from '../lib/settings'
import { EXAM_ATTENDANCE_REQUIRED } from '../lib/examEligibility'
import { SCHOOLS, NETWORK_SCHOOL_ID, schoolName } from '../lib/schools'

const client = generateClient()

const listAllClassesQuery = /* GraphQL */ `
  query ListAllClasses($nextToken: String) {
    listClasses(limit: 1000, nextToken: $nextToken) {
      items {
        id
        school_id
        name
      }
      nextToken
    }
  }
`

const listAllStudentsQuery = /* GraphQL */ `
  query ListAllStudents($nextToken: String) {
    listStudents(limit: 1000, nextToken: $nextToken) {
      items {
        id
        school_id
        class_id
      }
      nextToken
    }
  }
`

const listAttendanceInRangeQuery = /* GraphQL */ `
  query ListAttendanceInRange($startDate: String, $endDate: String, $nextToken: String) {
    listAttendanceRecords(
      filter: { date: { between: [$startDate, $endDate] } }
      limit: 1000
      nextToken: $nextToken
    ) {
      items {
        student_id
        status
      }
      nextToken
    }
  }
`

async function fetchAllPages(query, variables, resultKey) {
  let items = []
  let nextToken = null
  do {
    const res = await client.graphql({ query, variables: { ...variables, nextToken } })
    const page = res.data[resultKey]
    items = items.concat(page.items)
    nextToken = page.nextToken
  } while (nextToken)
  return items
}


// Same measure as the school dashboard: each student's rate is days attended
// (present or late) over days marked, and a group's rate is the average of
// its students' rates.
function summarise(studentIds, rateByStudent, warningLine) {
  const rates = studentIds.map((id) => rateByStudent[id]).filter((r) => r !== undefined)
  return {
    students: studentIds.length,
    rate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    belowWarning: rates.filter((r) => r < warningLine).length,
    belowExam: rates.filter((r) => r < EXAM_ATTENDANCE_REQUIRED).length,
  }
}

function buildNetworkStats(classes, students, records, warningLine) {
  const tally = {}
  for (const r of records) {
    const t = (tally[r.student_id] ||= { total: 0, attended: 0 })
    t.total += 1
    if (r.status !== 'ABSENT') t.attended += 1
  }
  const rateByStudent = {}
  for (const [id, t] of Object.entries(tally)) rateByStudent[id] = t.attended / t.total

  // Students removed from a school have class_id cleared; leave them out.
  const enrolled = students.filter((s) => s.class_id)

  const schoolIds = new Set([...Object.keys(SCHOOLS), ...classes.map((c) => c.school_id)])
  schoolIds.delete(NETWORK_SCHOOL_ID)

  const schools = [...schoolIds].sort().map((schoolId) => {
    const schoolClasses = classes
      .filter((c) => c.school_id === schoolId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        ...c,
        ...summarise(enrolled.filter((s) => s.class_id === c.id).map((s) => s.id), rateByStudent, warningLine),
      }))
    const schoolStudents = enrolled.filter((s) => s.school_id === schoolId).map((s) => s.id)
    return {
      id: schoolId,
      classes: schoolClasses,
      ...summarise(schoolStudents, rateByStudent, warningLine),
    }
  })

  const total = summarise(enrolled.map((s) => s.id), rateByStudent, warningLine)
  return { schools, total: { ...total, classes: classes.length } }
}

const pct = (r) => (r === null ? '—' : `${Math.round(r * 100)}%`)

export default function Network() {
  const navigate = useNavigate()
  const [{ startDate, endDate }, setDateRange] = useState(defaultDateRange)
  const [allowed, setAllowed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState(null)
  const [openSchool, setOpenSchool] = useState(null)
  const warningLine = getChronicThreshold()

  // Only Angaza accounts may see every school. A school admin who types
  // this address is sent back to their own dashboard.
  useEffect(() => {
    getCurrentUserContext()
      .then(({ schoolId }) => {
        if (schoolId === NETWORK_SCHOOL_ID) setAllowed(true)
        else navigate('/admin', { replace: true })
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [navigate])

  const loadData = useCallback(async () => {
    if (!allowed) return
    setLoading(true)
    setError('')
    try {
      const [classes, students, records] = await Promise.all([
        fetchAllPages(listAllClassesQuery, {}, 'listClasses'),
        fetchAllPages(listAllStudentsQuery, {}, 'listStudents'),
        fetchAllPages(listAttendanceInRangeQuery, { startDate, endDate }, 'listAttendanceRecords'),
      ])
      setStats(buildNetworkStats(classes, students, records, warningLine))
    } catch (err) {
      console.error('Failed to load network data:', err)
      setError(err.errors?.map((e) => e.message).join('; ') || err.message)
    } finally {
      setLoading(false)
    }
  }, [allowed, startDate, endDate, warningLine])

  useEffect(() => {
    loadData()
  }, [loadData])

  const warningPct = Math.round(warningLine * 100)
  const examPct = Math.round(EXAM_ATTENDANCE_REQUIRED * 100)

  return (
    <div className="page">
      <div className="page-header">
        <h2>Angaza Network Overview</h2>
        <div className="button-group">
          <button onClick={async () => { await signOut(); navigate('/login') }} className="btn btn-small">
            Sign Out
          </button>
        </div>
      </div>

      <div className="button-group" style={{ alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <label className="subtext">
          From{' '}
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => e.target.value && setDateRange({ startDate: e.target.value, endDate })}
          />
        </label>
        <label className="subtext">
          To{' '}
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => e.target.value && setDateRange({ startDate, endDate: e.target.value })}
          />
        </label>
      </div>

      {loading && <p className="subtext">Loading every school…</p>}
      {error && <p className="text-error">{error}</p>}

      {!loading && !error && stats && (
        <>
          <div className="card-row">
            <div className="card">
              <h4>Schools</h4>
              <p className="big-stat">{stats.schools.length}</p>
              <p className="subtext">{stats.total.classes} classes, {stats.total.students} students</p>
            </div>
            <div className="card">
              <h4>Network attendance</h4>
              <p className="big-stat">{pct(stats.total.rate)}</p>
              <p className="subtext">Average over selected range</p>
            </div>
            <div className="card">
              <h4>Below {warningPct}%</h4>
              <p className="big-stat">{stats.total.belowWarning}</p>
              <p className="subtext">{stats.total.belowExam} of them below the {examPct}% exam line</p>
            </div>
          </div>

          <h4>Schools</h4>
          <p className="subtext">Select a school to see its classes.</p>
          <table>
            <thead>
              <tr>
                <th>School</th>
                <th>County</th>
                <th>Classes</th>
                <th>Students</th>
                <th>Attendance</th>
                <th>Below {warningPct}%</th>
                <th>Below {examPct}%</th>
              </tr>
            </thead>
            <tbody>
              {stats.schools.map((s) => (
                <SchoolRows
                  key={s.id}
                  school={s}
                  open={openSchool === s.id}
                  onToggle={() => setOpenSchool(openSchool === s.id ? null : s.id)}
                />
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function SchoolRows({ school, open, onToggle }) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', fontWeight: open ? 600 : 400 }}>
        <td>{open ? '▾' : '▸'} {schoolName(school.id)}</td>
        <td>{SCHOOLS[school.id]?.county || '—'}</td>
        <td>{school.classes.length}</td>
        <td>{school.students}</td>
        <td>{pct(school.rate)}</td>
        <td>{school.belowWarning}</td>
        <td>{school.belowExam}</td>
      </tr>
      {open && school.classes.map((c) => (
        <tr key={c.id} className="subtext">
          <td style={{ paddingLeft: 24 }}>{c.name}</td>
          <td></td>
          <td></td>
          <td>{c.students}</td>
          <td>{pct(c.rate)}</td>
          <td>{c.belowWarning}</td>
          <td>{c.belowExam}</td>
        </tr>
      ))}
      {open && school.classes.length === 0 && (
        <tr className="subtext">
          <td colSpan={7} style={{ paddingLeft: 24 }}>No classes yet.</td>
        </tr>
      )}
    </>
  )
}
