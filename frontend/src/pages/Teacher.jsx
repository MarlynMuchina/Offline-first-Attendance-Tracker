import { useState, useEffect } from 'react'
import { mockStudents, mockAttendanceRecords } from '../mocks/fixtures'

// Teacher dashboard — roster + toggles + bulk action + sync indicator (US-02, US-03, US-04).
//
// SPRINT 0 NOTE: the localStorage save below is a temporary placeholder so this
// demo doesn't lose data on refresh. It is NOT real offline architecture.
// Sprint 1 replaces this entirely with Amplify DataStore (Marlyn), which handles
// on-device storage, compression, and the actual sync queue. This component will
// then just call DataStore.save(...) instead of localStorage, and read
// sync_status from DataStore's own sync state instead of local state.
const STORAGE_KEY = 'attendance_draft_v0'

function loadInitialRecords() {
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved ? JSON.parse(saved) : mockAttendanceRecords
}

export default function Teacher() {
  const [records, setRecords] = useState(loadInitialRecords)
  const [savedAt, setSavedAt] = useState(null)

  function setStatus(studentId, status) {
    setRecords((prev) =>
      prev.map((r) =>
        r.student_id === studentId
          ? { ...r, status, marked_at: new Date().toISOString(), sync_status: 'QUEUED' }
          : r
      )
    )
  }

  function markAllPresent() {
    setRecords((prev) =>
      prev.map((r) => ({ ...r, status: 'PRESENT', marked_at: new Date().toISOString(), sync_status: 'QUEUED' }))
    )
  }

  function handleSave() {
    // Placeholder only — Sprint 1 replaces this with Amplify DataStore.save()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
    setSavedAt(new Date().toLocaleTimeString())
  }

  const pendingCount = records.filter((r) => r.sync_status === 'QUEUED').length

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Teacher Dashboard — Form 2 East</h2>
        <span style={{ fontSize: 12, border: '1px solid #999', borderRadius: 12, padding: '4px 10px' }}>
          {pendingCount > 0 ? `${pendingCount} pending sync` : 'All synced'}
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
          </tr>
        </thead>
        <tbody>
          {mockStudents.map((s) => {
            const record = records.find((r) => r.student_id === s.student_id)
            return (
              <tr key={s.student_id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '8px 0' }}>{s.first_name} {s.last_name}</td>
                {['PRESENT', 'ABSENT', 'LATE'].map((status) => (
                  <td key={status}>
                    <input
                      type="radio"
                      name={s.student_id}
                      checked={record.status === status}
                      onChange={() => setStatus(s.student_id, status)}
                    />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={handleSave} style={{ padding: '10px 20px', fontWeight: 'bold' }}>
          SAVE ATTENDANCE
        </button>
        {savedAt && <span style={{ fontSize: 12, color: '#888' }}>Saved locally at {savedAt} (placeholder — real sync comes in Sprint 1)</span>}
      </div>
    </div>
  )
}