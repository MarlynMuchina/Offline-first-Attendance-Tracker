import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { signOut } from 'aws-amplify/auth'
import { getSignedInSession } from '../lib/auth'
import { LoadingScreen } from './AppShell'

export default function ProtectedRoute({ children, allowedGroups }) {
  const [checking, setChecking] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [authorized, setAuthorized] = useState(false)

  useEffect(() => {
    async function check() {
      try {
        // Online, refresh the tokens so a changed role takes effect. Offline,
        // getSignedInSession uses the cached tokens, or the sign-in saved on
        // this device once those have expired, so a signed-in teacher can
        // still open their page without internet.
        const { groups } = await getSignedInSession({ forceRefresh: navigator.onLine })
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
    return <LoadingScreen message="Checking your sign-in…" />
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />
  }

  if (!authorized) {
    return (
      <div className="state-screen">
        <h3>Access denied</h3>
        <p>Your account role doesn't have permission to view this page.</p>
        <button
          onClick={async () => {
            await signOut()
            window.location.href = '/login'
          }}
          className="btn"
        >
          Sign Out
        </button>
      </div>
    )
  }

  return children
}