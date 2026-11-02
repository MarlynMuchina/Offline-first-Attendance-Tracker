// Signs a person out after a while with no taps, clicks or typing, so a
// borrowed or shared phone left on the register can't be used by the next
// person. It only signs out while online: signing back in needs the internet,
// so doing it offline would lock a teacher out of the register. Offline, it
// waits until the connection is back.
//
// The time of the last activity is kept on the device, not just in the open
// page, so closing the app or reloading it doesn't start the 15 minutes again,
// and activity in one tab counts for the others.
export const IDLE_LIMIT_MS = 15 * 60 * 1000
const KEY = 'csg.lastActivity'
const CHECK_EVERY_MS = 30 * 1000
const SAVE_EVERY_MS = 5 * 1000
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll']
const CHECK_EVENTS = ['online', 'focus', 'visibilitychange']

export function markActive(now = Date.now()) {
  try {
    localStorage.setItem(KEY, String(now))
  } catch {
    // storage blocked: the open page still keeps time
  }
}

export function forgetActivity() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing to remove
  }
}

function lastActivity() {
  try {
    const saved = Number(localStorage.getItem(KEY))
    return saved > 0 ? saved : null
  } catch {
    return null
  }
}

// True when the last activity on this device was longer ago than the limit.
// No saved time (a sign-in from before this was added) counts as active.
export function idleTooLong({ now = Date.now(), limitMs = IDLE_LIMIT_MS } = {}) {
  const last = lastActivity()
  return last !== null && now - last >= limitMs
}

export function startIdleWatch({
  onIdle,
  limitMs = IDLE_LIMIT_MS,
  isOnline = () => navigator.onLine,
  now = () => Date.now(),
  target = window,
}) {
  let fired = false
  let savedAt = 0
  if (lastActivity() === null) markActive(now())

  const noteActivity = () => {
    if (now() - savedAt < SAVE_EVERY_MS) return
    savedAt = now()
    markActive(savedAt)
  }

  const check = () => {
    if (fired || !isOnline()) return
    if (idleTooLong({ now: now(), limitMs })) {
      fired = true
      onIdle()
    }
  }

  ACTIVITY_EVENTS.forEach((name) => target.addEventListener(name, noteActivity, { passive: true }))
  CHECK_EVENTS.forEach((name) => target.addEventListener(name, check))
  const interval = setInterval(check, CHECK_EVERY_MS)
  check()

  return function stop() {
    ACTIVITY_EVENTS.forEach((name) => target.removeEventListener(name, noteActivity))
    CHECK_EVENTS.forEach((name) => target.removeEventListener(name, check))
    clearInterval(interval)
  }
}
