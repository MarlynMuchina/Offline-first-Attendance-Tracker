import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser, signOut } from 'aws-amplify/auth'
import { db } from '../lib/db'
import { startSyncEngine, syncPendingAttendance } from '../lib/syncEngine'

const client = generateClient()

const CLASS_ID = 'class-form2east' // TODO: replace with real class context once Admin module exists

const listStudentsQuery = /* GraphQL */ `
  query ListStudents($classId: ID!) {
    listStudents(filter: { class_id: { eq: $classId } }) {
      items {
        id
        first_name
        last_name
        class_id
      }
    }
  }
`

const today = () => new Date().toISOString().split('T')[0]

export default function Teacher() {
  const navigate = useNavigate()
  const [students, setStudents] = useState([])
  const [queueRecords, setQueueRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  const [syncing, setSyncing] = useState(false)

  // Load roster: try network first, fall back to local cache if offline.
  const loadStudents = useCallback(async () => {
    try {
      const res = await client.graphql({
        query: listStudentsQuery,
        variables: { classId: CLASS_ID },
      })
      const fresh = res.data.listStudents.items
      await db.students.bulkPut(fresh)
      setStudents(fresh)
    } catch (err) {
      console.warn('Could not fetch roster from server, using local cache:', err.message)
      const cached = await db.students.where('class_id').equals(CLASS_ID).toArray()
      setStudents(cached)
    }
  }, [])

  // Load today's queue entries for this class from Dexie (always local, always works).
  const loadQueue = useCallback(async () => {
    const records = await db.attendanceQueue
      .where('class_id')
      .equals(CLASS_ID)
      .and((r) => r.date === today())
      .toArray()
    setQueueRecords(records)
  }, [])

  useEffect(() => {
  async function init() {
    setLoading(true)
    await loadStudents()
    await loadQueue()
    setLoading(false)
  }
  init()
  startSyncEngine()

  function handleOnline() {
    setIsOnline(true)
    syncPendingAttendance().then(loadQueue)
  }
  function handleOffline() {
    setIsOnline(false)
  }
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  const interval = setInterval(() => {
    syncPendingAttendance().then(loadQueue)
  }, 10000)

  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    clearInterval(interval)
  }
}, [loadStudents, loadQueue])

  async function markStatus(studentId, status) {
    const markedAt = new Date().toISOString()
    let userId = 'unknown'
    try {
      const user = await getCurrentUser()
      userId = user.userId
    } catch {
      // offline or session expired — still record locally, sync later
    }

    // If today's record for this student already exists in the queue, update it in place.
    const existing = queueRecords.find((r) => r.student_id === studentId)

    if (existing) {
      await db.attendanceQueue.update(existing.localId, {
        status,
        marked_at: markedAt,
        sync_status: existing.remote_id ? 'PENDING' : 'PENDING',
      })
    } else {
      await db.attendanceQueue.add({
        student_id: studentId,
        class_id: CLASS_ID,
        date: today(),
        status,
        marked_at: markedAt,
        marked_by: userId,
        sync_status: 'PENDING',
        remote_id: null,
      })
    }

    await loadQueue()
    syncPendingAttendance().then(loadQueue) // fire-and-forget; refresh status once it settles
  }

  async function markAllPresent() {
    for (const s of students) {
      await markStatus(s.id, 'PRESENT')
    }
  }

  async function handleManualSync() {
  setSyncing(true)
  await syncPendingAttendance()
  await loadQueue()
  setSyncing(false)
}

  if (loading) {
    return <div style={{ textAlign: 'center', marginTop: 80 }}>Loading roster…</div>
  }

  if (students.length === 0) {
    return (
      <div style={{ textAlign: 'center', marginTop: 80 }}>
        No students found. Connect to the internet at least once to load the roster.
      </div>
    )
  }

  const syncedCount = queueRecords.filter((r) => r.sync_status === 'SYNCED').length

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'sans-serif' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
  <h2>Teacher Dashboard — Form 2 East</h2>
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span
      style={{
        fontSize: 12,
        border: '1px solid #999',
        borderRadius: 12,
        padding: '4px 10px',
        color: isOnline ? 'green' : '#c00',
      }}
    >
      {isOnline ? '● Online' : '○ Offline'} — {syncedCount}/{students.length} synced
    </span>
    <button
       onClick={async () => {
       await signOut()
       navigate('/login')
     }}
     style={{ fontSize: 12, padding: '4px 10px' }}
     >
     Sign Out
   </button>
  </div>
</div>

      <button onClick={markAllPresent} style={{ marginBottom: 16, padding: '6px 12px' }}>
        Mark All Present
      </button>
      <button
        onClick={handleManualSync}
        disabled={syncing || !isOnline}
        style={{ marginBottom: 16, marginLeft: 8, padding: '6px 12px' }}
        >
       {syncing ? 'Syncing…' : 'Sync Now'}
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
            const record = queueRecords.find((r) => r.student_id === s.id)
            return (
              <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '8px 0' }}>{s.first_name} {s.last_name}</td>
                {['PRESENT', 'ABSENT', 'LATE'].map((status) => (
                  <td key={status}>
                    <input
                      type="radio"
                      name={s.id}
                      checked={record?.status === status}
                      onChange={() => markStatus(s.id, status)}
                    />
                  </td>
                ))}
                <td style={{ fontSize: 12 }}>
                  {!record && <span style={{ color: '#999' }}>Not marked</span>}
                  {record?.sync_status === 'PENDING' && <span style={{ color: '#c80' }}>Queued</span>}
                  {record?.sync_status === 'SYNCING' && <span style={{ color: '#888' }}>Syncing…</span>}
                  {record?.sync_status === 'SYNCED' && <span style={{ color: 'green' }}>Synced</span>}
                  {record?.sync_status === 'FAILED' && <span style={{ color: 'red' }}>Failed — will retry</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}