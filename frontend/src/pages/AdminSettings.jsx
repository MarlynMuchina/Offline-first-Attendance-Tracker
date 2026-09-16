import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateClient } from 'aws-amplify/api'
import { signOut } from 'aws-amplify/auth'
import { getChronicThreshold, setChronicThreshold } from '../lib/settings'

const client = generateClient()

const CLASS_ID = 'class-form2east'

const listStudentsQuery = /* GraphQL */ `
  query ListStudentsWithPhone($classId: ID) {
    listStudents(filter: { class_id: { eq: $classId } }, limit: 100) {
      items {
        id
        first_name
        last_name
        guardian_phone
      }
    }
  }
`

const updateStudentMutation = /* GraphQL */ `
  mutation UpdateStudentPhone($input: UpdateStudentInput!) {
    updateStudent(input: $input) {
      id
      guardian_phone
    }
  }
`

export default function AdminSettings() {
  const navigate = useNavigate()

  // Threshold section
  const [thresholdPercent, setThresholdPercent] = useState(Math.round(getChronicThreshold() * 100))
  const [thresholdSaved, setThresholdSaved] = useState(false)

  // Guardian phone section
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editedPhones, setEditedPhones] = useState({}) // { studentId: newValue }
  const [savingId, setSavingId] = useState(null)
  const [saveError, setSaveError] = useState('')

  const loadStudents = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await client.graphql({ query: listStudentsQuery, variables: { classId: CLASS_ID } })
      setStudents(res.data.listStudents.items)
    } catch (err) {
      console.error('Failed to load students:', err)
      const detail = err.errors?.map((e) => e.message).join('; ') || err.message
      setError(detail)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStudents()
  }, [loadStudents])

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
      await loadStudents()
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
    </div>
  )
}