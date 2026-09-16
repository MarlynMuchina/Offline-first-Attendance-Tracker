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
      const { isSignedIn, nextStep } = await signIn({ username: phone, password })

      if (isSignedIn) {
        navigate('/teacher')
        return
      }

      if (nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setNeedsNewPassword(true)
        return
      }

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
      <div className="auth-wrap">
        <h2 style={{ textAlign: 'center' }}>Set a New Password</h2>
        <p className="subtext" style={{ textAlign: 'center' }}>
          This is your first time signing in — choose a permanent password.
        </p>
        <form onSubmit={handleNewPassword}>
          <label className="field-label">New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="input"
            style={{ marginBottom: 16 }}
          />
          {error && <p className="text-error">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
            SET PASSWORD
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="auth-wrap">
      <h2 style={{ textAlign: 'center' }}>Student Attendance Tracker</h2>
      <p className="subtext" style={{ textAlign: 'center' }}>Sign in to continue</p>
      <form onSubmit={handleSubmit}>
        <label className="field-label">Phone Number</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+2547XXXXXXXX"
          className="input"
          style={{ marginBottom: 16 }}
        />
        <label className="field-label">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
          style={{ marginBottom: 16 }}
        />
        {error && <p className="text-error">{error}</p>}
        <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
          LOG IN
        </button>
      </form>
      <div className="notice-box">
        <strong>Offline access</strong>
        <p style={{ margin: '6px 0 0' }}>
          You can log in and record attendance without internet. Data syncs once you're back online.
        </p>
      </div>
    </div>
  )
}