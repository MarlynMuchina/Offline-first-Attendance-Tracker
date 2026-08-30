import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Login screen — placeholder auth for Sprint 0.
// Sprint 1 (US-01): wire this to Amplify Auth / Cognito once Marlyn's pool is live.
export default function Login() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const navigate = useNavigate()

  function handleSubmit(e) {
    e.preventDefault()
    // TODO Sprint 1: replace with Amplify Auth.signIn(phone, password)
    navigate('/teacher')
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h2 style={{ textAlign: 'center' }}>Student Attendance Tracker</h2>
      <p style={{ textAlign: 'center', color: '#888' }}>Sign in to continue</p>
      <form onSubmit={handleSubmit}>
        <label>Phone Number</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="07XX XXX XXX"
          style={{ display: 'block', width: '100%', padding: 8, marginBottom: 16 }}
        />
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ display: 'block', width: '100%', padding: 8, marginBottom: 16 }}
        />
        <button type="submit" style={{ width: '100%', padding: 10 }}>LOG IN</button>
      </form>
      <div style={{ marginTop: 24, padding: 12, border: '1px dashed #999', fontSize: 13 }}>
        <strong>Offline access</strong>
        <p>You can log in and record attendance without internet. Data syncs once you're back online.</p>
      </div>
    </div>
  )
}
