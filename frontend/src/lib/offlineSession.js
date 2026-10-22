// The last good sign-in on this device. Cognito tokens last an hour, and
// refreshing them needs the internet, so after an hour offline Amplify can't
// hand out a session even though the person never signed out. This copy lets
// the app keep opening their page until the connection is back. Nothing is
// trusted on the server side: every sync still sends a real Cognito token.
const KEY = 'csg.lastSession'

export function rememberSession(session) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...session, saved_at: new Date().toISOString() }))
  } catch {
    // storage blocked: the app still works online
  }
}

export function readRememberedSession() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null
  } catch {
    return null
  }
}

export function forgetSession() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing to remove
  }
}
