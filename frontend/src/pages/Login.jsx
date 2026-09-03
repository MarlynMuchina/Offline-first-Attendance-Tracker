import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signIn, confirmSignIn } from 'aws-amplify/auth'

export default function Login() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [needsNewPassword, setNeedsNewPassword] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      const { isSignedIn, nextStep } = await signIn({
        username: phone,
        password,
      })

      if (isSignedIn) {
        navigate('/teacher')
        return
      }

      if (nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setNeedsNewPassword(true)
        return
      }

      // Any other Cognito challenge (MFA, etc.) — not yet handled, surface it plainly
      setError(`Additional step required: ${nextStep?.signInStep || 'unknown'}`)
    } catch (err) {
      console.error('Sign in failed:', err)
      setError(err.message || 'Login failed')
    }
  }

  async function handleNewPassword(e) {
    e.preventDefault()
    setError('')
    try {
      const { isSignedIn } = await confirmSignIn({ challengeResponse: newPassword })
      if (isSignedIn) {
        navigate('/teacher')
      }
    } catch (err) {
      console.error('Set new password failed:', err)
      setError(err.message || 'Could not set new password')
    }
  }

  if (needsNewPassword) {
    return (
      <div style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'sans-serif' }}>
        <h2 style={{ textAlign: 'center' }}>Set a New Password</h2>
        <p style={{ textAlign: 'center', color: '#888' }}>
          This is your first time signing in — choose a permanent password.
        </p>
        <form onSubmit={handleNewPassword}>
          <label>New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 8, marginBottom: 16 }}
          />
          {error && <p style={{ color: 'red', fontSize: 13 }}>{error}</p>}
          <button type="submit" style={{ width: '100%', padding: 10 }}>SET PASSWORD</button>
        </form>
      </div>
    )
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
          placeholder="+2547XXXXXXXX"
          style={{ display: 'block', width: '100%', padding: 8, marginBottom: 16 }}
        />
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ display: 'block', width: '100%', padding: 8, marginBottom: 16 }}
        />
        {error && <p style={{ color: 'red', fontSize: 13 }}>{error}</p>}
        <button type="submit" style={{ width: '100%', padding: 10 }}>LOG IN</button>
      </form>
      <div style={{ marginTop: 24, padding: 12, border: '1px dashed #999', fontSize: 13 }}>
        <strong>Offline access</strong>
        <p>You can log in and record attendance without internet. Data syncs once you're back online.</p>
      </div>
    </div>
  )
}