import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { fetchAuthSession, signOut } from 'aws-amplify/auth'

export default function ProtectedRoute({ children, allowedGroups }) {
  const [checking, setChecking] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [authorized, setAuthorized] = useState(false)

  useEffect(() => {
    async function check() {
      try {
        // forceRefresh makes a live network call to Cognito -- only do this
        // when online. Offline, fall back to a plain fetchAuthSession(),
        // which Amplify satisfies from the local token cache if it hasn't
        // expired. Without this split, every protected page load required
        // network even for an already-valid cached session, which silently
        // broke the offline access this app is supposed to provide.
        const session = navigator.onLine
          ? await fetchAuthSession({ forceRefresh: true })
          : await fetchAuthSession()

        const groups = session.tokens?.idToken?.payload['cognito:groups'] || []
        setAuthenticated(true)
        setAuthorized(
          !allowedGroups || allowedGroups.length === 0
            ? true
            : groups.some((g) => allowedGroups.includes(g))
        )
      } catch {
        setAuthenticated(false)
      } finally {
        setChecking(false)
      }
    }
    check()
  }, [allowedGroups])

  if (checking) {
    return <div style={{ textAlign: 'center', marginTop: 80 }}>Checking session…</div>
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />
  }

  if (!authorized) {
    return (
      <div style={{ textAlign: 'center', marginTop: 80 }}>
        <h3>Access denied</h3>
        <p>Your account role doesn't have permission to view this page.</p>
        <button
          onClick={async () => {
            await signOut()
            window.location.href = '/login'
          }}
          style={{ padding: '8px 16px', marginTop: 12 }}
        >
          Sign Out
        </button>
      </div>
    )
  }

  return children
}