import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { signIn, confirmSignIn, signOut, fetchAuthSession } from 'aws-amplify/auth'
import { NETWORK_SCHOOL_ID } from '../lib/schools'
import { greetingFor } from '../lib/display'
import { BrandMark } from '../components/AppShell'

// Sends Angaza staff to the network view, admins and head teachers to the
// dashboard and everyone else to the register, based on the fresh ID token.
async function homePathForCurrentUser() {
  const session = await fetchAuthSession()
  const payload = session.tokens?.idToken?.payload || {}
  const groups = payload['cognito:groups'] || []
  const isAdmin = groups.some((g) => g === 'Admin' || g === 'HeadTeacher')
  if (isAdmin && payload['custom:school_id'] === NETWORK_SCHOOL_ID) return '/network'
  return isAdmin ? '/admin' : '/teacher'
}

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
        navigate(await homePathForCurrentUser())
        return
      }

      if (nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setNeedsNewPassword(true)
        return
      }

      setError(`Additional step required: ${nextStep?.signInStep || 'unknown'}`)
    } catch (err) {
      console.error('Sign in failed:', err)
      // A stale cached session blocks a fresh sign-in with a fairly cryptic
      // error -- common on a shared device, or when switching test
      // accounts. Clear it automatically and ask the user to retry, rather
      // than leaving them stuck on an unexplained error with no way out.
      if (err.name === 'UserAlreadyAuthenticatedException') {
        await signOut()
        setError('You were already signed in as someone else. Please try logging in again.')
        return
      }
      setError(err.message || 'Login failed')
    }
  }

  async function handleNewPassword(e) {
    e.preventDefault()
    setError('')
    try {
      const { isSignedIn } = await confirmSignIn({ challengeResponse: newPassword })
      if (isSignedIn) {
        navigate(await homePathForCurrentUser())
      }
    } catch (err) {
      console.error('Set new password failed:', err)
      setError(err.message || 'Could not set new password')
    }
  }

  const side = (
    <section className="auth-side">
      <Link to="/" className="brand brand-link" style={{ padding: 0 }}>
        <BrandMark size={44} />
        <div className="brand-text">
          <strong>CSG Attendance</strong>
          <span>Angaza Center</span>
        </div>
      </Link>
      <div className="auth-pitch">
        <h1>Attendance that keeps working offline.</h1>
        <p>
          Teachers mark the register on any phone, with or without internet. Admins see who needs help,
          and guardians get an SMS.
        </p>
        <div className="tags">
          <span className="tag">Works offline</span>
          <span className="tag">SMS to guardians</span>
          <span className="tag">AI summaries</span>
        </div>
      </div>
    </section>
  )

  if (needsNewPassword) {
    return (
      <div className="auth">
        {side}
        <main className="auth-main">
          <div className="card auth-card">
            <div>
              <h2>Set a new password</h2>
              <p className="subtext" style={{ margin: '4px 0 0' }}>
                This is your first time signing in — choose a permanent password.
              </p>
            </div>
            <form onSubmit={handleNewPassword}>
              <div>
                <label className="field-label" htmlFor="new-password">New password</label>
                <input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input"
                />
              </div>
              {error && <p className="text-error" style={{ margin: 0 }}>{error}</p>}
              <button type="submit" className="btn btn-primary">
                Set password
              </button>
            </form>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="auth">
      {side}
      <main className="auth-main">
        <div className="card auth-card">
          <div>
            <h2>{greetingFor()}</h2>
            <p className="subtext" style={{ margin: '4px 0 0' }}>Sign in to Student Attendance Tracker</p>
          </div>
          <form onSubmit={handleSubmit}>
            <div>
              <label className="field-label" htmlFor="phone">Phone number</label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+2547XXXXXXXX"
                className="input"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
              />
            </div>
            {error && <p className="text-error" style={{ margin: 0 }}>{error}</p>}
            <button type="submit" className="btn btn-primary">
              Log in
            </button>
          </form>
          <div className="notice-box">
            <strong>Offline access</strong>
            <p style={{ margin: '6px 0 0' }}>
              Sign in once with internet on this device. After that you stay signed in, and attendance can be
              recorded without internet. It syncs once you're back online.
            </p>
          </div>
          <Link to="/" className="btn auth-home-link">Back to home page</Link>
        </div>
      </main>
    </div>
  )
}
