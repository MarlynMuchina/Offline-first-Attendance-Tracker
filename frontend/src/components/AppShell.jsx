import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { signOut } from 'aws-amplify/auth'
import { initials } from '../lib/display'
import { getTheme, setTheme } from '../lib/theme'

const ICONS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></>,
  classes: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5" /><circle cx="17.5" cy="9" r="2.5" /><path d="M17 14.5c2.3.2 4 1.9 4.5 4.5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
  register: <><rect x="4" y="4" width="16" height="17" rx="3" /><path d="M8 2v4M16 2v4M8.5 13.5l2.5 2.5 4.5-5" /></>,
  addStudent: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5" /><path d="M19 8v6M16 11h6" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  network: <><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="18" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="M12 7.5v4M12 11.5l-5.5 4.5M12 11.5l5.5 4.5" /></>,
}

export function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

export function BrandMark({ size = 40 }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    </span>
  )
}

export const ADMIN_NAV = [
  { to: '/admin', label: 'Dashboard', icon: 'dashboard' },
  { to: '/admin/classes', label: 'Classes', icon: 'classes' },
  { to: '/admin/settings', label: 'Settings', icon: 'settings' },
]

// Page frame for signed-in users: green sidebar with the menu, online status,
// who is signed in and Sign out; the page itself goes on the right.
// Menu items take `to` for another page or `href` for a section on this one.
export default function AppShell({ nav, user, status, children }) {
  const navigate = useNavigate()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [theme, setThemeState] = useState(getTheme)

  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="shell">
      <aside className="shell-side">
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <strong>CSG Attendance</strong>
            <span>Angaza Center</span>
          </div>
        </div>

        <nav className="shell-nav" aria-label="Main">
          {nav.map((item) =>
            item.to ? (
              <NavLink key={item.label} to={item.to} end className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}>
                <Icon name={item.icon} />{item.label}
              </NavLink>
            ) : (
              <a key={item.label} href={item.href} className={`nav-item${item.active ? ' is-active' : ''}`}>
                <Icon name={item.icon} />{item.label}
              </a>
            )
          )}
        </nav>

        <div className="shell-foot">
          <div className={`shell-status${isOnline ? '' : ' is-offline'}`}>
            {isOnline ? '● Online' : '○ Offline'}{status ? ` · ${status}` : ''}
          </div>
          <div className="shell-user">
            <span className="avatar">{initials(user.name)}</span>
            <div className="shell-user-text">
              <strong>{user.name}</strong>
              <span>{user.role}</span>
            </div>
          </div>
          <button type="button" className="shell-theme" onClick={toggleTheme} aria-pressed={theme === 'dark'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button type="button" className="shell-signout" onClick={handleSignOut}>Sign out</button>
        </div>
      </aside>

      <main className="shell-main">{children}</main>
    </div>
  )
}

// Full-page wait screen while a session check or page data is loading.
export function LoadingScreen({ message }) {
  return (
    <div className="state-screen" role="status">
      <BrandMark size={56} />
      <span className="spinner" aria-hidden="true" />
      <p className="state-message">{message}</p>
    </div>
  )
}

// Attendance ring: `value` is 0 to 1 (null shows a dash).
export function Ring({ value, label, caption, size = 164 }) {
  const pct = value === null || value === undefined ? 0 : Math.round(value * 100)
  return (
    <div
      className="ring"
      style={{ width: size, height: size, '--ring-fill': `${pct}%` }}
      role="img"
      aria-label={`${label ?? `${pct}%`} ${caption || ''}`.trim()}
    >
      <div className="ring-inner">
        <span className="ring-value">{label ?? (value === null || value === undefined ? '—' : `${pct}%`)}</span>
        {caption && <span className="ring-caption">{caption}</span>}
      </div>
    </div>
  )
}
