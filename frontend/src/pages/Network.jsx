import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateClient } from 'aws-amplify/api'
import { getCurrentUserContext } from '../lib/auth'
import { getChronicThreshold, defaultDateRange } from '../lib/settings'
import { EXAM_ATTENDANCE_REQUIRED } from '../lib/examEligibility'
import { SCHOOLS, NETWORK_SCHOOL_ID, schoolName } from '../lib/schools'
import SchoolAdmins from '../components/SchoolAdmins'
import AppShell, { Ring } from '../components/AppShell'
import { greetingFor } from '../lib/display'

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
    <AppShell
      nav={[{ to: '/network', label: 'Network overview', icon: 'network' }]}
      user={{ name: 'Angaza team', role: 'Network admin' }}
    >
      <p className="eyebrow">Angaza network overview · {Object.keys(SCHOOLS).length} schools</p>

      <section className="card hero">
        <Ring value={stats ? stats.total.rate : null} caption="network average" />
        <div className="hero-body">
          <h1>{greetingFor()}, Angaza team</h1>
          <p>
            {stats
              ? `${stats.total.students} students in ${stats.total.classes} classes across ${stats.schools.length} schools. ${stats.total.belowWarning} are below ${warningPct}%.`
              : 'Attendance across every school in the network.'}
          </p>
          <div className="filters">
            <label className="filter">
              From
              <input
                type="date"
                value={startDate}
                max={endDate}
                onChange={(e) => e.target.value && setDateRange({ startDate: e.target.value, endDate })}
              />
            </label>
            <label className="filter">
              To
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => e.target.value && setDateRange({ startDate, endDate: e.target.value })}
              />
            </label>
          </div>
        </div>
      </section>

      {loading && <p className="subtext">Loading every school…</p>}
      {error && <p className="text-error">{error}</p>}

      {!loading && !error && stats && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <span className="stat-value">{stats.schools.length}</span>
              <span className="stat-label">Schools</span>
              <span className="subtext">{stats.total.classes} classes, {stats.total.students} students</span>
            </div>
            <div className="stat">
              <span className="stat-value">{pct(stats.total.rate)}</span>
              <span className="stat-label">Network attendance</span>
              <span className="subtext">Average over selected range</span>
            </div>
            <div className="stat">
              <span className="stat-value">{stats.total.belowWarning}</span>
              <span className="stat-label">Below {warningPct}%</span>
              <span className="subtext">{stats.total.belowExam} of them below the {examPct}% exam line</span>
            </div>
          </div>

          <section className="card">
            <h2>Schools</h2>
            <p className="subtext">Select a school to see its classes.</p>
            <div className="table-scroll">
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
            </div>
          </section>
        </>
      )}

      {allowed && <SchoolAdmins />}
    </AppShell>
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
