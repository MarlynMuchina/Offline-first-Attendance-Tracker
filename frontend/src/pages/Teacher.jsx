import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateClient } from 'aws-amplify/api'
import { signOut } from 'aws-amplify/auth'
import { db } from '../lib/db'
import { startSyncEngine, syncPendingAttendance, stopSyncEngine } from '../lib/syncEngine'
import { getQueueHealth } from '../lib/storageQuotaManager'
import { getCurrentUserContext } from '../lib/auth'
import { loadTeacherClasses } from '../lib/teacherClasses'
import { fromServer } from '../lib/network'
import { schoolName } from '../lib/schools'
import { greetingFor, formatDay } from '../lib/display'
import AppShell, { Ring, LoadingScreen } from '../components/AppShell'

const client = generateClient()

const listStudentsQuery = /* GraphQL */ `
  query ListStudents($classId: ID!, $nextToken: String) {
    listStudents(filter: { class_id: { eq: $classId } }, limit: 1000, nextToken: $nextToken) {
      items {
        id
        first_name
        last_name
        class_id
      }
      nextToken
    }
  }
`

const listSchoolStudentsQuery = /* GraphQL */ `
  query ListAllSchoolStudents($schoolId: ID, $nextToken: String) {
    listStudents(filter: { school_id: { eq: $schoolId } }, limit: 100, nextToken: $nextToken) {
      items {
        id
        first_name
        last_name
        class_id
        status
      }
      nextToken
    }
  }
`

const updateStudentClassMutation = /* GraphQL */ `
  mutation AssignStudentToClass($input: UpdateStudentInput!) {
    updateStudent(input: $input) {
      id
      class_id
     }
  }
`

const today = () => new Date().toISOString().split('T')[0]

const MARK_OPTIONS = [
  { status: 'PRESENT', label: 'Present' },
  { status: 'ABSENT', label: 'Absent' },
  { status: 'LATE', label: 'Late' },
]

