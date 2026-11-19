import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { signIn, confirmSignIn, signOut, signInWithRedirect } from 'aws-amplify/auth'
import { Hub } from 'aws-amplify/utils'
import awsconfig from '../lib/amplifyconfiguration.json'
import { getSignedInSession } from '../lib/auth'
import { idleTooLong, markActive } from '../lib/idleSignOut'
import { NETWORK_SCHOOL_ID } from '../lib/schools'
import { greetingFor } from '../lib/display'
import { BrandMark } from '../components/AppShell'

// Sends Angaza staff to the network view, admins and head teachers to the
// dashboard and everyone else to the register, based on the ID token (or the
// sign-in saved on this device when offline).
async function homePathForCurrentUser() {
  const { groups, schoolId } = await getSignedInSession()
  const isAdmin = groups.some((g) => g === 'Admin' || g === 'HeadTeacher')
  if (isAdmin && schoolId === NETWORK_SCHOOL_ID) return '/network'
  return isAdmin ? '/admin' : '/teacher'
}

// "Continue with Google" shows only when the app is set up for it (the
// oauth block in amplifyconfiguration.json).
const GOOGLE_ENABLED = Boolean(awsconfig.oauth?.domain)
const GOOGLE_RETRY_KEY = 'csg.googleRetry'

// The page Cognito sends people back to after Google, with ?code= on success
// or ?error_description= when the sign-in was refused.
function isGoogleReturn() {
  const params = new URLSearchParams(window.location.search)
  return params.has('code') || params.has('error_description')
}

// Turns Cognito's answer after Google into words for the login page.
// Returns 'retry' when the account has just been linked and the sign-in
// should simply run once more.
function googleProblem(text) {
  const message = String(text || '')
  if (/NO_CSG_ACCOUNT/.test(message)) {
    return "This Google account's email isn't on any CSG account. Ask your school admin to add your email, or sign in with your phone number."
  }
  if (/already found an entry/i.test(message)) return 'retry'
  return 'Google sign-in did not finish. Please try again, or sign in with your phone number.'
}

export default function Login() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [needsNewPassword, setNeedsNewPassword] = useState(false)
  // Where to go if someone is still signed in on this device. The installed
  // app opens on this page, so this is how a teacher gets back to the
  // register without internet.
  const [continuePath, setContinuePath] = useState(null)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [idleSignedOut, setIdleSignedOut] = useState(false)
  const signedOutIdle = idleSignedOut || searchParams.get('signedOut') === 'idle'

  // Back from Google: go to the person's page, or explain what went wrong.
  useEffect(() => {
    function handleProblem(text) {
      const problem = googleProblem(text)
      // Linking the Google account to the CSG account can make the very first
      // attempt fail; once linked, a second attempt signs straight in.
      if (problem === 'retry' && !sessionStorage.getItem(GOOGLE_RETRY_KEY)) {
        sessionStorage.setItem(GOOGLE_RETRY_KEY, '1')
        signInWithRedirect({ provider: 'Google' }).catch(() => setError(googleProblem('')))
        return
      }
      sessionStorage.removeItem(GOOGLE_RETRY_KEY)
      setError(problem === 'retry' ? googleProblem('') : problem)
    }

    const params = new URLSearchParams(window.location.search)
    if (params.has('error_description')) handleProblem(params.get('error_description'))

    return Hub.listen('auth', async ({ payload }) => {
      if (payload.event === 'signInWithRedirect') {
        sessionStorage.removeItem(GOOGLE_RETRY_KEY)
        markActive()
        navigate(await homePathForCurrentUser())
      }
      if (payload.event === 'signInWithRedirect_failure') {
        handleProblem(payload.data?.error?.message || payload.data?.error)
      }
    })
  }, [navigate])

  async function handleGoogle() {
    setError('')
    if (!navigator.onLine) {
      setError("You're offline. Continue with Google needs internet.")
      return
    }
    try {
      // A different person may still be signed in on this device.
      await signOut().catch(() => {})
      await signInWithRedirect({ provider: 'Google' })
    } catch (err) {
      console.error('Google sign-in failed to start:', err)
      setError(googleProblem(err.message))
    }
  }

  useEffect(() => {
    async function check() {
      // Left signed in and unused for too long: sign out instead of offering
      // Continue. Offline, Continue stays, so the register still opens. Not
      // while coming back from Google, which is finishing a new sign-in.
      if (navigator.onLine && idleTooLong() && !isGoogleReturn()) {
        await signOut().catch(() => {})
        setIdleSignedOut(true)
        return
      }
      homePathForCurrentUser().then(setContinuePath).catch(() => setContinuePath(null))
    }
    check()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!navigator.onLine) {
      setError(
        continuePath
          ? "You're offline, but you're still signed in on this device. Press Continue above."
          : "You're offline. Signing in for the first time on a device needs internet."
      )
      return
    }
    try {
      const login = phone.trim()
      const { isSignedIn, nextStep } = await signIn({ username: login, password })

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
        <img
          className="auth-photo"
          src="/login-class.webp"
          alt="A full class of students working at laptops"
          width="900"
          height="487"
        />
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
          {signedOutIdle && !continuePath && (
            <p className="notice-box" style={{ margin: 0 }}>
              You were signed out after 15 minutes without use. Sign in again to continue.
            </p>
          )}
          {continuePath && (
            <div className="notice-box signed-in-box">
              <div>
                <strong>You're still signed in on this device</strong>
                <p style={{ margin: '6px 0 0' }}>Continue to your page. This works without internet too.</p>
              </div>
              <div className="signed-in-actions">
                <button type="button" onClick={() => navigate(continuePath)} className="btn btn-primary">
                  Continue
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await signOut()
                    setContinuePath(null)
                  }}
                  className="btn"
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div>
              <label className="field-label" htmlFor="phone">Phone number</label>
              <input
                id="phone"
                type="tel"
                autoComplete="username"
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
          {GOOGLE_ENABLED && (
            <>
              <div className="auth-or"><span>or</span></div>
              <button type="button" onClick={handleGoogle} className="btn btn-google">
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
                Continue with Google
              </button>
              <p className="subtext" style={{ margin: 0, textAlign: 'center' }}>
                For accounts that have their Gmail saved. There is no sign-up: your admin creates your account.
              </p>
            </>
          )}
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
