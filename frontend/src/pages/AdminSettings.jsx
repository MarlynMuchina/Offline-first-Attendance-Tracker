import { useState, useEffect, useCallback } from 'react'
import { generateClient } from 'aws-amplify/api'
import { schoolName } from '../lib/schools'
import AppShell, { ADMIN_NAV } from '../components/AppShell'
import { getChronicThreshold, setChronicThreshold, getTermStart, setTermStart, getExamDate, setExamDate } from '../lib/settings'
import { getCurrentUserContext, getClassesForSchool } from '../lib/auth'
import { NEEDS_INTERNET } from '../lib/network'
import { SMS_PREFERENCES, DEFAULT_SMS_PREFERENCE, SMS_LANGUAGES, DEFAULT_SMS_LANGUAGE } from '../lib/smsPreference'

const client = generateClient()

const listStudentsQuery = /* GraphQL */ `
  query ListStudentsWithPhone($schoolId: ID, $nextToken: String) {
    listStudents(filter: { school_id: { eq: $schoolId } }, limit: 1000, nextToken: $nextToken) {
      items {
        id
        first_name
        last_name
        class_id
        guardian_phone
        sms_preference
        sms_language
      }
      nextToken
    }
  }
`

const updateStudentMutation = /* GraphQL */ `
  mutation UpdateStudentGuardian($input: UpdateStudentInput!) {
    updateStudent(input: $input) {
      id
      guardian_phone
      sms_preference
      sms_language
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

async function fetchAllSchoolStudents(schoolId) {
  let items = []
  let nextToken = null
  do {
    const res = await client.graphql({
      query: listStudentsQuery,
      variables: { schoolId, nextToken },
    })
    const page = res.data.listStudents
    items = items.concat(page.items)
    nextToken = page.nextToken
  } while (nextToken)
  return items
}

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

  // Threshold section
  const [thresholdPercent, setThresholdPercent] = useState(Math.round(getChronicThreshold() * 100))
  const [thresholdSaved, setThresholdSaved] = useState(false)

  // Term dates section
  const [termStartInput, setTermStartInput] = useState(getTermStart)
  const [examDateInput, setExamDateInput] = useState(getExamDate)
  const [termDatesSaved, setTermDatesSaved] = useState(false)
  const [termDatesError, setTermDatesError] = useState('')

  // Guardian phone section
  const [schoolId, setSchoolId] = useState(null)
  const [classNames, setClassNames] = useState({}) // { classId: name }
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editedPhones, setEditedPhones] = useState({}) // { studentId: newValue }
  const [editedPrefs, setEditedPrefs] = useState({}) // { studentId: sms_preference }
  const [editedLangs, setEditedLangs] = useState({}) // { studentId: sms_language }
  const [savingId, setSavingId] = useState(null)
  const [saveError, setSaveError] = useState('')

  // SMS audit log section
  const [notifLogs, setNotifLogs] = useState([])
  const [notifLoading, setNotifLoading] = useState(true)
  const [notifError, setNotifError] = useState('')
  const [studentNames, setStudentNames] = useState({}) // { studentId: "First Last" }, for display

  const loadNotificationLogs = useCallback(async (resolvedSchoolId) => {
    if (!resolvedSchoolId) return
    setNotifLoading(true)
    setNotifError('')
    try {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 30)

      const [logs, roster] = await Promise.all([
        fetchAllNotificationPages(resolvedSchoolId, cutoff.toISOString()),
        fetchAllSchoolStudents(resolvedSchoolId),
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

  const loadStudents = useCallback(async (resolvedSchoolId) => {
    if (!resolvedSchoolId) return
    setLoading(true)
    setError('')
    try {
      const all = await fetchAllSchoolStudents(resolvedSchoolId)
      // Students removed from the school have class_id cleared; skip them.
      const enrolled = all.filter((s) => s.class_id)
      enrolled.sort((a, b) =>
        a.class_id.localeCompare(b.class_id) ||
        `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)
      )
      setStudents(enrolled)
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
        if (!navigator.onLine) throw new Error(NEEDS_INTERNET)
        const { schoolId: sid } = await getCurrentUserContext()
        setSchoolId(sid)
        const [schoolClasses] = await Promise.all([
          getClassesForSchool(sid),
          loadStudents(sid),
          loadNotificationLogs(sid),
        ])
        setClassNames(Object.fromEntries(schoolClasses.map((c) => [c.id, c.name])))
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

  function handleSaveTermDates(e) {
    e.preventDefault()
    if (termStartInput && examDateInput && examDateInput <= termStartInput) {
      setTermDatesError('The exam date must be after the term start.')
      return
    }
    setTermDatesError('')
    setTermStart(termStartInput)
    setExamDate(examDateInput)
    setTermDatesSaved(true)
    setTimeout(() => setTermDatesSaved(false), 2000)
  }

  async function handleSaveGuardian(studentId) {
    setSavingId(studentId)
    setSaveError('')
    try {
      await client.graphql({
        query: updateStudentMutation,
        variables: {
          input: {
            id: studentId,
            ...(editedPhones[studentId] !== undefined && { guardian_phone: editedPhones[studentId] }),
            ...(editedPrefs[studentId] !== undefined && { sms_preference: editedPrefs[studentId] }),
            ...(editedLangs[studentId] !== undefined && { sms_language: editedLangs[studentId] }),
            updated_at: new Date().toISOString(),
          },
        },
      })
      await loadStudents(schoolId)
      const without = (prev) => {
        const next = { ...prev }
        delete next[studentId]
        return next
      }
      setEditedPhones(without)
      setEditedPrefs(without)
      setEditedLangs(without)
    } catch (err) {
      console.error('Failed to update phone:', err)
      const detail = err.errors?.map((e) => e.message).join('; ') || err.message
      setSaveError(detail)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <AppShell nav={ADMIN_NAV} user={{ name: 'School admin', role: schoolName(schoolId) }}>
      <div>
        <p className="eyebrow">{schoolName(schoolId)}</p>
        <h1 className="page-title">Settings</h1>
        <p className="subtext" style={{ margin: '6px 0 0' }}>Warning line, term dates, guardian phones and the SMS alert log.</p>
      </div>

      <div className="card">
        <h4>Chronic Absenteeism Threshold</h4>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
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
          {thresholdSaved && <span style={{ color: 'var(--green-2)', fontSize: 12 }}>Saved</span>}
        </form>
      </div>

      <div className="card">
        <h4>Term Dates</h4>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          The dashboard opens on the current term, and the exam eligibility check counts attendance from the term start up to the exam date.
        </p>
        <form onSubmit={handleSaveTermDates} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13 }}>
            Term started{' '}
            <input
              type="date"
              value={termStartInput}
              onChange={(e) => setTermStartInput(e.target.value)}
              style={{ padding: 4 }}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Exam date{' '}
            <input
              type="date"
              value={examDateInput}
              onChange={(e) => setExamDateInput(e.target.value)}
              style={{ padding: 4 }}
            />
          </label>
          <button type="submit" style={{ padding: '6px 12px' }}>Save</button>
          {termDatesSaved && <span style={{ color: 'var(--green-2)', fontSize: 12 }}>Saved</span>}
        </form>
        {termDatesError && <p style={{ color: 'var(--red-text)', fontSize: 13 }}>{termDatesError}</p>}
      </div>

      <div className="card">
        <h4>Guardian Phones and SMS Alerts</h4>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          Each guardian chooses whether to get a text for every absence, or only when attendance drops below 70% and below the exam line, and whether the texts come in English or Kiswahili.
        </p>
        {loading && <p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</p>}
        {error && <p style={{ color: 'var(--red-text)', fontSize: 13 }}>{error}</p>}
        {saveError && <p style={{ color: 'var(--red-text)', fontSize: 13 }}>{saveError}</p>}
        {!loading && !error && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: 0 }}>
                <th>Student</th>
                <th>Class</th>
                <th>Guardian Phone</th>
                <th>Texts</th>
                <th>Language</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const currentValue = editedPhones[s.id] ?? s.guardian_phone ?? ''
                const savedPref = s.sms_preference || DEFAULT_SMS_PREFERENCE
                const currentPref = editedPrefs[s.id] ?? savedPref
                const savedLang = s.sms_language || DEFAULT_SMS_LANGUAGE
                const currentLang = editedLangs[s.id] ?? savedLang
                const isDirty =
                  (editedPhones[s.id] !== undefined && editedPhones[s.id] !== s.guardian_phone) ||
                  currentPref !== savedPref ||
                  currentLang !== savedLang
                return (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--sand)' }}>
                    <td style={{ padding: '8px 0' }}>{s.first_name} {s.last_name}</td>
                    <td>{classNames[s.class_id] || s.class_id}</td>
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
                      <select
                        value={currentPref}
                        onChange={(e) =>
                          setEditedPrefs((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                        style={{ padding: 4, fontSize: 12 }}
                      >
                        {SMS_PREFERENCES.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={currentLang}
                        onChange={(e) =>
                          setEditedLangs((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                        style={{ padding: 4, fontSize: 12 }}
                      >
                        {SMS_LANGUAGES.map((l) => (
                          <option key={l.value} value={l.value}>{l.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        onClick={() => handleSaveGuardian(s.id)}
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

      <div className="card">
        <h4>SMS Alert Log — Last 30 Days</h4>
        {notifLoading && <p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</p>}
        {notifError && <p style={{ color: 'var(--red-text)', fontSize: 13 }}>{notifError}</p>}
        {!notifLoading && !notifError && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: 0 }}>
                <th>Sent</th>
                <th>Student</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {notifLogs.map((log) => (
                <tr key={log.id} style={{ borderTop: '1px solid var(--sand)' }}>
                  <td style={{ padding: '6px 0', fontSize: 12 }}>
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td style={{ fontSize: 12 }}>{studentNames[log.student_id] || log.student_id}</td>
                  <td style={{ fontSize: 12 }}>{log.guardian_phone}</td>
                  <td>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 10,
                      color: log.status === 'SENT' ? 'var(--green-2)' : 'var(--red)',
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
                  <td colSpan={5} className="subtext" style={{ padding: '12px 6px', fontSize: 13, color: 'var(--muted)' }}>
                    No SMS alerts sent in the last 30 days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  )
}