export default function Teacher() {
  const navigate = useNavigate()
  const [classId, setClassId] = useState(null)
  const [schoolId, setSchoolId] = useState(null)
  const [students, setStudents] = useState([])
  const [queueRecords, setQueueRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [storageWarning, setStorageWarning] = useState(null)
  const [contextError, setContextError] = useState('')
  const [classesSavedAt, setClassesSavedAt] = useState(null)
  const classIdRef = useRef(null)

  const [teacherName, setTeacherName] = useState('')
  const [myClasses, setMyClasses] = useState([])
  const [availableStudents, setAvailableStudents] = useState([])

  const [availableLoading, setAvailableLoading] = useState(false)
  const [availableError, setAvailableError] = useState('')
  const [addingStudentId, setAddingStudentId] = useState(null)

  const loadStudents = useCallback(async (resolvedClassId) => {
    try {
      // The class filter runs after DynamoDB reads each page, so a page can
      // come back short or empty while more matches remain. Follow nextToken
      // until the whole roster is in.
      const fresh = await fromServer(async () => {
        let items = []
        let nextToken = null
        do {
          const res = await client.graphql({
            query: listStudentsQuery,
            variables: { classId: resolvedClassId, nextToken },
          })
          items = items.concat(res.data.listStudents.items)
          nextToken = res.data.listStudents.nextToken
        } while (nextToken)
        return items
      }, 15000)
      // Replace this class's saved roster, so a student moved out of the
      // class doesn't stay on the offline register.
      await db.transaction('rw', db.students, async () => {
        await db.students.where('class_id').equals(resolvedClassId).delete()
        await db.students.bulkPut(fresh)
      })
      setStudents(fresh)
    } catch (err) {
      console.warn('Could not fetch roster from server, using local cache:', err.message)
      const cached = await db.students.where('class_id').equals(resolvedClassId).toArray()
      setStudents(cached)
    }
  }, [])

  const loadQueue = useCallback(async (resolvedClassId) => {
    const records = await db.attendanceQueue
      .where('class_id')
      .equals(resolvedClassId)
      .and((r) => r.date === today())
      .toArray()
    setQueueRecords(records)
  }, [])

  const loadAvailableStudents = useCallback(async (resolvedSchoolId, resolvedClassId) => {
    if (!navigator.onLine) {
      setAvailableError('Adding students needs internet. Marking the register works offline.')
      return
    }
    setAvailableLoading(true)
    setAvailableError('')
    try {
      let items = []
      let nextToken = null
      do {
        const res = await client.graphql({
          query: listSchoolStudentsQuery,
          variables: { schoolId: resolvedSchoolId, nextToken },
        })
        items = items.concat(res.data.listStudents.items)
        nextToken = res.data.listStudents.nextToken
      } while (nextToken)

      // Only students not in any class (removed students stay out). Moving a
      // student out of another teacher's class is done by the admin.
      setAvailableStudents(items.filter((s) => !s.class_id && s.status !== 'INACTIVE'))
    } catch (err) {
      console.error('Failed to load available students:', err)
      setAvailableError(
        navigator.onLine
          ? err.message || 'Failed to load students'
          : 'Adding students needs internet. Marking the register works offline.'
      )
    } finally {
      setAvailableLoading(false)
    }
  }, [])

  useEffect(() => {
    async function init() {
      setLoading(true)
      try {
        const { schoolId: sid, userId } = await getCurrentUserContext()
        setSchoolId(sid)
        const { teacherName: name, classes, savedAt } = await loadTeacherClasses(userId)
        setClassesSavedAt(savedAt)
        setTeacherName(name)
        setMyClasses(classes)
        const resolvedClassId = classes[0].id
        setClassId(resolvedClassId)
        classIdRef.current = resolvedClassId
        await loadStudents(resolvedClassId)
        await loadQueue(resolvedClassId)
        await loadAvailableStudents(sid, resolvedClassId)
      } catch (err) {
        console.error('Failed to resolve school/class context:', err)
        setContextError(
          navigator.onLine
            ? err.message
            : "You're offline and this device hasn't saved your class yet. Open this page once with internet, then it works offline."
        )
      } finally {
        setLoading(false)
      }
      startSyncEngine()

      function handleOnline() {
        setIsOnline(true)
        if (!classIdRef.current) return
        syncPendingAttendance().then(() => loadQueue(classIdRef.current))
      }
      function handleOffline() { setIsOnline(false) }
      window.addEventListener('online', handleOnline)
      window.addEventListener('offline', handleOffline)

      const interval = setInterval(() => {
        if (!classIdRef.current) return
        syncPendingAttendance().then(() => loadQueue(classIdRef.current))
        getQueueHealth().then((health) => {
          setStorageWarning(health.criticalUnsynced ? health : null)
        })
      }, 10000)

      // Reading the local queue is cheap, so the status column follows a
      // sync as each record lands instead of only when the whole batch ends.
      const statusInterval = setInterval(() => {
        if (classIdRef.current) loadQueue(classIdRef.current)
      }, 2000)

      return () => {
        window.removeEventListener('online', handleOnline)
        window.removeEventListener('offline', handleOffline)
        clearInterval(interval)
        clearInterval(statusInterval)
        stopSyncEngine()
      }
    }
    init()
  }, [loadStudents, loadQueue])

    async function markStatus(studentId, status) {
    const markedAt = new Date().toISOString()
    let userId = 'unknown'
    try {
      // Uses the saved sign-in offline. getCurrentUser would try to refresh
      // an expired token, which can hang without internet.
      userId = (await getCurrentUserContext()).userId
    } catch {
      // no sign-in at all: still record locally, sync later
    }

    // If today's record for this student already exists in the queue, update it in place.
    const existing = queueRecords.find((r) => r.student_id === studentId)

    if (existing) {
      await db.attendanceQueue.update(existing.localId, {
        status,
        marked_at: markedAt,
        sync_status: 'PENDING',
        // Reuse the same client_request_id across edits to the same queue
        // entry, so retries and re-marks before the first sync completes
        // still count as one idempotent write, not a race of duplicates.
        client_request_id: existing.client_request_id || crypto.randomUUID(),
      })
    } else {
      await db.attendanceQueue.add({
        student_id: studentId,
        class_id: classId,
        date: today(),
        status,
        marked_at: markedAt,
        marked_by: userId,
        sync_status: 'PENDING',
        remote_id: null,
        client_request_id: crypto.randomUUID(),
      })
    }

    await loadQueue(classIdRef.current)
    syncPendingAttendance().then(() => loadQueue(classIdRef.current)) // fire-and-forget; refresh status once it settles
  }

  async function markAllPresent() {
    for (const s of students) {
      await markStatus(s.id, 'PRESENT')
    }
  }

  async function handleManualSync() {
  setSyncing(true)
  await syncPendingAttendance()
  await loadQueue(classIdRef.current)
  setSyncing(false)
}

  async function handleAddExistingStudent(studentId) {
    setAddingStudentId(studentId)
    try {
      await client.graphql({
        query: updateStudentClassMutation,
        variables: {
          input: {
            id: studentId,
            class_id: classIdRef.current,
            updated_at: new Date().toISOString(),
          },
        },
      })
      await loadStudents(classIdRef.current)
      await loadAvailableStudents(schoolId, classIdRef.current)
    } catch (err) {
      console.error('Failed to add student to class:', err)
      setAvailableError(err.message || 'Failed to add student')
    } finally {
      setAddingStudentId(null)
    }
  }

  if (loading) {
    return <LoadingScreen message="Loading your class…" />
  }

  if (contextError) {
    return (
      <div className="state-screen">
        <h3>Couldn't load your class</h3>
        <p className="text-error">{contextError}</p>
        <button
          onClick={async () => {
            await signOut()
            navigate('/login')
          }}
          className="btn"
        >
          Sign Out
        </button>
      </div>
    )
  }

  const syncedCount = queueRecords.filter((r) => r.sync_status === 'SYNCED').length
  const waitingCount = queueRecords.filter((r) => r.sync_status !== 'SYNCED').length
  const failedCount = queueRecords.filter((r) => r.sync_status === 'FAILED').length
  const markedCount = students.filter((s) => queueRecords.some((r) => r.student_id === s.id)).length
  const className = myClasses.find((c) => c.id === classId)?.name || ''

  return (
    <AppShell
      nav={[
        { href: '#register', label: 'Mark attendance', icon: 'register', active: true },
        { href: '#add-students', label: 'Add students', icon: 'addStudent' },
      ]}
      user={{ name: teacherName || 'Teacher', role: `Teacher · ${schoolName(schoolId)}` }}
      status={`${syncedCount}/${students.length} synced`}
    >
      <p className="eyebrow">
        {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </p>

      {classesSavedAt && (
        <div className="notice">
          <span>
            Showing your class as saved on this device on {formatDay(classesSavedAt.slice(0, 10))}. Marks are kept
            here and sync by themselves once you're back online.
          </span>
        </div>
      )}

      {storageWarning && (
        <div className="notice">
          <span>
            ⚠ Device storage is nearly full and {storageWarning.unsyncedCount} record(s) haven't synced yet.
            These records are safe and won't be deleted, but please connect to the internet soon to free up space.
          </span>
        </div>
      )}

      <div className="hero-row">
        <section className="card hero">
          <Ring
            value={students.length ? markedCount / students.length : 0}
            label={`${markedCount}/${students.length}`}
            caption="marked today"
            size={150}
          />
          <div className="hero-body">
            <h1>{greetingFor()}{teacherName ? `, ${teacherName.split(' ')[0]}` : ''}</h1>
            <p>
              {className}, {schoolName(schoolId)}. Today's register saves on this device first and is sent
              as soon as you're online.
            </p>
            {myClasses.length > 1 && (
              <div className="filters">
                <label className="filter">
                  Viewing class
                  <select
                    value={classId}
                    onChange={async (e) => {
                      const newClassId = e.target.value
                      setClassId(newClassId)
                      classIdRef.current = newClassId
                      await loadStudents(newClassId)
                      await loadQueue(newClassId)
                      await loadAvailableStudents(schoolId, newClassId)
                    }}
                  >
                    {myClasses.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        </section>

        <section className="card card-dark" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0 }}>Sync status</h2>
          <div className="info-rows">
            <div className="info-row"><span>Synced</span><strong>{syncedCount}</strong></div>
            <div className="info-row"><span>Waiting on this device</span><strong>{waitingCount}</strong></div>
            {failedCount > 0 && (
              <div className="info-row"><span>Failed, will retry</span><strong>{failedCount}</strong></div>
            )}
            <div className="info-row"><span>Not marked yet</span><strong>{students.length - markedCount}</strong></div>
          </div>
          <button
            onClick={handleManualSync}
            disabled={syncing || !isOnline}
            className="btn btn-accent"
            style={{ marginTop: 'auto' }}
          >
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </section>
      </div>

      <section className="card" id="register">
        <div className="card-head">
          <h2>Today's register <span className="count">({students.length} student{students.length === 1 ? '' : 's'})</span></h2>
          <button onClick={markAllPresent} className="btn-small" disabled={students.length === 0}>
            Mark All Present
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Present · Absent · Late</th>
                <th style={{ textAlign: 'right' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 && (
                <tr>
                  <td colSpan={3} className="subtext">
                    No students in this class yet — add some below.
                  </td>
                </tr>
              )}
              {students.map((s) => {
                const record = queueRecords.find((r) => r.student_id === s.id)
                const studentName = `${s.first_name} ${s.last_name}`
                return (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{studentName}</td>
                    <td>
                      <div className="mark-group" role="radiogroup" aria-label={`Attendance for ${studentName}`}>
                        {MARK_OPTIONS.map(({ status, label }) => (
                          <label
                            key={status}
                            className={`mark mark-${status.toLowerCase()}${record?.status === status ? ' is-on' : ''}`}
                          >
                            <input
                              type="radio"
                              name={s.id}
                              checked={record?.status === status}
                              onChange={() => markStatus(s.id, status)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!record && <span className="pill pill-gray">Not marked</span>}
                      {record?.sync_status === 'PENDING' && <span className="pill pill-amber">Queued</span>}
                      {record?.sync_status === 'SYNCING' && <span className="pill pill-gray">Syncing…</span>}
                      {record?.sync_status === 'SYNCED' && <span className="pill pill-green">Synced</span>}
                      {record?.sync_status === 'FAILED' && <span className="pill pill-red">Failed — will retry</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" id="add-students">
        <h2>Add existing students to my class</h2>
        <p className="subtext">Students in your school who are not in any class yet.</p>
        {availableLoading && <p className="subtext">Loading…</p>}
        {availableError && <p className="text-error">{availableError}</p>}
        {!availableLoading && availableStudents.length === 0 && (
          <p className="subtext">No other students in this school to add.</p>
        )}
        {availableStudents.map((s) => (
          <div
            key={s.id}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--sand)' }}
          >
            <span>{s.first_name} {s.last_name}</span>
            <button
              onClick={() => handleAddExistingStudent(s.id)}
              disabled={addingStudentId === s.id}
              className="btn-small"
            >
              {addingStudentId === s.id ? 'Adding…' : 'Add to my class'}
            </button>
          </div>
        ))}
      </section>
    </AppShell>
  )
}
