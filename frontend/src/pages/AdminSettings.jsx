import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateClient } from 'aws-amplify/api'
import { signOut } from 'aws-amplify/auth'
import { getChronicThreshold, setChronicThreshold } from '../lib/settings'
import { getCurrentUserContext, getClassIdForSchool } from '../lib/auth'

const client = generateClient()

const listStudentsQuery = /* GraphQL */ `
  query ListStudentsWithPhone($classId: ID, $nextToken: String) {
    listStudents(filter: { class_id: { eq: $classId } }, limit: 100, nextToken: $nextToken) {
      items {
        id
        first_name
        last_name
        guardian_phone
      }
      nextToken
    }
  }
`

// limit is applied before the filter, so follow nextToken to get the full roster
async function fetchClassRoster(classId) {
  const students = []
  let nextToken = null
  do {
    const res = await client.graphql({ query: listStudentsQuery, variables: { classId, nextToken } })
    students.push(...res.data.listStudents.items)
    nextToken = res.data.listStudents.nextToken
  } while (nextToken)
  return students
}

const updateStudentMutation = /* GraphQL */ `
  mutation UpdateStudentPhone($input: UpdateStudentInput!) {
    updateStudent(input: $input) {
      id
      guardian_phone
    }
  }
`

const listNotificationLogsQuery = /* GraphQL */ `
  query ListRecentNotificationLogs($schoolId: ID, $cutoff: String, $nextToken: String) {
    listNotificationLogs(
      filter: { school_id: { eq: $schoolId }, created_at: { ge: $cutoff } }
      limit: 100
      nextToken: $nextToken
    ) {
      items {
        id
        student_id
        guardian_phone
        message
        channel
        status
        sent_at
        created_at
      }
      nextToken
    }
  }
`

// Amplify list queries truncate at their limit BEFORE applying filters (the
// same gotcha documented for listClasses in auth.js), so a 30-day window
// with many students could theoretically need more than one page even
// within that window. Walks pages the same way Admin.jsx's fetchAllPages
// does, kept local here since this is the only place in this file that
// needs it.
async function fetchAllNotificationPages(schoolId, cutoffIso) {
  let items = []
  let nextToken = null
  do {
    const res = await client.graphql({
      query: listNotificationLogsQuery,
      variables: { schoolId, cutoff: cutoffIso, nextToken },
    })
    const page = res.data.listNotificationLogs
    items = items.concat(page.items)
    nextToken = page.nextToken
  } while (nextToken)
  return items
}

