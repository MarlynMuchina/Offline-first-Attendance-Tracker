import { useNavigate } from 'react-router-dom'
import { BrandMark, Ring } from '../components/AppShell'

const features = [
  {
    title: 'Works Without Internet',
    desc: 'Teachers mark attendance offline — records queue locally and sync automatically the moment connectivity returns.',
  },
  {
    title: 'Role-Based Access',
    desc: 'Teachers, school admins and the Angaza team each see exactly what their role needs — nothing more.',
  },
  {
    title: 'AI-Powered Insights',
    desc: 'Generate plain-language attendance summaries, risk predictions and exam eligibility checks in seconds.',
  },
  {
    title: 'Instant Parent Alerts',
    desc: 'SMS to guardians on every absence or when attendance drops below the warning and exam lines — no smartphone needed on their end.',
  },
]

const accountSteps = [
  {
    title: 'Angaza adds each school admin',
    desc: 'The Angaza team creates one admin login per school from the network overview.',
  },
  {
    title: 'The school admin adds teachers',
    desc: 'From the Classes page the admin creates a teacher login and gives them a temporary password.',
  },
  {
    title: 'Teachers sign in and set a password',
    desc: 'On first sign-in the teacher chooses their own password, then marks the register for their class.',
  },
  {
    title: 'Guardians get SMS, no login',
    desc: 'Parents and guardians need no account or smartphone. They receive texts on the phone number the school saved.',
  },
]

export default function Home() {
  const navigate = useNavigate()

  return (
    <div className="home">
      <header className="home-nav">
        <div className="home-brand">
          <BrandMark />
          <div className="brand-text">
            <strong>CSG Attendance</strong>
            <span>Angaza Center</span>
          </div>
        </div>
        <button onClick={() => navigate('/login')} className="btn btn-primary">
          Sign In
        </button>
      </header>

      <section className="home-hero">
        <div className="home-hero-text">
          <h1>Attendance tracking built for schools without reliable internet</h1>
          <p>
            Offline-first, AI-assisted, and built specifically for rural Kenyan schools —
            take attendance with no connection, get instant insights, keep parents informed.
          </p>
          <button onClick={() => navigate('/login')} className="btn btn-accent">
            Sign In to Get Started
          </button>
        </div>
        <div className="home-hero-art" aria-hidden="true">
          <Ring value={0.75} label="✓" caption="works offline" size={220} />
        </div>
      </section>

      <section className="home-features">
        {features.map((f) => (
          <div key={f.title} className="card home-feature-card">
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </div>
        ))}
      </section>

      <section className="card home-steps">
        <h2>How accounts work</h2>
        <p className="subtext" style={{ margin: 0 }}>
          There is no sign-up page. Every login is created for a person by the level above them.
        </p>
        <ol className="step-list">
          {accountSteps.map((s) => (
            <li key={s.title}>
              <strong>{s.title}</strong>
              <p>{s.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="home-footer">
        <p>Need an account? Ask your school administrator. Accounts are issued, not self-registered.</p>
      </footer>
    </div>
  )
}
