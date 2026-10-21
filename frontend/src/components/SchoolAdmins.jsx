import { useState, useEffect, useCallback } from 'react'
import { generateClient } from 'aws-amplify/api'
import { SCHOOLS, schoolName } from '../lib/schools'

const client = generateClient()

const manageSchoolAdminsMutation = /* GraphQL */ `
  mutation ManageSchoolAdmins($input: ManageSchoolAdminsInput!) {
    manageSchoolAdmins(input: $input) {
      admins { username phone_number name school_id enabled status created_at }
      admin { username phone_number name school_id enabled status }
      temporary_password
    }
  }
`

async function manage(input) {
  const res = await client.graphql({ query: manageSchoolAdminsMutation, variables: { input } })
  return res.data.manageSchoolAdmins
}

const errorText = (err) => err.errors?.map((e) => e.message).join('; ') || err.message

const STATUS_LABELS = {
  FORCE_CHANGE_PASSWORD: 'Not signed in yet',
  CONFIRMED: 'Active',
}

// Angaza creates and looks after one or more admin logins per school. The
// temporary password is shown once, to be handed to the new admin.
export default function SchoolAdmins() {
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [handover, setHandover] = useState(null) // { name, phone, password }
  const [form, setForm] = useState({ school_id: '', first_name: '', last_name: '', phone_number: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setAdmins((await manage({ action: 'LIST' })).admins || [])
    } catch (err) {
      console.error('Failed to load school admins:', err)
      setError(errorText(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function run(key, input, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(key)
    setError('')
    try {
      const res = await manage(input)
      if (res.temporary_password) {
        setHandover({
          name: res.admin?.name || res.admin?.username,
          phone: res.admin?.phone_number || res.admin?.username,
          school: schoolName(res.admin?.school_id),
          password: res.temporary_password,
        })
      }
      await load()
      return true
    } catch (err) {
      console.error(`School admin ${input.action} failed:`, err)
      setError(errorText(err))
      return false
    } finally {
      setBusy(null)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    const ok = await run('create', { action: 'CREATE', ...form })
    if (ok) setForm({ school_id: '', first_name: '', last_name: '', phone_number: '' })
  }

  const schoolsWithoutAdmin = Object.keys(SCHOOLS).filter(
    (id) => !admins.some((a) => a.school_id === id && a.enabled)
  )

  return (
    <div className="card">
      <h4>School admins</h4>
      <p className="subtext">
        Each school has its own admin login. Create one here, then give the admin their phone number and
        temporary password; they choose their own password the first time they sign in.
      </p>
      {schoolsWithoutAdmin.length > 0 && !loading && (
        <p className="subtext">No active admin yet: {schoolsWithoutAdmin.map(schoolName).join(', ')}.</p>
      )}

      {handover && (
        <div className="card card-dashed" style={{ marginBottom: 12 }}>
          <p>
            Give these to <strong>{handover.name}</strong> ({handover.school}). The password is shown only once.
          </p>
          <p>Phone: <strong>{handover.phone}</strong></p>
          <p>Temporary password: <strong style={{ fontFamily: 'monospace' }}>{handover.password}</strong></p>
          <button className="btn btn-small" onClick={() => setHandover(null)}>Done</button>
        </div>
      )}

      {error && <p className="text-error">{error}</p>}
      {loading ? (
        <p className="subtext">Loading admins…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>School</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.username} className={a.enabled ? '' : 'subtext'}>
                <td>{schoolName(a.school_id)}</td>
                <td>{a.name || '—'}</td>
                <td>{a.phone_number || a.username}</td>
                <td>{a.enabled ? STATUS_LABELS[a.status] || a.status : 'Disabled'}</td>
                <td>
                  <div className="button-group">
                    {a.enabled ? (
                      <button
                        className="btn btn-small"
                        disabled={busy !== null}
                        onClick={() => run(a.username, { action: 'DISABLE', username: a.username },
                          `Disable ${a.name || a.username}? They won't be able to sign in until enabled again.`)}
                      >
                        Disable
                      </button>
                    ) : (
                      <button
                        className="btn btn-small"
                        disabled={busy !== null}
                        onClick={() => run(a.username, { action: 'ENABLE', username: a.username })}
                      >
                        Enable
                      </button>
                    )}
                    <button
                      className="btn btn-small"
                      disabled={busy !== null || !a.enabled}
                      onClick={() => run(a.username, { action: 'RESET_PASSWORD', username: a.username },
                        `Give ${a.name || a.username} a new temporary password? Their current password stops working.`)}
                    >
                      Reset password
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {admins.length === 0 && (
              <tr>
                <td colSpan={5} className="subtext">No school admins yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <h4 style={{ marginTop: 16 }}>Add a school admin</h4>
      <form onSubmit={handleCreate} className="button-group" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="subtext">
          School{' '}
          <select
            value={form.school_id}
            onChange={(e) => setForm({ ...form, school_id: e.target.value })}
            required
          >
            <option value="">Select a school…</option>
            {Object.keys(SCHOOLS).map((id) => (
              <option key={id} value={id}>{schoolName(id)}</option>
            ))}
          </select>
        </label>
        <label className="subtext">
          First name{' '}
          <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
        </label>
        <label className="subtext">
          Last name{' '}
          <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
        </label>
        <label className="subtext">
          Phone{' '}
          <input
            value={form.phone_number}
            onChange={(e) => setForm({ ...form, phone_number: e.target.value.trim() })}
            placeholder="+2547XXXXXXXX"
            pattern="\+254\d{9}"
            required
          />
        </label>
        <button type="submit" className="btn btn-small" disabled={busy !== null}>
          {busy === 'create' ? 'Creating…' : 'Create admin'}
        </button>
      </form>
    </div>
  )
}
