import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateClient } from 'aws-amplify/api'
import { signOut } from 'aws-amplify/auth'
import jsPDF from 'jspdf'

const client = generateClient()

const SCHOOL_ID = 'school-001'
const CLASS_ID = 'class-form2east'
const CHRONIC_THRESHOLD = 0.7

const listStudentsQuery = /* GraphQL */ `
  query ListStudentsByClass($classId: ID) {
    listStudents(filter: { class_id: { eq: $classId } }, limit: 100) {
      items {
        id
        first_name
        last_name
      }
    }
  }
`

const listAttendanceQuery = /* GraphQL */ `
  query ListAttendanceByClassAndRange($classId: ID, $startDate: String, $endDate: String) {
    listAttendanceRecords(
      filter: {
        class_id: { eq: $classId }
        date: { between: [$startDate, $endDate] }
      }
      limit: 1000
    ) {
      items {
        id
        student_id
        date
        status
      }
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

const createStudentMutation = /* GraphQL */ `
  mutation CreateStudent($input: CreateStudentInput!) {
    createStudent(input: $input) {
      id
      first_name
      last_name
    }
  }
`

function defaultDateRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 30)
  const fmt = (d) => d.toISOString().split('T')[0]
  return { startDate: fmt(start), endDate: fmt(end) }
}

function computeStats(students, records) {
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
    .filter((p) => p.rate !== null && p.rate < CHRONIC_THRESHOLD)
    .sort((a, b) => a.rate - b.rate)

  return { perStudent, overallRate, chronic }
}

export default function Admin() {
  const navigate = useNavigate()
  const [{ startDate, endDate }] = useState(defaultDateRange)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState(null)

  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState('')

  const [newFirstName, setNewFirstName] = useState('')
  const [newLastName, setNewLastName] = useState('')
  const [newGuardianPhone, setNewGuardianPhone] = useState('')
  const [addingStudent, setAddingStudent] = useState(false)
  const [addStudentError, setAddStudentError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [studentsRes, recordsRes] = await Promise.all([
        client.graphql({ query: listStudentsQuery, variables: { classId: CLASS_ID } }),
        client.graphql({
          query: listAttendanceQuery,
          variables: { classId: CLASS_ID, startDate, endDate },
        }),
      ])
      const students = studentsRes.data.listStudents.items
      const records = recordsRes.data.listAttendanceRecords.items
      setStats(computeStats(students, records))
    } catch (err) {
      console.error('Failed to load dashboard data:', err)
      const detail = err.errors?.map((e) => e.message).join('; ') || err.message || JSON.stringify(err)
      setError(detail)
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate])

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
          input: { school_id: SCHOOL_ID, class_id: CLASS_ID, start_date: startDate, end_date: endDate },
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

  async function handleAddStudent(e) {
    e.preventDefault()
    setAddingStudent(true)
    setAddStudentError('')
    try {
      const now = new Date().toISOString()
      await client.graphql({
        query: createStudentMutation,
        variables: {
          input: {
            school_id: SCHOOL_ID,
            class_id: CLASS_ID,
            first_name: newFirstName,
            last_name: newLastName,
            guardian_phone: newGuardianPhone || null,
            status: 'ACTIVE',
            created_at: now,
            updated_at: now,
          },
        },
      })
      setNewFirstName('')
      setNewLastName('')
      setNewGuardianPhone('')
      await loadData()
    } catch (err) {
      console.error('Add student failed:', err)
      const detail = err.errors?.map((e) => e.message).join('; ') || err.message
      setAddStudentError(detail)
    } finally {
      setAddingStudent(false)
    }
  }

  // Builds a real PDF entirely in the browser — no server involved.
  // Sprint 3 deliverable (Sasha): admin config panel + PDF export.
  function handleExportPDF() {
    if (!stats) return

    const doc = new jsPDF()
    let y = 20

    doc.setFontSize(16)
    doc.text('Attendance Report — Form 2 East', 14, y)
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
    doc.text(`Students Below 70% Attendance (${stats.chronic.length})`, 14, y)
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
    <button
      onClick={async () => {
        await signOut()
        navigate('/login')
      }}
      style={{ fontSize: 12, padding: '4px 10px' }}
    >
      Sign Out
    </button>
  )

  if (loading) {
    return <div style={{ textAlign: 'center', marginTop: 80 }}>Loading dashboard…</div>
  }

  if (error) {
    return (
      <div style={{ maxWidth: 700, margin: '80px auto', fontFamily: 'sans-serif', textAlign: 'center' }}>
        <h3>Couldn't load dashboard data</h3>
        <p style={{ color: 'red', fontSize: 13 }}>{error}</p>
        <button onClick={loadData} style={{ marginRight: 8 }}>Retry</button>
        {signOutButton}
      </div>
    )
  }

  if (!stats) {
    return <div style={{ textAlign: 'center', marginTop: 80 }}>No data available.</div>
  }

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Administrator Dashboard</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleExportPDF} style={{ fontSize: 12, padding: '4px 10px' }}>
            Export PDF
          </button>
          {signOutButton}
        </div>
      </div>
      <p style={{ color: '#888', fontSize: 12 }}>
        Showing data from {startDate} to {endDate}
      </p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <div style={{ flex: 1, border: '1px solid #ddd', borderRadius: 6, padding: 16 }}>
          <h4>Attendance Trend</h4>
          <p style={{ fontSize: 28, margin: 0 }}>
            {stats.overallRate !== null ? `${Math.round(stats.overallRate * 100)}%` : '—'}
          </p>
          <p style={{ color: '#888', fontSize: 12 }}>Average over selected range</p>
        </div>

        <div style={{ flex: 1, border: '1px dashed #999', borderRadius: 6, padding: 16, background: '#fafafa' }}>
          <h4>AI Summary (Claude via Bedrock)</h4>
          {!summary && !summaryLoading && (
            <button onClick={handleGenerateSummary} style={{ fontSize: 12, padding: '6px 10px' }}>
              Generate Summary
            </button>
          )}
          {summaryLoading && <p style={{ fontSize: 12, color: '#888' }}>Generating…</p>}
          {summaryError && <p style={{ fontSize: 12, color: 'red' }}>{summaryError}</p>}
          {summary && (
            <>
              <p style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{summary.summary}</p>
              <p style={{ fontSize: 10, color: '#aaa' }}>
                Generated at {new Date(summary.generated_at).toLocaleString()}
              </p>
              <button onClick={handleGenerateSummary} style={{ fontSize: 11, padding: '4px 8px' }}>
                Regenerate
              </button>
            </>
          )}
        </div>
      </div>

      <h4>Students Below 70% Attendance ({stats.chronic.length})</h4>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th>Student</th>
            <th>Attendance rate</th>
            <th>Absences</th>
          </tr>
        </thead>
        <tbody>
          {stats.chronic.map((c) => (
            <tr key={c.student.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px 0' }}>
                {c.student.first_name} {c.student.last_name}
              </td>
              <td>{Math.round(c.rate * 100)}%</td>
              <td>{c.absent}</td>
            </tr>
          ))}
          {stats.chronic.length === 0 && (
            <tr>
              <td colSpan={3} style={{ padding: '12px 0', color: '#888' }}>
                No students currently below the threshold.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ marginTop: 32, borderTop: '1px solid #ddd', paddingTop: 20 }}>
        <h4>Add Student to Form 2 East</h4>
        <form onSubmit={handleAddStudent} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12 }}>First name</label>
            <input
              value={newFirstName}
              onChange={(e) => setNewFirstName(e.target.value)}
              required
              style={{ padding: 6 }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12 }}>Last name</label>
            <input
              value={newLastName}
              onChange={(e) => setNewLastName(e.target.value)}
              required
              style={{ padding: 6 }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12 }}>Guardian phone (optional)</label>
            <input
              value={newGuardianPhone}
              onChange={(e) => setNewGuardianPhone(e.target.value)}
              placeholder="+2547XXXXXXXX"
              style={{ padding: 6 }}
            />
          </div>
          <button type="submit" disabled={addingStudent} style={{ padding: '7px 14px' }}>
            {addingStudent ? 'Adding…' : 'Add Student'}
          </button>
        </form>
        {addStudentError && <p style={{ color: 'red', fontSize: 12, marginTop: 8 }}>{addStudentError}</p>}
      </div>
    </div>
  )
}