export default function AdminSettings() {
  const navigate = useNavigate()

  // Threshold section
  const [thresholdPercent, setThresholdPercent] = useState(Math.round(getChronicThreshold() * 100))
  const [thresholdSaved, setThresholdSaved] = useState(false)

  // Guardian phone section
  const [classId, setClassId] = useState(null)
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editedPhones, setEditedPhones] = useState({}) // { studentId: newValue }
  const [savingId, setSavingId] = useState(null)
  const [saveError, setSaveError] = useState('')

  // SMS audit log section
  const [notifLogs, setNotifLogs] = useState([])
  const [notifLoading, setNotifLoading] = useState(true)
  const [notifError, setNotifError] = useState('')
  const [studentNames, setStudentNames] = useState({}) // { studentId: "First Last" }, for display

  const loadNotificationLogs = useCallback(async (resolvedClassId, schoolId) => {
    if (!resolvedClassId || !schoolId) return
    setNotifLoading(true)
    setNotifError('')
    try {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 30)

      const [logs, roster] = await Promise.all([
        fetchAllNotificationPages(schoolId, cutoff.toISOString()),
        fetchClassRoster(resolvedClassId),
      ])

      logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      setNotifLogs(logs)

      const nameMap = {}
      for (const s of roster) {
        nameMap[s.id] = `${s.first_name} ${s.last_name}`
      }
      setStudentNames(nameMap)
    } catch (err) {
      console.error('Failed to load notification logs:', err)
      const detail = err.errors?.map((e) => e.message).join('; ') || err.message
      setNotifError(detail)
    } finally {
      setNotifLoading(false)
    }
  }, [])

  const loadStudents = useCallback(async (resolvedClassId) => {
    if (!resolvedClassId) return
    setLoading(true)
    setError('')
    try {
      setStudents(await fetchClassRoster(resolvedClassId))
    } catch (err) {
      console.error('Failed to load students:', err)
      const detail = err.errors?.map((e) => e.message).join('; ') || err.message
      setError(detail)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    async function resolveAndLoad() {
      try {
        const { schoolId } = await getCurrentUserContext()
        const cid = await getClassIdForSchool(schoolId)
        setClassId(cid)
        await Promise.all([
          loadStudents(cid),
          loadNotificationLogs(cid, schoolId),
        ])
      } catch (err) {
        console.error('Failed to resolve school/class context:', err)
        setError(err.message)
        setLoading(false)
        setNotifLoading(false)
      }
    }
    resolveAndLoad()
  }, [loadStudents, loadNotificationLogs])

  function handleSaveThreshold(e) {
    e.preventDefault()
    const asFraction = thresholdPercent / 100
    setChronicThreshold(asFraction)
    setThresholdSaved(true)
    setTimeout(() => setThresholdSaved(false), 2000)
  }

  async function handleSavePhone(studentId) {
    setSavingId(studentId)
    setSaveError('')
    try {
      await client.graphql({
        query: updateStudentMutation,
        variables: {
          input: {
            id: studentId,
            guardian_phone: editedPhones[studentId],
            updated_at: new Date().toISOString(),
          },
        },
      })
      await loadStudents(classId)
      setEditedPhones((prev) => {
        const next = { ...prev }
        delete next[studentId]
        return next
      })
    } catch (err) {
      console.error('Failed to update phone:', err)
      const detail = err.errors?.map((e) => e.message).join('; ') || err.message
      setSaveError(detail)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Admin Settings</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/admin')} style={{ fontSize: 12, padding: '4px 10px' }}>
            Back to Dashboard
          </button>
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

      <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 16, marginTop: 24 }}>
        <h4>Chronic Absenteeism Threshold</h4>
        <p style={{ fontSize: 12, color: '#888' }}>
          Students below this attendance percentage are flagged on the dashboard.
        </p>
        <form onSubmit={handleSaveThreshold} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="number"
            min="1"
            max="100"
            value={thresholdPercent}
            onChange={(e) => setThresholdPercent(Number(e.target.value))}
            style={{ width: 70, padding: 6 }}
          />
          <span>%</span>
          <button type="submit" style={{ padding: '6px 12px' }}>Save</button>
          {thresholdSaved && <span style={{ color: 'green', fontSize: 12 }}>Saved</span>}
        </form>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 16, marginTop: 16 }}>
        <h4>Guardian Phone Numbers — Form 2 East</h4>
        {loading && <p style={{ fontSize: 13, color: '#888' }}>Loading…</p>}
        {error && <p style={{ color: 'red', fontSize: 13 }}>{error}</p>}
        {saveError && <p style={{ color: 'red', fontSize: 13 }}>{saveError}</p>}
        {!loading && !error && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Student</th>
                <th>Guardian Phone</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const currentValue = editedPhones[s.id] ?? s.guardian_phone ?? ''
                const isDirty = editedPhones[s.id] !== undefined && editedPhones[s.id] !== s.guardian_phone
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px 0' }}>{s.first_name} {s.last_name}</td>
                    <td>
                      <input
                        value={currentValue}
                        placeholder="+2547XXXXXXXX"
                        onChange={(e) =>
                          setEditedPhones((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                        style={{ padding: 4, width: 160 }}
                      />
                    </td>
                    <td>
                      <button
                        onClick={() => handleSavePhone(s.id)}
                        disabled={!isDirty || savingId === s.id}
                        style={{ fontSize: 11, padding: '4px 8px' }}
                      >
                        {savingId === s.id ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 16, marginTop: 16 }}>
        <h4>SMS Alert Log — Last 30 Days</h4>
        {notifLoading && <p style={{ fontSize: 13, color: '#888' }}>Loading…</p>}
        {notifError && <p style={{ color: 'red', fontSize: 13 }}>{notifError}</p>}
        {!notifLoading && !notifError && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Sent</th>
                <th>Student</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {notifLogs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '6px 0', fontSize: 12 }}>
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td style={{ fontSize: 12 }}>{studentNames[log.student_id] || log.student_id}</td>
                  <td style={{ fontSize: 12 }}>{log.guardian_phone}</td>
                  <td>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 10,
                      color: log.status === 'SENT' ? '#080' : '#c00',
                      border: '1px solid currentColor',
                    }}>
                      {log.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, maxWidth: 300 }}>{log.message}</td>
                </tr>
              ))}
              {notifLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="subtext" style={{ padding: '12px 6px', fontSize: 13, color: '#888' }}>
                    No SMS alerts sent in the last 30 days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}