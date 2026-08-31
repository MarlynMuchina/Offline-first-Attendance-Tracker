import { useState, useEffect, useCallback } from 'react'
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'

const client = generateClient()

// TODO: replace with real school/class context once Admin module exists
// (teacher-to-class assignment isn't built yet, so this stays hardcoded
// for now — tracked as a known gap, not an oversight)
const SCHOOL_ID = 'school-001'
const CLASS_ID = 'class-form2east'

const listStudentsQuery = /* GraphQL */ `
  query ListStudents($classId: ID!) {
    listStudents(filter: { class_id: { eq: $classId } }) {
      items {
        id
        first_name
        last_name
      }
    }
  }
`

const listAttendanceForDateQuery = /* GraphQL */ `
  query ListAttendance($classId: ID!, $date: String!) {
    listAttendanceRecords(
      filter: { class_id: { eq: $classId }, date: { eq: $date } }
    ) {
      items {
        id
        student_id
        status
        marked_at
      }
    }
  }
`

const createAttendanceRecord = /* GraphQL */ `
  mutation CreateAttendanceRecord($input: CreateAttendanceRecordInput!) {
    createAttendanceRecord(input: $input) {
      id
      student_id
      status
      marked_at
    }
  }
`

const updateAttendanceRecord = /* GraphQL */ `
  mutation UpdateAttendanceRecord($input: UpdateAttendanceRecordInput!) {
    updateAttendanceRecord(input: $input) {
      id
      student_id
      status
      marked_at
    }
  }
`

const today = () => new Date().toISOString().split('T')[0]

export default function Teacher() {
  const [students, setStudents] = useState([])
  const [records, setRecords] = useState({}) // keyed by student_id
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [savingId, setSavingId] = useState(null) // per-row save indicator
  const [saveErrors, setSaveErrors] = useState({}) // keyed by student_id

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const user = await getCurrentUser()
      setCurrentUser(user)

      const [studentsRes, attendanceRes] = await Promise.all([
        client.graphql({ query: listStudentsQuery, variables: { classId: CLASS_ID } }),
        client.graphql({
          query: listAttendanceForDateQuery,
          variables: { classId: CLASS_ID, date: today() },
        }),
      ])

      setStudents(studentsRes.data.listStudents.items)

      const recordMap = {}
      attendanceRes.data.listAttendanceRecords.items.forEach((r) => {
        recordMap[r.student_id] = r
      })
      setRecords(recordMap)
    } catch (err) {
      console.error('Failed to load roster/attendance:', err)
      setLoadError(err.message || 'Failed to load data from server')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  async function markStatus(studentId, status) {
    setSavingId(studentId)
    setSaveErrors((prev) => ({ ...prev, [studentId]: null }))
    const existing = records[studentId]
    const markedAt = new Date().toISOString()

    try {
      let result
      if (existing) {
        result = await client.graphql({
          query: updateAttendanceRecord,
          variables: {
            input: { id: existing.id, status, marked_at: markedAt },
          },
        })
        setRecords((prev) => ({
          ...prev,
          [studentId]: result.data.updateAttendanceRecord,
        }))
      } else {
        result = await client.graphql({
          query: createAttendanceRecord,
          variables: {
            input: {
              school_id: SCHOOL_ID,
              student_id: studentId,
              class_id: CLASS_ID,
              date: today(),
              status,
              marked_by: currentUser?.userId || 'unknown',
              marked_at: markedAt,
            },
          },
        })
        setRecords((prev) => ({
          ...prev,
          [studentId]: result.data.createAttendanceRecord,
        }))
      }
    } catch (err) {
      console.error('Failed to save attendance for', studentId, err)
      setSaveErrors((prev) => ({ ...prev, [studentId]: err.message || 'Save failed' }))
    } finally {
      setSavingId(null)
    }
  }

  async function markAllPresent() {
    for (const s of students) {
      await markStatus(s.id, 'PRESENT')
    }
  }

  if (loading) {
    return <div style={{ textAlign: 'center', marginTop: 80 }}>Loading roster…</div>
  }

  if (loadError) {
    return (
      <div style={{ textAlign: 'center', marginTop: 80, color: 'red' }}>
        <p>{loadError}</p>
        <button onClick={loadData}>Retry</button>
      </div>
    )
  }

  if (students.length === 0) {
    return (
      <div style={{ textAlign: 'center', marginTop: 80 }}>
        No students found for this class yet.
      </div>
    )
  }

  const markedCount = students.filter((s) => records[s.id]).length

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Teacher Dashboard — Form 2 East</h2>
        <span style={{ fontSize: 12, border: '1px solid #999', borderRadius: 12, padding: '4px 10px' }}>
          {markedCount}/{students.length} marked today
        </span>
      </div>

      <button onClick={markAllPresent} style={{ marginBottom: 16, padding: '6px 12px' }}>
        Mark All Present
      </button>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th>Student</th>
            <th>Present</th>
            <th>Absent</th>
            <th>Late</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => {
            const record = records[s.id]
            const isSaving = savingId === s.id
            const error = saveErrors[s.id]
            return (
              <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '8px 0' }}>{s.first_name} {s.last_name}</td>
                {['PRESENT', 'ABSENT', 'LATE'].map((status) => (
                  <td key={status}>
                    <input
                      type="radio"
                      name={s.id}
                      disabled={isSaving}
                      checked={record?.status === status}
                      onChange={() => markStatus(s.id, status)}
                    />
                  </td>
                ))}
                <td style={{ fontSize: 12 }}>
                  {isSaving && <span style={{ color: '#888' }}>Saving…</span>}
                  {!isSaving && record && <span style={{ color: 'green' }}>Synced</span>}
                  {!isSaving && !record && <span style={{ color: '#999' }}>Not marked</span>}
                  {error && <span style={{ color: 'red' }}> — {error}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}